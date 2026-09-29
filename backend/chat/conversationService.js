const { createHash, randomUUID } = require('node:crypto');
const { canonicalAccountStatus } = require('../auth/accountStatus');
const { OtpError } = require('../utils/otpError');
const {
  CONVERSATION_TYPES,
  TERMINAL_ORDER_STATUSES,
  normalizedStatus,
  orderAssignmentVersion,
  orderRequesterUid,
  owningBranchId,
  profileMembershipVersion,
} = require('./chatAuthorization');

const CONVERSATION_STATUS = Object.freeze({ ACTIVE: 'active', READ_ONLY: 'read_only', CLOSED: 'closed' });
const AUTHORITY_REASONS = Object.freeze({
  REQUESTER_INQUIRY: 'requester_inquiry',
  ACTIVE_ORDER: 'active_order',
  POST_ORDER_FOLLOWUP: 'post_order_followup',
});
const SUPPORTED_TYPES = new Set(Object.values(CONVERSATION_TYPES));
const clean = (value) => String(value || '').trim();
const timeOf = (value) => value?.toMillis?.() || Number(value?.seconds || 0) * 1000 || new Date(value || 0).getTime() || 0;

function required(value, name) {
  const normalized = clean(value);
  if (!normalized) throw new OtpError(400, 'CHAT_AUTHORITY_INCOMPLETE', `${name} is required.`);
  return normalized;
}

function requiredEpoch(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new OtpError(400, 'CHAT_AUTHORITY_INCOMPLETE', `${name} must be a positive integer.`);
  }
  return value;
}

function canonicalAuthorityTuple(type, authority = {}) {
  if (!SUPPORTED_TYPES.has(type)) throw new OtpError(400, 'CHAT_TYPE_UNSUPPORTED', 'Choose a supported conversation type.');
  if (type === CONVERSATION_TYPES.REQUESTER_BRANCH) {
    return ['v1', type, required(authority.requesterUid, 'requesterUid'), required(authority.branchId, 'branchId')];
  }
  if (type === CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR) {
    return ['v1', type, required(authority.orderId, 'orderId'), required(authority.requesterUid, 'requesterUid'), required(authority.distributorUid, 'distributorUid'), requiredEpoch(authority.assignmentVersion, 'assignmentVersion')];
  }
  if (type === CONVERSATION_TYPES.DISTRIBUTOR_BRANCH) {
    return ['v1', type, required(authority.distributorUid, 'distributorUid'), required(authority.branchId, 'branchId'), requiredEpoch(authority.branchMembershipVersion, 'branchMembershipVersion')];
  }
  const branchIds = [required(authority.branchIdA, 'branchIdA'), required(authority.branchIdB, 'branchIdB')].sort();
  if (branchIds[0] === branchIds[1]) throw new OtpError(400, 'CHAT_DISTINCT_BRANCH_REQUIRED', 'Branch coordination requires two different branches.');
  return ['v1', type, ...branchIds];
}

function authorityKeyHash(type, authority) {
  return createHash('sha256').update(JSON.stringify(canonicalAuthorityTuple(type, authority))).digest('hex');
}

function createOpaqueConversationId() {
  return randomUUID();
}

function participantState(principalType, principalId) {
  return { principalType, principalId, lastReadSeq: 0, lastReadAt: null, lastIncomingSeq: 0, unreadCount: 0, accessState: 'active' };
}

function normalizeAuthorityReasons(reasons = {}) {
  const normalized = {};
  for (const reason of Object.values(AUTHORITY_REASONS)) {
    const value = reasons?.[reason];
    if (!value || value.active === false) continue;
    const orderIds = Array.isArray(value.orderIds) ? [...new Set(value.orderIds.map(clean).filter(Boolean))] : [];
    normalized[reason] = {
      active: true,
      ...(orderIds.length ? { orderIds } : {}),
      ...(value.grantedAt ? { grantedAt: value.grantedAt } : {}),
      ...(value.accessEndsAt ? { accessEndsAt: value.accessEndsAt } : {}),
    };
  }
  return normalized;
}

