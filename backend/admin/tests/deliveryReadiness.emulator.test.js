const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: initializeClient, deleteApp: deleteClient } = require('firebase/app');
const { getFirestore: getClientDb, connectFirestoreEmulator, doc, setDoc, getDoc } = require('firebase/firestore');
const { createAdminProductsHandler, refreshLoadSnapshots } = require('../productManagementHandler');
const { createAdminBranchesHandler } = require('../branchManagementHandler');
const { createRequesterOrdersHandler } = require('../../requester/orderingHandler');
const { createManagerDispatchHandler } = require('../../manager/dispatchHandler');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.GCLOUD_PROJECT === 'demo-bluetap';
const epoch = 'a'.repeat(64);
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, method, token, body) { const res = response(); await handler({ method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body }, res); return res; }

async function fixture(run) {
  const suffix = randomUUID(); const app = initializeApp({ projectId: 'demo-bluetap' }, `readiness-${suffix}`); const db = getFirestore(app);
  const ids = Object.fromEntries(['admin', 'requester', 'manager', 'branch', 'otherBranch'].map((key) => [key, `${key}-${suffix}`]));
  const auth = { async verifyIdToken(token) { if (token === 'admin') return { uid: ids.admin, role: 'admin', admin: true }; if (token === 'requester') return { uid: ids.requester, role: 'requester' }; if (token === 'manager') return { uid: ids.manager, role: 'manager', manager: true }; throw new Error('invalid token'); } };
  const products = createAdminProductsHandler(() => ({ db, auth }), { logger: { info() {}, error() {} } });
  const branches = createAdminBranchesHandler(() => ({ db, auth })); const orders = createRequesterOrdersHandler(() => ({ db, auth }));
  try {
    await Promise.all([
      db.doc(`users/${ids.admin}`).set({ role: 'admin' }),
      db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch }),
      db.doc(`users/${ids.manager}`).set({ role: 'manager', managerStatus: 'active', branchId: ids.branch }),
      db.doc(`users/${ids.requester}`).set({ role: 'requester', fullName: 'Test Requester', contactNumber: '09171234567', address: 'Test address' }),
      ...[ids.branch, ids.otherBranch].map((id) => db.doc(`branches/${id}`).set({ name: 'Test branch', status: 'active', latitude: 10.267, longitude: 123.584, serviceRadiusKm: 5 })),
    ]);
    await run({ db, ids, products, branches, orders, suffix });
  } finally { await deleteApp(app); }
}

test('emulator Admin classification is explicit, validated and invalidated by physical product changes', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const base = { product_name: 'Water', price: 25 };
  const denied = await call(f.products, 'POST', 'manager', { ...base, deliveryLoadClassification: 'STANDARD_5_GALLON' }); assert.equal(denied.statusCode, 403);
  const forged = await call(f.products, 'POST', 'admin', { ...base, deliveryLoad: { verified: true, classification: 'standard_5_gallon' } }); assert.equal(forged.statusCode, 400);
  const invalid = await call(f.products, 'POST', 'admin', { ...base, deliveryLoadClassification: 'BOTTLE_EQUIVALENT' }); assert.equal(invalid.statusCode, 400);
  const standard = await call(f.products, 'POST', 'admin', { ...base, size: '5 gallons', deliveryLoadClassification: 'STANDARD_5_GALLON' }); assert.equal(standard.statusCode, 201);
  const id = standard.body.product.id; assert.equal((await f.db.doc(`products/${id}`).get()).data().deliveryLoad.classification, 'standard_5_gallon');
  const other = await call(f.products, 'POST', 'admin', { ...base, product_name: '24 pack', deliveryLoadClassification: 'OTHER_CARGO' }); assert.equal(other.body.product.deliveryLoadClassification, 'OTHER_CARGO');
  const unknown = await call(f.products, 'POST', 'admin', base); assert.equal(unknown.body.product.deliveryLoadClassification, 'UNKNOWN');
  const changed = await call(f.products, 'PATCH', 'admin', { productId: id, size: 'Changed size' }); assert.equal(changed.body.product.deliveryLoadClassification, 'UNKNOWN');
  const confirmed = await call(f.products, 'PATCH', 'admin', { productId: id, deliveryLoadClassification: 'STANDARD_5_GALLON' }); assert.equal(confirmed.body.product.deliveryLoadClassification, 'STANDARD_5_GALLON');
}));

