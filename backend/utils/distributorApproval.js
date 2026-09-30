const { reconcileDistributorMembershipInTransaction } = require('../chat/conversationLifecycleService');
const { requireActiveAccount } = require('../auth/accountStatus');
const { OtpError } = require('./otpError');
const { branchMembershipVersionForTransition } = require('./relationshipEpochs');

const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const statusOf = (data = {}) => {
  const status = clean(data.distributorStatus || data.approvalStatus || data.status || 'pending', 40).toLowerCase();
  return status === 'approved' ? 'active' : status;
};

async function activeBranchInTransaction(tx, db, branchId) {
  const id = clean(branchId, 80);
  const snapshot = id ? await tx.get(db.collection('branches').doc(id)) : null;
  if (!snapshot?.exists) throw new OtpError(404, 'BRANCH_NOT_FOUND', 'Choose an active BlueTap branch before approving this Distributor.');
  if (snapshot.data()?.status !== 'active') throw new OtpError(409, 'BRANCH_INACTIVE', 'The selected branch is inactive.');
  return { id, ...snapshot.data() };
}

async function approveDistributorInTransaction({
  actorRole,
  actorUid,
  branchId,
  db,
  enforceRequestedBranch = false,
  idempotent = false,
  targetRef,
  tx,
}) {
  const snapshot = await tx.get(targetRef);
  if (!snapshot.exists) throw new OtpError(404, 'DISTRIBUTOR_NOT_FOUND', 'Distributor account not found.');
  const data = snapshot.data() || {};
  if (data.role !== 'distributor') throw new OtpError(404, 'DISTRIBUTOR_NOT_FOUND', 'Distributor account not found.');
  if (enforceRequestedBranch) requireActiveAccount(data, { inactiveMessage: 'This Distributor application is not approvable.' });

  const requestedBranchId = clean(data.requestedBranchId, 80);
  const authoritativeBranchId = clean(branchId || requestedBranchId, 80);
  const currentBranchId = clean(data.branchId, 80);
  if (enforceRequestedBranch && (requestedBranchId !== authoritativeBranchId || (currentBranchId && currentBranchId !== authoritativeBranchId))) {
    throw new OtpError(403, 'BRANCH_ACCESS_DENIED', 'Manager approval is limited to Distributor applications for your branch.');
  }

  const previousStatus = statusOf(data);
  if (idempotent && previousStatus === 'active' && clean(data.branchId, 80) === authoritativeBranchId) {
    const branch = await activeBranchInTransaction(tx, db, authoritativeBranchId);
    return { branch, changes: {}, data, idempotent: true, previousStatus };
  }
  if (previousStatus !== 'pending') throw new OtpError(409, 'INVALID_STATUS_TRANSITION', 'This distributor status cannot be changed.');

  const branch = await activeBranchInTransaction(tx, db, authoritativeBranchId);
  const now = new Date();
  const changes = {
    distributorStatus: 'active',
    approvalStatus: 'active',
    status: 'Active',
    branchId: branch.id,
    branchNameSnapshot: clean(branch.name),
    approvedAt: now,
    approvedBy: actorUid,
    updatedAt: now,
  };
  const membershipEpoch = branchMembershipVersionForTransition(data, { ...data, ...changes });
  if (membershipEpoch.changed) changes.branchMembershipVersion = membershipEpoch.branchMembershipVersion;
  if (membershipEpoch.changed) {
    await reconcileDistributorMembershipInTransaction({
      tx,
      db,
      distributorUid: targetRef.id,
      before: data,
      after: { ...data, ...changes },
      now,
      reason: 'distributor_approve',
    });
  }
  tx.update(targetRef, changes);
  tx.set(db.collection('adminAuditLogs').doc(), {
    action: actorRole === 'manager' ? 'MANAGER_DISTRIBUTOR_APPROVED' : 'DISTRIBUTOR_APPROVED',
    actorRole,
    actorUid,
    targetUid: targetRef.id,
    previousStatus,
    newStatus: 'active',
    branchId: branch.id,
    requestedBranchId: requestedBranchId || null,
    createdAt: now,
  });
  return { branch, changes, data, idempotent: false, previousStatus };
}

module.exports = { activeBranchInTransaction, approveDistributorInTransaction, statusOf };
