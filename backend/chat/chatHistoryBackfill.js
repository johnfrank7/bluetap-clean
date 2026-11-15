const { authorityKeyHash } = require('./conversationService');
const { CONVERSATION_TYPES, normalizedStatus, orderAssignmentVersion, orderRequesterUid, owningBranchId } = require('./chatAuthorization');
const { historyId, historyRecord, timeOf } = require('./chatHistory');
const { publishChatActivity } = require('./chatActivity');

const clean = (value) => String(value || '').trim();

// Run in bounded pages after deployment to index older, still-readable delivered threads.
// This creates metadata only; it never changes orders, conversations, messages, or read rights.
async function backfillRecentChatHistory({ db, now = new Date(), cursor = '', limit = 50, apply = false } = {}) {
  const pageSize = Math.min(50, Math.max(1, Number(limit) || 50));
  let query = db.collection('requests').orderBy('__name__').limit(pageSize);
  if (cursor) {
    const previous = await db.collection('requests').doc(cursor).get();
    if (!previous.exists) throw new Error('Invalid history backfill cursor.');
    query = query.startAfter(previous);
  }
  const page = await query.get();
  let eligible = 0;
  let created = 0;
  for (const snapshot of page.docs || []) {
    const order = { id: snapshot.id, ...(snapshot.data() || {}) };
    if (!['delivered', 'completed'].includes(normalizedStatus(order.status))) continue;
    const readAccessEndsAt = order.chatAccessEndsAt || order.postOrderChatAccessEndsAt;
    if (timeOf(readAccessEndsAt) <= timeOf(now)) continue;
    const requesterUid = orderRequesterUid(order);
    const branchId = owningBranchId(order);
    const distributorUid = clean(order.assignedDistributorUid || order.distributor_id);
    let assignmentVersion = 0;
    try { assignmentVersion = orderAssignmentVersion(order); } catch { /* Invalid legacy assignment cannot be indexed. */ }
    const authorities = [
      requesterUid && branchId ? { type: CONVERSATION_TYPES.REQUESTER_BRANCH, requesterUid, branchId } : null,
      requesterUid && distributorUid && assignmentVersion > 0
        ? { type: CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR, orderId: order.id, requesterUid, distributorUid, assignmentVersion }
        : null,
    ].filter(Boolean);
    for (const authority of authorities) {
      const hash = authorityKeyHash(authority.type, authority);
      const registry = await db.collection('chatAuthorityRegistry').doc(hash).get();
      const conversationId = clean(registry.data()?.conversationId);
      if (!registry.exists || !conversationId) continue;
      const conversationSnapshot = await db.collection('chatConversations').doc(conversationId).get();
      if (!conversationSnapshot.exists) continue;
      const conversation = { id: conversationId, ...(conversationSnapshot.data() || {}) };
      if (conversation.type !== authority.type || conversation.authorityKeyHash !== hash) continue;
      const conversationDeadline = timeOf(conversation.readAccessEndsAt || conversation.accessEndsAt);
      if (conversation.status === 'closed' || (conversationDeadline && conversationDeadline <= timeOf(now))) continue;
      if (authority.type === CONVERSATION_TYPES.REQUESTER_BRANCH) {
        const messages = await db.collection('chatConversations').doc(conversationId).collection('messages')
          .where('orderId', '==', order.id).limit(1).get();
        if (!(messages.docs || []).length) continue;
      }
      const ref = db.collection('chatOrderHistory').doc(historyId(conversationId, order.id));
      if ((await ref.get()).exists) continue;
      eligible += 1;
      if (apply === true) {
        await db.runTransaction(async (tx) => {
          if ((await tx.get(ref)).exists) return;
          tx.create(ref, historyRecord(conversation, order, order.deliveredAt || order.delivered_at || now, readAccessEndsAt));
          publishChatActivity(tx, db, conversation, now);
          created += 1;
        });
      }
    }
  }
  const docs = page.docs || [];
  return { scanned: docs.length, eligible, created, nextCursor: docs.length === pageSize ? docs[docs.length - 1].id : null, dryRun: apply !== true };
}

module.exports = { backfillRecentChatHistory };
