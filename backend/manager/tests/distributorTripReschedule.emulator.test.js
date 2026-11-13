const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createManagerDispatchHandler } = require('../dispatchHandler');
const { createDistributorAssignedOrdersHandler } = require('../../distributor/assignedOrdersHandler');
const { createOrderLoadSnapshot } = require('../../utils/orderLoadSnapshot');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.BLUETAP_TRIP_EMULATOR_MODE === '1';
const epoch = 'a'.repeat(64); // Existing synthetic emulator-only test configuration.
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } });

async function fixture(run, withSecond = false) {
  const suffix = randomUUID(); const app = initializeApp({ projectId: 'demo-bluetap' }, `proposal-${suffix}`); const db = getFirestore(app);
  const id = Object.fromEntries(['branch', 'other', 'manager', 'otherManager', 'dist', 'otherDist', 'order', 'otherOrder', 'source', 'target', 'water'].map((key) => [key, `${key}-${suffix}`]));
  const auth = { async verifyIdToken(token) { return token === 'driver' ? { uid: id.dist, role: 'distributor' } : token === 'other-driver' ? { uid: id.otherDist, role: 'distributor' } : { uid: token === 'other-manager' ? id.otherManager : id.manager, role: 'manager', manager: true }; }, async getUser(uid) { return { uid, disabled: false }; } };
  const manager = createManagerDispatchHandler(() => ({ auth, db })); const driver = createDistributorAssignedOrdersHandler(() => ({ auth, db }));
  const call = async (handler, token, body, method = 'PATCH', query) => { const res = response(); await handler({ method, headers: { authorization: `Bearer ${token}` }, body, query }, res); return res; };
  const start = new Date(Date.now() + 86400000); const next = new Date(start.getTime() + 160 * 60000); const end = new Date(start.getTime() + 240 * 60000);
  const items = [{ productId: id.water, quantity: 4, productNameSnapshot: 'Water', containerTypeSnapshot: 'Gallon', sizeSnapshot: '5 gallon', loadClassificationSnapshot: 'STANDARD_5_GALLON', unitPriceAtOrder: 20, totalAtOrder: 80, deliveryDaysSnapshot: [] }];
  const proposal = (clientMutationId = 'proposal-after-return') => ({ action: 'propose-reschedule', orderId: id.order, scheduledAt: next.toISOString(), clientMutationId });
  const approve = (proposalId = 'proposal-after-return') => ({ action: 'approve-distributor-reschedule', orderId: id.order, proposalId, tripId: id.target });
  const unload = async () => { assert.equal((await call(driver, 'driver', { action: 'report-trip-unloading', tripId: id.source })).statusCode, 200); assert.equal((await call(manager, 'manager', { action: 'confirm-trip-unloading', tripId: id.source })).statusCode, 200); };
  try {
    await Promise.all([
      db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch }),
      db.doc(`branches/${id.branch}`).set({ name: 'Source', status: 'active' }), db.doc(`branches/${id.other}`).set({ name: 'Other', status: 'active' }),
      db.doc(`users/${id.manager}`).set({ role: 'manager', managerStatus: 'active', branchId: id.branch }), db.doc(`users/${id.otherManager}`).set({ role: 'manager', managerStatus: 'active', branchId: id.other }),
      ...[id.dist, id.otherDist].flatMap((uid) => [db.doc(`users/${uid}`).set({ role: 'distributor', approvalStatus: 'active', branchId: id.branch, fullName: 'Test Driver', phone: '09123456789', completeAddress: 'Test Barangay' }), db.doc(`distributorDispatchGuards/${uid}`).set({ schemaVersion: 1, initialized: true, distributorUid: uid, revision: 0, reservations: [] })]),
      db.doc(`branchDeliveryResources/${id.branch}`).set({ schemaVersion: 1, initialized: true, branchId: id.branch, revision: 0, resources: [{ id: 'resource-a', verified: true, tripId: null, distributorUid: null }, { id: 'resource-b', verified: true, tripId: null, distributorUid: null }] }),
      db.doc(`requests/${id.order}`).set({ status: 'awaiting_distributor_assignment', branchId: id.branch, currentBranchId: id.branch, requesterUid: `requester-${suffix}`, items }),
      db.doc(`orderLoadSnapshots/${id.order}`).set(createOrderLoadSnapshot(id.order, items, epoch)),
      ...(withSecond ? [db.doc(`requests/${id.otherOrder}`).set({ status: 'awaiting_distributor_assignment', branchId: id.branch, currentBranchId: id.branch, requesterUid: `other-requester-${suffix}`, items }), db.doc(`orderLoadSnapshots/${id.otherOrder}`).set(createOrderLoadSnapshot(id.otherOrder, items, epoch))] : []),
    ]);
    for (const tripId of [id.source, id.target]) assert.equal((await call(manager, 'manager', { action: 'create-trip', tripId, distributorUid: id.dist })).statusCode, 200);
    assert.equal((await call(manager, 'manager', { action: 'schedule-trip', tripId: id.source, resourceId: 'resource-a', plannedDeparture: start.toISOString(), estimatedReturn: new Date(start.getTime() + 120 * 60000).toISOString() })).statusCode, 200);
    assert.equal((await call(manager, 'manager', { action: 'schedule-trip', tripId: id.target, resourceId: 'resource-b', plannedDeparture: new Date(start.getTime() + 150 * 60000).toISOString(), estimatedReturn: end.toISOString() })).statusCode, 200);
    assert.equal((await call(manager, 'manager', { action: 'assign-distributor', orderId: id.order, tripId: id.source, distributorUid: id.dist, scheduledAt: new Date(start.getTime() + 10 * 60000).toISOString() })).statusCode, 200);
    if (withSecond) assert.equal((await call(manager, 'manager', { action: 'assign-distributor', orderId: id.otherOrder, tripId: id.source, distributorUid: id.dist, scheduledAt: new Date(start.getTime() + 20 * 60000).toISOString() })).statusCode, 200);
    assert.equal((await call(manager, 'manager', { action: 'approve-trip', tripId: id.source, expectedRevision: (await db.doc(`deliveryTrips/${id.source}`).get()).data().revision })).statusCode, 200);
    assert.equal((await call(driver, 'driver', { action: 'accept-assignment', orderId: id.order })).statusCode, 200);
    if (withSecond) assert.equal((await call(driver, 'driver', { action: 'accept-assignment', orderId: id.otherOrder })).statusCode, 200);
    assert.equal((await call(manager, 'manager', { action: 'reserve-trip-resource', tripId: id.source, resourceId: 'resource-a' })).statusCode, 200);
    assert.equal((await call(driver, 'driver', { action: 'report-trip-loading', tripId: id.source })).statusCode, 200);
    assert.equal((await call(manager, 'manager', { action: 'confirm-trip-loading', tripId: id.source })).statusCode, 200);
    assert.equal((await call(driver, 'driver', { action: 'start-delivery', orderId: id.order })).statusCode, 200);
    assert.equal((await call(driver, 'driver', { action: 'fail-delivery', orderId: id.order, failureReasonCode: 'CUSTOMER_UNAVAILABLE' })).statusCode, 200);
    if (withSecond) { assert.equal((await call(driver, 'driver', { action: 'start-delivery', orderId: id.otherOrder })).statusCode, 200); assert.equal((await call(driver, 'driver', { action: 'fail-delivery', orderId: id.otherOrder, failureReasonCode: 'CUSTOMER_UNAVAILABLE' })).statusCode, 200); }
    await run({ db, id, auth, manager, driver, call, start, next, proposal, approve, unload });
  } finally { await deleteApp(app); }
}

