const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createManagerDispatchHandler } = require('../dispatchHandler');
const { createOrderLoadSnapshot, verifiedOrderCargo } = require('../../utils/orderLoadSnapshot');
const { createTrip, allocateOrder, approveTrip, reserveResource } = require('../../utils/deliveryTripFoundation');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.GCLOUD_PROJECT === 'demo-bluetap';
const epoch = 'a'.repeat(64);
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, body) { const res = response(); await handler({ method: 'PATCH', headers: { authorization: 'Bearer manager' }, body }, res); return res; }

async function fixture(run) {
  const suffix = randomUUID(); const app = initializeApp({ projectId: 'demo-bluetap' }, `manager-load-${suffix}`); const db = getFirestore(app);
  const id = Object.fromEntries(['manager', 'dist', 'branch', 'water', 'bottles', 'order', 'trip'].map((key) => [key, `${key}-${suffix}`]));
  const auth = { async verifyIdToken() { return { uid: id.manager, manager: true, role: 'manager' }; }, async getUser(uid) { return { uid, disabled: false }; } };
  const manager = { decoded: { uid: id.manager, role: 'manager', manager: true }, branch: { id: id.branch } };
  const handler = (source = db) => createManagerDispatchHandler(() => ({ db: source, auth }));
  const orderRef = db.doc(`requests/${id.order}`); const proofRef = db.doc(`orderLoadSnapshots/${id.order}`);
  const initialItems = [{ productId: id.water, productNameSnapshot: 'Water', quantity: 2, containerTypeSnapshot: 'Gallon', sizeSnapshot: '5 gallon', loadClassificationSnapshot: 'STANDARD_5_GALLON', unitPriceAtOrder: 20, totalAtOrder: 40, deliveryDaysSnapshot: [] }];
  const edit = (quantity, extra = []) => ({ action: 'edit-order', orderId: id.order, items: [{ productId: id.water, quantity, loadClassificationSnapshot: 'OTHER_CARGO' }, ...extra] });
  const seedOrder = async (status = 'scheduled', proof = true) => {
    const order = { status, branchId: id.branch, currentBranchId: id.branch, requesterUid: `requester-${suffix}`, items: initialItems, quantity: 2, totalAtOrder: 40,
      ...(status === 'scheduled' ? { assignedDistributorUid: id.dist, scheduledAt: new Date(Date.now() + 86400000) } : {}) };
    const batch = db.batch(); batch.set(orderRef, order);
    if (proof) batch.set(proofRef, createOrderLoadSnapshot(id.order, initialItems, epoch));
    await batch.commit();
  };
  try {
    await Promise.all([
      db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch }),
      db.doc(`branches/${id.branch}`).set({ name: 'Test branch', status: 'active', latitude: 10.267, longitude: 123.584 }),
      db.doc(`users/${id.manager}`).set({ role: 'manager', managerStatus: 'active', branchId: id.branch }),
      db.doc(`users/${id.dist}`).set({ role: 'distributor', approvalStatus: 'active', accountStatus: 'active', branchId: id.branch, fullName: 'Test Driver' }),
      db.doc(`products/${id.water}`).set({ product_name: 'Water', price: 20, active: true, containerType: 'Gallon', size: '5 gallon', deliveryLoad: { verified: true, classification: 'standard_5_gallon' } }),
      db.doc(`products/${id.bottles}`).set({ product_name: '24 pack', price: 10, active: true, deliveryLoad: { verified: true, classification: 'other' } }),
      db.doc(`distributorDispatchGuards/${id.dist}`).set({ schemaVersion: 1, initialized: true, distributorUid: id.dist, revision: 0, reservations: [] }),
    ]);
    await run({ db, id, auth, manager, handler, orderRef, proofRef, initialItems, edit, seedOrder });
  } finally { await deleteApp(app); }
}

