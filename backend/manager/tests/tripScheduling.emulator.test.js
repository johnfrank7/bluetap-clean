const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createTrip, allocateOrder, lifecycle, readTripCapacity, planTripSchedule, stageTripSchedule } = require('../../utils/deliveryTripFoundation');
const { createManagerDispatchHandler } = require('../dispatchHandler');
const { createDistributorAssignedOrdersHandler } = require('../../distributor/assignedOrdersHandler');
const { createAdminDispatchOverrideHandler } = require('../../admin/adminDispatchOverrideHandler');
const { createAdminAccountsHandler } = require('../../admin/accountManagementHandler');
const { createOrderLoadSnapshot } = require('../../utils/orderLoadSnapshot');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.BLUETAP_TRIP_EMULATOR_MODE === '1';
async function fixture(run) {
  const suffix = randomUUID(); const app = initializeApp({ projectId: 'demo-bluetap' }, `schedule-${suffix}`); const db = getFirestore(app);
  const id = Object.fromEntries(['branch', 'other', 'manager', 'admin', 'dist', 'dist2', 'one', 'two', 'three'].map((key) => [key, `${key}-${suffix}`]));
  const manager = { decoded: { uid: id.manager, role: 'manager', manager: true }, branch: { id: id.branch } };
  const at = (minutes) => new Date(Date.now() + 86400000 + minutes * 60000);
  const create = (tripId, uid) => db.runTransaction((tx) => createTrip(tx, db, { tripId, distributorUid: uid, manager }));
  const args = (tripId, resourceId, start, end) => ({ tripId, resourceId, plannedDeparture: start, estimatedReturn: end, manager });
  const schedule = (input) => db.runTransaction(async (tx) => { const plan = await planTripSchedule(tx, db, input); stageTripSchedule(tx, plan); });
  try {
    await Promise.all([
      db.doc(`branches/${id.branch}`).set({ status: 'active' }),
      db.doc(`branches/${id.other}`).set({ status: 'active' }),
      db.doc(`users/${id.manager}`).set({ role: 'manager', managerStatus: 'active', branchId: id.branch }),
      db.doc(`users/${id.admin}`).set({ role: 'admin' }),
      ...[id.dist, id.dist2].flatMap((uid) => [
        db.doc(`users/${uid}`).set({ role: 'distributor', approvalStatus: 'active', branchId: id.branch, fullName: 'Test Driver', email: `${uid}@example.test`, phone: '09123456789', completeAddress: 'Test Barangay' }),
        db.doc(`distributorDispatchGuards/${uid}`).set({ schemaVersion: 1, initialized: true, distributorUid: uid, revision: 0, reservations: [] }),
      ]),
      db.doc(`branchDeliveryResources/${id.branch}`).set({ schemaVersion: 1, initialized: true, branchId: id.branch, revision: 0, resources: [{ id: 'opaque-a', verified: true, tripId: null, distributorUid: null }, { id: 'opaque-b', verified: true, tripId: null, distributorUid: null }] }),
    ]);
    await run({ db, id, manager, at, create, args, schedule });
  } finally { await deleteApp(app); }
}
const rejects = (promise, reason) => assert.rejects(promise, (error) => error.reason === reason);

for (const outcome of ['failed', 'delivered']) test(`emulator retains the resource and permits a genuine ${outcome} outcome after return is reported`, { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const epoch = 'a'.repeat(64); await f.db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch });
  const auth = { app: { options: { projectId: 'demo-bluetap' } }, async verifyIdToken(token) { return token === 'manager' ? { uid: f.id.manager, role: 'manager', manager: true } : { uid: f.id.dist, role: 'distributor' }; }, async getUser(uid) { return { uid, disabled: false }; } };
  const manager = createManagerDispatchHandler(() => ({ auth, db: f.db })); const driver = createDistributorAssignedOrdersHandler(() => ({ auth, db: f.db }));
  const call = async (handler, token, body) => { const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } }; await handler({ method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body }, res); return res; };
  const start = f.at(0); const orderId = `active-return-${randomUUID()}`; const productId = `water-${randomUUID()}`;
  const items = [{ productId, quantity: 1, productNameSnapshot: 'Water', containerTypeSnapshot: 'Gallon', sizeSnapshot: '5 gallon', loadClassificationSnapshot: 'STANDARD_5_GALLON' }];
  await f.db.doc(`requests/${orderId}`).set({ status: 'awaiting_distributor_assignment', branchId: f.id.branch, currentBranchId: f.id.branch, requesterUid: `requester-${randomUUID()}`, items });
  await f.db.doc(`orderLoadSnapshots/${orderId}`).set(createOrderLoadSnapshot(orderId, items, epoch));
  const actions = [
    [manager, 'manager', { action: 'create-trip', tripId: f.id.one, distributorUid: f.id.dist }],
    [manager, 'manager', { action: 'schedule-trip', tripId: f.id.one, resourceId: 'opaque-a', plannedDeparture: start.toISOString(), estimatedReturn: new Date(start.getTime() + 120 * 60000).toISOString() }],
    [manager, 'manager', { action: 'assign-distributor', tripId: f.id.one, orderId, distributorUid: f.id.dist, scheduledAt: start.toISOString() }],
  ];
  for (const args of actions) { const result = await call(...args); assert.equal(result.statusCode, 200, JSON.stringify(result.body)); }
  const revision = (await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data().revision;
  for (const args of [
    [manager, 'manager', { action: 'approve-trip', tripId: f.id.one, expectedRevision: revision }],
    [driver, 'driver', { action: 'accept-assignment', orderId }],
    [manager, 'manager', { action: 'reserve-trip-resource', tripId: f.id.one, resourceId: 'opaque-a' }],
    [driver, 'driver', { action: 'report-trip-loading', tripId: f.id.one }],
    [manager, 'manager', { action: 'confirm-trip-loading', tripId: f.id.one }],
    [driver, 'driver', { action: 'start-delivery', orderId }],
    [driver, 'driver', { action: 'report-trip-unloading', tripId: f.id.one }],
  ]) { const result = await call(...args); assert.equal(result.statusCode, 200, JSON.stringify(result.body)); }
  const orderBefore = (await f.db.doc(`requests/${orderId}`).get()).data();
  assert.equal(orderBefore.status, 'out_for_delivery');
  assert.ok(orderBefore.activeDeliveryAttemptId);
  const attemptRef = f.db.doc(`deliveryAttempts/${orderBefore.activeDeliveryAttemptId}`);
  const attemptBefore = (await attemptRef.get()).data();
  const confirmation = await call(manager, 'manager', { action: 'confirm-trip-unloading', tripId: f.id.one });
  assert.equal(confirmation.statusCode, 409, JSON.stringify(confirmation.body));
  assert.equal((await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data().state, 'return_reported');
  assert.equal((await f.db.doc(`branchDeliveryResources/${f.id.branch}`).get()).data().resources[0].tripId, f.id.one);
  assert.deepEqual((await f.db.doc(`requests/${orderId}`).get()).data(), orderBefore);
  assert.deepEqual((await attemptRef.get()).data(), attemptBefore);
  const completion = outcome === 'failed' ? { action: 'fail-delivery', orderId, failureReasonCode: 'CUSTOMER_UNAVAILABLE' } : { action: 'mark-delivered', orderId };
  const [result, concurrentConfirmation] = await Promise.all([call(driver, 'driver', completion), call(manager, 'manager', { action: 'confirm-trip-unloading', tripId: f.id.one })]);
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.ok([200, 409].includes(concurrentConfirmation.statusCode), JSON.stringify(concurrentConfirmation.body));
  assert.equal((await attemptRef.get()).data().outcome, outcome);
  if (concurrentConfirmation.statusCode === 409) {
    assert.equal((await f.db.doc(`branchDeliveryResources/${f.id.branch}`).get()).data().resources[0].tripId, f.id.one);
    assert.equal((await call(manager, 'manager', { action: 'confirm-trip-unloading', tripId: f.id.one })).statusCode, 200);
  }
  assert.equal((await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data().state, 'closed');
  assert.equal((await f.db.doc(`branchDeliveryResources/${f.id.branch}`).get()).data().resources[0].tripId, null);
}));

