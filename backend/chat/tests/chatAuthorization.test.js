const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertNoClientParticipantDefinition,
  authorizeBranchCoordination,
  authorizeDistributorBranch,
  authorizeExistingRequesterBranchForManager,
  authorizeRequesterBranch,
  authorizeRequesterDistributor,
} = require('../chatAuthorization');

const requester = { uid: 'requester-a', role: 'requester', accountStatus: 'active' };
const distributor = { uid: 'distributor-a', role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch-a', branchMembershipVersion: 3 };
const manager = { uid: 'manager-a', role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId: 'branch-a' };
const branchA = { id: 'branch-a', status: 'active' };
const branchB = { id: 'branch-b', status: 'active' };
const order = { id: 'order-a', requester_id: 'requester-a', currentBranchId: 'branch-a', assignedDistributorUid: 'distributor-a', assignmentVersion: 4, status: 'distributor_assigned' };

test('Requester-to-Requester and client-defined membership have no authority path', () => {
  assert.throws(() => assertNoClientParticipantDefinition({ participantUserUids: ['requester-a', 'requester-b'] }), (error) => error.reason === 'CHAT_PARTICIPANTS_SERVER_OWNED');
  assert.throws(() => authorizeRequesterBranch({ requester, branch: branchB }), (error) => error.reason === 'CHAT_ORDER_AUTHORITY_REQUIRED');
});

test('Requester may initiate an active branch inquiry or use their authoritative current order', () => {
  assert.deepEqual(authorizeRequesterBranch({ requester, branch: branchB, requesterInitiated: true }), { requesterUid: 'requester-a', branchId: 'branch-b', reason: 'requester_inquiry' });
  const result = authorizeRequesterBranch({ requester, branch: branchA, order });
  assert.equal(result.reason, 'active_order');
  assert.equal(result.orderId, 'order-a');
});

test('Requester and Distributor authority requires ownership, assignment, branch, and epoch', () => {
  assert.equal(authorizeRequesterDistributor({ requester, distributor, branch: branchA, order, assignmentVersion: 4 }).distributorUid, 'distributor-a');
  assert.throws(() => authorizeRequesterDistributor({ requester, distributor: { ...distributor, uid: 'other' }, branch: branchA, order, assignmentVersion: 4 }), (error) => error.reason === 'CHAT_ASSIGNMENT_MISMATCH');
  assert.throws(() => authorizeRequesterDistributor({ requester, distributor: { ...distributor, branchId: 'branch-b' }, branch: branchA, order, assignmentVersion: 4 }), (error) => error.reason === 'CHAT_BRANCH_MISMATCH');
  assert.throws(() => authorizeRequesterDistributor({ requester, distributor, branch: branchA, order, assignmentVersion: 3 }), (error) => error.reason === 'CHAT_ASSIGNMENT_VERSION_STALE');
  assert.throws(() => authorizeRequesterDistributor({ requester: { ...requester, accountStatus: 'terminated' }, distributor, branch: branchA, order, assignmentVersion: 4 }), (error) => error.reason === 'ACCOUNT_TERMINATED');
  const { assignmentVersion: _legacyAssignmentVersion, ...legacyOrder } = order;
  assert.equal(authorizeRequesterDistributor({ requester, distributor, branch: branchA, order: legacyOrder, assignmentVersion: 1 }).assignmentVersion, 1);
  const { assignedDistributorUid: _modernAssignment, ...legacyFieldOrder } = legacyOrder;
  legacyFieldOrder.distributor_id = 'distributor-a';
  assert.equal(authorizeRequesterDistributor({ requester, distributor, branch: branchA, order: legacyFieldOrder, assignmentVersion: 1 }).distributorUid, 'distributor-a');
  const delivered = { ...order, status: 'delivered', chatAccessEndsAt: new Date('2026-10-07T00:00:00Z') };
  assert.equal(authorizeRequesterDistributor({ requester, distributor, branch: branchA, order: delivered, assignmentVersion: 4, now: new Date('2026-10-06T23:59:59Z') }).accessEndsAt, delivered.chatAccessEndsAt);
  assert.throws(() => authorizeRequesterDistributor({ requester, distributor, branch: branchA, order: delivered, assignmentVersion: 4, now: delivered.chatAccessEndsAt }), (error) => error.reason === 'CHAT_ASSIGNMENT_NOT_WRITABLE');
  assert.throws(() => authorizeRequesterDistributor({ requester, distributor, branch: branchA, order: { ...order, assignmentVersion: 0 }, assignmentVersion: 1 }), (error) => error.reason === 'INVALID_ASSIGNMENT_VERSION');
});

test('Distributor branch authority is bound to current branch and membership epoch', () => {
  assert.equal(authorizeDistributorBranch({ distributor, branch: branchA, branchMembershipVersion: 3 }).branchId, 'branch-a');
  assert.throws(() => authorizeDistributorBranch({ distributor, branch: branchB, branchMembershipVersion: 3 }), (error) => error.reason === 'CHAT_BRANCH_MISMATCH');
  assert.throws(() => authorizeDistributorBranch({ distributor, branch: branchA, branchMembershipVersion: 2 }), (error) => error.reason === 'CHAT_MEMBERSHIP_VERSION_STALE');
  assert.throws(() => authorizeDistributorBranch({ distributor: manager, branch: branchB, branchMembershipVersion: 3 }), (error) => error.reason === 'CHAT_ROLE_DENIED');
  const { branchMembershipVersion: _legacyMembershipVersion, ...legacyDistributor } = distributor;
  assert.equal(authorizeDistributorBranch({ distributor: legacyDistributor, branch: branchA, branchMembershipVersion: 1 }).branchMembershipVersion, 1);
  assert.throws(() => authorizeDistributorBranch({ distributor: { ...distributor, branchMembershipVersion: 0 }, branch: branchA, branchMembershipVersion: 1 }), (error) => error.reason === 'INVALID_BRANCH_MEMBERSHIP_VERSION');
  const movedDistributor = { ...distributor, branchId: 'branch-b', branchMembershipVersion: 4 };
  assert.equal(authorizeDistributorBranch({ distributor: movedDistributor, branch: branchB, branchMembershipVersion: 4 }).branchId, 'branch-b');
  assert.throws(() => authorizeDistributorBranch({ distributor: movedDistributor, branch: branchB, branchMembershipVersion: 3 }), (error) => error.reason === 'CHAT_MEMBERSHIP_VERSION_STALE');
});

test('Manager authority follows the current branch and never a former branch', () => {
  const conversation = { id: 'opaque', type: 'requester_branch', requesterUid: 'requester-a', participantBranchIds: ['branch-a'] };
  assert.equal(authorizeExistingRequesterBranchForManager({ manager, branch: branchA, requesterUid: 'requester-a', conversation }).branchId, 'branch-a');
  const reassigned = { ...manager, branchId: 'branch-b' };
  assert.throws(() => authorizeExistingRequesterBranchForManager({ manager: reassigned, branch: branchB, requesterUid: 'requester-a', conversation }), (error) => error.reason === 'CHAT_CONVERSATION_REQUIRED');
  assert.throws(() => authorizeExistingRequesterBranchForManager({ manager: { ...manager, role: 'requester' }, branch: branchA, requesterUid: 'requester-a', conversation }), (error) => error.reason === 'CHAT_ROLE_DENIED');
});

test('branch coordination is branch-authored and requires two active branches', () => {
  assert.deepEqual(authorizeBranchCoordination({ manager, sourceBranch: branchA, targetBranch: branchB }).branchIds, ['branch-a', 'branch-b']);
  assert.throws(() => authorizeBranchCoordination({ manager, sourceBranch: branchA, targetBranch: { ...branchB, status: 'inactive' } }), (error) => error.reason === 'CHAT_BRANCH_INACTIVE');
  assert.throws(() => authorizeBranchCoordination({ manager, sourceBranch: branchA, targetBranch: branchA }), (error) => error.reason === 'CHAT_DISTINCT_BRANCH_REQUIRED');
});
