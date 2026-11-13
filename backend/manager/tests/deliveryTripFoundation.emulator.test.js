const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createTrip, allocateOrder, approveTrip, reserveResource, lifecycle, planTripSchedule } = require('../../utils/deliveryTripFoundation');
const { createOrderLoadSnapshot } = require('../../utils/orderLoadSnapshot');
const { attemptIdFor } = require('../../delivery/deliveryAttemptService');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.GCLOUD_PROJECT === 'demo-bluetap';
const epoch = 'a'.repeat(64);
async function fixture(run) {
  const suffix = randomUUID(); const app = initializeApp({ projectId: 'demo-bluetap' }, `trip-${suffix}`); const db = getFirestore(app);
  const branch = `branch-${suffix}`; const managerId = `manager-${suffix}`; const dist = `dist-${suffix}`; const backup = `backup-${suffix}`;
  const manager = { decoded: { uid: managerId, role: 'manager' }, branch: { id: branch } };
  const driver = { decoded: { uid: dist, role: 'distributor' }, branch: { id: branch } };
  const resources = db.doc(`branchDeliveryResources/${branch}`); const water = `water-${suffix}`; const other = `other-${suffix}`;
  const trip = (name) => `trip-${name}-${suffix}`; const order = (name) => `order-${name}-${suffix}`;
  const txn = (fn) => db.runTransaction(fn); const ref = (id) => db.doc(`deliveryTrips/${id}`);
  const create = (id, uid = dist) => txn((tx) => createTrip(tx, db, { tripId: id, distributorUid: uid, manager }));
  // Mirror the Manager writer: a pending order is assigned in the same
  // transaction as its trip reservation. No legacy reservation is invented.
  const allocateInTransaction = async (tx, id, orderId) => {
    const orderRef = db.doc(`requests/${orderId}`);
    const [orderSnap, tripSnap] = await Promise.all([tx.get(orderRef), tx.get(ref(id))]);
    const current = orderSnap.data(); const tripData = tripSnap.data();
    const assigning = current?.status === 'awaiting_distributor_assignment';
    const proposed = assigning ? { ...current, status: 'distributor_assigned', assignedDistributorUid: tripData.distributorUid, scheduledAt: null } : current;
    const writes = [];
    const staged = new Proxy(tx, { get(target, key) {
      if (key === 'get') return async (targetRef) => {
        const snap = await target.get(targetRef);
        return targetRef.path === orderRef.path ? { id: snap.id, exists: snap.exists, data: () => proposed } : snap;
      };
      if (['create', 'set', 'update', 'delete'].includes(key)) return (...args) => { writes.push([key, args]); };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const result = await allocateOrder(staged, db, { tripId: id, orderId, manager });
    if (assigning) tx.update(orderRef, { status: proposed.status, assignedDistributorUid: proposed.assignedDistributorUid, scheduledAt: null });
    for (const [method, args] of writes) tx[method](...args);
    return result;
  };
  const allocate = (id, orderId) => txn((tx) => allocateInTransaction(tx, id, orderId));
  const approve = (id, mixedLoadConfirmed = false) => txn((tx) => approveTrip(tx, db, { tripId: id, manager, mixedLoadConfirmed }));
  const reserve = (id, resourceId) => txn((tx) => reserveResource(tx, db, { tripId: id, resourceId, manager }));
  const act = (id, action, context = action.startsWith('report') ? driver : manager) => txn((tx) => lifecycle(tx, db, { tripId: id, context, action }));
  const orderItems = (quantity, extra = []) => [{ productId: water, quantity, productNameSnapshot: '5-gallon refill', containerTypeSnapshot: '', sizeSnapshot: '', loadClassificationSnapshot: 'STANDARD_5_GALLON' }, ...extra.map((item) => ({ ...item, containerTypeSnapshot: '', sizeSnapshot: '', loadClassificationSnapshot: 'OTHER_CARGO' }))];
  const seedOrder = async (id, quantity, extra = []) => {
    const items = orderItems(quantity, extra); const batch = db.batch();
    batch.set(db.doc(`requests/${id}`), { status: 'awaiting_distributor_assignment', currentBranchId: branch, items });
    batch.set(db.doc(`orderLoadSnapshots/${id}`), createOrderLoadSnapshot(id, items, epoch));
    await batch.commit();
  };
  const updateItems = async (id, items) => { const batch = db.batch(); batch.update(db.doc(`requests/${id}`), { items }); batch.set(db.doc(`orderLoadSnapshots/${id}`), createOrderLoadSnapshot(id, items, epoch)); await batch.commit(); };
  try {
    await Promise.all([
      db.doc(`branches/${branch}`).set({ status: 'active' }),
      db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch }),
      db.doc(`users/${managerId}`).set({ role: 'manager', managerStatus: 'active', branchId: branch }),
      ...[dist, backup].flatMap((id) => [
        db.doc(`users/${id}`).set({ role: 'distributor', approvalStatus: 'active', branchId: branch }),
        db.doc(`distributorDispatchGuards/${id}`).set({ schemaVersion: 1, initialized: true, distributorUid: id, revision: 0, reservations: [] }),
      ]),
      db.doc(`products/${water}`).set({ product_name: '5-gallon refill', deliveryLoad: { verified: true, classification: 'standard_5_gallon' } }),
      db.doc(`products/${other}`).set({ product_name: '24 pack', deliveryLoad: { verified: true, classification: 'other' } }),
      resources.set({ schemaVersion: 1, initialized: true, branchId: branch, revision: 0, resources: [{ id: 'opaque-a', verified: true, tripId: null, distributorUid: null }, { id: 'opaque-b', verified: true, tripId: null, distributorUid: null }] }),
    ]);
    await run({ db, txn, branch, manager, driver, backup, resources, water, other, trip, order, ref, create, allocate, allocateInTransaction, approve, reserve, act, seedOrder, orderItems, updateItems });
  } finally { await deleteApp(app); }
}
const rejects = (promise, reason) => assert.rejects(promise, (error) => error.reason === reason);

test('emulator rejects a free guard that contradicts an active trip resource claim', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const first = f.trip('reverse-first'); const second = f.trip('reverse-second');
  const firstOrder = f.order('reverse-first'); const secondOrder = f.order('reverse-second');
  await Promise.all([f.create(first), f.create(second, f.backup), f.seedOrder(firstOrder, 1), f.seedOrder(secondOrder, 1)]);
  await Promise.all([f.allocate(first, firstOrder), f.allocate(second, secondOrder)]);
  await Promise.all([f.approve(first), f.approve(second)]);
  await f.reserve(first, 'opaque-a');
  const resources = (await f.resources.get()).data().resources;
  await f.resources.update({ resources: resources.map((item) => item.id === 'opaque-a' ? { ...item, tripId: null, distributorUid: null } : item) });
  const before = (await f.resources.get()).data(); const beforeTrip = (await f.ref(second).get()).data();
  await rejects(f.reserve(second, 'opaque-a'), 'TRIP_RESOURCES_INVALID');
  const start = new Date(Date.now() + 86400000); const end = new Date(start.getTime() + 3600000);
  await rejects(f.txn((tx) => planTripSchedule(tx, f.db, { tripId: second, resourceId: 'opaque-a', plannedDeparture: start, estimatedReturn: end, manager: f.manager })), 'TRIP_RESOURCES_INVALID');
  assert.deepEqual((await f.resources.get()).data(), before);
  assert.deepEqual((await f.ref(second).get()).data(), beforeTrip);
  assert.equal((await f.ref(first).get()).data().resourceId, 'opaque-a');
}));

