const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const babel = require('@babel/core');

const {
  canSubmitResponse, createMutationId, createReportModalHandoff, createRequesterResponseFlow,
  createRequesterResponseRegistry, explanationError,
  reportDisplayState, reportViewModel,
  responsibilityLabel,
} = require('../../../services/requesterDeliveryReportFlow');

const root = resolve(__dirname, '../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const attemptId = 'a'.repeat(64);
const report = (response = null) => ({
  attemptId, orderId: 'order-one', attemptNumber: 2, reportedReasonLabel: 'Customer did not respond',
  reportReceivedAt: '2026-10-20T12:00:00.000Z', reviewState: 'awaiting_review',
  requesterResponseStatus: response ? 'submitted' : 'not_submitted', requesterResponse: response,
  contactAttempts: [{ method: 'Phone call', outcome: 'No answer', claimedAt: '2026-10-20T11:55:00.000Z', claimedAtUnverified: true }],
});

function loadClient({ fetch, auth = { currentUser: { getIdToken: async () => 'trusted-token' } }, ready = async () => {} }) {
  const filename = resolve(root, 'services/requesterDeliveryReports.js');
  const source = babel.transformSync(readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', 'AbortController', 'setTimeout', 'clearTimeout', source)(
    (name) => {
      if (name === '../firebase') return { auth };
      if (name === './apiClient') return { getApiUrl: (path) => `https://backend.test${path}` };
      if (name === './authSession') return { ensureAuthStateReady: ready };
      throw new Error(`Unexpected import: ${name}`);
    }, module, module.exports, fetch, AbortController, setTimeout, clearTimeout,
  );
  return module.exports;
}

test('authenticated API client requests bounded order reports, one detail, and exact POST payload', async () => {
  const calls = [];
  let readyCount = 0;
  const client = loadClient({ ready: async () => { readyCount += 1; }, fetch: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => options.method === 'POST' ? { report: report({ explanation: 'I received no call.', submittedAt: '2026-10-20T13:00:00.000Z' }) }
      : url.includes('attemptId=') ? { report: report() } : { reports: [report()], nextCursor: null } };
  } });
  assert.equal((await client.fetchRequesterDeliveryReports('order/one', { limit: 1 })).reports.length, 1);
  assert.equal((await client.fetchRequesterDeliveryReport(attemptId, 'order-one')).report.attemptId, attemptId);
  await client.submitRequesterDeliveryResponse({ attemptId, explanation: 'I received no call.', clientMutationId: 'stable-uuid' });
  await client.fetchRequesterDeliveryReports('order-one', { cursor: attemptId });
  assert.equal(readyCount, 4);
  assert.match(calls[0].url, /orderId=order%2Fone&limit=1/);
  assert.match(calls[1].url, new RegExp(`attemptId=${attemptId}&orderId=order-one`));
  assert.deepEqual(JSON.parse(calls[2].options.body), { attemptId, explanation: 'I received no call.', clientMutationId: 'stable-uuid' });
  assert.match(calls[3].url, new RegExp(`orderId=order-one&limit=20&cursor=${attemptId}`));
  for (const call of calls) assert.equal(call.options.headers.Authorization, 'Bearer trusted-token');
  assert.equal(calls[2].options.headers['Content-Type'], 'application/json');
  assert.doesNotMatch(read('services/requesterDeliveryReports.js'), /collection\(|deliveryAttempts|deliveryAttemptEvents/);
});

