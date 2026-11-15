const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const { createManagerDeliveryReviewFlow, validDecisionReason } = require('../../../services/managerDeliveryReviewFlow');

const read = (file) => readFileSync(resolve(__dirname, '../../..', file), 'utf8');
const attemptId = 'a'.repeat(64);
const reason = 'The report and requester response support this factual decision.';
const review = (overrides = {}) => ({ attemptId, orderId: 'order-one', orderReference: 'REQ-001',
  reviewState: 'reported', responsibility: 'undetermined', revision: 'r'.repeat(43),
  canFinalizeNow: true, ...overrides });
const decision = (payload) => ({ attemptId: payload.attemptId, orderId: payload.orderId,
  responsibility: payload.responsibility, decisionReason: payload.decisionReason,
  reportingBranchId: 'branch-one', reviewState: 'resolved', decidedAt: '2026-10-23T12:00:00.000Z' });
const deferred = () => {
  let resolveValue;
  let rejectValue;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolveValue = resolvePromise;
    rejectValue = rejectPromise;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
};
const create = (api = {}, mutationId = () => 'decision_001') => {
  const flow = createManagerDeliveryReviewFlow({
    list: async () => ({ reviews: [], nextCursor: null }),
    detail: async () => ({ review: review() }),
    decide: async (payload) => ({ decision: decision(payload) }),
    ...api,
  }, mutationId);
  flow.setScope('manager-one:branch-one');
  return flow;
};

test('Approvals remain in the two-column Exceptions card with bounded failed-delivery rows and responsive modal', () => {
  const page = read('app/manager/request.jsx');
  const modal = read('components/ManagerDeliveryReview.jsx');
  const api = read('services/managerDeliveryReviews.js');
  assert.match(page, /<ReceivedRequestsQueue/);
  assert.match(page, /<OutsideRadiusApprovalQueue/);
  assert.match(page, /decideOutsideRadiusOrder\(order\.id, action\)/);
  assert.match(page, /\['approvals', 'Approvals'\], \['failed', 'Failed Deliveries'\]/);
  assert.match(page, /<ManagerDeliveryReviewList/);
  assert.match(page, /<EditOrderModal/);
  assert.match(page, /onDismiss=\{finishReviewHandoff\}/);
  assert.match(page, /Platform\.OS !== 'ios' && !modalVisible && pendingReviewRef\.current/);
  assert.match(page, /target\.scope !== reviewScope/);
  assert.match(modal, /maxHeight: 360/);
  assert.match(modal, /modalBody: \{ flex: 1, flexGrow: 1, flexShrink: 1 \}/);
  assert.match(modal, /footer: \{ flexDirection: width < 440 \? 'column-reverse' : 'row'/);
  assert.match(modal, /colors\.textPrimary/);
  assert.match(modal, /colors\.primaryAction/);
  assert.match(modal, /KeyboardAvoidingView/);
  assert.match(modal, /accessibilityRole="radio"/);
  assert.match(api, /state: 'reported', limit: '20'/);
  assert.doesNotMatch(api, /branchId.*params\.set|role.*params\.set/);
});

test('failed-delivery list paginates, deduplicates, handles empty cursor pages and errors', async () => {
  const calls = [];
  const pages = [
    { reviews: [review()], nextCursor: 'cursor-one' },
    { reviews: [review(), review({ attemptId: 'b'.repeat(64), orderId: 'order-two' })], nextCursor: 'cursor-two' },
    { reviews: [], nextCursor: 'cursor-three' },
  ];
  const flow = create({ list: async (cursor) => { calls.push(cursor); return pages.shift(); } });
  assert.equal(flow.getState().listLoaded, false);
  await flow.load();
  await flow.load({ more: true });
  await flow.load({ more: true });
  assert.deepEqual(calls, ['', 'cursor-one', 'cursor-two']);
  assert.equal(flow.getState().reviews.length, 2);
  assert.equal(flow.getState().nextCursor, 'cursor-three');
  const unavailable = create({ list: async () => { throw new Error('Service unavailable'); } });
  await unavailable.load();
  assert.match(unavailable.getState().listError, /Service unavailable/);
  assert.equal(unavailable.getState().reviews.length, 0);
});

test('account or branch switch discards stale list/detail data and unauthorized errors clear protected state', async () => {
  const waiting = deferred();
  const flow = create({ list: () => waiting.promise });
  const loading = flow.load();
  flow.setScope('manager-two:branch-two');
  waiting.resolve({ reviews: [review()], nextCursor: null });
  await loading;
  assert.equal(flow.getState().scope, 'manager-two:branch-two');
  assert.deepEqual(flow.getState().reviews, []);
  const invalid = create({ detail: async () => ({ review: review({ orderId: 'another-order' }) }) });
  await invalid.open(attemptId, 'order-one');
  assert.equal(invalid.getState().detail, null);
  assert.match(invalid.getState().detailError, /unavailable/);
  const denied = create({ detail: async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); } });
  await denied.open(attemptId, 'order-one');
  assert.equal(denied.getState().modalOpen, false);
  assert.equal(denied.getState().detail, null);
  assert.match(denied.getState().detailError, /Manager access changed/);
});