test('emulator schedules distinct trip intervals with a thirty-minute turnaround', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const start = f.at(0); const at = (minutes) => new Date(start.getTime() + minutes * 60000);
  await Promise.all([f.create(f.id.one, f.id.dist), f.create(f.id.two, f.id.dist), f.create(f.id.three, f.id.dist2)]);
  await f.schedule(f.args(f.id.one, 'opaque-a', at(0), at(60)));
  await rejects(f.schedule(f.args(f.id.two, 'opaque-b', at(89), at(120))), 'TRIP_SCHEDULE_CONFLICT');
  await f.schedule(f.args(f.id.two, 'opaque-b', at(90), at(120)));
  await rejects(f.schedule(f.args(f.id.three, 'opaque-a', at(30), at(45))), 'TRIP_SCHEDULE_CONFLICT');
  const saved = (await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data();
  assert.equal(saved.plannedDeparture.toMillis(), at(0).getTime()); assert.equal(saved.estimatedReturn.toMillis(), at(60).getTime());
}));

test('emulator Manager schedule action records the approved interval without assigning orders', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await f.create(f.id.one, f.id.dist);
  const auth = { async verifyIdToken() { return { uid: f.id.manager, role: 'manager', manager: true }; }, async getUser(uid) { return { uid, disabled: false }; } };
  const handler = createManagerDispatchHandler(() => ({ auth, db: f.db }));
  const result = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
  await handler({ method: 'PATCH', headers: { authorization: 'Bearer manager' }, body: { action: 'schedule-trip', tripId: f.id.one, resourceId: 'opaque-a', plannedDeparture: f.at(0).toISOString(), estimatedReturn: f.at(120).toISOString() } }, result);
  assert.equal(result.statusCode, 200);
  const trip = (await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data();
  assert.equal(trip.scheduleConfirmedBy, f.id.manager); assert.equal(trip.members.length, 0); assert.equal(trip.resourceId, null);
}));

test('emulator serializes trip creation against Distributor branch change', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  let count = 0; let release; const barrier = new Promise((resolve) => { release = resolve; });
  const db = { _settings: f.db._settings, collection: f.db.collection.bind(f.db), runTransaction: (fn) => f.db.runTransaction((tx) => fn(new Proxy(tx, { get(target, key) {
    if (key === 'get') return async (ref) => { if (ref.path === `distributorDispatchGuards/${f.id.dist}` && count < 2) { count++; if (count === 2) release(); await barrier; } return target.get(ref); };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } }))) };
  const auth = { async verifyIdToken(token) { return token === 'admin' ? { uid: f.id.admin, role: 'admin', admin: true } : { uid: f.id.manager, role: 'manager', manager: true }; }, async getUser(uid) { return { uid, disabled: false, email: `${uid}@example.test`, metadata: {} }; } };
  const call = async (handler, token, body) => { const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } }; await handler({ method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body }, res); return res; };
  const results = await Promise.all([
    call(createManagerDispatchHandler(() => ({ auth, db })), 'manager', { action: 'create-trip', tripId: f.id.one, distributorUid: f.id.dist }),
    call(createAdminAccountsHandler(() => ({ auth, db })), 'admin', { action: 'updateAccount', uid: f.id.dist, branchId: f.id.other }),
  ]);
  assert.deepEqual(results.map((item) => item.statusCode).sort(), [200, 409]);
  const trip = await f.db.doc(`deliveryTrips/${f.id.one}`).get(); const profile = (await f.db.doc(`users/${f.id.dist}`).get()).data();
  assert.equal(trip.exists, profile.branchId === f.id.branch);
}));

test('emulator preserves the turnaround rule after a trip is closed', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const start = f.at(0); const at = (minutes) => new Date(start.getTime() + minutes * 60000);
  await f.create(f.id.one, f.id.dist); await f.create(f.id.two, f.id.dist);
  await f.schedule(f.args(f.id.one, 'opaque-a', at(0), at(60)));
  await f.db.doc(`deliveryTrips/${f.id.one}`).update({ state: 'closed', confirmReturnAndUnloading: { uid: f.id.manager } });
  await rejects(f.schedule(f.args(f.id.two, 'opaque-b', at(89), at(120))), 'TRIP_SCHEDULE_CONFLICT');
  await f.schedule(f.args(f.id.two, 'opaque-b', at(90), at(120)));
}));