test('emulator order snapshots come from product records, not requester input, and survive later product edits', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const product = await call(f.products, 'POST', 'admin', { product_name: 'Verified water', price: 25, deliveryLoadClassification: 'STANDARD_5_GALLON' });
  const productId = product.body.product.id;
  const request = { branchId: f.ids.branch, deliveryLocation: { latitude: 10.267, longitude: 123.584 }, items: [{ productId, quantity: 2, loadClassificationSnapshot: 'OTHER_CARGO', deliveryLoad: { verified: true, classification: 'other' } }] };
  const created = await call(f.orders, 'POST', 'requester', request); assert.equal(created.statusCode, 201);
  const orderId = created.body.order.id; assert.equal((await f.db.doc(`requests/${orderId}`).get()).data().items[0].loadClassificationSnapshot, 'STANDARD_5_GALLON');
  assert.equal((await f.db.doc(`orderLoadSnapshots/${orderId}`).get()).data().items[0].classification, 'STANDARD_5_GALLON');
  assert.equal(JSON.stringify(created.body).includes(epoch), false);
  await call(f.products, 'PATCH', 'admin', { productId, deliveryLoadClassification: 'OTHER_CARGO' });
  assert.equal((await f.db.doc(`requests/${orderId}`).get()).data().items[0].loadClassificationSnapshot, 'STANDARD_5_GALLON');
  const edited = await call(f.orders, 'PATCH', 'requester', { action: 'edit-order', orderId, items: request.items }); assert.equal(edited.statusCode, 200);
  assert.equal((await f.db.doc(`requests/${orderId}`).get()).data().items[0].loadClassificationSnapshot, 'OTHER_CARGO');
  assert.equal((await f.db.doc(`orderLoadSnapshots/${orderId}`).get()).data().items[0].classification, 'OTHER_CARGO');
}));

test('emulator Manager order edit snapshots the authoritative classification', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const product = await call(f.products, 'POST', 'admin', { product_name: '24 pack', price: 25, deliveryLoadClassification: 'OTHER_CARGO' });
  const productId = product.body.product.id; const orderId = `manager-edit-${f.suffix}`;
  await f.db.doc(`requests/${orderId}`).set({ status: 'awaiting_distributor_assignment', branchId: f.ids.branch, currentBranchId: f.ids.branch, items: [], totalAtOrder: 0 });
  const auth = { async verifyIdToken() { return { uid: f.ids.manager, role: 'manager', manager: true }; } };
  const handler = createManagerDispatchHandler(() => ({ db: f.db, auth }));
  const result = await call(handler, 'PATCH', 'manager', { orderId, action: 'edit-order', items: [{ productId, quantity: 3, loadClassificationSnapshot: 'STANDARD_5_GALLON' }] });
  assert.equal(result.statusCode, 200); assert.equal((await f.db.doc(`requests/${orderId}`).get()).data().items[0].loadClassificationSnapshot, 'OTHER_CARGO');
}));

test('emulator changed product identity becomes unknown rather than a mismatched trusted snapshot', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const product = await call(f.products, 'POST', 'admin', { product_name: 'New product', price: 25, containerType: 'Gallon', size: '5 gallon', deliveryLoadClassification: 'STANDARD_5_GALLON' });
  const oldItem = { productId: product.body.product.id, quantity: 1, productNameSnapshot: 'Old pack', containerTypeSnapshot: 'Bottles', sizeSnapshot: '24 pack' };
  const [snapshot] = await f.db.runTransaction((tx) => refreshLoadSnapshots(tx, f.db, [oldItem]));
  assert.equal(snapshot.loadClassificationSnapshot, 'UNKNOWN'); assert.equal(snapshot.productNameSnapshot, 'Old pack');
}));

test('emulator ordering remains available without provenance activation and does not create a proof', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const product = await call(f.products, 'POST', 'admin', { product_name: 'Water', price: 25, deliveryLoadClassification: 'STANDARD_5_GALLON' });
  await f.db.doc('orderLoadSnapshotSecurity/current').update({ enabled: false });
  try {
    const created = await call(f.orders, 'POST', 'requester', { branchId: f.ids.branch, deliveryLocation: { latitude: 10.267, longitude: 123.584 }, items: [{ productId: product.body.product.id, quantity: 1 }] });
    assert.equal(created.statusCode, 201);
    assert.equal((await f.db.doc(`orderLoadSnapshots/${created.body.order.id}`).get()).exists, false);
  } finally { await f.db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch }); }
}));

test('emulator a pending edit without provenance activation removes an older proof', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const product = await call(f.products, 'POST', 'admin', { product_name: 'Water', price: 25, deliveryLoadClassification: 'STANDARD_5_GALLON' });
  const items = [{ productId: product.body.product.id, quantity: 1 }];
  const created = await call(f.orders, 'POST', 'requester', { branchId: f.ids.branch, deliveryLocation: { latitude: 10.267, longitude: 123.584 }, items });
  const orderId = created.body.order.id; assert.equal((await f.db.doc(`orderLoadSnapshots/${orderId}`).get()).exists, true);
  await f.db.doc('orderLoadSnapshotSecurity/current').update({ enabled: false });
  try {
    const edited = await call(f.orders, 'PATCH', 'requester', { action: 'edit-order', orderId, items: [{ ...items[0], quantity: 2 }] });
    assert.equal(edited.statusCode, 200); assert.equal((await f.db.doc(`orderLoadSnapshots/${orderId}`).get()).exists, false);
  } finally { await f.db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch }); }
}));

