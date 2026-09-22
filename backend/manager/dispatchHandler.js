const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { randomUUID } = require('node:crypto');
const { requireActiveManager, requireManagerBranch } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');

const AWAITING_ASSIGNMENT = 'awaiting_distributor_assignment';
const DISTRIBUTOR_ASSIGNED = 'distributor_assigned';
const TRANSFER_PENDING = 'branch_transfer_pending';
const MANAGER_OPERATIONAL_EVENTS = 'managerOperationalEvents';
const ACTIVE_ASSIGNMENT_STATUSES = new Set([DISTRIBUTOR_ASSIGNED, 'accepted', 'scheduled', 'out_for_delivery']);
const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const owningBranchId = (order = {}) => clean(order.currentBranchId || order.branchId, 128);
const fullName = (data = {}) => clean(data.fullName || `${data.firstName || ''} ${data.lastName || ''}`, 160);
const distributorStatus = (data = {}) => clean(data.distributorStatus || data.approvalStatus || data.status, 40).toLowerCase();
const isEligibleDistributor = (data = {}, branchId = '') => data.role === 'distributor'
  && clean(data.branchId, 128) === branchId
  && ['active', 'approved'].includes(distributorStatus(data))
  && !['inactive', 'disabled'].includes(clean(data.accountStatus, 40).toLowerCase())
  && data.mustChangePassword !== true;
const isEligibleManager = (data = {}, branchId = '') => data.role === 'manager'
  && clean(data.branchId, 128) === branchId
  && clean(data.managerStatus, 40).toLowerCase() === 'active'
  && data.mustChangePassword !== true;
const activeBranch = (data = {}) => data.status === 'active' && safeNumber(data.latitude) !== null && safeNumber(data.longitude) !== null;
const history = (source) => Array.isArray(source) ? source : [];

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
  return { uid, name: fullName(data), branchId: clean(data.branchId, 128) };
}

