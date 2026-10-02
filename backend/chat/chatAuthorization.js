const { OtpError } = require('../utils/otpError');
const { requireActiveAccount } = require('../auth/accountStatus');
const { assignedDistributorUid, getAssignmentVersion, getBranchMembershipVersion } = require('../utils/relationshipEpochs');

const CONVERSATION_TYPES = Object.freeze({
  REQUESTER_BRANCH: 'requester_branch',
  REQUESTER_DISTRIBUTOR: 'requester_distributor',
  DISTRIBUTOR_BRANCH: 'distributor_branch',
  BRANCH_COORDINATION: 'branch_coordination',
});

const TERMINAL_ORDER_STATUSES = new Set([
  'delivered', 'completed', 'cancelled', 'canceled', 'rejected', 'declined',
  'declined_outside_service_area',
]);

const clean = (value) => String(value || '').trim();
const timeOf = (value) => value?.toMillis?.() || value?.getTime?.() || Number(value?.seconds || 0) * 1000 || new Date(value || 0).getTime() || 0;
const normalizedStatus = (value) => clean(value).toLowerCase().replace(/[\s-]+/g, '_');
const owningBranchId = (order = {}) => clean(order.currentBranchId || order.branchId);
const orderRequesterUid = (order = {}) => clean(order.requester_id || order.requesterUid);
const orderAssignmentVersion = (order = {}) => getAssignmentVersion(order);
const profileMembershipVersion = (profile = {}) => getBranchMembershipVersion(profile);

function denied(reason, message) {
  throw new OtpError(403, reason, message);
}

function requireRole(profile, role) {
  if (clean(profile?.role).toLowerCase() !== role) denied('CHAT_ROLE_DENIED', `${role} authority is required.`);
  requireActiveAccount(profile);
  return profile;
}

function requireActiveBranch(branch, expectedId = '') {
  const id = clean(branch?.id || branch?.branchId);
  if (!id || (expectedId && id !== clean(expectedId))) denied('CHAT_BRANCH_MISMATCH', 'The authoritative branch does not match.');
  if (normalizedStatus(branch?.status) !== 'active') denied('CHAT_BRANCH_INACTIVE', 'The authoritative branch is inactive.');
  return id;
}

function requireActiveManager(manager, branch) {
  requireRole(manager, 'manager');
  if (normalizedStatus(manager.managerStatus) !== 'active') denied('CHAT_MANAGER_INACTIVE', 'The Manager is not operationally active.');
  const branchId = requireActiveBranch(branch, manager.branchId);
  if (clean(manager.branchId) !== branchId) denied('CHAT_BRANCH_MISMATCH', 'The Manager does not belong to this branch.');
  return branchId;
}

function requireActiveDistributor(distributor) {
  requireRole(distributor, 'distributor');
  const status = normalizedStatus(distributor.distributorStatus || distributor.approvalStatus || distributor.status);
  if (!['active', 'approved'].includes(status)) denied('CHAT_DISTRIBUTOR_INACTIVE', 'The Distributor is not operationally active.');
  if (!clean(distributor.branchId)) denied('CHAT_BRANCH_REQUIRED', 'The Distributor has no authoritative branch.');
  return distributor;
}

function assertNoClientParticipantDefinition(input = {}) {
  const forbidden = ['participantUserUids', 'participantBranchIds', 'participants', 'participantUids', 'branchIds'];
  const supplied = forbidden.filter((field) => Object.prototype.hasOwnProperty.call(input, field));
  if (supplied.length) throw new OtpError(400, 'CHAT_PARTICIPANTS_SERVER_OWNED', 'Conversation membership is resolved by BlueTap.');
  return true;
}

function exactMembers(actual, expected) {
  if (!Array.isArray(actual) && expected.length === 0) return true;
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const normalized = actual.map(clean);
  return new Set(normalized).size === normalized.length
    && [...normalized].sort().every((value, index) => value === [...expected].map(clean).sort()[index]);
}

function assertCanonicalConversationParticipants(conversation = {}) {
  const type = clean(conversation.type);
  let expectedUsers = [];
  let expectedBranches = [];

  if (type === CONVERSATION_TYPES.REQUESTER_BRANCH) {
    expectedUsers = [clean(conversation.requesterUid)];
    expectedBranches = [clean(conversation.branchIds?.[0] || conversation.participantBranchIds?.[0])];
  } else if (type === CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR) {
    const requesterUid = clean(conversation.requesterUid);
    const distributorUid = clean(conversation.distributorUid);
    if (requesterUid && requesterUid === distributorUid) denied('CHAT_STATE_INVALID', 'The stored conversation relationship is invalid.');
    expectedUsers = [requesterUid, distributorUid];
  } else if (type === CONVERSATION_TYPES.DISTRIBUTOR_BRANCH) {
    expectedUsers = [clean(conversation.distributorUid)];
    expectedBranches = [clean(conversation.branchIds?.[0] || conversation.participantBranchIds?.[0])];
  } else if (type === CONVERSATION_TYPES.BRANCH_COORDINATION) {
    expectedBranches = Array.isArray(conversation.branchIds) ? conversation.branchIds.map(clean) : [];
    if (expectedBranches.length !== 2 || expectedBranches[0] === expectedBranches[1]) denied('CHAT_STATE_INVALID', 'The stored conversation relationship is invalid.');
  } else {
    denied('CHAT_STATE_INVALID', 'The stored conversation type is invalid.');
  }

  if (expectedUsers.some((value) => !value) || expectedBranches.some((value) => !value)
      || !exactMembers(conversation.participantUserUids, expectedUsers)
      || !exactMembers(conversation.participantBranchIds, expectedBranches)) {
    denied('CHAT_STATE_INVALID', 'The stored conversation participants are invalid.');
  }

  const expectedPrincipals = [
    ...expectedUsers.map((principalId) => `user:${principalId}`),
    ...expectedBranches.map((principalId) => `branch:${principalId}`),
  ];
  const actualPrincipals = (conversation.participantState || []).map((state) => `${clean(state.principalType)}:${clean(state.principalId)}`);
  if (!exactMembers(actualPrincipals, expectedPrincipals)) denied('CHAT_STATE_INVALID', 'The stored conversation participant state is invalid.');
  return true;
}

