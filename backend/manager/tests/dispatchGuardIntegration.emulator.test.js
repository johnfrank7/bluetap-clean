const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createManagerDispatchHandler } = require('../dispatchHandler');
const { createAdminDispatchOverrideHandler } = require('../../admin/adminDispatchOverrideHandler');
const { createAdminAccountsHandler } = require('../../admin/accountManagementHandler');
const { createDistributorAssignedOrdersHandler } = require('../../distributor/assignedOrdersHandler');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.GCLOUD_PROJECT === 'demo-bluetap';
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, method, token, body) { const res = response(); await handler({ method, headers: { authorization: `Bearer ${token}` }, body }, res); return res; }

async function fixture(run) {
  const suffix = randomUUID(); const app = initializeApp({ projectId: 'demo-bluetap' }, `dispatch-guard-${suffix}`); const db = getFirestore(app);
  const ids = Object.fromEntries(['manager', 'admin', 'dist', 'dist2', 'branch', 'other'].map((key) => [key, `${key}-${suffix}`]));
  const now = Date.now() + 86400000; const at = (minutes) => new Date(now + minutes * 60000);
  const auth = { verifyIdToken: async (token) => token === 'admin' ? { uid: ids.admin, role: 'admin', admin: true } : token === 'manager' ? { uid: ids.manager, role: 'manager', manager: true } : { uid: ids.dist, role: 'distributor' }, getUser: async (uid) => ({ uid, disabled: false, email: `${uid}@example.test`, metadata: {} }) };
  const guard = (uid) => db.doc(`distributorDispatchGuards/${uid}`);
  const order = (name) => db.doc(`requests/${name}-${suffix}`);
  const ready = (uid, reservations = []) => ({ schemaVersion: 1, initialized: true, distributorUid: uid, revision: 0, reservations });
  try {
    await Promise.all([
      db.doc(`branches/${ids.branch}`).set({ name: 'Test branch', status: 'active', latitude: 10.2, longitude: 123.5 }),
      db.doc(`branches/${ids.other}`).set({ name: 'Other branch', status: 'active', latitude: 10.3, longitude: 123.6 }),
      db.doc(`users/${ids.manager}`).set({ role: 'manager', managerStatus: 'active', branchId: ids.branch }),
      db.doc(`users/${ids.admin}`).set({ role: 'admin' }),
      ...[ids.dist, ids.dist2].map((uid) => db.doc(`users/${uid}`).set({ role: 'distributor', accountStatus: 'active', approvalStatus: 'active', branchId: ids.branch, fullName: 'Test Driver', email: `${uid}@example.test`, phone: '09123456789', completeAddress: 'Test Barangay' })),
      guard(ids.dist).set(ready(ids.dist)), guard(ids.dist2).set(ready(ids.dist2)),
    ]);
    const baseOrder = (status = 'awaiting_distributor_assignment') => ({ status, branchId: ids.branch, currentBranchId: ids.branch, requesterUid: `requester-${randomUUID()}`, items: [] });
    const manager = (source = db, authSource = auth) => createManagerDispatchHandler(() => ({ auth: authSource, db: source }));
    const admin = (source = db) => createAdminDispatchOverrideHandler(() => ({ auth, db: source }));
    const distributor = (source = db) => createDistributorAssignedOrdersHandler(() => ({ auth, db: source }));
    await run({ db, ids, at, auth, guard, order, ready, baseOrder, manager, admin, distributor });
  } finally { await deleteApp(app); }
}

function raceDb(db, guardPath) {
  let count = 0; let release; const barrier = new Promise((resolve) => { release = resolve; });
  return { collection: db.collection.bind(db), runTransaction: (fn) => db.runTransaction((tx) => fn(new Proxy(tx, { get(target, key) {
    if (key === 'get') return async (ref) => { if (ref.path === guardPath && count < 2) { count++; if (count === 2) release(); await barrier; } return target.get(ref); };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } }))) };
}