test('emulator trip mode fails closed for order writers that are not yet coordinated', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const auth = { async verifyIdToken(token) { return token === 'manager' ? { uid: f.id.manager, role: 'manager', manager: true } : token === 'admin' ? { uid: f.id.admin, role: 'admin', admin: true } : { uid: f.id.dist, role: 'distributor' }; }, async getUser(uid) { return { uid, disabled: false }; } };
  const endpoints = [
    [createManagerDispatchHandler(() => ({ auth, db: f.db })), 'manager', { action: 'unsupported-trip-action', orderId: 'order' }],
    [createDistributorAssignedOrdersHandler(() => ({ auth, db: f.db })), 'driver', { action: 'reschedule-delivery', orderId: 'order' }],
    [createAdminDispatchOverrideHandler(() => ({ auth, db: f.db })), 'admin', { orderId: 'order' }],
  ];
  for (const [handler, token, body] of endpoints) {
    const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
    await handler({ method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body }, res);
    assert.equal(res.statusCode, 503); assert.equal(res.body.error.reason, 'TRIP_MODE_INTEGRATION_INCOMPLETE');
  }
}));

test('emulator trip actions retain close stop schedules and require human unloading confirmation', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const epoch = 'a'.repeat(64); await f.db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch });
  const auth = { app: { options: { projectId: 'demo-bluetap' } }, async verifyIdToken(token) { return token === 'manager' ? { uid: f.id.manager, role: 'manager', manager: true } : { uid: token === 'other-driver' ? f.id.dist2 : f.id.dist, role: 'distributor' }; }, async getUser(uid) { return { uid, disabled: false }; } };
  const manager = createManagerDispatchHandler(() => ({ auth, db: f.db })); const driver = createDistributorAssignedOrdersHandler(() => ({ auth, db: f.db }));
  const call = async (handler, token, body) => { const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } }; await handler({ method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body }, res); return res; };
  const read = async (handler, token) => { const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } }; await handler({ method: 'GET', headers: { authorization: `Bearer ${token}` }, query: { tripLifecycle: '1' } }, res); return res; };
  assert.equal((await call(manager, 'manager', { action: 'create-trip', tripId: f.id.one, distributorUid: f.id.dist })).statusCode, 200);
  const start = f.at(0); const productId = `water-${randomUUID()}`; const orderIds = [];
  const scheduled = { action: 'schedule-trip', tripId: f.id.one, resourceId: 'opaque-a', plannedDeparture: start.toISOString(), estimatedReturn: new Date(start.getTime() + 120 * 60000).toISOString() };
  assert.equal((await call(manager, 'manager', scheduled)).statusCode, 200);
  for (const [index, qty] of [30, 29, 1].entries()) {
    const orderId = `stop-${index}-${randomUUID()}`; const items = [{ productId, quantity: qty, productNameSnapshot: 'Water', containerTypeSnapshot: 'Gallon', sizeSnapshot: '5 gallon', loadClassificationSnapshot: 'STANDARD_5_GALLON' }];
    await f.db.doc(`requests/${orderId}`).set({ status: 'awaiting_distributor_assignment', branchId: f.id.branch, currentBranchId: f.id.branch, requesterUid: `requester-${randomUUID()}`, items });
    await f.db.doc(`orderLoadSnapshots/${orderId}`).set(createOrderLoadSnapshot(orderId, items, epoch));
    const assigned = await call(manager, 'manager', { action: 'assign-distributor', tripId: f.id.one, orderId, distributorUid: f.id.dist, scheduledAt: new Date(start.getTime() + index * 10 * 60000).toISOString() });
    assert.equal(assigned.statusCode, 200, JSON.stringify(assigned.body));
    orderIds.push(orderId);
  }
  await f.create(f.id.two, f.id.dist2);
  await f.schedule(f.args(f.id.two, 'opaque-b', new Date(start.getTime() + 150 * 60000), new Date(start.getTime() + 240 * 60000)));
  await f.create(f.id.three, f.id.dist);
  await f.schedule(f.args(f.id.three, 'opaque-a', new Date(start.getTime() + 270 * 60000), new Date(start.getTime() + 360 * 60000)));
  assert.equal((await call(manager, 'manager', { action: 'approve-trip', tripId: f.id.one, expectedRevision: (await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data().revision })).statusCode, 200);
  for (const orderId of orderIds) assert.equal((await call(driver, 'driver', { action: 'accept-assignment', orderId })).statusCode, 200);
  assert.equal((await call(manager, 'manager', { action: 'reserve-trip-resource', tripId: f.id.one, resourceId: 'opaque-a' })).statusCode, 200);
  let view = await read(driver, 'driver'); assert.equal(view.statusCode, 200, JSON.stringify(view.body)); assert.equal(view.body.trips[0].state, 'resource_reserved');
  assert.deepEqual((await read(driver, 'other-driver')).body.trips, []);
  assert.equal((await read(manager, 'driver')).statusCode, 403);
  assert.equal((await call(manager, 'manager', { action: 'confirm-trip-loading', tripId: f.id.one })).statusCode, 409);
  assert.equal((await call(driver, 'driver', { action: 'report-trip-loading', tripId: f.id.one })).statusCode, 200);
  view = await read(manager, 'manager'); assert.equal(view.statusCode, 200, JSON.stringify(view.body)); assert.equal(view.body.trips.find((item) => item.tripId === f.id.one).state, 'loading_reported');
  assert.deepEqual((await Promise.all([call(manager, 'manager', { action: 'confirm-trip-loading', tripId: f.id.one }), call(manager, 'manager', { action: 'confirm-trip-loading', tripId: f.id.one })])).map((res) => res.statusCode), [200, 200]);
  view = await read(driver, 'driver'); assert.equal(view.body.trips.find((item) => item.tripId === f.id.one).state, 'in_transit');
  assert.equal((await call(driver, 'driver', { action: 'start-delivery', orderId: orderIds[0] })).statusCode, 200);
  assert.equal((await call(driver, 'driver', { action: 'mark-delivered', orderId: orderIds[0] })).statusCode, 200);
  assert.equal((await call(driver, 'driver', { action: 'start-delivery', orderId: orderIds[1] })).statusCode, 200);
  assert.equal((await call(driver, 'driver', { action: 'fail-delivery', orderId: orderIds[1], failureReasonCode: 'CUSTOMER_UNAVAILABLE' })).statusCode, 200);
  assert.equal((await call(driver, 'driver', { action: 'start-delivery', orderId: orderIds[2] })).statusCode, 200);
  assert.equal((await call(driver, 'driver', { action: 'fail-delivery', orderId: orderIds[2], failureReasonCode: 'CUSTOMER_UNAVAILABLE' })).statusCode, 200);
  const reassignment = { action: 'reassign-distributor', tripId: f.id.two, orderId: orderIds[1], distributorUid: f.id.dist2, scheduledAt: new Date(start.getTime() + 180 * 60000).toISOString(), clientMutationId: 'trip-reassign-retry' };
  const reschedule = { action: 'reschedule-delivery', tripId: f.id.three, orderId: orderIds[2], scheduledAt: new Date(start.getTime() + 300 * 60000).toISOString(), rescheduleReason: 'Customer unavailable', clientMutationId: 'trip-reschedule-retry' };
  const blocked = await call(manager, 'manager', reassignment);
  assert.equal(blocked.statusCode, 409); assert.equal(blocked.body.error.reason, 'TRIP_UNLOADING_REQUIRED');
  const rescheduleBlocked = await call(manager, 'manager', reschedule);
  assert.equal(rescheduleBlocked.statusCode, 409); assert.equal(rescheduleBlocked.body.error.reason, 'TRIP_UNLOADING_REQUIRED');
  const trip = (await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data();
  assert.equal(trip.members.find((member) => member.orderId === orderIds[0]).stopStatus, 'delivered');
  assert.equal(trip.members.find((member) => member.orderId === orderIds[1]).stopStatus, 'delivery_failed');
  assert.equal(trip.standardContainers, 60);
  assert.equal((await call(driver, 'driver', { action: 'report-trip-unloading', tripId: f.id.one })).statusCode, 200);
  view = await read(manager, 'manager'); assert.equal(view.body.trips.find((item) => item.tripId === f.id.one).state, 'return_reported');
  let resources = (await f.db.doc(`branchDeliveryResources/${f.id.branch}`).get()).data().resources;
  assert.equal(resources.find((item) => item.id === 'opaque-a').tripId, f.id.one);
  assert.equal((await call(manager, 'manager', { action: 'confirm-trip-unloading', tripId: f.id.one })).statusCode, 200);
  view = await read(driver, 'driver'); assert.equal(view.body.trips.find((item) => item.tripId === f.id.one).state, 'closed');
  resources = (await f.db.doc(`branchDeliveryResources/${f.id.branch}`).get()).data().resources;
  assert.equal(resources.find((item) => item.id === 'opaque-a').tripId, null);
  const moved = await call(manager, 'manager', reassignment);
  assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));
  assert.equal((await call(manager, 'manager', reassignment)).statusCode, 200);
  assert.equal((await call(manager, 'manager', { ...reassignment, tripId: f.id.three })).statusCode, 409);
  const oldTrip = (await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data();
  assert.equal(oldTrip.members.find((member) => member.orderId === orderIds[1]).stopStatus, 'delivery_failed');
  assert.equal((await f.db.doc(`deliveryTripOrderReservations/${orderIds[1]}`).get()).data().tripId, f.id.two);
  assert.equal((await f.db.doc(`requests/${orderIds[1]}`).get()).data().assignedDistributorUid, f.id.dist2);
  const rescheduled = await call(manager, 'manager', reschedule);
  assert.equal(rescheduled.statusCode, 200, JSON.stringify(rescheduled.body));
  assert.equal((await call(manager, 'manager', reschedule)).statusCode, 200);
  assert.equal((await call(manager, 'manager', { ...reschedule, tripId: f.id.two })).statusCode, 409);
  assert.equal((await f.db.doc(`deliveryTripOrderReservations/${orderIds[2]}`).get()).data().tripId, f.id.three);
  assert.equal((await f.db.doc(`requests/${orderIds[2]}`).get()).data().assignedDistributorUid, f.id.dist);
}));

