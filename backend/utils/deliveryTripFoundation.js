// Trip-aware routes are restricted to the isolated local emulator. Callers must
// authenticate first; each transaction rechecks Firestore authority.
const { FieldValue } = require('firebase-admin/firestore');
const { OtpError } = require('./otpError');
const { canonicalAccountStatus } = require('../auth/accountStatus');
const { readOrderLoadEpoch, verifiedOrderCargo } = require('./orderLoadSnapshot');
const { scheduleTimestampMillis } = require('./scheduleTimestamp');
const { readDistributorGuard } = require('./distributorCapacityGuard');
const { getAssignmentVersion } = require('./relationshipEpochs');
const { attemptIdFor } = require('../delivery/deliveryAttemptService');
const { assertLocalQaServerEnvironment } = require('../config/localQaIsolation');

const fail = (reason, message, status = 409) => { throw new OtpError(status, reason, message); };
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 128 && id.trim() === id && !id.includes('/');
const safeRevision = (value) => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER - 1;
const stamp = () => FieldValue.serverTimestamp();
const TURNAROUND_MS = 30 * 60 * 1000;
const OCCUPIED_TRIP_STATES = ['resource_reserved', 'loading_reported', 'in_transit', 'return_reported'];

// A missing interval is a draft, not a claim that a resource is available.
function tripInterval(plannedDeparture, estimatedReturn) {
  if (plannedDeparture == null && estimatedReturn == null) return null;
  const start = scheduleTimestampMillis(plannedDeparture); const end = scheduleTimestampMillis(estimatedReturn);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end || !Number.isSafeInteger(end + TURNAROUND_MS)) {
    fail('TRIP_SCHEDULE_INVALID', 'Choose a valid planned departure and later estimated return.');
  }
  return { start, end };
}

function tripIntervalsConflict(left, right) {
  if (!left || !right) fail('TRIP_SCHEDULE_UNKNOWN', 'Resolve unscheduled commitments before scheduling another trip.');
  return left.start < right.end + TURNAROUND_MS && right.start < left.end + TURNAROUND_MS;
}

// Trip-aware operations must never be enabled against a nonlocal Firestore.
function requireTripEmulator(db, auth) {
  const settings = db?._settings;
  const project = settings?.projectId;
  const localQa = project === 'demo-bluetap-local-qa';
  const forbidden = ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'EMAIL_PROVIDER', 'RESEND_API_KEY', 'VERCEL_MAIL_RELAY_URL', 'INTERNAL_MAIL_RELAY_SECRET', 'EMAIL_FROM_ADDRESS', 'DEEPFACE_API_URL', 'DEEPFACE_API_KEY', 'RENDER_EXTERNAL_HOSTNAME', 'RENDER_SERVICE_NAME', 'VERCEL_URL'];
  let qaValid = !localQa;
  if (localQa) {
    try { qaValid = assertLocalQaServerEnvironment() === true; } catch { qaValid = false; }
  }
  if (process.env.BLUETAP_TRIP_EMULATOR_MODE !== '1' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
      !['demo-bluetap', 'demo-bluetap-local-qa'].includes(project) || !qaValid ||
      (!localQa && process.env.GCLOUD_PROJECT !== 'demo-bluetap') ||
      (!localQa && (process.env.APP_ENV === 'local-qa' || process.env.LOCAL_QA_EMULATORS === '1' || process.env.EXPO_PUBLIC_APP_ENV === 'local-qa')) ||
      [process.env.GCLOUD_PROJECT, process.env.FIREBASE_PROJECT_ID, process.env.GOOGLE_CLOUD_PROJECT, process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID].some((id) => id && id !== project) ||
      process.env.NODE_ENV === 'production' || ['production', 'staging'].includes(process.env.APP_ENV) ||
      ['production', 'staging'].includes(process.env.EXPO_PUBLIC_APP_ENV) ||
      (process.env.EXPO_PUBLIC_API_BASE_URL && process.env.EXPO_PUBLIC_API_BASE_URL !== 'http://127.0.0.1:3000') ||
      forbidden.some((key) => String(process.env[key] || '').trim()) || settings?.projectId !== project ||
      settings?.servicePath !== '127.0.0.1' || settings?.port !== 8080 || settings?.ssl !== false ||
      (auth && (auth.app?.options?.projectId !== project || (auth.app?.options?.credential && auth.app.options.credential.constructor?.name !== 'ApplicationDefaultCredential')))) {
    fail('TRIP_MODE_DISABLED', 'Trip-aware operations are unavailable.');
  }
}

function classifyProduct(product = {}) {
  const load = product?.deliveryLoad;
  if (!load || load.verified !== true || !['standard_5_gallon', 'other'].includes(load.classification)) return 'unknown';
  return load.classification;
}

function summarizeOrder(orderId, order, proof, epoch) {
  const cargo = verifiedOrderCargo(orderId, order?.items, proof, epoch);
  const containers = cargo.reduce((sum, item) => sum + (item.classification === 'standard_5_gallon' ? item.quantity : 0), 0);
  if (!Number.isSafeInteger(containers)) fail('TRIP_LOAD_UNKNOWN', 'Order cargo requires review.');
  return { orderId, containers, cargo };
}

function validateTrip(trip, tripId) {
  if (!trip || trip.schemaVersion !== 1 || trip.tripId !== tripId || !validId(trip.branchId) || !validId(trip.distributorUid) ||
      !safeRevision(trip.revision) || !safeRevision(trip.manifestRevision) || !Array.isArray(trip.members) ||
      !['planning', 'approved', 'resource_reserved', 'loading_reported', 'in_transit', 'return_reported', 'closed'].includes(trip.state)) {
    fail('TRIP_INVALID', 'Trip state requires reconciliation.');
  }
  const seen = new Set(); let total = 0; let mixed = false;
  for (const member of trip.members) {
    if (!validId(member.orderId) || seen.has(member.orderId) || !Array.isArray(member.cargo) || !member.cargo.length || !Number.isSafeInteger(member.containers) || member.containers < 0) fail('TRIP_INVALID', 'Trip manifest requires reconciliation.');
    seen.add(member.orderId); let count = 0;
    for (const item of member.cargo) {
      if (!validId(item.productId) || typeof item.description !== 'string' || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || !['standard_5_gallon', 'other'].includes(item.classification)) fail('TRIP_INVALID', 'Trip manifest requires reconciliation.');
      if (item.classification === 'standard_5_gallon') count += item.quantity; else mixed = true;
    }
    if (!Number.isSafeInteger(count) || count !== member.containers) fail('TRIP_INVALID', 'Trip manifest requires reconciliation.');
    total += count;
  }
  if (!Number.isSafeInteger(total) || total > 60 || trip.standardContainers !== total || trip.hasOtherCargo !== mixed ||
      !(trip.resourceId === null || validId(trip.resourceId))) fail('TRIP_INVALID', 'Trip totals require reconciliation.');
  return trip;
}

function validateResources(data, branchId) {
  if (!data || data.schemaVersion !== 1 || data.initialized !== true || data.branchId !== branchId || !safeRevision(data.revision) || !Array.isArray(data.resources) || data.resources.length !== 2) fail('TRIP_RESOURCES_INVALID', 'Delivery resources require verification.');
  const ids = new Set(); const occupied = new Set(); const drivers = new Set();
  for (const resource of data.resources) {
    if (!validId(resource.id) || ids.has(resource.id) || resource.verified !== true || !(resource.tripId === null || validId(resource.tripId)) || !(resource.distributorUid === null || validId(resource.distributorUid)) || ((resource.tripId === null) !== (resource.distributorUid === null)) || (resource.tripId && occupied.has(resource.tripId)) || (resource.distributorUid && drivers.has(resource.distributorUid))) fail('TRIP_RESOURCES_INVALID', 'Delivery resources require verification.');
    ids.add(resource.id); if (resource.tripId) occupied.add(resource.tripId); if (resource.distributorUid) drivers.add(resource.distributorUid);
  }
  return data;
}

async function authority(tx, db, context, branchId, role, distributorUid) {
  const decoded = context?.decoded;
  if (!validId(decoded?.uid) || context?.branch?.id !== branchId) fail('TRIP_FORBIDDEN', 'Branch access is required.', 403);
  if (role === 'manager' && !(decoded.manager === true || decoded.role === 'manager')) fail('TRIP_FORBIDDEN', 'Manager access is required.', 403);
  if (role === 'distributor' && decoded.uid !== distributorUid) fail('TRIP_FORBIDDEN', 'Assigned Distributor access is required.', 403);
  const [person, branch] = await Promise.all([tx.get(db.collection('users').doc(decoded.uid)), tx.get(db.collection('branches').doc(branchId))]);
  const profile = person.data() || {};
  if (!person.exists || profile.role !== role || profile.branchId !== branchId || canonicalAccountStatus(profile) !== 'active' || profile.accountActionHoldIntentId || profile.mustChangePassword === true || !branch.exists || branch.data()?.status !== 'active' ||
      (role === 'manager' && profile.managerStatus !== 'active') || (role === 'distributor' && !['active', 'approved'].includes(String(profile.distributorStatus || profile.approvalStatus || profile.status || '').toLowerCase()))) fail('TRIP_FORBIDDEN', 'Operational access has changed.', 403);
  return decoded.uid;
}