function addAuthorityReason(reasons, reason, { orderId = '', grantedAt = new Date(), accessEndsAt = null } = {}) {
  if (!Object.values(AUTHORITY_REASONS).includes(reason)) throw new OtpError(400, 'CHAT_AUTHORITY_REASON_INVALID', 'Choose a supported authority reason.');
  const next = normalizeAuthorityReasons(reasons);
  const current = next[reason] || { active: true };
  const orderIds = new Set(current.orderIds || []);
  if (clean(orderId)) orderIds.add(clean(orderId));
  next[reason] = { ...current, active: true, grantedAt: current.grantedAt || grantedAt, ...(orderIds.size ? { orderIds: [...orderIds].sort() } : {}), ...(accessEndsAt ? { accessEndsAt } : {}) };
  return next;
}

function removeAuthorityReason(reasons, reason, { orderId = '' } = {}) {
  const next = normalizeAuthorityReasons(reasons);
  if (!next[reason]) return next;
  if (clean(orderId) && Array.isArray(next[reason].orderIds)) {
    const orderIds = next[reason].orderIds.filter((id) => id !== clean(orderId));
    if (orderIds.length) next[reason] = { ...next[reason], orderIds };
    else delete next[reason];
  } else {
    delete next[reason];
  }
  return next;
}

function hasActiveAuthorityReason(reasons, now = Date.now()) {
  return Object.values(normalizeAuthorityReasons(reasons)).some((reason) =>
    reason.active === true && (!reason.accessEndsAt || timeOf(reason.accessEndsAt) > now));
}

function requesterDistributorAssignmentIsCurrent({ order, requesterUid, distributorUid, distributorBranchId, assignmentVersion } = {}) {
  const version = orderAssignmentVersion(order);
  return Boolean(order && Number.isSafeInteger(assignmentVersion) && version === assignmentVersion &&
    orderRequesterUid(order) === clean(requesterUid) &&
    clean(order.assignedDistributorUid) === clean(distributorUid) &&
    owningBranchId(order) === clean(distributorBranchId));
}

function distributorBranchMembershipIsCurrent({ distributor, branchId, branchMembershipVersion } = {}) {
  const version = profileMembershipVersion(distributor);
  const operational = normalizedStatus(distributor?.distributorStatus || distributor?.approvalStatus || distributor?.status);
  return Boolean(Number.isSafeInteger(branchMembershipVersion) && version === branchMembershipVersion && clean(distributor?.branchId) === clean(branchId) && ['active', 'approved'].includes(operational));
}

function resolveConversationLifecycle(input = {}) {
  if (input.currentStatus === CONVERSATION_STATUS.CLOSED || input.retentionExpired === true) return CONVERSATION_STATUS.CLOSED;
  const accounts = Array.isArray(input.accounts) ? input.accounts : [];
  const branches = Array.isArray(input.branches) ? input.branches : [];
  if (accounts.some((account) => canonicalAccountStatus(account) !== 'active')) return CONVERSATION_STATUS.READ_ONLY;
  if (branches.some((branch) => normalizedStatus(branch?.status) !== 'active')) return CONVERSATION_STATUS.READ_ONLY;

  if (input.type === CONVERSATION_TYPES.REQUESTER_BRANCH) {
    return hasActiveAuthorityReason(input.authorityReasons, input.now) ? CONVERSATION_STATUS.ACTIVE : CONVERSATION_STATUS.READ_ONLY;
  }
  if (input.type === CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR) {
    if (!requesterDistributorAssignmentIsCurrent(input)) return CONVERSATION_STATUS.READ_ONLY;
    const status = normalizedStatus(input.order?.status);
    if (['delivered', 'completed'].includes(status)) {
      return timeOf(input.accessEndsAt) > Number(input.now || Date.now()) ? CONVERSATION_STATUS.ACTIVE : CONVERSATION_STATUS.READ_ONLY;
    }
    return TERMINAL_ORDER_STATUSES.has(status) ? CONVERSATION_STATUS.READ_ONLY : CONVERSATION_STATUS.ACTIVE;
  }
  if (input.type === CONVERSATION_TYPES.DISTRIBUTOR_BRANCH) {
    return distributorBranchMembershipIsCurrent(input) ? CONVERSATION_STATUS.ACTIVE : CONVERSATION_STATUS.READ_ONLY;
  }
  if (input.type === CONVERSATION_TYPES.BRANCH_COORDINATION) {
    return branches.length === 2 && clean(branches[0]?.id || branches[0]?.branchId) !== clean(branches[1]?.id || branches[1]?.branchId)
      ? CONVERSATION_STATUS.ACTIVE : CONVERSATION_STATUS.READ_ONLY;
  }
  return CONVERSATION_STATUS.CLOSED;
}

