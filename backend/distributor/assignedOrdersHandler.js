const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireActiveDistributor } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { safeOrder, owningBranchId } = require('../manager/dispatchHandler');
const { OtpError } = require('../utils/otpError');

const clean = (value, max = 128) => String(value || '').trim().slice(0, max);
const history = (value) => Array.isArray(value) ? value : [];
const statusOf = (order = {}) => clean(order.status, 80).toLowerCase();

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); }
}

async function updateOrder(db, orderId, prepare) {
  const ref = db.collection('requests').doc(orderId);
  if (typeof db.runTransaction === 'function') {
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The assigned delivery was not found.');
      const current = snapshot.data() || {};
      const update = await prepare(current);
      tx.update(ref, update);
      return { ...current, ...update };
    });
  }
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The assigned delivery was not found.');
  const current = snapshot.data() || {};
  const update = await prepare(current);
  await ref.update(update);
  return { ...current, ...update };
}

function responseError(res, error) {
  const known = error instanceof OtpError;
  return res.status(known ? error.status : 500).json({ error: {
    reason: known ? error.reason : 'service-unavailable',
    message: known ? error.message : 'Assigned deliveries are temporarily unavailable.',
  } });
}

function createDistributorAssignedOrdersHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'PATCH'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or PATCH.' } });
    try {
      const { auth, db } = getAdmin();
      const distributor = await requireActiveDistributor(req, auth, db);
      if (req.method === 'GET') {
        const [ordersSnapshot, branchesSnapshot] = await Promise.all([
          db.collection('requests').where('assignedDistributorUid', '==', distributor.decoded.uid).get(),
          db.collection('branches').get(),
        ]);
        const branchNames = new Map(branchesSnapshot.docs.map((item) => [item.id, String(item.data()?.name || '').trim()]));
        const orders = ordersSnapshot.docs
          .map((item) => safeOrder(item.id, item.data(), branchNames))
          .filter((order) => order.assignedDistributorUid === distributor.decoded.uid && owningBranchId(order) === distributor.branch.id)
          .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')));
        return res.status(200).json({ orders });
      }

      const body = bodyOf(req);
      const orderId = clean(body.orderId);
      const action = clean(body.action, 48).toLowerCase();
      if (!orderId || !['schedule-delivery', 'start-delivery', 'mark-delivered'].includes(action)) {
        throw new OtpError(400, 'INVALID_DELIVERY_ACTION', 'Choose a valid delivery action.');
      }
      const now = new Date();
      const saved = await updateOrder(db, orderId, async (current) => {
        if (clean(current.assignedDistributorUid || current.distributor_id) !== distributor.decoded.uid
          || owningBranchId(current) !== distributor.branch.id) {
          throw new OtpError(404, 'ORDER_NOT_FOUND', 'The assigned delivery was not found.');
        }
        const currentStatus = statusOf(current);
        let update;
        let event;
        if (action === 'schedule-delivery') {
          const scheduledAt = new Date(body.scheduledAt);
          if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < now.getTime() - (5 * 60 * 1000)) {
            throw new OtpError(400, 'INVALID_DELIVERY_SCHEDULE', 'Choose a current or future delivery time.');
          }
          if (!['distributor_assigned', 'accepted'].includes(currentStatus)) {
            throw new OtpError(409, 'ORDER_NOT_SCHEDULABLE', 'This delivery is not ready to schedule.');
          }
          event = 'DELIVERY_SCHEDULED';
          update = { status: 'scheduled', scheduledAt, acceptedAt: current.acceptedAt || now };
        } else if (action === 'start-delivery') {
          if (!['accepted', 'scheduled'].includes(currentStatus)) {
            throw new OtpError(409, 'ORDER_NOT_STARTABLE', 'This delivery is not ready to start.');
          }
          event = 'DELIVERY_STARTED';
          update = { status: 'out_for_delivery', deliveryStartedAt: now };
        } else {
          if (currentStatus !== 'out_for_delivery') {
            throw new OtpError(409, 'ORDER_NOT_COMPLETABLE', 'Only an active delivery can be marked delivered.');
          }
          event = 'DELIVERY_COMPLETED';
          update = { status: 'delivered', deliveredAt: now };
        }
        return {
          ...update,
          distributorDeliveryHistory: [...history(current.distributorDeliveryHistory), {
            event,
            distributorUid: distributor.decoded.uid,
            branchId: distributor.branch.id,
            createdAt: now,
          }],
          updatedAt: now,
          updated_at: now,
        };
      });
      return res.status(200).json({ order: safeOrder(orderId, saved) });
    } catch (error) { return responseError(res, error); }
  };
}

module.exports = { createDistributorAssignedOrdersHandler };
