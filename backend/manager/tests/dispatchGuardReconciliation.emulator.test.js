const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createEmulatorReconciler } = require('../dispatchGuardReconciliation.emulator');
const { createManagerDispatchHandler } = require('../dispatchHandler');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.GCLOUD_PROJECT === 'demo-bluetap';
const at = (minutes) => new Date(Date.now() + 86400000 + minutes * 60000);
async function fixture(run) {
  const tool = createEmulatorReconciler(); const suffix = randomUUID();
  const uid = `dist-${suffix}`; const branchId = `branch-${suffix}`; const order = (name) => tool.db.doc(`requests/${name}-${suffix}`);
  const guard = tool.db.doc(`distributorDispatchGuards/${uid}`);
  try {
    await tool.db.doc(`users/${uid}`).set({ role: 'distributor', approvalStatus: 'active', branchId, fullName: 'Emulator Driver' });
    await tool.db.doc(`branches/${branchId}`).set({ status: 'active', name: 'Emulator Branch', latitude: 10.2, longitude: 123.5 });
    await run({ ...tool, uid, branchId, guard, order });
  } finally { await tool.close(); }
}
const active = (f, data = {}) => ({ status: 'scheduled', branchId: f.branchId, currentBranchId: f.branchId, ...data });

test('reconciliation rejects non-emulator environments before creating an SDK client', () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST; const project = process.env.GCLOUD_PROJECT;
  try {
    process.env.FIRESTORE_EMULATOR_HOST = 'production.example:8080'; process.env.GCLOUD_PROJECT = 'demo-bluetap';
    assert.throws(() => createEmulatorReconciler(), /restricted to the local/);
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; process.env.GCLOUD_PROJECT = 'not-demo';
    assert.throws(() => createEmulatorReconciler(), /restricted to the local/);
  } finally {
    if (host === undefined) delete process.env.FIRESTORE_EMULATOR_HOST; else process.env.FIRESTORE_EMULATOR_HOST = host;
    if (project === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = project;
  }
});

test('emulator reconciler refuses a changed environment or nonlocal client configuration', { skip: !enabled }, async () => fixture(async (f) => {
  const host = process.env.FIRESTORE_EMULATOR_HOST; const servicePath = f.db._settings.servicePath;
  try {
    process.env.FIRESTORE_EMULATOR_HOST = 'example.invalid:8080';
    await assert.rejects(f.reconcile(f.uid, { apply: true }), /restricted to the local/);
    process.env.FIRESTORE_EMULATOR_HOST = host;
    f.db._settings.servicePath = 'example.invalid';
    await assert.rejects(f.reconcile(f.uid, { apply: true }), /bound to the local/);
  } finally { process.env.FIRESTORE_EMULATOR_HOST = host; f.db._settings.servicePath = servicePath; }
  assert.equal((await f.guard.get()).exists, false);
}));

test('emulator initializes five distinct canonical and legacy assignments, including explicit null, idempotently', { skip: !enabled }, async () => fixture(async (f) => {
  assert.deepEqual((await f.inventory()).distributors.find((entry) => entry.uid === f.uid).orderIds, []);
  const refs = Array.from({ length: 5 }, (_, i) => f.order(`assignment-${i}`));
  const orders = refs.map((ref, i) => active(f, { ...(i === 0 ? { assignedDistributorUid: f.uid, distributor_id: f.uid } : i % 2 ? { distributor_id: f.uid } : { assignedDistributorUid: f.uid }), scheduledAt: i === 4 ? null : at(i * 60) }));
  await Promise.all(refs.map((ref, i) => ref.set(orders[i])));
  const preserved = ['chatConversations', 'deliveryAttempts', 'adminAuditLogs'].map((name) => f.db.doc(`${name}/${f.uid}`));
  await Promise.all(preserved.map((ref) => ref.set({ marker: 'preserve' })));
  const before = await Promise.all(refs.map((ref) => ref.get()));
  const otherBefore = await Promise.all(preserved.map((ref) => ref.get()));
  const inventory = await f.inventory(); const group = inventory.distributors.find((entry) => entry.uid === f.uid);
  assert.equal(group.orderIds.length, 5); assert.equal(new Set(group.orderIds).size, 5);
  const preview = await f.reconcile(f.uid); assert.equal(preview.status, 'ready'); assert.equal(preview.count, 5); assert.equal((await f.guard.get()).exists, false);
  assert.equal((await f.reconcile(f.uid, { apply: true })).status, 'initialized');
  assert.equal((await f.reconcile(f.uid, { apply: true })).status, 'unchanged');
  const saved = (await f.guard.get()).data(); assert.equal(saved.revision, 0); assert.equal(saved.reservations.length, 5);
  assert.equal(saved.reservations.filter((entry) => entry.scheduledAt === null).length, 1);
  const after = await Promise.all(refs.map((ref) => ref.get()));
  assert.deepEqual(after.map((snap) => snap.updateTime.toMillis()), before.map((snap) => snap.updateTime.toMillis()));
  assert.deepEqual((await Promise.all(preserved.map((ref) => ref.get()))).map((snap) => snap.updateTime.toMillis()), otherBefore.map((snap) => snap.updateTime.toMillis()));
}));

