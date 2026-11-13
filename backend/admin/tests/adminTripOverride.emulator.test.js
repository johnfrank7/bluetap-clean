const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createManagerDispatchHandler } = require('../../manager/dispatchHandler');
const { createDistributorAssignedOrdersHandler } = require('../../distributor/assignedOrdersHandler');
const { createAdminDispatchOverrideHandler } = require('../adminDispatchOverrideHandler');
const { createOrderLoadSnapshot } = require('../../utils/orderLoadSnapshot');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.BLUETAP_TRIP_EMULATOR_MODE === '1';
const epoch = 'a'.repeat(64); // Existing synthetic emulator-only test configuration.
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } });

async function fixture(run, options = {}) {
  const suffix = randomUUID(); const app = initializeApp({ projectId: 'demo-bluetap' }, `admin-trip-${suffix}`); const db = getFirestore(app);
  const id = Object.fromEntries(['branch', 'other', 'manager', 'otherManager', 'admin', 'sourceDriver', 'targetDriver', 'source', 'target', 'water', 'bottles'].map((key) => [key, `${key}-${suffix}`]));
  let adminOffline = false;
  const auth = { async verifyIdToken(token) { if (token === 'admin') return { uid: id.admin, role: 'admin', admin: true }; if (token === 'driver') return { uid: id.sourceDriver, role: 'distributor' }; return { uid: token === 'other-manager' ? id.otherManager : id.manager, role: 'manager', manager: true }; }, async getUser(uid) { if (uid === id.admin && adminOffline) throw new Error('Admin is offline'); return { uid, disabled: false }; } };
  const manager = createManagerDispatchHandler(() => ({ auth, db })); const admin = createAdminDispatchOverrideHandler(() => ({ auth, db })); const driver = createDistributorAssignedOrdersHandler(() => ({ auth, db }));
  const call = async (handler, token, body, method = 'PATCH', query) => { const res = response(); await handler({ method, headers: { authorization: `Bearer ${token}` }, body, query }, res); return res; };
  const start = new Date(Date.now() + 86400000); const targetTime = new Date(start.getTime() + 160 * 60000).toISOString();
  const seed = async (quantity = 4, mixed = false) => {
    const orderId = `order-${randomUUID()}`; const items = [{ productId: id.water, quantity, productNameSnapshot: 'Water', containerTypeSnapshot: 'Gallon', sizeSnapshot: '5 gallon', loadClassificationSnapshot: 'STANDARD_5_GALLON', unitPriceAtOrder: 20, totalAtOrder: quantity * 20, deliveryDaysSnapshot: [] }];
    if (mixed) items.push({ productId: id.bottles, quantity: 1, productNameSnapshot: '24 pack', containerTypeSnapshot: '', sizeSnapshot: '', loadClassificationSnapshot: 'OTHER_CARGO', unitPriceAtOrder: 10, totalAtOrder: 10, deliveryDaysSnapshot: [] });
    await db.doc(`requests/${orderId}`).set({ status: 'awaiting_distributor_assignment', branchId: id.branch, currentBranchId: id.branch, requesterUid: `requester-${randomUUID()}`, items });
    await db.doc(`orderLoadSnapshots/${orderId}`).set(createOrderLoadSnapshot(orderId, items, epoch));
    return orderId;
  };
  const proposal = (orderId, clientMutationId = 'admin-proposal-1') => ({ action: 'propose-trip-override', orderId, distributorUid: id.targetDriver, tripId: id.target, scheduledAt: targetTime, reason: 'Emergency dispatch', clientMutationId });
  const approve = (orderId, proposalId = 'admin-proposal-1') => ({ action: 'approve-admin-trip-override', orderId, proposalId });
  const reject = (orderId, proposalId = 'admin-proposal-1') => ({ action: 'reject-admin-trip-override', orderId, proposalId });
  try {
    await Promise.all([
      db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch }),
      db.doc(`branches/${id.branch}`).set({ name: 'Source', status: 'active' }), db.doc(`branches/${id.other}`).set({ name: 'Other', status: 'active' }),
      db.doc(`users/${id.manager}`).set({ role: 'manager', managerStatus: 'active', branchId: id.branch }), db.doc(`users/${id.otherManager}`).set({ role: 'manager', managerStatus: 'active', branchId: id.other }), db.doc(`users/${id.admin}`).set({ role: 'admin' }),
      ...[id.sourceDriver, id.targetDriver].flatMap((uid) => [db.doc(`users/${uid}`).set({ role: 'distributor', approvalStatus: 'active', branchId: id.branch, fullName: 'Test Driver', phone: '09123456789', completeAddress: 'Test Barangay' }), db.doc(`distributorDispatchGuards/${uid}`).set({ schemaVersion: 1, initialized: true, distributorUid: uid, revision: 0, reservations: [] })]),
      db.doc(`branchDeliveryResources/${id.branch}`).set({ schemaVersion: 1, initialized: true, branchId: id.branch, revision: 0, resources: [{ id: 'resource-a', verified: true, tripId: null, distributorUid: null }, { id: 'resource-b', verified: true, tripId: null, distributorUid: null }] }),
      db.doc(`products/${id.water}`).set({ product_name: 'Water', price: 20, active: true, containerType: 'Gallon', size: '5 gallon', deliveryLoad: { verified: true, classification: 'standard_5_gallon' } }),
    ]);
    for (const [tripId, distributorUid] of [[id.source, id.sourceDriver], [id.target, id.targetDriver]]) assert.equal((await call(manager, 'manager', { action: 'create-trip', tripId, distributorUid })).statusCode, 200);
    assert.equal((await call(manager, 'manager', { action: 'schedule-trip', tripId: id.source, resourceId: 'resource-a', plannedDeparture: start.toISOString(), estimatedReturn: new Date(start.getTime() + 120 * 60000).toISOString() })).statusCode, 200);
    assert.equal((await call(manager, 'manager', { action: 'schedule-trip', tripId: id.target, resourceId: 'resource-b', plannedDeparture: new Date(start.getTime() + 150 * 60000).toISOString(), estimatedReturn: new Date(start.getTime() + 240 * 60000).toISOString() })).statusCode, 200);
    const orderId = await seed(options.quantity || 4, options.mixed);
    if (options.assigned || options.failed) assert.equal((await call(manager, 'manager', { action: 'assign-distributor', orderId, tripId: id.source, distributorUid: id.sourceDriver, scheduledAt: new Date(start.getTime() + 10 * 60000).toISOString() })).statusCode, 200);
    if (options.failed) {
      assert.equal((await call(manager, 'manager', { action: 'approve-trip', tripId: id.source, expectedRevision: (await db.doc(`deliveryTrips/${id.source}`).get()).data().revision })).statusCode, 200);
      assert.equal((await call(driver, 'driver', { action: 'accept-assignment', orderId })).statusCode, 200);
      assert.equal((await call(manager, 'manager', { action: 'reserve-trip-resource', tripId: id.source, resourceId: 'resource-a' })).statusCode, 200);
      assert.equal((await call(driver, 'driver', { action: 'report-trip-loading', tripId: id.source })).statusCode, 200);
      assert.equal((await call(manager, 'manager', { action: 'confirm-trip-loading', tripId: id.source })).statusCode, 200);
      assert.equal((await call(driver, 'driver', { action: 'start-delivery', orderId })).statusCode, 200);
      assert.equal((await call(driver, 'driver', { action: 'fail-delivery', orderId, failureReasonCode: 'CUSTOMER_UNAVAILABLE' })).statusCode, 200);
    }
    const unload = async () => { assert.equal((await call(driver, 'driver', { action: 'report-trip-unloading', tripId: id.source })).statusCode, 200); assert.equal((await call(manager, 'manager', { action: 'confirm-trip-unloading', tripId: id.source })).statusCode, 200); };
    await run({ db, id, auth, manager, admin, driver, call, seed, proposal, approve, reject, orderId, targetTime, start, unload, setAdminOffline: () => { adminOffline = true; } });
  } finally { await deleteApp(app); }
}

