const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp: adminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getAuth: adminAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: clientApp, deleteApp: deleteClientApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { createManagerDispatchHandler } = require('../dispatchHandler');
const { createDistributorAssignedOrdersHandler } = require('../../distributor/assignedOrdersHandler');
const { createOrderLoadSnapshot } = require('../../utils/orderLoadSnapshot');
const { summarizeOrder } = require('../../utils/deliveryTripFoundation');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099' && process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.BLUETAP_TRIP_EMULATOR_MODE === '1';
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });

test('real Auth and Firestore emulators enforce lifecycle roles, branch ownership, reports and release', { skip: !enabled, timeout: 60000 }, async () => {
  const suffix = randomUUID(); const projectId = 'demo-bluetap';
  const admin = adminApp({ projectId }, `lifecycle-${suffix}`); const auth = adminAuth(admin); const db = getFirestore(admin);
  const client = clientApp({ projectId, apiKey: 'synthetic-emulator-key' }, `lifecycle-client-${suffix}`); const clientAuth = getAuth(client);
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const branch = `branch-${suffix}`; const otherBranch = `other-${suffix}`; const manager = `manager-${suffix}`; const outsider = `outside-${suffix}`; const driver = `driver-${suffix}`; const tripId = `trip-${suffix}`; const orderId = `order-${suffix}`;
  const password = `Synthetic-${randomUUID()}-aA1!`; const epoch = 'a'.repeat(64);
  try {
    for (const uid of [manager, outsider, driver]) await auth.createUser({ uid, email: `${uid}@example.test`, password });
    for (const uid of [manager, outsider]) await auth.setCustomUserClaims(uid, { role: 'manager', manager: true });
    const items = [{ productId: 'water', quantity: 1, productNameSnapshot: 'Water', containerTypeSnapshot: 'Gallon', sizeSnapshot: '5 gallon', loadClassificationSnapshot: 'STANDARD_5_GALLON' }];
    const order = { branchId: branch, currentBranchId: branch, assignedDistributorUid: driver, status: 'scheduled', items };
    const proof = createOrderLoadSnapshot(orderId, items, epoch); const member = summarizeOrder(orderId, order, proof, epoch);
    await Promise.all([
      db.doc(`branches/${branch}`).set({ status: 'active' }), db.doc(`branches/${otherBranch}`).set({ status: 'active' }),
      db.doc(`users/${manager}`).set({ role: 'manager', managerStatus: 'active', branchId: branch }),
      db.doc(`users/${outsider}`).set({ role: 'manager', managerStatus: 'active', branchId: otherBranch }),
      db.doc(`users/${driver}`).set({ role: 'distributor', approvalStatus: 'active', branchId: branch, fullName: 'Test Driver', email: `${driver}@example.test`, phone: '09123456789', completeAddress: 'Test Barangay' }),
      db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch }), db.doc(`requests/${orderId}`).set(order), db.doc(`orderLoadSnapshots/${orderId}`).set(proof),
      db.doc(`deliveryTripOrderReservations/${orderId}`).set({ orderId, tripId, branchId: branch }),
      db.doc(`deliveryTrips/${tripId}`).set({ schemaVersion: 1, tripId, branchId: branch, distributorUid: driver, revision: 0, manifestRevision: 1, members: [member], standardContainers: 1, hasOtherCargo: false, resourceId: 'opaque-a', plannedResourceId: 'opaque-a', plannedDeparture: new Date('2030-01-01T01:00:00Z'), estimatedReturn: new Date('2030-01-01T03:00:00Z'), scheduleConfirmedBy: manager, state: 'resource_reserved', managerApproval: { uid: manager, manifestRevision: 1 } }),
      db.doc(`branchDeliveryResources/${branch}`).set({ schemaVersion: 1, initialized: true, branchId: branch, revision: 0, resources: [{ id: 'opaque-a', verified: true, tripId, distributorUid: driver }, { id: 'opaque-b', verified: true, tripId: null, distributorUid: null }] }),
      db.doc(`branchDeliveryResources/${otherBranch}`).set({ schemaVersion: 1, initialized: true, branchId: otherBranch, revision: 0, resources: [{ id: 'other-a', verified: true, tripId: null, distributorUid: null }, { id: 'other-b', verified: true, tripId: null, distributorUid: null }] }),
    ]);
    const token = async (uid) => (await signInWithEmailAndPassword(clientAuth, `${uid}@example.test`, password)).user.getIdToken();
    const managerToken = await token(manager); const outsideToken = await token(outsider); const driverToken = await token(driver);
    const managerHandler = createManagerDispatchHandler(() => ({ auth, db })); const driverHandler = createDistributorAssignedOrdersHandler(() => ({ auth, db }));
    const call = async (handler, credential, body) => { const res = response(); await handler({ method: body ? 'PATCH' : 'GET', headers: { authorization: `Bearer ${credential}` }, ...(body ? { body } : { query: { tripLifecycle: '1' } }) }, res); return res; };
    const prepare = async (credential) => { const res = response(); await managerHandler({ method: 'GET', headers: { authorization: `Bearer ${credential}` }, query: { tripPreparation: '1' } }, res); return res; };
    const capacity = async (credential, selectedTrip = tripId) => { const res = response(); await managerHandler({ method: 'GET', headers: { authorization: `Bearer ${credential}` }, query: { tripPreparation: '1', capacityOnly: '1', tripId: selectedTrip } }, res); return res; };
    assert.equal((await capacity(driverToken)).statusCode, 403); assert.equal((await capacity('invalid-token')).statusCode, 401);
    let capacityView = await capacity(managerToken); assert.equal(capacityView.statusCode, 200, JSON.stringify(capacityView.body)); assert.equal(capacityView.body.selectedTrip.standardContainers, 1); assert.equal(capacityView.body.selectedTrip.state, 'resource_reserved'); assert.ok(!JSON.stringify(capacityView.body).includes('opaque-a'));
    const beforeView = (await db.doc(`deliveryTrips/${tripId}`).get()).data(); const beforeResource = (await db.doc(`branchDeliveryResources/${branch}`).get()).data();
    let reload = await capacity(managerToken, ''); assert.equal(reload.body.selectedTrip, null); assert.equal(reload.body.distributors[0].soleActiveTrip.standardContainers, 1); assert.equal(reload.body.distributors[0].soleActiveTrip.state, 'resource_reserved'); assert.ok(!JSON.stringify(reload.body).includes('opaque-a'));
    assert.deepEqual((await db.doc(`deliveryTrips/${tripId}`).get()).data(), beforeView); assert.deepEqual((await db.doc(`branchDeliveryResources/${branch}`).get()).data(), beforeResource);
    await db.doc(`deliveryTrips/${tripId}`).update({ managerApproval: null });
    reload = await capacity(managerToken, ''); assert.equal(reload.body.distributors[0].soleActiveTrip.verified, false); assert.equal(reload.body.distributors[0].soleActiveTrip.standardContainers, null);
    await db.doc(`deliveryTrips/${tripId}`).update({ managerApproval: { uid: manager, manifestRevision: 1 } });
    assert.equal((await capacity(managerToken, 'nonexistent-trip')).body.distributors[0].soleActiveTrip, null);
    capacityView = await capacity(outsideToken); assert.equal(capacityView.statusCode, 200); assert.equal(capacityView.body.selectedTrip, null); assert.deepEqual(capacityView.body.distributors, []);
    assert.deepEqual((await capacity(outsideToken, '')).body.distributors, []);
    assert.equal((await prepare(driverToken)).statusCode, 403);
    assert.equal((await prepare('invalid-token')).statusCode, 401);
    let preparation = await prepare(managerToken); assert.equal(preparation.statusCode, 200); assert.equal(preparation.body.resources.find((item) => item.id === 'opaque-a').available, false);
    preparation = await prepare(outsideToken); assert.equal(preparation.statusCode, 200); assert.deepEqual(preparation.body.trips, []); assert.ok(preparation.body.resources.every((item) => item.id.startsWith('other-')));
    const resourceRef = db.doc(`branchDeliveryResources/${branch}`); const originalResources = (await resourceRef.get()).data().resources;
    await resourceRef.update({ resources: [{ id: 'opaque-a', verified: true, tripId: null, distributorUid: null }, originalResources[1]] });
    preparation = await prepare(managerToken); assert.equal(preparation.statusCode, 409); assert.equal(preparation.body.error.reason, 'TRIP_RESOURCES_INVALID');
    capacityView = await capacity(managerToken); assert.equal(capacityView.statusCode, 409); assert.equal(capacityView.body.error.reason, 'TRIP_RESOURCES_INVALID');
    await resourceRef.update({ resources: originalResources });
    let result = await call(driverHandler, driverToken); assert.equal(result.statusCode, 200, JSON.stringify(result.body)); assert.equal(result.body.trips[0].state, 'resource_reserved');
    assert.deepEqual((await call(managerHandler, outsideToken)).body.trips, []);
    assert.equal((await call(managerHandler, driverToken)).statusCode, 403);
    assert.equal((await call(driverHandler, 'invalid-token')).statusCode, 401);
    assert.equal((await call(managerHandler, outsideToken, { action: 'confirm-trip-loading', tripId })).statusCode, 403);
    assert.equal((await call(managerHandler, managerToken, { action: 'confirm-trip-loading', tripId })).statusCode, 409);
    assert.equal((await call(managerHandler, managerToken, { action: 'reject-trip-loading', tripId })).statusCode, 503);
    await db.doc(`orderLoadSnapshots/${orderId}`).set({ malformed: true });
    reload = await capacity(managerToken, ''); assert.equal(reload.body.distributors[0].soleActiveTrip.verified, false); assert.equal(reload.body.distributors[0].soleActiveTrip.standardContainers, null);
    assert.equal((await call(driverHandler, driverToken)).statusCode, 409);
    assert.equal((await call(driverHandler, driverToken, { action: 'report-trip-loading', tripId })).statusCode, 409);
    assert.equal((await db.doc(`deliveryTrips/${tripId}`).get()).data().state, 'resource_reserved');
    await db.doc(`orderLoadSnapshots/${orderId}`).set(proof);
    assert.equal((await call(driverHandler, driverToken, { action: 'report-trip-loading', tripId })).statusCode, 200);
    result = await call(managerHandler, managerToken); assert.equal(result.body.trips[0].state, 'loading_reported');
    assert.equal((await call(managerHandler, managerToken, { action: 'confirm-trip-loading', tripId })).statusCode, 200);
    assert.equal((await call(driverHandler, driverToken, { action: 'report-trip-unloading', tripId })).statusCode, 200);
    assert.equal((await db.doc(`branchDeliveryResources/${branch}`).get()).data().resources[0].tripId, tripId);
    result = await call(managerHandler, managerToken); assert.equal(result.body.trips[0].state, 'return_reported');
    assert.deepEqual((await Promise.all([call(managerHandler, managerToken, { action: 'confirm-trip-unloading', tripId }), call(managerHandler, managerToken, { action: 'confirm-trip-unloading', tripId })])).map((item) => item.statusCode), [200, 200]);
    assert.equal((await db.doc(`branchDeliveryResources/${branch}`).get()).data().resources[0].tripId, null);
    reload = await capacity(managerToken, ''); assert.deepEqual(reload.body.distributors, []); assert.equal(reload.body.selectedTrip, null);
    result = await call(driverHandler, driverToken); assert.equal(result.body.trips[0].state, 'closed');
    assert.equal((await call(managerHandler, managerToken, { action: 'confirm-trip-unloading', tripId })).statusCode, 200);
    const reused = [{ id: 'opaque-a', verified: true, tripId: `new-${suffix}`, distributorUid: driver }, { id: 'opaque-b', verified: true, tripId: null, distributorUid: null }];
    await db.doc(`branchDeliveryResources/${branch}`).update({ resources: reused });
    assert.equal((await call(managerHandler, managerToken, { action: 'confirm-trip-unloading', tripId })).statusCode, 200);
    assert.deepEqual((await db.doc(`branchDeliveryResources/${branch}`).get()).data().resources, reused);
    result = await call(driverHandler, driverToken); assert.equal(result.statusCode, 200); assert.equal(result.body.trips[0].state, 'closed');
    await db.doc(`branchDeliveryResources/${branch}`).update({ resources: [{ id: 'opaque-a', verified: true, tripId: null, distributorUid: driver }, reused[1]] });
    result = await call(managerHandler, managerToken); assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'TRIP_RESOURCES_INVALID');
  } finally { await deleteClientApp(client); await deleteAdminApp(admin); }
});