test('emulator rejects a free guard when an existing resource claim has an unknown trip state', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const first = f.trip('unknown-state-first'); const second = f.trip('unknown-state-second');
  const firstOrder = f.order('unknown-state-first'); const secondOrder = f.order('unknown-state-second');
  await Promise.all([f.create(first), f.create(second, f.backup), f.seedOrder(firstOrder, 1), f.seedOrder(secondOrder, 1)]);
  await Promise.all([f.allocate(first, firstOrder), f.allocate(second, secondOrder)]);
  await Promise.all([f.approve(first), f.approve(second)]);
  await f.reserve(first, 'opaque-a');
  await f.ref(first).update({ state: 'unrecognized' });
  const resources = (await f.resources.get()).data().resources;
  await f.resources.update({ resources: resources.map((item) => item.id === 'opaque-a' ? { ...item, tripId: null, distributorUid: null } : item) });
  const before = (await f.resources.get()).data(); const beforeTrip = (await f.ref(second).get()).data();
  await rejects(f.reserve(second, 'opaque-a'), 'TRIP_RESOURCES_INVALID');
  assert.deepEqual((await f.resources.get()).data(), before);
  assert.deepEqual((await f.ref(second).get()).data(), beforeTrip);
}));

test('emulator refuses unloading when the latest attempt is active despite an inconsistent order pointer', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const trip = f.trip('unresolved'); const order = f.order('unresolved');
  await f.create(trip); await f.seedOrder(order, 1); await f.allocate(trip, order); await f.approve(trip); await f.reserve(trip, 'opaque-a');
  await f.act(trip, 'reportLoading'); await f.act(trip, 'confirmLoading');
  await f.db.doc(`requests/${order}`).update({ status: 'scheduled', deliveryAttemptSeq: 1, activeDeliveryAttemptId: null });
  const attempt = f.db.doc(`deliveryAttempts/${attemptIdFor(order, 1)}`);
  await attempt.set({ orderId: order, attemptNumber: 1, outcome: 'in_progress' });
  await f.act(trip, 'reportReturnAndUnloading');
  const beforeTrip = (await f.ref(trip).get()).data(); const beforeResources = (await f.resources.get()).data();
  await rejects(f.act(trip, 'confirmReturnAndUnloading'), 'TRIP_ACTIVE_DELIVERY_UNRESOLVED');
  assert.deepEqual((await f.ref(trip).get()).data(), beforeTrip);
  assert.deepEqual((await f.resources.get()).data(), beforeResources);
  assert.equal((await attempt.get()).data().outcome, 'in_progress');
  await f.db.doc(`requests/${order}`).update({ status: 'delivered', deliveryAttemptSeq: 2 });
  await f.db.doc(`deliveryAttempts/${attemptIdFor(order, 2)}`).set({ orderId: order, attemptNumber: 2, outcome: 'delivered' });
  await rejects(f.act(trip, 'confirmReturnAndUnloading'), 'TRIP_ACTIVE_DELIVERY_UNRESOLVED');
  assert.deepEqual((await f.ref(trip).get()).data(), beforeTrip);
  assert.deepEqual((await f.resources.get()).data(), beforeResources);
}));