test('Manager edit atomically regenerates mixed cargo proof and preserves proven historical identity', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await f.seedOrder();
  await f.db.doc(`products/${f.id.water}`).update({ product_name: 'Changed catalog name', description: 'Updated display details' });
  const body = f.edit(3, [{ productId: f.id.bottles, quantity: 4, loadClassificationSnapshot: 'STANDARD_5_GALLON' }]);
  assert.equal((await call(f.handler(), body)).statusCode, 200);
  const saved = (await f.orderRef.get()).data(); const proof = (await f.proofRef.get()).data();
  assert.equal(saved.items[0].productNameSnapshot, 'Water'); assert.equal(saved.items[0].sizeSnapshot, '5 gallon');
  assert.equal(saved.items[0].loadClassificationSnapshot, 'STANDARD_5_GALLON'); assert.equal(saved.items[1].loadClassificationSnapshot, 'OTHER_CARGO');
  assert.deepEqual(verifiedOrderCargo(f.id.order, saved.items, proof, epoch).map((item) => [item.quantity, item.classification]), [[3, 'standard_5_gallon'], [4, 'other']]);
  assert.equal((await call(f.handler(), body)).statusCode, 200); assert.deepEqual((await f.proofRef.get()).data(), proof);
}));

test('historical cargo stays proven but increased quantity after a physical catalog change requires review', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await f.seedOrder();
  await f.db.doc(`products/${f.id.water}`).update({ product_name: 'Changed cargo', size: '24 pack', deliveryLoad: { verified: true, classification: 'other' } });
  assert.equal((await call(f.handler(), f.edit(2))).statusCode, 200);
  assert.equal((await f.orderRef.get()).data().items[0].loadClassificationSnapshot, 'STANDARD_5_GALLON');
  assert.equal((await call(f.handler(), f.edit(3))).statusCode, 200);
  const saved = (await f.orderRef.get()).data(); const proof = (await f.proofRef.get()).data();
  assert.equal(saved.items[0].loadClassificationSnapshot, 'UNKNOWN');
  assert.throws(() => verifiedOrderCargo(f.id.order, saved.items, proof, epoch), (error) => error.reason === 'TRIP_LOAD_UNKNOWN');
}));

test('legacy and forged existing proofs cannot upgrade old items from the current catalog', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await f.seedOrder('scheduled', false); assert.equal((await call(f.handler(), f.edit(3))).statusCode, 200);
  let saved = (await f.orderRef.get()).data(); let proof = (await f.proofRef.get()).data();
  assert.equal(saved.items[0].loadClassificationSnapshot, 'UNKNOWN'); assert.throws(() => verifiedOrderCargo(f.id.order, saved.items, proof, epoch), (error) => error.reason === 'TRIP_LOAD_UNKNOWN');
  assert.equal((await call(f.handler(), f.edit(4))).statusCode, 200);
  assert.equal((await f.orderRef.get()).data().items[0].loadClassificationSnapshot, 'UNKNOWN');
  const forged = (await f.proofRef.get()).data(); forged.items[0].classification = 'STANDARD_5_GALLON'; await f.proofRef.set(forged);
  assert.equal((await call(f.handler(), f.edit(5))).statusCode, 200);
  saved = (await f.orderRef.get()).data(); proof = (await f.proofRef.get()).data();
  assert.equal(saved.items[0].loadClassificationSnapshot, 'UNKNOWN'); assert.throws(() => verifiedOrderCargo(f.id.order, saved.items, proof, epoch), (error) => error.reason === 'TRIP_LOAD_UNKNOWN');
}));

test('missing provenance keeps Manager edits available while removing old proof', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await f.seedOrder(); await f.db.doc('orderLoadSnapshotSecurity/current').update({ enabled: false });
  try { assert.equal((await call(f.handler(), f.edit(5))).statusCode, 200); assert.equal((await f.proofRef.get()).exists, false); }
  finally { await f.db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch }); }
}));

