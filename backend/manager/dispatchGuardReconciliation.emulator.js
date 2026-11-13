// This tooling is intentionally limited to the local demo Firestore emulator.
// It is not a production migration entry point.
const { randomUUID, createHash } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { scheduleTimestampMillis } = require('../utils/scheduleTimestamp');
const { readDistributorGuard } = require('../utils/distributorCapacityGuard');

const ACTIVE = new Set(['distributor_assigned', 'accepted', 'scheduled', 'out_for_delivery', 'delivery_failed']);
const TERMINAL = new Set(['delivered', 'cancelled', 'canceled', 'rejected']);
const UNASSIGNED = new Set(['pending', 'outside_radius_pending_approval', 'manager_approval_pending', 'awaiting_distributor_assignment', 'branch_transfer_pending']);
const WINDOW_MS = 30 * 60 * 1000;
const uidPattern = /^[^/\s]{1,128}$/;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clean = (value) => typeof value === 'string' ? value.trim() : '';
const byId = (left, right) => left.orderId < right.orderId ? -1 : left.orderId > right.orderId ? 1 : 0;

function assertEmulator() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.GCLOUD_PROJECT !== 'demo-bluetap') {
    throw new Error('Reconciliation is restricted to the local demo-bluetap Firestore emulator.');
  }
}

function assertLocalDatabase(db) {
  assertEmulator();
  const settings = db?._settings;
  if (settings?.projectId !== 'demo-bluetap' || settings?.servicePath !== '127.0.0.1' || settings?.port !== 8080 || settings?.ssl !== false) {
    throw new Error('Reconciliation requires a Firestore client bound to the local demo emulator.');
  }
}

function scheduleOf(order) {
  const fields = ['scheduledAt', 'scheduled_at'].filter((field) => own(order, field));
  if (!fields.length) return { error: 'SCHEDULE_ABSENT' };
  const values = fields.map((field) => order[field]);
  if (values.every((value) => value === null)) return { time: null };
  if (values.some((value) => value == null)) return { error: 'SCHEDULE_AMBIGUOUS' };
  const times = values.map(scheduleTimestampMillis);
  if (times.some((value) => value === null)) return { error: 'SCHEDULE_INVALID' };
  if (times.some((value) => value !== times[0])) return { error: 'SCHEDULE_MISMATCH' };
  return { time: times[0] };
}

function analyzeOrders(snapshot, uid, profile) {
  const issues = []; const reservations = [];
  for (const doc of snapshot.docs) {
    const order = doc.data() || {}; const status = clean(order.status).toLowerCase();
    const canonical = clean(order.assignedDistributorUid); const legacy = clean(order.distributor_id);
    const malformed = ['assignedDistributorUid', 'distributor_id'].some((key) => own(order, key)
      && order[key] != null && order[key] !== '' && (typeof order[key] !== 'string' || order[key] !== order[key].trim() || !uidPattern.test(order[key])));
    if (!ACTIVE.has(status)) {
      if (!TERMINAL.has(status) && (canonical === uid || legacy === uid)) issues.push({ orderId: doc.id, reason: UNASSIGNED.has(status) ? 'ASSIGNMENT_STATUS_INCONSISTENT' : 'STATUS_UNRECOGNIZED' });
      else if (!TERMINAL.has(status) && !canonical && !legacy && malformed) issues.push({ orderId: doc.id, reason: 'ASSIGNMENT_AMBIGUOUS' });
      continue;
    }
    if (!canonical && !legacy) {
      // An accepted order may be unassigned or may have lost assignment data.
      issues.push({ orderId: doc.id, reason: 'ACTIVE_ASSIGNMENT_MISSING' });
      continue;
    }
    if (canonical !== uid && legacy !== uid) continue;
    if (malformed || (canonical && legacy && canonical !== legacy)) { issues.push({ orderId: doc.id, reason: 'ASSIGNMENT_AMBIGUOUS' }); continue; }
    const branch = clean(order.currentBranchId || order.branchId);
    if (!branch || branch !== clean(profile.branchId)) { issues.push({ orderId: doc.id, reason: 'BRANCH_MISMATCH' }); continue; }
    const scheduled = scheduleOf(order);
    if (scheduled.error) { issues.push({ orderId: doc.id, reason: scheduled.error }); continue; }
    reservations.push({ orderId: doc.id, time: scheduled.time });
  }
  reservations.sort(byId);
  if (reservations.length > 5) issues.push({ reason: 'CAPACITY_EXCEEDED', orderIds: reservations.map((entry) => entry.orderId) });
  for (let i = 0; i < reservations.length; i++) for (let j = i + 1; j < reservations.length; j++) {
    const left = reservations[i]; const right = reservations[j];
    if (left.time !== null && right.time !== null && Math.abs(left.time - right.time) < WINDOW_MS) {
      issues.push({ reason: 'SCHEDULE_CONFLICT', orderIds: [left.orderId, right.orderId] });
    }
  }
  return { issues, reservations };
}

function sameReservations(left, right) {
  return left.length === right.length && left.every((entry, index) => entry.orderId === right[index].orderId && entry.time === right[index].time);
}