test('emulator serializes different Distributors competing for the same resource', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const first = f.trip('resource-race-first'); const second = f.trip('resource-race-second');
  const firstOrder = f.order('resource-race-first'); const secondOrder = f.order('resource-race-second');
  await Promise.all([f.create(first), f.create(second, f.backup), f.seedOrder(firstOrder, 1), f.seedOrder(secondOrder, 1)]);
  await Promise.all([f.allocate(first, firstOrder), f.allocate(second, secondOrder)]);
  await Promise.all([f.approve(first), f.approve(second)]);
  let arrivals = 0; let release; const barrier = new Promise((resolve) => { release = resolve; });
  const compete = (tripId) => { let initial = true; return f.txn(async (tx) => { if (initial) { initial = false; if (++arrivals === 2) release(); await barrier; } return reserveResource(tx, f.db, { tripId, resourceId: 'opaque-a', manager: f.manager }); }); };
  const results = await Promise.allSettled([compete(first), compete(second)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.reason, 'TRIP_RESOURCE_UNAVAILABLE');
  const occupant = (await f.resources.get()).data().resources.find((item) => item.id === 'opaque-a');
  const trips = await Promise.all([f.ref(first).get(), f.ref(second).get()]);
  assert.equal(trips.filter((trip) => trip.data().state === 'resource_reserved').length, 1);
  assert.equal(trips.find((trip) => trip.data().state === 'resource_reserved').id, occupant.tripId);
}));

