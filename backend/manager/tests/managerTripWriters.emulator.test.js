const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createManagerDispatchHandler } = require('../dispatchHandler');
const { createDistributorAssignedOrdersHandler } = require('../../distributor/assignedOrdersHandler');
const { createOrderLoadSnapshot, verifiedOrderCargo } = require('../../utils/orderLoadSnapshot');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.BLUETAP_TRIP_EMULATOR_MODE === '1';
const epoch = 'a'.repeat(64); // Existing synthetic emulator-only test epoch.
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } });

async function fixture(run) {
  const suffix = randomUUID(); const app = initializeApp({ projectId: 'demo-bluetap' }, `trip-writers-${suffix}`); const db = getFirestore(app);
  const id = Object.fromEntries(['branch', 'other', 'manager', 'otherManager', 'dist', 'dist2', 'water', 'bottles', 'trip', 'trip2'].map((key) => [key, `${key}-${suffix}`]));
  const auth = { async verifyIdToken(token) { return token === 'driver' ? { uid: id.dist, role: 'distributor' } : { uid: token === 'other' ? id.otherManager : id.manager, role: 'manager', manager: true }; }, async getUser(uid) { return { uid, disabled: false }; } };
  const manager = createManagerDispatchHandler(() => ({ auth, db })); const driver = createDistributorAssignedOrdersHandler(() => ({ auth, db }));
  const call = async (handler, token, body) => { const res = response(); await handler({ method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body }, res); return res; };
  const start = new Date(Date.now() + 86400000); const stop = new Date(start.getTime() + 10 * 60000);
  const seed = async (quantity) => {
    const orderId = `order-${randomUUID()}`;
    const items = [{ productId: id.water, quantity, productNameSnapshot: 'Water', containerTypeSnapshot: 'Gallon', sizeSnapshot: '5 gallon', loadClassificationSnapshot: 'STANDARD_5_GALLON', unitPriceAtOrder: 20, totalAtOrder: quantity * 20, deliveryDaysSnapshot: [] }];
    await db.doc(`requests/${orderId}`).set({ status: 'awaiting_distributor_assignment', branchId: id.branch, currentBranchId: id.branch, requesterUid: `requester-${randomUUID()}`, items });
    await db.doc(`orderLoadSnapshots/${orderId}`).set(createOrderLoadSnapshot(orderId, items, epoch));
    return orderId;
  };
  const assign = (orderId) => call(manager, 'manager', { action: 'assign-distributor', orderId, tripId: id.trip, distributorUid: id.dist, scheduledAt: stop.toISOString() });
  const edit = (orderId, quantity, extra = [], clientMutationId = 'edit-request-1') => call(manager, 'manager', { action: 'edit-order', orderId, items: [{ productId: id.water, quantity }, ...extra], clientMutationId });
  try {
    await Promise.all([
      db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch }),
      db.doc(`branches/${id.branch}`).set({ name: 'Source', status: 'active' }), db.doc(`branches/${id.other}`).set({ name: 'Target', status: 'active' }),
      db.doc(`users/${id.manager}`).set({ role: 'manager', managerStatus: 'active', branchId: id.branch }),
      db.doc(`users/${id.otherManager}`).set({ role: 'manager', managerStatus: 'active', branchId: id.other }),
      db.doc(`users/${id.dist}`).set({ role: 'distributor', approvalStatus: 'active', branchId: id.branch, fullName: 'Test Driver', phone: '09123456789', completeAddress: 'Test Barangay' }),
      db.doc(`users/${id.dist2}`).set({ role: 'distributor', approvalStatus: 'active', branchId: id.branch, fullName: 'Other Driver', phone: '09123456789', completeAddress: 'Test Barangay' }),
      db.doc(`products/${id.water}`).set({ product_name: 'Water', price: 20, active: true, containerType: 'Gallon', size: '5 gallon', deliveryLoad: { verified: true, classification: 'standard_5_gallon' } }),
      db.doc(`products/${id.bottles}`).set({ product_name: '24 pack', price: 10, active: true, deliveryLoad: { verified: true, classification: 'other' } }),
      db.doc(`distributorDispatchGuards/${id.dist}`).set({ schemaVersion: 1, initialized: true, distributorUid: id.dist, revision: 0, reservations: [] }),
      db.doc(`distributorDispatchGuards/${id.dist2}`).set({ schemaVersion: 1, initialized: true, distributorUid: id.dist2, revision: 0, reservations: [] }),
      db.doc(`branchDeliveryResources/${id.branch}`).set({ schemaVersion: 1, initialized: true, branchId: id.branch, revision: 0, resources: [{ id: 'resource-a', verified: true, tripId: null, distributorUid: null }, { id: 'resource-b', verified: true, tripId: null, distributorUid: null }] }),
    ]);
    assert.equal((await call(manager, 'manager', { action: 'create-trip', tripId: id.trip, distributorUid: id.dist })).statusCode, 200);
    assert.equal((await call(manager, 'manager', { action: 'schedule-trip', tripId: id.trip, resourceId: 'resource-a', plannedDeparture: start.toISOString(), estimatedReturn: new Date(start.getTime() + 120 * 60000).toISOString() })).statusCode, 200);
    await run({ db, id, auth, manager, driver, call, seed, assign, edit, epoch, start });
  } finally { await deleteApp(app); }
}