test('emulator Manager assignments share one trip and serialize competition for its last container', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const epoch = 'a'.repeat(64); await f.db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch });
  const auth = { async verifyIdToken() { return { uid: f.id.manager, role: 'manager', manager: true }; }, async getUser(uid) { return { uid, disabled: false }; } };
  const handler = createManagerDispatchHandler(() => ({ auth, db: f.db }));
  const call = async (body) => { const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } }; await handler({ method: 'PATCH', headers: { authorization: 'Bearer manager' }, body }, res); return res; };
  await f.create(f.id.one, f.id.dist); const start = f.at(0); const end = new Date(start.getTime() + 120 * 60000);
  await f.schedule(f.args(f.id.one, 'opaque-a', start, end));
  const orders = [];
  for (const qty of [59, 1, 1]) {
    const orderId = `pending-${randomUUID()}`; const items = [{ productId: 'water', quantity: qty, productNameSnapshot: 'Water', containerTypeSnapshot: 'Gallon', sizeSnapshot: '5 gallon', loadClassificationSnapshot: 'STANDARD_5_GALLON' }];
    await f.db.doc(`requests/${orderId}`).set({ status: 'awaiting_distributor_assignment', branchId: f.id.branch, currentBranchId: f.id.branch, items });
    await f.db.doc(`orderLoadSnapshots/${orderId}`).set(createOrderLoadSnapshot(orderId, items, epoch)); orders.push(orderId);
  }
  const assignment = (orderId, minutes) => ({ action: 'assign-distributor', tripId: f.id.one, orderId, distributorUid: f.id.dist, scheduledAt: new Date(start.getTime() + minutes * 60000).toISOString(), clientMutationId: `assign-${orderId}` });
  assert.equal((await call(assignment(orders[0], 10))).statusCode, 200);
  assert.equal((await call(assignment(orders[0], 10))).statusCode, 200);
  assert.equal((await call({ ...assignment(orders[0], 10), tripId: f.id.two })).statusCode, 409);
  const results = await Promise.all([call(assignment(orders[1], 20)), call(assignment(orders[2], 25))]);
  assert.deepEqual(results.map((item) => item.statusCode).sort(), [200, 409]);
  assert.equal(results.find((item) => item.statusCode === 409).body.error.reason, 'TRIP_CAPACITY_EXCEEDED');
  const trip = (await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data(); assert.equal(trip.standardContainers, 60); assert.equal(trip.members.length, 2);
}));

