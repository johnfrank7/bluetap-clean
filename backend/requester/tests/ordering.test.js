const assert = require('node:assert/strict');
const test = require('node:test');

const { createRequesterCatalogHandler, createRequesterOrdersHandler, distanceKm, productAvailableAtBranch } = require('../orderingHandler');
const { createAdminProductsHandler } = require('../../admin/productManagementHandler');

function fixture(overrides = {}) {
  const records = new Map([
    ['users/requester-1', { role: 'requester', fullName: 'Nishi Requester', contactNumber: '09171234567', address: 'Poblacion, Pinamungajan' }],
    ['users/requester-2', { role: 'requester', fullName: 'Other Requester', contactNumber: '09170000000', address: 'Cebu' }],
    ['users/admin-1', { role: 'admin' }],
    ['branches/central', { name: 'BlueTap Central', address: 'Main Street', barangay: 'Poblacion', city: 'Toledo City', latitude: 10.267, longitude: 123.584, serviceRadiusKm: 5, status: 'active' }],
    ['branches/inactive', { name: 'Inactive', latitude: 10.3, longitude: 123.6, status: 'inactive' }],
    ['branches/unlocated', { name: 'Unlocated', status: 'active' }],
    ['products/refill', { product_name: 'Refill', price: 35, active: true, branchIds: ['central'] }],
    ['products/global', { product_name: 'Global Water', price: 20, active: true, branchIds: [] }],
    ['products/inactive', { product_name: 'Old Water', price: 5, active: false, branchIds: ['central'] }],
    ['products/invalid-price', { product_name: 'Broken Price', price: 'not-a-number', active: true, branchIds: ['central'] }],
  ]);
  for (const [path, value] of Object.entries(overrides)) records.set(path, value);
  let autoId = 0;
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const collection = (name) => ({
    doc(id = `auto-${++autoId}`) {
      const path = `${name}/${id}`;
      return { id, path, get: async () => snapshot(path), set: async (data) => records.set(path, data), update: async (data) => records.set(path, { ...records.get(path), ...data }) };
    },
    async get() { return { docs: [...records.keys()].filter((path) => path.startsWith(`${name}/`)).map(snapshot) }; },
    where(field, operator, value) {
      return { async get() { return { docs: [...records.entries()].filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value).map(([path]) => snapshot(path)) }; } };
    },
  });
  const db = {
    collection,
    async runTransaction(run) {
      return run({
        create(ref, data) { assert.equal(records.has(ref.path), false); records.set(ref.path, data); },
        update(ref, data) { records.set(ref.path, { ...records.get(ref.path), ...data }); },
        set(ref, data) { records.set(ref.path, data); },
      });
    },
  };
  const tokenUsers = {
    'requester-token': { uid: 'requester-1', role: 'requester' },
    'requester-2-token': { uid: 'requester-2', role: 'requester' },
    'admin-token': { uid: 'admin-1', role: 'admin', admin: true },
  };
  const auth = { async verifyIdToken(token) { if (!tokenUsers[token]) throw new Error('bad token'); return tokenUsers[token]; } };
  return { records, getAdmin: () => ({ auth, db }) };
}