async function readTrip(tx, db, tripId) {
  if (!validId(tripId)) fail('TRIP_INVALID', 'A valid trip is required.');
  const ref = db.collection('deliveryTrips').doc(tripId); const snap = await tx.get(ref);
  return { ref, trip: validateTrip(snap.exists ? snap.data() : null, tripId) };
}

// Plan only; callers stage the returned writes after all other transaction reads.
async function planTripSchedule(tx, db, { tripId, resourceId, plannedDeparture, estimatedReturn, manager }) {
  requireTripEmulator(db);
  if (!validId(resourceId)) fail('TRIP_RESOURCES_INVALID', 'Delivery resource requires verification.');
  const interval = tripInterval(plannedDeparture, estimatedReturn);
  if (!interval) fail('TRIP_SCHEDULE_UNKNOWN', 'A draft has no confirmed resource or schedule.');
  const { ref, trip } = await readTrip(tx, db, tripId);
  const actor = await authority(tx, db, manager, trip.branchId, 'manager');
  await recheckDistributor(tx, db, trip);
  if (!['planning', 'approved'].includes(trip.state) || trip.resourceId !== null) fail('TRIP_LOCKED', 'This trip cannot be scheduled now.');
  const resourceRef = db.collection('branchDeliveryResources').doc(trip.branchId);
  const guardRef = db.collection('distributorDispatchGuards').doc(trip.distributorUid);
  const assignmentQueries = [
    ...['assignedDistributorUid', 'distributor_id'].map((field) => db.collection('requests').where(field, '==', trip.distributorUid)),
    ...['branchId', 'currentBranchId'].flatMap((branchField) => ['assignedDistributorUid', 'distributor_id'].map((field) => db.collection('requests').where(branchField, '==', trip.branchId).where(field, '!=', null))),
  ];
  const [resourceSnap, legacyGuard, distributorTrips, branchTrips, ...assignmentSnapshots] = await Promise.all([
    tx.get(resourceRef), readDistributorGuard(tx, guardRef),
    tx.get(db.collection('deliveryTrips').where('distributorUid', '==', trip.distributorUid)),
    tx.get(db.collection('deliveryTrips').where('branchId', '==', trip.branchId)),
    ...assignmentQueries.map((query) => tx.get(query)),
  ]);
  const resources = validateResources(resourceSnap.exists ? resourceSnap.data() : null, trip.branchId);
  if (!resources.resources.some((item) => item.id === resourceId)) fail('TRIP_RESOURCES_INVALID', 'Delivery resource requires verification.');
  if (!safeRevision(resources.revision) || !safeRevision(legacyGuard.revision)) fail('TRIP_SCHEDULE_UNKNOWN', 'Scheduling state requires reconciliation.');
  const trips = new Map([...distributorTrips.docs, ...branchTrips.docs].map((doc) => [doc.id, doc.data()]));
  for (const resource of resources.resources.filter((item) => item.tripId)) {
    const occupiedTrip = trips.get(resource.tripId);
    if (!occupiedTrip || !OCCUPIED_TRIP_STATES.includes(occupiedTrip.state) || occupiedTrip.resourceId !== resource.id || occupiedTrip.distributorUid !== resource.distributorUid || occupiedTrip.branchId !== trip.branchId) fail('TRIP_RESOURCES_INVALID', 'Occupied resource state requires reconciliation.');
  }
  for (const doc of branchTrips.docs) {
    const occupiedTrip = doc.data();
    if (OCCUPIED_TRIP_STATES.includes(occupiedTrip.state) && !resources.resources.some((item) => item.id === occupiedTrip.resourceId && item.tripId === doc.id && item.distributorUid === occupiedTrip.distributorUid)) fail('TRIP_RESOURCES_INVALID', 'Occupied resource state requires reconciliation.');
  }
  const active = new Map();
  for (const snapshot of assignmentSnapshots) for (const doc of snapshot.docs) {
    const order = doc.data() || {}; const status = typeof order.status === 'string' ? order.status.trim().toLowerCase() : '';
    const canonical = order.assignedDistributorUid; const legacy = order.distributor_id;
    const uid = canonical || legacy;
    if (!uid || (canonical !== trip.distributorUid && legacy !== trip.distributorUid && (order.currentBranchId || order.branchId) !== trip.branchId)) continue;
    if ((canonical && !validId(canonical)) || (legacy && !validId(legacy)) || (canonical && legacy && canonical !== legacy)) fail('TRIP_LEGACY_UNRESOLVED', 'An assignment requires reconciliation before scheduling another trip.');
    if (status === 'delivered') continue;
    if (!['distributor_assigned', 'accepted', 'scheduled', 'out_for_delivery', 'delivery_failed'].includes(status)) fail('TRIP_LEGACY_UNRESOLVED', 'An assigned order has unknown occupancy.');
    active.set(doc.id, order);
  }
  const membership = await Promise.all([...active.keys()].map((id) => tx.get(db.collection('deliveryTripOrderReservations').doc(id))));
  const activeTripIds = new Set();
  for (const [index, id] of [...active.keys()].entries()) {
    const member = membership[index]; const data = member.data() || {}; const owner = trips.get(data.tripId);
    const order = active.get(id); const uid = order.assignedDistributorUid || order.distributor_id;
    if (!member.exists || data.orderId !== id || data.branchId !== (order.currentBranchId || order.branchId) || !owner || owner.distributorUid !== uid || !Array.isArray(owner.members) || !owner.members.some((item) => item.orderId === id)) fail('TRIP_LEGACY_UNRESOLVED', 'An existing assignment requires reconciliation before scheduling another trip.');
    activeTripIds.add(data.tripId);
  }
  for (const entry of legacyGuard.reservations) {
    const order = active.get(entry.orderId); const values = [order?.scheduledAt, order?.scheduled_at].filter((value) => value !== undefined && value !== null);
    const times = values.map(scheduleTimestampMillis);
    if (!order || (order.assignedDistributorUid || order.distributor_id) !== trip.distributorUid || times.some((value) => value === null || value !== times[0]) || (times[0] ?? null) !== entry.time) fail('TRIP_LEGACY_UNRESOLVED', 'Distributor reservations require reconciliation.');
  }
  for (const [id, other] of trips) {
    if (id === tripId) continue;
    const sameDistributor = other.distributorUid === trip.distributorUid;
    const occupied = resources.resources.find((item) => item.tripId === id);
    const sameResource = other.branchId === trip.branchId && (other.plannedResourceId === resourceId || occupied?.id === resourceId);
    const otherInterval = tripInterval(other.plannedDeparture, other.estimatedReturn);
    if (other.state === 'closed' && !otherInterval && other.confirmReturnAndUnloading?.uid) continue;
    if (other.branchId === trip.branchId && otherInterval && !validId(other.plannedResourceId)) fail('TRIP_SCHEDULE_UNKNOWN', 'An existing trip has no verified planned resource.');
    if (!sameDistributor && !sameResource && !(other.branchId === trip.branchId && activeTripIds.has(id) && !other.plannedResourceId && !occupied)) continue;
    if (!otherInterval) {
      if (other.state !== 'planning' || activeTripIds.has(id) || occupied) fail('TRIP_SCHEDULE_UNKNOWN', 'An existing commitment has no confirmed interval.');
      continue;
    }
    if (tripIntervalsConflict(interval, otherInterval)) fail('TRIP_SCHEDULE_CONFLICT', 'Another trip overlaps or lacks the thirty-minute turnaround.');
  }
  const scheduleChanged = scheduleTimestampMillis(trip.plannedDeparture) !== interval.start || scheduleTimestampMillis(trip.estimatedReturn) !== interval.end || trip.plannedResourceId !== resourceId;
  return { ref, guardRef, resourceRef, tripRevision: trip.revision, guardRevision: legacyGuard.revision, resourceRevision: resources.revision, resourceId, actor, interval, invalidateApproval: scheduleChanged && trip.state === 'approved' };
}