test('direct Manager failed-delivery resolution rejects unsafe targets and overcapacity without writes', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const orderRef = f.db.doc(`requests/${f.id.order}`);
  const body = { action: 'reschedule-delivery', orderId: f.id.order, tripId: f.id.target, scheduledAt: f.next.toISOString(), rescheduleReason: 'Customer requested a new schedule', expectedStatus: 'delivery_failed', clientMutationId: 'direct-resolution-test' };
  const before = (await orderRef.get()).data();
  const loaded = await f.call(f.manager, 'manager', body);
  assert.equal(loaded.body.error.reason, 'TRIP_UNLOADING_REQUIRED');
  assert.deepEqual((await orderRef.get()).data(), before);
  await f.unload();
  const unloaded = (await orderRef.get()).data();
  const invalid = await f.call(f.manager, 'manager', { ...body, tripId: 'does-not-exist' });
  assert.equal(invalid.statusCode, 409);
  assert.deepEqual((await orderRef.get()).data(), unloaded);
  const denied = await f.call(f.manager, 'other-manager', body);
  assert.equal(denied.statusCode, 403);
  const otherOrder = `capacity-${randomUUID()}`;
  const items = unloaded.items.map((item) => ({ ...item, quantity: 57, totalAtOrder: 1140 }));
  await Promise.all([f.db.doc(`requests/${otherOrder}`).set({ status: 'awaiting_distributor_assignment', branchId: f.id.branch, currentBranchId: f.id.branch, requesterUid: `requester-${randomUUID()}`, items }), f.db.doc(`orderLoadSnapshots/${otherOrder}`).set(createOrderLoadSnapshot(otherOrder, items, epoch))]);
  assert.equal((await f.call(f.manager, 'manager', { action: 'assign-distributor', orderId: otherOrder, tripId: f.id.target, distributorUid: f.id.dist, scheduledAt: f.next.toISOString() })).statusCode, 200);
  const full = await f.call(f.manager, 'manager', body);
  assert.equal(full.body.error.reason, 'TRIP_CAPACITY_EXCEEDED');
  assert.deepEqual((await orderRef.get()).data(), unloaded);
}));