test('emulator reports over-capacity, schedule conflicts, mismatched aliases and malformed data without creating guards', { skip: !enabled }, async () => {
  for (const kind of ['capacity', 'conflict', 'aliases', 'malformed_uid', 'invalid', 'ambiguous_schedule', 'absent', 'branch', 'unknown_status', 'pending_assignment']) await fixture(async (f) => {
    const count = kind === 'capacity' ? 6 : kind === 'conflict' ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const ref = f.order(`bad-${i}`); const data = active(f, { assignedDistributorUid: f.uid, scheduledAt: at(kind === 'conflict' ? i * 10 : i * 60) });
      if (kind === 'aliases') data.distributor_id = 'other-distributor';
      if (kind === 'malformed_uid') data.distributor_id = 123;
      if (kind === 'invalid') data.scheduledAt = 'malformed';
      if (kind === 'ambiguous_schedule') { data.scheduledAt = null; data.scheduled_at = at(0); }
      if (kind === 'absent') delete data.scheduledAt;
      if (kind === 'branch') data.currentBranchId = 'other-branch';
      if (kind === 'unknown_status') data.status = 'not-a-known-status';
      if (kind === 'pending_assignment') data.status = 'pending';
      await ref.set(data);
    }
    const result = await f.reconcile(f.uid, { apply: true });
    assert.equal(result.status, 'blocked');
    assert.ok(result.issues.some((issue) => issue.reason === { capacity: 'CAPACITY_EXCEEDED', conflict: 'SCHEDULE_CONFLICT', aliases: 'ASSIGNMENT_AMBIGUOUS', malformed_uid: 'ASSIGNMENT_AMBIGUOUS', invalid: 'SCHEDULE_INVALID', ambiguous_schedule: 'SCHEDULE_AMBIGUOUS', absent: 'SCHEDULE_ABSENT', branch: 'BRANCH_MISMATCH', unknown_status: 'STATUS_UNRECOGNIZED', pending_assignment: 'ASSIGNMENT_STATUS_INCONSISTENT' }[kind]));
    assert.equal((await f.guard.get()).exists, false);
  });
});

test('emulator rejects malformed and unexplained guards rather than discarding reservations', { skip: !enabled }, async () => fixture(async (f) => {
  const ref = f.order('active'); await ref.set(active(f, { assignedDistributorUid: f.uid, scheduledAt: at(0) }));
  await f.guard.set({ schemaVersion: 1, initialized: true, distributorUid: f.uid, revision: 0, reservations: [{ orderId: ref.id }] });
  assert.equal((await f.reconcile(f.uid, { apply: true })).issues[0].reason, 'MALFORMED_GUARD');
  await f.guard.set({ schemaVersion: 1, initialized: true, distributorUid: f.uid, revision: 0, reservations: [{ orderId: ref.id, scheduledAt: null }, { orderId: ref.id, scheduledAt: null }] });
  assert.equal((await f.reconcile(f.uid, { apply: true })).issues[0].reason, 'MALFORMED_GUARD');
  await f.guard.set({ schemaVersion: 1, initialized: true, distributorUid: f.uid, revision: 0, reservations: [{ orderId: 'unexplained-order', scheduledAt: at(120) }] });
  assert.equal((await f.reconcile(f.uid, { apply: true, expectedRevision: 0, expectedVersion: '0:0', expectedPlanHash: 'a'.repeat(64) })).issues[0].reason, 'UNEXPLAINED_GUARD_RESERVATIONS');
  assert.equal((await f.guard.get()).data().reservations[0].orderId, 'unexplained-order');
}));

test('emulator stale guard repair requires the exact previewed guard version and order plan', { skip: !enabled }, async () => fixture(async (f) => {
  const ref = f.order('stale'); await ref.set(active(f, { assignedDistributorUid: f.uid, scheduledAt: at(0) }));
  await f.guard.set({ schemaVersion: 1, initialized: true, distributorUid: f.uid, revision: 0, reservations: [] });
  const preview = await f.reconcile(f.uid); assert.equal(preview.issues[0].reason, 'STALE_GUARD');
  await f.guard.update({ concurrentMarker: 'changed' });
  const stale = await f.reconcile(f.uid, { apply: true, expectedRevision: preview.revision, expectedVersion: preview.version, expectedPlanHash: preview.planHash });
  assert.equal(stale.issues[0].reason, 'GUARD_CHANGED'); assert.equal((await f.guard.get()).data().reservations.length, 0);
  const next = await f.reconcile(f.uid); const nextTime = at(120); await ref.update({ scheduledAt: nextTime });
  const changed = await f.reconcile(f.uid, { apply: true, expectedRevision: next.revision, expectedVersion: next.version, expectedPlanHash: next.planHash });
  assert.equal(changed.issues[0].reason, 'ORDER_STATE_CHANGED');
  const fresh = await f.reconcile(f.uid); const saved = await f.reconcile(f.uid, { apply: true, expectedRevision: fresh.revision, expectedVersion: fresh.version, expectedPlanHash: fresh.planHash });
  assert.equal(saved.status, 'reconciled'); assert.equal(saved.revision, 1); assert.equal((await f.guard.get()).data().reservations[0].scheduledAt.toMillis(), nextTime.getTime());
}));