function stageTripSchedule(tx, plan) {
  tx.update(plan.guardRef, { revision: plan.guardRevision + 1 });
  tx.update(plan.resourceRef, { revision: plan.resourceRevision + 1 });
  tx.update(plan.ref, { plannedDeparture: new Date(plan.interval.start), estimatedReturn: new Date(plan.interval.end), plannedResourceId: plan.resourceId,
    scheduleConfirmedBy: plan.actor, scheduleConfirmedAt: stamp(), revision: plan.tripRevision + 1, updatedAt: stamp(),
    ...(plan.invalidateApproval ? { state: 'planning', managerApproval: null, mixedReview: null } : {}) });
}

async function checkTripBranchChange(tx, db, distributorUid, branchId) {
  requireTripEmulator(db);
  if (!validId(distributorUid) || (branchId !== '' && !validId(branchId))) fail('TRIP_INVALID', 'Distributor branch state requires reconciliation.');
  const [trips, resourceSnap] = await Promise.all([
    tx.get(db.collection('deliveryTrips').where('distributorUid', '==', distributorUid)),
    branchId ? tx.get(db.collection('branchDeliveryResources').doc(branchId)) : Promise.resolve(null),
  ]);
  const resources = branchId ? validateResources(resourceSnap.exists ? resourceSnap.data() : null, branchId).resources : [];
  if (trips.docs.some((doc) => doc.data()?.state !== 'closed') || resources.some((item) => item.distributorUid === distributorUid)) {
    fail('DISTRIBUTOR_ACTIVE_TRIPS', 'Finish or reconcile active trips before changing branches.');
  }
}

function validateDistributor(snapshot, branchId) {
  const profile = snapshot.data() || {};
  if (!snapshot.exists || profile.role !== 'distributor' || profile.branchId !== branchId || canonicalAccountStatus(profile) !== 'active' || profile.mustChangePassword === true || profile.accountActionHoldIntentId || !['active', 'approved'].includes(String(profile.distributorStatus || profile.approvalStatus || profile.status || '').toLowerCase())) fail('TRIP_DISTRIBUTOR_INVALID', 'Distributor is not eligible.');
}

async function recheckDistributor(tx, db, trip) {
  validateDistributor(await tx.get(db.collection('users').doc(trip.distributorUid)), trip.branchId);
}

async function readOrderManifest(tx, db, trip, orderIds) {
  const [epoch, orders, proofs] = await Promise.all([
    readOrderLoadEpoch(tx, db),
    Promise.all(orderIds.map((id) => tx.get(db.collection('requests').doc(id)))),
    Promise.all(orderIds.map((id) => tx.get(db.collection('orderLoadSnapshots').doc(id)))),
  ]);
  for (const snap of orders) {
    const data = snap.data() || {}; const assigned = data.assignedDistributorUid || data.distributor_id;
    const status = String(data.status || '').trim().toLowerCase();
    const completedMember = status === 'delivered' && ['in_transit', 'return_reported', 'closed'].includes(trip.state) && trip.members.some((member) => member.orderId === snap.id);
    if (!snap.exists || (!completedMember && !['distributor_assigned', 'accepted', 'scheduled', 'out_for_delivery', 'delivery_failed'].includes(status)) || (data.currentBranchId || data.branchId) !== trip.branchId || assigned !== trip.distributorUid || (data.assignedDistributorUid && data.distributor_id && data.assignedDistributorUid !== data.distributor_id) || !Array.isArray(data.items) || !data.items.length) fail('TRIP_ORDER_INVALID', 'Order assignment or cargo requires review.');
  }
  return orders.map((snap, index) => summarizeOrder(snap.id, snap.data(), proofs[index].exists ? proofs[index].data() : null, epoch));
}

async function createTrip(tx, db, { tripId, distributorUid, manager }) {
  const branchId = manager?.branch?.id;
  if (!validId(tripId) || !validId(distributorUid) || !validId(branchId)) fail('TRIP_INVALID', 'Trip identity is invalid.');
  const ref = db.collection('deliveryTrips').doc(tripId);
  const [snap, distributor] = await Promise.all([tx.get(ref), tx.get(db.collection('users').doc(distributorUid))]);
  const actor = await authority(tx, db, manager, branchId, 'manager');
  validateDistributor(distributor, branchId);
  if (snap.exists) fail('TRIP_EXISTS', 'Trip already exists.');
  let guard = null;
  if (process.env.BLUETAP_TRIP_EMULATOR_MODE === '1') {
    requireTripEmulator(db);
    guard = await readDistributorGuard(tx, db.collection('distributorDispatchGuards').doc(distributorUid));
    if (!safeRevision(guard.revision)) fail('TRIP_LEGACY_UNRESOLVED', 'Distributor reservations require reconciliation.');
  }
  tx.create(ref, { schemaVersion: 1, tripId, branchId, distributorUid, resourceId: null, scheduledAt: null, members: [], standardContainers: 0, hasOtherCargo: false, mixedReview: null, managerApproval: null, state: 'planning', revision: 0, manifestRevision: 0, createdBy: actor, createdAt: stamp(), updatedAt: stamp() });
  if (guard) tx.update(guard.ref, { revision: guard.revision + 1 });
}

async function allocateOrder(tx, db, { tripId, orderId, manager }) {
  if (!validId(orderId)) fail('TRIP_ORDER_INVALID', 'Order identity is invalid.');
  const { ref, trip } = await readTrip(tx, db, tripId);
  await authority(tx, db, manager, trip.branchId, 'manager');
  await recheckDistributor(tx, db, trip);
  if (!['planning', 'approved'].includes(trip.state) || trip.resourceId !== null) fail('TRIP_LOCKED', 'Trip cargo is locked.');
  if (process.env.BLUETAP_TRIP_EMULATOR_MODE === '1') {
    requireTripEmulator(db);
    const guard = await readDistributorGuard(tx, db.collection('distributorDispatchGuards').doc(trip.distributorUid));
    if (guard.reservations.some((entry) => entry.orderId === orderId || trip.members.some((member) => member.orderId === entry.orderId))) fail('TRIP_LEGACY_UNRESOLVED', 'Legacy reservations must be reconciled before trip allocation.');
  }
  const allocationRef = db.collection('deliveryTripOrderReservations').doc(orderId); const allocation = await tx.get(allocationRef);
  if (allocation.exists && allocation.data()?.tripId !== tripId) fail('TRIP_ORDER_RESERVED', 'Order is reserved by another trip.');
  const existing = trip.members.find((member) => member.orderId === orderId);
  if (!!existing !== allocation.exists || (allocation.exists && (allocation.data()?.orderId !== orderId || allocation.data()?.branchId !== trip.branchId))) fail('TRIP_INVALID', 'Order reservation requires reconciliation.');
  const ids = [...new Set([...trip.members.map((member) => member.orderId), orderId])];
  const manifests = await readOrderManifest(tx, db, trip, ids);
  const existingReservations = await Promise.all(trip.members.filter((member) => member.orderId !== orderId).map((member) => tx.get(db.collection('deliveryTripOrderReservations').doc(member.orderId))));
  for (const [index, member] of trip.members.filter((item) => item.orderId !== orderId).entries()) {
    const reservation = existingReservations[index];
    if (JSON.stringify(manifests.find((item) => item.orderId === member.orderId)) !== JSON.stringify(member) || !reservation.exists || reservation.data()?.tripId !== tripId || reservation.data()?.branchId !== trip.branchId || reservation.data()?.orderId !== member.orderId) fail('TRIP_INVALID', 'Trip cargo changed and requires reconciliation.');
  }
  const next = manifests.find((member) => member.orderId === orderId);
  if (existing && JSON.stringify(existing) === JSON.stringify(next)) return { changed: false, standardContainers: trip.standardContainers };
  const members = [...trip.members.filter((member) => member.orderId !== orderId), next];
  const total = members.reduce((sum, member) => sum + member.containers, 0);
  if (!Number.isSafeInteger(total) || total > 60) fail('TRIP_CAPACITY_EXCEEDED', 'Trip cannot exceed 60 standard containers.');
  const hasOtherCargo = members.some((member) => member.cargo.some((item) => item.classification === 'other'));
  if (!allocation.exists) tx.create(allocationRef, { tripId, orderId, branchId: trip.branchId, createdAt: stamp() });
  tx.update(ref, { members, standardContainers: total, hasOtherCargo, manifestRevision: trip.manifestRevision + 1, revision: trip.revision + 1, mixedReview: null, managerApproval: null, state: 'planning', updatedAt: stamp() });
  return { changed: true, standardContainers: total };
}