test('Admin proposal is non-mutating and branch Manager approves it while Admin is offline', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const orderRef = f.db.doc(`requests/${f.orderId}`); const targetRef = f.db.doc(`deliveryTrips/${f.id.target}`); const resourcesRef = f.db.doc(`branchDeliveryResources/${f.id.branch}`);
  const before = (await orderRef.get()).data(); const trip = (await targetRef.get()).data(); const resources = (await resourcesRef.get()).data();
  const proposed = await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST'); assert.equal(proposed.statusCode, 200, JSON.stringify(proposed.body)); assert.equal(proposed.body.proposal.status, 'pending');
  assert.deepEqual((await orderRef.get()).data(), before); assert.deepEqual((await targetRef.get()).data(), trip); assert.deepEqual((await resourcesRef.get()).data(), resources);
  assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
  const mismatch = await f.call(f.admin, 'admin', { ...f.proposal(f.orderId), reason: 'Changed reason' }, 'POST'); assert.equal(mismatch.body.error.reason, 'ADMIN_OVERRIDE_PROPOSAL_CONFLICT');
  const listed = await f.call(f.manager, 'manager', {}, 'GET', { adminOverrideOrderId: f.orderId }); assert.equal(listed.statusCode, 200); assert.equal(listed.body.proposals[0].id, 'admin-proposal-1');
  assert.equal((await f.call(f.manager, 'other-manager', f.approve(f.orderId))).statusCode, 403);
  f.setAdminOffline(); const approved = await f.call(f.manager, 'manager', f.approve(f.orderId)); assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  const saved = (await orderRef.get()).data(); assert.equal(saved.assignedDistributorUid, f.id.targetDriver); assert.equal(saved.assignmentHistory.at(-1).event, 'ADMIN_DISPATCH_OVERRIDE');
  assert.equal((await targetRef.get()).data().standardContainers, 4); assert.equal((await orderRef.collection('adminTripOverrideProposals').doc('admin-proposal-1').get()).data().status, 'approved');
  const audit = await f.db.collection('adminAuditLogs').where('proposalId', '==', 'admin-proposal-1').get(); assert.ok(audit.docs.some((doc) => doc.data().orderId === f.orderId));
  assert.equal((await f.call(f.manager, 'manager', f.approve(f.orderId))).statusCode, 200); assert.deepEqual((await orderRef.get()).data(), saved);
}));

