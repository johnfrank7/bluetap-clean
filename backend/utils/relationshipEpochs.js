const { OtpError } = require('./otpError');

const RELATIONSHIP_VERSION_BASELINE = 1;
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const clean = (value) => String(value || '').trim();

function canonicalRelationshipVersion(record, field, reason) {
  if (!hasOwn(record, field)) return RELATIONSHIP_VERSION_BASELINE;
  const value = record[field];
  if (!Number.isSafeInteger(value) || value < RELATIONSHIP_VERSION_BASELINE) {
    throw new OtpError(409, reason, `${field} is invalid and must be repaired before changing this relationship.`);
  }
  return value;
}

/**
 * Legacy orders without assignmentVersion use epoch 1 for their current
 * assignment state. The next real assignment change therefore advances to 2
 * and cannot collide with that legacy epoch. Explicit invalid values fail
 * closed instead of being silently normalized.
 */
function getAssignmentVersion(order = {}) {
  return canonicalRelationshipVersion(order, 'assignmentVersion', 'INVALID_ASSIGNMENT_VERSION');
}

/**
 * Legacy Distributor profiles without branchMembershipVersion use epoch 1
 * for their current membership state. A later branch-membership transition
 * advances from that baseline. Explicit invalid values fail closed.
 */
function getBranchMembershipVersion(profile = {}) {
  return canonicalRelationshipVersion(profile, 'branchMembershipVersion', 'INVALID_BRANCH_MEMBERSHIP_VERSION');
}

function nextVersion(current, reason) {
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new OtpError(409, reason, 'The relationship version cannot be advanced safely.');
  }
  return current + 1;
}

function assignedDistributorUid(order = {}) {
  return clean(order.assignedDistributorUid || order.distributor_id);
}

function assignmentVersionForTransition(order = {}, nextDistributorUid = '') {
  const previousDistributorUid = assignedDistributorUid(order);
  const normalizedNextUid = clean(nextDistributorUid);
  const previousVersion = getAssignmentVersion(order);
  const changed = previousDistributorUid !== normalizedNextUid;
  return {
    changed,
    previousDistributorUid,
    nextDistributorUid: normalizedNextUid,
    previousVersion,
    assignmentVersion: changed
      ? nextVersion(previousVersion, 'ASSIGNMENT_VERSION_EXHAUSTED')
      : previousVersion,
  };
}

function distributorBranchMembershipKey(profile = {}) {
  return clean(profile.role).toLowerCase() === 'distributor' && clean(profile.branchId)
    ? `distributor:${clean(profile.branchId)}`
    : '';
}

function branchMembershipVersionForTransition(before = {}, after = {}) {
  const previousMembershipKey = distributorBranchMembershipKey(before);
  const nextMembershipKey = distributorBranchMembershipKey(after);
  const previousVersion = getBranchMembershipVersion(before);
  const changed = previousMembershipKey !== nextMembershipKey;
  return {
    changed,
    previousMembershipKey,
    nextMembershipKey,
    previousVersion,
    branchMembershipVersion: changed
      ? nextVersion(previousVersion, 'BRANCH_MEMBERSHIP_VERSION_EXHAUSTED')
      : previousVersion,
  };
}

module.exports = {
  RELATIONSHIP_VERSION_BASELINE,
  assignedDistributorUid,
  assignmentVersionForTransition,
  branchMembershipVersionForTransition,
  distributorBranchMembershipKey,
  getAssignmentVersion,
  getBranchMembershipVersion,
};