test('global report feed omits orderId and encodes bounded pagination without changing scoped reads', async () => {
  const calls = [];
  const client = loadClient({ fetch: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => url.includes('attemptId=')
      ? { report: report() } : { reports: [report()], nextCursor: null } };
  } });
  await client.fetchRequesterDeliveryReports();
  await client.fetchRequesterDeliveryReports(undefined, { limit: 25, cursor: attemptId });
  await client.fetchRequesterDeliveryReports('order/one', { limit: 1, cursor: attemptId });
  await client.fetchRequesterDeliveryReport(attemptId, 'order-one');
  await client.fetchRequesterDeliveryReports(undefined, { cursor: 'skipped&cursor=other' });
  assert.equal(calls.length, 5);
  assert.equal(new URL(calls[0].url).search, '?limit=20');
  assert.equal(new URL(calls[1].url).search, `?limit=25&cursor=${attemptId}`);
  assert.equal(new URL(calls[2].url).search, `?orderId=order%2Fone&limit=1&cursor=${attemptId}`);
  assert.equal(new URL(calls[3].url).search, `?attemptId=${attemptId}&orderId=order-one`);
  assert.equal(new URL(calls[4].url).searchParams.get('cursor'), 'skipped&cursor=other');
  assert.ok(!new URL(calls[4].url).searchParams.has('orderId'));
  for (const call of calls) assert.equal(call.options.headers.Authorization, 'Bearer trusted-token');
  assert.throws(() => client.fetchRequesterDeliveryReports('', { limit: 26 }), RangeError);
  assert.throws(() => client.fetchRequesterDeliveryReports('', { limit: 0 }), RangeError);
  assert.equal(calls.length, 5);
});

test('review completion client uses the protected bounded feed without a client collection read', async () => {
  const calls = [];
  const client = loadClient({ fetch: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ completions: [], nextCursor: null }) };
  } });
  assert.deepEqual(await client.fetchRequesterReviewCompletions({ limit: 1, cursor: attemptId }),
    { completions: [], nextCursor: null });
  assert.match(calls[0].url, new RegExp(`feed=review-completions&limit=1&cursor=${attemptId}`));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer trusted-token');
  assert.throws(() => client.fetchRequesterReviewCompletions({ limit: 26 }), RangeError);
});

test('client distinguishes unauthenticated, confirmed conflict, server failure, and uncertain network result', async () => {
  const body = { attemptId, explanation: 'I received no call.', clientMutationId: 'stable-uuid' };
  const missing = loadClient({ auth: { currentUser: null }, fetch: async () => { throw new Error('must not fetch'); } });
  await assert.rejects(missing.fetchRequesterDeliveryReports('order-one'), (error) => error.status === 401);
  const conflict = loadClient({ fetch: async () => ({ ok: false, status: 409, json: async () => ({ error: { reason: 'DELIVERY_RESPONSE_CONFLICT', message: 'Already responded' } }) }) });
  await assert.rejects(conflict.submitRequesterDeliveryResponse(body), (error) => error.status === 409 && !error.uncertain);
  const serverError = loadClient({ fetch: async () => ({ ok: false, status: 503, json: async () => null }) });
  await assert.rejects(serverError.submitRequesterDeliveryResponse(body), (error) => error.status === 503 && error.uncertain);
  const network = loadClient({ fetch: async () => { throw new Error('offline'); } });
  await assert.rejects(network.submitRequesterDeliveryResponse(body), (error) => error.uncertain === true);
});

test('loading, empty, error, multiple attempts, and rescheduled reports are independent of current order status', () => {
  assert.equal(reportDisplayState({ loading: true, error: '', reports: [] }), 'loading');
  assert.equal(reportDisplayState({ loading: false, error: '', reports: [] }), 'empty');
  assert.equal(reportDisplayState({ loading: false, error: 'Offline', reports: [] }), 'error');
  const attempts = [report(), { ...report(), attemptId: 'b'.repeat(64), attemptNumber: 1 }];
  assert.equal(reportDisplayState({ loading: false, error: '', reports: attempts }), 'ready');
  assert.deepEqual(attempts.map((item) => item.attemptNumber), [2, 1]);
  assert.equal(canSubmitResponse(attempts[0]), true);
  assert.equal(canSubmitResponse({ ...attempts[0], reviewState: 'status_unavailable' }), false);
  assert.equal(canSubmitResponse(report({ explanation: 'I received no call.', submittedAt: '2026-10-20T13:00:00.000Z' })), false);
  const requests = read('app/requester/r_request.jsx');
  assert.match(requests, /fetchRequesterDeliveryReports\(orderId, \{ limit: 1 \}\)/);
  assert.match(requests, /selectedRequest\?\.id/);
  assert.doesNotMatch(requests, /if \(.*status.*\) checkReportAvailability/);
});

