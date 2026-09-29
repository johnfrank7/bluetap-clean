const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireActiveManager, requireManagerBranch } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { reconcileOrderLifecycleInTransaction } = require('../chat/conversationLifecycleService');

const PENDING_STATUS = 'outside_radius_pending_approval';
const PRODUCT_LIMIT_PENDING_STATUS = 'manager_approval_pending';
const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const safeOrder = (id, data = {}) => ({
  id,
  requestId: clean(data.requestId || data.request_id, 80),
  requesterName: clean(data.requesterNameSnapshot || data.requester_name, 160),
  contactNumber: clean(data.contactNumberSnapshot || data.contact_number, 40),
  deliveryLocation: data.deliveryLocation && safeNumber(data.deliveryLocation.latitude) !== null && safeNumber(data.deliveryLocation.longitude) !== null
    ? { latitude: safeNumber(data.deliveryLocation.latitude), longitude: safeNumber(data.deliveryLocation.longitude) }
    : null,
  address: clean(data.addressSnapshot || data.address, 300),
  branchId: clean(data.branchId, 128),
  branchName: clean(data.branchNameSnapshot || data.water_station, 160),
  distanceKmSnapshot: safeNumber(data.distanceKmSnapshot),
  serviceRadiusKmSnapshot: safeNumber(data.serviceRadiusKmSnapshot),
  outsideServiceArea: data.outsideServiceArea === true,
  approvalReasons: Array.isArray(data.approvalReasons) ? data.approvalReasons : data.outsideServiceArea === true ? ['OUTSIDE_RADIUS'] : [],
  productLimitViolations: Array.isArray(data.productLimitViolations) ? data.productLimitViolations : [],
  requesterUniqueId: clean(data.requesterUniqueIdSnapshot || data.requester_unique_id, 80),
  items: Array.isArray(data.items) ? data.items.map((item) => ({ productNameSnapshot: clean(item.productNameSnapshot || item.product_name, 160), quantity: Number(item.quantity) || 0, totalAtOrder: safeNumber(item.totalAtOrder ?? item.line_total) || 0 })) : [],
  totalAtOrder: safeNumber(data.totalAtOrder ?? data.total_cost) || 0,
  status: clean(data.status, 80),
  createdAt: data.createdAt || data.created_at || null,
});

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); }
}

function responseError(res, error) {
  const known = error instanceof OtpError;
  return res.status(known ? error.status : 500).json({ error: {
    reason: known ? error.reason : 'service-unavailable',
    message: known ? error.message : 'Order approvals are temporarily unavailable.',
  } });
}

function createOutsideRadiusApprovalsHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'PATCH'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or PATCH.' } });
    try {
      const { auth, db } = getAdmin();
      const manager = await requireActiveManager(req, auth, db);
      const branchId = manager.branch.id;
      if (req.method === 'GET') {
        const snapshot = await db.collection('requests').where('branchId', '==', branchId).get();
        const orders = snapshot.docs
          .map((item) => safeOrder(item.id, item.data()))
          .filter((order) => order.status === PRODUCT_LIMIT_PENDING_STATUS || (order.status === PENDING_STATUS && order.outsideServiceArea === true));
        return res.status(200).json({ orders });
      }
      const body = bodyOf(req);
      const orderId = clean(body.orderId, 128);
      const action = clean(body.action, 32).toLowerCase();
      if (!orderId || !['approve', 'decline'].includes(action)) throw new OtpError(400, 'INVALID_APPROVAL_ACTION', 'Choose whether to approve or decline this request.');
      const ref = db.collection('requests').doc(orderId);
      const now = new Date();
      if (typeof db.runTransaction !== 'function') throw new OtpError(500, 'CHAT_RECONCILIATION_REQUIRED', 'Order approval requires transactional chat reconciliation.');
      const saved = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order approval request was not found.');
        const current = snapshot.data() || {};
        requireManagerBranch(manager, current.branchId);
        if (current.status !== PRODUCT_LIMIT_PENDING_STATUS && !(current.status === PENDING_STATUS && current.outsideServiceArea === true)) {
          throw new OtpError(409, 'ORDER_NOT_AWAITING_APPROVAL', 'This request is no longer awaiting branch approval.');
        }
        const status = action === 'approve' ? 'awaiting_distributor_assignment' : current.status === PENDING_STATUS ? 'declined_outside_service_area' : 'rejected';
        const hasOutsideRadiusReason = current.outsideServiceArea === true || (Array.isArray(current.approvalReasons) && current.approvalReasons.includes('OUTSIDE_RADIUS'));
        const event = current.status === PENDING_STATUS
          ? (action === 'approve' ? 'OUTSIDE_RADIUS_APPROVED' : 'OUTSIDE_RADIUS_DECLINED')
          : (action === 'approve' ? 'MANAGER_EXCEPTION_APPROVED' : 'MANAGER_EXCEPTION_REJECTED');
        const update = {
          status,
          managerApprovalDecision: action,
          managerApprovalReviewedByUid: manager.decoded.uid,
          managerApprovalReviewedAt: now,
          ...(hasOutsideRadiusReason ? { outsideRadiusDecision: action, outsideRadiusReviewedByUid: manager.decoded.uid, outsideRadiusReviewedAt: now } : {}),
          ...(action === 'approve' ? { managerApprovedAt: now, dispatchReadyAt: now } : { managerRejectedAt: now }),
          initialBranchId: clean(current.initialBranchId || current.branchId, 128),
          currentBranchId: clean(current.currentBranchId || current.branchId, 128),
          dispatchEventHistory: [
            ...(Array.isArray(current.dispatchEventHistory) ? current.dispatchEventHistory : []),
            { event, approvalReasons: Array.isArray(current.approvalReasons) ? current.approvalReasons : ['OUTSIDE_RADIUS'], branchId: clean(current.branchId, 128), actorUid: manager.decoded.uid, createdAt: now },
          ],
          updatedAt: now,
          updated_at: now,
        };
        let guardRef = null;
        if (action === 'decline') {
          const requesterUid = clean(current.requesterUid || current.requester_id, 128);
          if (requesterUid) {
            const candidate = db.collection('requesterActiveOrders').doc(requesterUid);
            const guard = await tx.get(candidate);
            if (guard.exists && guard.data()?.orderId === orderId) guardRef = candidate;
          }
        }
        await reconcileOrderLifecycleInTransaction({ tx, db, before: { id: orderId, ...current }, after: { id: orderId, ...current, ...update }, event, now });
        tx.update(ref, update);
        if (guardRef) tx.delete(guardRef);
        return { ...current, ...update };
      });
      return res.status(200).json({ order: safeOrder(orderId, saved) });
    } catch (error) { return responseError(res, error); }
  };
}

module.exports = { PENDING_STATUS, createOutsideRadiusApprovalsHandler, safeOrder };
