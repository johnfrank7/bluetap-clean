const assert = require('node:assert/strict');
const test = require('node:test');
const { projectReportNotification, projectReportPage, mergeReportPages } = require('../../../services/requesterReportNotifications');

const id = (letter) => letter.repeat(64);
const dto = (attemptId, orderId = 'order-one', time = '2026-10-23T01:00:00.000Z') => ({
  attemptId, orderId, attemptNumber: 1, reportedStatus: 'reported_by_distributor',
  reportReceivedAt: time, reviewState: 'awaiting_review',
  reportedReasonLabel: 'Private reason', reportedReasonNote: 'Private note',
  contactAttempts: [{ method: 'Phone call', outcome: 'No answer' }],
  distributorUid: 'private-staff', outcomeMutationId: 'private-mutation',
  moderationIncident: { secret: 'private moderation' },
});

test('report projection creates one neutral immutable-identity event from safe fields only', () => {
  const first = projectReportNotification(dto(id('a')));
  const second = projectReportNotification(dto(id('b')));
  assert.equal(first.id, `delivery-report:${id('a')}`);
  assert.equal(first.kind, 'delivery_report');
  assert.equal(first.status, 'delivery_report');
  assert.equal(first.title, 'Delivery report');
  assert.equal(first.message, 'A delivery issue was reported for your order. You can review the details and share your response.');
  assert.equal(first.reviewLabel, 'Awaiting review');
  assert.equal(first.orderId, 'order-one');
  assert.equal(first.attemptId, id('a'));
  assert.equal(first.at.toISOString(), '2026-10-23T01:00:00.000Z');
  assert.notEqual(first.id, second.id);
  for (const privateValue of ['Private reason', 'Private note', 'Phone call', 'private-staff', 'private-mutation', 'private moderation']) {
    assert.ok(!JSON.stringify(first).includes(privateValue));
  }
  assert.ok(!JSON.stringify(first).includes('responsibility'));
  assert.ok(!JSON.stringify(first).includes('unread'));
});

test('projection rejects missing identity, missing server time, invalid status, and fabricated legacy data', () => {
  const valid = dto(id('a'));
  for (const field of ['attemptId', 'orderId', 'attemptNumber', 'reportedStatus', 'reportReceivedAt']) {
    assert.equal(projectReportNotification({ ...valid, [field]: undefined }), null, field);
  }
  assert.equal(projectReportNotification({ ...valid, reportReceivedAt: 'yesterday' }), null);
  assert.equal(projectReportNotification({ ...valid, orderId: 'other/order' }), null);
  assert.equal(projectReportNotification({ ...valid, reportedStatus: 'verified_requester_fault' }), null);
  assert.equal(projectReportNotification({ ...valid, reviewState: 'status_unavailable' }).reviewLabel, undefined);
  assert.equal(projectReportNotification({ status: 'delivery_failed', id: 'legacy-order' }), null);
});

test('bounded pages preserve server order, deduplicate overlap, and distinguish loaded pages from history', () => {
  const newest = dto(id('c'), 'order-one', '2026-10-23T03:00:00.000Z');
  const middle = dto(id('b'), 'order-one', '2026-10-23T02:00:00.000Z');
  const oldest = dto(id('a'), 'order-one', '2026-10-23T01:00:00.000Z');
  const first = projectReportPage({ reports: [newest, middle, middle], nextCursor: id('b') });
  assert.deepEqual(first.events.map((event) => event.attemptId), [id('c'), id('b')]);
  assert.equal(first.nextCursor, id('b'));
  assert.equal(first.hasMore, true);
  assert.equal(first.historyComplete, false);
  assert.equal(first.scope, 'loaded-report-pages');
  const second = projectReportPage({ reports: [middle, oldest], nextCursor: null });
  const merged = mergeReportPages(first, second);
  assert.deepEqual(merged.events.map((event) => event.attemptId), [id('c'), id('b'), id('a')]);
  assert.equal(merged.nextCursor, null);
  assert.equal(merged.historyComplete, true);
  assert.equal(merged.hasMore, false);
  assert.ok(!Object.hasOwn(merged, 'unreadTotal'));
  assert.equal(projectReportPage({ reports: [], nextCursor: id('d') }).historyComplete, false);
  assert.equal(projectReportPage({ reports: [], nextCursor: 'x'.repeat(129) }).nextCursor.length, 129);
  assert.equal(projectReportPage({ reports: Array.from({ length: 26 }, () => newest), nextCursor: null }), null);
  assert.equal(projectReportPage({ reports: [], nextCursor: 'bad/cursor' }), null);
  assert.equal(projectReportPage({ reports: [], nextCursor: 'x'.repeat(1501) }), null);
});
