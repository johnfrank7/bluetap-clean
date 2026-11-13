const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { randomUUID, createHash } = require('node:crypto');
const { requireActiveManager, requireManagerBranch } = require('../auth/authorization');
const { canonicalAccountStatus } = require('../auth/accountStatus');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { scheduleTimestampMillis } = require('../utils/scheduleTimestamp');
const { schedulingEvent } = require('../utils/schedulingEvent');
const { planDispatchTransition, stageDistributorGuard } = require('../utils/distributorCapacityGuard');
const { assignmentVersionForTransition, getAssignmentVersion } = require('../utils/relationshipEpochs');
const { reconcileOrderLifecycleInTransaction } = require('../chat/conversationLifecycleService');
const { effectiveDeliveryDays, isAllowedDeliveryDate, productLimit, productDeliveryDays, limitViolations } = require('../../services/productOrderPolicy');
const { calculateOrderTotal } = require('../../services/deliveryPricing');
const { isMaterialEdit, savedPricingSnapshot, validateLegacyEditPricing, validateSavedPromotion, pricePromotionalEdit, assertPromotionalQuote } = require('../pricing/orderEditPricing');
const { promotionCapability } = require('../pricing/promotionCapability');
const { safeProduct, refreshLoadSnapshots } = require('../admin/productManagementHandler');
const { readOrderLoadEpoch, createOrderLoadSnapshot, verifiedOrderSnapshot, verifiedOrderCargo, preserveOrderLoadSnapshots } = require('../utils/orderLoadSnapshot');
const { createTrip, allocateOrder, approveTrip, reserveResource, lifecycle: tripLifecycle, listLifecycleTrips, readTripPreparation, readTripCapacity, tripInterval, requireTripEmulator, planTripSchedule, stageTripSchedule, planTripMoveSource, managerTripMembership, planManagerTripEdit, planManagerTripTransfer, readTripRescheduleSource } = require('../utils/deliveryTripFoundation');

const AWAITING_ASSIGNMENT = 'awaiting_distributor_assignment';
const DISTRIBUTOR_ASSIGNED = 'distributor_assigned';
const TRANSFER_PENDING = 'branch_transfer_pending';
const MANAGER_OPERATIONAL_EVENTS = 'managerOperationalEvents';
const firestoreVersion = (value) => value && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds) ? `${value.seconds}:${value.nanoseconds}` : null;
const ACTIVE_ASSIGNMENT_STATUSES = new Set([DISTRIBUTOR_ASSIGNED, 'accepted', 'scheduled', 'out_for_delivery', 'delivery_failed']);
const MANAGER_VISIBLE_STATUSES = new Set([AWAITING_ASSIGNMENT, 'pending', 'manager_approval_pending', DISTRIBUTOR_ASSIGNED, 'accepted', 'scheduled', 'out_for_delivery', 'delivery_failed', TRANSFER_PENDING]);
const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const owningBranchId = (order = {}) => clean(order.currentBranchId || order.branchId, 128);
const fullName = (data = {}) => clean(data.fullName || `${data.firstName || ''} ${data.lastName || ''}`, 160);
const distributorStatus = (data = {}) => clean(data.distributorStatus || data.approvalStatus || data.status, 40).toLowerCase();
const isEligibleDistributor = (data = {}, branchId = '') => data.role === 'distributor'
  && clean(data.branchId, 128) === branchId
  && ['active', 'approved'].includes(distributorStatus(data))
  && canonicalAccountStatus(data) === 'active'
  && data.mustChangePassword !== true;
const isEligibleManager = (data = {}, branchId = '') => data.role === 'manager'
  && clean(data.branchId, 128) === branchId
  && canonicalAccountStatus(data) === 'active'
  && clean(data.managerStatus, 40).toLowerCase() === 'active'
  && data.mustChangePassword !== true;
const activeBranch = (data = {}) => data.status === 'active' && safeNumber(data.latitude) !== null && safeNumber(data.longitude) !== null;
const history = (source) => Array.isArray(source) ? source : [];
const managerEditRevision = (snapshot) => {
  if (!snapshot?.exists) return null;
  return firestoreVersion(snapshot.updateTime) || createHash('sha256').update(JSON.stringify(snapshot.data())).digest('hex');
};
const managerEditIntentHash = (items, body) => createHash('sha256').update(JSON.stringify({
  items,
  container: body.container === undefined ? null : clean(body.container, 80),
  notes: body.notes === undefined && body.specialInstructions === undefined ? null : clean(body.notes ?? body.specialInstructions, 500),
})).digest('hex');
const requireCurrentManager = (actor, branch, manager) => {
  const profile = actor.data() || {};
  if (!actor.exists || !branch.exists || branch.data()?.status !== 'active' || !isEligibleManager(profile, manager.branch.id) || profile.accountActionHoldIntentId) {
    throw new OtpError(403, 'BRANCH_ACCESS_DENIED', 'Manager access to this branch has changed.');
  }
};

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); }
}

function safeBranch(id, data = {}) {
  return {
    id,
    name: clean(data.name, 160),
    status: clean(data.status, 40).toLowerCase(),
    serviceRadiusKm: safeNumber(data.serviceRadiusKm) || 5,
    latitude: safeNumber(data.latitude),
    longitude: safeNumber(data.longitude),
  };
}

function safeDistributor(uid, data = {}) {
  const uniqueId = clean(data.publicUid || data.displayUid || data.unique_id, 80);
  return {
    uid,
    name: fullName(data),
    branchId: clean(data.branchId, 128),
    role: 'distributor',
    distributorStatus: distributorStatus(data),
    accountStatus: canonicalAccountStatus(data),
    uniqueId: uniqueId && !/^[a-zA-Z0-9]{20,}$/.test(uniqueId) ? uniqueId : '',
  };
}

function safeOrder(id, data = {}, branchNames = new Map()) {
  const branchId = owningBranchId(data);
  const pendingProposal = process.env.BLUETAP_TRIP_EMULATOR_MODE === '1' && clean(data.status, 80).toLowerCase() === 'delivery_failed' && Array.isArray(data.distributorRescheduleProposals) ? data.distributorRescheduleProposals.find((item) => item?.status === 'pending' && item.orderId === id && item.branchId === branchId && item.distributorUid === clean(data.assignedDistributorUid || data.distributor_id, 128)) : null;
  return {
    id,
    requestId: clean(data.requestId || data.request_id, 80),
    requesterName: clean(data.requesterNameSnapshot || data.requester_name, 160),
    requesterUid: clean(data.requesterUid || data.requester_id || data.userId || data.user_id, 128),
    requesterUniqueId: clean(data.requesterUniqueIdSnapshot || data.requester_unique_id || data.requesterPublicUid, 80),
    contactNumber: clean(data.contactNumberSnapshot || data.contact_number, 40),
    address: clean(data.addressSnapshot || data.address, 300),
    container: clean(data.container, 80),
    paymentMethod: clean(data.paymentMethodSnapshot || data.payment_method, 80),
    deliveryLocation: data.deliveryLocation && safeNumber(data.deliveryLocation.latitude) !== null && safeNumber(data.deliveryLocation.longitude) !== null
      ? { latitude: safeNumber(data.deliveryLocation.latitude), longitude: safeNumber(data.deliveryLocation.longitude) }
      : null,
    branchLocation: data.branchLocation && safeNumber(data.branchLocation.latitude) !== null && safeNumber(data.branchLocation.longitude) !== null
      ? { latitude: safeNumber(data.branchLocation.latitude), longitude: safeNumber(data.branchLocation.longitude) }
      : null,
    items: Array.isArray(data.items) ? data.items.map((item) => ({
      productId: clean(item.productId || item.product_id || item.id, 128),
      productNameSnapshot: clean(item.productNameSnapshot || item.product_name || item.name, 160),
      ...(item.containerTypeSnapshot || item.containerType || item.container_type ? { containerTypeSnapshot: clean(item.containerTypeSnapshot || item.containerType || item.container_type, 80) } : {}),
      quantity: Number(item.quantity) || 0,
      unitPriceAtOrder: safeNumber(item.unitPriceAtOrder ?? item.unitPrice ?? item.product_price ?? item.price) || 0,
      totalAtOrder: safeNumber(item.totalAtOrder ?? item.line_total) || 0,
      deliveryDaysSnapshot: Array.isArray(item.deliveryDaysSnapshot) ? item.deliveryDaysSnapshot : [],
      loadClassificationSnapshot: ['STANDARD_5_GALLON', 'OTHER_CARGO'].includes(item.loadClassificationSnapshot) ? item.loadClassificationSnapshot : 'UNKNOWN',
    })) : [],
    totalAtOrder: safeNumber(data.totalAtOrder ?? data.total_cost) || 0,
    subtotalAtOrder: safeNumber(data.subtotalAtOrder ?? data.subtotal) || 0,
    ...(safeNumber(data.discountAmount ?? data.discount) !== null ? { discountAmount: safeNumber(data.discountAmount ?? data.discount) } : {}),
    ...(data.discountReason ? { discountReason: clean(data.discountReason, 240) } : {}),
    ...(data.pricingSnapshot && typeof data.pricingSnapshot === 'object' ? { pricingSnapshot: data.pricingSnapshot } : {}),
    deliveryFeeAtOrder: safeNumber(data.deliveryFeeAtOrder ?? data.deliveryFee) || 0,
    expectedDeliveryDate: clean(data.expectedDeliveryDate || data.delivery_date, 80),
    scheduledAt: data.scheduledAt || data.scheduled_at || null,
    deliveredAt: data.deliveredAt || data.delivered_at || null,
    status: clean(data.status, 80).toLowerCase(),
    branchId,
    currentBranchId: branchId,
    currentBranchName: branchNames.get(branchId) || clean(data.branchNameSnapshot || data.currentBranchNameSnapshot, 160),
    initialBranchId: clean(data.initialBranchId || data.branchId, 128),
    initialBranchName: clean(data.initialBranchNameSnapshot, 160),
    distanceKmSnapshot: safeNumber(data.distanceKmSnapshot),
    serviceRadiusKmSnapshot: safeNumber(data.serviceRadiusKmSnapshot),
    outsideServiceArea: data.outsideServiceArea === true,
    effectiveDeliveryDaysSnapshot: Array.isArray(data.effectiveDeliveryDaysSnapshot) ? data.effectiveDeliveryDaysSnapshot : effectiveDeliveryDays(data.items || []),
    dispatchReadyAt: data.dispatchReadyAt || data.managerApprovedAt || data.managerAcceptedAt || data.createdAt || data.created_at || null,
    assignmentVersion: safeNumber(data.assignmentVersion) || 1,
    assignedDistributorUid: clean(data.assignedDistributorUid || data.distributor_id, 128),
    assignedDistributorName: clean(data.assignedDistributorNameSnapshot || data.distributor_name, 160),
    assignedDistributorUniqueId: clean(data.assignedDistributorUniqueIdSnapshot || data.distributorUniqueId || data.distributor_unique_id, 80),
    distributorUniqueId: clean(data.assignedDistributorUniqueIdSnapshot || data.distributorUniqueId || data.distributor_unique_id, 80),
    assignedAt: data.assignedAt || null,
    transferFromBranchId: clean(data.transferFromBranchId, 128),
    transferToBranchId: clean(data.transferToBranchId, 128),
    transferFromBranchName: branchNames.get(clean(data.transferFromBranchId, 128)) || '',
    transferToBranchName: branchNames.get(clean(data.transferToBranchId, 128)) || '',
    transferReason: clean(data.transferReason, 240),
    transferRequestedAt: data.transferRequestedAt || null,
    assignmentHistory: history(data.assignmentHistory),
    transferHistory: history(data.transferHistory),
    editHistory: history(data.editHistory),
    notes: clean(data.notes || data.specialInstructions, 500),
    specialInstructions: clean(data.notes || data.specialInstructions, 500),
    failureReason: clean(data.failureReason, 240),
    failureReasonCode: clean(data.failureReasonCode, 48),
    failureReasonLabel: clean(data.failureReasonLabel, 160),
    failureReasonNote: clean(data.failureReasonNote, 240),
    deliveryFailedAt: data.deliveryFailedAt || data.delivery_failed_at || null,
    distributorChatGraceUntil: data.distributorChatGraceUntil || null,
    rescheduledAt: data.rescheduledAt || data.rescheduled_at || null,
    rescheduledByManagerUid: clean(data.rescheduledByManagerUid, 128),
    rescheduledByRole: clean(data.rescheduledByRole, 40),
    rescheduleReason: clean(data.rescheduleReason, 240),
    reassignedAt: data.reassignedAt || null,
    reassignmentReason: clean(data.reassignmentReason, 240),
    ...(pendingProposal ? { pendingDistributorReschedule: { id: clean(pendingProposal.id, 128), scheduledAt: clean(pendingProposal.scheduledAt, 80), reason: clean(pendingProposal.reason, 240), sourceTripId: clean(pendingProposal.source?.tripId, 128), sourceTripRevision: pendingProposal.source?.tripRevision, createdAt: pendingProposal.createdAt || null } } : {}),
    createdAt: data.createdAt || data.created_at || null,
    updatedAt: data.updatedAt || data.updated_at || null,
  };
}