test('proposal waits for unloading and Manager approval applies the exact reschedule once', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const orderRef = f.db.doc(`requests/${f.id.order}`); const sourceRef = f.db.doc(`deliveryTrips/${f.id.source}`); const resourceRef = f.db.doc(`branchDeliveryResources/${f.id.branch}`);
  const before = (await orderRef.get()).data(); const source = (await sourceRef.get()).data(); const resources = (await resourceRef.get()).data();
  const first = await f.call(f.driver, 'driver', f.proposal('proposal-before-return')); assert.equal(first.statusCode, 200, JSON.stringify(first.body)); assert.equal(first.body.proposal.status, 'pending');
  const proposed = (await orderRef.get()).data(); const { distributorRescheduleProposals, ...unchanged } = proposed;
  assert.deepEqual(unchanged, before); assert.deepEqual((await sourceRef.get()).data(), source); assert.deepEqual((await resourceRef.get()).data(), resources);
  assert.equal((await f.call(f.driver, 'driver', f.proposal('proposal-before-return'))).statusCode, 200);
  const changed = await f.call(f.driver, 'driver', { ...f.proposal('proposal-before-return'), scheduledAt: new Date(f.next.getTime() + 60000).toISOString() }); assert.equal(changed.body.error.reason, 'RESCHEDULE_PROPOSAL_CONFLICT');
  const list = await f.call(f.manager, 'manager', {}, 'GET'); assert.equal(list.statusCode, 200); assert.equal(list.body.orders.find((item) => item.id === f.id.order).pendingDistributorReschedule.id, 'proposal-before-return');
  assert.equal((await f.call(f.manager, 'other-manager', f.approve('proposal-before-return'))).statusCode, 403);
  assert.equal((await f.call(f.manager, 'manager', f.approve('proposal-before-return'))).body.error.reason, 'TRIP_UNLOADING_REQUIRED');
  await f.unload();
  assert.equal((await f.call(f.manager, 'manager', f.approve('proposal-before-return'))).body.error.reason, 'RESCHEDULE_PROPOSAL_STALE');
  assert.equal((await f.call(f.driver, 'driver', f.proposal())).statusCode, 200);
  const approved = await f.call(f.manager, 'manager', f.approve()); assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  const saved = (await orderRef.get()).data(); assert.equal(saved.status, 'scheduled'); assert.equal(saved.scheduledAt.toMillis(), f.next.getTime());
  assert.equal(saved.assignmentHistory.length, before.assignmentHistory.length + 1); assert.equal(saved.deliveryAttemptSeq, before.deliveryAttemptSeq);
  assert.equal(saved.latestSchedulingEvent.event, 'DELIVERY_RESCHEDULED_BY_MANAGER');
  assert.equal(saved.distributorRescheduleProposals.find((item) => item.id === 'proposal-before-return').status, 'superseded');
  assert.equal(saved.distributorRescheduleProposals.find((item) => item.id === 'proposal-after-return').status, 'approved');
  assert.equal((await f.db.doc(`deliveryTripOrderReservations/${f.id.order}`).get()).data().tripId, f.id.target);
  assert.ok((await sourceRef.get()).data().members.some((item) => item.orderId === f.id.order));
  assert.equal((await f.call(f.manager, 'manager', f.approve())).statusCode, 200); assert.deepEqual((await orderRef.get()).data(), saved);
  assert.equal((await f.call(f.manager, 'manager', { ...f.approve(), tripId: f.id.source })).body.error.reason, 'TRIP_MUTATION_CONFLICT');
  await orderRef.update({ assignmentVersion: saved.assignmentVersion + 1 });
  assert.equal((await f.call(f.manager, 'manager', f.approve())).body.error.reason, 'RESCHEDULE_PROPOSAL_STALE');
}));