test('trip-aware Manager edits atomically enforce 60 containers and deduplicate retries', { skip: !enabled, timeout: 45000 }, async () => fixture(async (f) => {
  const orderId = await f.seed(59); assert.equal((await f.assign(orderId)).statusCode, 200);
  const result = await f.edit(orderId, 60); assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  const orderRef = f.db.doc(`requests/${orderId}`); const proofRef = f.db.doc(`orderLoadSnapshots/${orderId}`); const tripRef = f.db.doc(`deliveryTrips/${f.id.trip}`);
  const saved = (await orderRef.get()).data(); const proof = (await proofRef.get()).data(); const trip = (await tripRef.get()).data();
  assert.equal(verifiedOrderCargo(orderId, saved.items, proof, f.epoch)[0].quantity, 60); assert.equal(trip.standardContainers, 60);
  assert.equal((await f.edit(orderId, 60)).statusCode, 200); assert.deepEqual((await orderRef.get()).data(), saved); assert.deepEqual((await tripRef.get()).data(), trip);
  assert.equal((await f.edit(orderId, 61, [], 'edit-request-2')).body.error.reason, 'TRIP_CAPACITY_EXCEEDED');
  assert.deepEqual((await orderRef.get()).data(), saved); assert.deepEqual((await proofRef.get()).data(), proof); assert.deepEqual((await tripRef.get()).data(), trip);
  assert.equal((await f.edit(orderId, 59)).body.error.reason, 'TRIP_MUTATION_CONFLICT');
}));

test('trip-aware mixed cargo edits invalidate Manager approval and reject stale proof', { skip: !enabled, timeout: 45000 }, async () => fixture(async (f) => {
  const orderId = await f.seed(3); assert.equal((await f.assign(orderId)).statusCode, 200);
  assert.equal((await f.call(f.manager, 'manager', { action: 'approve-trip', tripId: f.id.trip, expectedRevision: (await f.db.doc(`deliveryTrips/${f.id.trip}`).get()).data().revision })).statusCode, 200);
  assert.equal((await f.edit(orderId, 3, [{ productId: f.id.bottles, quantity: 2 }])).statusCode, 200);
  const tripRef = f.db.doc(`deliveryTrips/${f.id.trip}`); const trip = (await tripRef.get()).data();
  assert.equal(trip.state, 'planning'); assert.equal(trip.managerApproval, null); assert.equal(trip.mixedReview, null); assert.equal(trip.hasOtherCargo, true);
  const proofRef = f.db.doc(`orderLoadSnapshots/${orderId}`); const proof = (await proofRef.get()).data(); proof.items[0].quantity += 1; await proofRef.set(proof);
  const before = (await f.db.doc(`requests/${orderId}`).get()).data();
  const result = await f.edit(orderId, 4, [{ productId: f.id.bottles, quantity: 2 }], 'edit-request-3');
  assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'TRIP_LOAD_UNKNOWN');
  assert.deepEqual((await f.db.doc(`requests/${orderId}`).get()).data(), before); assert.deepEqual((await tripRef.get()).data(), trip);
}));

