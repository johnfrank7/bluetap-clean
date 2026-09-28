const assert = require('node:assert/strict');
const test = require('node:test');

const { createManagerWorkspaceHandler } = require('../workspaceHandler');

function fixture() {
  const records = new Map([
    ['users/manager-north', { role: 'manager', managerStatus: 'active', branchId: 'north', fullName: 'North Manager' }],
    ['branches/north', { name: 'North', status: 'active' }],
    ['branches/south', { name: 'South', status: 'active' }],
    ['products/refill', { product_name: 'Refill', price: 35, active: true, deliveryDays: ['monday'], maxQuantityPerRequester: 10 }],
    ['requests/north-order', { requestId: 'BT-N', branchId: 'north', status: 'delivered', quantity: 2, totalAtOrder: 70 }],
    ['requests/south-order', { requestId: 'BT-S', branchId: 'south', status: 'delivered', quantity: 9, totalAtOrder: 315 }],
  ]);
  let nextId = 0;
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const docs = (name) => [...records.keys()].filter((path) => path.startsWith(`${name}/`)).map(snapshot);
  const collection = (name) => ({
    doc(id = `auto-${++nextId}`) {
      const path = `${name}/${id}`;
      return { id, path, get: async () => snapshot(path) };
    },
    get: async () => ({ docs: docs(name) }),
    where(field, _operator, value) {
      return { get: async () => ({ docs: docs(name).filter((item) => item.data()?.[field] === value) }) };
    },
  });
  const db = {
    collection,
    runTransaction: async (run) => run({
      get: async (ref) => snapshot(ref.path),
      update(ref, value) { records.set(ref.path, { ...(records.get(ref.path) || {}), ...value }); },
      set(ref, value) { records.set(ref.path, value); },
    }),
  };
  const auth = {
    verifyIdToken: async (token) => token === 'north-token'
      ? { uid: 'manager-north', role: 'manager', manager: true }
      : Promise.reject(new Error('invalid token')),
  };
  return { records, getAdmin: () => ({ auth, db }) };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    getHeader() { return ''; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

async function call(handler, method, body) {
  const res = response();
  await handler({ method, headers: { authorization: 'Bearer north-token' }, body }, res);
  return res;
}

test('Manager product policy write is forced to the authenticated Manager branch', async () => {
  const f = fixture();
  const result = await call(createManagerWorkspaceHandler(f.getAdmin), 'POST', {
    action: 'updateProductPolicy',
    productId: 'refill',
    branchId: 'south',
    deliveryDays: ['tuesday', 'thursday'],
    maxQuantityPerRequester: 6,
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(f.records.get('branches/north').productPolicyOverrides.refill.deliveryDays, ['tuesday', 'thursday']);
  assert.equal(f.records.get('branches/north').productPolicyOverrides.refill.maxQuantityPerRequester, 6);
  assert.equal(f.records.get('branches/south').productPolicyOverrides, undefined);
  assert.ok([...f.records.values()].some((record) => record.action === 'MANAGER_BRANCH_PRODUCT_POLICY_UPDATED' && record.branchId === 'north'));
});

test('Manager workspace analytics and product policy are scoped to the own branch', async () => {
  const f = fixture();
  f.records.set('branches/north', {
    ...f.records.get('branches/north'),
    productPolicyOverrides: { refill: { deliveryDays: ['friday'], maxQuantityPerRequester: 4 } },
  });
  const result = await call(createManagerWorkspaceHandler(f.getAdmin), 'GET');

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.orders.map((order) => order.requestId), ['BT-N']);
  assert.deepEqual(result.body.products[0].effectivePolicy.deliveryDays, ['friday']);
  assert.equal(result.body.products[0].effectivePolicy.maxQuantityPerRequester, 4);
});