function safeOrder(id, data = {}, branchNames = new Map()) {
  const branchId = owningBranchId(data);
  return {
    id,
    requestId: clean(data.requestId || data.request_id, 80),
    requesterName: clean(data.requesterNameSnapshot || data.requester_name, 160),
    requesterUniqueId: clean(data.requesterUniqueIdSnapshot || data.requester_unique_id, 80),
    contactNumber: clean(data.contactNumberSnapshot || data.contact_number, 40),
    address: clean(data.addressSnapshot || data.address, 300),
    container: clean(data.container, 80),
    paymentMethod: clean(data.paymentMethodSnapshot || data.payment_method, 80),
    deliveryLocation: data.deliveryLocation && safeNumber(data.deliveryLocation.latitude) !== null && safeNumber(data.deliveryLocation.longitude) !== null
      ? { latitude: safeNumber(data.deliveryLocation.latitude), longitude: safeNumber(data.deliveryLocation.longitude) }
      : null,
    items: Array.isArray(data.items) ? data.items.map((item) => ({ productNameSnapshot: clean(item.productNameSnapshot || item.product_name, 160), quantity: Number(item.quantity) || 0, totalAtOrder: safeNumber(item.totalAtOrder ?? item.line_total) || 0 })) : [],
    totalAtOrder: safeNumber(data.totalAtOrder ?? data.total_cost) || 0,
    expectedDeliveryDate: clean(data.expectedDeliveryDate || data.delivery_date, 80),
    scheduledAt: data.scheduledAt || data.scheduled_at || null,
    deliveredAt: data.deliveredAt || data.delivered_at || null,
    status: clean(data.status, 80),
    branchId,
    currentBranchId: branchId,
    currentBranchName: branchNames.get(branchId) || clean(data.branchNameSnapshot || data.currentBranchNameSnapshot, 160),
    initialBranchId: clean(data.initialBranchId || data.branchId, 128),
    initialBranchName: clean(data.initialBranchNameSnapshot, 160),
    distanceKmSnapshot: safeNumber(data.distanceKmSnapshot),
    serviceRadiusKmSnapshot: safeNumber(data.serviceRadiusKmSnapshot),
    outsideServiceArea: data.outsideServiceArea === true,
    assignedDistributorUid: clean(data.assignedDistributorUid || data.distributor_id, 128),
    assignedDistributorName: clean(data.assignedDistributorNameSnapshot || data.distributor_name, 160),
    assignedAt: data.assignedAt || null,
    transferFromBranchId: clean(data.transferFromBranchId, 128),
    transferToBranchId: clean(data.transferToBranchId, 128),
    transferFromBranchName: branchNames.get(clean(data.transferFromBranchId, 128)) || '',
    transferToBranchName: branchNames.get(clean(data.transferToBranchId, 128)) || '',
    transferReason: clean(data.transferReason, 240),
    transferRequestedAt: data.transferRequestedAt || null,
    assignmentHistory: history(data.assignmentHistory),
    transferHistory: history(data.transferHistory),
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

async function distributorIsBusy(db, distributorUid, excludingOrderId = '') {
  const snapshot = await db.collection('requests').get();
  return snapshot.docs.some((item) => item.id !== excludingOrderId
    && clean(item.data()?.assignedDistributorUid || item.data()?.distributor_id, 128) === distributorUid
    && ACTIVE_ASSIGNMENT_STATUSES.has(clean(item.data()?.status, 80).toLowerCase()));
}

async function resolveEligibleDistributor(db, auth, distributorUid, branchId, excludingOrderId = '') {
  const uid = clean(distributorUid, 128);
  const snapshot = uid ? await db.collection('users').doc(uid).get() : null;
  if (!snapshot?.exists || !isEligibleDistributor(snapshot.data(), branchId)) {
    throw new OtpError(409, 'DISTRIBUTOR_NOT_ELIGIBLE', 'Choose an active approved Distributor assigned to your branch.');
  }
  if (typeof auth.getUser === 'function') {
    const account = await auth.getUser(uid).catch(() => null);
    if (!account || account.disabled === true) throw new OtpError(409, 'DISTRIBUTOR_NOT_ELIGIBLE', 'That Distributor account is not active.');
  }
  if (await distributorIsBusy(db, uid, excludingOrderId)) {
    throw new OtpError(409, 'DISTRIBUTOR_BUSY', 'That Distributor already has an active delivery assignment.');
  }
  return { uid, data: snapshot.data() };
}

async function getAvailableDistributors(db, auth, branchId) {
  const snapshot = await db.collection('users').where('role', '==', 'distributor').get();
  const candidates = snapshot.docs.filter((item) => isEligibleDistributor(item.data(), branchId));
  const availability = await Promise.all(candidates.map(async (item) => {
    if (typeof auth.getUser === 'function') {
      const account = await auth.getUser(item.id).catch(() => null);
      if (!account || account.disabled === true) return null;
    }
    return await distributorIsBusy(db, item.id) ? null : safeDistributor(item.id, item.data());
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
      const prepared = await prepare(current);
      const update = prepared?.orderUpdate || prepared;
      const sideEffects = prepared?.sideEffects || [];
      const newSideEffects = [];
      for (const sideEffect of sideEffects) {
        const existing = await tx.get(sideEffect.ref);
        if (!existing.exists) newSideEffects.push(sideEffect);
      }
      tx.update(ref, update);
      for (const sideEffect of newSideEffects) tx.set(sideEffect.ref, sideEffect.data);
      return { ...current, ...update };
    });
  }
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
  const current = snapshot.data() || {};
  const prepared = await prepare(current);
  const update = prepared?.orderUpdate || prepared;
  await ref.update(update);
  for (const sideEffect of prepared?.sideEffects || []) {
    const existing = await sideEffect.ref.get();
    if (!existing.exists) await sideEffect.ref.set(sideEffect.data);
  }
  return { ...current, ...update };
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

function createManagerDispatchHandler(getAdmin = getFirebaseAdmin) {
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
          .filter((order) => order.currentBranchId === managerBranchId && [AWAITING_ASSIGNMENT, DISTRIBUTOR_ASSIGNED, TRANSFER_PENDING].includes(order.status));
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
      if (!orderId || !['assign-distributor', 'reassign-distributor', 'request-transfer', 'accept-transfer', 'decline-transfer'].includes(action)) {
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

      if (action === 'assign-distributor' || action === 'reassign-distributor') {
        const target = await resolveEligibleDistributor(db, auth, body.distributorUid, managerBranchId, orderId);
        result = await updateOrder(db, orderId, async (current) => {
          requireOwningManager(manager, current);
          const assignedUid = clean(current.assignedDistributorUid || current.distributor_id, 128);
          const currentStatus = clean(current.status, 80).toLowerCase();
          const assigning = action === 'assign-distributor';
          if ((assigning && (assignedUid || currentStatus !== AWAITING_ASSIGNMENT)) || (!assigning && (!assignedUid || ![DISTRIBUTOR_ASSIGNED, 'accepted', 'scheduled'].includes(currentStatus)))) {
            throw new OtpError(409, 'ORDER_NOT_ASSIGNABLE', 'This order is not ready for that Distributor action.');
          }
          const event = assigning ? 'DISTRIBUTOR_ASSIGNED' : 'DISTRIBUTOR_REASSIGNED';
          const entry = assigning
            ? { event, distributorUid: target.uid, distributorNameSnapshot: fullName(target.data), assignedByManagerUid: manager.decoded.uid, assignedAt: now }
            : { event, previousDistributorUid: assignedUid, previousDistributorNameSnapshot: clean(current.assignedDistributorNameSnapshot || current.distributor_name, 160), distributorUid: target.uid, distributorNameSnapshot: fullName(target.data), assignedByManagerUid: manager.decoded.uid, assignedAt: now };
          return updateWithEvent(current, event, manager.decoded.uid, managerBranchId, now, {
            status: DISTRIBUTOR_ASSIGNED,
            assignedDistributorUid: target.uid,
            assignedDistributorNameSnapshot: fullName(target.data),
            assignedAt: now,
            assignedByManagerUid: manager.decoded.uid,
            distributor_id: target.uid,
            distributor_name: fullName(target.data),
            assignmentHistory: [...history(current.assignmentHistory), entry],
          });
        });
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
            assignedDistributorNameSnapshot: '',
            assignedAt: null,
            assignedByManagerUid: '',
            distributor_id: '',
            distributor_name: '',
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