test('response text validation matches server limits and DTO projection drops private fields', () => {
  assert.ok(explanationError('  '));
  assert.ok(explanationError('too short'));
  assert.ok(explanationError('!'.repeat(12)));
  assert.ok(explanationError('a'.repeat(501)));
  assert.equal(explanationError('  I was home   and received no call. '), '');
  const visible = reportViewModel({ ...report(), reportEvidence: { interactionNote: 'private refusal' },
    failureReasonNote: 'private note', clientMutationId: 'private-id', moderationIncidentId: 'secret',
    requesterResponse: { explanation: 'I received no call.', submittedAt: '2026-10-20T13:00:00.000Z', clientMutationId: 'private-response-id' } });
  const encoded = JSON.stringify(visible);
  for (const secret of ['private refusal', 'private note', 'private-id', 'private-response-id', 'secret']) assert.ok(!encoded.includes(secret));
  assert.equal(visible.contactAttempts[0].claimedAtUnverified, true);
  assert.match(createMutationId(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('pending deadline and resolved decision state use neutral labels and block a new response', () => {
  const pending = reportViewModel({ ...report(), responseWindowOpen: true,
    responseDeadlineAt: '2026-10-23T12:00:00.000Z' });
  assert.equal(canSubmitResponse(pending), true);
  assert.equal(pending.responseDeadlineAt, '2026-10-23T12:00:00.000Z');
  assert.equal(canSubmitResponse(reportViewModel({ ...report(), responseWindowOpen: false })), false);
  const resolved = reportViewModel({ ...report(), reviewState: 'resolved', responseWindowOpen: false,
    responsibility: 'shared', decisionReason: 'Both accounts were reviewed against the delivery record.',
    decidedAt: '2026-10-24T12:00:00.000Z' });
  assert.equal(resolved.decisionReason, 'Both accounts were reviewed against the delivery record.');
  assert.equal(resolved.decidedAt, '2026-10-24T12:00:00.000Z');
  assert.equal(canSubmitResponse(resolved), false);
  assert.deepEqual(['requester_responsible', 'provider_responsible', 'shared', 'undetermined']
    .map(responsibilityLabel), ['Requester responsibility', 'Provider responsibility',
      'Shared responsibility', 'Responsibility undetermined']);
  const dialog = read('components/RequesterDeliveryReportDialog.jsx');
  assert.match(dialog, /Review Completed/);
  assert.match(dialog, /decisionReason/);
  assert.match(dialog, /colors\.textPrimary/);
  assert.match(dialog, /onCancel=\{onClose\}/);
});

test('rapid duplicate taps send once; uncertain retry freezes text and mutation ID until exact replay', async () => {
  let release;
  const sent = [];
  let reads = 0;
  const flow = createRequesterResponseFlow({ makeId: () => 'uuid-once',
    readReport: async () => { reads += 1; return report(); },
    send: (payload) => {
      sent.push(payload);
      if (sent.length === 1) return new Promise((_, reject) => { release = () => { const error = new Error('unknown'); error.uncertain = true; reject(error); }; });
      return Promise.resolve({ report: report({ explanation: payload.explanation, submittedAt: '2026-10-20T13:00:00.000Z' }) });
    },
  });
  const first = flow.submit(attemptId, '  I was home   and received no call. ');
  assert.deepEqual(await flow.submit(attemptId, 'A different response'), { ignored: true });
  release();
  await assert.rejects(first, /unknown/);
  assert.equal(flow.hasPending(), true);
  const retried = await flow.submit(attemptId, 'Changed while offline');
  assert.equal(retried.report.requesterResponseStatus, 'submitted');
  assert.equal(reads, 1);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0]);
  assert.equal(sent[1].clientMutationId, 'uuid-once');
  assert.equal(sent[1].explanation, 'I was home and received no call.');
  assert.equal(flow.hasPending(), false);
});

test('unknown result cannot become success from matching visible text alone; conflict clears retry', async () => {
  let sends = 0;
  const flow = createRequesterResponseFlow({ makeId: () => 'uuid-one',
    readReport: async () => report({ explanation: 'I received no call.', submittedAt: '2026-10-20T13:00:00.000Z' }),
    send: async () => { sends += 1; const error = new Error(sends === 1 ? 'unknown' : 'conflict');
      if (sends === 1) error.uncertain = true; else error.status = 409;
      throw error; },
  });
  await assert.rejects(flow.submit(attemptId, 'I received no call.'), /unknown/);
  await assert.rejects(flow.submit(attemptId, 'I received no call.'), (error) => error.status === 409);
  assert.equal(sends, 2);
  assert.equal(flow.hasPending(), false);
  const failed = createRequesterResponseFlow({ makeId: () => 'uuid-two', readReport: async () => report(),
    send: async () => ({ report: { ...report(), requesterResponseStatus: 'not_submitted' } }) });
  await assert.rejects(failed.submit(attemptId, 'I received no call.'), (error) => error.uncertain === true);
  assert.equal(failed.hasPending(), true);
});

test('modal handoff waits for the platform dismissal lifecycle and rejects stale transitions', () => {
  for (const platform of ['ios', 'web']) {
    const handoff = createReportModalHandoff(platform);
    assert.equal(handoff.begin('order-one', '/requester/r_request'), true);
    assert.equal(handoff.begin('order-two', '/requester/r_request'), false);
    assert.equal(handoff.visibilityCommitted('/requester/r_request'), '');
    assert.equal(handoff.dismissed('/requester/other'), '');
    assert.equal(handoff.dismissed('/requester/r_request'), 'order-one');
    assert.equal(handoff.dismissed('/requester/r_request'), '');
    assert.equal(handoff.begin('order-two', '/requester/r_request'), true);
    handoff.cancel(); // Selection change, navigation, or unmount invalidates the handoff.
    assert.equal(handoff.dismissed('/requester/r_request'), '');
  }
  const android = createReportModalHandoff('android');
  assert.equal(android.begin('order-one', '/requester/r_request'), true);
  assert.equal(android.dismissed('/requester/r_request'), '');
  assert.equal(android.visibilityCommitted('/requester/other'), '');
  assert.equal(android.visibilityCommitted('/requester/r_request'), 'order-one');
  assert.equal(android.visibilityCommitted('/requester/r_request'), '');
  android.begin('order-two', '/requester/r_request');
  android.cancel();
  assert.equal(android.visibilityCommitted('/requester/r_request'), '');
});

test('close and reopen reuse an in-flight request and frozen uncertain retry for the same requester and attempt', async () => {
  const sent = [];
  let failFirst;
  let reads = 0;
  let ids = 0;
  const registry = createRequesterResponseRegistry({
    makeId: () => `mutation-${++ids}`,
    readReport: async () => { reads += 1; return report({ explanation: 'I was home and received no call.', submittedAt: '2026-10-20T13:00:00.000Z' }); },
    send: (payload) => {
      sent.push(payload);
      if (sent.length === 1) return new Promise((_, reject) => { failFirst = () => { const error = new Error('network uncertain'); error.uncertain = true; reject(error); }; });
      return Promise.resolve({ report: report({ explanation: payload.explanation, submittedAt: '2026-10-20T13:00:00.000Z' }) });
    },
  });
  const flow = registry.get('requester-one', 'order-one', attemptId);
  const first = flow.submit(attemptId, '  I was home   and received no call. ');
  assert.equal(flow.getState().inFlight, true);
  assert.equal(registry.get('requester-one', 'order-one', attemptId), flow); // Reopen while POST is in flight.
  assert.deepEqual(await registry.get('requester-one', 'order-one', attemptId).submit(attemptId, 'changed text'), { ignored: true });
  assert.equal(sent.length, 1);
  failFirst();
  await assert.rejects(first, /network uncertain/);
  assert.equal(registry.pendingAttemptId('requester-one', 'order-one'), attemptId);
  assert.deepEqual(flow.getState().pending, { explanation: 'I was home and received no call.', uncertain: true });
  assert.ok(!JSON.stringify(flow.getState()).includes('mutation-1'));
  assert.equal(flow.getState().confirmedReport, null);
  const replay = await registry.get('requester-one', 'order-one', attemptId).submit(attemptId, 'different after reopen');
  assert.equal(reads, 1); // Matching GET did not end the retry.
  assert.deepEqual(sent[1], sent[0]);
  assert.equal(ids, 1);
  assert.equal(replay.report.requesterResponseStatus, 'submitted');
  assert.equal(flow.getState().pending, null);
  assert.equal(registry.pendingAttemptId('requester-one', 'order-one'), '');
});

test('retry state is isolated by requester and attempt; confirmed conflict is never shown as saved', async () => {
  let ids = 0;
  const registry = createRequesterResponseRegistry({ makeId: () => `id-${++ids}`,
    readReport: async () => report(),
    send: async () => { const error = new Error(ids === 1 ? 'uncertain' : 'conflict');
      if (ids === 1) error.uncertain = true; else error.status = 409;
      throw error; },
  });
  const first = registry.get('requester-one', 'order-one', attemptId);
  await assert.rejects(first.submit(attemptId, 'I received no call.'), /uncertain/);
  const otherAttempt = registry.get('requester-one', 'order-one', 'b'.repeat(64));
  const otherUser = registry.get('requester-two', 'order-one', attemptId);
  assert.notEqual(first, otherAttempt);
  assert.notEqual(first, otherUser);
  assert.equal(otherAttempt.hasPending(), false);
  assert.equal(otherUser.hasPending(), false);
  await assert.rejects(otherAttempt.submit('b'.repeat(64), 'I received no call.'), (error) => error.status === 409);
  assert.equal(otherAttempt.getState().terminalConflict, true);
  assert.equal(otherAttempt.getState().confirmedReport, null);
  assert.equal(first.hasPending(), true);
  assert.equal(registry.pendingAttemptId('requester-two', 'order-one'), '');
});

test('dialog wiring preserves order actions, uses a stable owner, and has no handoff timer', () => {
  const dialog = read('components/RequesterDeliveryReportDialog.jsx');
  const details = read('components/RequestDetailsModal.jsx');
  const requests = read('app/requester/r_request.jsx');
  assert.match(dialog, /<ResponsiveActionDialog/);
  assert.match(dialog, /reportViewModel\(result\.report\)/);
  assert.match(dialog, /Distributor-claimed time \(unverified\)/);
  assert.match(dialog, /requesterResponseStatus === 'submitted'/);
  assert.match(dialog, /accessibilityLabel="Factual delivery response"/);
  assert.match(dialog, /minHeight: 44/);
  assert.match(details, /hasDeliveryReports \? \(/);
  assert.match(details, /View delivery reports/);
  assert.match(details, /onDismiss=\{onDismiss\}/);
  assert.match(requests, /onDismiss=\{finishReportHandoff\}/);
  assert.match(requests, /visibilityCommitted\(pathname\)/);
  assert.match(requests, /const requesterResponseRegistry = createRequesterResponseRegistry\(/);
  assert.ok(requests.indexOf('const requesterResponseRegistry') < requests.indexOf('export default function RequesterRequests'));
  assert.match(requests, /responseRegistry=\{requesterResponseRegistry\}/);
  assert.match(requests, /onEdit=\{liveSelectedRequest/);
  assert.match(requests, /onCancel=\{liveSelectedRequest/);
  assert.match(requests, /const reqToEdit = liveSelectedRequest;\s+reportHandoffRef\.current\.cancel\(\);/);
  assert.match(requests, /const reqToCancel = liveSelectedRequest;\s+reportHandoffRef\.current\.cancel\(\);/);
  assert.match(requests, /pendingRoute\(\) !== pathname/);
  assert.match(requests, /useEffect\(\(\) => \(\) => \{ reportHandoffRef\.current\.cancel\(\); \}, \[\]\)/);
  assert.doesNotMatch(requests, /reportTransitionTimerRef|setTimeout\(\(\) =>\s*setReportOrderId/);
  assert.doesNotMatch(dialog, /createRequesterResponseFlow\(/);
  assert.match(dialog, /canSubmitResponse\(selected\) \|\| pending/);
  assert.match(dialog, /busy=\{false\}/);
  assert.match(requests, /visible=\{!!reportOrderId && !!reportOwnerUid\}/);
});