test('trip-aware branch transfer waits for confirmed unloading and preserves closed trip history', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const orderId = await f.seed(5); assert.equal((await f.assign(orderId)).statusCode, 200);
  assert.equal((await f.call(f.manager, 'manager', { action: 'approve-trip', tripId: f.id.trip, expectedRevision: (await f.db.doc(`deliveryTrips/${f.id.trip}`).get()).data().revision })).statusCode, 200);
  assert.equal((await f.call(f.manager, 'manager', { action: 'reserve-trip-resource', tripId: f.id.trip, resourceId: 'resource-a' })).statusCode, 200);
  assert.equal((await f.call(f.driver, 'driver', { action: 'report-trip-loading', tripId: f.id.trip })).statusCode, 200);
  assert.equal((await f.call(f.manager, 'manager', { action: 'confirm-trip-loading', tripId: f.id.trip })).statusCode, 200);
  const transfer = { action: 'request-transfer', orderId, targetBranchId: f.id.other, transferReason: 'Branch handoff', clientMutationId: 'transfer-request-1' };
  const blocked = await f.call(f.manager, 'manager', transfer); assert.equal(blocked.statusCode, 409); assert.equal(blocked.body.error.reason, 'TRIP_UNLOADING_REQUIRED');
  assert.equal((await f.db.doc(`deliveryTripOrderReservations/${orderId}`).get()).data().tripId, f.id.trip);
  assert.equal((await f.call(f.driver, 'driver', { action: 'report-trip-unloading', tripId: f.id.trip })).statusCode, 200);
  assert.equal((await f.call(f.manager, 'manager', { action: 'confirm-trip-unloading', tripId: f.id.trip })).statusCode, 200);
  const success = await f.call(f.manager, 'manager', transfer); assert.equal(success.statusCode, 200, JSON.stringify(success.body));
  const saved = (await f.db.doc(`requests/${orderId}`).get()).data(); assert.equal(saved.status, 'branch_transfer_pending');
  assert.equal((await f.db.doc(`deliveryTripOrderReservations/${orderId}`).get()).exists, false);
  assert.ok((await f.db.doc(`deliveryTrips/${f.id.trip}`).get()).data().members.some((member) => member.orderId === orderId));
  assert.equal((await f.call(f.manager, 'manager', transfer)).statusCode, 200); assert.deepEqual((await f.db.doc(`requests/${orderId}`).get()).data(), saved);
  const accepted = await f.call(f.manager, 'other', { action: 'accept-transfer', orderId, clientMutationId: 'transfer-accept-1' });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body)); assert.equal((await f.db.doc(`requests/${orderId}`).get()).data().currentBranchId, f.id.other);
  assert.equal((await f.call(f.manager, 'other', { action: 'accept-transfer', orderId, clientMutationId: 'transfer-accept-1' })).statusCode, 200);
  const edited = await f.call(f.manager, 'other', { action: 'edit-order', orderId, items: [{ productId: f.id.water, quantity: 6 }], clientMutationId: 'target-edit-1' });
  assert.equal(edited.statusCode, 200, JSON.stringify(edited.body));
  const beforeInconsistency = (await f.db.doc(`requests/${orderId}`).get()).data();
  await f.db.doc(`branchDeliveryResources/${f.id.branch}`).update({ resources: [{ id: 'resource-a', verified: true, tripId: f.id.trip, distributorUid: f.id.dist }, { id: 'resource-b', verified: true, tripId: null, distributorUid: null }] });
  const inconsistent = await f.call(f.manager, 'other', { action: 'edit-order', orderId, items: [{ productId: f.id.water, quantity: 7 }], clientMutationId: 'target-edit-inconsistent' });
  assert.equal(inconsistent.statusCode, 409); assert.equal(inconsistent.body.error.reason, 'TRIP_RESOURCES_INVALID');
  assert.deepEqual((await f.db.doc(`requests/${orderId}`).get()).data(), beforeInconsistency);
}));