test('emulator Manager and Admin compete for the fifth capacity slot', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const reservations = [];
  for (let i = 0; i < 4; i++) { const ref = f.order(`active-${i}`); const time = f.at(i * 120); reservations.push({ orderId: ref.id, scheduledAt: time }); await ref.set({ ...f.baseOrder('scheduled'), assignedDistributorUid: f.ids.dist, scheduledAt: time }); }
  await f.guard(f.ids.dist).set(f.ready(f.ids.dist, reservations));
  const a = f.order('manager'); const b = f.order('admin'); await Promise.all([a.set(f.baseOrder()), b.set(f.baseOrder())]);
  const db = raceDb(f.db, f.guard(f.ids.dist).path);
  const results = await Promise.all([
    call(f.manager(db), 'PATCH', 'manager', { action: 'assign-distributor', orderId: a.id, distributorUid: f.ids.dist, scheduledAt: f.at(600).toISOString() }),
    call(f.admin(db), 'POST', 'admin', { orderId: b.id, distributorUid: f.ids.dist, scheduledAt: f.at(720).toISOString(), reason: 'Emergency reassignment' }),
  ]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
  assert.equal(results.find((result) => result.statusCode === 409).body.error.reason, 'DISTRIBUTOR_WORKLOAD_EXCEEDED');
  assert.equal((await f.guard(f.ids.dist).get()).data().reservations.length, 5);
}));

test('emulator Manager and Admin competing times cannot overlap', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const a = f.order('manager-time'); const b = f.order('admin-time'); await Promise.all([a.set(f.baseOrder()), b.set(f.baseOrder())]);
  const db = raceDb(f.db, f.guard(f.ids.dist).path);
  const results = await Promise.all([
    call(f.manager(db), 'PATCH', 'manager', { action: 'assign-distributor', orderId: a.id, distributorUid: f.ids.dist, scheduledAt: f.at(600).toISOString() }),
    call(f.admin(db), 'POST', 'admin', { orderId: b.id, distributorUid: f.ids.dist, scheduledAt: f.at(615).toISOString(), reason: 'Emergency reassignment' }),
  ]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
  assert.equal(results.find((result) => result.statusCode === 409).body.error.reason, 'DISTRIBUTOR_SCHEDULE_CONFLICT');
  assert.equal((await f.guard(f.ids.dist).get()).data().reservations.length, 1);
}));

test('emulator guard checks canonical and legacy assignments once each', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const entries = [];
  for (const [index, fields] of [{ assignedDistributorUid: f.ids.dist }, { distributor_id: f.ids.dist }, { assignedDistributorUid: f.ids.dist, distributor_id: f.ids.dist }].entries()) {
    const ref = f.order(`union-${index}`); const scheduledAt = f.at(index * 120);
    await ref.set({ ...f.baseOrder('scheduled'), ...fields, scheduledAt }); entries.push({ orderId: ref.id, scheduledAt });
  }
  await f.guard(f.ids.dist).set(f.ready(f.ids.dist, entries));
  const pending = f.order('union-pending'); await pending.set(f.baseOrder());
  const result = await call(f.manager(), 'PATCH', 'manager', { action: 'assign-distributor', orderId: pending.id, distributorUid: f.ids.dist, scheduledAt: f.at(600).toISOString() });
  assert.equal(result.statusCode, 200);
  const saved = (await f.guard(f.ids.dist).get()).data().reservations;
  assert.equal(saved.length, 4); assert.equal(new Set(saved.map((entry) => entry.orderId)).size, 4);
}));

test('emulator excludes delivered history without omitting legacy active status representations', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const entries = [];
  for (const [index, status] of [' DISTRIBUTOR_ASSIGNED ', ['accepted'], 'ScHeDuLeD', ' OUT_FOR_DELIVERY '].entries()) {
    const ref = f.order(`status-active-${index}`); const scheduledAt = f.at(index * 120);
    await ref.set({ ...f.baseOrder(), status, assignedDistributorUid: f.ids.dist, distributor_id: f.ids.dist, scheduledAt });
    entries.push({ orderId: ref.id, scheduledAt });
  }
  const delivered = f.order('status-delivered'); const upper = f.order('status-upper'); const missing = f.order('status-missing'); const nullStatus = f.order('status-null');
  await Promise.all([
    delivered.set({ ...f.baseOrder('delivered'), assignedDistributorUid: f.ids.dist }),
    upper.set({ ...f.baseOrder(' DELIVERED '), assignedDistributorUid: f.ids.dist }),
    missing.set({ assignedDistributorUid: f.ids.dist }),
    nullStatus.set({ status: null, assignedDistributorUid: f.ids.dist }),
    f.guard(f.ids.dist).set(f.ready(f.ids.dist, entries)),
  ]);
  for (const field of ['assignedDistributorUid', 'distributor_id']) {
    const old = await f.db.collection('requests').where(field, '==', f.ids.dist).get();
    const filtered = await f.db.collection('requests').where(field, '==', f.ids.dist).where('status', '!=', 'delivered').get();
    const active = (snapshot) => snapshot.docs.filter((doc) => ['distributor_assigned', 'accepted', 'scheduled', 'out_for_delivery', 'delivery_failed'].includes(String(doc.data().status || '').trim().toLowerCase())).map((doc) => doc.id).sort();
    assert.deepEqual(active(filtered), active(old));
    if (field === 'assignedDistributorUid') {
      assert.ok(!filtered.docs.some((doc) => [delivered.id, missing.id, nullStatus.id].includes(doc.id)));
      assert.ok(filtered.docs.some((doc) => doc.id === upper.id));
    }
  }
  const pending = f.order('status-pending'); await pending.set(f.baseOrder());
  const result = await call(f.manager(), 'PATCH', 'manager', { action: 'assign-distributor', orderId: pending.id, distributorUid: f.ids.dist, scheduledAt: f.at(600).toISOString() });
  assert.equal(result.statusCode, 200); assert.equal((await f.guard(f.ids.dist).get()).data().reservations.length, 5);
}));