test('Manager rejection is idempotent and never changes order or trip', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const orderRef = f.db.doc(`requests/${f.orderId}`); const target = f.db.doc(`deliveryTrips/${f.id.target}`); const before = (await orderRef.get()).data(); const trip = (await target.get()).data();
  assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
  assert.equal((await f.call(f.manager, 'other-manager', f.reject(f.orderId))).statusCode, 403);
  assert.equal((await f.call(f.manager, 'manager', f.reject(f.orderId))).statusCode, 200); assert.equal((await f.call(f.manager, 'manager', f.reject(f.orderId))).statusCode, 200);
  assert.equal((await f.call(f.manager, 'manager', f.approve(f.orderId))).statusCode, 409); assert.deepEqual((await orderRef.get()).data(), before); assert.deepEqual((await target.get()).data(), trip);
}));

test('assigned failed cargo cannot move until confirmed unloading and does not require Admin to return', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const orderRef = f.db.doc(`requests/${f.orderId}`); assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
  const blocked = await f.call(f.manager, 'manager', f.approve(f.orderId)); assert.equal(blocked.statusCode, 409); assert.equal(blocked.body.error.reason, 'TRIP_UNLOADING_REQUIRED');
  assert.equal((await orderRef.get()).data().status, 'delivery_failed'); f.setAdminOffline(); await f.unload();
  const approved = await f.call(f.manager, 'manager', f.approve(f.orderId)); assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  assert.equal((await orderRef.get()).data().assignedDistributorUid, f.id.targetDriver);
  assert.ok((await f.db.doc(`deliveryTrips/${f.id.source}`).get()).data().members.some((item) => item.orderId === f.orderId));
}, { failed: true }));