test('trip-aware simultaneous edit and assignment cannot exceed trip capacity', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const first = await f.seed(30); const second = await f.seed(30); assert.equal((await f.assign(first)).statusCode, 200);
  const results = await Promise.all([f.edit(first, 40), f.assign(second)]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
  assert.equal(results.find((result) => result.statusCode === 409).body.error.reason, 'TRIP_CAPACITY_EXCEEDED');
  const trip = (await f.db.doc(`deliveryTrips/${f.id.trip}`).get()).data(); assert.ok(trip.standardContainers <= 60);
}));

test('trip-aware preloading transfer removes only that member and remains Manager-scoped', { skip: !enabled, timeout: 45000 }, async () => fixture(async (f) => {
  const orderId = await f.seed(5); assert.equal((await f.assign(orderId)).statusCode, 200);
  assert.equal((await f.call(f.manager, 'manager', { action: 'approve-trip', tripId: f.id.trip, expectedRevision: (await f.db.doc(`deliveryTrips/${f.id.trip}`).get()).data().revision })).statusCode, 200);
  const transfer = { action: 'request-transfer', orderId, targetBranchId: f.id.other, transferReason: 'Branch handoff', clientMutationId: 'transfer-before-loading' };
  assert.equal((await f.call(f.manager, 'other', transfer)).statusCode, 403);
  const result = await f.call(f.manager, 'manager', transfer); assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  const trip = (await f.db.doc(`deliveryTrips/${f.id.trip}`).get()).data();
  assert.equal(trip.members.length, 0); assert.equal(trip.standardContainers, 0); assert.equal(trip.managerApproval, null);
  assert.equal((await f.db.doc(`deliveryTripOrderReservations/${orderId}`).get()).exists, false);
  assert.equal((await f.call(f.manager, 'other', { action: 'decline-transfer', orderId, clientMutationId: 'transfer-decline-1' })).statusCode, 200);
}));

test('trip-aware edits reject inconsistent resource state and leave all records intact on rollback', { skip: !enabled, timeout: 45000 }, async () => fixture(async (f) => {
  const orderId = await f.seed(4); assert.equal((await f.assign(orderId)).statusCode, 200);
  const orderRef = f.db.doc(`requests/${orderId}`); const proofRef = f.db.doc(`orderLoadSnapshots/${orderId}`); const tripRef = f.db.doc(`deliveryTrips/${f.id.trip}`);
  const before = (await orderRef.get()).data(); const proof = (await proofRef.get()).data(); const trip = (await tripRef.get()).data();
  const failing = { _settings: f.db._settings, collection: f.db.collection.bind(f.db), runTransaction: (fn) => f.db.runTransaction(async (tx) => { await fn(tx); throw new Error('test rollback'); }) };
  const failingHandler = createManagerDispatchHandler(() => ({ auth: f.auth, db: failing }));
  const result = await f.call(failingHandler, 'manager', { action: 'edit-order', orderId, items: [{ productId: f.id.water, quantity: 5 }], clientMutationId: 'rollback-edit-1' });
  assert.equal(result.statusCode, 500); assert.deepEqual((await orderRef.get()).data(), before); assert.deepEqual((await proofRef.get()).data(), proof); assert.deepEqual((await tripRef.get()).data(), trip);
  await f.db.doc(`branchDeliveryResources/${f.id.branch}`).update({ resources: [{ id: 'resource-a', verified: true, tripId: f.id.trip, distributorUid: f.id.dist }, { id: 'resource-b', verified: true, tripId: null, distributorUid: null }] });
  const invalid = await f.edit(orderId, 5, [], 'invalid-resource-1');
  assert.equal(invalid.statusCode, 409); assert.equal(invalid.body.error.reason, 'TRIP_RESOURCES_INVALID');
  assert.deepEqual((await orderRef.get()).data(), before); assert.deepEqual((await proofRef.get()).data(), proof); assert.deepEqual((await tripRef.get()).data(), trip);
}));

