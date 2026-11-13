const { OtpError } = require('./otpError');
const { scheduleTimestampMillis } = require('./scheduleTimestamp');
const { canonicalAccountStatus } = require('../auth/accountStatus');

const MAX_ACTIVE = 5;
const CONFLICT_MS = 30 * 60 * 1000;
const invalid = () => new OtpError(409, 'DISPATCH_GUARD_INVALID', 'Distributor reservation state requires reconciliation.');
const ACTIVE_STATUSES = new Set(['distributor_assigned', 'accepted', 'scheduled', 'out_for_delivery', 'delivery_failed']);
const clean = (value) => String(value || '').trim();
const assignment = (order = {}) => ACTIVE_STATUSES.has(clean(order.status).toLowerCase()) ? clean(order.assignedDistributorUid || order.distributor_id) : '';

function orderSchedule(order = {}) {
  const values = [order.scheduledAt, order.scheduled_at].filter((value) => value !== undefined && value !== null);
  if (!values.length) return null;
  const times = values.map(scheduleTimestampMillis);
  if (times.some((value) => value === null) || times.some((value) => value !== times[0])) throw invalid();
  return times[0];
}

// Read and plan separately so order/chat transactions can complete every read
// before either the reservation or lifecycle writes are staged.
async function readDistributorGuard(tx, guardRef) {
  const snapshot = await tx.get(guardRef);
  const data = snapshot.exists ? snapshot.data() : null;
  if (!data || data.schemaVersion !== 1 || data.initialized !== true || data.distributorUid !== guardRef.id ||
      !Number.isSafeInteger(data.revision) || data.revision < 0 || data.revision >= Number.MAX_SAFE_INTEGER ||
      !Array.isArray(data.reservations) || data.reservations.length > MAX_ACTIVE) throw invalid();
  const seen = new Set();
  // Null is reserved for an explicitly confirmed unscheduled order. Trusted
  // callers must verify that fact against the order before creating the entry.
  const reservations = data.reservations.map((entry) => {
    const explicitUnscheduled = entry && Object.prototype.hasOwnProperty.call(entry, 'scheduledAt') && entry.scheduledAt === null;
    const time = explicitUnscheduled ? null : scheduleTimestampMillis(entry?.scheduledAt);
    if (typeof entry?.orderId !== 'string' || !entry.orderId || entry.orderId.trim() !== entry.orderId ||
        entry.orderId.includes('/') || entry.orderId.length > 128 || seen.has(entry.orderId) || (time === null && !explicitUnscheduled)) throw invalid();
    seen.add(entry.orderId);
    return { orderId: entry.orderId, time };
  });
  for (let i = 0; i < reservations.length; i += 1) {
    for (let j = i + 1; j < reservations.length; j += 1) {
      if (reservations[i].time !== null && reservations[j].time !== null && Math.abs(reservations[i].time - reservations[j].time) < CONFLICT_MS) throw invalid();
    }
  }
  return { ref: guardRef, revision: data.revision, reservations };
}

function planDistributorReservation(guard, { orderId, scheduledAt, mustExist = false, mustBeAbsent = false }) {
  const timestamp = scheduledAt === null ? null : scheduleTimestampMillis(scheduledAt);
  if (typeof orderId !== 'string' || !orderId || orderId.trim() !== orderId || orderId.includes('/') || orderId.length > 128 || (timestamp === null && scheduledAt !== null)) throw invalid();
  const { reservations } = guard;
  const previous = reservations.find((entry) => entry.orderId === orderId);
  if ((mustExist && !previous) || (mustBeAbsent && previous)) throw invalid();
  if (previous?.time === timestamp) return { ref: guard.ref, changed: false, count: reservations.length };
  const others = reservations.filter((entry) => entry.orderId !== orderId);
  if (others.length >= MAX_ACTIVE) throw new OtpError(409, 'DISTRIBUTOR_WORKLOAD_EXCEEDED', 'Distributor has reached the maximum active capacity of 5 deliveries.');
  if (others.length && (timestamp === null || others.some((entry) => entry.time === null))) {
    throw new OtpError(409, 'DISTRIBUTOR_SCHEDULE_UNKNOWN', 'An existing or requested delivery has no schedule. Resolve it before checking for conflicts.');
  }
  if (others.some((entry) => Math.abs(entry.time - timestamp) < CONFLICT_MS)) {
    throw new OtpError(409, 'DISTRIBUTOR_SCHEDULE_CONFLICT', 'Distributor already has an active delivery scheduled within 30 minutes of this time slot.');
  }
  return { ref: guard.ref, changed: true, count: others.length + 1, update: {
    reservations: [...others.map((entry) => ({ orderId: entry.orderId, scheduledAt: entry.time === null ? null : new Date(entry.time) })), { orderId, scheduledAt: timestamp === null ? null : new Date(timestamp) }],
    revision: guard.revision + 1,
  } };
}

