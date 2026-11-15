const assert = require('node:assert/strict');
const test = require('node:test');
const { backfillRecentChatHistory } = require('../chatHistoryBackfill');
const { AUTHORITY_REASONS, addAuthorityReason, authorityKeyHash, buildConversationFoundation } = require('../conversationService');
const { historyId, historyIsReadable } = require('../chatHistory');

function fixture() {
  const now = new Date('2026-01-03T00:00:00Z');
  const order = { requester_id: 'requester-a', branchId: 'branch-a', currentBranchId: 'branch-a',
    assignedDistributorUid: 'distributor-a', assignmentVersion: 4, requestId: 'BT-ORDER-A',
    status: 'delivered', deliveredAt: new Date('2026-01-02T00:00:00Z'), chatAccessEndsAt: new Date('2026-01-09T00:00:00Z') };
  const records = new Map([['requests/order-a', order], ['chatConversations/branch-thread/messages/branch-message', { orderId: 'order-a', seq: 1 }]]);
  for (const [type, authority, id] of [
    ['requester_branch', { requesterUid: 'requester-a', branchId: 'branch-a' }, 'branch-thread'],
    ['requester_distributor', { orderId: 'order-a', requesterUid: 'requester-a', distributorUid: 'distributor-a', assignmentVersion: 4 }, 'direct-thread'],
  ]) {
    const hash = authorityKeyHash(type, authority);
    records.set(`chatAuthorityRegistry/${hash}`, { conversationId: id });
    const authorityReasons = type === 'requester_branch'
      ? addAuthorityReason({}, AUTHORITY_REASONS.POST_ORDER_FOLLOWUP, { orderId: 'order-a', grantedAt: now, accessEndsAt: order.chatAccessEndsAt }) : {};
    records.set(`chatConversations/${id}`, buildConversationFoundation({ type, authority: { ...authority, branchId: 'branch-a' }, authorityReasons, createdBy: { uid: 'requester-a', role: 'requester' }, now }));
  }
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const collection = (path) => ({
    doc: (id) => ({ path: `${path}/${id}`, id, get: async () => snapshot(`${path}/${id}`), collection: (child) => collection(`${path}/${id}/${child}`) }),
    orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [snapshot('requests/order-a')] }) }) }),
    where: (field, operator, value) => ({ limit: () => ({ get: async () => ({ docs: [...records.keys()]
      .filter((key) => key.startsWith(`${path}/`) && records.get(key)?.[field] === value).map(snapshot) }) }) }),
  });
  const db = { collection, runTransaction: async (run) => run({
    get: async (ref) => snapshot(ref.path),
    create: (ref, value) => { if (records.has(ref.path)) throw new Error('duplicate'); records.set(ref.path, value); },
    set: (ref, value) => records.set(ref.path, value),
  }) };
  return { db, records, now };
}

test('recent delivered history backfill previews, creates once, and leaves source conversations intact', async () => {
  const f = fixture();
  const preview = await backfillRecentChatHistory({ db: f.db, now: f.now });
  assert.deepEqual({ eligible: preview.eligible, created: preview.created, dryRun: preview.dryRun }, { eligible: 2, created: 0, dryRun: true });
  assert.equal(f.records.has(`chatOrderHistory/${historyId('branch-thread', 'order-a')}`), false);
  const applied = await backfillRecentChatHistory({ db: f.db, now: f.now, apply: true });
  assert.equal(applied.created, 2);
  assert.equal(f.records.get(`chatOrderHistory/${historyId('direct-thread', 'order-a')}`).assignmentVersion, 4);
  assert.equal(f.records.get(`chatOrderHistory/${historyId('branch-thread', 'order-a')}`).orderReference, 'BT-ORDER-A');
  assert.equal((await backfillRecentChatHistory({ db: f.db, now: f.now, apply: true })).created, 0);
  assert.equal(f.records.get('requests/order-a').status, 'delivered');
  assert.equal(f.records.has('chatConversations/branch-thread/messages/branch-message'), true);
});

test('history read expiry follows the earlier trusted order deadline', () => {
  const now = new Date('2026-01-03T00:00:00Z');
  const history = { orderId: 'order-a', readAccessEndsAt: new Date('2026-01-09T00:00:00Z') };
  const order = { id: 'order-a', status: 'delivered', chatAccessEndsAt: new Date('2026-01-04T00:00:00Z') };
  assert.equal(historyIsReadable(history, order, now), true);
  assert.equal(historyIsReadable(history, { ...order, chatAccessEndsAt: now }, now), false);
  assert.equal(historyIsReadable(history, { ...order, status: 'scheduled' }, now), false);
});