test('trip-aware edits reject unknown cargo and held or cross-branch Distributors', { skip: !enabled, timeout: 45000 }, async () => fixture(async (f) => {
  const orderId = await f.seed(4); assert.equal((await f.assign(orderId)).statusCode, 200);
  const orderRef = f.db.doc(`requests/${orderId}`); const tripRef = f.db.doc(`deliveryTrips/${f.id.trip}`); const before = (await orderRef.get()).data(); const trip = (await tripRef.get()).data();
  await f.db.doc(`products/${f.id.bottles}`).update({ deliveryLoad: { verified: false, classification: 'other' } });
  const unknown = await f.edit(orderId, 4, [{ productId: f.id.bottles, quantity: 1 }], 'unknown-cargo-1');
  assert.equal(unknown.statusCode, 409); assert.equal(unknown.body.error.reason, 'TRIP_LOAD_UNKNOWN');
  await f.db.doc(`users/${f.id.dist}`).update({ accountActionHoldIntentId: 'test-hold' });
  assert.equal((await f.edit(orderId, 5, [], 'held-driver-1')).statusCode, 409);
  await f.db.doc(`users/${f.id.dist}`).update({ accountActionHoldIntentId: '', branchId: f.id.other });
  assert.equal((await f.edit(orderId, 5, [], 'wrong-branch-1')).statusCode, 409);
  assert.deepEqual((await orderRef.get()).data(), before); assert.deepEqual((await tripRef.get()).data(), trip);
}));

test('trip-aware edit competing with reassignment cannot overfill the target trip', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const first = await f.seed(1); const targetOrder = await f.seed(59); assert.equal((await f.assign(first)).statusCode, 200);
  assert.equal((await f.call(f.manager, 'manager', { action: 'create-trip', tripId: f.id.trip2, distributorUid: f.id.dist2 })).statusCode, 200);
  const departure = new Date(f.start.getTime() + 150 * 60000);
  assert.equal((await f.call(f.manager, 'manager', { action: 'schedule-trip', tripId: f.id.trip2, resourceId: 'resource-b', plannedDeparture: departure.toISOString(), estimatedReturn: new Date(departure.getTime() + 6000000).toISOString() })).statusCode, 200);
  const scheduledAt = new Date(departure.getTime() + 600000).toISOString();
  assert.equal((await f.call(f.manager, 'manager', { action: 'assign-distributor', orderId: targetOrder, tripId: f.id.trip2, distributorUid: f.id.dist2, scheduledAt })).statusCode, 200);
  const reassign = { action: 'reassign-distributor', orderId: first, tripId: f.id.trip2, distributorUid: f.id.dist2, scheduledAt, clientMutationId: 'race-reassign-1' };
  const results = await Promise.all([f.edit(first, 2), f.call(f.manager, 'manager', reassign)]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
  assert.equal(results.find((result) => result.statusCode === 409).body.error.reason, 'TRIP_CAPACITY_EXCEEDED');
  const trip = (await f.db.doc(`deliveryTrips/${f.id.trip2}`).get()).data(); assert.ok(trip.standardContainers <= 60);
}));
