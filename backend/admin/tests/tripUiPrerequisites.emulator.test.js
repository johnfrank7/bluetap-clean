const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: clientApp, deleteApp: deleteClient } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { createAdminDispatchOverrideHandler } = require('../adminDispatchOverrideHandler');
const { createTripCapabilityHandler } = require('../../manager/tripCapabilityHandler');
const { createOrderLoadSnapshot } = require('../../utils/orderLoadSnapshot');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099' && process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.BLUETAP_TRIP_EMULATOR_MODE === '1';
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } });

test('real emulator capability and Admin trip options are authenticated, scoped and read-only', { skip: !enabled, timeout: 60000 }, async () => {
  const suffix = randomUUID(); const app = initializeApp({ projectId: 'demo-bluetap' }, `ui-prereq-${suffix}`); const db = getFirestore(app); const auth = getAdminAuth(app);
  const id = Object.fromEntries(['admin', 'manager', 'distributor', 'requester', 'branch', 'otherBranch', 'order', 'trip', 'otherTrip', 'product'].map((key) => [key, `${key}-${suffix}`]));
  const password = `Test-${randomUUID()}-aA1!`; const client = clientApp({ apiKey: 'synthetic-emulator-key', projectId: 'demo-bluetap' }, `ui-client-${suffix}`); const clientAuth = getAuth(client);
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const call = async (handler, token, query = {}) => { const res = response(); await handler({ method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {}, query }, res); return res; };
  try {
    const security = await db.doc('orderLoadSnapshotSecurity/current').get(); const epoch = security.data()?.epoch;
    assert.ok(security.exists && security.data()?.enabled === true && /^[a-f0-9]{64}$/.test(epoch), 'An existing isolated emulator proof configuration is required.');
    for (const role of ['admin', 'manager', 'distributor', 'requester']) {
      await auth.createUser({ uid: id[role], email: `${id[role]}@example.test`, password });
      if (role === 'admin' || role === 'manager') await auth.setCustomUserClaims(id[role], { role, [role]: true });
    }
    const items = [{ productId: id.product, quantity: 4, productNameSnapshot: 'Water', containerTypeSnapshot: 'Gallon', sizeSnapshot: '5 gallon', loadClassificationSnapshot: 'STANDARD_5_GALLON' }];
    const departure = new Date(Date.now() + 86400000); const end = new Date(departure.getTime() + 7200000);
    const trip = { schemaVersion: 1, tripId: id.trip, branchId: id.branch, distributorUid: id.distributor, resourceId: null, plannedResourceId: 'opaque-a', plannedDeparture: departure, estimatedReturn: end, scheduleConfirmedBy: id.manager, members: [], standardContainers: 0, hasOtherCargo: false, mixedReview: null, managerApproval: null, state: 'planning', revision: 1, manifestRevision: 0 };
    await Promise.all([
      db.doc(`users/${id.admin}`).set({ role: 'admin' }), db.doc(`users/${id.manager}`).set({ role: 'manager', managerStatus: 'active', branchId: id.branch }),
      db.doc(`users/${id.distributor}`).set({ role: 'distributor', approvalStatus: 'active', branchId: id.branch, fullName: 'Test Driver', phone: '09123456789', completeAddress: 'Test Address' }), db.doc(`users/${id.requester}`).set({ role: 'requester' }),
      db.doc(`branches/${id.branch}`).set({ status: 'active' }), db.doc(`branches/${id.otherBranch}`).set({ status: 'active' }),
      db.doc(`requests/${id.order}`).set({ status: 'awaiting_distributor_assignment', branchId: id.branch, currentBranchId: id.branch, items }),
      db.doc(`orderLoadSnapshots/${id.order}`).set(createOrderLoadSnapshot(id.order, items, epoch)),
      db.doc(`distributorDispatchGuards/${id.distributor}`).set({ schemaVersion: 1, initialized: true, distributorUid: id.distributor, revision: 0, reservations: [] }),
      db.doc(`branchDeliveryResources/${id.branch}`).set({ schemaVersion: 1, initialized: true, branchId: id.branch, revision: 0, resources: [{ id: 'opaque-a', verified: true, tripId: null, distributorUid: null }, { id: 'opaque-b', verified: true, tripId: null, distributorUid: null }] }),
      db.doc(`deliveryTrips/${id.trip}`).set(trip), db.doc(`deliveryTrips/${id.otherTrip}`).set({ ...trip, tripId: id.otherTrip, branchId: id.otherBranch }),
    ]);
    const tokens = {};
    for (const role of ['admin', 'manager', 'distributor', 'requester']) tokens[role] = await (await signInWithEmailAndPassword(clientAuth, `${id[role]}@example.test`, password)).user.getIdToken();
    const capability = createTripCapabilityHandler(() => ({ auth, db })); const override = createAdminDispatchOverrideHandler(() => ({ auth, db }));
    for (const role of ['admin', 'manager', 'distributor']) { const res = await call(capability, tokens[role]); assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { tripApprovalAvailable: true, emulatorProjectId: 'demo-bluetap' }); }
    assert.equal((await call(capability, tokens.requester)).statusCode, 403); assert.equal((await call(capability)).statusCode, 401);
    const before = (await db.doc(`deliveryTrips/${id.trip}`).get()).data();
    const listed = await call(override, tokens.admin, { orderId: id.order, tripOptions: '1' });
    assert.equal(listed.statusCode, 200, JSON.stringify(listed.body)); assert.equal(listed.body.trips.length, 1); assert.equal(listed.body.trips[0].tripId, id.trip); assert.equal(listed.body.trips[0].projectedStandardContainers, 4);
    assert.equal(Object.hasOwn(listed.body.trips[0], 'plannedResourceId'), false); assert.deepEqual((await db.doc(`deliveryTrips/${id.trip}`).get()).data(), before);
    await db.doc(`deliveryTrips/${id.trip}`).update({ plannedDeparture: new Date(Date.now() - 7200000), estimatedReturn: new Date(Date.now() - 3600000) });
    assert.deepEqual((await call(override, tokens.admin, { orderId: id.order, tripOptions: '1' })).body.trips, []);
    await db.doc(`deliveryTrips/${id.trip}`).update({ plannedDeparture: departure, estimatedReturn: end });
    assert.equal((await call(override, tokens.manager, { orderId: id.order, tripOptions: '1' })).statusCode, 403);
    const host = process.env.FIRESTORE_EMULATOR_HOST; process.env.FIRESTORE_EMULATOR_HOST = 'firestore.googleapis.com:443';
    try { const invalid = await call(capability, tokens.admin); assert.notEqual(invalid.statusCode, 200); assert.notEqual(invalid.body.tripApprovalAvailable, true); }
    finally { process.env.FIRESTORE_EMULATOR_HOST = host; }
    const prior = process.env.BLUETAP_TRIP_EMULATOR_MODE; delete process.env.BLUETAP_TRIP_EMULATOR_MODE;
    try { assert.deepEqual((await call(capability, tokens.admin)).body, { tripApprovalAvailable: false }); assert.notEqual((await call(override, tokens.admin, { orderId: id.order, tripOptions: '1' })).statusCode, 200); }
    finally { process.env.BLUETAP_TRIP_EMULATOR_MODE = prior; }
    const proofRef = db.doc(`orderLoadSnapshots/${id.order}`); const goodProof = (await proofRef.get()).data();
    await proofRef.set({ ...goodProof, items: [{ ...goodProof.items[0], quantity: 5 }] });
    const unknown = await call(override, tokens.admin, { orderId: id.order, tripOptions: '1' }); assert.equal(unknown.statusCode, 409); assert.equal(unknown.body.error.reason, 'TRIP_LOAD_UNKNOWN');
    await proofRef.set(goodProof);
    const largeOrder = `large-${suffix}`; const largeItems = [{ ...items[0], quantity: 57 }];
    await Promise.all([
      db.doc(`requests/${largeOrder}`).set({ status: 'distributor_assigned', branchId: id.branch, currentBranchId: id.branch, assignedDistributorUid: id.distributor, scheduledAt: null, items: largeItems }),
      db.doc(`orderLoadSnapshots/${largeOrder}`).set(createOrderLoadSnapshot(largeOrder, largeItems, epoch)),
      db.doc(`deliveryTripOrderReservations/${largeOrder}`).set({ orderId: largeOrder, branchId: id.branch, tripId: id.trip }),
      db.doc(`deliveryTrips/${id.trip}`).update({ members: [{ orderId: largeOrder, containers: 57, cargo: [{ productId: id.product, quantity: 57, description: 'Water', classification: 'standard_5_gallon' }] }], standardContainers: 57, manifestRevision: 1, revision: 2 }),
    ]);
    const overCapacity = await call(override, tokens.admin, { orderId: id.order, tripOptions: '1' }); assert.equal(overCapacity.statusCode, 200); assert.deepEqual(overCapacity.body.trips, []);
    await db.doc(`deliveryTrips/${id.trip}`).update({ manifestRevision: -1 });
    assert.equal((await call(override, tokens.admin, { orderId: id.order, tripOptions: '1' })).statusCode, 409);
  } finally { await deleteClient(client); await deleteApp(app); }
});