test('Manager rejection and duplicate proposals leave scheduling and resources unchanged', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const orderRef = f.db.doc(`requests/${f.id.order}`); const sourceRef = f.db.doc(`deliveryTrips/${f.id.source}`); const resources = f.db.doc(`branchDeliveryResources/${f.id.branch}`);
  const original = (await orderRef.get()).data(); const trip = (await sourceRef.get()).data(); const resource = (await resources.get()).data();
  assert.equal((await f.call(f.driver, 'other-driver', f.proposal())).statusCode, 404);
  const results = await Promise.all([f.call(f.driver, 'driver', f.proposal()), f.call(f.driver, 'driver', f.proposal())]);
  assert.deepEqual(results.map((item) => item.statusCode), [200, 200]); assert.equal((await orderRef.get()).data().distributorRescheduleProposals.length, 1);
  const reject = { action: 'reject-distributor-reschedule', orderId: f.id.order, proposalId: 'proposal-after-return' };
  assert.equal((await f.call(f.manager, 'other-manager', reject)).statusCode, 403);
  assert.equal((await f.call(f.manager, 'manager', reject)).statusCode, 200); assert.equal((await f.call(f.manager, 'manager', reject)).statusCode, 200);
  const saved = (await orderRef.get()).data(); const { distributorRescheduleProposals, ...unchanged } = saved;
  assert.deepEqual(unchanged, original); assert.equal(distributorRescheduleProposals[0].status, 'rejected');
  assert.deepEqual((await sourceRef.get()).data(), trip); assert.deepEqual((await resources.get()).data(), resource);
  assert.equal((await f.call(f.manager, 'manager', f.approve())).body.error.reason, 'RESCHEDULE_PROPOSAL_STALE');
}));

test('proposal rejects stale assignment or trip revisions and rolls back failed writes', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  await f.unload(); const orderRef = f.db.doc(`requests/${f.id.order}`); const sourceRef = f.db.doc(`deliveryTrips/${f.id.source}`); const targetRef = f.db.doc(`deliveryTrips/${f.id.target}`);
  const failingDb = { _settings: f.db._settings, collection: f.db.collection.bind(f.db), runTransaction: (fn) => f.db.runTransaction(async (tx) => { await fn(tx); throw new Error('test rollback'); }) };
  const failingDriver = createDistributorAssignedOrdersHandler(() => ({ auth: f.auth, db: failingDb }));
  const before = (await orderRef.get()).data(); assert.equal((await f.call(failingDriver, 'driver', f.proposal())).statusCode, 500); assert.deepEqual((await orderRef.get()).data(), before);
  assert.equal((await f.call(f.driver, 'driver', f.proposal())).statusCode, 200);
  const proposed = (await orderRef.get()).data(); const originalSource = (await sourceRef.get()).data(); const originalTarget = (await targetRef.get()).data();
  const resourceRef = f.db.doc(`branchDeliveryResources/${f.id.branch}`); const guardRef = f.db.doc(`distributorDispatchGuards/${f.id.dist}`); const reservationRef = f.db.doc(`deliveryTripOrderReservations/${f.id.order}`);
  const resources = (await resourceRef.get()).data(); const guard = (await guardRef.get()).data(); const reservation = (await reservationRef.get()).data();
  const failingManager = createManagerDispatchHandler(() => ({ auth: f.auth, db: failingDb }));
  assert.equal((await f.call(failingManager, 'manager', f.approve())).statusCode, 500);
  assert.deepEqual((await orderRef.get()).data(), proposed); assert.deepEqual((await sourceRef.get()).data(), originalSource); assert.deepEqual((await targetRef.get()).data(), originalTarget);
  assert.deepEqual((await resourceRef.get()).data(), resources); assert.deepEqual((await guardRef.get()).data(), guard); assert.deepEqual((await reservationRef.get()).data(), reservation);
  await sourceRef.update({ revision: originalSource.revision + 1 });
  assert.equal((await f.call(f.manager, 'manager', f.approve())).body.error.reason, 'RESCHEDULE_PROPOSAL_STALE');
  assert.deepEqual((await orderRef.get()).data(), proposed);
  await sourceRef.update({ revision: originalSource.revision }); await orderRef.update({ assignmentVersion: proposed.assignmentVersion + 1 });
  assert.equal((await f.call(f.manager, 'manager', f.approve())).body.error.reason, 'RESCHEDULE_PROPOSAL_STALE');
}));