function response() {
  return { statusCode: 200, body: null, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
}
async function call(handler, method, token, body) {
  const res = response();
  await handler({ method, headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body }, res);
  return res;
}
const validOrder = (extra = {}) => ({ branchId: 'central', deliveryLocation: { latitude: 10.27, longitude: 123.58 }, items: [{ productId: 'refill', quantity: 2 }], container: 'Exchange', ...extra });

test('Haversine returns zero for the same point', () => assert.equal(distanceKm({ latitude: 10, longitude: 123 }, { latitude: 10, longitude: 123 }), 0));
test('Haversine returns a rounded approximate distance', () => assert.ok(distanceKm({ latitude: 10.267, longitude: 123.584 }, { latitude: 10.3, longitude: 123.6 }) > 3));
test('global products are available at every branch', () => assert.equal(productAvailableAtBranch({ branchIds: [] }, 'central'), true));
test('branch products are available at their assigned branch', () => assert.equal(productAvailableAtBranch({ branchIds: ['central'] }, 'central'), true));
test('branch products are unavailable elsewhere', () => assert.equal(productAvailableAtBranch({ branchIds: ['other'] }, 'central'), false));

test('Requester catalog includes only active located branches and active products', async () => {
  const f = fixture(); const result = await call(createRequesterCatalogHandler(f.getAdmin), 'GET', 'requester-token');
  assert.equal(result.statusCode, 200); assert.deepEqual(result.body.branches.map((item) => item.id), ['central']);
  assert.deepEqual(result.body.products.map((item) => item.id).sort(), ['global', 'refill']); assert.equal(result.body.profile.complete, true);
});
test('Requester catalog requires a trusted requester identity', async () => {
  const result = await call(createRequesterCatalogHandler(fixture().getAdmin), 'GET', 'admin-token');
  assert.equal(result.statusCode, 403); assert.equal(result.body.error.reason, 'REQUESTER_REQUIRED');
});
test('valid order uses authenticated UID and ignores a supplied target UID', async () => {
  const f = fixture(); const result = await call(createRequesterOrdersHandler(f.getAdmin), 'POST', 'requester-token', validOrder({ requesterUid: 'attacker-target' }));
  assert.equal(result.statusCode, 201); assert.equal(result.body.order.requesterUid, 'requester-1'); assert.equal(result.body.order.requester_id, 'requester-1');
});
test('Requester order reads return only the authenticated UID records with creation timestamps', async () => {
  const f = fixture(); const handler = createRequesterOrdersHandler(f.getAdmin);
  const created = await call(handler, 'POST', 'requester-token', validOrder());
  assert.equal(created.statusCode, 201);
  assert.ok(created.body.order.createdAt instanceof Date);
  assert.equal(created.body.order.branchId, 'central');
  assert.equal(created.body.order.currentBranchId, 'central');
  assert.equal(created.body.order.status, 'Pending');

  const ownerRead = await call(handler, 'GET', 'requester-token');
  assert.equal(ownerRead.statusCode, 200);
  assert.deepEqual(ownerRead.body.orders.map((order) => order.id), [created.body.order.id]);
  assert.equal(ownerRead.body.orders[0].requesterUid, 'requester-1');

  const unrelatedRead = await call(handler, 'GET', 'requester-2-token');
  assert.equal(unrelatedRead.statusCode, 200);
  assert.deepEqual(unrelatedRead.body.orders, []);
});
test('server reloads price and calculates quantity and total', async () => {
  const result = await call(createRequesterOrdersHandler(fixture().getAdmin), 'POST', 'requester-token', validOrder({ clientPrice: 1, clientTotal: 1 }));
  assert.equal(result.body.order.items[0].unitPriceAtOrder, 35); assert.equal(result.body.order.items[0].totalAtOrder, 70); assert.equal(result.body.order.totalAtOrder, 70);
});
test('order stores product, branch, delivery, distance, and price snapshots', async () => {
  const result = await call(createRequesterOrdersHandler(fixture().getAdmin), 'POST', 'requester-token', validOrder()); const order = result.body.order;
  assert.equal(order.items[0].productNameSnapshot, 'Refill'); assert.equal(order.branchId, 'central'); assert.equal(order.branchNameSnapshot, 'BlueTap Central');
  assert.deepEqual(order.deliveryLocation, { latitude: 10.27, longitude: 123.58 }); assert.equal(typeof order.distanceKmSnapshot, 'number');
});
test('server creates outside-radius orders with trusted distance and service-radius snapshots', async () => {
  const result = await call(createRequesterOrdersHandler(fixture().getAdmin), 'POST', 'requester-token', validOrder({ deliveryLocation: { latitude: 10.36, longitude: 123.68 } }));
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.order.status, 'outside_radius_pending_approval');
  assert.equal(result.body.order.outsideServiceArea, true);
  assert.equal(result.body.order.serviceRadiusKmSnapshot, 5);
  assert.ok(result.body.order.distanceKmSnapshot > result.body.order.serviceRadiusKmSnapshot);
});
test('inactive products cannot be ordered', async () => {
  const result = await call(createRequesterOrdersHandler(fixture().getAdmin), 'POST', 'requester-token', validOrder({ items: [{ productId: 'inactive', quantity: 1 }] }));
  assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'PRODUCT_UNAVAILABLE');
});
test('missing products cannot be ordered', async () => {
  const result = await call(createRequesterOrdersHandler(fixture().getAdmin), 'POST', 'requester-token', validOrder({ items: [{ productId: 'missing', quantity: 1 }] }));
  assert.equal(result.statusCode, 404); assert.equal(result.body.error.reason, 'PRODUCT_NOT_FOUND');
});
test('legacy products with invalid prices are not orderable', async () => {
  const result = await call(createRequesterOrdersHandler(fixture().getAdmin), 'POST', 'requester-token', validOrder({ items: [{ productId: 'invalid-price', quantity: 1 }] }));
  assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'PRODUCT_UNAVAILABLE');
});
test('inactive branches cannot receive new orders', async () => {
  const result = await call(createRequesterOrdersHandler(fixture().getAdmin), 'POST', 'requester-token', validOrder({ branchId: 'inactive' }));
  assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'BRANCH_UNAVAILABLE');
});
test('branches without coordinates cannot receive new orders', async () => {
  const result = await call(createRequesterOrdersHandler(fixture().getAdmin), 'POST', 'requester-token', validOrder({ branchId: 'unlocated' }));
  assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'BRANCH_UNAVAILABLE');
});
test('incomplete profile blocks ordering', async () => {
  const f = fixture({ 'users/requester-1': { role: 'requester', fullName: 'Nishi' } });
  const result = await call(createRequesterOrdersHandler(f.getAdmin), 'POST', 'requester-token', validOrder());
  assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'PROFILE_INCOMPLETE');
});
test('invalid quantity is rejected', async () => {
  const result = await call(createRequesterOrdersHandler(fixture().getAdmin), 'POST', 'requester-token', validOrder({ items: [{ productId: 'refill', quantity: 0 }] }));
  assert.equal(result.statusCode, 400); assert.equal(result.body.error.reason, 'INVALID_ORDER_ITEM');
});
test('owner can cancel a pending order', async () => {
  const f = fixture({ 'requests/order-1': { requesterUid: 'requester-1', requester_id: 'requester-1', status: 'Pending', branchId: 'central' } });
  const result = await call(createRequesterOrdersHandler(f.getAdmin), 'PATCH', 'requester-token', { orderId: 'order-1' });
  assert.equal(result.statusCode, 200); assert.equal(result.body.order.status, 'Cancelled');
});
test('another requester cannot cancel an order', async () => {
  const f = fixture({ 'requests/order-1': { requesterUid: 'requester-1', status: 'Pending' } });
  const result = await call(createRequesterOrdersHandler(f.getAdmin), 'PATCH', 'requester-2-token', { orderId: 'order-1' });
  assert.equal(result.statusCode, 404);
});
test('non-pending orders cannot be cancelled', async () => {
  const f = fixture({ 'requests/order-1': { requesterUid: 'requester-1', status: 'Delivered' } });
  const result = await call(createRequesterOrdersHandler(f.getAdmin), 'PATCH', 'requester-token', { orderId: 'order-1' });
  assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'ORDER_NOT_CANCELLABLE');
});

