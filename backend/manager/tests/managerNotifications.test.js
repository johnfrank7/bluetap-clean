const test = require('node:test');
const assert = require('node:assert/strict');
const { getManagerNotifications, unreadManagerNotifications } = require('../../../services/managerNotifications');
const parse = (value) => value instanceof Date ? value : value?.seconds ? new Date(value.seconds * 1000) : value ? new Date(value) : null;
const at = '2026-09-27T02:00:00.000Z';

test('Manager notifications derive delivery, decline, transfer, and review events only for the own branch', () => {
  const own = { id: 'one', branchId: 'branch-a', initialBranchId: 'branch-a', requestId: 'BT-1', status: 'delivered', createdAt: at,
    distributorDeliveryHistory: [
      { event: 'ASSIGNMENT_ACCEPTED', branchId: 'branch-a', createdAt: at },
      { event: 'DELIVERY_COMPLETED', branchId: 'branch-a', createdAt: at },
    ], assignmentHistory: [{ event: 'ASSIGNMENT_DECLINED', declinedAt: at, declineReason: 'Unavailable' }] };
  const other = { id: 'two', branchId: 'branch-b', status: 'delivered', createdAt: at,
    distributorDeliveryHistory: [{ event: 'DELIVERY_COMPLETED', branchId: 'branch-b', createdAt: at }] };
  const incoming = { id: 'three', branchId: 'branch-b', transferToBranchId: 'branch-a', transferRequestId: 'transfer-1', status: 'branch_transfer_pending', transferRequestedAt: at };
  const decisions = [{ id: 'decision-a', sourceBranchId: 'branch-a', orderId: 'old', decision: 'accepted', decidedAt: at },
    { id: 'decision-b', sourceBranchId: 'branch-b', orderId: 'other', decision: 'declined', decidedAt: at }];
  const events = getManagerNotifications([own, other], [incoming], decisions, 'branch-a', parse);
  assert.ok(events.some((item) => item.id === 'one:delivery:1' && item.status === 'delivered'));
  assert.ok(events.some((item) => item.id === 'one:assignment-declined:0' && item.path === '/manager/distributors'));
  assert.ok(events.some((item) => item.id === 'three:incoming-transfer:transfer-1'));
  assert.ok(events.some((item) => item.id === 'transfer-decision:decision-a'));
  assert.ok(events.every((item) => !item.id.includes('two') && !item.id.includes('decision-b')));
  assert.equal(unreadManagerNotifications(events, new Set(events.map((item) => item.id))).length, 0);
  assert.equal(unreadManagerNotifications(events, new Set()).length, events.length);
});

test('Manager notifications skip invalid dates and do not render an invalid schedule event', () => {
  const events = getManagerNotifications([{ id: 'one', branchId: 'branch-a', status: 'scheduled', createdAt: 'invalid',
    distributorDeliveryHistory: [{ event: 'DELIVERY_SCHEDULED', branchId: 'branch-a', createdAt: at }] }], [], [], 'branch-a',
  (value) => { const date = parse(value); return date && !Number.isNaN(date.getTime()) ? date : null; });
  assert.deepEqual(events.map((item) => item.id), ['one:delivery:0']);
});