test('emulator branch change wins against a stale Manager eligibility read', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const ref = f.order('branch-race'); await ref.set(f.baseOrder());
  let reached; let release; const waiting = new Promise((resolve) => { reached = resolve; }); const barrier = new Promise((resolve) => { release = resolve; });
  const auth = { ...f.auth, getUser: async (uid) => { if (uid === f.ids.dist) { reached(); await barrier; } return { uid, disabled: false }; } };
  const pending = call(f.manager(f.db, auth), 'PATCH', 'manager', { action: 'assign-distributor', orderId: ref.id, distributorUid: f.ids.dist, scheduledAt: f.at(600).toISOString() });
  await waiting;
  try {
    const accounts = createAdminAccountsHandler(() => ({ auth: f.auth, db: f.db }));
    const moved = await call(accounts, 'PATCH', 'admin', { uid: f.ids.dist, action: 'updateAccount', branchId: f.ids.other });
    assert.equal(moved.statusCode, 200);
  } finally { release(); }
  const assigned = await pending; assert.equal(assigned.statusCode, 409);
  assert.equal((await ref.get()).data().assignedDistributorUid, undefined);
  assert.equal((await f.guard(f.ids.dist).get()).data().reservations.length, 0);
}));

test('emulator Distributor reschedule races Manager reassignment without losing either guard', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const ref = f.order('reschedule-race');
  await ref.set({ ...f.baseOrder('delivery_failed'), assignedDistributorUid: f.ids.dist, scheduledAt: null, assignmentVersion: 2 });
  await f.guard(f.ids.dist).set(f.ready(f.ids.dist, [{ orderId: ref.id, scheduledAt: null }]));
  const [rescheduled, reassigned] = await Promise.all([
    call(f.distributor(), 'PATCH', 'distributor', { orderId: ref.id, action: 'reschedule-delivery', scheduledAt: f.at(600).toISOString() }),
    call(f.manager(), 'PATCH', 'manager', { orderId: ref.id, action: 'reassign-distributor', distributorUid: f.ids.dist2, scheduledAt: f.at(720).toISOString(), reassignmentReason: 'Test reassignment', expectedStatus: 'delivery_failed', clientMutationId: 'guard-race-1234' }),
  ]);
  assert.equal([rescheduled.statusCode, reassigned.statusCode].filter((status) => status === 200).length, 1);
  assert.ok([404, 409].includes([rescheduled.statusCode, reassigned.statusCode].find((status) => status !== 200)));
  const saved = (await ref.get()).data(); const one = (await f.guard(f.ids.dist).get()).data().reservations; const two = (await f.guard(f.ids.dist2).get()).data().reservations;
  assert.equal(one.length + two.length, 1);
  assert.equal((one[0] || two[0]).orderId, ref.id);
  assert.equal(one.length ? saved.assignedDistributorUid : f.ids.dist2, one.length ? f.ids.dist : saved.assignedDistributorUid);
}));

test('emulator releases a verified unscheduled reservation and rejects missing guards for assignments', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const ref = f.order('release-null'); await ref.set({ ...f.baseOrder('distributor_assigned'), assignedDistributorUid: f.ids.dist, scheduledAt: null });
  await f.guard(f.ids.dist).set(f.ready(f.ids.dist, [{ orderId: ref.id, scheduledAt: null }]));
  const declined = await call(f.distributor(), 'PATCH', 'distributor', { orderId: ref.id, action: 'decline-assignment' });
  assert.equal(declined.statusCode, 200); assert.equal((await f.guard(f.ids.dist).get()).data().reservations.length, 0);
  await f.guard(f.ids.dist).delete();
  const legacy = f.order('release-without-guard'); await legacy.set({ ...f.baseOrder('distributor_assigned'), assignedDistributorUid: f.ids.dist, scheduledAt: null });
  assert.equal((await call(f.distributor(), 'PATCH', 'distributor', { orderId: legacy.id, action: 'decline-assignment' })).statusCode, 200);
  assert.equal((await f.guard(f.ids.dist).get()).exists, false);
  const missing = f.order('missing-guard'); await missing.set(f.baseOrder());
  const result = await call(f.manager(), 'PATCH', 'manager', { action: 'assign-distributor', orderId: missing.id, distributorUid: f.ids.dist, scheduledAt: f.at(600).toISOString() });
  assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'DISPATCH_GUARD_INVALID');
  assert.equal((await missing.get()).data().assignedDistributorUid, undefined);
}));