function planDistributorRelease(guard, orderId) {
  if (!guard.reservations.some((entry) => entry.orderId === orderId)) throw invalid();
  const remaining = guard.reservations.filter((entry) => entry.orderId !== orderId);
  return { ref: guard.ref, changed: true, count: remaining.length, update: {
    reservations: remaining.map((entry) => ({ orderId: entry.orderId, scheduledAt: entry.time === null ? null : new Date(entry.time) })),
    revision: guard.revision + 1,
  } };
}

function stageDistributorGuard(tx, plan) {
  if (plan.changed) tx.update(plan.ref, plan.update);
}

// Every guarded writer reads the same Distributor document and compares it
// with both established assignment fields before increasing commitments.
async function readCheckedGuard(tx, db, uid) {
  const guard = await readDistributorGuard(tx, db.collection('distributorDispatchGuards').doc(uid));
  // Exact 'delivered' and missing/null statuses cannot satisfy assignment().
  // Keep all other values, including legacy case/whitespace representations,
  // so the authoritative consistency comparison remains unchanged.
  const snapshots = await Promise.all(['assignedDistributorUid', 'distributor_id'].map((field) => tx.get(db.collection('requests').where(field, '==', uid).where('status', '!=', 'delivered'))));
  const orders = new Map();
  for (const snapshot of snapshots) for (const doc of snapshot.docs || []) {
    const order = doc.data() || {};
    if (assignment(order) === uid) orders.set(doc.id, orderSchedule(order));
  }
  if (orders.size !== guard.reservations.length || guard.reservations.some((entry) => !orders.has(entry.orderId) || orders.get(entry.orderId) !== entry.time)) throw invalid();
  return guard;
}

async function planDispatchTransition(tx, db, { orderId, before, after, forceCheck = false }) {
  const oldUid = assignment(before); const newUid = assignment(after);
  const oldTime = oldUid && oldUid === newUid ? orderSchedule(before) : null; const newTime = newUid ? orderSchedule(after) : null;
  if (oldUid === newUid && (!oldUid || (oldTime === newTime && !forceCheck))) return [];
  if (newUid) {
    const snapshot = await tx.get(db.collection('users').doc(newUid));
    const profile = snapshot.data() || {}; const branchId = clean(after.currentBranchId || after.branchId);
    const status = clean(profile.distributorStatus || profile.approvalStatus || profile.status).toLowerCase();
    if (!snapshot.exists || profile.role !== 'distributor' || !branchId || clean(profile.branchId) !== branchId ||
        !['active', 'approved'].includes(status) || canonicalAccountStatus(profile) !== 'active' || profile.mustChangePassword === true || profile.accountActionHoldIntentId) {
      throw new OtpError(409, 'DISTRIBUTOR_NOT_ELIGIBLE', 'The Distributor is no longer eligible for this branch.');
    }
  }
  const guards = new Map();
  for (const uid of [...new Set([oldUid, newUid].filter(Boolean))].sort()) {
    try { guards.set(uid, await readCheckedGuard(tx, db, uid)); }
    catch (error) {
      // A reduction is safe without a usable guard: future increases remain
      // blocked until the guard is reconciled against the remaining orders.
      if (uid !== oldUid || newUid || error.reason !== 'DISPATCH_GUARD_INVALID') throw error;
      guards.set(uid, null);
    }
  }
  if (oldUid && oldUid === newUid) return [planDistributorReservation(guards.get(oldUid), { orderId, scheduledAt: newTime === null ? null : new Date(newTime), mustExist: true })];
  const plans = [];
  if (oldUid && guards.get(oldUid)) plans.push(planDistributorRelease(guards.get(oldUid), orderId));
  if (newUid) plans.push(planDistributorReservation(guards.get(newUid), { orderId, scheduledAt: newTime === null ? null : new Date(newTime), mustBeAbsent: true }));
  return plans;
}

async function planDistributorBranchChange(tx, db, uid) {
  let guard;
  try { guard = await readCheckedGuard(tx, db, uid); }
  catch (error) { if (error.reason === 'DISPATCH_GUARD_INVALID') return null; throw error; }
  if (guard.reservations.length) throw new OtpError(409, 'DISTRIBUTOR_ACTIVE_DELIVERIES', 'This Distributor has active deliveries. Reassign those deliveries before changing branches.');
  return { ref: guard.ref, changed: true, update: { revision: guard.revision + 1 } };
}

async function reserveDistributorSlot(tx, guardRef, input) {
  const plan = planDistributorReservation(await readDistributorGuard(tx, guardRef), input);
  stageDistributorGuard(tx, plan);
  return { changed: plan.changed, count: plan.count };
}

module.exports = { readDistributorGuard, planDistributorReservation, planDistributorRelease, stageDistributorGuard, reserveDistributorSlot, planDispatchTransition, planDistributorBranchChange };