async function verifyManifest(tx, db, trip) {
  if (!trip.members.length) fail('TRIP_INVALID', 'A trip needs at least one order.');
  const [manifests, reservations] = await Promise.all([
    readOrderManifest(tx, db, trip, trip.members.map((member) => member.orderId)),
    Promise.all(trip.members.map((member) => tx.get(db.collection('deliveryTripOrderReservations').doc(member.orderId)))),
  ]);
  for (let i = 0; i < trip.members.length; i++) {
    const member = trip.members[i]; const cargo = { orderId: member.orderId, containers: member.containers, cargo: member.cargo };
    if (JSON.stringify(manifests[i]) !== JSON.stringify(cargo) || !reservations[i].exists || reservations[i].data()?.tripId !== trip.tripId || reservations[i].data()?.branchId !== trip.branchId || reservations[i].data()?.orderId !== member.orderId) fail('TRIP_INVALID', 'Trip cargo requires reconciliation.');
  }
}

// Reads the failed order's authoritative trip, cargo and physical-resource
// state. Callers decide whether to store a proposal or apply a decision.
async function readTripRescheduleSource(tx, db, { orderId, order, context, role }) {
  requireTripEmulator(db);
  const uid = order.assignedDistributorUid || order.distributor_id;
  if (String(order.status || '').trim().toLowerCase() !== 'delivery_failed' || !validId(uid) || (order.assignedDistributorUid && order.distributor_id && order.assignedDistributorUid !== order.distributor_id)) fail('ORDER_NOT_RESCHEDULABLE', 'The failed assignment requires reconciliation.');
  const reservation = await tx.get(db.collection('deliveryTripOrderReservations').doc(orderId));
  if (!reservation.exists || reservation.data()?.orderId !== orderId) fail('TRIP_INVALID', 'Trip membership requires reconciliation.');
  const { trip } = await readTrip(tx, db, reservation.data()?.tripId);
  await authority(tx, db, context, trip.branchId, role, trip.distributorUid);
  await recheckDistributor(tx, db, trip);
  if (reservation.data()?.branchId !== trip.branchId || (order.currentBranchId || order.branchId) !== trip.branchId || uid !== trip.distributorUid || !trip.members.some((member) => member.orderId === orderId)) fail('TRIP_INVALID', 'Trip membership requires reconciliation.');
  if (!['in_transit', 'return_reported', 'closed'].includes(trip.state) || !validId(trip.resourceId)) fail('TRIP_UNLOADING_REQUIRED', 'The failed trip requires reconciliation.');
  if (trip.state === 'closed') {
    // Closed manifests retain historical stops whose orders may now belong to
    // later trips. Verify this still-failed stop without rewriting history.
    const member = trip.members.find((item) => item.orderId === orderId);
    const [cargo] = await readOrderManifest(tx, db, trip, [orderId]);
    if (JSON.stringify(cargo) !== JSON.stringify({ orderId, containers: member.containers, cargo: member.cargo })) fail('TRIP_INVALID', 'Trip cargo requires reconciliation.');
  } else await verifyManifest(tx, db, trip);
  const resourceSnap = await tx.get(db.collection('branchDeliveryResources').doc(trip.branchId));
  const resources = validateResources(resourceSnap.exists ? resourceSnap.data() : null, trip.branchId);
  const occupied = resources.resources.filter((item) => item.tripId === trip.tripId);
  if (trip.state === 'closed') {
    const reportedAt = scheduleTimestampMillis(trip.reportReturnAndUnloading?.at); const confirmedAt = scheduleTimestampMillis(trip.confirmReturnAndUnloading?.at);
    if (occupied.length || trip.reportReturnAndUnloading?.uid !== trip.distributorUid || !validId(trip.confirmReturnAndUnloading?.uid) || reportedAt === null || confirmedAt === null || reportedAt > confirmedAt) fail('TRIP_RESOURCES_INVALID', 'Return and unloading require reconciliation.');
  } else if (occupied.length !== 1 || occupied[0].id !== trip.resourceId || occupied[0].distributorUid !== uid) fail('TRIP_RESOURCES_INVALID', 'Trip resource requires reconciliation.');
  const schedules = [order.scheduledAt, order.scheduled_at].filter((value) => value !== undefined && value !== null).map(scheduleTimestampMillis);
  if (!schedules.length || schedules.some((value) => value === null || value !== schedules[0])) fail('TRIP_SCHEDULE_UNKNOWN', 'The current delivery schedule requires reconciliation.');
  return { tripId: trip.tripId, tripRevision: trip.revision, manifestRevision: trip.manifestRevision, tripState: trip.state, assignmentVersion: getAssignmentVersion(order), scheduledAtMillis: schedules[0], branchId: trip.branchId, distributorUid: uid };
}

// Manager edits and branch transfers must distinguish a genuine legacy order
// from a trip member whose reservation is missing.
async function managerTripMembership(tx, db, orderId, before, manager) {
  requireTripEmulator(db);
  const reservationRef = db.collection('deliveryTripOrderReservations').doc(orderId);
  const reservation = await tx.get(reservationRef);
  if (!reservation.exists) {
    const trips = await tx.get(db.collection('deliveryTrips'));
    for (const doc of trips.docs) {
      const data = doc.data() || {}; const members = data.members;
      if (!Array.isArray(members) || members.some((member) => !validId(member?.orderId))) fail('TRIP_INVALID', 'Trip membership requires reconciliation.');
      if (members.some((member) => member.orderId === orderId)) {
        const reportedAt = scheduleTimestampMillis(data.reportReturnAndUnloading?.at); const confirmedAt = scheduleTimestampMillis(data.confirmReturnAndUnloading?.at);
        const confirmedHistory = before.tripTransferReconciled === true && data.state === 'closed' && data.reportReturnAndUnloading?.uid === data.distributorUid && validId(data.confirmReturnAndUnloading?.uid) && reportedAt !== null && confirmedAt !== null && reportedAt <= confirmedAt;
        if (!confirmedHistory) fail('TRIP_INVALID', 'Trip membership requires reconciliation.');
        validateTrip(data, doc.id);
        const resourceSnap = await tx.get(db.collection('branchDeliveryResources').doc(data.branchId));
        const resources = validateResources(resourceSnap.exists ? resourceSnap.data() : null, data.branchId);
        if (resources.resources.some((item) => item.tripId === doc.id)) fail('TRIP_RESOURCES_INVALID', 'Closed trip resource requires reconciliation.');
      }
    }
    return null;
  }
  const data = reservation.data() || {}; const { ref, trip } = await readTrip(tx, db, data.tripId);
  await authority(tx, db, manager, trip.branchId, 'manager');
  await recheckDistributor(tx, db, trip);
  if (data.orderId !== orderId || data.branchId !== trip.branchId || (before.currentBranchId || before.branchId) !== trip.branchId || (before.assignedDistributorUid || before.distributor_id) !== trip.distributorUid || !trip.members.some((member) => member.orderId === orderId)) fail('TRIP_INVALID', 'Trip membership requires reconciliation.');
  const resourceSnap = await tx.get(db.collection('branchDeliveryResources').doc(trip.branchId));
  const resources = validateResources(resourceSnap.exists ? resourceSnap.data() : null, trip.branchId);
  const occupied = resources.resources.filter((item) => item.tripId === trip.tripId);
  if (['planning', 'approved', 'closed'].includes(trip.state) ? occupied.length !== 0 || (trip.state !== 'closed' && trip.resourceId !== null) : occupied.length !== 1 || occupied[0].id !== trip.resourceId || occupied[0].distributorUid !== trip.distributorUid) fail('TRIP_RESOURCES_INVALID', 'Trip resource requires reconciliation.');
  const guard = await readDistributorGuard(tx, db.collection('distributorDispatchGuards').doc(trip.distributorUid));
  if (guard.reservations.some((entry) => trip.members.some((member) => member.orderId === entry.orderId))) fail('TRIP_LEGACY_UNRESOLVED', 'Legacy reservations require reconciliation.');
  return { reservationRef, ref, trip };
}

async function planManagerTripEdit(tx, db, { orderId, before, after, proof, manager }) {
  const membership = await managerTripMembership(tx, db, orderId, before, manager);
  if (!membership) return null;
  const { ref, trip } = membership;
  if (!['planning', 'approved'].includes(trip.state) || trip.resourceId !== null) fail('TRIP_UNLOADING_REQUIRED', 'Return and unloading must be confirmed before changing loaded cargo.');
  await verifyManifest(tx, db, trip);
  const epoch = await readOrderLoadEpoch(tx, db);
  const cargo = summarizeOrder(orderId, after, proof, epoch);
  const previous = trip.members.find((member) => member.orderId === orderId);
  if (JSON.stringify({ orderId, containers: previous.containers, cargo: previous.cargo }) === JSON.stringify(cargo)) return { changed: false };
  const members = trip.members.map((member) => member.orderId === orderId ? { ...member, containers: cargo.containers, cargo: cargo.cargo } : member);
  const total = members.reduce((sum, member) => sum + member.containers, 0);
  if (!Number.isSafeInteger(total) || total > 60) fail('TRIP_CAPACITY_EXCEEDED', 'Trip cannot exceed 60 standard containers.');
  return { changed: true, ref, update: { members, standardContainers: total, hasOtherCargo: members.some((member) => member.cargo.some((item) => item.classification === 'other')), manifestRevision: trip.manifestRevision + 1, revision: trip.revision + 1, mixedReview: null, managerApproval: null, state: 'planning', updatedAt: stamp() } };
}

