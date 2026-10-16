const assert = require('node:assert/strict');
const test = require('node:test');
const {
  getManagerQueues,
  getOngoingDeliveryProgress,
  isCompletedManagerOrder,
  isOngoingAssignedOrder,
  isPendingManagerOrder,
  pendingBranchApplications,
  toManagerOrder,
} = require('../../../services/managerOperational');

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

test('ongoing requests monitor tracks assigned deliveries across lifecycle and excludes pending, terminal, and unrelated-branch records', () => {
  const orders = [
    { id: 'pending-review', branchId: 'north', status: 'pending' },
    { id: 'unassigned-dispatch', branchId: 'north', status: 'awaiting_distributor_assignment' },
    { id: 'assigned-new', branchId: 'north', status: 'distributor_assigned', assignedDistributorUid: 'dist-1', updatedAt: new Date('2026-03-01T08:00:00Z') },
    { id: 'accepted-dist', branchId: 'north', status: 'accepted', assignedDistributorUid: 'dist-1', updatedAt: new Date('2026-03-01T09:00:00Z') },
    { id: 'scheduled-dist', branchId: 'north', status: 'scheduled', assignedDistributorUid: 'dist-2', updatedAt: new Date('2026-03-01T10:00:00Z') },
    { id: 'out-for-delivery', branchId: 'north', status: 'out_for_delivery', assignedDistributorUid: 'dist-2', updatedAt: new Date('2026-03-01T11:00:00Z') },
    { id: 'failed-delivery', branchId: 'north', status: 'delivery_failed', assignedDistributorUid: 'dist-2', updatedAt: new Date('2026-03-01T11:30:00Z') },
    { id: 'delivered-done', branchId: 'north', status: 'delivered', assignedDistributorUid: 'dist-1', updatedAt: new Date('2026-03-01T12:00:00Z') },
    { id: 'cancelled-order', branchId: 'north', status: 'cancelled' },
    { id: 'other-branch-ongoing', branchId: 'south', status: 'out_for_delivery', assignedDistributorUid: 'dist-9' },
  ];

  const queues = getManagerQueues(orders, [], 'north');
  assert.equal(queues.ongoingCount, 5);
  assert.deepEqual(
    queues.ongoing.map((o) => o.id),
    ['out-for-delivery', 'failed-delivery', 'scheduled-dist', 'accepted-dist', 'assigned-new']
  );
  assert.deepEqual(
    queues.pendingOrders.map((o) => o.id),
    ['pending-review', 'unassigned-dispatch']
  );
  assert.deepEqual(
    queues.completed.map((o) => o.id),
    ['delivered-done', 'cancelled-order']
  );

  // Branch security check: other branch order is rejected even if status & distributor match
  assert.equal(isOngoingAssignedOrder(orders[9], 'north'), false);
  assert.equal(isOngoingAssignedOrder(orders[9], 'south'), true);
  assert.equal(isPendingManagerOrder(orders[0]), true);
  assert.equal(isCompletedManagerOrder(orders[7]), true);
  assert.equal(isCompletedManagerOrder(orders[8]), true);
});

test('getOngoingDeliveryProgress maps linear milestones and flags delivery_failed as an exception', () => {
  const assignedProgress = getOngoingDeliveryProgress({ status: 'distributor_assigned' });
  assert.equal(assignedProgress.isException, false);
  assert.equal(assignedProgress.linearSupported, true);
  assert.equal(assignedProgress.activeStepIndex, 0);
  assert.equal(assignedProgress.steps[0].current, true);
  assert.equal(assignedProgress.steps[1].upcoming, true);

  const scheduledProgress = getOngoingDeliveryProgress({ status: 'scheduled' });
  assert.equal(scheduledProgress.activeStepIndex, 1);
  assert.equal(scheduledProgress.steps[0].completed, true);
  assert.equal(scheduledProgress.steps[1].current, true);

  const outProgress = getOngoingDeliveryProgress({ status: 'out_for_delivery' });
  assert.equal(outProgress.activeStepIndex, 2);
  assert.equal(outProgress.steps[0].completed, true);
  assert.equal(outProgress.steps[1].completed, true);
  assert.equal(outProgress.steps[2].current, true);

  const failedProgress = getOngoingDeliveryProgress({ status: 'delivery_failed' });
  assert.equal(failedProgress.isException, true);
  assert.equal(failedProgress.linearSupported, false);
  assert.equal(failedProgress.activeStepIndex, -1);
});

test('toManagerOrder enriches assigned distributor name, public ID, schedule, and product summary from branch users', () => {
  const branchUsers = [
    { uid: 'dist-42', fullName: 'Marco Reyes', publicUid: 'DIS-0042', role: 'distributor' },
  ];
  const normalized = toManagerOrder(
    'ord-99',
    {
      requestId: 'BT-9901',
      requesterNameSnapshot: 'Elena Cruz',
      requesterUniqueIdSnapshot: 'REQ-0105',
      assignedDistributorUid: 'dist-42',
      status: 'out_for_delivery',
      container: 'Slim 5-Gallon',
      scheduledDate: '2026-10-17',
      scheduledWindow: 'Morning (8AM - 12PM)',
      items: [
        { productNameSnapshot: 'Purified Water 5G', quantity: 3 },
        { productNameSnapshot: 'Alkaline Water 5G', quantity: 1 },
      ],
    },
    'North Station',
    branchUsers
  );

  assert.equal(normalized.assignedDistributorName, 'Marco Reyes');
  assert.equal(normalized.assignedDistributorUniqueId, 'DIS-0042');
  assert.equal(normalized.distributorUniqueId, 'DIS-0042');
  assert.equal(normalized.totalQuantity, 4);
  assert.equal(normalized.container, 'Slim 5-Gallon');
  assert.equal(normalized.scheduledDate, '2026-10-17');
  assert.equal(normalized.scheduledWindow, 'Morning (8AM - 12PM)');
  assert.match(normalized.productSummary, /Purified Water 5G x3/);
});