function mutationIdOf(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
    throw new OtpError(400, 'INVALID_MUTATION_ID', 'Use a valid dispatch mutation ID.');
  }
  return value;
}

function safeSourceDecisionEvent(id, data = {}) {
  return {
    id,
    event: clean(data.event, 80),
    orderId: clean(data.orderId, 128),
    requestId: clean(data.requestIdSnapshot, 80),
    targetBranchName: clean(data.targetBranchNameSnapshot, 160),
    decision: clean(data.decision, 32),
    declineReason: clean(data.declineReason, 240),
    decidedAt: data.decidedAt || null,
  };
}

function sourceDecisionEvent(orderId, current, decision, targetBranchId, targetBranchName, decidedAt, declineReason = '') {
  const transferRequestId = clean(current.transferRequestId, 128) || randomUUID();
  const sourceBranchId = clean(current.transferFromBranchId, 128);
  return {
    id: transferRequestId,
    transferRequestId,
    data: {
      event: decision === 'accepted' ? 'BRANCH_TRANSFER_ACCEPTED' : 'BRANCH_TRANSFER_DECLINED',
      orderId,
      requestIdSnapshot: clean(current.requestId || current.request_id, 80),
      sourceBranchId,
      targetBranchId: clean(targetBranchId, 128),
      targetBranchNameSnapshot: clean(targetBranchName, 160),
      decidedAt,
      decision,
      ...(decision === 'declined' && declineReason ? { declineReason: clean(declineReason, 240) } : {}),
      transferRequestId,
      createdAt: decidedAt,
    },
  };
}

async function getActiveBranches(db) {
  const snapshot = await db.collection('branches').get();
  return snapshot.docs.map((item) => safeBranch(item.id, item.data())).filter((branch) => activeBranch(branch));
}

async function getTargetManagers(db, auth, branchId) {
  const snapshot = await db.collection('users').where('role', '==', 'manager').get();
  const candidates = snapshot.docs.filter((item) => isEligibleManager(item.data(), branchId));
  const active = await Promise.all(candidates.map(async (item) => {
    if (typeof auth.getUser === 'function') {
      const account = await auth.getUser(item.id).catch(() => null);
      if (!account || account.disabled === true) return null;
    }
    return { uid: item.id, name: fullName(item.data()) };
  }));
  return active.filter(Boolean);
}

async function resolveEligibleDistributor(db, auth, distributorUid, branchId) {
  const uid = clean(distributorUid, 128);
  const snapshot = uid ? await db.collection('users').doc(uid).get() : null;
  if (!snapshot?.exists || !isEligibleDistributor(snapshot.data(), branchId)) {
    throw new OtpError(409, 'DISTRIBUTOR_NOT_ELIGIBLE', 'Choose an active approved Distributor assigned to your branch.');
  }
  if (typeof auth.getUser === 'function') {
    const account = await auth.getUser(uid).catch(() => null);
    if (!account || account.disabled === true) throw new OtpError(409, 'DISTRIBUTOR_NOT_ELIGIBLE', 'That Distributor account is not active.');
  }
  return { uid, data: snapshot.data() };
}

const MAX_ACTIVE_ASSIGNMENTS = 5;
const SCHEDULE_CONFLICT_WINDOW_MS = 30 * 60 * 1000;

async function checkDistributorWorkloadAndSchedule(db, distributorUid, currentOrderId, targetScheduledAt) {
  const snapshot = await db.collection('requests').where('assignedDistributorUid', '==', distributorUid).where('status', '!=', 'delivered').get();
  const activeOrders = (snapshot.docs || [])
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((order) => order.id !== currentOrderId && ACTIVE_ASSIGNMENT_STATUSES.has(clean(order.status, 80).toLowerCase()));

  if (activeOrders.length >= MAX_ACTIVE_ASSIGNMENTS) {
    throw new OtpError(
      409,
      'DISTRIBUTOR_WORKLOAD_EXCEEDED',
      `Distributor has reached the maximum active capacity of ${MAX_ACTIVE_ASSIGNMENTS} deliveries.`
    );
  }

  if (targetScheduledAt) {
    const targetTime = targetScheduledAt.getTime();
    for (const order of activeOrders) {
      const scheduledRaw = order.scheduledAt || order.scheduled_at;
      if (scheduledRaw != null && scheduledRaw !== '') {
        const existingTime = scheduleTimestampMillis(scheduledRaw);
        if (existingTime === null) {
          throw new OtpError(409, 'DISTRIBUTOR_SCHEDULE_INVALID', 'An existing delivery has an invalid schedule. Resolve it before assigning another delivery.');
        }
        if (Math.abs(existingTime - targetTime) < SCHEDULE_CONFLICT_WINDOW_MS) {
          throw new OtpError(
            409,
            'DISTRIBUTOR_SCHEDULE_CONFLICT',
            'Distributor already has an active delivery scheduled within 30 minutes of this time slot.'
          );
        }
      }
    }
  }
}

function resolutionFingerprint(action, distributorUid, scheduledAt, reason, tripId = null) {
  const fields = [action, distributorUid, scheduledAt.toISOString(), reason];
  if (tripId) fields.push(tripId);
  return JSON.stringify(fields);
}

async function requireTripReplay(tx, db, orderId, tripContext) {
  if (!tripContext) return;
  const reservation = await tx.get(db.collection('deliveryTripOrderReservations').doc(orderId));
  if (!reservation.exists || reservation.data()?.tripId !== tripContext.tripId || reservation.data()?.orderId !== orderId) throw new OtpError(409, 'TRIP_LEGACY_UNRESOLVED', 'The prior trip assignment requires reconciliation.');
}

function resolutionReplay(current, mutationId, fingerprint) {
  if (!mutationId) return false;
  const entry = history(current.assignmentHistory).find((item) => item?.clientMutationId === mutationId);
  if (!entry && current.lastManagerResolutionMutationId !== mutationId) return false;
  // Old records lack a complete canonical payload. Fail closed instead of guessing.
  if (!entry?.resolutionFingerprint || entry.resolutionFingerprint !== fingerprint || current.lastManagerResolutionMutationId !== mutationId) {
    throw new OtpError(409, 'RESOLUTION_MUTATION_CONFLICT', 'This resolution request was already used with different details or the order has changed.');
  }
  return true;
}

async function getAvailableDistributors(db, auth, branchId) {
  const snapshot = await db.collection('users').where('role', '==', 'distributor').get();
  const candidates = snapshot.docs.filter((item) => isEligibleDistributor(item.data(), branchId));
  const availability = await Promise.all(candidates.map(async (item) => {
    if (typeof auth.getUser === 'function') {
      const account = await auth.getUser(item.id).catch(() => null);
      if (!account || account.disabled === true) return null;
    }
    return safeDistributor(item.id, item.data());
  }));
  return availability.filter(Boolean).sort((left, right) => left.name.localeCompare(right.name));
}

function updateWithEvent(current, event, actorUid, branchId, now, extra = {}) {
  return {
    ...extra,
    dispatchEventHistory: [...history(current.dispatchEventHistory), { event, actorUid, branchId, createdAt: now }],
    updatedAt: now,
    updated_at: now,
  };
}