async function planManagerTripTransfer(tx, db, { orderId, before, manager }) {
  const membership = await managerTripMembership(tx, db, orderId, before, manager);
  if (!membership) return null;
  if (membership.trip.state === 'closed') {
    const reportedAt = scheduleTimestampMillis(membership.trip.reportReturnAndUnloading?.at);
    const confirmedAt = scheduleTimestampMillis(membership.trip.confirmReturnAndUnloading?.at);
    if (membership.trip.reportReturnAndUnloading?.uid !== membership.trip.distributorUid || !membership.trip.confirmReturnAndUnloading?.uid || reportedAt === null || confirmedAt === null || reportedAt > confirmedAt) fail('TRIP_UNLOADING_REQUIRED', 'Manager-confirmed return and unloading are required.');
  }
  const move = await planTripMoveSource(tx, db, { orderId, targetTripId: null, before, manager });
  return { changed: true, ref: move.oldTripWrite?.ref, update: move.oldTripWrite?.update, reservationRef: move.reservationRef, removeReservation: true };
}

async function planTripOrderLifecycle(tx, db, { orderId, event, distributor }) {
  requireTripEmulator(db);
  const reservationRef = db.collection('deliveryTripOrderReservations').doc(orderId); const reservation = await tx.get(reservationRef);
  if (!reservation.exists) {
    // Membership has no independently indexed order-id field. Inspect every
    // manifest before treating an absent reservation as a legacy assignment.
    const trips = await tx.get(db.collection('deliveryTrips'));
    for (const doc of trips.docs) {
      const members = doc.data()?.members;
      if (!Array.isArray(members) || members.some((member) => !validId(member?.orderId))) fail('TRIP_INVALID', 'Trip membership requires reconciliation.');
      if (members.some((member) => member.orderId === orderId)) fail('TRIP_INVALID', 'The order has a trip but its reservation requires reconciliation.');
    }
    return null;
  }
  const data = reservation.data() || {}; const { ref, trip } = await readTrip(tx, db, data.tripId);
  await authority(tx, db, distributor, trip.branchId, 'distributor', trip.distributorUid);
  if (data.orderId !== orderId || data.branchId !== trip.branchId || !trip.members.some((member) => member.orderId === orderId)) fail('TRIP_INVALID', 'Trip membership requires reconciliation.');
  await verifyManifest(tx, db, trip);
  if (event === 'ASSIGNMENT_ACCEPTED') {
    if (!['approved', 'resource_reserved', 'loading_reported', 'in_transit'].includes(trip.state)) fail('TRIP_APPROVAL_REQUIRED', 'Manager approval of the trip is required.');
    return { changed: false };
  }
  if (event === 'ASSIGNMENT_DECLINED') {
    if (!['planning', 'approved'].includes(trip.state) || trip.resourceId !== null) fail('TRIP_UNLOADING_REQUIRED', 'Return and unloading must be confirmed before changing loaded cargo.');
    const members = trip.members.filter((member) => member.orderId !== orderId);
    return { changed: true, ref, reservationRef, update: { members, standardContainers: members.reduce((sum, member) => sum + member.containers, 0), hasOtherCargo: members.some((member) => member.cargo.some((item) => item.classification === 'other')), state: 'planning', mixedReview: null, managerApproval: null, manifestRevision: trip.manifestRevision + 1, revision: trip.revision + 1, updatedAt: stamp() }, removeReservation: true };
  }
  if (!['DELIVERY_STARTED', 'DELIVERY_FAILED', 'DELIVERY_COMPLETED'].includes(event)) fail('TRIP_MODE_INTEGRATION_INCOMPLETE', 'This delivery change is unavailable until trip coordination is complete.', 503);
  const resolvingAfterReturn = trip.state === 'return_reported' && ['DELIVERY_FAILED', 'DELIVERY_COMPLETED'].includes(event);
  if ((trip.state !== 'in_transit' && !resolvingAfterReturn) || !validId(trip.resourceId)) fail('TRIP_LOADING_CONFIRMATION_REQUIRED', 'Manager-confirmed loading is required.');
  const resourcesSnap = await tx.get(db.collection('branchDeliveryResources').doc(trip.branchId));
  const resources = validateResources(resourcesSnap.exists ? resourcesSnap.data() : null, trip.branchId);
  if (!resources.resources.some((item) => item.id === trip.resourceId && item.tripId === trip.tripId && item.distributorUid === trip.distributorUid)) fail('TRIP_RESOURCES_INVALID', 'Delivery resource requires reconciliation.');
  const stopStatus = { DELIVERY_STARTED: 'out_for_delivery', DELIVERY_FAILED: 'delivery_failed', DELIVERY_COMPLETED: 'delivered' }[event];
  return { changed: true, ref, update: { members: trip.members.map((member) => member.orderId === orderId ? { ...member, stopStatus, stopUpdatedAt: new Date() } : member), revision: trip.revision + 1, updatedAt: stamp() } };
}

function stageTripOrderLifecycle(tx, plan) {
  if (!plan?.changed) return;
  tx.update(plan.ref, plan.update);
  if (plan.removeReservation) tx.delete(plan.reservationRef);
}

async function planTripMoveSource(tx, db, { orderId, targetTripId, before, manager }) {
  requireTripEmulator(db);
  const reservationRef = db.collection('deliveryTripOrderReservations').doc(orderId); const reservation = await tx.get(reservationRef);
  if (!reservation.exists || reservation.data()?.orderId !== orderId || !validId(reservation.data()?.tripId) || reservation.data().tripId === targetTripId) fail('TRIP_LEGACY_UNRESOLVED', 'The existing assignment requires reconciliation before reassignment.');
  const { ref, trip } = await readTrip(tx, db, reservation.data().tripId);
  await authority(tx, db, manager, trip.branchId, 'manager');
  if (reservation.data()?.branchId !== trip.branchId || (before.currentBranchId || before.branchId) !== trip.branchId || (before.assignedDistributorUid || before.distributor_id) !== trip.distributorUid || !trip.members.some((member) => member.orderId === orderId)) fail('TRIP_INVALID', 'The source trip requires reconciliation.');
  const guard = await readDistributorGuard(tx, db.collection('distributorDispatchGuards').doc(trip.distributorUid));
  if (guard.reservations.some((entry) => entry.orderId === orderId)) fail('TRIP_LEGACY_UNRESOLVED', 'The legacy reservation must be reconciled first.');
  const failed = String(before.status || '').trim().toLowerCase() === 'delivery_failed';
  if (trip.state === 'closed') {
    if (!trip.confirmReturnAndUnloading?.uid) fail('TRIP_UNLOADING_REQUIRED', 'Manager-confirmed return and unloading are required.');
    const resourceSnap = await tx.get(db.collection('branchDeliveryResources').doc(trip.branchId));
    const resources = validateResources(resourceSnap.exists ? resourceSnap.data() : null, trip.branchId);
    if (resources.resources.some((item) => item.tripId === trip.tripId)) fail('TRIP_RESOURCES_INVALID', 'The source resource requires reconciliation.');
    return { reservationRef, oldTripWrite: null };
  }
  if (failed || !['planning', 'approved'].includes(trip.state) || trip.resourceId !== null) fail('TRIP_UNLOADING_REQUIRED', 'Manager-confirmed return and unloading are required.');
  await verifyManifest(tx, db, trip);
  const members = trip.members.filter((member) => member.orderId !== orderId);
  return { reservationRef, oldTripWrite: { ref, update: { members, standardContainers: members.reduce((sum, member) => sum + member.containers, 0), hasOtherCargo: members.some((member) => member.cargo.some((item) => item.classification === 'other')), state: 'planning', managerApproval: null, mixedReview: null, manifestRevision: trip.manifestRevision + 1, revision: trip.revision + 1, updatedAt: stamp() } } };
}

