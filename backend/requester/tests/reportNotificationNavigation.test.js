const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { canSubmitResponse, createReportModalHandoff, exactReportViewModel,
  loadExactReport, reportNotificationTarget, reportRouteTarget } = require('../../../services/requesterDeliveryReportFlow');
const { projectReportNotification } = require('../../../services/requesterReportNotifications');
const { createSingleFlightNavigation } = require('../../../services/navigationLock');

const root = path.resolve(__dirname, '../../..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
const dto = (attemptId = a, orderId = 'old-rescheduled-order') => ({
  attemptId, orderId, attemptNumber: attemptId === a ? 1 : 2,
  reportedStatus: 'reported_by_distributor', reportReceivedAt: '2026-10-23T01:00:00.000Z',
  reviewState: 'awaiting_review', requesterResponseStatus: 'not_submitted',
  reportedReasonLabel: 'Delivery could not be completed', contactAttempts: [],
  distributorUid: 'private-distributor', reportedReasonNote: 'private note',
});

test('notification target preserves exact order and attempt for multiple historical attempts', () => {
  const first = reportNotificationTarget(projectReportNotification(dto(a)));
  const second = reportNotificationTarget(projectReportNotification(dto(b)));
  assert.deepEqual(first, { orderId: 'old-rescheduled-order', attemptId: a });
  assert.deepEqual(second, { orderId: 'old-rescheduled-order', attemptId: b });
  assert.deepEqual(reportRouteTarget({ reportOrderId: first.orderId, reportAttemptId: first.attemptId }), first);
  assert.ok(fs.existsSync(path.join(root, 'app/requester/r_request.jsx')));
  assert.equal(Object.keys(first).length, 2);
});

test('forged or incomplete notification and route targets fail closed', () => {
  const valid = projectReportNotification(dto());
  for (const event of [null, { ...valid, id: `delivery-report:${b}` },
    { ...valid, kind: 'moderation' }, { ...valid, status: 'warning' },
    { ...valid, orderId: 'other/order' }, { ...valid, attemptId: 'short' }]) {
    assert.equal(reportNotificationTarget(event), null);
  }
  assert.equal(reportRouteTarget({ orderId: 'ordinary-order-detail' }), null);
  for (const params of [
    { reportOrderId: 'old-rescheduled-order' },
    { reportAttemptId: a },
    { reportOrderId: ['old-rescheduled-order'], reportAttemptId: a },
    { reportOrderId: 'other/order', reportAttemptId: a },
    { reportOrderId: '..', reportAttemptId: a },
    { reportOrderId: 'old-rescheduled-order', reportAttemptId: b.slice(1) },
  ]) assert.deepEqual(reportRouteTarget(params), { invalid: true });
});

test('exact detail rejects another attempt or order and exposes only sanitized response fields', () => {
  const target = { orderId: 'old-rescheduled-order', attemptId: b };
  assert.equal(exactReportViewModel(dto(a), target), null);
  assert.equal(exactReportViewModel(dto(b, 'another-order'), target), null);
  assert.equal(exactReportViewModel({ ...dto(b), reportedStatus: 'verified_fault' }, target), null);
  const exact = exactReportViewModel(dto(b), target);
  assert.equal(exact.attemptNumber, 2);
  assert.equal(exact.attemptId, b);
  assert.equal(exact.orderId, target.orderId);
  assert.equal(canSubmitResponse(exact), true);
  assert.ok(!JSON.stringify(exact).includes('private'));
});

test('exact detail loader ignores stale responses and never substitutes another attempt', async () => {
  const target = { orderId: 'old-rescheduled-order', attemptId: b };
  let finish;
  let current = true;
  const pending = loadExactReport(target, () => new Promise((resolve) => { finish = resolve; }), () => current);
  current = false; // Route changed or Requester account switched while the GET was in flight.
  finish({ report: dto(b) });
  assert.equal(await pending, null);
  assert.equal(await loadExactReport(target, async () => ({ report: dto(a) }), () => true), null);
  assert.equal((await loadExactReport(target, async (attemptId, orderId) => {
    assert.equal(attemptId, b);
    assert.equal(orderId, target.orderId);
    return { report: dto(b) };
  }, () => true)).attemptId, b);
  await assert.rejects(loadExactReport(target, async () => {
    const error = new Error('not found'); error.status = 404; throw error;
  }, () => true), (error) => error.status === 404);
});

test('single-flight route action suppresses rapid duplicate report presses', () => {
  const navigation = createSingleFlightNavigation();
  const calls = [];
  const target = { pathname: '/requester/r_request', params: { reportOrderId: 'old-rescheduled-order', reportAttemptId: b } };
  const action = (destination) => calls.push(destination);
  assert.equal(navigation.navigate({ currentPath: '/requester/r_notification', target, action }), true);
  assert.equal(navigation.navigate({ currentPath: '/requester/r_notification', target, action }), false);
  assert.deepEqual(calls, [target]);
  assert.equal(navigation.settle('/requester/r_request'), true);
  navigation.dispose();
});

test('existing handoff permits the exact report dialog only after details dismiss on iOS/web or render-commit on Android', () => {
  for (const platform of ['ios', 'web']) {
    const handoff = createReportModalHandoff(platform);
    assert.equal(handoff.begin('old-rescheduled-order', '/requester/r_request'), true);
    assert.equal(handoff.begin('other-order', '/requester/r_request'), false);
    assert.equal(handoff.visibilityCommitted('/requester/r_request'), '');
    assert.equal(handoff.dismissed('/requester/r_request'), 'old-rescheduled-order');
    assert.equal(handoff.dismissed('/requester/r_request'), '');
  }
  const android = createReportModalHandoff('android');
  assert.equal(android.begin('old-rescheduled-order', '/requester/r_request'), true);
  assert.equal(android.dismissed('/requester/r_request'), '');
  assert.equal(android.visibilityCommitted('/requester/r_request'), 'old-rescheduled-order');
  assert.equal(android.visibilityCommitted('/requester/r_request'), '');
});

test('route wiring uses protected exact detail, clears stale navigation, and retains unrelated notification actions', () => {
  const notification = source('app/requester/r_notification.jsx');
  const requests = source('app/requester/r_request.jsx');
  const dialog = source('components/RequesterDeliveryReportDialog.jsx');
  assert.match(notification, /reportNotificationTarget\(entry\.item\)/);
  assert.match(notification, /markSeen\(\[entry\.item\.id\]\);\s+navigateOnce\(\{ pathname: '\/requester\/r_request'/);
  assert.match(notification, /reportOrderId: target\.orderId, reportAttemptId: target\.attemptId/);
  assert.match(notification, /openNotice\(entry\.item\.noticeId\)/);
  assert.match(notification, /setSelectedOrderId\(entry\.item\.orderId\)/);
  assert.match(requests, /reportRouteTarget\(params\)/);
  assert.match(requests, /reportTargetAttemptRef\.current = target\.attemptId/);
  assert.match(requests, /reportHandoffRef\.current\.begin\(target\.orderId, pathname\)/);
  assert.match(requests, /visible=\{!!reportOrderId && !!reportOwnerUid\}/);
  assert.match(requests, /targetAttemptId=\{reportTargetAttemptId\}/);
  assert.match(requests, /openedReportTargetRef\.current = ''/);
  assert.match(dialog, /loadExactReport\(\{ orderId, attemptId: targetAttemptId \}/);
  assert.match(dialog, /fetchRequesterDeliveryReport,/);
  assert.match(dialog, /requestEpochRef\.current !== epoch/);
  assert.match(dialog, /auth\.currentUser\?\.uid !== requestOwnerUid/);
  assert.match(dialog, /Order reference: \{selected\.orderId\}/);
  assert.match(dialog, /responseRegistry\.get\(ownerUid, orderId, selectedId\)/);
  assert.ok(!notification.includes('reportedReasonNote'));
  assert.ok(!notification.includes('clientMutationId'));
  assert.ok(!dialog.includes('firebase/firestore'));
  assert.ok(!requests.includes('firebase/firestore'));
});
