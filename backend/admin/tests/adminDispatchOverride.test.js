const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdminDispatchOverrideHandler } = require('../adminDispatchOverrideHandler');
const { manilaScheduleDate, scheduledWeekday } = require('../../../services/productOrderPolicy');

function fixture() {
  const validDate = manilaScheduleDate(2, 13);
  const records = new Map([
    ['users/admin-a', { role: 'admin' }],
    ['users/distributor-a', { role: 'distributor', branchId: 'branch-a', distributorStatus: 'active', fullName: 'Ada Driver', publicUid: 'Dis001' }],
    ['users/distributor-b', { role: 'distributor', branchId: 'branch-b', distributorStatus: 'active', fullName: 'Wrong Branch' }],
    ['users/distributor-inactive', { role: 'distributor', branchId: 'branch-a', distributorStatus: 'inactive', fullName: 'Inactive Driver' }],
    ['users/distributor-disabled', { role: 'distributor', branchId: 'branch-a', distributorStatus: 'active', fullName: 'Disabled Driver' }],
    ['branches/branch-a', { name: 'Branch A', status: 'active' }],
    ['requests/order-a', { branchId: 'branch-a', currentBranchId: 'branch-a', status: 'awaiting_distributor_assignment', effectiveDeliveryDaysSnapshot: [scheduledWeekday(validDate)], items: [{ productId: 'refill', quantity: 1, deliveryDaysSnapshot: [scheduledWeekday(validDate)] }] }],
    ['requests/terminal', { branchId: 'branch-a', status: 'delivered' }],
  ]);
  const snap = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  let auditId = 0;
  const db = { collection(name) { return {
    doc(id) { const path = `${name}/${id}`; return { get: async () => snap(path), update: async (update) => records.set(path, { ...records.get(path), ...update }) }; },
    where(field, operator, value) { return { get: async () => ({ docs: [...records.keys()].filter((path) => path.startsWith(`${name}/`) && records.get(path)[field] === value).map(snap) }) }; },
    add: async (data) => { records.set(`${name}/audit-${++auditId}`, data); },
  }; } };
  const auth = { async verifyIdToken(token) { if (token === 'admin-token') return { uid: 'admin-a', role: 'admin', admin: true }; throw new Error('bad token'); }, async getUser(uid) { return { disabled: uid === 'distributor-disabled' }; } };
  return { records, validDate, handler: createAdminDispatchOverrideHandler(() => ({ auth, db })) };
}

async function call(handler, method, body, query = {}) {
  const res = { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
  await handler({ method, headers: { authorization: 'Bearer admin-token' }, body, query }, res);
  return res;
}

test('Admin override lists only eligible same-branch distributors and rejects terminal orders', async () => {
  const f = fixture();
  const result = await call(f.handler, 'GET', null, { orderId: 'order-a' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.eligibleDistributors.map((dist) => dist.publicUid), ['Dis001']);
  assert.equal((await call(f.handler, 'GET', null, { orderId: 'terminal' })).statusCode, 409);
  assert.equal((await call(f.handler, 'POST', { orderId: 'terminal', distributorUid: 'distributor-a', scheduledAt: f.validDate.toISOString(), reason: 'Emergency capacity' })).statusCode, 409);
});

test('Admin override rejects cross-branch, missing reason, and an invalid weekday', async () => {
  const f = fixture();
  const base = { orderId: 'order-a', distributorUid: 'distributor-a', scheduledAt: f.validDate.toISOString(), reason: 'Emergency capacity' };
  assert.equal((await call(f.handler, 'POST', { ...base, reason: '' })).statusCode, 400);
  const wrongDay = await call(f.handler, 'POST', { ...base, scheduledAt: manilaScheduleDate(3, 13).toISOString() });
  assert.equal(wrongDay.statusCode, 409);
  assert.equal(wrongDay.body.error.reason, 'PRODUCT_DELIVERY_DAY_UNAVAILABLE');
  const crossBranch = await call(f.handler, 'POST', { ...base, distributorUid: 'distributor-b' });
  assert.equal(crossBranch.statusCode, 403);
  assert.equal(crossBranch.body.error.reason, 'CROSS_BRANCH_ASSIGNMENT_FORBIDDEN');
  assert.equal(f.records.get('requests/order-a').assignedDistributorUid, undefined);
});

test('Admin override persists selected distributor, delivery time, and mandatory audited reason', async () => {
  const f = fixture();
  const result = await call(f.handler, 'POST', { orderId: 'order-a', distributorUid: 'distributor-a', scheduledAt: f.validDate.toISOString(), reason: 'Emergency capacity' });
  assert.equal(result.statusCode, 200);
  const order = f.records.get('requests/order-a');
  assert.equal(order.assignedDistributorUid, 'distributor-a');
  assert.equal(order.assignmentHistory[0].event, 'ADMIN_DISPATCH_OVERRIDE');
  assert.equal(order.assignmentHistory[0].reason, 'Emergency capacity');
  assert.equal([...f.records.values()].find((value) => value.action === 'ADMIN_DISTRIBUTOR_OVERRIDE').reason, 'Emergency capacity');
});
