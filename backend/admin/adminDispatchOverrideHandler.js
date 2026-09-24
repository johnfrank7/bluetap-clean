const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');

const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const safeNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const fullName = (data = {}) => clean(data.fullName || `${data.firstName || ''} ${data.lastName || ''}`, 160);
const distributorStatus = (data = {}) => clean(data.distributorStatus || data.approvalStatus || data.status, 40).toLowerCase();

const isEligibleDistributor = (data = {}, branchId = '') =>
  data.role === 'distributor' &&
  clean(data.branchId, 128) === branchId &&
  ['active', 'approved'].includes(distributorStatus(data)) &&
  !['inactive', 'disabled'].includes(clean(data.accountStatus, 40).toLowerCase()) &&
  data.mustChangePassword !== true;

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(String(req.body || '{}'));
  } catch {
    throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.');
  }
}

function responseError(res, error) {
  const known = error instanceof OtpError;
  return res.status(known ? error.status : 500).json({
    error: {
      reason: known ? error.reason : 'service-unavailable',
      message: known ? error.message : 'Admin override is temporarily unavailable.',
    },
  });
}

function createAdminDispatchOverrideHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
      return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET, POST, or PATCH.' } });
    }

    try {
      const { auth, db } = getAdmin();
      const admin = await requireAdmin(req, auth, db);

      if (req.method === 'GET') {
        const orderId = clean(req.query?.orderId, 128);
        if (!orderId) {
          throw new OtpError(400, 'ORDER_ID_REQUIRED', 'Provide an orderId to check override details.');
        }

        const orderSnap = await db.collection('requests').doc(orderId).get();
        if (!orderSnap.exists) {
          throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
        }

        const orderData = orderSnap.data() || {};
        const branchId = clean(orderData.currentBranchId || orderData.branchId, 128);
        if (!branchId) {
          throw new OtpError(400, 'BRANCH_NOT_SET', 'This order is not associated with an active branch.');
        }

        const branchSnap = await db.collection('branches').doc(branchId).get();
        const branchName = branchSnap.exists ? clean(branchSnap.data()?.name, 160) : 'Branch';

        const distributorsSnap = await db.collection('users').where('role', '==', 'distributor').get();
        const eligibleDistributors = distributorsSnap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((d) => isEligibleDistributor(d, branchId))
          .map((d) => ({
            uid: d.id,
            name: fullName(d),
            phone: clean(d.phone || d.contactNumber, 40),
            branchId: clean(d.branchId, 128),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        return res.status(200).json({
          orderId,
          branchId,
          branchName,
          currentDistributorUid: clean(orderData.assignedDistributorUid || orderData.distributor_id, 128),
          currentDistributorName: clean(orderData.assignedDistributorNameSnapshot || orderData.distributor_name, 160),
          status: clean(orderData.status, 80),
          scheduledAt: orderData.scheduledAt || null,
          eligibleDistributors,
        });
      }

      // POST or PATCH: Execute Admin Override Assignment/Reassignment
      const body = bodyOf(req);
      const orderId = clean(body.orderId, 128);
      const distributorUid = clean(body.distributorUid, 128);
      const scheduledAtRaw = body.scheduledAt;

      if (!orderId || !distributorUid) {
        throw new OtpError(400, 'INVALID_INPUT', 'Provide both orderId and distributorUid.');
      }

      const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
      const now = new Date();
      if (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < now.getTime() - 5 * 60 * 1000) {
        throw new OtpError(400, 'INVALID_DELIVERY_SCHEDULE', 'Choose a current or future delivery time.');
      }

      const orderRef = db.collection('requests').doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) {
        throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
      }

      const orderData = orderSnap.data() || {};
      const branchId = clean(orderData.currentBranchId || orderData.branchId, 128);
      if (!branchId) {
        throw new OtpError(400, 'BRANCH_NOT_SET', 'This order has no owning branch.');
      }

      const targetSnap = await db.collection('users').doc(distributorUid).get();
      if (!targetSnap.exists) {
        throw new OtpError(404, 'DISTRIBUTOR_NOT_FOUND', 'The selected distributor account does not exist.');
      }

      const targetData = targetSnap.data() || {};
      const targetBranchId = clean(targetData.branchId, 128);

      // STRICT SAME-BRANCH SECURITY CHECK: Admin CANNOT cross-assign branches
      if (targetBranchId !== branchId) {
        throw new OtpError(
          409,
          'CROSS_BRANCH_ASSIGNMENT_FORBIDDEN',
          'Admin override cannot assign a distributor from a different branch. The distributor must belong to the order\'s branch.'
        );
      }

      if (!isEligibleDistributor(targetData, branchId)) {
        throw new OtpError(409, 'DISTRIBUTOR_NOT_ELIGIBLE', 'The selected distributor is not active or approved for this branch.');
      }

      if (typeof auth.getUser === 'function') {
        const account = await auth.getUser(distributorUid).catch(() => null);
        if (!account || account.disabled === true) {
          throw new OtpError(409, 'DISTRIBUTOR_NOT_ELIGIBLE', 'That distributor account is currently disabled.');
        }
      }

      const previousDistributorUid = clean(orderData.assignedDistributorUid || orderData.distributor_id, 128);
      const previousDistributorName = clean(orderData.assignedDistributorNameSnapshot || orderData.distributor_name, 160);
      const targetName = fullName(targetData);

      const event = 'ADMIN_OVERRIDE_ASSIGNED';
      const historyEntry = {
        event,
        previousDistributorUid: previousDistributorUid || null,
        previousDistributorNameSnapshot: previousDistributorName || null,
        distributorUid,
        distributorNameSnapshot: targetName,
        assignedByAdminUid: admin.decoded.uid,
        assignedAt: now,
        scheduledAt,
        adminOverride: true,
      };

      const dispatchHistoryEntry = {
        event,
        actorUid: admin.decoded.uid,
        role: 'admin',
        branchId,
        createdAt: now,
      };

      const updatePayload = {
        status: 'distributor_assigned',
        assignedDistributorUid: distributorUid,
        assignedDistributorNameSnapshot: targetName,
        distributor_id: distributorUid,
        distributor_name: targetName,
        scheduledAt,
        scheduled_at: scheduledAt,
        expectedDeliveryDate: scheduledAt.toISOString(),
        delivery_date: scheduledAt.toISOString(),
        assignedByAdminUid: admin.decoded.uid,
        adminOverride: true,
        assignmentHistory: [...(Array.isArray(orderData.assignmentHistory) ? orderData.assignmentHistory : []), historyEntry],
        dispatchEventHistory: [...(Array.isArray(orderData.dispatchEventHistory) ? orderData.dispatchEventHistory : []), dispatchHistoryEntry],
        updatedAt: now,
        updated_at: now,
      };

      await orderRef.update(updatePayload);

      // Persist administrative audit log
      await db.collection('adminAuditLogs').add({
        action: 'ADMIN_DISTRIBUTOR_OVERRIDE',
        adminUid: admin.decoded.uid,
        orderId,
        branchId,
        previousDistributorUid: previousDistributorUid || null,
        newDistributorUid: distributorUid,
        newDistributorName: targetName,
        scheduledAt: scheduledAt.toISOString(),
        createdAt: now,
        timestamp: now,
      });

      return res.status(200).json({
        success: true,
        message: 'Distributor reassigned successfully via Admin Override.',
        order: { id: orderId, ...orderData, ...updatePayload },
      });
    } catch (error) {
      return responseError(res, error);
    }
  };
}

module.exports = {
  createAdminDispatchOverrideHandler,
  isEligibleDistributor,
};