test('emulator reassignment fails closed when the source guard is missing', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const ref = f.order('missing-source'); await ref.set({ ...f.baseOrder('delivery_failed'), assignedDistributorUid: f.ids.dist, scheduledAt: null });
  await f.guard(f.ids.dist).delete();
  const result = await call(f.manager(), 'PATCH', 'manager', { action: 'reassign-distributor', orderId: ref.id, distributorUid: f.ids.dist2, scheduledAt: f.at(600).toISOString(), reassignmentReason: 'Needs new driver', expectedStatus: 'delivery_failed', clientMutationId: 'missing-source-123' });
  assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'DISPATCH_GUARD_INVALID');
  assert.equal((await ref.get()).data().assignedDistributorUid, f.ids.dist);
  assert.equal((await f.guard(f.ids.dist2).get()).data().reservations.length, 0);
}));

test('emulator rejects a Firestore hold and an incomplete initialized guard', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const ref = f.order('hold'); await ref.set(f.baseOrder());
  await f.db.doc(`users/${f.ids.dist}`).update({ accountActionHoldIntentId: 'pending-action' });
  const request = { action: 'assign-distributor', orderId: ref.id, distributorUid: f.ids.dist, scheduledAt: f.at(600).toISOString() };
  const held = await call(f.manager(), 'PATCH', 'manager', request);
  assert.equal(held.statusCode, 409); assert.equal(held.body.error.reason, 'DISTRIBUTOR_NOT_ELIGIBLE');
  await f.db.doc(`users/${f.ids.dist}`).update({ accountActionHoldIntentId: '' });
  const legacy = f.order('omitted-legacy'); await legacy.set({ ...f.baseOrder('scheduled'), distributor_id: f.ids.dist, scheduledAt: f.at(0) });
  const incomplete = await call(f.manager(), 'PATCH', 'manager', request);
  assert.equal(incomplete.statusCode, 409); assert.equal(incomplete.body.error.reason, 'DISPATCH_GUARD_INVALID');
  assert.equal((await ref.get()).data().assignedDistributorUid, undefined);
}));

test('emulator branch transaction sees an assignment committed after its precheck', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const ref = f.order('branch-after'); await ref.set(f.baseOrder());
  let reached; let release; const waiting = new Promise((resolve) => { reached = resolve; }); const barrier = new Promise((resolve) => { release = resolve; });
  const delayed = { collection: f.db.collection.bind(f.db), runTransaction: async (fn) => { reached(); await barrier; return f.db.runTransaction(fn); } };
  const accounts = createAdminAccountsHandler(() => ({ auth: f.auth, db: delayed }));
  const moving = call(accounts, 'PATCH', 'admin', { uid: f.ids.dist, action: 'updateAccount', branchId: f.ids.other });
  await waiting;
  try {
    const assigned = await call(f.manager(), 'PATCH', 'manager', { action: 'assign-distributor', orderId: ref.id, distributorUid: f.ids.dist, scheduledAt: f.at(600).toISOString() });
    assert.equal(assigned.statusCode, 200);
  } finally { release(); }
  const moved = await moving; assert.equal(moved.statusCode, 409); assert.equal(moved.body.error.reason, 'DISTRIBUTOR_ACTIVE_DELIVERIES');
  assert.equal((await f.db.doc(`users/${f.ids.dist}`).get()).data().branchId, f.ids.branch);
}));

