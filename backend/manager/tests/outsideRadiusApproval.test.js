const assert = require('node:assert/strict');
const test = require('node:test');

const { createOutsideRadiusApprovalsHandler } = require('../outsideRadiusApprovalHandler');

function fixture() {
  const records = new Map([
    ['users/manager-a', { role: 'manager', managerStatus: 'active', branchId: 'branch-a' }],
    ['users/manager-b', { role: 'manager', managerStatus: 'active', branchId: 'branch-b' }],
    ['branches/branch-a', { name: 'Branch A', status: 'active' }],
    ['branches/branch-b', { name: 'Branch B', status: 'active' }],
    ['requests/pending-a', { requestId: 'BT-A', requesterNameSnapshot: 'Nishi Requester', branchId: 'branch-a', outsideServiceArea: true, status: 'outside_radius_pending_approval', deliveryLocation: { latitude: 10.3, longitude: 123.6 }, addressSnapshot: 'Poblacion, Toledo City', distanceKmSnapshot: 7.2, serviceRadiusKmSnapshot: 5, items: [{ productNameSnapshot: 'Refill', quantity: 2, totalAtOrder: 70 }], totalAtOrder: 70 }],
    ['requests/pending-b', { requestId: 'BT-B', requesterNameSnapshot: 'Other Requester', branchId: 'branch-b', outsideServiceArea: true, status: 'outside_radius_pending_approval', distanceKmSnapshot: 8.1, serviceRadiusKmSnapshot: 5 }],
    ['requests/normal-a', { requestId: 'BT-N', branchId: 'branch-a', outsideServiceArea: false, status: 'Pending' }],
  ]);
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const collection = (name) => ({
    doc(id) {
      const path = `${name}/${id}`;
      return { id, path, get: async () => snapshot(path), update: async (data) => records.set(path, { ...records.get(path), ...data }) };
    },
    where(field, operator, value) {
      return { async get() { return { docs: [...records.entries()].filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value).map(([path]) => snapshot(path)) }; } };
    },
  });
  const auth = { async verifyIdToken(token) {
    if (token === 'manager-a-token') return { uid: 'manager-a', role: 'manager', manager: true };
    if (token === 'manager-b-token') return { uid: 'manager-b', role: 'manager', manager: true };
    throw new Error('bad token');
  } };
  return { records, getAdmin: () => ({ auth, db: { collection } }) };
}

function response() { return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } }; }
async function call(handler, method, token, body) { const res = response(); await handler({ method, headers: { authorization: `Bearer ${token}` }, body }, res); return res; }

test('only the assigned Manager can view and decide outside-radius requests for their branch', async () => {
  const f = fixture(); const handler = createOutsideRadiusApprovalsHandler(f.getAdmin);
  const list = await call(handler, 'GET', 'manager-a-token');
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.body.orders.map((order) => order.id), ['pending-a']);
  const unauthorized = await call(handler, 'PATCH', 'manager-b-token', { orderId: 'pending-a', action: 'approve' });
  assert.equal(unauthorized.statusCode, 403);
  assert.equal(f.records.get('requests/pending-a').status, 'outside_radius_pending_approval');
  const approved = await call(handler, 'PATCH', 'manager-a-token', { orderId: 'pending-a', action: 'approve' });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.order.status, 'awaiting_distributor_assignment');
  assert.equal(f.records.get('requests/pending-a').outsideRadiusReviewedByUid, 'manager-a');
});

test('assigned Manager can decline an awaiting outside-radius request exactly once', async () => {
  const f = fixture(); const handler = createOutsideRadiusApprovalsHandler(f.getAdmin);
  const declined = await call(handler, 'PATCH', 'manager-a-token', { orderId: 'pending-a', action: 'decline' });
  assert.equal(declined.statusCode, 200);
  assert.equal(declined.body.order.status, 'declined_outside_service_area');
  const replay = await call(handler, 'PATCH', 'manager-a-token', { orderId: 'pending-a', action: 'approve' });
  assert.equal(replay.statusCode, 409);
});