test('emulator reuses a resource after confirmed unloading without replay disturbing its new trip', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const first = f.trip('reuse-first'); const second = f.trip('reuse-second');
  const firstOrder = f.order('reuse-first'); const secondOrder = f.order('reuse-second');
  await Promise.all([f.create(first), f.create(second, f.backup), f.seedOrder(firstOrder, 1), f.seedOrder(secondOrder, 1)]);
  await Promise.all([f.allocate(first, firstOrder), f.allocate(second, secondOrder)]);
  await Promise.all([f.approve(first), f.approve(second)]);
  await f.reserve(first, 'opaque-a'); await f.act(first, 'reportLoading'); await f.act(first, 'confirmLoading');
  await f.db.doc(`requests/${firstOrder}`).update({ status: 'delivery_failed' });
  await f.act(first, 'reportReturnAndUnloading'); await f.act(first, 'confirmReturnAndUnloading');
  await f.reserve(second, 'opaque-a');
  const before = (await f.resources.get()).data();
  assert.equal(before.resources.find((item) => item.id === 'opaque-a').tripId, second);
  assert.equal((await f.act(first, 'confirmReturnAndUnloading')).changed, false);
  assert.deepEqual((await f.resources.get()).data(), before);
  assert.equal((await f.ref(second).get()).data().state, 'resource_reserved');
}));

test('emulator allocates multiple orders at 60, rejects 61, and retries without double-counting', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const trip = f.trip('capacity'); const a = f.order('59'); const b = f.order('1'); const c = f.order('2');
  await f.create(trip); await Promise.all([f.seedOrder(a, 59), f.seedOrder(b, 1), f.seedOrder(c, 2)]);
  assert.equal((await f.allocate(trip, a)).standardContainers, 59);
  await rejects(f.allocate(trip, c), 'TRIP_CAPACITY_EXCEEDED');
  assert.equal((await f.allocate(trip, b)).standardContainers, 60);
  assert.equal((await f.allocate(trip, b)).changed, false);
  const saved = (await f.ref(trip).get()).data(); assert.equal(saved.standardContainers, 60); assert.equal(saved.members.length, 2);
  assert.equal(saved.scheduledAt, null);
  assert.equal((await f.db.doc(`deliveryTripOrderReservations/${c}`).get()).exists, false);
  const otherTrip = f.trip('duplicate'); await f.create(otherTrip); await rejects(f.allocate(otherTrip, a), 'TRIP_ORDER_RESERVED');
}));

test('emulator serializes different orders competing for the last container', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const trip = f.trip('race'); const initial = f.order('initial'); const a = f.order('a'); const b = f.order('b');
  await f.create(trip); await Promise.all([f.seedOrder(initial, 59), f.seedOrder(a, 1), f.seedOrder(b, 1)]); await f.allocate(trip, initial);
  let arrivals = 0; let release; const barrier = new Promise((resolve) => { release = resolve; });
  const contender = (orderId) => { let first = true; return f.txn(async (tx) => { if (first) { first = false; arrivals++; if (arrivals === 2) release(); await barrier; } return f.allocateInTransaction(tx, trip, orderId); }); };
  const results = await Promise.allSettled([contender(a), contender(b)]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1); assert.equal(results.find((item) => item.status === 'rejected').reason.reason, 'TRIP_CAPACITY_EXCEEDED');
  const saved = (await f.ref(trip).get()).data(); assert.equal(saved.standardContainers, 60); assert.equal(saved.members.length, 2);
}));