test('Manager preparation reads verified cargo and binds approval to the reviewed schedule and revision', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const epoch = 'a'.repeat(64); await f.db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch });
  const auth = { app: { options: { projectId: 'demo-bluetap' } }, async verifyIdToken(token) { return token === 'driver' ? { uid: f.id.dist, role: 'distributor' } : { uid: f.id.manager, role: 'manager', manager: true }; }, async getUser(uid) { return { uid, disabled: false }; } };
  const manager = createManagerDispatchHandler(() => ({ auth, db: f.db })); const driver = createDistributorAssignedOrdersHandler(() => ({ auth, db: f.db }));
  const invoke = async (handler, token, body) => { const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } }; await handler({ method: body ? 'PATCH' : 'GET', headers: { authorization: `Bearer ${token}` }, ...(body ? { body } : { query: { tripPreparation: '1' } }) }, res); return res; };
  const capacity = async (tripId = '') => { const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } }; await manager({ method: 'GET', headers: { authorization: 'Bearer manager' }, query: { tripPreparation: '1', capacityOnly: '1', tripId } }, res); return res; };
  const order = async (qty, other = false, proof = true) => {
    const orderId = `prepare-${randomUUID()}`; const items = [{ productId: 'water', quantity: qty, productNameSnapshot: 'Water', containerTypeSnapshot: 'Gallon', sizeSnapshot: '5 gallon', loadClassificationSnapshot: 'STANDARD_5_GALLON' }];
    if (other) items.push({ productId: 'bottles', quantity: 2, productNameSnapshot: '24-pack', containerTypeSnapshot: '', sizeSnapshot: '', loadClassificationSnapshot: 'OTHER_CARGO' });
    await f.db.doc(`requests/${orderId}`).set({ status: 'awaiting_distributor_assignment', branchId: f.id.branch, currentBranchId: f.id.branch, items });
    if (proof) await f.db.doc(`orderLoadSnapshots/${orderId}`).set(createOrderLoadSnapshot(orderId, items, epoch));
    return orderId;
  };
  const first = await order(59); const second = await order(1, true); const overflow = await order(1); const unknown = await order(1, false, false);
  assert.deepEqual((await capacity()).body, { distributors: [], selectedTrip: null });
  await f.db.doc(`users/${f.id.dist2}`).update({ accountActionHoldIntentId: 'safety-hold' });
  let view = await invoke(manager, 'manager'); assert.equal(view.statusCode, 200, JSON.stringify(view.body)); assert.equal(view.body.orders.find((item) => item.orderId === unknown).verified, false); assert.equal(view.body.resources.length, 2); assert.ok(view.body.eligibleDistributorUids.includes(f.id.dist)); assert.ok(!view.body.eligibleDistributorUids.includes(f.id.dist2));
  assert.equal((await invoke(manager, 'driver')).statusCode, 403);
  assert.equal((await invoke(manager, 'manager', { action: 'create-trip', tripId: f.id.one, distributorUid: f.id.dist })).statusCode, 200);
  let capacityView = await capacity(f.id.one); assert.equal(capacityView.statusCode, 200, JSON.stringify(capacityView.body)); assert.equal(capacityView.body.selectedTrip.standardContainers, 0); assert.equal(capacityView.body.selectedTrip.resourceStatus, 'unscheduled'); assert.equal(capacityView.body.selectedTrip.mixedReviewStatus, 'not_required'); assert.ok(!JSON.stringify(capacityView.body).includes('opaque-a'));
  view = await invoke(manager, 'manager'); assert.equal(view.body.trips[0].plannedDeparture, null); assert.ok(view.body.resources.every((item) => item.available));
  const start = f.at(0); const end = new Date(start.getTime() + 120 * 60000);
  const schedule = { action: 'schedule-trip', tripId: f.id.one, resourceId: 'opaque-a', plannedDeparture: start.toISOString(), estimatedReturn: end.toISOString() };
  assert.equal((await invoke(manager, 'manager', schedule)).statusCode, 200);
  const assign = (orderId, minutes) => ({ action: 'assign-distributor', tripId: f.id.one, orderId, distributorUid: f.id.dist, scheduledAt: new Date(start.getTime() + minutes * 60000).toISOString(), clientMutationId: `prepare-${orderId}` });
  assert.equal((await invoke(manager, 'manager', assign(first, 10))).statusCode, 200);
  capacityView = await capacity(f.id.one); assert.equal(capacityView.body.selectedTrip.standardContainers, 59);
  const stale = (await invoke(manager, 'manager')).body.trips[0].revision;
  assert.equal((await invoke(manager, 'manager', assign(second, 20))).statusCode, 200);
  assert.equal((await invoke(manager, 'manager', assign(overflow, 25))).body.error.reason, 'TRIP_CAPACITY_EXCEEDED');
  assert.equal((await invoke(manager, 'manager', assign(unknown, 25))).body.error.reason, 'TRIP_LOAD_UNKNOWN');
  view = await invoke(manager, 'manager'); const reviewed = view.body.trips[0]; assert.equal(reviewed.standardContainers, 60); assert.equal(reviewed.hasOtherCargo, true); assert.equal(reviewed.members.length, 2); assert.ok(reviewed.members.some((item) => item.cargo.some((cargo) => cargo.description === '24-pack')));
  capacityView = await capacity(f.id.one); assert.equal(capacityView.body.selectedTrip.standardContainers, 60); assert.equal(capacityView.body.selectedTrip.resourceStatus, 'available'); assert.equal(capacityView.body.selectedTrip.mixedReviewStatus, 'required');
  await f.create(f.id.two, f.id.dist); capacityView = await capacity(f.id.one); assert.equal(capacityView.body.distributors.find((item) => item.distributorUid === f.id.dist).tripCount, 2); assert.equal(capacityView.body.selectedTrip.tripId, f.id.one);
  const reservationRef = f.db.doc(`deliveryTripOrderReservations/${first}`); const reservation = (await reservationRef.get()).data(); await reservationRef.delete();
  capacityView = await capacity(f.id.one); assert.equal(capacityView.body.selectedTrip.verified, false); assert.equal(capacityView.body.selectedTrip.standardContainers, null); await reservationRef.set(reservation);
  assert.equal((await invoke(manager, 'manager', { action: 'approve-trip', tripId: f.id.one, expectedRevision: stale, mixedLoadConfirmed: true })).body.error.reason, 'TRIP_REVIEW_STALE');
  assert.equal((await invoke(manager, 'manager', { action: 'approve-trip', tripId: f.id.one, expectedRevision: reviewed.revision })).body.error.reason, 'TRIP_MIXED_REVIEW_REQUIRED');
  const approve = { action: 'approve-trip', tripId: f.id.one, expectedRevision: reviewed.revision, mixedLoadConfirmed: true };
  assert.equal((await invoke(manager, 'manager', approve)).statusCode, 200); const approved = (await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data();
  capacityView = await capacity(f.id.one); assert.equal(capacityView.body.selectedTrip.mixedReviewStatus, 'confirmed');
  assert.equal((await invoke(manager, 'manager', approve)).statusCode, 200); assert.equal((await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data().revision, approved.revision);
  assert.equal((await invoke(manager, 'manager', { ...schedule, estimatedReturn: new Date(end.getTime() + 60000).toISOString() })).statusCode, 200);
  const changed = (await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data(); assert.equal(changed.state, 'planning'); assert.equal(changed.managerApproval, null); assert.equal(changed.mixedReview, null);
  assert.equal((await invoke(manager, 'manager', { action: 'reserve-trip-resource', tripId: f.id.one, resourceId: 'opaque-a' })).body.error.reason, 'TRIP_APPROVAL_REQUIRED');
  assert.equal((await invoke(manager, 'manager', { ...approve, expectedRevision: changed.revision })).statusCode, 200);
  assert.equal((await invoke(manager, 'manager', { action: 'reserve-trip-resource', tripId: f.id.one, resourceId: 'opaque-a' })).statusCode, 200);
  capacityView = await capacity(f.id.one); assert.equal(capacityView.body.selectedTrip.state, 'resource_reserved'); assert.equal(capacityView.body.selectedTrip.resourceStatus, 'reserved'); assert.equal(capacityView.body.selectedTrip.standardContainers, 60);
  assert.equal((await invoke(driver, 'driver', { action: 'report-trip-loading', tripId: f.id.one })).statusCode, 200);
  await f.schedule(f.args(f.id.two, 'opaque-a', new Date(start.getTime() + 160 * 60000), new Date(start.getTime() + 240 * 60000)));
  capacityView = await capacity(f.id.two); assert.equal(capacityView.body.selectedTrip.resourceStatus, 'occupied'); assert.equal(capacityView.body.selectedTrip.standardContainers, 0);
  capacityView = await capacity(f.id.one); assert.equal(capacityView.body.selectedTrip.state, 'loading_reported'); assert.equal(capacityView.body.selectedTrip.resourceStatus, 'reserved');
}));

