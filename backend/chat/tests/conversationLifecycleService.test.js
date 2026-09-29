const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AUTHORITY_REASONS,
  addAuthorityReason,
  authorityKeyHash,
  buildConversationFoundation,
} = require('../conversationService');
const {
  POST_ORDER_FOLLOWUP_DAYS,
  isAccessExpired,
  postOrderAccessEndsAt,
  reconcileDistributorMembershipInTransaction,
  reconcileOrderLifecycleInTransaction,
} = require('../conversationLifecycleService');

function fixture() {
  const records = new Map();
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const collection = (name) => ({
    doc(id) {
      const path = `${name}/${id}`;
      return { id, path, get: async () => snapshot(path) };
    },
  });
  const db = { collection };
  const tx = {
    get: async (ref) => snapshot(ref.path),
    update(ref, update) { records.set(ref.path, { ...records.get(ref.path), ...update }); },
  };
  function seed(type, authority, authorityReasons = {}, id = `conversation-${records.size}`) {
    const foundation = buildConversationFoundation({ type, authority, authorityReasons, createdBy: { uid: 'system', role: 'manager' }, now: new Date('2026-09-30T00:00:00Z') });
    const hash = authorityKeyHash(type, authority);
    records.set(`chatAuthorityRegistry/${hash}`, { authorityKeyHash: hash, conversationId: id, type });
    records.set(`chatConversations/${id}`, foundation);
    return id;
  }
  return { records, db, tx, seed };
}

const baseOrder = (extra = {}) => ({
  id: 'order-a',
  requestId: 'BT-2026-A',
  requester_id: 'requester-a',
  branchId: 'branch-a',
  currentBranchId: 'branch-a',
  branchNameSnapshot: 'Branch A',
  assignmentVersion: 1,
  status: 'awaiting_distributor_assignment',
  items: [{ productNameSnapshot: 'Refill', quantity: 2 }],
  totalAtOrder: 70,
  ...extra,
});

test('assignment makes only the new epoch eligible and never creates or reuses an old thread', async () => {
  const f = fixture();
  const oldAuthority = { orderId: 'order-a', requesterUid: 'requester-a', distributorUid: 'distributor-a', assignmentVersion: 2 };
  const oldId = f.seed('requester_distributor', { ...oldAuthority, branchId: 'branch-a' }, {}, 'old-assignment');
  const before = baseOrder({ assignedDistributorUid: 'distributor-a', assignmentVersion: 2, status: 'distributor_assigned' });
  const after = baseOrder({ assignedDistributorUid: 'distributor-b', assignmentVersion: 3, status: 'distributor_assigned' });

  const result = await reconcileOrderLifecycleInTransaction({ tx: f.tx, db: f.db, before, after, event: 'DISTRIBUTOR_REASSIGNED', now: new Date('2026-09-30T01:00:00Z') });
  assert.equal(result.assignmentChanged, true);
  assert.equal(f.records.get(`chatConversations/${oldId}`).status, 'read_only');
  assert.equal(f.records.get(`chatConversations/${oldId}`).participantUserAccess['distributor-a'], 'read_only');
  assert.equal([...f.records.keys()].filter((path) => path.startsWith('chatConversations/')).length, 1);
  assert.notEqual(authorityKeyHash('requester_distributor', oldAuthority), authorityKeyHash('requester_distributor', { ...oldAuthority, distributorUid: 'distributor-b', assignmentVersion: 3 }));
});

test('Distributor decline immediately disables the old assignment conversation and retry is idempotent', async () => {
  const f = fixture();
  const authority = { orderId: 'order-a', requesterUid: 'requester-a', distributorUid: 'distributor-a', assignmentVersion: 2, branchId: 'branch-a' };
  const id = f.seed('requester_distributor', authority, {}, 'declined-assignment');
  const before = baseOrder({ assignedDistributorUid: 'distributor-a', assignmentVersion: 2, status: 'accepted' });
  const after = baseOrder({ assignedDistributorUid: null, assignmentVersion: 3, status: 'awaiting_distributor_assignment' });
  const now = new Date('2026-09-30T02:00:00Z');

  await reconcileOrderLifecycleInTransaction({ tx: f.tx, db: f.db, before, after, event: 'ASSIGNMENT_DECLINED', now });
  await reconcileOrderLifecycleInTransaction({ tx: f.tx, db: f.db, before, after, event: 'ASSIGNMENT_DECLINED', now });
  const conversation = f.records.get(`chatConversations/${id}`);
  assert.equal(conversation.status, 'read_only');
  assert.equal(conversation.lifecycleReason, 'ASSIGNMENT_DECLINED');
  assert.equal(conversation.accessEndsAt.getTime(), now.getTime());
  assert.equal([...f.records.keys()].filter((path) => path.startsWith('chatConversations/')).length, 1);
});