test('mixed cargo cannot reserve a resource until a new Manager loading review', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
  const approved = await f.call(f.manager, 'manager', f.approve(f.orderId)); assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  const trip = (await f.db.doc(`deliveryTrips/${f.id.target}`).get()).data(); assert.equal(trip.hasOtherCargo, true); assert.equal(trip.managerApproval, null); assert.equal(trip.mixedReview, null);
  assert.equal((await f.call(f.manager, 'manager', { action: 'reserve-trip-resource', tripId: f.id.target, resourceId: 'resource-b' })).body.error.reason, 'TRIP_APPROVAL_REQUIRED');
  assert.equal((await f.call(f.manager, 'manager', { action: 'approve-trip', tripId: f.id.target, expectedRevision: trip.revision })).body.error.reason, 'TRIP_MIXED_REVIEW_REQUIRED');
  assert.equal((await f.call(f.manager, 'manager', { action: 'approve-trip', tripId: f.id.target, expectedRevision: trip.revision, mixedLoadConfirmed: true })).statusCode, 200);
}, { mixed: true }));

test('missing reservation cannot disguise existing trip membership', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const source = f.db.doc(`deliveryTrips/${f.id.source}`); const order = f.db.doc(`requests/${f.orderId}`);
  const original = (await order.get()).data();
  await source.update({ members: [{ orderId: f.orderId, containers: 4, cargo: [{ productId: f.id.water, quantity: 4, description: 'Water', classification: 'standard_5_gallon' }] }], standardContainers: 4 });
  assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
  const denied = await f.call(f.manager, 'manager', f.approve(f.orderId));
  assert.equal(denied.statusCode, 409); assert.equal(denied.body.error.reason, 'TRIP_INVALID');
  assert.deepEqual((await order.get()).data(), original);
  assert.equal((await f.db.doc(`deliveryTripOrderReservations/${f.orderId}`).get()).exists, false);
}));

test('changed trip or order makes a proposal stale without applying it', { skip: !enabled, timeout: 60000 }, async () => {
  await fixture(async (f) => {
    assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
    const trip = f.db.doc(`deliveryTrips/${f.id.target}`); await trip.update({ revision: (await trip.get()).data().revision + 1 });
    const result = await f.call(f.manager, 'manager', f.approve(f.orderId)); assert.equal(result.body.error.reason, 'ADMIN_OVERRIDE_PROPOSAL_STALE');
    assert.equal((await f.db.doc(`requests/${f.orderId}`).get()).data().status, 'awaiting_distributor_assignment');
  });
  await fixture(async (f) => {
    assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
    await f.db.doc(`requests/${f.orderId}`).update({ updatedAt: new Date() });
    const result = await f.call(f.manager, 'manager', f.approve(f.orderId)); assert.equal(result.body.error.reason, 'ADMIN_OVERRIDE_PROPOSAL_STALE');
  });
});