test('emulator resource provisioning is explicit, Admin-only, unique and fails closed on inconsistent records', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const body = { action: 'verify-delivery-resources', branchId: f.ids.branch, confirmedPhysicalInspection: true, confirmedResourcesUnoccupied: true, resourceIdentifiers: [`sample-a-${f.suffix}`, `sample-b-${f.suffix}`] };
  assert.equal((await call(f.branches, 'PATCH', 'manager', body)).statusCode, 403);
  assert.equal((await f.db.doc(`branchDeliveryResources/${f.ids.branch}`).get()).exists, false);
  assert.equal((await call(f.branches, 'PATCH', 'admin', { ...body, confirmedPhysicalInspection: false })).statusCode, 400);
  assert.equal((await call(f.branches, 'PATCH', 'admin', { ...body, confirmedResourcesUnoccupied: false })).statusCode, 400);
  assert.equal((await call(f.branches, 'PATCH', 'admin', { ...body, resourceIdentifiers: [body.resourceIdentifiers[0], body.resourceIdentifiers[0]] })).statusCode, 400);
  const created = await call(f.branches, 'PATCH', 'admin', body); assert.equal(created.statusCode, 200); assert.equal(created.body.resources.length, 2);
  assert.equal(new Set(created.body.resources.map((item) => item.id)).size, 2);
  const recordRef = f.db.doc(`branchDeliveryResources/${f.ids.branch}`); const original = (await recordRef.get()).data();
  assert.equal(JSON.stringify(original).includes(body.resourceIdentifiers[0]), false);
  assert.equal((await call(f.branches, 'PATCH', 'admin', body)).body.unchanged, true);
  assert.equal((await call(f.branches, 'PATCH', 'admin', { ...body, branchId: f.ids.otherBranch })).statusCode, 409);
  const occupied = original.resources.map((item, index) => index ? item : { ...item, tripId: 'test-trip', distributorUid: 'test-driver' });
  await recordRef.update({ resources: occupied }); const check = await call(f.branches, 'PATCH', 'admin', body);
  assert.equal(check.body.resources.filter((item) => item.status === 'occupied').length, 1);
  await recordRef.update({ resources: occupied.map((item, index) => index ? { ...item, verified: false } : item) });
  assert.equal((await call(f.branches, 'PATCH', 'admin', body)).body.error.reason, 'RESOURCE_RECONCILIATION_REQUIRED');
}));

test('emulator rules deny direct product and resource writes from a signed-in client', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const app = initializeClient({ projectId: 'demo-bluetap', apiKey: 'demo' }, `rules-${f.suffix}`); const db = getClientDb(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080, { mockUserToken: { sub: f.ids.admin, user_id: f.ids.admin, role: 'admin', admin: true } });
  try {
    for (const path of [`products/forged-${f.suffix}`, `branchDeliveryResources/${f.ids.branch}`, `deliveryResourceClaims/forged-${f.suffix}`, `orderLoadSnapshots/forged-${f.suffix}`, 'orderLoadSnapshotSecurity/current']) {
      await assert.rejects(setDoc(doc(db, path), { verified: true }), (error) => error.code === 'permission-denied');
    }
    await assert.rejects(getDoc(doc(db, 'orderLoadSnapshotSecurity/current')), (error) => error.code === 'permission-denied');
  } finally { await deleteClient(app); }
}));

test('emulator concurrent branch provisioning cannot register the same physical resource twice', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const shared = `shared-${f.suffix}`;
  const request = (branchId, second) => ({ action: 'verify-delivery-resources', branchId, confirmedPhysicalInspection: true, confirmedResourcesUnoccupied: true, resourceIdentifiers: [shared, second] });
  const outcomes = await Promise.all([
    call(f.branches, 'PATCH', 'admin', request(f.ids.branch, `first-${f.suffix}`)),
    call(f.branches, 'PATCH', 'admin', request(f.ids.otherBranch, `second-${f.suffix}`)),
  ]);
  assert.deepEqual(outcomes.map((result) => result.statusCode).sort(), [200, 409]);
  const guards = await Promise.all([f.db.doc(`branchDeliveryResources/${f.ids.branch}`).get(), f.db.doc(`branchDeliveryResources/${f.ids.otherBranch}`).get()]);
  assert.equal(guards.filter((guard) => guard.exists).length, 1);
}));