test('capacity reads verify 45 containers and stale proofs without querying order history', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const epoch = 'a'.repeat(64); await f.db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch });
  const auth = { app: { options: { projectId: 'demo-bluetap' } }, async verifyIdToken() { return { uid: f.id.manager, role: 'manager', manager: true }; }, async getUser(uid) { return { uid, disabled: false }; } };
  const handler = createManagerDispatchHandler(() => ({ auth, db: f.db })); const call = async (body) => { const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } }; await handler({ method: 'PATCH', headers: { authorization: 'Bearer manager' }, body }, res); return res; };
  await f.create(f.id.one, f.id.dist); const start = f.at(0); await f.schedule(f.args(f.id.one, 'opaque-a', start, new Date(start.getTime() + 120 * 60000)));
  const orderId = `capacity-${randomUUID()}`; const items = [{ productId: 'water', quantity: 45, productNameSnapshot: 'Water', containerTypeSnapshot: 'Gallon', sizeSnapshot: '5 gallon', loadClassificationSnapshot: 'STANDARD_5_GALLON' }];
  const proofRef = f.db.doc(`orderLoadSnapshots/${orderId}`); const proof = createOrderLoadSnapshot(orderId, items, epoch);
  await f.db.doc(`requests/${orderId}`).set({ status: 'awaiting_distributor_assignment', branchId: f.id.branch, currentBranchId: f.id.branch, items }); await proofRef.set(proof);
  assert.equal((await call({ action: 'assign-distributor', tripId: f.id.one, orderId, distributorUid: f.id.dist, scheduledAt: new Date(start.getTime() + 10 * 60000).toISOString(), clientMutationId: `capacity-${orderId}` })).statusCode, 200);
  const isolated = { _settings: f.db._settings, runTransaction: f.db.runTransaction.bind(f.db), collection(name) { const collection = f.db.collection(name); return name === 'requests' ? { doc: collection.doc.bind(collection), where() { throw new Error('Historical order query is forbidden'); } } : collection; } };
  let result = await readTripCapacity(isolated, auth, f.manager, f.id.one); assert.equal(result.selectedTrip.standardContainers, 45); assert.equal(result.selectedTrip.verified, true);
  assert.equal((await readTripCapacity(isolated, auth, f.manager)).distributors[0].soleActiveTrip, null);
  await proofRef.set({ ...proof, items: [{ ...proof.items[0], quantity: 44 }] });
  result = await readTripCapacity(isolated, auth, f.manager, f.id.one); assert.equal(result.selectedTrip.verified, false); assert.equal(result.selectedTrip.standardContainers, null);
  await proofRef.set(proof);
  const secondId = `capacity-${randomUUID()}`; const secondItems = [{ ...items[0], quantity: 5 }, { productId: 'bottles', quantity: 1, productNameSnapshot: '24-pack', containerTypeSnapshot: '', sizeSnapshot: '', loadClassificationSnapshot: 'OTHER_CARGO' }];
  await f.db.doc(`requests/${secondId}`).set({ status: 'awaiting_distributor_assignment', branchId: f.id.branch, currentBranchId: f.id.branch, items: secondItems }); await f.db.doc(`orderLoadSnapshots/${secondId}`).set(createOrderLoadSnapshot(secondId, secondItems, epoch));
  assert.equal((await call({ action: 'assign-distributor', tripId: f.id.one, orderId: secondId, distributorUid: f.id.dist, scheduledAt: new Date(start.getTime() + 20 * 60000).toISOString(), clientMutationId: `capacity-${secondId}` })).statusCode, 200);
  result = await readTripCapacity(isolated, auth, f.manager, f.id.one); assert.equal(result.selectedTrip.standardContainers, 50); assert.equal(result.selectedTrip.mixedReviewStatus, 'required');
  const revision = (await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data().revision;
  assert.equal((await call({ action: 'approve-trip', tripId: f.id.one, expectedRevision: revision, mixedLoadConfirmed: true })).statusCode, 200);
  assert.equal((await call({ action: 'reserve-trip-resource', tripId: f.id.one, resourceId: 'opaque-a' })).statusCode, 200);
  result = await readTripCapacity(isolated, auth, f.manager); assert.equal(result.selectedTrip, null); assert.equal(result.distributors[0].soleActiveTrip.standardContainers, 50); assert.equal(result.distributors[0].soleActiveTrip.resourceStatus, 'reserved'); assert.equal(result.distributors[0].soleActiveTrip.mixedReviewStatus, 'confirmed');
  await f.create(f.id.two, f.id.dist);
  result = await readTripCapacity(isolated, auth, f.manager); assert.equal(result.distributors[0].tripCount, 2); assert.equal(result.distributors[0].soleActiveTrip, null);
  result = await readTripCapacity(isolated, auth, f.manager, f.id.one); assert.equal(result.selectedTrip.standardContainers, 50); assert.equal(result.distributors[0].soleActiveTrip, null);
}));

