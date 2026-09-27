const assert = require('node:assert/strict');
const test = require('node:test');
const { getManagerQueues, pendingBranchApplications, toManagerOrder } = require('../../../services/managerOperational');

test('Manager review and dispatch badges follow branch-scoped lifecycle actions', () => {
  const orders = [
    { id: 'new', branchId: 'north', status: 'pending' },
    { id: 'exception', branchId: 'north', status: 'outside_radius_pending_approval' },
    { id: 'accepted', branchId: 'north', status: 'awaiting_distributor_assignment' },
    { id: 'declined', branchId: 'north', status: 'awaiting_distributor_assignment', assignmentHistory: [{ event: 'ASSIGNMENT_DECLINED' }] },
    { id: 'assigned', branchId: 'north', status: 'distributor_assigned', assignedDistributorUid: 'driver' },
    { id: 'failed', branchId: 'north', status: 'delivery_failed', assignedDistributorUid: 'driver' },
    { id: 'rejected', branchId: 'north', status: 'rejected' },
    { id: 'other', branchId: 'south', status: 'pending' },
  ];
  const incoming = [{ id: 'transfer', transferToBranchId: 'north', status: 'branch_transfer_pending' }];
  const before = getManagerQueues(orders, incoming, 'north');
  assert.deepEqual(before.review.map((order) => order.id), ['new']);
  assert.deepEqual(before.dispatch.map((order) => order.id), ['accepted', 'declined', 'failed']);
  assert.equal(before.requestsCount, 3);
  assert.equal(before.dispatchCount, 3);
  const after = getManagerQueues(orders.map((order) => order.id === 'new'
    ? { ...order, status: 'awaiting_distributor_assignment' } : order), incoming, 'north');
  assert.equal(after.requestsCount, 2);
  assert.equal(after.dispatchCount, 4);
  const assigned = getManagerQueues(orders.map((order) => order.id === 'accepted'
    ? { ...order, status: 'distributor_assigned', assignedDistributorUid: 'driver' } : order), incoming, 'north');
  assert.equal(assigned.dispatchCount, 2);
});

test('pending applications use requested branch only for read-only application visibility', () => {
  const users = [
    { id: 'own', role: 'distributor', requestedBranchId: 'north', distributorStatus: 'pending' },
    { id: 'other', role: 'distributor', requestedBranchId: 'south', distributorStatus: 'pending' },
    { id: 'approved', role: 'distributor', requestedBranchId: 'north', distributorStatus: 'active' },
  ];
  assert.deepEqual(pendingBranchApplications(users, 'north').map((item) => item.id), ['own']);
});

test('realtime order snapshots normalize legacy names and public IDs for Manager cards', () => {
  const order = toManagerOrder('one', { request_id: 'BT1', requester_name: 'Sam', requester_unique_id: 'Req001',
    total_cost: 100, items: [{ product_name: 'Refill', quantity: 2 }], status: 'Pending' });
  assert.equal(order.requestId, 'BT1');
  assert.equal(order.requesterUniqueId, 'Req001');
  assert.equal(order.items[0].productNameSnapshot, 'Refill');
  assert.equal(order.status, 'pending');
});

test('dispatch FIFO follows ready time through edits and realtime refreshes', () => {
  const earlier = { id: 'earlier', branchId: 'north', status: 'awaiting_distributor_assignment', dispatchReadyAt: new Date('2026-01-01T01:00:00Z'), updatedAt: new Date('2026-01-10T00:00:00Z') };
  const later = { id: 'later', branchId: 'north', status: 'awaiting_distributor_assignment', dispatchReadyAt: new Date('2026-01-01T02:00:00Z'), updatedAt: new Date('2026-01-01T02:00:00Z') };
  assert.deepEqual(getManagerQueues([later, earlier], [], 'north').dispatch.map((order) => order.id), ['earlier', 'later']);
  assert.deepEqual(getManagerQueues([{ ...later, updatedAt: new Date('2026-01-11T00:00:00Z') }, { ...earlier, updatedAt: new Date('2026-01-12T00:00:00Z') }], [], 'north').dispatch.map((order) => order.id), ['earlier', 'later']);
});