test('emulator serializes overlapping branch-change and assignment transactions', { skip: !enabled, timeout: 60000 }, async () => fixture(async (f) => {
  const ref = f.order('branch-overlap'); await ref.set(f.baseOrder());
  const db = raceDb(f.db, f.guard(f.ids.dist).path);
  const accounts = createAdminAccountsHandler(() => ({ auth: f.auth, db }));
  const [assigned, moved] = await Promise.all([
    call(f.manager(db), 'PATCH', 'manager', { action: 'assign-distributor', orderId: ref.id, distributorUid: f.ids.dist, scheduledAt: f.at(600).toISOString() }),
    call(accounts, 'PATCH', 'admin', { uid: f.ids.dist, action: 'updateAccount', branchId: f.ids.other }),
  ]);
  assert.deepEqual([assigned.statusCode, moved.statusCode].sort(), [200, 409]);
  const profile = (await f.db.doc(`users/${f.ids.dist}`).get()).data();
  const order = (await ref.get()).data(); const reservations = (await f.guard(f.ids.dist).get()).data().reservations;
  if (assigned.statusCode === 200) {
    assert.equal(profile.branchId, f.ids.branch); assert.equal(order.assignedDistributorUid, f.ids.dist); assert.equal(reservations.length, 1);
  } else {
    assert.equal(profile.branchId, f.ids.other); assert.equal(order.assignedDistributorUid, undefined); assert.equal(reservations.length, 0);
  }
}));

test('emulator retries Manager reschedule without duplicating a reservation', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const ref = f.order('retry'); await ref.set({ ...f.baseOrder('delivery_failed'), assignedDistributorUid: f.ids.dist, scheduledAt: null, assignmentVersion: 2 });
  await f.guard(f.ids.dist).set(f.ready(f.ids.dist, [{ orderId: ref.id, scheduledAt: null }]));
  const payload = { action: 'reschedule-delivery', orderId: ref.id, scheduledAt: f.at(600).toISOString(), rescheduleReason: 'Confirmed with requester', clientMutationId: 'guard-retry-1234' };
  assert.equal((await call(f.manager(), 'PATCH', 'manager', payload)).statusCode, 200);
  const first = (await f.guard(f.ids.dist).get()).data();
  assert.equal((await call(f.manager(), 'PATCH', 'manager', payload)).statusCode, 200);
  const second = (await f.guard(f.ids.dist).get()).data();
  assert.equal(second.revision, first.revision); assert.equal(second.reservations.length, 1); assert.equal(second.reservations[0].orderId, ref.id);
}));

test('emulator transaction failure rolls back the order and guard together', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const ref = f.order('rollback'); await ref.set(f.baseOrder());
  const failing = { collection: f.db.collection.bind(f.db), runTransaction: (fn) => f.db.runTransaction((tx) => fn(new Proxy(tx, { get(target, key) {
    if (key === 'update') return (doc, data) => { target.update(doc, data); if (doc.path === ref.path) throw new Error('injected transaction failure'); return target; };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } }))) };
  const result = await call(f.manager(failing), 'PATCH', 'manager', { action: 'assign-distributor', orderId: ref.id, distributorUid: f.ids.dist, scheduledAt: f.at(600).toISOString() });
  assert.equal(result.statusCode, 500);
  assert.equal((await ref.get()).data().assignedDistributorUid, undefined);
  const guard = (await f.guard(f.ids.dist).get()).data(); assert.equal(guard.revision, 0); assert.equal(guard.reservations.length, 0);
}));

test('emulator failure retains and completion releases the unscheduled delivery reservation', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const ref = f.order('delivery-lifecycle'); await ref.set({ ...f.baseOrder('out_for_delivery'), assignedDistributorUid: f.ids.dist, scheduledAt: null, assignmentVersion: 2 });
  await f.guard(f.ids.dist).set(f.ready(f.ids.dist, [{ orderId: ref.id, scheduledAt: null }]));
  const failed = await call(f.distributor(), 'PATCH', 'distributor', { orderId: ref.id, action: 'fail-delivery', failureReasonCode: 'CUSTOMER_UNAVAILABLE' });
  assert.equal(failed.statusCode, 200); assert.equal((await f.guard(f.ids.dist).get()).data().reservations[0].scheduledAt, null);
  const rescheduled = await call(f.distributor(), 'PATCH', 'distributor', { orderId: ref.id, action: 'reschedule-delivery', scheduledAt: f.at(600).toISOString() });
  assert.equal(rescheduled.statusCode, 200);
  assert.equal((await call(f.distributor(), 'PATCH', 'distributor', { orderId: ref.id, action: 'start-delivery' })).statusCode, 200);
  assert.equal((await call(f.distributor(), 'PATCH', 'distributor', { orderId: ref.id, action: 'mark-delivered' })).statusCode, 200);
  assert.equal((await f.guard(f.ids.dist).get()).data().reservations.length, 0);
  assert.equal((await ref.get()).data().status, 'delivered');
}));