test('remaining failed stop can be proposed after another stop leaves the closed trip', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  await f.unload();
  assert.equal((await f.call(f.driver, 'driver', f.proposal())).statusCode, 200);
  const approved = await f.call(f.manager, 'manager', f.approve()); assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  const second = { ...f.proposal('second-stop-proposal'), orderId: f.id.otherOrder };
  const result = await f.call(f.driver, 'driver', second); assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  const accepted = await f.call(f.manager, 'manager', { ...f.approve('second-stop-proposal'), orderId: f.id.otherOrder });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  assert.equal((await f.db.doc(`deliveryTrips/${f.id.target}`).get()).data().members.length, 2);
}, true));

test('proposal racing confirmed unloading is either current or safely stale', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  assert.equal((await f.call(f.driver, 'driver', { action: 'report-trip-unloading', tripId: f.id.source })).statusCode, 200);
  const [proposed, confirmed] = await Promise.all([f.call(f.driver, 'driver', f.proposal()), f.call(f.manager, 'manager', { action: 'confirm-trip-unloading', tripId: f.id.source })]);
  assert.equal(proposed.statusCode, 200, JSON.stringify(proposed.body)); assert.equal(confirmed.statusCode, 200);
  const orderRef = f.db.doc(`requests/${f.id.order}`); const order = (await orderRef.get()).data(); const source = (await f.db.doc(`deliveryTrips/${f.id.source}`).get()).data();
  assert.equal(order.status, 'delivery_failed');
  const result = await f.call(f.manager, 'manager', f.approve());
  if (order.distributorRescheduleProposals[0].source.tripRevision === source.revision) assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  else { assert.equal(result.body.error.reason, 'RESCHEDULE_PROPOSAL_STALE'); assert.deepEqual((await orderRef.get()).data(), order); }
}));

test('approval rejects a target trip that now conflicts without applying the proposal', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  await f.unload(); assert.equal((await f.call(f.driver, 'driver', f.proposal())).statusCode, 200);
  const orderRef = f.db.doc(`requests/${f.id.order}`); const before = (await orderRef.get()).data();
  await f.db.doc(`deliveryTrips/${f.id.target}`).update({ plannedDeparture: new Date(f.start.getTime() + 60 * 60000), estimatedReturn: new Date(f.start.getTime() + 180 * 60000) });
  const result = await f.call(f.manager, 'manager', f.approve()); assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'TRIP_SCHEDULE_CONFLICT');
  assert.deepEqual((await orderRef.get()).data(), before);
}));

test('approval rejects a proposed stop outside the target trip interval', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  await f.unload();
  const proposal = { ...f.proposal(), scheduledAt: new Date(f.start.getTime() + 300 * 60000).toISOString() };
  assert.equal((await f.call(f.driver, 'driver', proposal)).statusCode, 200);
  const orderRef = f.db.doc(`requests/${f.id.order}`); const before = (await orderRef.get()).data();
  const result = await f.call(f.manager, 'manager', f.approve());
  assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'TRIP_STOP_OUTSIDE_INTERVAL');
  assert.deepEqual((await orderRef.get()).data(), before);
}));