test('Manager edit makes the isolated mixed-load review unusable until reallocation', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await f.seedOrder(); const txn = (fn) => f.db.runTransaction(fn);
  const items = [...f.initialItems, { productId: f.id.bottles, productNameSnapshot: '24 pack', quantity: 1, containerTypeSnapshot: '', sizeSnapshot: '', loadClassificationSnapshot: 'OTHER_CARGO', unitPriceAtOrder: 10, totalAtOrder: 10, deliveryDaysSnapshot: [] }];
  const batch = f.db.batch(); batch.update(f.orderRef, { items }); batch.set(f.proofRef, createOrderLoadSnapshot(f.id.order, items, epoch)); await batch.commit();
  await txn((tx) => createTrip(tx, f.db, { tripId: f.id.trip, distributorUid: f.id.dist, manager: f.manager }));
  await txn((tx) => allocateOrder(tx, f.db, { tripId: f.id.trip, orderId: f.id.order, manager: f.manager }));
  await txn((tx) => approveTrip(tx, f.db, { tripId: f.id.trip, manager: f.manager, mixedLoadConfirmed: true }));
  assert.ok((await f.db.doc(`deliveryTrips/${f.id.trip}`).get()).data().mixedReview);
  await f.db.doc(`branchDeliveryResources/${f.id.branch}`).set({ schemaVersion: 1, initialized: true, branchId: f.id.branch, revision: 0, resources: [{ id: 'resource-a', verified: true, tripId: null, distributorUid: null }, { id: 'resource-b', verified: true, tripId: null, distributorUid: null }] });
  assert.equal((await call(f.handler(), f.edit(3, [{ productId: f.id.bottles, quantity: 2 }]))).statusCode, 200);
  await assert.rejects(txn((tx) => reserveResource(tx, f.db, { tripId: f.id.trip, resourceId: 'resource-a', manager: f.manager })), (error) => error.reason === 'TRIP_INVALID');
  await txn((tx) => allocateOrder(tx, f.db, { tripId: f.id.trip, orderId: f.id.order, manager: f.manager }));
  const trip = (await f.db.doc(`deliveryTrips/${f.id.trip}`).get()).data(); assert.equal(trip.state, 'planning'); assert.equal(trip.managerApproval, null); assert.equal(trip.mixedReview, null); assert.equal(trip.hasOtherCargo, true);
  await assert.rejects(txn((tx) => approveTrip(tx, f.db, { tripId: f.id.trip, manager: f.manager })), (error) => error.reason === 'TRIP_MIXED_REVIEW_REQUIRED');
}));

test('transaction failure leaves both Manager order and proof unchanged', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await f.seedOrder(); const before = (await f.orderRef.get()).data(); const proof = (await f.proofRef.get()).data();
  const failing = { collection: f.db.collection.bind(f.db), runTransaction: (fn) => f.db.runTransaction(async (tx) => { await fn(tx); throw new Error('test rollback'); }) };
  assert.equal((await call(f.handler(failing), f.edit(5))).statusCode, 500);
  assert.deepEqual((await f.orderRef.get()).data(), before); assert.deepEqual((await f.proofRef.get()).data(), proof);
}));

test('Manager can edit an order above one trip load while isolated allocation rejects it', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await f.seedOrder(); assert.equal((await call(f.handler(), f.edit(61))).statusCode, 200);
  await f.db.runTransaction((tx) => createTrip(tx, f.db, { tripId: f.id.trip, distributorUid: f.id.dist, manager: f.manager }));
  await assert.rejects(f.db.runTransaction((tx) => allocateOrder(tx, f.db, { tripId: f.id.trip, orderId: f.id.order, manager: f.manager })), (error) => error.reason === 'TRIP_CAPACITY_EXCEEDED');
  assert.equal((await f.orderRef.get()).data().items[0].quantity, 61);
}));

test('concurrent Manager edit and assignment leave matching order and proof', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await f.seedOrder('awaiting_distributor_assignment');
  let arrivals = 0; let release; const barrier = new Promise((resolve) => { release = resolve; });
  const racingDb = { collection: f.db.collection.bind(f.db), runTransaction: (fn) => { let first = true; return f.db.runTransaction((tx) => fn(new Proxy(tx, { get(target, key) {
    if (key === 'get') return async (ref) => { if (first && ref.path === f.orderRef.path) { first = false; arrivals++; if (arrivals === 2) release(); await barrier; } return target.get(ref); };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } }))); } };
  const scheduledAt = new Date(Date.now() + 86400000).toISOString();
  const results = await Promise.all([call(f.handler(racingDb), f.edit(3)), call(f.handler(racingDb), { action: 'assign-distributor', orderId: f.id.order, distributorUid: f.id.dist, scheduledAt })]);
  assert.deepEqual(results.map((result) => result.statusCode), [200, 200]);
  const saved = (await f.orderRef.get()).data(); const proof = (await f.proofRef.get()).data();
  assert.equal(verifiedOrderCargo(f.id.order, saved.items, proof, epoch)[0].quantity, saved.items[0].quantity);
  const guard = (await f.db.doc(`distributorDispatchGuards/${f.id.dist}`).get()).data();
  assert.equal(guard.reservations.length, saved.assignedDistributorUid ? 1 : 0);
}));