async function approveTrip(tx, db, { tripId, manager, mixedLoadConfirmed = false, expectedRevision = null }) {
  const { ref, trip } = await readTrip(tx, db, tripId); const actor = await authority(tx, db, manager, trip.branchId, 'manager');
  await recheckDistributor(tx, db, trip);
  const replay = trip.state === 'approved' && trip.managerApproval?.uid === actor && trip.managerApproval?.manifestRevision === trip.manifestRevision && (!trip.hasOtherCargo || (mixedLoadConfirmed === true && trip.mixedReview?.uid === actor && trip.mixedReview?.manifestRevision === trip.manifestRevision));
  if ((!replay && trip.state !== 'planning') || trip.resourceId !== null) fail('TRIP_LOCKED', 'Trip cannot be approved in its current state.');
  await verifyManifest(tx, db, trip);
  if (replay) return { changed: false };
  if (trip.hasOtherCargo && mixedLoadConfirmed !== true) fail('TRIP_MIXED_REVIEW_REQUIRED', 'Manager must confirm safe mixed loading.');
  tx.update(ref, { state: 'approved', revision: trip.revision + 1, managerApproval: { uid: actor, manifestRevision: trip.manifestRevision, ...(expectedRevision === null ? {} : { sourceRevision: expectedRevision }), at: stamp() }, mixedReview: trip.hasOtherCargo ? { uid: actor, manifestRevision: trip.manifestRevision, at: stamp() } : null, updatedAt: stamp() });
}

async function reserveResource(tx, db, { tripId, resourceId, manager }) {
  if (!validId(resourceId)) fail('TRIP_RESOURCES_INVALID', 'Delivery resource requires verification.');
  const { ref, trip } = await readTrip(tx, db, tripId); await authority(tx, db, manager, trip.branchId, 'manager');
  await recheckDistributor(tx, db, trip);
  const replay = trip.state === 'resource_reserved' && trip.resourceId === resourceId;
  if ((!replay && (trip.state !== 'approved' || trip.resourceId !== null)) || trip.managerApproval?.manifestRevision !== trip.manifestRevision || (trip.hasOtherCargo && trip.mixedReview?.manifestRevision !== trip.manifestRevision)) fail('TRIP_APPROVAL_REQUIRED', 'A current Manager approval is required.');
  const resourceRef = db.collection('branchDeliveryResources').doc(trip.branchId); const resourceSnap = await tx.get(resourceRef);
  const guard = validateResources(resourceSnap.exists ? resourceSnap.data() : null, trip.branchId);
  // Limit reverse-occupancy checks to this branch's physically active trips;
  // closed trip history must not make reservation cost grow indefinitely.
  const activeTrips = await tx.get(db.collection('deliveryTrips').where('branchId', '==', trip.branchId).where('state', 'in', OCCUPIED_TRIP_STATES));
  for (const doc of activeTrips.docs) {
    const occupiedTrip = validateTrip(doc.data(), doc.id);
    if (!guard.resources.some((item) => item.id === occupiedTrip.resourceId && item.tripId === doc.id && item.distributorUid === occupiedTrip.distributorUid)) fail('TRIP_RESOURCES_INVALID', 'Occupied resource state requires reconciliation.');
  }
  for (const resource of guard.resources.filter((item) => item.tripId)) {
    if (!activeTrips.docs.some((doc) => doc.id === resource.tripId && doc.data().resourceId === resource.id && doc.data().distributorUid === resource.distributorUid)) fail('TRIP_RESOURCES_INVALID', 'Occupied resource state requires reconciliation.');
  }
  await verifyManifest(tx, db, trip);
  const selected = guard.resources.find((item) => item.id === resourceId);
  if (replay && selected?.tripId === tripId && selected?.distributorUid === trip.distributorUid) return { changed: false };
  if (!selected || selected.tripId !== null) fail('TRIP_RESOURCE_UNAVAILABLE', 'Delivery resource is unavailable.');
  if (guard.resources.some((item) => item.tripId === tripId)) fail('TRIP_RESOURCES_INVALID', 'Delivery resource requires reconciliation.');
  if (guard.resources.some((item) => item.distributorUid === trip.distributorUid)) fail('TRIP_DISTRIBUTOR_BUSY', 'Distributor already has a reserved delivery resource.');
  tx.update(resourceRef, { resources: guard.resources.map((item) => item.id === resourceId ? { ...item, tripId, distributorUid: trip.distributorUid } : item), revision: guard.revision + 1, updatedAt: stamp() });
  tx.update(ref, { resourceId, state: 'resource_reserved', revision: trip.revision + 1, updatedAt: stamp() });
}

async function lifecycle(tx, db, { tripId, context, action }) {
  // The return report and confirmation explicitly cover both return and unloading.
  const steps = { reportLoading: ['resource_reserved', 'loading_reported', 'distributor'], confirmLoading: ['loading_reported', 'in_transit', 'manager'], reportReturnAndUnloading: ['in_transit', 'return_reported', 'distributor'], confirmReturnAndUnloading: ['return_reported', 'closed', 'manager'] };
  const step = steps[action]; if (!step) fail('TRIP_INVALID_ACTION', 'Trip action is invalid.');
  const { ref, trip } = await readTrip(tx, db, tripId); const actor = await authority(tx, db, context, trip.branchId, step[2], trip.distributorUid);
  const replay = trip.state === step[1] && trip[action]?.uid === actor;
  if ((!replay && trip.state !== step[0]) || !validId(trip.resourceId)) fail('TRIP_INVALID_ACTION', 'Trip is not ready for this action.');
  if (replay && action === 'confirmReturnAndUnloading') {
    const reportedAt = scheduleTimestampMillis(trip.reportReturnAndUnloading?.at);
    const confirmedAt = scheduleTimestampMillis(trip.confirmReturnAndUnloading?.at);
    if (trip.reportReturnAndUnloading?.uid !== trip.distributorUid || reportedAt === null || confirmedAt === null || reportedAt > confirmedAt) fail('TRIP_INVALID', 'The unloading confirmation requires reconciliation.');
    return { changed: false };
  }
  const resourceRef = db.collection('branchDeliveryResources').doc(trip.branchId); const resourceSnap = await tx.get(resourceRef);
  const guard = validateResources(resourceSnap.exists ? resourceSnap.data() : null, trip.branchId);
  if (!guard.resources.some((item) => item.id === trip.resourceId && item.tripId === tripId && item.distributorUid === trip.distributorUid)) fail('TRIP_RESOURCES_INVALID', 'Delivery resource requires reconciliation.');
  if (replay) return { changed: false };
  if (action === 'reportLoading' || action === 'confirmLoading') {
    await recheckDistributor(tx, db, trip);
    if (trip.managerApproval?.manifestRevision !== trip.manifestRevision || (trip.hasOtherCargo && trip.mixedReview?.manifestRevision !== trip.manifestRevision)) fail('TRIP_APPROVAL_REQUIRED', 'A current Manager approval is required.');
    await verifyManifest(tx, db, trip);
  }
  if (action === 'confirmReturnAndUnloading') {
    const orders = await Promise.all(trip.members.map((member) => tx.get(db.collection('requests').doc(member.orderId))));
    for (const snapshot of orders) {
      const order = snapshot.data(); const status = typeof order?.status === 'string' ? order.status.trim().toLowerCase() : '';
      if (!snapshot.exists || !['distributor_assigned', 'accepted', 'scheduled', 'delivery_failed', 'delivered'].includes(status) || (order.activeDeliveryAttemptId !== undefined && order.activeDeliveryAttemptId !== null)) fail('TRIP_ACTIVE_DELIVERY_UNRESOLVED', 'Resolve active delivery attempts before confirming unloading.');
      if (order.deliveryAttemptSeq !== undefined && (!Number.isSafeInteger(order.deliveryAttemptSeq) || order.deliveryAttemptSeq < 0)) fail('TRIP_ACTIVE_DELIVERY_UNRESOLVED', 'Delivery attempt state requires reconciliation.');
    }
    const attemptedOrders = orders.filter((snapshot) => snapshot.data().deliveryAttemptSeq > 0);
    const recentAttempts = await Promise.all(attemptedOrders.map((snapshot) => tx.get(db.collection('deliveryAttempts').doc(attemptIdFor(snapshot.id, snapshot.data().deliveryAttemptSeq)))));
    for (const [index, attempt] of recentAttempts.entries()) {
      const data = attempt.data();
      if (!attempt.exists || data.orderId !== attemptedOrders[index].id || data.attemptNumber !== attemptedOrders[index].data().deliveryAttemptSeq || !['failed', 'delivered'].includes(data.outcome)) fail('TRIP_ACTIVE_DELIVERY_UNRESOLVED', 'Delivery attempt state requires reconciliation.');
    }
    const openAttempts = await Promise.all(orders.map((snapshot) => tx.get(db.collection('deliveryAttempts').where('orderId', '==', snapshot.id).where('outcome', '==', 'in_progress').limit(1))));
    if (openAttempts.some((snapshot) => !snapshot.empty)) fail('TRIP_ACTIVE_DELIVERY_UNRESOLVED', 'Resolve active delivery attempts before confirming unloading.');
    tx.update(resourceRef, { resources: guard.resources.map((item) => item.id === trip.resourceId ? { ...item, tripId: null, distributorUid: null } : item), revision: guard.revision + 1, updatedAt: stamp() });
  }
  tx.update(ref, { state: step[1], revision: trip.revision + 1, [action]: { uid: actor, at: stamp() }, updatedAt: stamp() });
}