test('delivery persists one seven-calendar-day follow-up deadline and sanitized closure context', async () => {
  const f = fixture();
  const directAuthority = { orderId: 'order-a', requesterUid: 'requester-a', distributorUid: 'distributor-a', assignmentVersion: 2, branchId: 'branch-a' };
  const directId = f.seed('requester_distributor', directAuthority, {}, 'delivered-direct');
  const branchAuthority = { requesterUid: 'requester-a', branchId: 'branch-a' };
  const activeOrderReason = addAuthorityReason({}, AUTHORITY_REASONS.ACTIVE_ORDER, { orderId: 'order-a', grantedAt: new Date('2026-09-29T00:00:00Z') });
  const branchId = f.seed('requester_branch', branchAuthority, activeOrderReason, 'delivered-branch');
  const deliveredAt = new Date('2026-09-30T03:00:00Z');
  const accessEndsAt = postOrderAccessEndsAt(deliveredAt);
  const before = baseOrder({ assignedDistributorUid: 'distributor-a', assignmentVersion: 2, status: 'out_for_delivery' });
  const after = baseOrder({ assignedDistributorUid: 'distributor-a', assignmentVersion: 2, status: 'delivered', deliveredAt, chatAccessEndsAt: accessEndsAt, deliveryLocation: { latitude: 10.2, longitude: 123.5 } });

  await reconcileOrderLifecycleInTransaction({ tx: f.tx, db: f.db, before, after, event: 'DELIVERY_COMPLETED', now: deliveredAt });
  const direct = f.records.get(`chatConversations/${directId}`);
  const branch = f.records.get(`chatConversations/${branchId}`);
  assert.equal(POST_ORDER_FOLLOWUP_DAYS, 7);
  assert.equal(direct.status, 'active');
  assert.equal(direct.accessEndsAt.getTime(), deliveredAt.getTime() + (7 * 24 * 60 * 60 * 1000));
  assert.equal(isAccessExpired(direct.accessEndsAt, new Date(direct.accessEndsAt.getTime() - 1)), false);
  assert.equal(isAccessExpired(direct.accessEndsAt, direct.accessEndsAt), true);
  assert.equal('deliveryLocation' in direct.orderContext, false);
  assert.equal(branch.authorityReasons.active_order, undefined);
  assert.deepEqual(branch.authorityReasons.post_order_followup.orderIds, ['order-a']);
  assert.equal(branch.status, 'active');
});

test('cancellation ends Distributor sends while an independent requester inquiry survives', async () => {
  const f = fixture();
  const directAuthority = { orderId: 'order-a', requesterUid: 'requester-a', distributorUid: 'distributor-a', assignmentVersion: 2, branchId: 'branch-a' };
  const directId = f.seed('requester_distributor', directAuthority, {}, 'cancelled-direct');
  let reasons = addAuthorityReason({}, AUTHORITY_REASONS.REQUESTER_INQUIRY, { grantedAt: new Date('2026-09-01T00:00:00Z') });
  reasons = addAuthorityReason(reasons, AUTHORITY_REASONS.ACTIVE_ORDER, { orderId: 'order-a', grantedAt: new Date('2026-09-29T00:00:00Z') });
  const branchId = f.seed('requester_branch', { requesterUid: 'requester-a', branchId: 'branch-a' }, reasons, 'cancelled-branch');
  const before = baseOrder({ assignedDistributorUid: 'distributor-a', assignmentVersion: 2, status: 'accepted' });
  const after = { ...before, status: 'cancelled' };

  await reconcileOrderLifecycleInTransaction({ tx: f.tx, db: f.db, before, after, event: 'ORDER_CANCELLED', now: new Date('2026-09-30T04:00:00Z') });
  assert.equal(f.records.get(`chatConversations/${directId}`).status, 'read_only');
  const branch = f.records.get(`chatConversations/${branchId}`);
  assert.equal(branch.status, 'active');
  assert.equal(branch.authorityReasons.active_order, undefined);
  assert.equal(branch.authorityReasons.requester_inquiry.active, true);
});

