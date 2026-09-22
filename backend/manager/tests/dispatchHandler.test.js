const assert = require('node:assert/strict');
const test = require('node:test');

const { createDistributorAssignedOrdersHandler } = require('../../distributor/assignedOrdersHandler');
const { createManagerDispatchHandler } = require('../dispatchHandler');

function fixture() {
  const records = new Map([
    ['branches/branch-a', { name: 'Branch A', status: 'active', latitude: 10.267, longitude: 123.584, serviceRadiusKm: 5 }],
    ['branches/branch-b', { name: 'Branch B', status: 'active', latitude: 10.31, longitude: 123.63, serviceRadiusKm: 10 }],
    ['branches/branch-c', { name: 'Branch C', status: 'active', latitude: 10.32, longitude: 123.65, serviceRadiusKm: 5 }],
    ['users/manager-a', { role: 'manager', managerStatus: 'active', branchId: 'branch-a', fullName: 'Manager A' }],
    ['users/manager-b', { role: 'manager', managerStatus: 'active', branchId: 'branch-b', fullName: 'Manager B' }],
    ['users/manager-c', { role: 'manager', managerStatus: 'active', branchId: 'branch-c', fullName: 'Manager C' }],
    ['users/distributor-a', { role: 'distributor', approvalStatus: 'active', branchId: 'branch-a', fullName: 'Distributor A' }],
    ['users/distributor-a2', { role: 'distributor', approvalStatus: 'active', branchId: 'branch-a', fullName: 'Distributor A2' }],
    ['users/distributor-b', { role: 'distributor', approvalStatus: 'active', branchId: 'branch-b', fullName: 'Distributor B' }],
    ['users/distributor-inactive', { role: 'distributor', approvalStatus: 'inactive', branchId: 'branch-a', fullName: 'Inactive Distributor' }],
    ['requests/order-a', { requestId: 'BT-A', requester_id: 'requester-1', requesterNameSnapshot: 'Requester A', requesterUniqueIdSnapshot: 'REQ-001', contactNumberSnapshot: '09123456789', container: 'Exchange container', branchId: 'branch-a', currentBranchId: 'branch-a', initialBranchId: 'branch-a', branchNameSnapshot: 'Branch A', status: 'awaiting_distributor_assignment', deliveryLocation: { latitude: 10.29, longitude: 123.6 }, distanceKmSnapshot: 5.2, serviceRadiusKmSnapshot: 5, items: [{ productNameSnapshot: 'Refill', quantity: 2, totalAtOrder: 70 }], totalAtOrder: 70 }],
    ['requests/order-b', { requestId: 'BT-B', requester_id: 'requester-2', requesterNameSnapshot: 'Requester B', branchId: 'branch-b', currentBranchId: 'branch-b', initialBranchId: 'branch-b', branchNameSnapshot: 'Branch B', status: 'awaiting_distributor_assignment' }],
    ['requests/order-decline', { requestId: 'BT-D', requester_id: 'requester-3', requesterNameSnapshot: 'Requester Decline', branchId: 'branch-a', currentBranchId: 'branch-a', initialBranchId: 'branch-a', branchNameSnapshot: 'Branch A', status: 'awaiting_distributor_assignment' }],
  ]);
  const authUsers = new Map([
    ['manager-a', { disabled: false }], ['manager-b', { disabled: false }], ['manager-c', { disabled: false }],
    ['distributor-a', { disabled: false }], ['distributor-a2', { disabled: false }], ['distributor-b', { disabled: false }], ['distributor-inactive', { disabled: true }],
  ]);
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const collection = (name) => ({
    doc(id) { const path = `${name}/${id}`; return { id, path, get: async () => snapshot(path), set: async (data) => records.set(path, data), update: async (data) => records.set(path, { ...records.get(path), ...data }) }; },
    where(field, operator, value) { return { async get() { return { docs: [...records.entries()].filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value).map(([path]) => snapshot(path)) }; } }; },
    async get() { return { docs: [...records.keys()].filter((path) => path.startsWith(`${name}/`)).map(snapshot) }; },
  });
  const db = { collection, async runTransaction(run) { return run({ get: async (ref) => ref.get(), set(ref, data) { records.set(ref.path, data); }, update(ref, data) { records.set(ref.path, { ...records.get(ref.path), ...data }); } }); } };
  const auth = {
    async verifyIdToken(token) {
      const mapping = { 'manager-a-token': 'manager-a', 'manager-b-token': 'manager-b', 'manager-c-token': 'manager-c', 'distributor-a-token': 'distributor-a', 'distributor-a2-token': 'distributor-a2', 'distributor-b-token': 'distributor-b' };
      const uid = mapping[token]; if (!uid) throw new Error('bad token');
      return { uid, role: uid.startsWith('manager') ? 'manager' : 'distributor', ...(uid.startsWith('manager') ? { manager: true } : {}) };
    },
    async getUser(uid) { return authUsers.get(uid) || { disabled: true }; },
  };
  return { records, authUsers, getAdmin: () => ({ auth, db }) };
}