function assignmentAuthority(order = {}) {
  const distributorUid = clean(order.assignedDistributorUid || order.distributor_id);
  if (!distributorUid) return null;
  return {
    type: CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR,
    orderId: clean(order.id || order.orderId || order.requestId || order.request_id),
    requesterUid: orderRequesterUid(order),
    distributorUid,
    assignmentVersion: orderAssignmentVersion(order),
  };
}

function requesterBranchAuthority(order = {}) {
  const branchId = owningBranchId(order);
  const requesterUid = orderRequesterUid(order);
  return branchId && requesterUid
    ? { type: CONVERSATION_TYPES.REQUESTER_BRANCH, requesterUid, branchId }
    : null;
}

function reconcileOrderAuthorityTransition({ before = {}, after = {}, event = 'order_updated', accessEndsAt = null, now = Date.now() } = {}) {
  const transitions = [];
  const seen = new Set();
  const append = (transition) => {
    if (!transition) return;
    const key = JSON.stringify(transition);
    if (!seen.has(key)) { seen.add(key); transitions.push(transition); }
  };
  const beforeAssignment = assignmentAuthority(before);
  const afterAssignment = assignmentAuthority(after);
  const assignmentChanged = Boolean(beforeAssignment || afterAssignment) && (
    beforeAssignment?.distributorUid !== afterAssignment?.distributorUid ||
    beforeAssignment?.assignmentVersion !== afterAssignment?.assignmentVersion
  );

  if (assignmentChanged && beforeAssignment) append({ action: 'read_only', reason: clean(event), authority: beforeAssignment });
  if (assignmentChanged && afterAssignment) append({ action: 'eligible', reason: clean(event), authority: afterAssignment });

  const beforeBranch = requesterBranchAuthority(before);
  const afterBranch = requesterBranchAuthority(after);
  const branchChanged = beforeBranch?.branchId !== afterBranch?.branchId;
  if (branchChanged && beforeBranch) append({ action: 'remove_authority_reason', authorityReason: AUTHORITY_REASONS.ACTIVE_ORDER, orderId: beforeAssignment?.orderId || clean(before.id || before.requestId), authority: beforeBranch });
  if (branchChanged && afterBranch) append({ action: 'add_authority_reason', authorityReason: AUTHORITY_REASONS.ACTIVE_ORDER, orderId: afterAssignment?.orderId || clean(after.id || after.requestId), authority: afterBranch });

  const afterStatus = normalizedStatus(after.status);
  const delivered = ['delivered', 'completed'].includes(afterStatus);
  const terminal = TERMINAL_ORDER_STATUSES.has(afterStatus);
  if (terminal) {
    const followupActive = delivered && timeOf(accessEndsAt) > Number(now);
    if (afterAssignment) append({
      action: followupActive ? 'eligible' : 'read_only',
      reason: followupActive ? AUTHORITY_REASONS.POST_ORDER_FOLLOWUP : afterStatus,
      ...(followupActive ? { accessEndsAt } : {}),
      authority: afterAssignment,
    });
    if (afterBranch) {
      append({ action: 'remove_authority_reason', authorityReason: AUTHORITY_REASONS.ACTIVE_ORDER, orderId: afterAssignment?.orderId || clean(after.id || after.requestId), authority: afterBranch });
      if (followupActive) append({ action: 'add_authority_reason', authorityReason: AUTHORITY_REASONS.POST_ORDER_FOLLOWUP, orderId: afterAssignment?.orderId || clean(after.id || after.requestId), accessEndsAt, authority: afterBranch });
    }
  }

  return {
    event: clean(event),
    assignmentChanged,
    branchChanged,
    sourceBranchRetained: Boolean(beforeBranch?.branchId && beforeBranch.branchId === afterBranch?.branchId),
    targetBranchEligible: Boolean(branchChanged && afterBranch),
    outcome: transitions.length ? 'authority_changed' : 'no_authority_change',
    transitions,
  };
}