// Advisory only: every lifecycle mutation repeats its own transactional checks.
async function listLifecycleTrips(db, auth, context, role) {
  requireTripEmulator(db, auth);
  const branchId = context?.branch?.id; const uid = context?.decoded?.uid;
  if (!['manager', 'distributor'].includes(role) || !validId(branchId) || !validId(uid)) fail('TRIP_FORBIDDEN', 'Branch access is required.', 403);
  return db.runTransaction(async (tx) => {
    await authority(tx, db, context, branchId, role, uid);
    const query = role === 'manager' ? db.collection('deliveryTrips').where('branchId', '==', branchId) : db.collection('deliveryTrips').where('distributorUid', '==', uid);
    const snapshot = await tx.get(query);
    const relevant = snapshot.docs.filter((doc) => ['resource_reserved', 'loading_reported', 'in_transit', 'return_reported', 'closed'].includes(doc.data()?.state) && doc.data()?.branchId === branchId);
    if (!relevant.length) return [];
    const resourceSnapshot = await tx.get(db.collection('branchDeliveryResources').doc(branchId));
    const resources = validateResources(resourceSnapshot.exists ? resourceSnapshot.data() : null, branchId);
    const results = [];
    for (const doc of relevant) {
      const trip = validateTrip(doc.data(), doc.id);
      if (role === 'distributor' && trip.distributorUid !== uid) fail('TRIP_FORBIDDEN', 'Assigned Distributor access is required.', 403);
      if (!validId(trip.resourceId)) fail('TRIP_RESOURCES_INVALID', 'Delivery resource requires reconciliation.');
      const occupied = resources.resources.filter((item) => item.tripId === trip.tripId);
      if (trip.state === 'closed' ? occupied.length !== 0 : occupied.length !== 1 || occupied[0].id !== trip.resourceId || occupied[0].distributorUid !== trip.distributorUid) fail('TRIP_RESOURCES_INVALID', 'Delivery resource requires reconciliation.');
      const events = [];
      const required = trip.state === 'resource_reserved' ? [] : trip.state === 'loading_reported' ? ['reportLoading'] : trip.state === 'in_transit' ? ['reportLoading', 'confirmLoading'] : trip.state === 'return_reported' ? ['reportLoading', 'confirmLoading', 'reportReturnAndUnloading'] : ['reportLoading', 'confirmLoading', 'reportReturnAndUnloading', 'confirmReturnAndUnloading'];
      for (const name of required) {
        const event = trip[name]; const at = scheduleTimestampMillis(event?.at);
        if (!validId(event?.uid) || (name.startsWith('report') && event.uid !== trip.distributorUid) || at === null || (events.length && at < events[events.length - 1])) fail('TRIP_INVALID', 'Trip reports require reconciliation.');
        events.push(at);
      }
      if (['resource_reserved', 'loading_reported'].includes(trip.state)) {
        if (trip.managerApproval?.manifestRevision !== trip.manifestRevision || (trip.hasOtherCargo && trip.mixedReview?.manifestRevision !== trip.manifestRevision)) fail('TRIP_APPROVAL_REQUIRED', 'A current Manager approval is required.');
        await verifyManifest(tx, db, trip);
      }
      results.push({ tripId: trip.tripId, distributorUid: trip.distributorUid, state: trip.state, updatedAt: events.length ? new Date(events[events.length - 1]).toISOString() : null });
    }
    return results.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  });
}

// Capacity-only view of the existing preparation contract. It reads no order
// history: only branch trips, the resource guard and relevant manifests.
async function readTripCapacity(db, auth, manager, selectedTripId = '') {
  requireTripEmulator(db, auth);
  const branchId = manager?.branch?.id;
  if (selectedTripId && !validId(selectedTripId)) fail('TRIP_INVALID', 'Choose a valid trip.');
  return db.runTransaction(async (tx) => {
    await authority(tx, db, manager, branchId, 'manager');
    const [resourceSnap, tripSnap] = await Promise.all([
      tx.get(db.collection('branchDeliveryResources').doc(branchId)),
      tx.get(db.collection('deliveryTrips').where('branchId', '==', branchId)),
    ]);
    const resources = validateResources(resourceSnap.exists ? resourceSnap.data() : null, branchId);
    const byTrip = new Map(); const counts = new Map();
    for (const doc of tripSnap.docs) {
      const trip = validateTrip(doc.data(), doc.id); byTrip.set(doc.id, trip);
      const occupied = resources.resources.filter((item) => item.tripId === doc.id);
      if (['resource_reserved', 'loading_reported', 'in_transit', 'return_reported'].includes(trip.state)) {
        if (occupied.length !== 1 || occupied[0].id !== trip.resourceId || occupied[0].distributorUid !== trip.distributorUid) fail('TRIP_RESOURCES_INVALID', 'Occupied resource state requires reconciliation.');
      } else if (occupied.length || (trip.state !== 'closed' && trip.resourceId !== null)) fail('TRIP_RESOURCES_INVALID', 'Trip resource state requires reconciliation.');
      if (trip.state !== 'closed') {
        const count = counts.get(trip.distributorUid) || { tripCount: 0, inProgressCount: 0, soleActiveTripId: null };
        count.tripCount += 1;
        if (!['planning', 'approved'].includes(trip.state)) { count.inProgressCount += 1; count.soleActiveTripId = trip.tripId; }
        counts.set(trip.distributorUid, count);
      }
    }
    for (const resource of resources.resources.filter((item) => item.tripId)) {
      const owner = byTrip.get(resource.tripId);
      if (!owner || owner.distributorUid !== resource.distributorUid || owner.resourceId !== resource.id || !['resource_reserved', 'loading_reported', 'in_transit', 'return_reported'].includes(owner.state)) fail('TRIP_RESOURCES_INVALID', 'Occupied resource state requires reconciliation.');
    }
    const cache = new Map();
    async function capacityFor(trip) {
      if (!trip || trip.state === 'closed') return null;
      if (cache.has(trip.tripId)) return cache.get(trip.tripId);
      let verified = true;
      const interval = tripInterval(trip.plannedDeparture, trip.estimatedReturn);
      if (interval && (!validId(trip.plannedResourceId) || !resources.resources.some((item) => item.id === trip.plannedResourceId) || !validId(trip.scheduleConfirmedBy))) fail('TRIP_SCHEDULE_INVALID', 'Trip scheduling requires reconciliation.');
      if (!interval && (trip.plannedResourceId != null || trip.scheduleConfirmedBy != null)) fail('TRIP_SCHEDULE_INVALID', 'Trip scheduling requires reconciliation.');
      if (!['planning', 'approved'].includes(trip.state) && (!interval || trip.plannedResourceId !== trip.resourceId)) fail('TRIP_SCHEDULE_INVALID', 'Trip scheduling requires reconciliation.');
      const resourceStatus = !interval ? 'unscheduled' : !['planning', 'approved'].includes(trip.state) ? 'reserved' : resources.resources.find((item) => item.id === trip.plannedResourceId).tripId === null ? 'available' : 'occupied';
      const [reservations, person] = await Promise.all([tx.get(db.collection('deliveryTripOrderReservations').where('tripId', '==', trip.tripId)), tx.get(db.collection('users').doc(trip.distributorUid))]);
      let eligible = true;
      try { validateDistributor(person, branchId); }
      catch (error) { if (error.reason !== 'TRIP_DISTRIBUTOR_INVALID') throw error; eligible = false; }
      if (!person.exists || person.data()?.role !== 'distributor' || person.data()?.branchId !== branchId) verified = false;
      const members = new Set(trip.members.map((item) => item.orderId));
      if (reservations.size !== members.size || reservations.docs.some((doc) => !members.has(doc.id) || doc.data()?.orderId !== doc.id || doc.data()?.branchId !== branchId || doc.data()?.tripId !== trip.tripId)) verified = false;
      try { if (trip.members.length) await verifyManifest(tx, db, trip); }
      catch (error) { if (!['TRIP_LOAD_UNKNOWN', 'TRIP_INVALID', 'TRIP_ORDER_INVALID'].includes(error.reason)) throw error; verified = false; }
      const approvalValid = validId(trip.managerApproval?.uid) && trip.managerApproval?.manifestRevision === trip.manifestRevision;
      const reviewConfirmed = trip.state !== 'planning' && approvalValid && trip.mixedReview?.uid === trip.managerApproval.uid && trip.mixedReview?.manifestRevision === trip.manifestRevision;
      if (trip.state !== 'planning' && (!approvalValid || (trip.hasOtherCargo && !reviewConfirmed))) verified = false;
      const result = { tripId: trip.tripId, distributorUid: trip.distributorUid, state: trip.state, verified, eligible, resourceStatus,
        standardContainers: verified ? trip.standardContainers : null, hasOtherCargo: verified ? trip.hasOtherCargo : null,
        mixedReviewStatus: !verified ? 'unknown' : !trip.hasOtherCargo ? 'not_required' : reviewConfirmed ? 'confirmed' : 'required',
        plannedDeparture: scheduleTimestampMillis(trip.plannedDeparture) === null ? null : new Date(scheduleTimestampMillis(trip.plannedDeparture)).toISOString() };
      cache.set(trip.tripId, result);
      return result;
    }
    const selectedTrip = await capacityFor(byTrip.get(selectedTripId));
    const distributors = [];
    for (const [distributorUid, count] of counts) {
      const soleActiveTrip = !selectedTripId && count.tripCount === 1 && count.inProgressCount === 1 ? await capacityFor(byTrip.get(count.soleActiveTripId)) : null;
      distributors.push({ distributorUid, tripCount: count.tripCount, inProgressCount: count.inProgressCount, soleActiveTrip });
    }
    return { distributors, selectedTrip };
  });
}