test('approval rechecks target capacity and leaves an oversized proposal pending', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  await f.unload(); const orderId = `capacity-${randomUUID()}`;
  const items = [{ productId: f.id.water, quantity: 57, productNameSnapshot: 'Water', containerTypeSnapshot: 'Gallon', sizeSnapshot: '5 gallon', loadClassificationSnapshot: 'STANDARD_5_GALLON' }];
  await f.db.doc(`requests/${orderId}`).set({ status: 'awaiting_distributor_assignment', branchId: f.id.branch, currentBranchId: f.id.branch, items });
  await f.db.doc(`orderLoadSnapshots/${orderId}`).set(createOrderLoadSnapshot(orderId, items, epoch));
  assert.equal((await f.call(f.manager, 'manager', { action: 'assign-distributor', orderId, tripId: f.id.target, distributorUid: f.id.dist, scheduledAt: f.next.toISOString() })).statusCode, 200);
  assert.equal((await f.call(f.driver, 'driver', f.proposal())).statusCode, 200);
  const orderRef = f.db.doc(`requests/${f.id.order}`); const before = (await orderRef.get()).data();
  const result = await f.call(f.manager, 'manager', f.approve()); assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'TRIP_CAPACITY_EXCEEDED');
  assert.deepEqual((await orderRef.get()).data(), before); assert.equal((await f.db.doc(`deliveryTrips/${f.id.target}`).get()).data().standardContainers, 57);
}));

test('held Distributor cannot submit or have a pending proposal approved', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  await f.unload(); const profile = f.db.doc(`users/${f.id.dist}`);
  await profile.update({ accountActionHoldIntentId: 'test-hold' });
  assert.notEqual((await f.call(f.driver, 'driver', f.proposal())).statusCode, 200);
  await profile.update({ accountActionHoldIntentId: '' }); assert.equal((await f.call(f.driver, 'driver', f.proposal())).statusCode, 200);
  const before = (await f.db.doc(`requests/${f.id.order}`).get()).data(); await profile.update({ accountActionHoldIntentId: 'test-hold' });
  assert.notEqual((await f.call(f.manager, 'manager', f.approve())).statusCode, 200);
  assert.deepEqual((await f.db.doc(`requests/${f.id.order}`).get()).data(), before);
}));

test('approval rejects a closed trip whose resource is still marked occupied', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  await f.unload(); assert.equal((await f.call(f.driver, 'driver', f.proposal())).statusCode, 200);
  const orderRef = f.db.doc(`requests/${f.id.order}`); const before = (await orderRef.get()).data();
  await f.db.doc(`branchDeliveryResources/${f.id.branch}`).update({ resources: [{ id: 'resource-a', verified: true, tripId: f.id.source, distributorUid: f.id.dist }, { id: 'resource-b', verified: true, tripId: null, distributorUid: null }] });
  const result = await f.call(f.manager, 'manager', f.approve()); assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'TRIP_RESOURCES_INVALID');
  assert.deepEqual((await orderRef.get()).data(), before);
}));