test('emulator mixed cargo requires Manager approval, and changes invalidate it', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const trip = f.trip('mixed'); const order = f.order('mixed'); await f.create(trip);
  await f.seedOrder(order, 3, [{ productId: f.other, quantity: 2, productNameSnapshot: '24 pack' }]); await f.allocate(trip, order);
  await rejects(f.approve(trip), 'TRIP_MIXED_REVIEW_REQUIRED'); await f.approve(trip, true); assert.equal((await f.approve(trip, true)).changed, false);
  await f.updateItems(order, f.orderItems(3, [{ productId: f.other, quantity: 4, productNameSnapshot: '24 pack' }]));
  await f.allocate(trip, order); const saved = (await f.ref(trip).get()).data();
  assert.equal(saved.state, 'planning'); assert.equal(saved.mixedReview, null); assert.equal(saved.managerApproval, null); assert.equal(saved.members[0].cargo[1].quantity, 4);
  await rejects(f.reserve(trip, 'opaque-a'), 'TRIP_APPROVAL_REQUIRED'); await rejects(f.approve(trip), 'TRIP_MIXED_REVIEW_REQUIRED');
}));

test('emulator resources serialize and only Manager-confirmed return releases the resource', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const a = f.trip('a'); const b = f.trip('b'); const oa = f.order('a'); const ob = f.order('b');
  await Promise.all([f.create(a), f.create(b), f.seedOrder(oa, 1), f.seedOrder(ob, 1)]);
  await Promise.all([f.allocate(a, oa), f.allocate(b, ob)]); await Promise.all([f.approve(a), f.approve(b)]);
  let arrivals = 0; let release; const barrier = new Promise((resolve) => { release = resolve; });
  const compete = (tripId) => { let first = true; return f.txn(async (tx) => { if (first) { first = false; arrivals++; if (arrivals === 2) release(); await barrier; } return reserveResource(tx, f.db, { tripId, resourceId: 'opaque-a', manager: f.manager }); }); };
  const results = await Promise.allSettled([compete(a), compete(b)]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.find((item) => item.status === 'rejected').reason.reason, 'TRIP_RESOURCE_UNAVAILABLE');
  const winner = results[0].status === 'fulfilled' ? a : b;
  const loser = winner === a ? b : a;
  assert.equal((await f.reserve(winner, 'opaque-a')).changed, false);
  await rejects(f.reserve(loser, 'opaque-b'), 'TRIP_DISTRIBUTOR_BUSY');
  await rejects(f.act(winner, 'confirmLoading', f.driver), 'TRIP_FORBIDDEN');
  await f.act(winner, 'reportLoading'); assert.equal((await f.act(winner, 'reportLoading')).changed, false); await f.act(winner, 'confirmLoading');
  const member = (await f.ref(winner).get()).data().members[0].orderId;
  await f.db.doc(`requests/${member}`).update({ status: 'delivery_failed' });
  await rejects(f.act(winner, 'confirmReturnAndUnloading'), 'TRIP_INVALID_ACTION');
  assert.equal((await f.resources.get()).data().resources.find((r) => r.id === 'opaque-a').tripId, winner);
  await f.act(winner, 'reportReturnAndUnloading'); await rejects(f.act(winner, 'confirmReturnAndUnloading', f.driver), 'TRIP_FORBIDDEN'); await f.act(winner, 'confirmReturnAndUnloading');
  assert.equal((await f.act(winner, 'confirmReturnAndUnloading')).changed, false);
  assert.equal((await f.resources.get()).data().resources.find((r) => r.id === 'opaque-a').tripId, null);
  await f.reserve(loser, 'opaque-b');
  assert.equal((await f.db.doc(`users/${f.backup}`).get()).data().role, 'distributor');
}));

test('emulator rejects unknown cargo, incomplete resource records and rolls back staged writes', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const trip = f.trip('rollback'); const order = f.order('rollback'); await f.create(trip); await f.seedOrder(order, 1);
  await assert.rejects(f.txn(async (tx) => { await f.allocateInTransaction(tx, trip, order); throw new Error('abort'); }), /abort/);
  assert.equal((await f.ref(trip).get()).data().members.length, 0); assert.equal((await f.db.doc(`deliveryTripOrderReservations/${order}`).get()).exists, false);
  await f.updateItems(order, [{ ...f.orderItems(1)[0], loadClassificationSnapshot: 'UNKNOWN' }]);
  await rejects(f.allocate(trip, order), 'TRIP_LOAD_UNKNOWN');
  await f.updateItems(order, f.orderItems(1));
  await f.allocate(trip, order); await f.approve(trip); await f.resources.update({ initialized: false });
  await rejects(f.reserve(trip, 'opaque-a'), 'TRIP_RESOURCES_INVALID');
}));