// Manager-only advisory read. Mutations recheck all state in their transactions.
async function readTripPreparation(db, auth, manager) {
  requireTripEmulator(db, auth);
  const branchId = manager?.branch?.id;
  return db.runTransaction(async (tx) => {
    await authority(tx, db, manager, branchId, 'manager');
    const [resourceSnap, tripSnap, branchOrders, currentOrders, people, epoch] = await Promise.all([
      tx.get(db.collection('branchDeliveryResources').doc(branchId)),
      tx.get(db.collection('deliveryTrips').where('branchId', '==', branchId)),
      tx.get(db.collection('requests').where('branchId', '==', branchId)),
      tx.get(db.collection('requests').where('currentBranchId', '==', branchId)),
      tx.get(db.collection('users').where('branchId', '==', branchId)),
      readOrderLoadEpoch(tx, db),
    ]);
    const guard = validateResources(resourceSnap.exists ? resourceSnap.data() : null, branchId);
    const byTrip = new Map(tripSnap.docs.map((doc) => [doc.id, doc.data()]));
    for (const resource of guard.resources.filter((item) => item.tripId)) {
      const trip = byTrip.get(resource.tripId);
      if (!trip || trip.branchId !== branchId || trip.distributorUid !== resource.distributorUid || trip.resourceId !== resource.id || !['resource_reserved', 'loading_reported', 'in_transit', 'return_reported'].includes(trip.state)) fail('TRIP_RESOURCES_INVALID', 'Occupied resource state requires reconciliation.');
    }
    for (const doc of tripSnap.docs) {
      const trip = validateTrip(doc.data(), doc.id);
      const occupied = guard.resources.filter((item) => item.tripId === doc.id);
      if (['resource_reserved', 'loading_reported', 'in_transit', 'return_reported'].includes(trip.state)) {
        if (occupied.length !== 1 || occupied[0].id !== trip.resourceId || occupied[0].distributorUid !== trip.distributorUid) fail('TRIP_RESOURCES_INVALID', 'Occupied resource state requires reconciliation.');
      } else if (occupied.length || (trip.state !== 'closed' && trip.resourceId !== null)) fail('TRIP_RESOURCES_INVALID', 'Trip resource state requires reconciliation.');
    }
    const trips = [];
    for (const doc of tripSnap.docs) {
      if (!['planning', 'approved'].includes(doc.data()?.state)) continue;
      const trip = validateTrip(doc.data(), doc.id);
      if (trip.resourceId !== null || guard.resources.some((resource) => resource.tripId === doc.id)) fail('TRIP_RESOURCES_INVALID', 'Draft resource state requires reconciliation.');
      const interval = tripInterval(trip.plannedDeparture, trip.estimatedReturn);
      if (interval && (!validId(trip.plannedResourceId) || !guard.resources.some((item) => item.id === trip.plannedResourceId) || !validId(trip.scheduleConfirmedBy))) fail('TRIP_SCHEDULE_INVALID', 'Trip scheduling requires reconciliation.');
      let verified = true;
      try { if (trip.members.length) await verifyManifest(tx, db, trip); }
      catch (error) { if (!['TRIP_LOAD_UNKNOWN', 'TRIP_INVALID', 'TRIP_ORDER_INVALID'].includes(error.reason)) throw error; verified = false; }
      const members = [];
      if (verified) for (const member of trip.members) {
        const orderSnap = await tx.get(db.collection('requests').doc(member.orderId)); const order = orderSnap.data() || {};
        const values = [order.scheduledAt, order.scheduled_at].filter((value) => value !== null && value !== undefined).map(scheduleTimestampMillis);
        if (!orderSnap.exists || !values.length || values.some((value) => value === null || value !== values[0])) { verified = false; break; }
        members.push({ orderId: member.orderId, requestId: String(order.requestId || '').slice(0, 80), requesterName: String(order.requesterNameSnapshot || order.requester_name || '').slice(0, 160), scheduledAt: new Date(values[0]).toISOString(), containers: member.containers, cargo: member.cargo });
      }
      trips.push({ tripId: trip.tripId, distributorUid: trip.distributorUid, state: trip.state, revision: trip.revision, manifestRevision: trip.manifestRevision,
        plannedDeparture: interval ? new Date(interval.start).toISOString() : null, estimatedReturn: interval ? new Date(interval.end).toISOString() : null,
        plannedResourceId: interval ? trip.plannedResourceId : null, verified, standardContainers: verified ? trip.standardContainers : null,
        hasOtherCargo: verified ? trip.hasOtherCargo : null, members: verified ? members : [] });
    }
    const unique = new Map([...branchOrders.docs, ...currentOrders.docs].map((doc) => [doc.id, doc]));
    const candidates = [...unique.values()].filter((doc) => {
      const order = doc.data() || {};
      return (order.currentBranchId || order.branchId) === branchId && ['awaiting_distributor_assignment', 'accepted'].includes(String(order.status || '').trim().toLowerCase()) && !order.assignedDistributorUid && !order.distributor_id;
    });
    const orders = [];
    for (const doc of candidates) {
      const order = doc.data() || {};
      const [proof, reservation] = await Promise.all([tx.get(db.collection('orderLoadSnapshots').doc(doc.id)), tx.get(db.collection('deliveryTripOrderReservations').doc(doc.id))]);
      let cargo = null;
      try { if (!reservation.exists) cargo = summarizeOrder(doc.id, order, proof.exists ? proof.data() : null, epoch); }
      catch (error) { if (error.reason !== 'TRIP_LOAD_UNKNOWN') throw error; }
      orders.push({ orderId: doc.id, requestId: typeof order.requestId === 'string' ? order.requestId.slice(0, 80) : '', requesterName: String(order.requesterNameSnapshot || order.requester_name || '').slice(0, 160), verified: !!cargo, containers: cargo?.containers ?? null, cargo: cargo?.cargo || [] });
    }
    const eligibleDistributorUids = [];
    for (const person of people.docs) {
      if (person.data()?.role !== 'distributor') continue;
      try { validateDistributor(person, branchId); eligibleDistributorUids.push(person.id); }
      catch (error) { if (error.reason !== 'TRIP_DISTRIBUTOR_INVALID') throw error; }
    }
    return { trips, orders, eligibleDistributorUids, resources: guard.resources.map((item) => ({ id: item.id, available: item.tripId === null })) };
  });
}

module.exports = { classifyProduct, summarizeOrder, createTrip, allocateOrder, approveTrip, reserveResource, lifecycle, listLifecycleTrips, readTripPreparation, readTripCapacity, tripInterval, tripIntervalsConflict, requireTripEmulator, planTripSchedule, stageTripSchedule, planTripOrderLifecycle, stageTripOrderLifecycle, planTripMoveSource, managerTripMembership, planManagerTripEdit, planManagerTripTransfer, readTripRescheduleSource, checkTripBranchChange, validateTrip, validateResources, verifyManifest };
