const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { randomUUID, createHash } = require('node:crypto');
const { requireActiveManager, requireManagerBranch } = require('../auth/authorization');
const { canonicalAccountStatus } = require('../auth/accountStatus');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { assignmentVersionForTransition } = require('../utils/relationshipEpochs');
const { reconcileOrderLifecycleInTransaction } = require('../chat/conversationLifecycleService');
const { effectiveDeliveryDays, isAllowedDeliveryDate, productLimit, productDeliveryDays, limitViolations } = require('../../services/productOrderPolicy');
const { calculateOrderTotal } = require('../../services/deliveryPricing');
const { isMaterialEdit, savedPricingSnapshot, validateLegacyEditPricing, validateSavedPromotion, pricePromotionalEdit, assertPromotionalQuote } = require('../pricing/orderEditPricing');
const { promotionCapability } = require('../pricing/promotionCapability');
const { safeProduct } = require('../admin/productManagementHandler');

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
    uniqueId: uniqueId && !/^[a-zA-Z0-9]{20,}$/.test(uniqueId) ? uniqueId : '',
  };
}

function safeOrder(id, data = {}, branchNames = new Map()) {
  const branchId = owningBranchId(data);
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
    createdAt: data.createdAt || data.created_at || null,
    updatedAt: data.updatedAt || data.updated_at || null,
  };
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
  const snapshot = await db.collection('requests').where('assignedDistributorUid', '==', distributorUid).get();
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
      if (scheduledRaw) {
        const existingTime = new Date(scheduledRaw).getTime();
        if (!Number.isNaN(existingTime) && Math.abs(existingTime - targetTime) < SCHEDULE_CONFLICT_WINDOW_MS) {
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

async function updateOrder(db, orderId, prepare) {
  const ref = db.collection('requests').doc(orderId);
  if (typeof db.runTransaction === 'function') {
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
      const current = snapshot.data() || {};
      const prepared = await prepare(current, tx, snapshot);
      if (prepared?.replay) return prepared.replay;
      const update = prepared?.orderUpdate || prepared;
      const sideEffects = prepared?.sideEffects || [];
      const deleteIfOrderMatches = prepared?.deleteIfOrderMatches || [];
      const newSideEffects = [];
      for (const sideEffect of sideEffects) {
        const existing = await tx.get(sideEffect.ref);
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
      if (prepared?.proposalUpdate) tx.update(prepared.proposalUpdate.ref, prepared.proposalUpdate.data);
      tx.update(ref, update);
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
      const managerBranchId = manager.branch.id;
      const branches = await getActiveBranches(db);
      const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
      if (req.method === 'GET') {
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
      const action = clean(body.action, 48).toLowerCase();
      if (!orderId || !['accept-order', 'reject-order', 'assign-distributor', 'reassign-distributor', 'request-transfer', 'accept-transfer', 'decline-transfer', 'edit-order', 'quote-edit'].includes(action)) {
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
      const now = new Date();
      let result;

      if (action === 'accept-order' || action === 'reject-order') {
        const rejectionReason = clean(body.rejectionReason, 240);
        if (action === 'reject-order' && !rejectionReason) throw new OtpError(400, 'REJECTION_REASON_REQUIRED', 'Add a reason for rejecting this order.');
        result = await updateOrder(db, orderId, async (current) => {
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
        const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
        if (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < now.getTime() - (5 * 60 * 1000)) {
          throw new OtpError(400, 'INVALID_DELIVERY_SCHEDULE', 'Choose a current or future delivery time.');
        }
        const target = await resolveEligibleDistributor(db, auth, body.distributorUid, managerBranchId);
        await checkDistributorWorkloadAndSchedule(db, target.uid, orderId, scheduledAt);
        result = await updateOrder(db, orderId, async (current) => {
          requireOwningManager(manager, current);
          const assignedUid = clean(current.assignedDistributorUid || current.distributor_id, 128);
          const currentStatus = clean(current.status, 80).toLowerCase();
          const assigning = action === 'assign-distributor';
          const assignableStatuses = new Set([AWAITING_ASSIGNMENT, 'accepted']);
          const reassignableStatuses = new Set([DISTRIBUTOR_ASSIGNED, 'accepted', 'scheduled', 'delivery_failed']);
          if ((assigning && (assignedUid || !assignableStatuses.has(currentStatus))) || (!assigning && (!assignedUid || !reassignableStatuses.has(currentStatus)))) {
            throw new OtpError(409, 'ORDER_NOT_ASSIGNABLE', 'This order is not ready for that Distributor action.');
          }
          const allowedDays = Array.isArray(current.effectiveDeliveryDaysSnapshot) ? current.effectiveDeliveryDaysSnapshot : effectiveDeliveryDays(current.items || []);
          if (!isAllowedDeliveryDate(scheduledAt, allowedDays)) throw new OtpError(409, 'PRODUCT_DELIVERY_DAY_UNAVAILABLE', allowedDays.length ? 'Choose a delivery day allowed for every product in this order.' : 'These products have no common delivery day. Ask Admin to update the product schedules.');
          const event = assigning ? 'DISTRIBUTOR_ASSIGNED' : 'DISTRIBUTOR_REASSIGNED';
          const assignmentEpoch = assignmentVersionForTransition(current, target.uid);
          const rawDistributorUid = clean(target.data?.publicUid || target.data?.displayUid || target.data?.unique_id, 80);
          const targetDistributorUniqueId = rawDistributorUid && !/^[a-zA-Z0-9]{20,}$/.test(rawDistributorUid) ? rawDistributorUid : '';
          const entry = assigning
            ? { event, distributorUid: target.uid, distributorNameSnapshot: fullName(target.data), distributorUniqueIdSnapshot: targetDistributorUniqueId, assignedByManagerUid: manager.decoded.uid, assignedAt: now, scheduledAt }
            : { event, previousDistributorUid: assignedUid, previousDistributorNameSnapshot: clean(current.assignedDistributorNameSnapshot || current.distributor_name, 160), distributorUid: target.uid, distributorNameSnapshot: fullName(target.data), distributorUniqueIdSnapshot: targetDistributorUniqueId, assignedByManagerUid: manager.decoded.uid, assignedAt: now, scheduledAt };
          return updateWithEvent(current, event, manager.decoded.uid, managerBranchId, now, {
            status: DISTRIBUTOR_ASSIGNED,
            assignmentVersion: assignmentEpoch.assignmentVersion,
            assignedDistributorUid: target.uid,
            assignedDistributorNameSnapshot: fullName(target.data),
            assignedDistributorUniqueIdSnapshot: targetDistributorUniqueId,
            distributorUniqueId: targetDistributorUniqueId,
            distributor_unique_id: targetDistributorUniqueId,
            assignedAt: now,
            assignedByManagerUid: manager.decoded.uid,
            distributor_id: target.uid,
            distributor_name: fullName(target.data),
            scheduledAt,
            scheduled_at: scheduledAt,
            expectedDeliveryDate: scheduledAt.toISOString(),
            delivery_date: scheduledAt.toISOString(),
            distributorChatGraceUntil: null,
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
          result = await updateOrder(db, orderId, async (current, tx, orderSnapshot) => {
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
            const trustedItems = quote.items;
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
            return { proposalUpdate: { ref: quoteRef, data: { applied: true, appliedAt: now } }, orderUpdate: updateWithEvent(current, 'ORDER_EDITED', manager.decoded.uid, managerBranchId, now, { ...changes, editHistory: [...history(current.editHistory), editEntry] }) };
          });
          return res.status(200).json({ order: safeOrder(orderId, result, branchNames) });
        }
        const currentCheckStatus = clean(requestedOrder.status, 80).toLowerCase();
        if (!EDITABLE_STATUSES.has(currentCheckStatus)) {
          throw new OtpError(409, 'ORDER_NOT_EDITABLE', 'Orders can only be edited before delivery begins.');
        }

        if (!isMaterialEdit(requestedOrder, submittedItems, body.container)) {
          if (action === 'quote-edit') return res.status(200).json({ requiresConfirmation: false });
          result = await updateOrder(db, orderId, async (current, tx, orderSnapshot) => {
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
            maxQuantityPerRequesterSnapshot: productLimit(productData.maxQuantityPerRequester),
            deliveryDaysSnapshot: productDeliveryDays(productData.deliveryDays),
          };
        }));
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
        result = await updateOrder(db, orderId, async (current) => {
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
        result = await updateOrder(db, orderId, async (current) => {
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
        result = await updateOrder(db, orderId, async (current) => {
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