function createEmulatorReconciler() {
  assertEmulator();
  const app = initializeApp({ projectId: 'demo-bluetap' }, `dispatch-reconcile-${randomUUID()}`);
  const db = getFirestore(app);
  assertLocalDatabase(db);
  async function inventory() {
    assertLocalDatabase(db);
    const [snapshot, profiles] = await Promise.all([db.collection('requests').get(), db.collection('users').where('role', '==', 'distributor').get()]);
    const groups = new Map(profiles.docs.map((doc) => [doc.id, []])); const issues = [];
    const profileIds = new Set(profiles.docs.map((doc) => doc.id));
    for (const doc of snapshot.docs) {
      const order = doc.data() || {}; const status = clean(order.status).toLowerCase();
      const canonical = clean(order.assignedDistributorUid); const legacy = clean(order.distributor_id);
      const malformed = ['assignedDistributorUid', 'distributor_id'].some((key) => own(order, key)
        && order[key] != null && order[key] !== '' && (typeof order[key] !== 'string' || order[key] !== order[key].trim() || !uidPattern.test(order[key])));
      if (!ACTIVE.has(status)) {
        if (!TERMINAL.has(status) && (canonical || legacy)) issues.push({ orderId: doc.id, reason: UNASSIGNED.has(status) ? 'ASSIGNMENT_STATUS_INCONSISTENT' : 'STATUS_UNRECOGNIZED' });
        else if (!TERMINAL.has(status) && malformed) issues.push({ orderId: doc.id, reason: 'ASSIGNMENT_AMBIGUOUS' });
        continue;
      }
      if (malformed || (canonical && legacy && canonical !== legacy)) { issues.push({ orderId: doc.id, reason: 'ASSIGNMENT_AMBIGUOUS' }); continue; }
      const uid = canonical || legacy;
      if (!uid) { issues.push({ orderId: doc.id, reason: 'ACTIVE_ASSIGNMENT_MISSING' }); continue; }
      if (!groups.has(uid)) groups.set(uid, []);
      groups.get(uid).push(doc.id);
      if (!profileIds.has(uid)) issues.push({ orderId: doc.id, reason: 'DISTRIBUTOR_INVALID', uid });
    }
    const distributors = [...groups].map(([uid, orderIds]) => ({ uid, orderIds: orderIds.sort() })).sort((a, b) => a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
    return { distributors, issues: issues.sort(byId) };
  }
  async function reconcile(uid, { apply = false, expectedRevision, expectedVersion, expectedPlanHash } = {}) {
    assertLocalDatabase(db);
    if (typeof uid !== 'string' || !uidPattern.test(uid)) throw new Error('A valid Distributor UID is required.');
    if (typeof apply !== 'boolean' || (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) || (expectedVersion !== undefined && typeof expectedVersion !== 'string') || (expectedPlanHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedPlanHash))) throw new Error('Invalid reconciliation options.');
    const guardRef = db.collection('distributorDispatchGuards').doc(uid);
    return db.runTransaction(async (tx) => {
      const [profileSnap, guardSnap, orders] = await Promise.all([
        tx.get(db.collection('users').doc(uid)), tx.get(guardRef), tx.get(db.collection('requests')),
      ]);
      const profile = profileSnap.data() || {};
      if (!profileSnap.exists || profile.role !== 'distributor' || !clean(profile.branchId)) return { status: 'blocked', issues: [{ reason: 'DISTRIBUTOR_INVALID' }] };
      const analysis = analyzeOrders(orders, uid, profile);
      if (analysis.issues.length) return { status: 'blocked', issues: analysis.issues, count: analysis.reservations.length };
      let existing = null;
      if (!guardSnap.exists && (expectedRevision !== undefined || expectedVersion !== undefined || expectedPlanHash !== undefined)) return { status: 'blocked', issues: [{ reason: 'GUARD_CHANGED' }] };
      if (guardSnap.exists) {
        try { existing = await readDistributorGuard({ get: async () => guardSnap }, guardRef); }
        catch { return { status: 'blocked', issues: [{ reason: 'MALFORMED_GUARD' }] }; }
        const previous = [...existing.reservations].sort(byId);
        if (sameReservations(previous, analysis.reservations)) return { status: 'unchanged', count: previous.length, revision: existing.revision };
        const extra = previous.filter((entry) => !analysis.reservations.some((candidate) => candidate.orderId === entry.orderId));
        if (extra.length) return { status: 'blocked', issues: [{ reason: 'UNEXPLAINED_GUARD_RESERVATIONS', orderIds: extra.map((entry) => entry.orderId) }], revision: existing.revision };
        const time = guardSnap.updateTime;
        const version = time ? `${time.seconds}:${time.nanoseconds}` : null;
        const planHash = createHash('sha256').update(JSON.stringify(analysis.reservations)).digest('hex');
        if (!version) return { status: 'blocked', issues: [{ reason: 'GUARD_VERSION_UNAVAILABLE' }] };
        if (expectedRevision === undefined || expectedVersion === undefined || expectedPlanHash === undefined) return { status: 'blocked', issues: [{ reason: 'STALE_GUARD' }], revision: existing.revision, version, planHash, reservations: analysis.reservations };
        if (expectedRevision !== existing.revision || expectedVersion !== version) return { status: 'blocked', issues: [{ reason: 'GUARD_CHANGED' }], revision: existing.revision, version };
        if (expectedPlanHash !== planHash) return { status: 'blocked', issues: [{ reason: 'ORDER_STATE_CHANGED' }] };
        if (existing.revision >= Number.MAX_SAFE_INTEGER - 1) return { status: 'blocked', issues: [{ reason: 'REVISION_EXHAUSTED' }] };
      }
      const reservations = analysis.reservations.map((entry) => ({ orderId: entry.orderId, scheduledAt: entry.time === null ? null : new Date(entry.time) }));
      if (!apply) return { status: 'ready', count: reservations.length, reservations, revision: existing?.revision ?? null };
      if (existing) tx.update(guardRef, { reservations, revision: existing.revision + 1 });
      else tx.create(guardRef, { schemaVersion: 1, initialized: true, distributorUid: uid, revision: 0, reservations });
      return { status: existing ? 'reconciled' : 'initialized', count: reservations.length, revision: existing ? existing.revision + 1 : 0 };
    });
  }
  return { db, inventory, reconcile, close: () => deleteApp(app) };
}

module.exports = { createEmulatorReconciler };
