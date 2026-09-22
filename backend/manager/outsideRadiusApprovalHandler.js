const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireActiveManager, requireManagerBranch } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');

const PENDING_STATUS = 'outside_radius_pending_approval';
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
    message: known ? error.message : 'Outside-radius approvals are temporarily unavailable.',
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
          .filter((order) => order.status === PENDING_STATUS && order.outsideServiceArea === true);
        return res.status(200).json({ orders });
      }
      const body = bodyOf(req);
      const orderId = clean(body.orderId, 128);
      const action = clean(body.action, 32).toLowerCase();
      if (!orderId || !['approve', 'decline'].includes(action)) throw new OtpError(400, 'INVALID_APPROVAL_ACTION', 'Choose whether to approve or decline this request.');
      const ref = db.collection('requests').doc(orderId);
      const snapshot = await ref.get();
      if (!snapshot.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The outside-radius request was not found.');
      const current = snapshot.data() || {};
      requireManagerBranch(manager, current.branchId);
      if (current.status !== PENDING_STATUS || current.outsideServiceArea !== true) {
        throw new OtpError(409, 'ORDER_NOT_AWAITING_APPROVAL', 'This request is no longer awaiting branch approval.');
      }
      const now = new Date();
      const status = action === 'approve' ? 'awaiting_distributor_assignment' : 'declined_outside_service_area';
      const update = {
        status,
        outsideRadiusDecision: action,
        outsideRadiusReviewedByUid: manager.decoded.uid,
        outsideRadiusReviewedAt: now,
        initialBranchId: clean(current.initialBranchId || current.branchId, 128),
        currentBranchId: clean(current.currentBranchId || current.branchId, 128),
        dispatchEventHistory: [
          ...(Array.isArray(current.dispatchEventHistory) ? current.dispatchEventHistory : []),
          { event: action === 'approve' ? 'OUTSIDE_RADIUS_APPROVED' : 'OUTSIDE_RADIUS_DECLINED', branchId: clean(current.branchId, 128), actorUid: manager.decoded.uid, createdAt: now },
        ],
        updatedAt: now,
        updated_at: now,
      };
      await ref.update(update);
      return res.status(200).json({ order: safeOrder(orderId, { ...current, ...update }) });
    } catch (error) { return responseError(res, error); }
  };
}

module.exports = { PENDING_STATUS, createOutsideRadiusApprovalsHandler, safeOrder };