test('emulator aborting initialization leaves both source orders and guard unchanged', { skip: !enabled }, async () => fixture(async (f) => {
  const ref = f.order('rollback'); await ref.set(active(f, { assignedDistributorUid: f.uid, scheduledAt: at(0) }));
  const before = await ref.get(); const run = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = (fn) => run((tx) => fn(new Proxy(tx, { get(target, key) {
    if (key === 'create') return (document, data) => { target.create(document, data); if (document.path === f.guard.path) throw new Error('injected reconciliation failure'); return target; };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } })));
  await assert.rejects(f.reconcile(f.uid, { apply: true }), /injected reconciliation failure/);
  assert.equal((await f.guard.get()).exists, false); assert.equal((await ref.get()).updateTime.toMillis(), before.updateTime.toMillis());
}));

test('emulator refuses a repair that would exhaust the guard revision', { skip: !enabled }, async () => fixture(async (f) => {
  const ref = f.order('revision-limit'); await ref.set(active(f, { assignedDistributorUid: f.uid, scheduledAt: at(0) }));
  await f.guard.set({ schemaVersion: 1, initialized: true, distributorUid: f.uid, revision: Number.MAX_SAFE_INTEGER - 1, reservations: [] });
  const preview = await f.reconcile(f.uid);
  const result = await f.reconcile(f.uid, { apply: true, expectedRevision: preview.revision, expectedVersion: preview.version, expectedPlanHash: preview.planHash });
  assert.equal(result.issues[0].reason, 'REVISION_EXHAUSTED');
  assert.equal((await f.guard.get()).data().revision, Number.MAX_SAFE_INTEGER - 1);
}));

test('emulator guard initialization and a concurrent Manager assignment cannot fabricate capacity', { skip: !enabled, timeout: 30000 }, async () => fixture(async (f) => {
  const managerUid = `manager-${randomUUID()}`; const pending = f.order('pending');
  await f.db.doc(`users/${managerUid}`).set({ role: 'manager', managerStatus: 'active', branchId: f.branchId });
  await pending.set({ status: 'awaiting_distributor_assignment', branchId: f.branchId, currentBranchId: f.branchId, requesterUid: `req-${randomUUID()}`, items: [] });
  const auth = { verifyIdToken: async () => ({ uid: managerUid, role: 'manager', manager: true }), getUser: async (uid) => ({ uid, disabled: false }) };
  const handler = createManagerDispatchHandler(() => ({ auth, db: f.db }));
  const response = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
  let arrivals = 0; let release; const barrier = new Promise((resolve) => { release = resolve; });
  const run = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = (fn) => run((tx) => fn(new Proxy(tx, { get(target, key) {
    if (key === 'get') return async (ref) => { if (ref.path === f.guard.path && arrivals < 2) { arrivals++; if (arrivals === 2) release(); await barrier; } return target.get(ref); };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } })));
  const [init] = await Promise.all([
    f.reconcile(f.uid, { apply: true }),
    handler({ method: 'PATCH', headers: { authorization: 'Bearer test' }, body: { action: 'assign-distributor', orderId: pending.id, distributorUid: f.uid, scheduledAt: at(600).toISOString() } }, response),
  ]);
  assert.equal(arrivals, 2);
  assert.equal(init.status, 'initialized'); assert.ok([200, 409].includes(response.statusCode));
  const saved = (await f.guard.get()).data(); const assigned = (await pending.get()).data().assignedDistributorUid === f.uid;
  assert.equal(saved.reservations.length, assigned ? 1 : 0);
  if (assigned) assert.equal(saved.reservations[0].orderId, pending.id);
}));

test('emulator reports an active delivery with no identifiable assignee and leaves all records untouched', { skip: !enabled }, async () => fixture(async (f) => {
  const ref = f.order('orphan'); await ref.set(active(f, { status: 'delivery_failed', scheduledAt: null }));
  const accepted = f.order('accepted-without-owner'); await accepted.set(active(f, { status: 'accepted', scheduledAt: null }));
  const before = await ref.get(); const inventory = await f.inventory();
  assert.ok(inventory.issues.some((issue) => issue.orderId === ref.id && issue.reason === 'ACTIVE_ASSIGNMENT_MISSING'));
  assert.ok(inventory.issues.some((issue) => issue.orderId === accepted.id && issue.reason === 'ACTIVE_ASSIGNMENT_MISSING'));
  const result = await f.reconcile(f.uid, { apply: true });
  assert.ok(result.issues.some((issue) => issue.orderId === ref.id && issue.reason === 'ACTIVE_ASSIGNMENT_MISSING'));
  assert.equal((await f.guard.get()).exists, false); assert.equal((await ref.get()).updateTime.toMillis(), before.updateTime.toMillis());
}));
