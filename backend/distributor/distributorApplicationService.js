/**
 * backend/distributor/distributorApplicationService.js
 *
 * Authoritative transactional pipeline for Distributor applications:
 * approval, rejection, cross-branch enforcement, audit logging,
 * and conversation epoch reconciliation.
 */

const { reconcileDistributorMembershipInTransaction } = require('../chat/conversationLifecycleService');
const { accountStatusFlags } = require('../auth/accountStatus');
const { OtpError } = require('../utils/otpError');
const { branchMembershipVersionForTransition } = require('../utils/relationshipEpochs');

const clean = (value, max = 240) => String(value || '').trim().slice(0, max);

const PENDING_STATUSES = new Set(['pending', 'pending_branch_review', 'pending_review', 'submitted']);
const ACTIVE_STATUSES = new Set(['active', 'approved']);
const INACTIVE_STATUSES = new Set(['inactive', 'disabled']);
const REJECTED_STATUSES = new Set(['rejected', 'declined']);

function normalizeDistributorStatus(value) {
  const normalized = clean(value, 40).toLowerCase().replace(/[\s-]+/g, '_');
  if (ACTIVE_STATUSES.has(normalized)) return 'active';
  if (INACTIVE_STATUSES.has(normalized)) return 'inactive';
  if (REJECTED_STATUSES.has(normalized)) return 'rejected';
  if (PENDING_STATUSES.has(normalized)) return 'pending';
  return normalized || 'pending';
}

function isPendingStatus(status) {
  return normalizeDistributorStatus(status) === 'pending';
}

const statusOf = (data = {}) => {
  return normalizeDistributorStatus(data.distributorStatus || data.approvalStatus || data.status);
};

async function activeBranchInTransaction(tx, db, branchId) {
  const id = clean(branchId, 80);
  const snapshot = id ? await tx.get(db.collection('branches').doc(id)) : null;
  if (!snapshot?.exists) throw new OtpError(404, 'BRANCH_NOT_FOUND', 'Choose an active BlueTap branch before approving this Distributor.');
  if (snapshot.data()?.status !== 'active') throw new OtpError(409, 'BRANCH_INACTIVE', 'The selected branch is inactive.');
  return { id, ...snapshot.data() };
}

function assertApprovableAccountState(data = {}) {
  const flags = accountStatusFlags(data);
  if (flags.terminated) throw new OtpError(403, 'ACCOUNT_TERMINATED', 'This account has been terminated.');
  if (flags.suspended) throw new OtpError(403, 'ACCOUNT_SUSPENDED', 'This account is currently suspended.');
}

async function approveDistributorApplicationInTransaction({
  actorRole,
  actorUid,
  actorPublicUid,
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

  assertApprovableAccountState(data);

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
  if (!isPendingStatus(previousStatus)) {
    throw new OtpError(409, 'INVALID_STATUS_TRANSITION', 'This distributor status cannot be changed.');
  }

  const branch = await activeBranchInTransaction(tx, db, authoritativeBranchId);
  const now = new Date();
  const changes = {
    accountStatus: 'active',
    distributorStatus: 'active',
    approvalStatus: 'active',
    status: 'Active',
    branchId: branch.id,
    branchNameSnapshot: clean(branch.name),
    approvedAt: now,
    approvedBy: actorUid,
    rejectionReason: null,
    rejectedAt: null,
    rejectedBy: null,
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
    actorPublicUid: clean(actorPublicUid, 80) || null,
    targetUid: targetRef.id,
    previousStatus,
    newStatus: 'active',
    branchId: branch.id,
    requestedBranchId: requestedBranchId || null,
    createdAt: now,
  });

  const userNoticeDoc = db.collection('moderationNotices').doc(targetRef.id);
  if (typeof userNoticeDoc.collection === 'function') {
    const noticeRef = userNoticeDoc.collection('items').doc();
    tx.set(noticeRef, {
      schemaVersion: 1,
      actionId: noticeRef.id,
      type: 'distributor_application_approved',
      title: `Distributor application approved: ${branch.name}`,
      category: 'DISTRIBUTOR_APPLICATION',
      scope: 'branch',
      branchId: branch.id,
      branchName: branch.name,
      approvedByRole: actorRole,
      createdAt: now,
      seenAt: null,
      acknowledgedAt: null,
    });
  }

  return { branch, changes, data, idempotent: false, previousStatus };
}

