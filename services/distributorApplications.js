/**
 * services/distributorApplications.js
 *
 * Canonical shared client-side service for Distributor application normalization,
 * status checks, and metadata formatting across Manager and Admin portals.
 */

const PENDING_STATUSES = new Set(['pending', 'pending_branch_review', 'pending_review', 'submitted']);
const ACTIVE_STATUSES = new Set(['active', 'approved']);
const INACTIVE_STATUSES = new Set(['inactive', 'disabled']);
const REJECTED_STATUSES = new Set(['rejected', 'declined']);

export const normalizeDistributorApplicationStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (ACTIVE_STATUSES.has(normalized)) return 'active';
  if (INACTIVE_STATUSES.has(normalized)) return 'inactive';
  if (REJECTED_STATUSES.has(normalized)) return 'rejected';
  if (PENDING_STATUSES.has(normalized)) return 'pending';
  return normalized || 'pending';
};

export const isPendingDistributorApplication = (applicant = {}) => {
  const status = applicant.distributorStatus ||
    applicant.approvalStatus ||
    applicant.status ||
    applicant.accountStatus;
  return normalizeDistributorApplicationStatus(status) === 'pending';
};

export const normalizeDistributorApplication = (applicant = {}) => {
  const uid = applicant.uid || applicant.id || '';
  const displayUid = applicant.publicUid ||
    applicant.displayUid ||
    applicant.uniqueId ||
    applicant.unique_id ||
    '';

  const rawName = applicant.fullName ||
    `${applicant.firstName || ''} ${applicant.lastName || ''}`.trim() ||
    applicant.name ||
    applicant.username ||
    '';

  const status = normalizeDistributorApplicationStatus(
    applicant.distributorStatus ||
    applicant.approvalStatus ||
    applicant.status ||
    applicant.accountStatus
  );

  return {
    ...applicant,
    id: uid,
    uid,
    displayUid: displayUid || (applicant.email ? applicant.email.split('@')[0] : 'ID pending'),
    publicUid: displayUid || null,
    fullName: rawName || 'Unnamed applicant',
    email: applicant.email || '',
    phone: applicant.phone || applicant.contactNumber || '',
    barangay: applicant.barangay || applicant.address || 'Not set',
    requestedBranchId: applicant.requestedBranchId || applicant.branchId || '',
    requestedBranchName: applicant.requestedBranchName || applicant.branchName || '',
    status,
    distributorStatus: status,
    approvalStatus: status,
    isPending: status === 'pending',
    appliedAt: applicant.createdAt || applicant.created_at || null,
    faceVerification: applicant.faceVerification?.status === 'verified'
      ? 'verified'
      : applicant.faceVerification?.required === false
        ? 'not_required'
        : 'pending',
  };
};

export const formatDistributorStatusLabel = (status) => {
  const normalized = normalizeDistributorApplicationStatus(status);
  switch (normalized) {
    case 'active':
      return 'Active';
    case 'pending':
      return 'Pending Review';
    case 'inactive':
      return 'Inactive';
    case 'rejected':
      return 'Rejected';
    default:
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
};
