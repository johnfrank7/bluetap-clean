const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');

const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const statusOf = (data) => String(data.approvalStatus || data.status || 'pending').toLowerCase();
const safeDistributor = (uid, data) => ({ uid, fullName: clean(data.fullName || `${data.firstName || ''} ${data.lastName || ''}`), username: clean(data.username), email: clean(data.email).toLowerCase(), phone: clean(data.phone, 40), barangay: clean(data.barangay), address: clean(data.address), createdAt: data.createdAt || null, approvedAt: data.approvedAt || null, approvalStatus: statusOf(data), faceVerification: data.faceVerification?.status === 'verified' ? 'verified' : data.faceVerification?.required === false ? 'not_required' : 'pending', emailVerified: data.emailVerified === true });
function bodyOf(req) { if (req.body && typeof req.body === 'object') return req.body; try { return JSON.parse(String(req.body || '{}')); } catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); } }

function createAdminDistributorsHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); if (!applyCors(req, res)) return; if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or POST.' } });
    try {
      const { auth, db } = getAdmin(); const admin = await requireAdmin(req, auth, db);
      if (req.method === 'GET') {
        const snapshot = await db.collection('users').where('role', '==', 'distributor').get();
        return res.status(200).json({ distributors: snapshot.docs.map((doc) => safeDistributor(doc.id, doc.data())) });
      }
      const { uid, action, rejectionReason } = bodyOf(req); const targetRef = db.collection('users').doc(clean(uid, 128));
      const expected = { approve: ['pending'], reject: ['pending'], deactivate: ['active', 'approved'], reactivate: ['inactive'] };
      if (!expected[action]) throw new OtpError(400, 'INVALID_ACTION', 'Choose a valid distributor action.');
      let distributor;
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(targetRef); if (!snapshot.exists) throw new OtpError(404, 'DISTRIBUTOR_NOT_FOUND', 'Distributor account not found.');
        const data = snapshot.data(); const previousStatus = statusOf(data);
        if (data.role !== 'distributor' || !expected[action].includes(previousStatus)) throw new OtpError(409, 'INVALID_STATUS_TRANSITION', 'This distributor status cannot be changed.');
        const nextStatus = action === 'approve' || action === 'reactivate' ? 'active' : action === 'deactivate' ? 'inactive' : 'rejected'; const now = new Date();
        const changes = { approvalStatus: nextStatus, status: nextStatus[0].toUpperCase() + nextStatus.slice(1), updatedAt: now, ...(action === 'approve' ? { approvedAt: now, approvedBy: admin.uid } : {}), ...(action === 'reject' ? { rejectedAt: now, rejectedBy: admin.uid, rejectionReason: clean(rejectionReason, 240) } : {}) };
        tx.update(targetRef, changes); tx.set(db.collection('adminAuditLogs').doc(), { action: `DISTRIBUTOR_${action.toUpperCase()}D`, actorUid: admin.uid, targetUid: targetRef.id, previousStatus, newStatus: nextStatus, rejectionReason: action === 'reject' ? clean(rejectionReason, 240) : null, createdAt: now });
        distributor = safeDistributor(targetRef.id, { ...data, ...changes });
      });
      return res.status(200).json({ distributor });
    } catch (error) { const known = error instanceof OtpError; return res.status(known ? error.status : 500).json({ error: { reason: known ? error.reason : 'DISTRIBUTOR_MANAGEMENT_FAILED', message: known ? error.message : 'Distributor management is unavailable.' } }); }
  };
}
module.exports = { createAdminDistributorsHandler, safeDistributor };