test('emulator allows two different eligible Distributors to reserve different verified resources', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const first = f.trip('first-driver'); const second = f.trip('backup-driver'); const a = f.order('first-driver'); const b = f.order('backup-driver');
  await Promise.all([f.create(first), f.create(second, f.backup), f.seedOrder(a, 1), f.seedOrder(b, 1)]);
  await Promise.all([f.allocate(first, a), f.allocate(second, b)]); await Promise.all([f.approve(first), f.approve(second)]);
  await Promise.all([f.reserve(first, 'opaque-a'), f.reserve(second, 'opaque-b')]);
  const saved = (await f.resources.get()).data().resources;
  assert.equal(saved.filter((resource) => resource.tripId).length, 2);
  assert.deepEqual(new Set(saved.map((resource) => resource.distributorUid)), new Set([f.driver.decoded.uid, f.backup]));
}));

test('emulator uses the verified order snapshot after product classification, name and size change', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const trip = f.trip('snapshot'); const id = f.order('snapshot'); await f.create(trip);
  await f.seedOrder(id, 7, [{ productId: f.other, quantity: 2, productNameSnapshot: '24 pack' }]);
  await f.db.doc(`products/${f.water}`).update({ product_name: 'Different product', size: '24 pack', deliveryLoad: { verified: true, classification: 'other' } });
  await f.db.doc(`products/${f.other}`).update({ product_name: 'Changed', deliveryLoad: { verified: true, classification: 'standard_5_gallon' } });
  assert.equal((await f.allocate(trip, id)).standardContainers, 7);
  const saved = (await f.ref(trip).get()).data(); assert.equal(saved.hasOtherCargo, true); assert.equal(saved.members[0].cargo[1].quantity, 2);
  await rejects(f.approve(trip), 'TRIP_MIXED_REVIEW_REQUIRED');
}));

test('emulator rejects forged legacy, mismatched, malformed and unavailable provenance', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const trip = f.trip('legacy'); const id = f.order('legacy'); await f.create(trip); await f.seedOrder(id, 2);
  const proofRef = f.db.doc(`orderLoadSnapshots/${id}`); const good = (await proofRef.get()).data();
  await proofRef.delete(); await rejects(f.allocate(trip, id), 'TRIP_LOAD_UNKNOWN');
  await proofRef.set({ ...good, epoch: 'b'.repeat(64) }); await rejects(f.allocate(trip, id), 'TRIP_LOAD_UNKNOWN');
  await proofRef.set({ ...good, items: [{ ...good.items[0], quantity: 3 }] }); await rejects(f.allocate(trip, id), 'TRIP_LOAD_UNKNOWN');
  await proofRef.set(good);
  await f.db.doc(`requests/${id}`).update({ items: f.orderItems(3) }); await rejects(f.allocate(trip, id), 'TRIP_LOAD_UNKNOWN');
  await f.updateItems(id, f.orderItems(3)); assert.equal((await f.allocate(trip, id)).standardContainers, 3);
  const saved = (await f.ref(trip).get()).data(); assert.equal(saved.members.length, 1);
}));

test('emulator missing security configuration blocks allocation without fabricating provenance', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const trip = f.trip('no-security'); const id = f.order('no-security'); await f.create(trip); await f.seedOrder(id, 1);
  await f.db.doc('orderLoadSnapshotSecurity/current').update({ enabled: false });
  try { await rejects(f.allocate(trip, id), 'TRIP_LOAD_UNKNOWN'); }
  finally { await f.db.doc('orderLoadSnapshotSecurity/current').set({ enabled: true, epoch }); }
}));