async function rejectDistributorApplicationInTransaction({
  actorRole,
  actorUid,
  actorPublicUid,
  branchId,
  db,
  enforceRequestedBranch = false,
  rejectionReason = '',
  targetRef,
  tx,
}) {
  const snapshot = await tx.get(targetRef);
  if (!snapshot.exists) throw new OtpError(404, 'DISTRIBUTOR_NOT_FOUND', 'Distributor account not found.');
  const data = snapshot.data() || {};
  if (data.role !== 'distributor') throw new OtpError(404, 'DISTRIBUTOR_NOT_FOUND', 'Distributor account not found.');

  assertApprovableAccountState(data);

  const requestedBranchId = clean(data.requestedBranchId, 80);
  const authoritativeBranchId = clean(branchId || requestedBranchId, 80);
  const currentBranchId = clean(data.branchId, 80);

  if (enforceRequestedBranch && (requestedBranchId !== authoritativeBranchId || (currentBranchId && currentBranchId !== authoritativeBranchId))) {
    throw new OtpError(403, 'BRANCH_ACCESS_DENIED', 'Manager action is limited to Distributor applications for your branch.');
  }

  const previousStatus = statusOf(data);
  if (!isPendingStatus(previousStatus)) {
    throw new OtpError(409, 'INVALID_STATUS_TRANSITION', 'This distributor status cannot be changed.');
  }

  const now = new Date();
  const reasonText = clean(rejectionReason, 240) || 'Application declined by branch management.';
  const changes = {
    distributorStatus: 'rejected',
    approvalStatus: 'rejected',
    status: 'Rejected',
    branchId: null,
    branchNameSnapshot: null,
    rejectedAt: now,
    rejectedBy: actorUid,
    rejectionReason: reasonText,
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
      reason: 'distributor_reject',
    });
  }

  tx.update(targetRef, changes);

  tx.set(db.collection('adminAuditLogs').doc(), {
    action: actorRole === 'manager' ? 'MANAGER_DISTRIBUTOR_REJECTED' : 'DISTRIBUTOR_REJECTED',
    actorRole,
    actorUid,
    actorPublicUid: clean(actorPublicUid, 80) || null,
    targetUid: targetRef.id,
    previousStatus,
    newStatus: 'rejected',
    branchId: authoritativeBranchId || null,
    requestedBranchId: requestedBranchId || null,
    rejectionReason: reasonText,
    createdAt: now,
  });

  const userNoticeDoc = db.collection('moderationNotices').doc(targetRef.id);
  if (typeof userNoticeDoc.collection === 'function') {
    const noticeRef = userNoticeDoc.collection('items').doc();
    tx.set(noticeRef, {
      schemaVersion: 1,
      actionId: noticeRef.id,
      type: 'distributor_application_rejected',
      title: 'Distributor application declined',
      category: 'DISTRIBUTOR_APPLICATION',
      scope: 'branch',
      branchId: authoritativeBranchId || null,
      rejectionReason: reasonText,
      rejectedByRole: actorRole,
      createdAt: now,
      seenAt: null,
      acknowledgedAt: null,
    });
  }

  return { changes, data, previousStatus };
}

module.exports = {
  activeBranchInTransaction,
  approveDistributorApplicationInTransaction,
  isPendingStatus,
  normalizeDistributorStatus,
  rejectDistributorApplicationInTransaction,
  statusOf,
};