test('emulator leaves an unscheduled legacy reservation intact and blocks new commitments', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await f.create(f.id.one, f.id.dist); const orderId = `legacy-${randomUUID()}`;
  await f.db.doc(`requests/${orderId}`).set({ status: 'accepted', assignedDistributorUid: f.id.dist, branchId: f.id.branch, scheduledAt: null });
  await f.db.doc(`distributorDispatchGuards/${f.id.dist}`).update({ reservations: [{ orderId, scheduledAt: null }] });
  await rejects(f.db.runTransaction((tx) => allocateOrder(tx, f.db, { tripId: f.id.one, orderId, manager: f.manager })), 'TRIP_LEGACY_UNRESOLVED');
  await rejects(f.schedule(f.args(f.id.one, 'opaque-a', f.at(0), f.at(120))), 'TRIP_LEGACY_UNRESOLVED');
  const saved = (await f.db.doc(`distributorDispatchGuards/${f.id.dist}`).get()).data(); assert.equal(saved.reservations[0].scheduledAt, null); assert.equal(saved.reservations[0].orderId, orderId);
}));

test('emulator blocks a branch resource when another legacy assignment has unknown occupancy', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await f.create(f.id.one, f.id.dist); const orderId = `other-legacy-${randomUUID()}`;
  await f.db.doc(`requests/${orderId}`).set({ status: 'accepted', assignedDistributorUid: f.id.dist2, branchId: f.id.branch, scheduledAt: null });
  await f.db.doc(`distributorDispatchGuards/${f.id.dist2}`).update({ reservations: [{ orderId, scheduledAt: null }] });
  await rejects(f.schedule(f.args(f.id.one, 'opaque-a', f.at(0), f.at(120))), 'TRIP_LEGACY_UNRESOLVED');
  assert.equal((await f.db.doc(`requests/${orderId}`).get()).data().scheduledAt, null);
}));

test('emulator serializes competing trip intervals and rolls back staged schedule writes', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await Promise.all([f.create(f.id.one, f.id.dist), f.create(f.id.two, f.id.dist)]);
  const start = f.at(0); const end = new Date(start.getTime() + 3600000); let count = 0; let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const attempt = (tripId) => { let first = true; return f.db.runTransaction(async (tx) => {
    if (first) { first = false; count++; if (count === 2) release(); await gate; }
    const plan = await planTripSchedule(tx, f.db, f.args(tripId, 'opaque-a', start, end)); stageTripSchedule(tx, plan);
  }); };
  const results = await Promise.allSettled([attempt(f.id.one), attempt(f.id.two)]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.find((item) => item.status === 'rejected').reason.reason, 'TRIP_SCHEDULE_CONFLICT');
  await f.create(f.id.three, f.id.dist2);
  await assert.rejects(f.db.runTransaction(async (tx) => { const plan = await planTripSchedule(tx, f.db, f.args(f.id.three, 'opaque-b', start, end)); stageTripSchedule(tx, plan); throw new Error('rollback'); }), /rollback/);
  assert.equal((await f.db.doc(`deliveryTrips/${f.id.three}`).get()).data().plannedDeparture, undefined);
}));

test('emulator rejects a missing reservation without starting or writing an attempt', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const orderId = `missing-reservation-${randomUUID()}`;
  await f.db.doc(`requests/${orderId}`).set({ status: 'scheduled', branchId: f.id.branch, currentBranchId: f.id.branch, assignedDistributorUid: f.id.dist, distributor_id: f.id.dist, requesterUid: `requester-${randomUUID()}`, assignmentVersion: 1, items: [] });
  await f.db.doc(`deliveryTrips/${f.id.one}`).set({ schemaVersion: 1, tripId: f.id.one, branchId: f.id.branch, distributorUid: f.id.dist, resourceId: null, state: 'approved', members: [{ orderId, containers: 1, cargo: [{ productId: 'water', description: 'Water', quantity: 1, classification: 'standard_5_gallon' }] }], standardContainers: 1, hasOtherCargo: false, revision: 1, manifestRevision: 1 });
  const auth = { async verifyIdToken() { return { uid: f.id.dist, role: 'distributor' }; }, async getUser(uid) { return { uid, disabled: false }; } };
  const handler = createDistributorAssignedOrdersHandler(() => ({ auth, db: f.db }));
  const response = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
  const before = (await f.db.doc(`requests/${orderId}`).get()).data();
  const beforeTrip = (await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data();
  await handler({ method: 'PATCH', headers: { authorization: 'Bearer driver' }, body: { action: 'start-delivery', orderId } }, response);
  assert.equal(response.statusCode, 409); assert.equal(response.body.error.reason, 'TRIP_INVALID');
  assert.deepEqual((await f.db.doc(`requests/${orderId}`).get()).data(), before);
  assert.deepEqual((await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data(), beforeTrip);
  assert.equal((await f.db.collection('deliveryAttempts').where('orderId', '==', orderId).get()).size, 0);
  assert.equal((await f.db.collection('deliveryAttemptEvents').where('orderId', '==', orderId).get()).size, 0);
}));