test('only Admin can create a product and creation is audited', async () => {
  const f = fixture(); const handler = createAdminProductsHandler(f.getAdmin);
  assert.equal((await call(handler, 'POST', 'requester-token', { product_name: 'Blocked', price: 1 })).statusCode, 403);
  const created = await call(handler, 'POST', 'admin-token', { product_name: 'Premium', price: 49.99, branchIds: ['central'] });
  assert.equal(created.statusCode, 201); assert.equal(created.body.product.price, 49.99);
  assert.ok([...f.records.values()].some((value) => value.action === 'PRODUCT_CREATED'));
});
test('Admin deactivates products instead of deleting them', async () => {
  const f = fixture(); const result = await call(createAdminProductsHandler(f.getAdmin), 'PATCH', 'admin-token', { productId: 'refill', active: false });
  assert.equal(result.statusCode, 200); assert.equal(result.body.product.active, false); assert.equal(f.records.has('products/refill'), true);
  assert.ok([...f.records.values()].some((value) => value.action === 'PRODUCT_DEACTIVATED'));
});
test('Admin cannot assign a product to a missing branch', async () => {
  const result = await call(createAdminProductsHandler(fixture().getAdmin), 'POST', 'admin-token', { product_name: 'Premium', price: 40, branchIds: ['missing'] });
  assert.equal(result.statusCode, 400); assert.equal(result.body.error.reason, 'INVALID_PRODUCT_BRANCH');
});