function response() { return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } }; }
async function call(handler, method, token, body) { const res = response(); await handler({ method, headers: { authorization: `Bearer ${token}` }, body }, res); return res; }

test('current owning Branch Manager can assign and reassign only eligible same-branch Distributors', async () => {
  const f = fixture(); const handler = createManagerDispatchHandler(f.getAdmin);
  const managerA = await call(handler, 'GET', 'manager-a-token'); const managerB = await call(handler, 'GET', 'manager-b-token');
  assert.deepEqual(managerA.body.orders.map((order) => order.id).sort(), ['order-a', 'order-decline']);
  assert.deepEqual(managerB.body.orders.map((order) => order.id), ['order-b']);
  assert.equal((await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-a', action: 'assign-distributor', distributorUid: 'distributor-b' })).statusCode, 409);
  assert.equal((await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-a', action: 'assign-distributor', distributorUid: 'distributor-inactive' })).statusCode, 409);
  const assigned = await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-a', action: 'assign-distributor', distributorUid: 'distributor-a' });
  assert.equal(assigned.statusCode, 200); assert.equal(assigned.body.order.status, 'distributor_assigned'); assert.equal(f.records.get('requests/order-a').assignedDistributorUid, 'distributor-a');
  const reassigned = await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-a', action: 'reassign-distributor', distributorUid: 'distributor-a2' });
  assert.equal(reassigned.statusCode, 200); assert.equal(f.records.get('requests/order-a').assignedDistributorUid, 'distributor-a2'); assert.equal(f.records.get('requests/order-a').assignmentHistory.length, 2);
});

test('assigned Distributor receives only their own current-branch delivery', async () => {
  const f = fixture(); const dispatch = createManagerDispatchHandler(f.getAdmin); const distributor = createDistributorAssignedOrdersHandler(f.getAdmin);
  await call(dispatch, 'PATCH', 'manager-a-token', { orderId: 'order-a', action: 'assign-distributor', distributorUid: 'distributor-a' });
  const own = await call(distributor, 'GET', 'distributor-a-token'); const unrelated = await call(distributor, 'GET', 'distributor-b-token');
  assert.deepEqual(own.body.orders.map((order) => order.id), ['order-a']); assert.equal(own.body.orders[0].deliveryLocation.latitude, 10.29); assert.equal(own.body.orders[0].requesterUniqueId, 'REQ-001'); assert.equal(own.body.orders[0].container, 'Exchange container'); assert.deepEqual(unrelated.body.orders, []);
});

test('Distributor delivery scheduling and status changes are server-owned and assignment-scoped', async () => {
  const f = fixture(); const dispatch = createManagerDispatchHandler(f.getAdmin); const distributor = createDistributorAssignedOrdersHandler(f.getAdmin);
  await call(dispatch, 'PATCH', 'manager-a-token', { orderId: 'order-a', action: 'assign-distributor', distributorUid: 'distributor-a' });
  const scheduledAt = new Date(Date.now() + (60 * 60 * 1000)).toISOString();
  const scheduled = await call(distributor, 'PATCH', 'distributor-a-token', { orderId: 'order-a', action: 'schedule-delivery', scheduledAt });
  assert.equal(scheduled.statusCode, 200); assert.equal(scheduled.body.order.status, 'scheduled'); assert.equal(f.records.get('requests/order-a').status, 'scheduled');
  assert.equal((await call(distributor, 'PATCH', 'distributor-b-token', { orderId: 'order-a', action: 'start-delivery' })).statusCode, 404);
  const started = await call(distributor, 'PATCH', 'distributor-a-token', { orderId: 'order-a', action: 'start-delivery' });
  assert.equal(started.statusCode, 200); assert.equal(started.body.order.status, 'out_for_delivery');
  const delivered = await call(distributor, 'PATCH', 'distributor-a-token', { orderId: 'order-a', action: 'mark-delivered' });
  assert.equal(delivered.statusCode, 200); assert.equal(delivered.body.order.status, 'delivered');
  assert.deepEqual(f.records.get('requests/order-a').distributorDeliveryHistory.map((entry) => entry.event), ['DELIVERY_SCHEDULED', 'DELIVERY_STARTED', 'DELIVERY_COMPLETED']);
});

test('transfer requires target review, changes ownership only on acceptance, and preserves assignment and transfer history', async () => {
  const f = fixture(); const handler = createManagerDispatchHandler(f.getAdmin);
  await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-a', action: 'assign-distributor', distributorUid: 'distributor-a' });
  const requested = await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-a', action: 'request-transfer', targetBranchId: 'branch-b', transferReason: 'Closer delivery coverage.' });
  assert.equal(requested.statusCode, 200); assert.equal(f.records.get('requests/order-a').status, 'branch_transfer_pending'); assert.equal(f.records.get('requests/order-a').assignedDistributorUid, null);
  const targetQueue = await call(handler, 'GET', 'manager-b-token'); const sourceQueue = await call(handler, 'GET', 'manager-a-token');
  assert.deepEqual(targetQueue.body.incomingTransfers.map((order) => order.id), ['order-a']); assert.equal(sourceQueue.body.incomingTransfers.length, 0);
  assert.equal((await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-a', action: 'accept-transfer' })).statusCode, 403);
  const accepted = await call(handler, 'PATCH', 'manager-b-token', { orderId: 'order-a', action: 'accept-transfer' });
  assert.equal(accepted.statusCode, 200); assert.equal(f.records.get('requests/order-a').branchId, 'branch-b'); assert.equal(f.records.get('requests/order-a').currentBranchId, 'branch-b');
  assert.equal((await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-a', action: 'assign-distributor', distributorUid: 'distributor-a2' })).statusCode, 403);
  assert.equal((await call(handler, 'PATCH', 'manager-b-token', { orderId: 'order-a', action: 'assign-distributor', distributorUid: 'distributor-b' })).statusCode, 200);
  assert.ok(f.records.get('requests/order-a').transferHistory.some((entry) => entry.event === 'BRANCH_TRANSFER_ACCEPTED')); assert.ok(f.records.get('requests/order-a').assignmentHistory.length >= 3);
  const secondTransfer = await call(handler, 'PATCH', 'manager-b-token', { orderId: 'order-a', action: 'request-transfer', targetBranchId: 'branch-c', transferReason: 'Closer Branch C coverage.' });
  assert.equal(secondTransfer.statusCode, 200); assert.equal(f.records.get('requests/order-a').transferFromBranchId, 'branch-b'); assert.equal(f.records.get('requests/order-a').transferToBranchId, 'branch-c'); assert.equal(f.records.get('requests/order-a').initialBranchId, 'branch-a');
  const secondTargetQueue = await call(handler, 'GET', 'manager-c-token'); assert.deepEqual(secondTargetQueue.body.incomingTransfers.map((order) => order.id), ['order-a']);
  assert.equal((await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-a', action: 'request-transfer', targetBranchId: 'branch-c', transferReason: 'No longer the owner.' })).statusCode, 403);
});

test('accepted transfers create one durable source-branch decision event that survives refresh and excludes target and unrelated Managers', async () => {
  const f = fixture(); const handler = createManagerDispatchHandler(f.getAdmin);
  assert.equal((await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-a', action: 'request-transfer', targetBranchId: 'branch-b', transferReason: 'Closer coverage.' })).statusCode, 200);
  assert.equal((await call(handler, 'PATCH', 'manager-b-token', { orderId: 'order-a', action: 'accept-transfer' })).statusCode, 200);
  const persisted = [...f.records.entries()].filter(([path]) => path.startsWith('managerOperationalEvents/'));
  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0][1], {
    event: 'BRANCH_TRANSFER_ACCEPTED', orderId: 'order-a', requestIdSnapshot: 'BT-A', sourceBranchId: 'branch-a', targetBranchId: 'branch-b', targetBranchNameSnapshot: 'Branch B', decidedAt: persisted[0][1].decidedAt, decision: 'accepted', transferRequestId: f.records.get('requests/order-a').transferRequestId, createdAt: persisted[0][1].createdAt,
  });
  const sourceFirstRead = await call(handler, 'GET', 'manager-a-token'); const sourceRefreshRead = await call(handler, 'GET', 'manager-a-token');
  assert.deepEqual(sourceFirstRead.body.sourceDecisionEvents, sourceRefreshRead.body.sourceDecisionEvents);
  assert.deepEqual(sourceFirstRead.body.sourceDecisionEvents.map((event) => ({ event: event.event, orderId: event.orderId, requestId: event.requestId, targetBranchName: event.targetBranchName, decision: event.decision })), [{ event: 'BRANCH_TRANSFER_ACCEPTED', orderId: 'order-a', requestId: 'BT-A', targetBranchName: 'Branch B', decision: 'accepted' }]);
  assert.deepEqual((await call(handler, 'GET', 'manager-b-token')).body.sourceDecisionEvents, []);
  assert.deepEqual((await call(handler, 'GET', 'manager-c-token')).body.sourceDecisionEvents, []);
  assert.equal((await call(handler, 'PATCH', 'manager-b-token', { orderId: 'order-a', action: 'accept-transfer' })).statusCode, 409);
  assert.equal([...f.records.keys()].filter((path) => path.startsWith('managerOperationalEvents/')).length, 1);
});

test('target Branch can decline a pending transfer while source Branch retains ownership and dispatch control', async () => {
  const f = fixture(); const handler = createManagerDispatchHandler(f.getAdmin);
  await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-decline', action: 'request-transfer', targetBranchId: 'branch-b', transferReason: 'Coverage review.' });
  const declined = await call(handler, 'PATCH', 'manager-b-token', { orderId: 'order-decline', action: 'decline-transfer', transferDeclineReason: 'No available route.' });
  assert.equal(declined.statusCode, 200); const saved = f.records.get('requests/order-decline');
  assert.equal(saved.branchId, 'branch-a'); assert.equal(saved.status, 'awaiting_distributor_assignment'); assert.equal(saved.transferDeclineReason, 'No available route.'); assert.ok(saved.transferHistory.some((entry) => entry.event === 'BRANCH_TRANSFER_DECLINED'));
  assert.equal((await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-decline', action: 'assign-distributor', distributorUid: 'distributor-a' })).statusCode, 200);
  assert.equal((await call(handler, 'PATCH', 'manager-c-token', { orderId: 'order-decline', action: 'assign-distributor', distributorUid: 'distributor-a2' })).statusCode, 403);
});

test('declined transfers create one durable source-branch decision event with the safe decline reason', async () => {
  const f = fixture(); const handler = createManagerDispatchHandler(f.getAdmin);
  assert.equal((await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-decline', action: 'request-transfer', targetBranchId: 'branch-b', transferReason: 'Coverage review.' })).statusCode, 200);
  assert.equal((await call(handler, 'PATCH', 'manager-b-token', { orderId: 'order-decline', action: 'decline-transfer', transferDeclineReason: 'No available route.' })).statusCode, 200);
  const sourceRead = await call(handler, 'GET', 'manager-a-token');
  assert.deepEqual(sourceRead.body.sourceDecisionEvents.map((event) => ({ event: event.event, orderId: event.orderId, requestId: event.requestId, targetBranchName: event.targetBranchName, decision: event.decision, declineReason: event.declineReason })), [{ event: 'BRANCH_TRANSFER_DECLINED', orderId: 'order-decline', requestId: 'BT-D', targetBranchName: 'Branch B', decision: 'declined', declineReason: 'No available route.' }]);
  assert.deepEqual((await call(handler, 'GET', 'manager-b-token')).body.sourceDecisionEvents, []);
  assert.deepEqual((await call(handler, 'GET', 'manager-c-token')).body.sourceDecisionEvents, []);
  assert.equal((await call(handler, 'PATCH', 'manager-b-token', { orderId: 'order-decline', action: 'decline-transfer', transferDeclineReason: 'Retry' })).statusCode, 409);
  assert.equal([...f.records.keys()].filter((path) => path.startsWith('managerOperationalEvents/')).length, 1);
});

test('a transfer target needs an active usable Manager, not only an active Branch record', async () => {
  const f = fixture(); const handler = createManagerDispatchHandler(f.getAdmin);
  f.authUsers.set('manager-b', { disabled: true });
  const requested = await call(handler, 'PATCH', 'manager-a-token', { orderId: 'order-a', action: 'request-transfer', targetBranchId: 'branch-b', transferReason: 'Closer delivery coverage.' });
  assert.equal(requested.statusCode, 409);
  assert.equal(requested.body.error.reason, 'TARGET_MANAGER_UNAVAILABLE');
});