function buildConversationFoundation({ type, authority, createdBy, authorityReasons = {}, now = new Date() } = {}) {
  const tuple = canonicalAuthorityTuple(type, authority);
  const base = {
    schemaVersion: 1,
    type,
    authorityKeyHash: createHash('sha256').update(JSON.stringify(tuple)).digest('hex'),
    status: CONVERSATION_STATUS.ACTIVE,
    createdAt: now,
    createdByUid: required(createdBy?.uid, 'createdByUid'),
    createdByRole: required(createdBy?.role, 'createdByRole'),
    updatedAt: now,
    nextSequence: 1,
    lastMessageSeq: 0,
    retentionClass: 'standard',
  };

  if (type === CONVERSATION_TYPES.REQUESTER_BRANCH) {
    const requesterUid = tuple[2]; const branchId = tuple[3];
    const normalizedReasons = normalizeAuthorityReasons(authorityReasons);
    return { ...base, status: hasActiveAuthorityReason(normalizedReasons, timeOf(now)) ? CONVERSATION_STATUS.ACTIVE : CONVERSATION_STATUS.READ_ONLY, participantUserUids: [requesterUid], participantBranchIds: [branchId], requesterUid, branchIds: [branchId], authorityReasons: normalizedReasons, participantState: [participantState('user', requesterUid), participantState('branch', branchId)] };
  }
  if (type === CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR) {
    const [, , orderId, requesterUid, distributorUid, assignmentVersion] = tuple;
    const branchFields = authority.branchId ? { branchIds: [required(authority.branchId, 'branchId')] } : {};
    return { ...base, participantUserUids: [requesterUid, distributorUid], ...branchFields, requesterUid, distributorUid, orderId, assignmentVersion, participantState: [participantState('user', requesterUid), participantState('user', distributorUid)] };
  }
  if (type === CONVERSATION_TYPES.DISTRIBUTOR_BRANCH) {
    const [, , distributorUid, branchId, branchMembershipVersion] = tuple;
    return { ...base, participantUserUids: [distributorUid], participantBranchIds: [branchId], distributorUid, branchIds: [branchId], branchMembershipVersion, participantState: [participantState('user', distributorUid), participantState('branch', branchId)] };
  }
  const branchIds = tuple.slice(2);
  return { ...base, participantBranchIds: branchIds, branchIds, participantState: branchIds.map((branchId) => participantState('branch', branchId)) };
}

module.exports = {
  AUTHORITY_REASONS,
  CONVERSATION_STATUS,
  addAuthorityReason,
  authorityKeyHash,
  buildConversationFoundation,
  canonicalAuthorityTuple,
  createOpaqueConversationId,
  distributorBranchMembershipIsCurrent,
  hasActiveAuthorityReason,
  normalizeAuthorityReasons,
  participantState,
  removeAuthorityReason,
  reconcileOrderAuthorityTransition,
  requesterDistributorAssignmentIsCurrent,
  resolveConversationLifecycle,
};