function authorizeRequesterBranch({ requester, branch, requesterInitiated = false, order = null } = {}) {
  requireRole(requester, 'requester');
  const branchId = requireActiveBranch(branch);
  const requesterUid = clean(requester.uid || requester.id);
  if (!requesterUid) denied('CHAT_REQUESTER_REQUIRED', 'Requester identity is required.');

  if (requesterInitiated === true) return { requesterUid, branchId, reason: 'requester_inquiry' };
  if (!order || orderRequesterUid(order) !== requesterUid || owningBranchId(order) !== branchId || TERMINAL_ORDER_STATUSES.has(normalizedStatus(order.status))) {
    denied('CHAT_ORDER_AUTHORITY_REQUIRED', 'An authoritative current order is required for this branch conversation.');
  }
  return { requesterUid, branchId, orderId: clean(order.id || order.requestId), reason: 'active_order' };
}

function authorizeExistingRequesterBranchForManager({ manager, branch, requesterUid, conversation } = {}) {
  const branchId = requireActiveManager(manager, branch);
  if (conversation?.type !== CONVERSATION_TYPES.REQUESTER_BRANCH ||
      !Array.isArray(conversation.participantBranchIds) || !conversation.participantBranchIds.includes(branchId) ||
      clean(conversation.requesterUid) !== clean(requesterUid)) {
    denied('CHAT_CONVERSATION_REQUIRED', 'An existing authorized Requester conversation is required.');
  }
  return { branchId, requesterUid: clean(requesterUid), conversationId: clean(conversation.id) };
}

function authorizeRequesterDistributor({ requester, distributor, branch, order, assignmentVersion, now = Date.now() } = {}) {
  requireRole(requester, 'requester');
  requireActiveDistributor(distributor);
  const requesterUid = clean(requester.uid || requester.id);
  const distributorUid = clean(distributor.uid || distributor.id);
  const branchId = requireActiveBranch(branch);
  const expectedVersion = orderAssignmentVersion(order);

  if (!requesterUid || orderRequesterUid(order) !== requesterUid) denied('CHAT_ORDER_OWNER_MISMATCH', 'The Requester does not own this order.');
  if (!distributorUid || assignedDistributorUid(order) !== distributorUid) denied('CHAT_ASSIGNMENT_MISMATCH', 'The Distributor is not assigned to this order.');
  if (owningBranchId(order) !== branchId || clean(distributor.branchId) !== branchId) denied('CHAT_BRANCH_MISMATCH', 'The Distributor is outside the authoritative fulfillment branch.');
  if (!Number.isSafeInteger(assignmentVersion) || assignmentVersion !== expectedVersion) denied('CHAT_ASSIGNMENT_VERSION_STALE', 'The Distributor assignment epoch is stale.');
  const status = normalizedStatus(order?.status);
  const accessEndsAt = order?.chatAccessEndsAt || order?.postOrderChatAccessEndsAt || null;
  const deliveredFollowupActive = ['delivered', 'completed'].includes(status) && timeOf(accessEndsAt) > timeOf(now);
  if (TERMINAL_ORDER_STATUSES.has(status) && !deliveredFollowupActive) denied('CHAT_ASSIGNMENT_NOT_WRITABLE', 'This assignment no longer grants send authority.');

  return { requesterUid, distributorUid, branchId, orderId: clean(order.id || order.requestId), assignmentVersion: expectedVersion, ...(deliveredFollowupActive ? { accessEndsAt } : {}) };
}

function authorizeDistributorBranch({ distributor, branch, branchMembershipVersion } = {}) {
  requireActiveDistributor(distributor);
  const branchId = requireActiveBranch(branch, distributor.branchId);
  const expectedVersion = profileMembershipVersion(distributor);
  if (!Number.isSafeInteger(branchMembershipVersion) || branchMembershipVersion !== expectedVersion) {
    denied('CHAT_MEMBERSHIP_VERSION_STALE', 'The Distributor branch-membership epoch is stale.');
  }
  return { distributorUid: clean(distributor.uid || distributor.id), branchId, branchMembershipVersion: expectedVersion };
}

function authorizeBranchCoordination({ manager, sourceBranch, targetBranch } = {}) {
  const sourceBranchId = requireActiveManager(manager, sourceBranch);
  const targetBranchId = requireActiveBranch(targetBranch);
  if (sourceBranchId === targetBranchId) denied('CHAT_DISTINCT_BRANCH_REQUIRED', 'Branch coordination requires two different branches.');
  return { managerUid: clean(manager.uid || manager.id), branchIds: [sourceBranchId, targetBranchId].sort() };
}

module.exports = {
  CONVERSATION_TYPES,
  TERMINAL_ORDER_STATUSES,
  assertCanonicalConversationParticipants,
  assertNoClientParticipantDefinition,
  authorizeBranchCoordination,
  authorizeDistributorBranch,
  authorizeExistingRequesterBranchForManager,
  authorizeRequesterBranch,
  authorizeRequesterDistributor,
  normalizedStatus,
  orderAssignmentVersion,
  orderRequesterUid,
  owningBranchId,
  profileMembershipVersion,
  requireActiveBranch,
  requireActiveDistributor,
  requireActiveManager,
  requireRole,
};
