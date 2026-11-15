const { createHash } = require('node:crypto');

const clean = (value) => String(value || '').trim();
const timeOf = (value) => value?.toMillis?.() || value?.getTime?.()
  || Number(value?.seconds || value?._seconds || 0) * 1000
  || new Date(value || 0).getTime() || 0;

function historyId(conversationId, orderId) {
  return createHash('sha256').update(JSON.stringify([clean(conversationId), clean(orderId)])).digest('hex');
}

function delivered(status) {
  return ['delivered', 'completed'].includes(clean(status).toLowerCase().replace(/[\s-]+/g, '_'));
}

function historyRecord(conversation, order, archivedAt, readAccessEndsAt) {
  const orderId = clean(order.id || order.orderId || order.requestId || order.request_id);
  return {
    conversationId: conversation.id,
    orderId,
    type: conversation.type,
    participantUserUids: conversation.participantUserUids || [],
    participantBranchIds: conversation.participantBranchIds || [],
    archivedAt,
    readAccessEndsAt,
    orderReference: clean(order.requestId || order.request_id || order.publicOrderReference).slice(0, 80),
    assignmentVersion: conversation.assignmentVersion || null,
  };
}

function historyIsReadable(history, order, now) {
  const currentDeadline = order?.chatAccessEndsAt || order?.postOrderChatAccessEndsAt;
  return Boolean(history && delivered(order?.status)
    && clean(history.orderId) === clean(order.id || order.orderId || order.requestId || order.request_id)
    && timeOf(history.readAccessEndsAt) > timeOf(now)
    && (!currentDeadline || timeOf(currentDeadline) > timeOf(now)));
}

module.exports = { delivered, historyId, historyIsReadable, historyRecord, timeOf };