test('capacity and tampered load proof fail without assignment or partial proposal approval', { skip: !enabled, timeout: 60000 }, async () => {
  await fixture(async (f) => {
    const large = await f.seed(57); const initial = await f.call(f.manager, 'manager', { action: 'assign-distributor', orderId: large, tripId: f.id.target, distributorUid: f.id.targetDriver, scheduledAt: f.targetTime }); assert.equal(initial.statusCode, 200, JSON.stringify(initial.body));
    assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
    const result = await f.call(f.manager, 'manager', f.approve(f.orderId)); assert.equal(result.body.error.reason, 'TRIP_CAPACITY_EXCEEDED');
    assert.equal((await f.db.doc(`deliveryTrips/${f.id.target}`).get()).data().standardContainers, 57);
    assert.equal((await f.db.doc(`requests/${f.orderId}/adminTripOverrideProposals/admin-proposal-1`).get()).data().status, 'pending');
  });
  await fixture(async (f) => {
    assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
    const ref = f.db.doc(`orderLoadSnapshots/${f.orderId}`); const proof = (await ref.get()).data(); proof.items[0].quantity += 1; await ref.set(proof);
    const result = await f.call(f.manager, 'manager', f.approve(f.orderId)); assert.equal(result.body.error.reason, 'TRIP_LOAD_UNKNOWN');
    assert.equal((await f.db.doc(`deliveryTrips/${f.id.target}`).get()).data().standardContainers, 0);
  });
});

test('competing proposals serialize against the same trip and cannot overfill it', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const base = await f.seed(55); const second = await f.seed(4);
  const assigned = await f.call(f.manager, 'manager', { action: 'assign-distributor', orderId: base, tripId: f.id.target, distributorUid: f.id.targetDriver, scheduledAt: f.targetTime }); assert.equal(assigned.statusCode, 200, JSON.stringify(assigned.body));
  assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId, 'proposal-one'), 'POST')).statusCode, 200);
  assert.equal((await f.call(f.admin, 'admin', f.proposal(second, 'proposal-two'), 'POST')).statusCode, 200);
  const results = await Promise.all([f.call(f.manager, 'manager', f.approve(f.orderId, 'proposal-one')), f.call(f.manager, 'manager', f.approve(second, 'proposal-two'))]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409], JSON.stringify(results.map((r) => r.body)));
  assert.equal((await f.db.doc(`deliveryTrips/${f.id.target}`).get()).data().standardContainers, 59);
}));

test('an aborted approval leaves order, trip, proposal and audit unchanged', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
  const order = f.db.doc(`requests/${f.orderId}`); const trip = f.db.doc(`deliveryTrips/${f.id.target}`); const proposal = order.collection('adminTripOverrideProposals').doc('admin-proposal-1');
  const before = [(await order.get()).data(), (await trip.get()).data(), (await proposal.get()).data()];
  const failingDb = { _settings: f.db._settings, collection: f.db.collection.bind(f.db), runTransaction: (fn) => f.db.runTransaction(async (tx) => { await fn(tx); throw new Error('emulated rollback'); }) };
  const failing = createManagerDispatchHandler(() => ({ auth: f.auth, db: failingDb }));
  assert.equal((await f.call(failing, 'manager', f.approve(f.orderId))).statusCode, 500);
  assert.deepEqual([(await order.get()).data(), (await trip.get()).data(), (await proposal.get()).data()], before);
  const audit = await f.db.collection('adminAuditLogs').where('proposalId', '==', 'admin-proposal-1').get(); assert.equal(audit.docs.filter((doc) => doc.data().orderId === f.orderId).length, 0);
}));

test('a conflicting trip or occupied resource blocks approval', { skip: !enabled, timeout: 60000 }, async () => {
  await fixture(async (f) => {
    assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
    await f.db.doc(`deliveryTrips/${f.id.source}`).update({ plannedResourceId: 'resource-b', plannedDeparture: new Date(f.start.getTime() + 150 * 60000), estimatedReturn: new Date(f.start.getTime() + 240 * 60000) });
    const result = await f.call(f.manager, 'manager', f.approve(f.orderId)); assert.equal(result.body.error.reason, 'TRIP_SCHEDULE_CONFLICT');
    assert.equal((await f.db.doc(`requests/${f.orderId}`).get()).data().status, 'awaiting_distributor_assignment');
  });
  await fixture(async (f) => {
    assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
    const ref = f.db.doc(`branchDeliveryResources/${f.id.branch}`); const resources = (await ref.get()).data(); resources.resources[1].tripId = 'nonexistent-trip'; resources.resources[1].distributorUid = f.id.sourceDriver; await ref.set(resources);
    const result = await f.call(f.manager, 'manager', f.approve(f.orderId)); assert.equal(result.body.error.reason, 'TRIP_RESOURCES_INVALID');
  });
});

