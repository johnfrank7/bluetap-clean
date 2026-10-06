const { verifiedIdentity } = require('../auth/authorization');
const { requireActiveAccount } = require('../auth/accountStatus');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');

const clean = (val, max = 128) => String(val || '').trim().slice(0, max);

function createOrderDetailsHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') {
      return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET.' } });
    }

    try {
      const { auth, db } = getAdmin();
      const decoded = await verifiedIdentity(req, auth);
      const uid = clean(decoded.uid);

      const userDoc = await db.collection('users').doc(uid).get();
      if (!userDoc.exists) {
        throw new OtpError(403, 'USER_NOT_FOUND', 'User profile not found.');
      }
      const profile = userDoc.data() || {};
      requireActiveAccount(profile);

      const params = new URL(req.url, 'http://localhost').searchParams;
      const orderId = clean(params.get('orderId') || params.get('requestId') || params.get('id'));
      if (!orderId) {
        throw new OtpError(400, 'ORDER_ID_REQUIRED', 'orderId query parameter is required.');
      }

      let orderRef = db.collection('requests').doc(orderId);
      let orderSnap = await orderRef.get();

      if (!orderSnap.exists) {
        // Query by requestId or publicOrderReference
        const altQuery = await db.collection('requests')
          .where('requestId', '==', orderId)
          .limit(1)
          .get();
        if (!altQuery.empty) {
          orderSnap = altQuery.docs[0];
        } else {
          const refQuery = await db.collection('requests')
            .where('publicOrderReference', '==', orderId)
            .limit(1)
            .get();
          if (!refQuery.empty) {
            orderSnap = refQuery.docs[0];
          }
        }
      }

      if (!orderSnap.exists) {
        throw new OtpError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      }

      const orderData = orderSnap.data() || {};
      const role = clean(profile.role).toLowerCase();
      const userBranchId = clean(profile.branchId);
      const orderBranchId = clean(orderData.branchId || orderData.currentBranchId);
      const transferToBranchId = clean(orderData.transferToBranchId);

      // Role-based authorization
      let isAuthorized = false;
      let maskCoordinates = false;

      if (role === 'admin' || decoded.admin === true || decoded.role === 'admin') {
        isAuthorized = true;
      } else if (role === 'requester') {
        const orderRequesterUid = clean(orderData.requesterUid || orderData.requester_id);
        if (orderRequesterUid === uid) {
          isAuthorized = true;
        }
      } else if (role === 'manager') {
        if (orderBranchId === userBranchId || (transferToBranchId === userBranchId && orderData.status === 'branch_transfer_pending')) {
          isAuthorized = true;
        }
      } else if (role === 'distributor') {
        const assignedUid = clean(orderData.assignedDistributorUid || orderData.distributorId);
        if (assignedUid === uid && orderBranchId === userBranchId) {
          isAuthorized = true;
          // Coordinates visible during active delivery lifecycle
          const activeStatuses = ['accepted', 'scheduled', 'out_for_delivery', 'delivery_failed'];
          if (!activeStatuses.includes(String(orderData.status || '').toLowerCase())) {
            maskCoordinates = true;
          }
        }
      }

      if (!isAuthorized) {
        throw new OtpError(403, 'ORDER_NOT_AUTHORIZED', 'You are not authorized to view this order.');
      }

      // Safe order representation
      const safeOrder = {
        id: orderSnap.id,
        ...orderData,
      };

      if (maskCoordinates && safeOrder.deliveryLocation) {
        safeOrder.deliveryLocation = {
          ...safeOrder.deliveryLocation,
          latitude: null,
          longitude: null,
        };
      }

      // Hydrate requester name and contact if missing on order document
      const orderRequesterUid = clean(orderData.requesterUid || orderData.requester_id);
      if (orderRequesterUid && (!safeOrder.contactNumber || !safeOrder.requesterName)) {
        try {
          const reqUserDoc = await db.collection('users').doc(orderRequesterUid).get();
          if (reqUserDoc.exists) {
            const reqUser = reqUserDoc.data() || {};
            if (!safeOrder.requesterName) {
              safeOrder.requesterName = reqUser.fullName || `${reqUser.firstName || ''} ${reqUser.lastName || ''}`.trim() || reqUser.name || '';
            }
            if (!safeOrder.contactNumber) {
              safeOrder.contactNumber = reqUser.phone || reqUser.contactNumber || reqUser.contact || '';
            }
            if (!safeOrder.requesterPublicUidSnapshot && reqUser.publicUid) {
              safeOrder.requesterPublicUidSnapshot = reqUser.publicUid;
            }
          }
        } catch {
          // Graceful fallback
        }
      }

      return res.status(200).json({ order: safeOrder });
    } catch (error) {
      if (error instanceof OtpError) {
        return res.status(error.status).json({
          error: {
            reason: error.reason,
            message: error.message,
          },
        });
      }
      return res.status(500).json({
        error: {
          reason: 'service-unavailable',
          message: 'Order details could not be retrieved.',
        },
      });
    }
  };
}

module.exports = {
  createOrderDetailsHandler,
};