// Advisory only: the approval transaction repeats all checks before writing.
async function selectableRescheduleTrips(db, auth, manager, orderId, proposalId) {
  const orderRef = db.collection('requests').doc(orderId);
  const initial = await orderRef.get();
  if (!initial.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
  requireManagerBranch(manager, owningBranchId(initial.data() || {}));
  const uid = clean(initial.data()?.assignedDistributorUid || initial.data()?.distributor_id, 128);
  await resolveEligibleDistributor(db, auth, uid, manager.branch.id);
  const candidates = await db.collection('deliveryTrips').where('branchId', '==', manager.branch.id).get();
  const sourceKeys = ['tripId', 'tripRevision', 'manifestRevision', 'tripState', 'assignmentVersion', 'scheduledAtMillis', 'branchId', 'distributorUid'];
  const inspect = async (candidateId) => db.runTransaction(async (tx) => {
    const snapshot = await tx.get(orderRef); const current = snapshot.data() || {};
    if (!snapshot.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
    requireManagerBranch(manager, owningBranchId(current));
    const matches = history(current.distributorRescheduleProposals).filter((item) => item?.id === proposalId);
    const proposal = matches[0];
    if (matches.length !== 1 || proposal.status !== 'pending' || proposal.orderId !== orderId || proposal.branchId !== manager.branch.id || proposal.distributorUid !== uid) throw new OtpError(409, 'RESCHEDULE_PROPOSAL_STALE', 'The proposal is no longer current.');
    const requestedTime = scheduleTimestampMillis(proposal.scheduledAt);
    if (typeof proposal.scheduledAt !== 'string' || requestedTime === null || requestedTime < Date.now() - 5 * 60 * 1000) throw new OtpError(409, 'RESCHEDULE_PROPOSAL_STALE', 'The proposed delivery time is no longer current.');
    const source = await readTripRescheduleSource(tx, db, { orderId, order: current, context: manager, role: 'manager' });
    if (!proposal.source || sourceKeys.some((key) => proposal.source[key] !== source[key])) throw new OtpError(409, 'RESCHEDULE_PROPOSAL_STALE', 'The proposal is no longer current.');
    if (source.tripState !== 'closed') throw new OtpError(409, 'TRIP_UNLOADING_REQUIRED', 'Manager-confirmed return and unloading are required.');
    if (!candidateId) return null;
    const targetSnap = await tx.get(db.collection('deliveryTrips').doc(candidateId)); const trip = targetSnap.data() || {};
    if (!targetSnap.exists || trip.branchId !== manager.branch.id || trip.distributorUid !== uid || !['planning', 'approved'].includes(trip.state) || !trip.scheduleConfirmedBy || !trip.plannedResourceId) return null;
    const move = await planTripMoveSource(tx, db, { orderId, targetTripId: candidateId, before: current, manager });
    const schedule = await planTripSchedule(tx, db, { tripId: candidateId, resourceId: trip.plannedResourceId, plannedDeparture: trip.plannedDeparture, estimatedReturn: trip.estimatedReturn, manager });
    const stop = requestedTime;
    if (stop === null || stop < schedule.interval.start || stop > schedule.interval.end) return null;
    const staged = new Proxy(tx, { get(target, key) {
      if (key === 'get') return async (ref) => { const snap = await target.get(ref); return ref.path === move.reservationRef.path ? { id: snap.id, exists: false, data: () => undefined } : snap; };
      if (['create', 'set', 'update', 'delete'].includes(key)) return () => {};
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const allocation = await allocateOrder(staged, db, { tripId: candidateId, orderId, manager });
    const [epoch, proof] = await Promise.all([readOrderLoadEpoch(tx, db), tx.get(db.collection('orderLoadSnapshots').doc(orderId))]);
    const cargo = verifiedOrderCargo(orderId, current.items, proof.exists ? proof.data() : null, epoch);
    return { tripId: candidateId, distributorUid: uid, status: trip.state, plannedDeparture: new Date(schedule.interval.start).toISOString(), estimatedReturn: new Date(schedule.interval.end).toISOString(), standardContainers: trip.standardContainers, projectedStandardContainers: allocation.standardContainers, hasOtherCargo: trip.hasOtherCargo || cargo.some((item) => item.classification === 'other') };
  });
  await inspect(null);
  const trips = [];
  for (const candidate of candidates.docs) {
    try { const trip = await inspect(candidate.id); if (trip) trips.push(trip); }
    catch (error) { if (!['TRIP_SCHEDULE_CONFLICT', 'TRIP_CAPACITY_EXCEEDED'].includes(error.reason)) throw error; }
  }
  return trips;
}

async function validateAdminTripOverride(tx, db, { orderId, current, orderSnapshot, manager, tripContext, targetUid, scheduledAt, reason }) {
  const context = tripContext.adminOverride;
  const [proposalSnap, targetSnap, reservation] = await Promise.all([tx.get(context.proposalRef), tx.get(db.collection('deliveryTrips').doc(tripContext.tripId)), tx.get(db.collection('deliveryTripOrderReservations').doc(orderId))]);
  const proposal = proposalSnap.data() || {}; const target = targetSnap.data() || {};
  const fingerprint = JSON.stringify([orderId, targetUid, tripContext.tripId, scheduledAt.toISOString(), reason]);
  if (!proposalSnap.exists || proposal.schemaVersion !== 1 || proposal.status !== 'pending' || proposal.id !== context.proposalId || proposal.orderId !== orderId || proposal.branchId !== manager.branch.id || proposal.fingerprint !== fingerprint || proposal.fingerprint !== context.fingerprint || proposal.distributorUid !== targetUid || proposal.tripId !== tripContext.tripId || proposal.scheduledAt !== scheduledAt.toISOString() || proposal.reason !== reason || !proposal.adminUid || proposal.orderVersion !== firestoreVersion(orderSnapshot.updateTime) || proposal.assignmentVersion !== getAssignmentVersion(current) || proposal.orderStatus !== clean(current.status, 80).toLowerCase()) throw new OtpError(409, 'ADMIN_OVERRIDE_PROPOSAL_STALE', 'The proposal or order changed. Request a new proposal.');
  if (!targetSnap.exists || target.branchId !== manager.branch.id || target.distributorUid !== targetUid || target.revision !== proposal.target?.tripRevision || target.manifestRevision !== proposal.target?.manifestRevision || (target.plannedResourceId || null) !== proposal.target?.plannedResourceId || scheduleTimestampMillis(target.plannedDeparture) !== proposal.target?.plannedDeparture || scheduleTimestampMillis(target.estimatedReturn) !== proposal.target?.estimatedReturn) throw new OtpError(409, 'ADMIN_OVERRIDE_PROPOSAL_STALE', 'The target trip changed. Request a new proposal.');
  const sourceUid = clean(current.assignedDistributorUid || current.distributor_id, 128);
  if (current.assignedDistributorUid && current.distributor_id && current.assignedDistributorUid !== current.distributor_id) throw new OtpError(409, 'TRIP_INVALID', 'The assignment requires reconciliation.');
  if (sourceUid) {
    if (proposal.action !== 'reassign' || !proposal.source || proposal.source.distributorUid !== sourceUid || !reservation.exists || reservation.data()?.orderId !== orderId || reservation.data()?.branchId !== manager.branch.id || reservation.data()?.tripId !== proposal.source.tripId) throw new OtpError(409, 'ADMIN_OVERRIDE_PROPOSAL_STALE', 'The source assignment changed.');
    const sourceSnap = await tx.get(db.collection('deliveryTrips').doc(proposal.source.tripId)); const source = sourceSnap.data() || {};
    const stepsToClosed = { resource_reserved: 4, loading_reported: 3, in_transit: 2, return_reported: 1, closed: 0 };
    const unchanged = source.state === proposal.source.state && source.revision === proposal.source.tripRevision;
    const expectedUnloading = source.state === 'closed' && Object.prototype.hasOwnProperty.call(stepsToClosed, proposal.source.state) && source.revision === proposal.source.tripRevision + stepsToClosed[proposal.source.state];
    if (!sourceSnap.exists || source.branchId !== manager.branch.id || source.distributorUid !== sourceUid || source.tripId !== proposal.source.tripId || source.manifestRevision !== proposal.source.manifestRevision || (!unchanged && !expectedUnloading) || !Array.isArray(source.members) || !source.members.some((item) => item?.orderId === orderId)) throw new OtpError(409, 'ADMIN_OVERRIDE_PROPOSAL_STALE', 'The source trip changed. Request a new proposal.');
    if (source.state === 'closed') {
      const reported = scheduleTimestampMillis(source.reportReturnAndUnloading?.at); const confirmed = scheduleTimestampMillis(source.confirmReturnAndUnloading?.at);
      if (source.reportReturnAndUnloading?.uid !== sourceUid || !source.confirmReturnAndUnloading?.uid || reported === null || confirmed === null || reported > confirmed) throw new OtpError(409, 'TRIP_UNLOADING_REQUIRED', 'Manager-confirmed return and unloading are required.');
      const [epoch, proof] = await Promise.all([readOrderLoadEpoch(tx, db), tx.get(db.collection('orderLoadSnapshots').doc(orderId))]);
      const cargo = verifiedOrderCargo(orderId, current.items, proof.exists ? proof.data() : null, epoch);
      const member = source.members.find((item) => item.orderId === orderId);
      const containers = cargo.filter((item) => item.classification === 'standard_5_gallon').reduce((sum, item) => sum + item.quantity, 0);
      if (JSON.stringify({ orderId, containers, cargo }) !== JSON.stringify({ orderId: member.orderId, containers: member.containers, cargo: member.cargo })) throw new OtpError(409, 'TRIP_INVALID', 'Trip cargo requires reconciliation.');
    }
    context.sameTrip = proposal.source.tripId === tripContext.tripId;
  } else {
    if (proposal.action !== 'assign' || proposal.source !== null || reservation.exists) throw new OtpError(409, 'ADMIN_OVERRIDE_PROPOSAL_STALE', 'The assignment changed.');
    await managerTripMembership(tx, db, orderId, current, manager);
  }
  return proposal;
}

async function updateOrder(db, orderId, prepare, manager, tripContext = null, tripMutation = null) {
  const ref = db.collection('requests').doc(orderId);
  if (typeof db.runTransaction === 'function') {
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
      const current = snapshot.data() || {};
      if (tripMutation) {
        const [actor, branch] = await Promise.all([tx.get(db.collection('users').doc(manager.decoded.uid)), tx.get(db.collection('branches').doc(manager.branch.id))]);
        const profile = actor.data() || {};
        if (!actor.exists || profile.role !== 'manager' || profile.managerStatus !== 'active' || canonicalAccountStatus(profile) !== 'active' || profile.mustChangePassword === true || profile.accountActionHoldIntentId || clean(profile.branchId, 128) !== manager.branch.id || !branch.exists || branch.data()?.status !== 'active') throw new OtpError(403, 'BRANCH_ACCESS_DENIED', 'Manager access to this branch has changed.');
        const previous = history(current.tripWriterMutations).find((item) => item?.id === tripMutation.id);
        if (previous) {
          if (previous.fingerprint !== tripMutation.fingerprint || previous.managerUid !== manager.decoded.uid || previous.branchId !== manager.branch.id) throw new OtpError(409, 'TRIP_MUTATION_CONFLICT', 'This request ID was already used for different details.');
          requireManagerBranch(manager, ['accept-transfer', 'decline-transfer'].includes(tripMutation.action) ? clean(current.transferToBranchId, 128) : owningBranchId(current));
          if (tripMutation.action === 'approve-distributor-reschedule') {
            const proposal = Array.isArray(current.distributorRescheduleProposals) ? current.distributorRescheduleProposals.find((item) => item?.id === tripMutation.proposalId) : null;
            const reservation = await tx.get(db.collection('deliveryTripOrderReservations').doc(orderId));
            if (!proposal || proposal.status !== 'approved' || proposal.decidedBy !== manager.decoded.uid || proposal.targetTripId !== tripContext?.tripId || clean(current.status, 80).toLowerCase() !== 'scheduled' || clean(current.assignedDistributorUid || current.distributor_id, 128) !== proposal.distributorUid || getAssignmentVersion(current) !== proposal.source?.assignmentVersion || scheduleTimestampMillis(current.scheduledAt || current.scheduled_at) !== scheduleTimestampMillis(proposal.scheduledAt) || !reservation.exists || reservation.data()?.orderId !== orderId || reservation.data()?.tripId !== tripContext?.tripId || reservation.data()?.branchId !== manager.branch.id) throw new OtpError(409, 'RESCHEDULE_PROPOSAL_STALE', 'The approved reschedule is no longer the current assignment.');
          }
          if (tripMutation.action === 'approve-admin-trip-override') {
            const [proposalSnap, reservation] = await Promise.all([tx.get(tripContext.adminOverride.proposalRef), tx.get(db.collection('deliveryTripOrderReservations').doc(orderId))]);
            const proposal = proposalSnap.data() || {};
            if (!proposalSnap.exists || proposal.status !== 'approved' || proposal.decidedBy !== manager.decoded.uid || proposal.fingerprint !== tripContext.adminOverride.fingerprint || clean(current.status, 80).toLowerCase() !== DISTRIBUTOR_ASSIGNED || clean(current.assignedDistributorUid || current.distributor_id, 128) !== proposal.distributorUid || getAssignmentVersion(current) !== proposal.approvedAssignmentVersion || scheduleTimestampMillis(current.scheduledAt || current.scheduled_at) !== scheduleTimestampMillis(proposal.scheduledAt) || !reservation.exists || reservation.data()?.orderId !== orderId || reservation.data()?.tripId !== proposal.tripId || reservation.data()?.branchId !== manager.branch.id) throw new OtpError(409, 'ADMIN_OVERRIDE_PROPOSAL_STALE', 'The approved override is no longer the current assignment.');
          }
          return current;
        }
      }
      const prepared = await prepare(current, tx, snapshot);
      if (prepared?.replay) {
        return prepared.replay;
      }
      const update = prepared?.orderUpdate || prepared;
      if (tripMutation) update.tripWriterMutations = [...history(current.tripWriterMutations), { ...tripMutation, managerUid: manager.decoded.uid, branchId: manager.branch.id }];
      const dispatchEvent = update.dispatchEventHistory?.[update.dispatchEventHistory.length - 1]?.event;
      const tripMode = process.env.BLUETAP_TRIP_EMULATOR_MODE === '1';
      const guarded = ['DISTRIBUTOR_ASSIGNED', 'DISTRIBUTOR_REASSIGNED', 'DELIVERY_RESCHEDULED_BY_MANAGER', 'BRANCH_TRANSFER_REQUESTED'].includes(dispatchEvent) || (tripMode && ['ORDER_EDITED', 'BRANCH_TRANSFER_ACCEPTED', 'BRANCH_TRANSFER_DECLINED', 'ADMIN_DISPATCH_OVERRIDE'].includes(dispatchEvent));
      let guardPlans = [];
      let tripPlan = null;
      let tripWrites = [];
      let managerTripPlan = null;
      if (guarded) {
        const [actor, branch] = await Promise.all([tx.get(db.collection('users').doc(manager.decoded.uid)), tx.get(db.collection('branches').doc(manager.branch.id))]);
        const profile = actor.data() || {};
        if (!actor.exists || profile.role !== 'manager' || profile.managerStatus !== 'active' || canonicalAccountStatus(profile) !== 'active' || profile.mustChangePassword === true || profile.accountActionHoldIntentId || clean(profile.branchId, 128) !== manager.branch.id || !branch.exists || branch.data()?.status !== 'active') throw new OtpError(403, 'BRANCH_ACCESS_DENIED', 'Manager access to this branch has changed.');
        if (tripContext && ['DISTRIBUTOR_ASSIGNED', 'DISTRIBUTOR_REASSIGNED', 'DELIVERY_RESCHEDULED_BY_MANAGER', 'ADMIN_DISPATCH_OVERRIDE'].includes(dispatchEvent)) {
          const needsMove = dispatchEvent === 'ADMIN_DISPATCH_OVERRIDE' ? Boolean(current.assignedDistributorUid || current.distributor_id) && !tripContext.adminOverride?.sameTrip : dispatchEvent !== 'DISTRIBUTOR_ASSIGNED';
          const move = needsMove ? await planTripMoveSource(tx, db, { orderId, targetTripId: tripContext.tripId, before: current, manager }) : null;
          const tripSnapshot = await tx.get(db.collection('deliveryTrips').doc(tripContext.tripId)); const trip = tripSnapshot.data() || {};
          if (!tripSnapshot.exists || !trip.plannedResourceId) throw new OtpError(409, 'TRIP_SCHEDULE_UNKNOWN', 'A Manager-confirmed trip schedule is required.');
          tripPlan = await planTripSchedule(tx, db, { tripId: tripContext.tripId, resourceId: trip.plannedResourceId, plannedDeparture: trip.plannedDeparture, estimatedReturn: trip.estimatedReturn, manager });
          if (tripContext.proposalApproval) {
            const stop = scheduleTimestampMillis(update.scheduledAt);
            if (stop === null || stop < tripPlan.interval.start || stop > tripPlan.interval.end) throw new OtpError(409, 'TRIP_STOP_OUTSIDE_INTERVAL', 'Choose a trip whose planned interval contains the proposed delivery time.');
          }
          const proposed = { ...current, ...update };
          const staged = new Proxy(tx, { get(target, key) {
            if (key === 'get') return async (targetRef) => {
              const snap = await target.get(targetRef);
              if (targetRef.path === ref.path) return { id: snap.id, exists: snap.exists, data: () => proposed };
              if (move && targetRef.path === move.reservationRef.path) return { id: snap.id, exists: false, data: () => undefined };
              return snap;
            };
            if (['create', 'set', 'update', 'delete'].includes(key)) return (...args) => { tripWrites.push([key === 'create' && move && args[0].path === move.reservationRef.path ? 'set' : key, args]); };
            const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
          } });
          await allocateOrder(staged, db, { tripId: tripContext.tripId, orderId, manager });
          if (move?.oldTripWrite) tripWrites.push(['update', [move.oldTripWrite.ref, move.oldTripWrite.update]]);
        } else if (tripMode && dispatchEvent === 'ORDER_EDITED') {
          managerTripPlan = await planManagerTripEdit(tx, db, { orderId, before: current, after: { ...current, ...update }, proof: prepared?.loadProof, manager });
          if (!managerTripPlan && (current.assignedDistributorUid || current.distributor_id)) guardPlans = await planDispatchTransition(tx, db, { orderId, before: current, after: { ...current, ...update }, forceCheck: true });
        } else if (tripMode && ['BRANCH_TRANSFER_REQUESTED', 'BRANCH_TRANSFER_ACCEPTED', 'BRANCH_TRANSFER_DECLINED'].includes(dispatchEvent)) {
          if (dispatchEvent === 'BRANCH_TRANSFER_REQUESTED') {
            const targetBranchId = clean(update.transferToBranchId, 128);
            const [targetBranch, ...targetManagers] = await Promise.all([tx.get(db.collection('branches').doc(targetBranchId)), ...(update.targetManagerUids || []).map((uid) => tx.get(db.collection('users').doc(uid)))]);
            if (!targetBranch.exists || targetBranch.data()?.status !== 'active' || !targetManagers.some((snapshot) => { const profile = snapshot.data() || {}; return snapshot.exists && profile.role === 'manager' && profile.managerStatus === 'active' && clean(profile.branchId, 128) === targetBranchId && canonicalAccountStatus(profile) === 'active' && profile.mustChangePassword !== true && !profile.accountActionHoldIntentId; })) throw new OtpError(409, 'TARGET_MANAGER_UNAVAILABLE', 'The target branch or its Manager is no longer available.');
          }
          managerTripPlan = await planManagerTripTransfer(tx, db, { orderId, before: current, manager });
          if (managerTripPlan && dispatchEvent === 'BRANCH_TRANSFER_REQUESTED') update.tripTransferReconciled = true;
          if (!managerTripPlan && dispatchEvent === 'BRANCH_TRANSFER_REQUESTED') guardPlans = await planDispatchTransition(tx, db, { orderId, before: current, after: { ...current, ...update } });
        } else {
          guardPlans = await planDispatchTransition(tx, db, { orderId, before: current, after: { ...current, ...update }, forceCheck: dispatchEvent !== 'BRANCH_TRANSFER_REQUESTED' });
        }
      }
      const sideEffects = prepared?.sideEffects || [];
      const deleteIfOrderMatches = prepared?.deleteIfOrderMatches || [];
      const newSideEffects = [];
      for (const sideEffect of sideEffects) {
        const existing = await tx.get(sideEffect.ref);
        if (existing.exists && sideEffect.requireAbsent) throw new OtpError(409, 'ADMIN_OVERRIDE_PROPOSAL_STALE', 'The override audit requires reconciliation.');
        if (!existing.exists) newSideEffects.push(sideEffect);
      }
      const guardsToDelete = [];
      for (const guardRef of deleteIfOrderMatches) {
        const guard = await tx.get(guardRef);
        if (guard.exists && guard.data()?.orderId === orderId) guardsToDelete.push(guardRef);
      }
      const lifecycleEvent = prepared?.lifecycleEvent
        || update.dispatchEventHistory?.[update.dispatchEventHistory.length - 1]?.event
        || 'ORDER_UPDATED';
      await reconcileOrderLifecycleInTransaction({
        tx,
        db,
        before: { id: orderId, ...current },
        after: { id: orderId, ...current, ...update },
        event: lifecycleEvent,
        now: update.updatedAt || new Date(),
      });
      guardPlans.forEach((plan) => stageDistributorGuard(tx, plan));
      if (managerTripPlan?.ref && managerTripPlan.update) tx.update(managerTripPlan.ref, managerTripPlan.update);
      if (managerTripPlan?.removeReservation) tx.delete(managerTripPlan.reservationRef);
      if (tripPlan) stageTripSchedule(tx, tripPlan);
      tripWrites.forEach(([method, args]) => tx[method](...args));
      tx.update(ref, update);
      if (prepared?.proposalUpdate) tx.update(prepared.proposalUpdate.ref, prepared.proposalUpdate.data);
      if (prepared && Object.prototype.hasOwnProperty.call(prepared, 'loadProof')) {
        const proofRef = db.collection('orderLoadSnapshots').doc(orderId);
        if (prepared.loadProof) tx.set(proofRef, prepared.loadProof);
        else tx.delete(proofRef);
      }
      for (const sideEffect of newSideEffects) tx.set(sideEffect.ref, sideEffect.data);
      for (const guardRef of guardsToDelete) tx.delete(guardRef);
      return { ...current, ...update };
    });
  }
  throw new OtpError(500, 'CHAT_RECONCILIATION_REQUIRED', 'Order lifecycle updates require transactional chat reconciliation.');
}

function requireOwningManager(manager, order) {
  return requireManagerBranch(manager, owningBranchId(order));
}

function responseError(res, error) {
  const known = error instanceof OtpError;
  return res.status(known ? error.status : 500).json({ error: {
    reason: known ? error.reason : 'service-unavailable',
    message: known ? error.message : 'Order dispatch is temporarily unavailable.',
  } });
}

function createManagerDispatchHandler(getAdmin = getFirebaseAdmin, options = {}) {
  const promotionPricing = promotionCapability(getAdmin, options).enabled;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'PATCH'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or PATCH.' } });
    try {
      const { auth, db } = getAdmin();
      const manager = await requireActiveManager(req, auth, db);
      let tripContext = null;
      let tripMutation = null;
      const updateManagedOrder = (id, prepare) => updateOrder(db, id, prepare, manager, tripContext, tripMutation);
      const managerBranchId = manager.branch.id;
      const branches = await getActiveBranches(db);
      const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
      if (req.method === 'GET') {
        const query = req.query || Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);
        if (query.tripLifecycle === '1') return res.status(200).json({ trips: await listLifecycleTrips(db, auth, manager, 'manager') });
        if (query.tripPreparation === '1' && query.capacityOnly === '1') return res.status(200).json(await readTripCapacity(db, auth, manager, query.tripId || ''));
        if (query.tripPreparation === '1') return res.status(200).json(await readTripPreparation(db, auth, manager));
        if (process.env.BLUETAP_TRIP_EMULATOR_MODE === '1') requireTripEmulator(db);
        if (query.tripApprovalOrderId || query.tripApprovalProposalId) {
          requireTripEmulator(db);
          const id = query.tripApprovalOrderId; const proposalId = query.tripApprovalProposalId;
          if (typeof id !== 'string' || !id || id.length > 128 || id.trim() !== id || id.includes('/') || typeof proposalId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(proposalId)) throw new OtpError(400, 'INVALID_INPUT', 'Choose a valid order and proposal.');
          const trips = await selectableRescheduleTrips(db, auth, manager, id, proposalId);
          return res.status(200).json({ trips });
        }
        if (process.env.BLUETAP_TRIP_EMULATOR_MODE === '1' && query.adminOverrideOrderId) {
          const id = clean(query.adminOverrideOrderId, 128);
          if (!id || id.includes('/')) throw new OtpError(400, 'INVALID_INPUT', 'Choose a valid order.');
          const orderRef = db.collection('requests').doc(id); const snapshot = await orderRef.get();
          if (!snapshot.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
          requireOwningManager(manager, snapshot.data() || {});
          const proposals = await orderRef.collection('adminTripOverrideProposals').get();
          return res.status(200).json({ proposals: proposals.docs.map((item) => item.data()).filter((item) => item?.orderId === id && item.branchId === managerBranchId) });
        }
        const [ownedSnapshot, incomingSnapshot, distributors, sourceDecisionSnapshot] = await Promise.all([
          db.collection('requests').where('branchId', '==', managerBranchId).get(),
          db.collection('requests').where('transferToBranchId', '==', managerBranchId).get(),
          getAvailableDistributors(db, auth, managerBranchId),
          db.collection(MANAGER_OPERATIONAL_EVENTS).where('sourceBranchId', '==', managerBranchId).get(),
        ]);
        const orders = ownedSnapshot.docs
          .map((item) => safeOrder(item.id, item.data(), branchNames))
          .filter((order) => order.currentBranchId === managerBranchId && MANAGER_VISIBLE_STATUSES.has(order.status));
        const incomingTransfers = incomingSnapshot.docs
          .map((item) => safeOrder(item.id, item.data(), branchNames))
          .filter((order) => order.status === TRANSFER_PENDING && order.transferToBranchId === managerBranchId);
        const sourceDecisionEvents = sourceDecisionSnapshot.docs
          .map((item) => safeSourceDecisionEvent(item.id, item.data()))
          .sort((left, right) => String(right.decidedAt || '').localeCompare(String(left.decidedAt || '')));
        return res.status(200).json({ orders, incomingTransfers, sourceDecisionEvents, distributors, branches: branches.filter((branch) => branch.id !== managerBranchId) });
      }

      const body = bodyOf(req);
      const orderId = clean(body.orderId, 128);
      let action = clean(body.action, 48).toLowerCase();
      if (process.env.BLUETAP_TRIP_EMULATOR_MODE === '1' && action === 'quote-edit') requireTripEmulator(db);
      let proposalDecision = null;
      let adminOverrideDecision = null;
      if (process.env.BLUETAP_TRIP_EMULATOR_MODE === '1' && ['approve-admin-trip-override', 'reject-admin-trip-override'].includes(action)) {
        requireTripEmulator(db);
        const proposalId = body.proposalId;
        if (typeof proposalId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(proposalId)) throw new OtpError(400, 'INVALID_MUTATION_ID', 'Choose a valid proposal.');
        adminOverrideDecision = { action, proposalId };
      }
      if (process.env.BLUETAP_TRIP_EMULATOR_MODE === '1' && ['approve-distributor-reschedule', 'reject-distributor-reschedule'].includes(action)) {
        requireTripEmulator(db);
        const proposalId = body.proposalId;
        if (typeof proposalId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(proposalId)) throw new OtpError(400, 'INVALID_MUTATION_ID', 'Choose a valid proposal.');
        proposalDecision = { action, proposalId };
      }
      if (process.env.BLUETAP_TRIP_EMULATOR_MODE === '1' && ['edit-order', 'request-transfer', 'accept-transfer', 'decline-transfer'].includes(action)) {
        requireTripEmulator(db);
        const id = mutationIdOf(body.clientMutationId);
        if (id) tripMutation = { id, action, fingerprint: JSON.stringify([action, orderId, Array.isArray(body.items) ? body.items.map((item) => [clean(item?.productId || item?.product_id, 128), Number(item?.quantity)]) : null, body.notes === undefined && body.specialInstructions === undefined ? null : clean(body.notes ?? body.specialInstructions, 500), body.container === undefined ? null : clean(body.container, 80), clean(body.targetBranchId, 128), clean(body.transferReason, 240), clean(body.transferDeclineReason, 240)]) };
      }
      if (['create-trip', 'allocate-trip-order', 'approve-trip', 'reserve-trip-resource', 'confirm-trip-loading', 'confirm-trip-unloading'].includes(action) && process.env.BLUETAP_TRIP_EMULATOR_MODE === '1') {
        requireTripEmulator(db);
        const tripId = clean(body.tripId, 128); const resourceId = clean(body.resourceId, 128);
        if (!tripId || tripId.includes('/')) throw new OtpError(400, 'TRIP_INVALID', 'Choose a valid trip.');
        await db.runTransaction(async (tx) => {
          if (action === 'create-trip') return createTrip(tx, db, { tripId, distributorUid: clean(body.distributorUid, 128), manager });
          if (action === 'allocate-trip-order') {
            const reservation = await tx.get(db.collection('deliveryTripOrderReservations').doc(orderId));
            if (!reservation.exists || reservation.data()?.tripId !== tripId) throw new OtpError(409, 'TRIP_LEGACY_UNRESOLVED', 'New allocations must be made with the assignment transaction.');
            return allocateOrder(tx, db, { tripId, orderId, manager });
          }
          if (action === 'approve-trip') {
            if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw new OtpError(400, 'TRIP_REVIEW_REQUIRED', 'Refresh and review the trip before approval.');
            const snapshot = await tx.get(db.collection('deliveryTrips').doc(tripId)); const trip = snapshot.data() || {};
            if (!snapshot.exists || trip.branchId !== managerBranchId) throw new OtpError(404, 'TRIP_NOT_FOUND', 'The trip was not found.');
            const replay = trip.state === 'approved' && trip.managerApproval?.uid === manager.decoded.uid && trip.managerApproval?.sourceRevision === body.expectedRevision;
            if (!replay && trip.revision !== body.expectedRevision) throw new OtpError(409, 'TRIP_REVIEW_STALE', 'The trip changed. Refresh and review it before approval.');
            if (!tripInterval(trip.plannedDeparture, trip.estimatedReturn) || !trip.plannedResourceId || !trip.scheduleConfirmedBy) throw new OtpError(409, 'TRIP_SCHEDULE_UNKNOWN', 'A Manager-confirmed schedule and resource are required.');
            return approveTrip(tx, db, { tripId, manager, mixedLoadConfirmed: body.mixedLoadConfirmed === true, expectedRevision: body.expectedRevision });
          }
          if (action === 'reserve-trip-resource') {
            const snapshot = await tx.get(db.collection('deliveryTrips').doc(tripId)); const trip = snapshot.data() || {};
            if (!snapshot.exists || !tripInterval(trip.plannedDeparture, trip.estimatedReturn) || trip.plannedResourceId !== resourceId || !trip.scheduleConfirmedBy) throw new OtpError(409, 'TRIP_SCHEDULE_UNKNOWN', 'A Manager-confirmed schedule and resource are required.');
            return reserveResource(tx, db, { tripId, resourceId, manager });
          }
          return tripLifecycle(tx, db, { tripId, context: manager, action: action === 'confirm-trip-loading' ? 'confirmLoading' : 'confirmReturnAndUnloading' });
        });
        return res.status(200).json({ success: true, tripId });
      }
      if (action === 'schedule-trip' && process.env.BLUETAP_TRIP_EMULATOR_MODE === '1') {
        const tripId = clean(body.tripId, 128); const resourceId = clean(body.resourceId, 128);
        if (!tripId || tripId.includes('/')) throw new OtpError(400, 'TRIP_INVALID', 'Choose a valid trip.');
        await db.runTransaction(async (tx) => {
          const plan = await planTripSchedule(tx, db, { tripId, resourceId, plannedDeparture: body.plannedDeparture, estimatedReturn: body.estimatedReturn, manager });
          stageTripSchedule(tx, plan);
        });
        return res.status(200).json({ success: true, tripId });
      }
      if (process.env.BLUETAP_TRIP_EMULATOR_MODE === '1' && ['assign-distributor', 'reassign-distributor', 'reschedule-delivery', 'approve-distributor-reschedule'].includes(action)) {
        requireTripEmulator(db);
        const tripId = clean(body.tripId, 128);
        if (!tripId || tripId.includes('/')) throw new OtpError(400, 'TRIP_INVALID', 'Choose a valid trip.');
        tripContext = { tripId };
      } else if (process.env.BLUETAP_TRIP_EMULATOR_MODE === '1' && !['accept-order', 'reject-order', 'edit-order', 'quote-edit', 'request-transfer', 'accept-transfer', 'decline-transfer', 'reject-distributor-reschedule', 'approve-admin-trip-override', 'reject-admin-trip-override'].includes(action)) {
        requireTripEmulator(db);
        throw new OtpError(503, 'TRIP_MODE_INTEGRATION_INCOMPLETE', 'This dispatch action is unavailable until trip coordination is complete.');
      }
      if (!orderId || (!proposalDecision && !adminOverrideDecision && !['accept-order', 'reject-order', 'assign-distributor', 'reassign-distributor', 'reschedule-delivery', 'request-transfer', 'accept-transfer', 'decline-transfer', 'edit-order', 'quote-edit'].includes(action))) {
        throw new OtpError(400, 'INVALID_DISPATCH_ACTION', 'Choose a valid order dispatch action.');
      }
      const requestedOrderSnapshot = await db.collection('requests').doc(orderId).get();
      if (!requestedOrderSnapshot.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
      const requestedOrder = requestedOrderSnapshot.data() || {};
      if (['accept-transfer', 'decline-transfer'].includes(action)) {
        requireManagerBranch(manager, clean(requestedOrder.transferToBranchId, 128));
      } else {
        requireOwningManager(manager, requestedOrder);
      }
      if (adminOverrideDecision?.action === 'reject-admin-trip-override') {
        const proposalRef = db.collection('requests').doc(orderId).collection('adminTripOverrideProposals').doc(adminOverrideDecision.proposalId);
        const proposal = await db.runTransaction(async (tx) => {
          const [order, pending, actor, branch] = await Promise.all([tx.get(db.collection('requests').doc(orderId)), tx.get(proposalRef), tx.get(db.collection('users').doc(manager.decoded.uid)), tx.get(db.collection('branches').doc(managerBranchId))]);
          const profile = actor.data() || {}; const data = pending.data() || {};
          if (!order.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
          if (!actor.exists || profile.role !== 'manager' || profile.managerStatus !== 'active' || canonicalAccountStatus(profile) !== 'active' || profile.mustChangePassword === true || profile.accountActionHoldIntentId || clean(profile.branchId, 128) !== managerBranchId || !branch.exists || branch.data()?.status !== 'active') throw new OtpError(403, 'BRANCH_ACCESS_DENIED', 'Manager access to this branch has changed.');
          requireOwningManager(manager, order.data() || {});
          if (!pending.exists || data.orderId !== orderId || data.branchId !== managerBranchId || data.id !== adminOverrideDecision.proposalId) throw new OtpError(409, 'ADMIN_OVERRIDE_PROPOSAL_STALE', 'This proposal is no longer available.');
          if (data.status === 'rejected' && data.decidedBy === manager.decoded.uid) return data;
          if (data.status !== 'pending') throw new OtpError(409, 'ADMIN_OVERRIDE_PROPOSAL_STALE', 'This proposal has already been decided.');
          const update = { status: 'rejected', decidedBy: manager.decoded.uid, decidedAt: new Date() };
          tx.update(proposalRef, update);
          return { ...data, ...update };
        });
        return res.status(200).json({ proposal });
      }
      if (adminOverrideDecision?.action === 'approve-admin-trip-override') {
        const proposalRef = db.collection('requests').doc(orderId).collection('adminTripOverrideProposals').doc(adminOverrideDecision.proposalId);
        const snapshot = await proposalRef.get(); const proposal = snapshot.data() || {};
        if (!snapshot.exists || proposal.schemaVersion !== 1 || !['pending', 'approved'].includes(proposal.status) || proposal.orderId !== orderId || proposal.branchId !== managerBranchId || proposal.id !== adminOverrideDecision.proposalId || !['assign', 'reassign'].includes(proposal.action)) throw new OtpError(409, 'ADMIN_OVERRIDE_PROPOSAL_STALE', 'This proposal is no longer available.');
        if ((body.tripId !== undefined && body.tripId !== proposal.tripId) || (body.distributorUid !== undefined && body.distributorUid !== proposal.distributorUid) || (body.scheduledAt !== undefined && body.scheduledAt !== proposal.scheduledAt) || (body.reason !== undefined && body.reason !== proposal.reason)) throw new OtpError(409, 'ADMIN_OVERRIDE_PROPOSAL_CONFLICT', 'Approval must match the exact proposal.');
        tripContext = { tripId: proposal.tripId, proposalApproval: true, adminOverride: { proposalRef, proposalId: proposal.id, fingerprint: proposal.fingerprint } };
        tripMutation = { id: `admin-override:${proposal.id}`, action: adminOverrideDecision.action, proposalId: proposal.id, fingerprint: JSON.stringify([adminOverrideDecision.action, orderId, proposal.id, proposal.fingerprint]) };
        body.distributorUid = proposal.distributorUid; body.scheduledAt = proposal.scheduledAt; body.reassignmentReason = proposal.reason; body.clientMutationId = null;
        action = proposal.action === 'assign' ? 'assign-distributor' : 'reassign-distributor';
      }
      if (proposalDecision?.action === 'reject-distributor-reschedule') {
        const result = await db.runTransaction(async (tx) => {
          const ref = db.collection('requests').doc(orderId);
          const [snapshot, actor, branch] = await Promise.all([tx.get(ref), tx.get(db.collection('users').doc(manager.decoded.uid)), tx.get(db.collection('branches').doc(managerBranchId))]);
          const profile = actor.data() || {}; const current = snapshot.data() || {};
          if (!snapshot.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
          if (!actor.exists || profile.role !== 'manager' || profile.managerStatus !== 'active' || canonicalAccountStatus(profile) !== 'active' || profile.mustChangePassword === true || profile.accountActionHoldIntentId || clean(profile.branchId, 128) !== managerBranchId || !branch.exists || branch.data()?.status !== 'active') throw new OtpError(403, 'BRANCH_ACCESS_DENIED', 'Manager access to this branch has changed.');
          requireOwningManager(manager, current);
          if (!Array.isArray(current.distributorRescheduleProposals)) throw new OtpError(409, 'TRIP_INVALID', 'Reschedule proposals require reconciliation.');
          const proposal = current.distributorRescheduleProposals.find((item) => item?.id === proposalDecision.proposalId);
          if (!proposal || proposal.branchId !== managerBranchId || proposal.orderId !== orderId) throw new OtpError(409, 'RESCHEDULE_PROPOSAL_STALE', 'This proposal is no longer available.');
          if (proposal.status === 'rejected' && proposal.decidedBy === manager.decoded.uid) return current;
          if (proposal.status !== 'pending') throw new OtpError(409, 'RESCHEDULE_PROPOSAL_STALE', 'This proposal has already been decided.');
          const proposals = current.distributorRescheduleProposals.map((item) => item.id === proposal.id ? { ...item, status: 'rejected', decidedBy: manager.decoded.uid, decidedAt: new Date() } : item);
          tx.update(ref, { distributorRescheduleProposals: proposals });
          return { ...current, distributorRescheduleProposals: proposals };
        });
        return res.status(200).json({ order: safeOrder(orderId, result, branchNames), proposalStatus: 'rejected' });
      }
      if (proposalDecision?.action === 'approve-distributor-reschedule') {
        const proposal = Array.isArray(requestedOrder.distributorRescheduleProposals) ? requestedOrder.distributorRescheduleProposals.find((item) => item?.id === proposalDecision.proposalId) : null;
        if (!proposal || !['pending', 'approved'].includes(proposal.status) || proposal.orderId !== orderId || proposal.branchId !== managerBranchId) throw new OtpError(409, 'RESCHEDULE_PROPOSAL_STALE', 'This proposal is no longer available.');
        tripMutation = { id: `proposal-decision:${proposal.id}`, action: proposalDecision.action, proposalId: proposal.id, fingerprint: JSON.stringify([proposalDecision.action, orderId, proposal.id, tripContext.tripId]) };
        tripContext.proposalApproval = true;
        body.scheduledAt = proposal.scheduledAt;
        body.rescheduleReason = Array.from(clean(proposal.reason, 240)).length >= 3 && /[\p{L}\p{N}]/u.test(proposal.reason) ? proposal.reason : 'Distributor requested reschedule';
        body.clientMutationId = null;
        action = 'reschedule-delivery';
      }
      const now = new Date();
      let result;

      if (action === 'accept-order' || action === 'reject-order') {
        const rejectionReason = clean(body.rejectionReason, 240);
        if (action === 'reject-order' && !rejectionReason) throw new OtpError(400, 'REJECTION_REASON_REQUIRED', 'Add a reason for rejecting this order.');
        result = await updateManagedOrder(orderId, async (current) => {
          requireOwningManager(manager, current);
          if (clean(current.status, 80).toLowerCase() !== 'pending' || current.outsideServiceArea === true) {
            throw new OtpError(409, 'ORDER_NOT_PENDING_REVIEW', 'This order is no longer awaiting normal review.');
          }
          if (action === 'accept-order') return updateWithEvent(current, 'ORDER_ACCEPTED_BY_MANAGER', manager.decoded.uid, managerBranchId, now, {
            status: AWAITING_ASSIGNMENT, managerAcceptedAt: now, managerAcceptedBy: manager.decoded.uid, dispatchReadyAt: now,
          });
          const requesterUid = clean(current.requesterUid || current.requester_id, 128);
          return { orderUpdate: updateWithEvent(current, 'ORDER_REJECTED_BY_MANAGER', manager.decoded.uid, managerBranchId, now, {
            status: 'rejected', rejectionReason, managerRejectedAt: now, managerRejectedBy: manager.decoded.uid,
          }), deleteIfOrderMatches: requesterUid ? [db.collection('requesterActiveOrders').doc(requesterUid)] : [] };
        });
      } else if (action === 'assign-distributor' || action === 'reassign-distributor') {
        const clientMutationId = mutationIdOf(body.clientMutationId);
        const reassignmentReason = clean(body.reassignmentReason || body.rescheduleReason || body.reason, 240);
        const expectedStatus = body.expectedStatus ? clean(body.expectedStatus, 80).toLowerCase() : '';
        const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
        if (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < now.getTime() - (5 * 60 * 1000)) {
          throw new OtpError(400, 'INVALID_DELIVERY_SCHEDULE', 'Choose a current or future delivery time.');
        }
        const target = await resolveEligibleDistributor(db, auth, body.distributorUid, managerBranchId);
        if (!tripContext) await checkDistributorWorkloadAndSchedule(db, target.uid, orderId, scheduledAt);
        result = await updateManagedOrder(orderId, async (current, tx, orderSnapshot) => {
          requireOwningManager(manager, current);
          const assignedUid = clean(current.assignedDistributorUid || current.distributor_id, 128);
          const currentStatus = clean(current.status, 80).toLowerCase();
          const assigning = action === 'assign-distributor';
          const currentScheduledTime = scheduleTimestampMillis(current.scheduledAt || current.scheduled_at);
          const override = adminOverrideDecision?.action === 'approve-admin-trip-override' ? await validateAdminTripOverride(tx, db, { orderId, current, orderSnapshot, manager, tripContext, targetUid: target.uid, scheduledAt, reason: reassignmentReason }) : null;
          const fingerprint = resolutionFingerprint(action, target.uid, scheduledAt, reassignmentReason, tripContext?.tripId);
          const replay = resolutionReplay(current, clientMutationId, fingerprint);
          if (assigning && tripContext && replay && assignedUid === target.uid && currentStatus === DISTRIBUTOR_ASSIGNED && currentScheduledTime === scheduledAt.getTime()) {
            await requireTripReplay(tx, db, orderId, tripContext);
            return { replay: current };
          }
          if (
            !override && !assigning &&
            assignedUid === target.uid &&
            currentStatus === DISTRIBUTOR_ASSIGNED &&
            currentScheduledTime === scheduledAt.getTime() &&
            ((clientMutationId && replay) ||
              (!clientMutationId && (!reassignmentReason || clean(current.reassignmentReason, 240) === reassignmentReason)))
          ) {
            await requireTripReplay(tx, db, orderId, tripContext);
            return { replay: current };
          }
          if (replay) {
            throw new OtpError(409, 'ORDER_NOT_ASSIGNABLE', 'This assignment request was already processed with different details.');
          }
          if (expectedStatus && currentStatus !== expectedStatus) {
            throw new OtpError(409, 'ORDER_STATE_CHANGED', 'This order status has changed. Refresh and review the latest order state.');
          }
          const assignableStatuses = new Set([AWAITING_ASSIGNMENT, 'accepted']);
          const reassignableStatuses = new Set([DISTRIBUTOR_ASSIGNED, 'accepted', 'scheduled', 'delivery_failed']);
          if ((assigning && (assignedUid || !assignableStatuses.has(currentStatus))) || (!assigning && (!assignedUid || !reassignableStatuses.has(currentStatus)))) {
            throw new OtpError(409, 'ORDER_NOT_ASSIGNABLE', 'This order is not ready for that Distributor action.');
          }
          if (!override && !assigning && currentStatus === 'delivery_failed' && assignedUid === target.uid) {
            throw new OtpError(409, 'DISTRIBUTOR_UNCHANGED', 'Choose a different eligible Distributor to reassign a failed delivery, or use Reschedule Delivery to keep the current Distributor.');
          }
          const allowedDays = Array.isArray(current.effectiveDeliveryDaysSnapshot) ? current.effectiveDeliveryDaysSnapshot : effectiveDeliveryDays(current.items || []);
          if (!isAllowedDeliveryDate(scheduledAt, allowedDays)) throw new OtpError(409, 'PRODUCT_DELIVERY_DAY_UNAVAILABLE', allowedDays.length ? 'Choose a delivery day allowed for every product in this order.' : 'These products have no common delivery day. Ask Admin to update the product schedules.');
          const event = override ? 'ADMIN_DISPATCH_OVERRIDE' : assigning ? 'DISTRIBUTOR_ASSIGNED' : 'DISTRIBUTOR_REASSIGNED';
          const assignmentEpoch = assignmentVersionForTransition(current, target.uid);
          const rawDistributorUid = clean(target.data?.publicUid || target.data?.displayUid || target.data?.unique_id, 80);
          const targetDistributorUniqueId = rawDistributorUid && !/^[a-zA-Z0-9]{20,}$/.test(rawDistributorUid) ? rawDistributorUid : '';
          const entry = override ? { event, previousDistributorUid: assignedUid || null, previousDistributorNameSnapshot: clean(current.assignedDistributorNameSnapshot || current.distributor_name, 160), distributorUid: target.uid, distributorNameSnapshot: fullName(target.data), distributorUniqueIdSnapshot: targetDistributorUniqueId, assignedByAdminUid: override.adminUid, approvedByManagerUid: manager.decoded.uid, assignedAt: now, scheduledAt, adminOverride: true, reason: reassignmentReason, proposalId: override.id } : assigning
            ? { event, distributorUid: target.uid, distributorNameSnapshot: fullName(target.data), distributorUniqueIdSnapshot: targetDistributorUniqueId, assignedByManagerUid: manager.decoded.uid, assignedAt: now, scheduledAt, ...(clientMutationId ? { clientMutationId, ...(tripContext ? { resolutionFingerprint: fingerprint } : {}) } : {}) }
            : { event, previousDistributorUid: assignedUid, previousDistributorNameSnapshot: clean(current.assignedDistributorNameSnapshot || current.distributor_name, 160), distributorUid: target.uid, distributorNameSnapshot: fullName(target.data), distributorUniqueIdSnapshot: targetDistributorUniqueId, assignedByManagerUid: manager.decoded.uid, assignedAt: now, scheduledAt, ...(reassignmentReason ? { reassignmentReason } : {}), ...(clientMutationId ? { clientMutationId, resolutionFingerprint: fingerprint } : {}) };
          const orderUpdate = updateWithEvent(current, event, manager.decoded.uid, managerBranchId, now, {
            status: DISTRIBUTOR_ASSIGNED,
            assignmentVersion: assignmentEpoch.assignmentVersion,
            assignedDistributorUid: target.uid,
            assignedDistributorNameSnapshot: fullName(target.data),
            assignedDistributorUniqueIdSnapshot: targetDistributorUniqueId,
            distributorUniqueId: targetDistributorUniqueId,
            distributor_unique_id: targetDistributorUniqueId,
            assignedAt: now,
            assignedByManagerUid: manager.decoded.uid,
            ...(override ? { assignedByAdminUid: override.adminUid, adminOverride: true } : {}),
            distributor_id: target.uid,
            distributor_name: fullName(target.data),
            scheduledAt,
            scheduled_at: scheduledAt,
            expectedDeliveryDate: scheduledAt.toISOString(),
            delivery_date: scheduledAt.toISOString(),
            distributorChatGraceUntil: null,
            latestSchedulingEvent: schedulingEvent(current, event, now),
            ...(!assigning ? { reassignedAt: now, ...(reassignmentReason ? { reassignmentReason } : {}) } : {}),
            ...(clientMutationId ? { lastManagerResolutionMutationId: clientMutationId } : {}),
            assignmentHistory: [...history(current.assignmentHistory), entry],
          });
          if (!override) return orderUpdate;
          const auditId = createHash('sha256').update(`${orderId}|${override.id}`).digest('hex');
          return { orderUpdate, proposalUpdate: { ref: tripContext.adminOverride.proposalRef, data: { status: 'approved', decidedBy: manager.decoded.uid, decidedAt: now, approvedAssignmentVersion: assignmentEpoch.assignmentVersion } }, sideEffects: [{ ref: db.collection('adminAuditLogs').doc(`trip_override_${auditId}`), requireAbsent: true, data: { action: 'ADMIN_DISTRIBUTOR_OVERRIDE', adminUid: override.adminUid, approvedByManagerUid: manager.decoded.uid, proposalId: override.id, orderId, branchId: managerBranchId, previousDistributorUid: assignedUid || null, newDistributorUid: target.uid, assignmentVersion: assignmentEpoch.assignmentVersion, scheduledAt: scheduledAt.toISOString(), reason: reassignmentReason, createdAt: now, timestamp: now } }] };
        });
      } else if (action === 'reschedule-delivery') {
        const clientMutationId = mutationIdOf(body.clientMutationId);
        const expectedStatus = body.expectedStatus ? clean(body.expectedStatus, 80).toLowerCase() : '';
        const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
        if (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < now.getTime() - (5 * 60 * 1000)) {
          throw new OtpError(400, 'INVALID_DELIVERY_SCHEDULE', 'Choose a current or future delivery time.');
        }
        const rawReason = typeof body.rescheduleReason === 'string'
          ? body.rescheduleReason
          : typeof body.rescheduleNote === 'string'
            ? body.rescheduleNote
            : typeof body.reason === 'string'
              ? body.reason
              : '';
        const rescheduleReason = clean(rawReason.normalize('NFC').replace(/\s+/gu, ' '), 240);
        if (Array.from(rescheduleReason).length < 3 || !/[\p{L}\p{N}]/u.test(rescheduleReason)) {
          throw new OtpError(400, 'RESCHEDULE_REASON_REQUIRED', 'Add a reason or note (3 to 240 characters) for rescheduling this delivery.');
        }
        const requestedAssignedUid = clean(requestedOrder.assignedDistributorUid || requestedOrder.distributor_id, 128);
        if (body.distributorUid !== undefined && body.distributorUid !== null && String(body.distributorUid).trim() !== '' && clean(body.distributorUid, 128) !== requestedAssignedUid) {
          throw new OtpError(409, 'DISTRIBUTOR_MISMATCH', 'Reschedule preserves the assigned Distributor. Use Reassign Distributor to change the assignee.');
        }
        if (!requestedAssignedUid) {
          throw new OtpError(409, 'ORDER_NOT_RESCHEDULABLE', 'Only failed deliveries with an assigned Distributor can be rescheduled.');
        }
        const target = await resolveEligibleDistributor(db, auth, requestedAssignedUid, managerBranchId);
        if (!tripContext) await checkDistributorWorkloadAndSchedule(db, target.uid, orderId, scheduledAt);
        result = await updateManagedOrder(orderId, async (current, tx) => {
          requireOwningManager(manager, current);
          const assignedUid = clean(current.assignedDistributorUid || current.distributor_id, 128);
          const currentStatus = clean(current.status, 80).toLowerCase();
          const currentScheduledTime = scheduleTimestampMillis(current.scheduledAt || current.scheduled_at);
          let approvedProposals = null;
          if (proposalDecision?.action === 'approve-distributor-reschedule') {
            const matches = Array.isArray(current.distributorRescheduleProposals) ? current.distributorRescheduleProposals.filter((item) => item?.id === proposalDecision.proposalId) : [];
            const proposal = matches[0];
            if (matches.length !== 1 || proposal.status !== 'pending' || proposal.orderId !== orderId || proposal.branchId !== managerBranchId || proposal.distributorUid !== assignedUid || proposal.scheduledAt !== scheduledAt.toISOString()) throw new OtpError(409, 'RESCHEDULE_PROPOSAL_STALE', 'This proposal no longer matches the order.');
            const source = await readTripRescheduleSource(tx, db, { orderId, order: current, context: manager, role: 'manager' });
            if (source.tripState !== 'closed') throw new OtpError(409, 'TRIP_UNLOADING_REQUIRED', 'Manager-confirmed return and unloading are required before rescheduling.');
            if (!proposal.source || ['tripId', 'tripRevision', 'manifestRevision', 'tripState', 'assignmentVersion', 'scheduledAtMillis', 'branchId', 'distributorUid'].some((key) => proposal.source[key] !== source[key])) throw new OtpError(409, 'RESCHEDULE_PROPOSAL_STALE', 'The assignment or trip changed. Ask the Distributor for a new proposal.');
            approvedProposals = current.distributorRescheduleProposals.map((item) => item.id === proposal.id ? { ...item, status: 'approved', decidedBy: manager.decoded.uid, decidedAt: now, targetTripId: tripContext.tripId } : item);
          }
          const fingerprint = resolutionFingerprint(action, target.uid, scheduledAt, rescheduleReason, tripContext?.tripId);
          const replay = resolutionReplay(current, clientMutationId, fingerprint);
          if (
            assignedUid === target.uid &&
            currentStatus === 'scheduled' &&
            currentScheduledTime === scheduledAt.getTime() &&
            clean(current.rescheduleReason, 240) === rescheduleReason &&
            ((clientMutationId && replay) ||
              (!clientMutationId && current.rescheduledByManagerUid === manager.decoded.uid))
          ) {
            await requireTripReplay(tx, db, orderId, tripContext);
            return { replay: current };
          }
          if (replay) {
            throw new OtpError(409, 'ORDER_NOT_RESCHEDULABLE', 'This reschedule request was already processed with different details.');
          }
          if (expectedStatus && currentStatus !== expectedStatus) {
            throw new OtpError(409, 'ORDER_STATE_CHANGED', 'This order status has changed. Refresh and review the latest order state.');
          }
          if (currentStatus !== 'delivery_failed' || !assignedUid || assignedUid !== target.uid) {
            throw new OtpError(409, 'ORDER_NOT_RESCHEDULABLE', 'Only failed deliveries can be rescheduled by the Manager.');
          }
          const allowedDays = Array.isArray(current.effectiveDeliveryDaysSnapshot)
            ? current.effectiveDeliveryDaysSnapshot
            : effectiveDeliveryDays(current.items || []);
          if (!isAllowedDeliveryDate(scheduledAt, allowedDays)) {
            throw new OtpError(409, 'PRODUCT_DELIVERY_DAY_UNAVAILABLE', allowedDays.length ? 'Choose a delivery day allowed for every product in this order.' : 'These products have no common delivery day. Ask Admin to update the product schedules.');
          }
          const rawDistributorUid = clean(target.data?.publicUid || target.data?.displayUid || target.data?.unique_id, 80);
          const targetDistributorUniqueId = rawDistributorUid && !/^[a-zA-Z0-9]{20,}$/.test(rawDistributorUid) ? rawDistributorUid : '';
          const entry = {
            event: 'DELIVERY_RESCHEDULED_BY_MANAGER',
            distributorUid: target.uid,
            distributorNameSnapshot: fullName(target.data),
            distributorUniqueIdSnapshot: targetDistributorUniqueId,
            rescheduledByManagerUid: manager.decoded.uid,
            rescheduledAt: now,
            scheduledAt,
            rescheduleReason,
            ...(proposalDecision ? { proposalId: proposalDecision.proposalId } : {}),
            ...(clientMutationId ? { clientMutationId, resolutionFingerprint: fingerprint } : {}),
          };
          return updateWithEvent(current, 'DELIVERY_RESCHEDULED_BY_MANAGER', manager.decoded.uid, managerBranchId, now, {
            status: 'scheduled',
            scheduledAt,
            scheduled_at: scheduledAt,
            expectedDeliveryDate: scheduledAt.toISOString(),
            delivery_date: scheduledAt.toISOString(),
            rescheduledAt: now,
            rescheduled_at: now,
            rescheduledByManagerUid: manager.decoded.uid,
            rescheduledByRole: 'manager',
            rescheduleReason,
            distributorChatGraceUntil: null,
            latestSchedulingEvent: schedulingEvent(current, 'DELIVERY_RESCHEDULED_BY_MANAGER', now, rescheduleReason),
            ...(approvedProposals ? { distributorRescheduleProposals: approvedProposals } : {}),
            ...(clientMutationId ? { lastManagerResolutionMutationId: clientMutationId } : {}),
            assignmentHistory: [...history(current.assignmentHistory), entry],
          });
        });
      } else if (action === 'edit-order' || action === 'quote-edit') {
        const rawItems = Array.isArray(body.items) && body.items.length ? body.items : null;
        if (!rawItems || rawItems.length > 20) {
          throw new OtpError(400, 'INVALID_ORDER_ITEMS', 'Provide between 1 and 20 order items.');
        }
        const submittedItems = rawItems.map((item) => {
          const productId = clean(item.productId || item.product_id, 128);
          const quantity = Number(item.quantity);
          if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
            throw new OtpError(400, 'INVALID_ORDER_ITEM', 'Each product needs a quantity between 1 and 100.');
          }
          return { productId, quantity };
        });
        if (new Set(submittedItems.map((item) => item.productId)).size !== submittedItems.length) throw new OtpError(400, 'DUPLICATE_ORDER_PRODUCT', 'Combine each product into a single order line.');

        const EDITABLE_STATUSES = new Set(['awaiting_distributor_assignment', 'distributor_assigned', 'accepted', 'scheduled']);
        if (action === 'edit-order' && body.quoteId) {
          if (typeof body.quoteId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.quoteId)) throw new OtpError(400, 'INVALID_EDIT_QUOTE', 'Request a new price quote.');
          const quoteRef = db.collection('managerEditQuotes').doc(body.quoteId);
          const intentHash = managerEditIntentHash(submittedItems, body);
          result = await updateManagedOrder(orderId, async (current, tx, orderSnapshot) => {
            requireOwningManager(manager, current);
            const [quoteSnapshot, actor, branch] = await Promise.all([tx.get(quoteRef), tx.get(db.collection('users').doc(manager.decoded.uid)), tx.get(db.collection('branches').doc(managerBranchId))]);
            requireCurrentManager(actor, branch, manager);
            const quote = quoteSnapshot.data() || {};
            if (!quoteSnapshot.exists || quote.orderId !== orderId || quote.managerUid !== manager.decoded.uid || quote.branchId !== managerBranchId || quote.intentHash !== intentHash) throw new OtpError(409, 'INVALID_EDIT_QUOTE', 'This quote does not match the proposed changes.');
            if (quote.applied === true) return { replay: current };
            const expiry = typeof quote.expiresAt?.toMillis === 'function' ? quote.expiresAt.toMillis() : new Date(quote.expiresAt).getTime();
            if (!Number.isFinite(expiry) || Date.now() >= expiry || !EDITABLE_STATUSES.has(clean(current.status, 80).toLowerCase()) || managerEditRevision(orderSnapshot) !== quote.orderRevision || managerEditRevision(branch) !== quote.branchRevision) throw new OtpError(409, 'EDIT_QUOTE_STALE', 'The quote expired or the order or branch changed. Request a new quote.');
            const productSnapshots = await Promise.all(quote.dependencies.map((entry) => tx.get(db.collection('products').doc(entry.id))));
            if (productSnapshots.some((snapshot, index) => managerEditRevision(snapshot) !== quote.dependencies[index].revision)) throw new OtpError(409, 'EDIT_QUOTE_STALE', 'Product pricing changed. Request a new quote.');
            if (quote.pricingSnapshot) {
              if (quote.promotionPricing !== promotionPricing) throw new OtpError(409, 'EDIT_QUOTE_STALE', 'Promotional pricing changed. Request a new quote.');
              validateSavedPromotion(current, managerBranchId);
              assertPromotionalQuote(quote, productSnapshots, managerBranchId, quote.container ?? current.container, current.deliveryFeeAtOrder, { promotionPricing });
            }
            if (current.scheduledAt && !isAllowedDeliveryDate(current.scheduledAt, quote.effectiveDays)) throw new OtpError(409, 'PRODUCT_DELIVERY_DAY_UNAVAILABLE', 'The current schedule is not valid for these products.');
            const refreshed = await refreshLoadSnapshots(tx, db, quote.items);
            const epoch = await readOrderLoadEpoch(tx, db);
            const proofSnapshot = epoch ? await tx.get(db.collection('orderLoadSnapshots').doc(orderId)) : null;
            let entries = null;
            if (proofSnapshot?.exists) {
              try { entries = verifiedOrderSnapshot(orderId, current.items, proofSnapshot.data(), epoch); }
              catch (error) { if (error.reason !== 'TRIP_LOAD_UNKNOWN') throw error; }
            }
            const trustedItems = preserveOrderLoadSnapshots(current.items, entries, refreshed);
            const quantity = trustedItems.reduce((sum, item) => sum + item.quantity, 0);
            const changes = {
              items: trustedItems, effectiveDeliveryDaysSnapshot: quote.effectiveDays, productLimitViolations: limitViolations(trustedItems),
              productId: trustedItems[0]?.productId || '', product_id: trustedItems[0]?.productId || '',
              productNameSnapshot: trustedItems.map((item) => item.productNameSnapshot).join(', '), product_name: trustedItems.map((item) => item.productNameSnapshot).join(', '),
              unitPriceAtOrder: trustedItems[0]?.unitPriceAtOrder || 0, product_price: trustedItems[0]?.unitPriceAtOrder || 0,
              quantity, total_quantity: quantity, subtotalAtOrder: quote.subtotalAtOrder, totalAtOrder: quote.totalAtOrder, total_cost: quote.totalAtOrder,
              ...(quote.pricingSnapshot ? { pricingSnapshot: quote.pricingSnapshot, discountAmount: quote.discountAmount } : {}),
              ...(quote.pricingSnapshot && current.discount != null ? { discount: quote.discountAmount } : {}),
              ...(quote.pricingSnapshot && current.subtotal != null ? { subtotal: quote.subtotalAtOrder } : {}),
              ...(quote.notes !== null ? { notes: quote.notes, specialInstructions: quote.notes } : {}), ...(quote.container !== null ? { container: quote.container } : {}),
            };
            const previousPricing = savedPricingSnapshot(current);
            const newPricing = savedPricingSnapshot({ ...current, ...changes });
            const editEntry = { event: 'ORDER_EDITED', managerUid: manager.decoded.uid, editedAt: now, quoteId: body.quoteId, previousItems: current.items || [], previousTotal: current.totalAtOrder ?? current.total_cost ?? null, newItems: trustedItems, newTotal: quote.totalAtOrder, previousPricing, newPricing };
            return { loadProof: createOrderLoadSnapshot(orderId, trustedItems, epoch), proposalUpdate: { ref: quoteRef, data: { applied: true, appliedAt: now } }, orderUpdate: updateWithEvent(current, 'ORDER_EDITED', manager.decoded.uid, managerBranchId, now, { ...changes, editHistory: [...history(current.editHistory), editEntry] }) };
          });
          return res.status(200).json({ order: safeOrder(orderId, result, branchNames) });
        }
        const currentCheckStatus = clean(requestedOrder.status, 80).toLowerCase();
        if (!EDITABLE_STATUSES.has(currentCheckStatus)) {
          throw new OtpError(409, 'ORDER_NOT_EDITABLE', 'Orders can only be edited before delivery begins.');
        }

        if (!isMaterialEdit(requestedOrder, submittedItems, body.container)) {
          if (action === 'quote-edit') return res.status(200).json({ requiresConfirmation: false });
          result = await updateManagedOrder(orderId, async (current, tx, orderSnapshot) => {
            requireOwningManager(manager, current);
            if (!EDITABLE_STATUSES.has(clean(current.status, 80).toLowerCase()) || isMaterialEdit(current, submittedItems, body.container)
              || (requestedOrderSnapshot.updateTime && orderSnapshot.updateTime && !requestedOrderSnapshot.updateTime.isEqual(orderSnapshot.updateTime))) {
              throw new OtpError(409, 'ORDER_NOT_EDITABLE', 'This order changed. Refresh before editing.');
            }
            const notes = body.notes !== undefined ? clean(body.notes, 500) : (body.specialInstructions !== undefined ? clean(body.specialInstructions, 500) : current.notes || '');
            const pricing = savedPricingSnapshot(current);
            return updateWithEvent(current, 'ORDER_NOTES_EDITED', manager.decoded.uid, managerBranchId, now, {
              notes, specialInstructions: notes,
              editHistory: [...history(current.editHistory), { event: 'ORDER_NOTES_EDITED', managerUid: manager.decoded.uid, editedAt: now, previousPricing: pricing, newPricing: pricing }],
            });
          });
          return res.status(200).json({ order: safeOrder(orderId, result, branchNames) });
        }
        if (action !== 'quote-edit') throw new OtpError(409, 'EDIT_QUOTE_REQUIRED', 'Review and confirm a current price quote before changing the order.');
        if (requestedOrder.initialBranchId && clean(requestedOrder.initialBranchId, 128) !== managerBranchId) throw new OtpError(409, 'EDIT_TRANSFER_PRICING_REVIEW_REQUIRED', 'Transferred order pricing requires review before changing its items.');

        const productSnapshots = [];
        const items = await Promise.all(submittedItems.map(async (item) => {
          const snapshot = await db.collection('products').doc(item.productId).get();
          productSnapshots.push({ id: item.productId, snapshot });
          if (!snapshot.exists) throw new OtpError(404, 'PRODUCT_NOT_FOUND', 'A selected product no longer exists.');
          const productData = snapshot.data() || {};
          const active = productData.active !== false && productData.is_active !== false && productData.archived !== true;
          const price = safeProduct(snapshot.id, productData).price;
          const branchIds = Array.isArray(productData.branchIds)
            ? productData.branchIds
            : productData.branchId ? [productData.branchId] : [];
          const available = branchIds.length === 0 || branchIds.includes(managerBranchId);
          if (!active || price === null || !available) {
            throw new OtpError(409, 'PRODUCT_UNAVAILABLE', `${clean(productData.name || productData.product_name, 128) || 'A selected product'} is not available from this branch.`);
          }
          const lineTotal = Math.round(price * item.quantity * 100) / 100;
          return {
            productId: snapshot.id,
            productNameSnapshot: clean(productData.name || productData.product_name, 160),
            unitPriceAtOrder: price,
            quantity: item.quantity,
            totalAtOrder: lineTotal,
            containerTypeSnapshot: clean(productData.containerType, 80),
            sizeSnapshot: clean(productData.size, 80),
            loadClassificationSnapshot: safeProduct(snapshot.id, productData).deliveryLoadClassification,
            maxQuantityPerRequesterSnapshot: productLimit(productData.maxQuantityPerRequester),
            deliveryDaysSnapshot: productDeliveryDays(productData.deliveryDays),
          };
        }));
        const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
        let subtotalAtOrder = Math.round(items.reduce((sum, item) => sum + item.totalAtOrder, 0) * 100) / 100;
        const effectiveDays = effectiveDeliveryDays(items);
        const notes = body.notes !== undefined ? clean(body.notes, 500) : (body.specialInstructions !== undefined ? clean(body.specialInstructions, 500) : undefined);
        const container = body.container !== undefined ? clean(body.container, 80) : undefined;
        const oldTotal = requestedOrder.totalAtOrder ?? requestedOrder.total_cost;
        const oldFee = requestedOrder.deliveryFeeAtOrder ?? requestedOrder.deliveryFee;
        const oldDiscount = requestedOrder.discountAmount ?? requestedOrder.discount;
        if (oldTotal == null || oldFee == null || !Number.isFinite(Number(oldTotal)) || Number(oldTotal) < 0 || !Number.isFinite(Number(oldFee)) || Number(oldFee) < 0 || (!requestedOrder.pricingSnapshot && oldDiscount != null && (!Number.isFinite(Number(oldDiscount)) || Number(oldDiscount) !== 0))) throw new OtpError(409, 'EDIT_PRICING_UNAVAILABLE', 'Saved order pricing requires branch review before changing this order.');
        let promoted;
        if (requestedOrder.pricingSnapshot) {
          validateSavedPromotion(requestedOrder, managerBranchId);
          promoted = pricePromotionalEdit(items, productSnapshots.map(({ snapshot }) => snapshot), managerBranchId, container ?? requestedOrder.container, requestedOrder.deliveryFeeAtOrder, { promotionPricing });
          items.splice(0, items.length, ...promoted.items);
          subtotalAtOrder = promoted.subtotalAtOrder;
        } else validateLegacyEditPricing(requestedOrder);
        const branchRef = db.collection('branches').doc(managerBranchId);
        const branchSnapshot = await branchRef.get();
        const quoteRef = db.collection('managerEditQuotes').doc();
        const dependencies = productSnapshots.map(({ id, snapshot }) => ({ id, revision: managerEditRevision(snapshot) }));
        const totalAtOrder = promoted ? promoted.totalAtOrder : calculateOrderTotal(subtotalAtOrder, Number(oldFee));
        const before = savedPricingSnapshot(requestedOrder);
        const after = savedPricingSnapshot({ ...requestedOrder, items, subtotalAtOrder, totalAtOrder, ...(promoted ? { pricingSnapshot: promoted.pricingSnapshot, discountAmount: promoted.discountAmount } : {}) });
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        await db.runTransaction(async (tx) => {
          const [latest, actor, branch, ...products] = await Promise.all([
            tx.get(db.collection('requests').doc(orderId)), tx.get(db.collection('users').doc(manager.decoded.uid)), tx.get(branchRef),
            ...dependencies.map((entry) => tx.get(db.collection('products').doc(entry.id))),
          ]);
          requireCurrentManager(actor, branch, manager);
          requireOwningManager(manager, latest.data() || {});
          if (!latest.exists || !EDITABLE_STATUSES.has(clean(latest.data()?.status, 80).toLowerCase()) || managerEditRevision(latest) !== managerEditRevision(requestedOrderSnapshot) || managerEditRevision(branch) !== managerEditRevision(branchSnapshot) || products.some((product, index) => managerEditRevision(product) !== dependencies[index].revision)) throw new OtpError(409, 'EDIT_QUOTE_STALE', 'The order or pricing changed. Request a new quote.');
          if (promoted) assertPromotionalQuote(promoted, products, managerBranchId, container ?? requestedOrder.container, requestedOrder.deliveryFeeAtOrder, { promotionPricing });
          if (latest.data()?.scheduledAt && !isAllowedDeliveryDate(latest.data().scheduledAt, effectiveDays)) throw new OtpError(409, 'PRODUCT_DELIVERY_DAY_UNAVAILABLE', 'The current schedule is not valid for these products. Reschedule before changing the items.');
          tx.set(quoteRef, { orderId, managerUid: manager.decoded.uid, branchId: managerBranchId, orderRevision: managerEditRevision(latest), branchRevision: managerEditRevision(branch), dependencies, intentHash: managerEditIntentHash(submittedItems, body), items, effectiveDays, subtotalAtOrder, totalAtOrder, ...(promoted ? { pricingSnapshot: promoted.pricingSnapshot, discountAmount: promoted.discountAmount, promotionPricing } : {}), notes: notes ?? null, container: container ?? null, expiresAt, applied: false });
        });
        return res.status(200).json({ requiresConfirmation: true, quoteId: quoteRef.id, expiresAt: expiresAt.toISOString(), before, after });
      } else if (action === 'request-transfer') {
        const targetBranchId = clean(body.targetBranchId, 128);
        const targetBranch = branches.find((branch) => branch.id === targetBranchId);
        const transferReason = clean(body.transferReason, 240);
        const transferRequestId = randomUUID();
        if (!targetBranch || targetBranchId === managerBranchId) throw new OtpError(400, 'INVALID_TRANSFER_TARGET', 'Choose a different active branch for transfer.');
        if (!transferReason) throw new OtpError(400, 'TRANSFER_REASON_REQUIRED', 'Add a short transfer coordination note.');
        const targetManagers = await getTargetManagers(db, auth, targetBranchId);
        if (!targetManagers.length) throw new OtpError(409, 'TARGET_MANAGER_UNAVAILABLE', 'The target branch does not have an active Manager to review this transfer.');
        result = await updateManagedOrder(orderId, async (current) => {
          requireOwningManager(manager, current);
          if (![AWAITING_ASSIGNMENT, DISTRIBUTOR_ASSIGNED].includes(clean(current.status, 80).toLowerCase())) throw new OtpError(409, 'ORDER_NOT_TRANSFERABLE', 'This order cannot be transferred in its current state.');
          const priorDistributorUid = clean(current.assignedDistributorUid || current.distributor_id, 128);
          const assignmentEpoch = priorDistributorUid ? assignmentVersionForTransition(current, '') : null;
          const assignmentHistory = priorDistributorUid ? [...history(current.assignmentHistory), { event: 'DISTRIBUTOR_UNASSIGNED_FOR_TRANSFER', distributorUid: priorDistributorUid, distributorNameSnapshot: clean(current.assignedDistributorNameSnapshot || current.distributor_name, 160), assignedByManagerUid: manager.decoded.uid, assignedAt: now }] : history(current.assignmentHistory);
          const transferEntry = { event: 'BRANCH_TRANSFER_REQUESTED', transferRequestId, fromBranchId: managerBranchId, toBranchId: targetBranchId, sourceManagerUid: manager.decoded.uid, targetManagerUids: targetManagers.map((item) => item.uid), transferReason, requestedAt: now };
          return updateWithEvent(current, 'BRANCH_TRANSFER_REQUESTED', manager.decoded.uid, managerBranchId, now, {
            status: TRANSFER_PENDING,
            transferState: 'pending',
            transferFromBranchId: managerBranchId,
            transferToBranchId: targetBranchId,
            transferRequestedBy: manager.decoded.uid,
            transferRequestedAt: now,
            transferRequestId,
            transferReason,
            sourceManagerUid: manager.decoded.uid,
            targetManagerUid: targetManagers[0]?.uid || '',
            targetManagerUids: targetManagers.map((item) => item.uid),
            assignedDistributorUid: null,
            ...(assignmentEpoch ? { assignmentVersion: assignmentEpoch.assignmentVersion } : {}),
            assignedDistributorNameSnapshot: '',
            assignedDistributorUniqueIdSnapshot: '',
            assignedAt: null,
            assignedByManagerUid: '',
            distributor_id: '',
            distributor_name: '',
            distributorUniqueId: '',
            distributor_unique_id: '',
            assignmentHistory,
            transferHistory: [...history(current.transferHistory), transferEntry],
          });
        });
      } else if (action === 'accept-transfer') {
        result = await updateManagedOrder(orderId, async (current) => {
          if (clean(current.status, 80).toLowerCase() !== TRANSFER_PENDING || clean(current.transferToBranchId, 128) !== managerBranchId) throw new OtpError(409, 'TRANSFER_NOT_PENDING', 'This transfer is not awaiting your branch review.');
          requireManagerBranch(manager, current.transferToBranchId);
          const fromBranchId = clean(current.transferFromBranchId, 128);
          const sourceEvent = sourceDecisionEvent(orderId, current, 'accepted', managerBranchId, branchNames.get(managerBranchId) || manager.branch.name, now);
          return { orderUpdate: updateWithEvent(current, 'BRANCH_TRANSFER_ACCEPTED', manager.decoded.uid, managerBranchId, now, {
            status: AWAITING_ASSIGNMENT,
            branchId: managerBranchId,
            currentBranchId: managerBranchId,
            branchNameSnapshot: branchNames.get(managerBranchId) || clean(manager.branch.name, 160),
            currentBranchNameSnapshot: branchNames.get(managerBranchId) || clean(manager.branch.name, 160),
            branchLocation: { latitude: safeNumber(manager.branch.latitude), longitude: safeNumber(manager.branch.longitude) },
            initialBranchId: clean(current.initialBranchId || fromBranchId, 128),
            transferState: 'accepted',
            transferAcceptedAt: now,
            transferAcceptedBy: manager.decoded.uid,
            transferRequestId: sourceEvent.transferRequestId,
            transferHistory: [...history(current.transferHistory), { event: 'BRANCH_TRANSFER_ACCEPTED', fromBranchId, toBranchId: managerBranchId, acceptedByManagerUid: manager.decoded.uid, acceptedAt: now }],
          }), sideEffects: [{ ref: db.collection(MANAGER_OPERATIONAL_EVENTS).doc(sourceEvent.id), data: sourceEvent.data }] };
        });
      } else {
        const transferDeclineReason = clean(body.transferDeclineReason, 240);
        result = await updateManagedOrder(orderId, async (current) => {
          if (clean(current.status, 80).toLowerCase() !== TRANSFER_PENDING || clean(current.transferToBranchId, 128) !== managerBranchId) throw new OtpError(409, 'TRANSFER_NOT_PENDING', 'This transfer is not awaiting your branch review.');
          requireManagerBranch(manager, current.transferToBranchId);
          const fromBranchId = clean(current.transferFromBranchId, 128);
          const sourceEvent = sourceDecisionEvent(orderId, current, 'declined', managerBranchId, branchNames.get(managerBranchId) || manager.branch.name, now, transferDeclineReason);
          return { orderUpdate: updateWithEvent(current, 'BRANCH_TRANSFER_DECLINED', manager.decoded.uid, managerBranchId, now, {
            status: AWAITING_ASSIGNMENT,
            transferState: 'declined',
            transferDeclinedAt: now,
            transferDeclinedBy: manager.decoded.uid,
            transferDeclineReason,
            transferRequestId: sourceEvent.transferRequestId,
            transferHistory: [...history(current.transferHistory), { event: 'BRANCH_TRANSFER_DECLINED', fromBranchId, toBranchId: managerBranchId, declinedByManagerUid: manager.decoded.uid, declinedAt: now, transferDeclineReason }],
          }), sideEffects: [{ ref: db.collection(MANAGER_OPERATIONAL_EVENTS).doc(sourceEvent.id), data: sourceEvent.data }] };
        });
      }
      return res.status(200).json({ order: safeOrder(orderId, result, branchNames) });
    } catch (error) { return responseError(res, error); }
  };
}

module.exports = { AWAITING_ASSIGNMENT, DISTRIBUTOR_ASSIGNED, MANAGER_OPERATIONAL_EVENTS, TRANSFER_PENDING, createManagerDispatchHandler, isEligibleDistributor, owningBranchId, safeOrder, safeSourceDecisionEvent };