test('Manager assignment and Admin proposal approval race without exceeding capacity', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const base = await f.seed(55); const second = await f.seed(4);
  assert.equal((await f.call(f.manager, 'manager', { action: 'assign-distributor', orderId: base, tripId: f.id.target, distributorUid: f.id.targetDriver, scheduledAt: f.targetTime })).statusCode, 200);
  assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
  const results = await Promise.all([f.call(f.manager, 'manager', f.approve(f.orderId)), f.call(f.manager, 'manager', { action: 'assign-distributor', orderId: second, tripId: f.id.target, distributorUid: f.id.targetDriver, scheduledAt: f.targetTime })]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409], JSON.stringify(results.map((r) => r.body)));
  assert.equal((await f.db.doc(`deliveryTrips/${f.id.target}`).get()).data().standardContainers, 59);
}));

test('same-trip override keeps one membership and checks the exact proposed schedule', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const proposed = { ...f.proposal(f.orderId), distributorUid: f.id.sourceDriver, tripId: f.id.source, scheduledAt: new Date(f.start.getTime() + 20 * 60000).toISOString() };
  assert.equal((await f.call(f.admin, 'admin', proposed, 'POST')).statusCode, 200);
  const altered = await f.call(f.manager, 'manager', { ...f.approve(f.orderId), scheduledAt: f.targetTime }); assert.equal(altered.statusCode, 409);
  const approved = await f.call(f.manager, 'manager', f.approve(f.orderId)); assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  const trip = (await f.db.doc(`deliveryTrips/${f.id.source}`).get()).data(); assert.equal(trip.members.filter((member) => member.orderId === f.orderId).length, 1); assert.equal(trip.standardContainers, 4);
}, { assigned: true }));

test('a Manager reassignment invalidates an earlier Admin proposal', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
  const reassigned = await f.call(f.manager, 'manager', { action: 'reassign-distributor', orderId: f.orderId, tripId: f.id.target, distributorUid: f.id.targetDriver, scheduledAt: f.targetTime, reassignmentReason: 'Manager decision' });
  assert.equal(reassigned.statusCode, 200, JSON.stringify(reassigned.body));
  const before = (await f.db.doc(`requests/${f.orderId}`).get()).data();
  const stale = await f.call(f.manager, 'manager', f.approve(f.orderId)); assert.equal(stale.body.error.reason, 'ADMIN_OVERRIDE_PROPOSAL_STALE');
  assert.deepEqual((await f.db.doc(`requests/${f.orderId}`).get()).data(), before);
}, { assigned: true }));

test('cross-branch targets and held Distributors cannot be approved', { skip: !enabled, timeout: 60000 }, async () => {
  await fixture(async (f) => {
    await f.db.doc(`users/${f.id.targetDriver}`).update({ branchId: f.id.other });
    const denied = await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST'); assert.equal(denied.statusCode, 403); assert.equal(denied.body.error.reason, 'CROSS_BRANCH_ASSIGNMENT_FORBIDDEN');
  });
  await fixture(async (f) => {
    assert.equal((await f.call(f.admin, 'admin', f.proposal(f.orderId), 'POST')).statusCode, 200);
    await f.db.doc(`users/${f.id.targetDriver}`).update({ accountActionHoldIntentId: 'held' });
    const denied = await f.call(f.manager, 'manager', f.approve(f.orderId)); assert.notEqual(denied.statusCode, 200);
    assert.equal((await f.db.doc(`requests/${f.orderId}`).get()).data().status, 'awaiting_distributor_assignment');
  });
});
