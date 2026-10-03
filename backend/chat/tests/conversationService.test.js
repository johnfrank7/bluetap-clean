const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AUTHORITY_REASONS,
  addAuthorityReason,
  authorityKeyHash,
  buildConversationFoundation,
  canonicalAuthorityTuple,
  createOpaqueConversationId,
  reconcileOrderAuthorityTransition,
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
  const membership = { distributorUid: 'distributor-a', branchId: 'branch-a' };
  assert.notEqual(authorityKeyHash('distributor_branch', { ...membership, branchMembershipVersion: 1 }), authorityKeyHash('distributor_branch', { ...membership, branchMembershipVersion: 2 }));
});

test('conversation foundations contain only type-appropriate server-derived identity', () => {
  const conversation = buildConversationFoundation({
    type: 'requester_distributor',
    authority: { orderId: 'order-a', requesterUid: 'requester-a', distributorUid: 'distributor-a', assignmentVersion: 2, branchId: 'branch-a' },
    createdBy: { uid: 'requester-a', role: 'requester' },
    now: new Date('2026-01-01T00:00:00Z'),
  });
  assert.deepEqual(conversation.participantUserUids, ['requester-a', 'distributor-a']);
  assert.equal(conversation.assignmentVersion, 2);
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

test('Requester-Branch order authority metadata stays bounded', () => {
  let reasons = {};
  for (let index = 1; index <= 25; index += 1) {
    reasons = addAuthorityReason(reasons, AUTHORITY_REASONS.ACTIVE_ORDER, { orderId: `order-${index}` });
  }
  assert.equal(reasons.active_order.orderIds.length, 20);
  assert.deepEqual(reasons.active_order.orderIds.slice(0, 2), ['order-6', 'order-7']);
  assert.equal(reasons.active_order.orderIds.at(-1), 'order-25');
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

test('delivered closes sends immediately while failed delivery uses the trusted one-hour deadline', () => {
  const delivered = { requester_id: 'requester-a', currentBranchId: 'branch-a', assignedDistributorUid: 'distributor-a', assignmentVersion: 2, status: 'delivered' };
  const now = Date.parse('2026-01-01T00:00:00Z');
  const base = { type: 'requester_distributor', order: delivered, requesterUid: 'requester-a', distributorUid: 'distributor-a', distributorBranchId: 'branch-a', assignmentVersion: 2, now, accounts: [{ accountStatus: 'active' }], branches: [{ id: 'branch-a', status: 'active' }] };
  assert.equal(resolveConversationLifecycle({ ...base, accessEndsAt: new Date(now + 1000) }), 'read_only');
  assert.equal(resolveConversationLifecycle({ ...base, accessEndsAt: new Date(now - 1000) }), 'read_only');
  const failed = { ...delivered, status: 'delivery_failed', deliveryFailedAt: new Date(now), distributorChatGraceUntil: new Date(now + 60 * 60 * 1000) };
  assert.equal(resolveConversationLifecycle({ ...base, order: failed, now: now + (30 * 60 * 1000) }), 'active');
  assert.equal(resolveConversationLifecycle({ ...base, order: failed, now: now + (60 * 60 * 1000) }), 'read_only');

  const membership = { uid: 'distributor-a', role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch-a', branchMembershipVersion: 5 };
  assert.equal(resolveConversationLifecycle({ type: 'distributor_branch', distributor: membership, branchId: 'branch-a', branchMembershipVersion: 5, accounts: [membership], branches: [{ id: 'branch-a', status: 'active' }] }), 'active');
  assert.equal(resolveConversationLifecycle({ type: 'distributor_branch', distributor: membership, branchId: 'branch-a', branchMembershipVersion: 4, accounts: [membership], branches: [{ id: 'branch-a', status: 'active' }] }), 'read_only');
});

test('reconciliation makes old assignment epochs read-only and new epochs eligible', () => {
  const before = { id: 'order-a', requester_id: 'requester-a', currentBranchId: 'branch-a', assignedDistributorUid: 'distributor-a', assignmentVersion: 2, status: 'distributor_assigned' };
  const after = { ...before, assignedDistributorUid: 'distributor-b', assignmentVersion: 3 };
  const result = reconcileOrderAuthorityTransition({ before, after, event: 'DISTRIBUTOR_REASSIGNED' });
  assert.equal(result.assignmentChanged, true);
  assert.deepEqual(result.transitions.filter((item) => item.authority.type === 'requester_distributor').map((item) => [item.action, item.authority.distributorUid, item.authority.assignmentVersion]), [
    ['read_only', 'distributor-a', 2],
    ['eligible', 'distributor-b', 3],
  ]);
});

test('transfer reconciliation retains source authority until acceptance and never grants the target early', () => {
  const source = { id: 'order-a', requester_id: 'requester-a', currentBranchId: 'branch-a', branchId: 'branch-a', assignedDistributorUid: 'distributor-a', assignmentVersion: 2, status: 'distributor_assigned' };
  const pending = { ...source, assignedDistributorUid: null, assignmentVersion: 3, status: 'branch_transfer_pending', transferToBranchId: 'branch-b' };
  const requested = reconcileOrderAuthorityTransition({ before: source, after: pending, event: 'BRANCH_TRANSFER_REQUESTED' });
  assert.equal(requested.sourceBranchRetained, true);
  assert.equal(requested.targetBranchEligible, false);
  assert.equal(requested.transitions.some((item) => item.authority?.branchId === 'branch-b'), false);
  assert.ok(requested.transitions.some((item) => item.action === 'read_only' && item.authority?.assignmentVersion === 2));

  const accepted = { ...pending, currentBranchId: 'branch-b', branchId: 'branch-b', status: 'awaiting_distributor_assignment' };
  const acceptance = reconcileOrderAuthorityTransition({ before: pending, after: accepted, event: 'BRANCH_TRANSFER_ACCEPTED' });
  assert.equal(acceptance.sourceBranchRetained, false);
  assert.equal(acceptance.targetBranchEligible, true);
  assert.ok(acceptance.transitions.some((item) => item.action === 'remove_authority_reason' && item.authority.branchId === 'branch-a'));
  assert.ok(acceptance.transitions.some((item) => item.action === 'add_authority_reason' && item.authority.branchId === 'branch-b'));

  const declined = reconcileOrderAuthorityTransition({ before: pending, after: { ...pending, status: 'awaiting_distributor_assignment' }, event: 'BRANCH_TRANSFER_DECLINED' });
  assert.equal(declined.outcome, 'no_authority_change');
  assert.equal(declined.sourceBranchRetained, true);
});

test('terminal reconciliation prepares read-only or bounded post-order follow-up without persistence', () => {
  const before = { id: 'order-a', requester_id: 'requester-a', currentBranchId: 'branch-a', assignedDistributorUid: 'distributor-a', assignmentVersion: 2, status: 'out_for_delivery' };
  const cancelled = reconcileOrderAuthorityTransition({ before, after: { ...before, status: 'cancelled' }, event: 'ORDER_CANCELLED' });
  assert.ok(cancelled.transitions.some((item) => item.action === 'read_only' && item.authority.type === 'requester_distributor'));
  assert.ok(cancelled.transitions.some((item) => item.action === 'remove_authority_reason' && item.authorityReason === 'active_order'));

  const now = Date.parse('2026-01-01T00:00:00Z');
  const accessEndsAt = new Date(now + 60_000);
  const delivered = reconcileOrderAuthorityTransition({ before, after: { ...before, status: 'delivered' }, event: 'ORDER_DELIVERED', now, accessEndsAt });
  assert.ok(delivered.transitions.some((item) => item.action === 'read_only' && item.authority.type === 'requester_distributor' && item.accessEndsAt === accessEndsAt));
  assert.ok(delivered.transitions.some((item) => item.action === 'add_authority_reason' && item.authorityReason === 'post_order_followup' && item.accessEndsAt === accessEndsAt));

  const graceUntil = new Date(now + (60 * 60 * 1000));
  const failed = reconcileOrderAuthorityTransition({ before, after: { ...before, status: 'delivery_failed', deliveryFailedAt: new Date(now), distributorChatGraceUntil: graceUntil }, event: 'DELIVERY_FAILED', now, accessEndsAt: graceUntil });
  assert.ok(failed.transitions.some((item) => item.action === 'eligible' && item.reason === 'delivery_failed_grace' && item.accessEndsAt === graceUntil));
});