test('transfer request invalidates the assignment, acceptance moves active-order authority, and decline grants nothing', async () => {
  const f = fixture();
  const directId = f.seed('requester_distributor', { orderId: 'order-a', requesterUid: 'requester-a', distributorUid: 'distributor-a', assignmentVersion: 2, branchId: 'branch-a' }, {}, 'transfer-direct');
  let sourceReasons = addAuthorityReason({}, AUTHORITY_REASONS.REQUESTER_INQUIRY, { grantedAt: new Date('2026-09-01T00:00:00Z') });
  sourceReasons = addAuthorityReason(sourceReasons, AUTHORITY_REASONS.ACTIVE_ORDER, { orderId: 'order-a', grantedAt: new Date('2026-09-29T00:00:00Z') });
  const sourceId = f.seed('requester_branch', { requesterUid: 'requester-a', branchId: 'branch-a' }, sourceReasons, 'transfer-source');
  const targetId = f.seed('requester_branch', { requesterUid: 'requester-a', branchId: 'branch-b' }, {}, 'transfer-target');
  const source = baseOrder({ assignedDistributorUid: 'distributor-a', assignmentVersion: 2, status: 'distributor_assigned' });
  const pending = { ...source, assignedDistributorUid: null, assignmentVersion: 3, status: 'branch_transfer_pending', transferToBranchId: 'branch-b' };
  const requestedAt = new Date('2026-09-30T05:00:00Z');
  await reconcileOrderLifecycleInTransaction({ tx: f.tx, db: f.db, before: source, after: pending, event: 'BRANCH_TRANSFER_REQUESTED', now: requestedAt });
  assert.equal(f.records.get(`chatConversations/${directId}`).status, 'read_only');
  assert.equal(f.records.get(`chatConversations/${sourceId}`).status, 'active');
  assert.deepEqual(f.records.get(`chatConversations/${targetId}`).authorityReasons, {});

  const accepted = { ...pending, branchId: 'branch-b', currentBranchId: 'branch-b', status: 'awaiting_distributor_assignment' };
  await reconcileOrderLifecycleInTransaction({ tx: f.tx, db: f.db, before: pending, after: accepted, event: 'BRANCH_TRANSFER_ACCEPTED', now: new Date('2026-09-30T06:00:00Z') });
  const sourceConversation = f.records.get(`chatConversations/${sourceId}`);
  assert.equal(sourceConversation.status, 'active');
  assert.equal(sourceConversation.authorityReasons.active_order, undefined);
  assert.equal(sourceConversation.authorityReasons.requester_inquiry.active, true);
  assert.deepEqual(f.records.get(`chatConversations/${targetId}`).authorityReasons.active_order.orderIds, ['order-a']);

  const beforeDecline = { ...pending };
  const afterDecline = { ...pending, status: 'awaiting_distributor_assignment' };
  const decline = await reconcileOrderLifecycleInTransaction({ tx: f.tx, db: f.db, before: beforeDecline, after: afterDecline, event: 'BRANCH_TRANSFER_DECLINED', now: new Date('2026-09-30T07:00:00Z') });
  assert.equal(decline.branchChanged, false);
  assert.equal(decline.transitions.length, 0);
});

test('branch membership changes close the old Distributor-Branch epoch while same-branch edits do nothing', async () => {
  const f = fixture();
  const id = f.seed('distributor_branch', { distributorUid: 'distributor-a', branchId: 'branch-a', branchMembershipVersion: 3 }, {}, 'membership-old');
  const before = { uid: 'distributor-a', role: 'distributor', branchId: 'branch-a', branchMembershipVersion: 3, phone: 'old' };
  const sameBranch = { ...before, phone: 'new' };
  const unchanged = await reconcileDistributorMembershipInTransaction({ tx: f.tx, db: f.db, distributorUid: 'distributor-a', before, after: sameBranch });
  assert.equal(unchanged.changed, false);
  assert.equal(f.records.get(`chatConversations/${id}`).status, 'active');

  const moved = { ...sameBranch, branchId: 'branch-b', branchMembershipVersion: 4 };
  const changed = await reconcileDistributorMembershipInTransaction({ tx: f.tx, db: f.db, distributorUid: 'distributor-a', before, after: moved, now: new Date('2026-09-30T08:00:00Z') });
  const conversation = f.records.get(`chatConversations/${id}`);
  assert.equal(changed.reconciled, 1);
  assert.equal(conversation.status, 'closed');
  assert.equal(conversation.participantUserAccess['distributor-a'], 'closed');
  assert.equal(conversation.participantBranchAccess['branch-a'], 'closed');
});
