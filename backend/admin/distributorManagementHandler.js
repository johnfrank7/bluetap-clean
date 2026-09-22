const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');

const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const statusOf = (data = {}) => {
  const status = String(data.distributorStatus || data.approvalStatus || data.status || 'pending').trim().toLowerCase();
  return status === 'approved' ? 'active' : status;
};
const branchName = (data = {}, branchNames = new Map()) => branchNames.get(clean(data.branchId, 80)) || clean(data.branchNameSnapshot);
const requestedBranchName = (data = {}, branchNames = new Map()) => branchNames.get(clean(data.requestedBranchId, 80)) || clean(data.requestedBranchNameSnapshot);
const safeDistributor = (uid, data = {}, branchNames = new Map()) => ({
  uid,
  fullName: clean(data.fullName || `${data.firstName || ''} ${data.lastName || ''}`),
  username: clean(data.username),
  email: clean(data.email).toLowerCase(),
  phone: clean(data.phone, 40),
  barangay: clean(data.barangay),
  address: clean(data.address),
  branchId: clean(data.branchId, 80),
  branchName: branchName(data, branchNames),
  requestedBranchId: clean(data.requestedBranchId, 80),
  requestedBranchName: requestedBranchName(data, branchNames),
  createdAt: data.createdAt || null,
  approvedAt: data.approvedAt || null,
  approvalStatus: statusOf(data),
  distributorStatus: statusOf(data),
  faceVerification: data.faceVerification?.status === 'verified' ? 'verified' : data.faceVerification?.required === false ? 'not_required' : 'pending',
  emailVerified: data.emailVerified === true,
});
function bodyOf(req) { if (req.body && typeof req.body === 'object') return req.body; try { return JSON.parse(String(req.body || '{}')); } catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); } }
async function activeBranchInTransaction(tx, db, branchId) {
  const id = clean(branchId, 80);
  const snapshot = id ? await tx.get(db.collection('branches').doc(id)) : null;
  if (!snapshot?.exists) throw new OtpError(404, 'BRANCH_NOT_FOUND', 'Choose an active BlueTap branch before approving this Distributor.');
  if (snapshot.data()?.status !== 'active') throw new OtpError(409, 'BRANCH_INACTIVE', 'The selected branch is inactive.');
  return { id, ...snapshot.data() };
}

function createAdminDistributorsHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); if (!applyCors(req, res)) return; if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or POST.' } });
    try {
      const { auth, db } = getAdmin(); const admin = await requireAdmin(req, auth, db);
      if (req.method === 'GET') {
        const [users, branches] = await Promise.all([db.collection('users').where('role', '==', 'distributor').get(), db.collection('branches').get()]);
        const branchNames = new Map((branches.docs || []).map((doc) => [doc.id, clean(doc.data()?.name)]));
        return res.status(200).json({ distributors: users.docs.map((doc) => safeDistributor(doc.id, doc.data(), branchNames)) });
      }
      const { uid, action, rejectionReason, branchId } = bodyOf(req); const targetRef = db.collection('users').doc(clean(uid, 128));
      const expected = { approve: ['pending'], reject: ['pending'], deactivate: ['active'], reactivate: ['inactive'] };
      if (!expected[action]) throw new OtpError(400, 'INVALID_ACTION', 'Choose a valid distributor action.');
      let distributor;
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(targetRef); if (!snapshot.exists) throw new OtpError(404, 'DISTRIBUTOR_NOT_FOUND', 'Distributor account not found.');
        const data = snapshot.data(); const previousStatus = statusOf(data);
        if (data.role !== 'distributor' || !expected[action].includes(previousStatus)) throw new OtpError(409, 'INVALID_STATUS_TRANSITION', 'This distributor status cannot be changed.');
        const now = new Date(); const nextStatus = action === 'approve' || action === 'reactivate' ? 'active' : action === 'deactivate' ? 'inactive' : 'rejected';
        let branch = null;
        if (action === 'approve') branch = await activeBranchInTransaction(tx, db, branchId || data.requestedBranchId);
        if (action === 'reactivate') branch = await activeBranchInTransaction(tx, db, data.branchId);
        const changes = {
          distributorStatus: nextStatus,
          approvalStatus: nextStatus,
          status: nextStatus[0].toUpperCase() + nextStatus.slice(1),
          updatedAt: now,
          ...(action === 'approve' ? { branchId: branch.id, branchNameSnapshot: clean(branch.name), approvedAt: now, approvedBy: admin.uid } : {}),
          ...(action === 'reject' ? { branchId: null, branchNameSnapshot: null, rejectedAt: now, rejectedBy: admin.uid, rejectionReason: clean(rejectionReason, 240) } : {}),
        };
        tx.update(targetRef, changes);
        tx.set(db.collection('adminAuditLogs').doc(), {
          action: ({ approve: 'DISTRIBUTOR_APPROVED', reject: 'DISTRIBUTOR_REJECTED', deactivate: 'DISTRIBUTOR_DEACTIVATED', reactivate: 'DISTRIBUTOR_REACTIVATED' })[action], actorUid: admin.uid, targetUid: targetRef.id,
          previousStatus, newStatus: nextStatus, branchId: branch?.id || clean(data.branchId, 80) || null,
          requestedBranchId: clean(data.requestedBranchId, 80) || null,
          rejectionReason: action === 'reject' ? clean(rejectionReason, 240) : null, createdAt: now,
        });
        distributor = safeDistributor(targetRef.id, { ...data, ...changes }, branch ? new Map([[branch.id, clean(branch.name)]]) : new Map());
      });
      return res.status(200).json({ distributor });
    } catch (error) { const known = error instanceof OtpError; return res.status(known ? error.status : 500).json({ error: { reason: known ? error.reason : 'DISTRIBUTOR_MANAGEMENT_FAILED', message: known ? error.message : 'Distributor management is unavailable.' } }); }
  };
}
module.exports = { createAdminDistributorsHandler, safeDistributor, statusOf };