test('proposal reads enforce ownership, detect stale unloading and list only selectable branch trips', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const query = { rescheduleProposalOrderId: f.id.order, rescheduleProposalId: 'proposal-before-return' };
  const managerQuery = (proposalId) => ({ tripApprovalOrderId: f.id.order, tripApprovalProposalId: proposalId });
  assert.equal((await f.call(f.driver, 'driver', f.proposal('proposal-before-return'))).statusCode, 200);
  assert.equal((await f.call(f.driver, 'driver', {}, 'GET', query)).body.proposal.status, 'pending');
  assert.equal((await f.call(f.driver, 'other-driver', {}, 'GET', query)).statusCode, 404);
  assert.equal((await f.call(f.manager, 'other-manager', {}, 'GET', managerQuery('proposal-before-return'))).statusCode, 403);
  assert.equal((await f.call(f.manager, 'driver', {}, 'GET', managerQuery('proposal-before-return'))).statusCode, 403);
  assert.equal((await f.call(f.manager, 'manager', {}, 'GET', managerQuery('proposal-before-return'))).body.error.reason, 'TRIP_UNLOADING_REQUIRED');
  await f.unload();
  assert.equal((await f.call(f.driver, 'driver', {}, 'GET', query)).body.proposal.status, 'stale');
  assert.equal((await f.call(f.driver, 'driver', f.proposal())).statusCode, 200);
  const result = await f.call(f.manager, 'manager', {}, 'GET', managerQuery('proposal-after-return'));
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.trips.map((item) => item.tripId), [f.id.target]);
  assert.equal(result.body.trips[0].standardContainers, 0); assert.equal(result.body.trips[0].projectedStandardContainers, 4);
  assert.deepEqual(Object.keys(result.body.trips[0]).sort(), ['distributorUid', 'estimatedReturn', 'hasOtherCargo', 'plannedDeparture', 'projectedStandardContainers', 'standardContainers', 'status', 'tripId'].sort());
  assert.equal((await f.call(f.manager, 'manager', f.approve())).statusCode, 200);
  assert.equal((await f.call(f.driver, 'driver', {}, 'GET', { rescheduleProposalOrderId: f.id.order, rescheduleProposalId: 'proposal-after-return' })).body.proposal.status, 'approved');
  await f.db.doc(`requests/${f.id.order}`).update({ scheduledAt: new Date(f.next.getTime() + 60000) });
  assert.equal((await f.call(f.driver, 'driver', {}, 'GET', { rescheduleProposalOrderId: f.id.order, rescheduleProposalId: 'proposal-after-return' })).body.proposal.status, 'stale');
}));

test('proposal reads show rejection and fail closed for malformed target trips', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  await f.unload(); assert.equal((await f.call(f.driver, 'driver', f.proposal())).statusCode, 200);
  const target = f.db.doc(`deliveryTrips/${f.id.target}`); await target.update({ manifestRevision: -1 });
  const list = await f.call(f.manager, 'manager', {}, 'GET', { tripApprovalOrderId: f.id.order, tripApprovalProposalId: 'proposal-after-return' });
  assert.equal(list.statusCode, 409); assert.equal(list.body.error.reason, 'TRIP_INVALID');
  assert.equal((await f.call(f.manager, 'manager', { action: 'reject-distributor-reschedule', orderId: f.id.order, proposalId: 'proposal-after-return' })).statusCode, 200);
  const result = await f.call(f.driver, 'driver', {}, 'GET', { rescheduleProposalOrderId: f.id.order, rescheduleProposalId: 'proposal-after-return' });
  assert.equal(result.statusCode, 200); assert.equal(result.body.proposal.status, 'rejected');
}));

test('selectable trips exclude a valid manifest that would exceed capacity', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  await f.unload();
  const otherOrder = `large-${randomUUID()}`; const original = (await f.db.doc(`requests/${f.id.order}`).get()).data();
  const items = original.items.map((item) => ({ ...item, quantity: 57, totalAtOrder: 1140 }));
  await Promise.all([f.db.doc(`requests/${otherOrder}`).set({ status: 'awaiting_distributor_assignment', branchId: f.id.branch, currentBranchId: f.id.branch, requesterUid: `requester-${randomUUID()}`, items }), f.db.doc(`orderLoadSnapshots/${otherOrder}`).set(createOrderLoadSnapshot(otherOrder, items, epoch))]);
  const assigned = await f.call(f.manager, 'manager', { action: 'assign-distributor', orderId: otherOrder, tripId: f.id.target, distributorUid: f.id.dist, scheduledAt: f.next.toISOString() });
  assert.equal(assigned.statusCode, 200, JSON.stringify(assigned.body));
  assert.equal((await f.call(f.driver, 'driver', f.proposal())).statusCode, 200);
  const result = await f.call(f.manager, 'manager', {}, 'GET', { tripApprovalOrderId: f.id.order, tripApprovalProposalId: 'proposal-after-return' });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body)); assert.deepEqual(result.body.trips, []);
  assert.equal((await f.db.doc(`deliveryTrips/${f.id.target}`).get()).data().standardContainers, 57);
}));