test('emulator permits a genuine guarded legacy order to start without trip membership', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const orderId = `legacy-start-${randomUUID()}`; const scheduledAt = f.at(0);
  await f.db.doc(`requests/${orderId}`).set({ status: 'scheduled', branchId: f.id.branch, currentBranchId: f.id.branch, assignedDistributorUid: f.id.dist, requesterUid: `requester-${randomUUID()}`, assignmentVersion: 1, scheduledAt });
  await f.db.doc(`distributorDispatchGuards/${f.id.dist}`).update({ reservations: [{ orderId, scheduledAt }] });
  const auth = { async verifyIdToken() { return { uid: f.id.dist, role: 'distributor' }; }, async getUser(uid) { return { uid, disabled: false }; } };
  const handler = createDistributorAssignedOrdersHandler(() => ({ auth, db: f.db }));
  const response = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
  await handler({ method: 'PATCH', headers: { authorization: 'Bearer driver' }, body: { action: 'start-delivery', orderId } }, response);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal((await f.db.doc(`requests/${orderId}`).get()).data().status, 'out_for_delivery');
}));

test('emulator rejects malformed or orphaned reservations before departure', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const auth = { async verifyIdToken() { return { uid: f.id.dist, role: 'distributor' }; }, async getUser(uid) { return { uid, disabled: false }; } };
  const handler = createDistributorAssignedOrdersHandler(() => ({ auth, db: f.db }));
  for (const tripId of [123, `missing-trip-${randomUUID()}`]) {
    const orderId = `orphan-${randomUUID()}`;
    await f.db.doc(`requests/${orderId}`).set({ status: 'scheduled', branchId: f.id.branch, assignedDistributorUid: f.id.dist, requesterUid: `requester-${randomUUID()}`, assignmentVersion: 1 });
    await f.db.doc(`deliveryTripOrderReservations/${orderId}`).set({ orderId, tripId, branchId: f.id.branch });
    const response = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
    await handler({ method: 'PATCH', headers: { authorization: 'Bearer driver' }, body: { action: 'start-delivery', orderId } }, response);
    assert.equal(response.statusCode, 409); assert.equal(response.body.error.reason, 'TRIP_INVALID');
    assert.equal((await f.db.doc(`requests/${orderId}`).get()).data().status, 'scheduled');
    assert.equal((await f.db.collection('deliveryAttempts').where('orderId', '==', orderId).get()).size, 0);
  }
}));

for (const [name, assignment, status] of [
  ['canonical missing status', 'assignedDistributorUid', undefined],
  ['legacy missing status', 'distributor_id', undefined],
  ['canonical unknown status', 'assignedDistributorUid', 'unexpected_status'],
  ['legacy null status', 'distributor_id', null],
  ['legacy unscheduled active', 'distributor_id', 'accepted'],
]) test(`emulator rejects ${name} occupancy`, { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await f.create(f.id.one, f.id.dist);
  const orderId = `ambiguous-${randomUUID()}`;
  await f.db.doc(`requests/${orderId}`).set({ branchId: f.id.branch, [assignment]: f.id.dist2, scheduledAt: null, ...(status === undefined ? {} : { status }) });
  await rejects(f.schedule(f.args(f.id.one, 'opaque-a', f.at(0), f.at(60))), 'TRIP_LEGACY_UNRESOLVED');
  assert.equal((await f.db.doc(`deliveryTrips/${f.id.one}`).get()).data().plannedDeparture, undefined);
}));

test('emulator permits scheduling alongside verified delivered history', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  await f.create(f.id.one, f.id.dist);
  await f.db.doc(`requests/delivered-${randomUUID()}`).set({ branchId: f.id.branch, assignedDistributorUid: f.id.dist2, status: 'delivered' });
  await f.schedule(f.args(f.id.one, 'opaque-a', f.at(0), f.at(60)));
}));

test('emulator replays unloading after resource reuse without touching its new occupant', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const at = new Date(); const ref = f.db.doc(`deliveryTrips/${f.id.one}`);
  await ref.set({ schemaVersion: 1, tripId: f.id.one, branchId: f.id.branch, distributorUid: f.id.dist, resourceId: 'opaque-a', state: 'return_reported', members: [], standardContainers: 0, hasOtherCargo: false, revision: 2, manifestRevision: 0, reportReturnAndUnloading: { uid: f.id.dist, at } });
  const resources = f.db.doc(`branchDeliveryResources/${f.id.branch}`);
  await resources.update({ resources: [{ id: 'opaque-a', verified: true, tripId: f.id.one, distributorUid: f.id.dist }, { id: 'opaque-b', verified: true, tripId: null, distributorUid: null }] });
  const run = (context) => f.db.runTransaction((tx) => lifecycle(tx, f.db, { tripId: f.id.one, context, action: 'confirmReturnAndUnloading' }));
  await run(f.manager);
  assert.equal((await resources.get()).data().resources[0].tripId, null);
  await resources.update({ resources: [{ id: 'opaque-a', verified: true, tripId: f.id.two, distributorUid: f.id.dist2 }, { id: 'opaque-b', verified: true, tripId: null, distributorUid: null }] });
  const beforeTrip = (await ref.get()).data(); const beforeResources = (await resources.get()).data();
  assert.equal((await run(f.manager)).changed, false);
  await rejects(run({ decoded: { uid: f.id.dist, role: 'distributor' }, branch: { id: f.id.branch } }), 'TRIP_FORBIDDEN');
  assert.deepEqual((await ref.get()).data(), beforeTrip); assert.deepEqual((await resources.get()).data(), beforeResources);
  await ref.update({ reportReturnAndUnloading: { uid: f.id.dist2, at } });
  await rejects(run(f.manager), 'TRIP_INVALID');
  assert.deepEqual((await resources.get()).data(), beforeResources);
}));
