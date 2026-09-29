const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AUTHORITY_REASONS,
  addAuthorityReason,
  authorityKeyHash,
  buildConversationFoundation,
  canonicalAuthorityTuple,
  createOpaqueConversationId,
  removeAuthorityReason,
  resolveConversationLifecycle,
} = require('../conversationService');

test('canonical authority tuples and hashes are stable while document IDs stay opaque', () => {
  const first = { branchIdA: 'branch-z', branchIdB: 'branch-a' };
  const second = { branchIdA: 'branch-a', branchIdB: 'branch-z' };
  assert.deepEqual(canonicalAuthorityTuple('branch_coordination', first), canonicalAuthorityTuple('branch_coordination', second));
  assert.equal(authorityKeyHash('branch_coordination', first), authorityKeyHash('branch_coordination', second));
  const id = createOpaqueConversationId();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.notEqual(id, authorityKeyHash('branch_coordination', first));
  assert.throws(() => canonicalAuthorityTuple('requester_requester', { requesterUid: 'requester-a', otherUid: 'requester-b' }), (error) => error.reason === 'CHAT_TYPE_UNSUPPORTED');
});

test('assignment epoch is part of Requester-Distributor identity', () => {
  const base = { orderId: 'order-a', requesterUid: 'requester-a', distributorUid: 'distributor-a' };
  assert.notEqual(authorityKeyHash('requester_distributor', { ...base, assignmentVersion: 1 }), authorityKeyHash('requester_distributor', { ...base, assignmentVersion: 2 }));
});

test('conversation foundations contain only type-appropriate server-derived identity', () => {
  const conversation = buildConversationFoundation({
    type: 'requester_distributor',
    authority: { orderId: 'order-a', requesterUid: 'requester-a', distributorUid: 'distributor-a', assignmentVersion: 2, branchId: 'branch-a' },
    createdBy: { uid: 'requester-a', role: 'requester' },
    now: new Date('2026-01-01T00:00:00Z'),
  });
  assert.deepEqual(conversation.participantUserUids, ['requester-a', 'distributor-a']);
  assert.equal(conversation.assignmentVersion, '2');
  assert.equal('branchMembershipVersion' in conversation, false);
  assert.equal('lastMessageId' in conversation, false);
  assert.equal(conversation.participantState.length, 2);
});

test('Requester-Branch foundation is not writable without an active authority reason', () => {
  const conversation = buildConversationFoundation({
    type: 'requester_branch', authority: { requesterUid: 'requester-a', branchId: 'branch-a' },
    createdBy: { uid: 'requester-a', role: 'requester' }, now: new Date('2026-01-01T00:00:00Z'),
  });
  assert.equal(conversation.status, 'read_only');
});

test('independent Requester-Branch authority reasons survive selective removal', () => {
  let reasons = addAuthorityReason({}, AUTHORITY_REASONS.REQUESTER_INQUIRY);
  reasons = addAuthorityReason(reasons, AUTHORITY_REASONS.ACTIVE_ORDER, { orderId: 'order-a' });
  reasons = removeAuthorityReason(reasons, AUTHORITY_REASONS.ACTIVE_ORDER, { orderId: 'order-a' });
  assert.equal(reasons.requester_inquiry.active, true);
  assert.equal(reasons.active_order, undefined);
  assert.equal(resolveConversationLifecycle({ type: 'requester_branch', authorityReasons: reasons, accounts: [{ accountStatus: 'active' }], branches: [{ id: 'branch-a', status: 'active' }] }), 'active');
});

test('lifecycle closes only after retention and otherwise becomes read-only when authority ends', () => {
  const activeOrder = { id: 'order-a', requester_id: 'requester-a', currentBranchId: 'branch-a', assignedDistributorUid: 'distributor-a', assignmentVersion: 2, status: 'accepted' };
  const base = { type: 'requester_distributor', order: activeOrder, requesterUid: 'requester-a', distributorUid: 'distributor-a', distributorBranchId: 'branch-a', assignmentVersion: 2, accounts: [{ accountStatus: 'active' }, { accountStatus: 'active' }], branches: [{ id: 'branch-a', status: 'active' }] };
  assert.equal(resolveConversationLifecycle(base), 'active');
  assert.equal(resolveConversationLifecycle({ ...base, assignmentVersion: 1 }), 'read_only');
  assert.equal(resolveConversationLifecycle({ ...base, order: { ...activeOrder, assignedDistributorUid: null, status: 'awaiting_distributor_assignment' } }), 'read_only');
  assert.equal(resolveConversationLifecycle({ ...base, accounts: [{ accountStatus: 'terminated' }] }), 'read_only');
  assert.equal(resolveConversationLifecycle({ ...base, retentionExpired: true }), 'closed');
});

test('delivered access deadline and branch membership drive lifecycle without message logic', () => {
  const delivered = { requester_id: 'requester-a', currentBranchId: 'branch-a', assignedDistributorUid: 'distributor-a', assignmentVersion: 2, status: 'delivered' };
  const now = Date.parse('2026-01-01T00:00:00Z');
  const base = { type: 'requester_distributor', order: delivered, requesterUid: 'requester-a', distributorUid: 'distributor-a', distributorBranchId: 'branch-a', assignmentVersion: 2, now, accounts: [{ accountStatus: 'active' }], branches: [{ id: 'branch-a', status: 'active' }] };
  assert.equal(resolveConversationLifecycle({ ...base, accessEndsAt: new Date(now + 1000) }), 'active');
  assert.equal(resolveConversationLifecycle({ ...base, accessEndsAt: new Date(now - 1000) }), 'read_only');

  const membership = { uid: 'distributor-a', role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch-a', branchMembershipVersion: 5 };
  assert.equal(resolveConversationLifecycle({ type: 'distributor_branch', distributor: membership, branchId: 'branch-a', branchMembershipVersion: 5, accounts: [membership], branches: [{ id: 'branch-a', status: 'active' }] }), 'active');
  assert.equal(resolveConversationLifecycle({ type: 'distributor_branch', distributor: membership, branchId: 'branch-a', branchMembershipVersion: 4, accounts: [membership], branches: [{ id: 'branch-a', status: 'active' }] }), 'read_only');
});