test('all four outcomes require a factual reason and honor server finalization eligibility', async () => {
  assert.equal(validDecisionReason('  '), false);
  assert.equal(validDecisionReason('a'.repeat(501)), false);
  assert.equal(validDecisionReason(reason), true);
  for (const responsibility of ['requester_responsible', 'provider_responsible', 'shared', 'undetermined']) {
    const sent = [];
    const flow = create({ decide: async (payload) => { sent.push(payload); return { decision: decision(payload) }; } });
    await flow.open(attemptId, 'order-one');
    flow.setDraft('responsibility', responsibility);
    await flow.submit();
    assert.equal(sent.length, 0);
    flow.setDraft('reason', reason);
    await flow.submit();
    assert.equal(sent.length, 1);
    assert.equal(flow.getState().success, 'Decision saved.');
    assert.equal(flow.getState().detail.reviewState, 'resolved');
  }
  let sent = 0;
  const early = create({ detail: async () => ({ review: review({ canFinalizeNow: false }) }),
    decide: async () => { sent += 1; } });
  await early.open(attemptId, 'order-one');
  early.setDraft('responsibility', 'shared');
  early.setDraft('reason', reason);
  await early.submit();
  assert.equal(sent, 0);
});

test('duplicate taps share one frozen submission; uncertain retry reuses ID and edited draft gets a new ID', async () => {
  const waiting = deferred();
  const sent = [];
  let sequence = 0;
  const flow = create({ decide: (payload) => { sent.push(payload); return sent.length === 1 ? waiting.promise
    : Promise.resolve({ decision: decision(payload) }); } },
  () => `decision_${++sequence}`);
  await flow.open(attemptId, 'order-one');
  flow.setDraft('responsibility', 'shared');
  flow.setDraft('reason', reason);
  const first = flow.submit();
  await flow.submit();
  assert.equal(sent.length, 1);
  flow.close();
  waiting.reject(Object.assign(new Error('Connection interrupted'), { uncertain: true }));
  await first;
  assert.equal(flow.getState().pending.clientMutationId, 'decision_1');
  await flow.open(attemptId, 'order-one');
  await flow.submit();
  assert.equal(sent[1], sent[0]);
  assert.equal(flow.getState().success, 'Decision saved.');

  const changed = create({ decide: async (payload) => { sent.push(payload); throw Object.assign(new Error('Timeout'), { uncertain: true }); } },
    () => `decision_${++sequence}`);
  await changed.open(attemptId, 'order-one');
  changed.setDraft('responsibility', 'shared');
  changed.setDraft('reason', reason);
  await changed.submit();
  const oldId = changed.getState().pending.clientMutationId;
  changed.setDraft('reason', `${reason} Additional evidence was reviewed.`);
  assert.equal(changed.getState().pending, null);
  await changed.submit();
  assert.notEqual(changed.getState().pending.clientMutationId, oldId);
});

test('409 refreshes exact detail, preserves unsent reason and never claims success', async () => {
  let reads = 0;
  const flow = create({ detail: async () => ({ review: review({ revision: `${++reads}`.padStart(43, 'r') }) }),
    decide: async () => { throw Object.assign(new Error('Changed'), { status: 409 }); } });
  await flow.open(attemptId, 'order-one');
  flow.setDraft('responsibility', 'provider_responsible');
  flow.setDraft('reason', reason);
  const oldRevision = flow.getState().detail.revision;
  await flow.submit();
  assert.equal(flow.getState().reason, reason);
  assert.notEqual(flow.getState().detail.revision, oldRevision);
  assert.equal(flow.getState().pending, null);
  assert.equal(flow.getState().success, '');
  assert.match(flow.getState().submitError, /review changed/);
});
