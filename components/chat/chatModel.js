const clean = (value) => String(value || '').trim();

const timeOf = (value) => value?.toMillis?.()
  || value?.getTime?.()
  || Number(value?.seconds || 0) * 1000
  || Number(value?._seconds || 0) * 1000
  || new Date(value || 0).getTime()
  || 0;

function principalFor(role, uid, branchId) {
  return role === 'manager'
    ? { principalType: 'branch', principalId: clean(branchId) }
    : { principalType: 'user', principalId: clean(uid) };
}

function samePrincipal(left = {}, right = {}) {
  return clean(left.principalType) === clean(right.principalType)
    && clean(left.principalId) === clean(right.principalId);
}

function principalStateFor(conversation, role, uid, branchId) {
  const principal = principalFor(role, uid, branchId);
  return (conversation?.participantState || []).find((state) => samePrincipal(state, principal)) || null;
}

function unreadForConversation(conversation, role, uid, branchId) {
  return Math.max(0, Number(principalStateFor(conversation, role, uid, branchId)?.unreadCount || 0));
}

function totalUnread(conversations, role, uid, branchId) {
  return (conversations || []).reduce(
    (sum, conversation) => sum + unreadForConversation(conversation, role, uid, branchId),
    0
  );
}

function isOwnMessage(message, role, uid, branchId) {
  if (role === 'manager') {
    return clean(message?.senderPrincipalType) === 'branch'
      && clean(message?.senderBranchId) === clean(branchId);
  }
  return clean(message?.senderUid) === clean(uid);
}

function receiptFor(message, conversation, role, uid, branchId) {
  if (message?.pending) return 'pending';
  if (message?.failed) return 'failed';
  if (!Number.isSafeInteger(Number(message?.seq)) || !isOwnMessage(message, role, uid, branchId)) return '';
  const current = principalFor(role, uid, branchId);
  const recipients = (conversation?.participantState || []).filter(
    (state) => !samePrincipal(state, current) && state.accessState !== 'closed'
  );
  return recipients.length > 0 && recipients.every((state) => Number(state.lastReadSeq || 0) >= Number(message.seq))
    ? 'seen'
    : 'sent';
}

function messageKey(message = {}) {
  if (message.id) return `id:${message.id}`;
  return `mutation:${clean(message.senderUid || message.senderBranchId)}:${clean(message.clientMutationId)}`;
}

function mergeMessages(...groups) {
  const byId = new Map();
  const mutationKeys = new Map();
  groups.flat().filter(Boolean).forEach((message) => {
    const mutationKey = clean(message.clientMutationId)
      ? `${clean(message.senderUid || message.senderBranchId)}:${clean(message.clientMutationId)}`
      : '';
    if (mutationKey && mutationKeys.has(mutationKey)) {
      const previousKey = mutationKeys.get(mutationKey);
      const previous = byId.get(previousKey);
      if (message.id || !previous?.id) {
        byId.delete(previousKey);
        const nextKey = messageKey(message);
        byId.set(nextKey, { ...previous, ...message, pending: false, failed: false });
        mutationKeys.set(mutationKey, nextKey);
      }
      return;
    }
    const key = messageKey(message);
    byId.set(key, { ...(byId.get(key) || {}), ...message });
    if (mutationKey) mutationKeys.set(mutationKey, key);
  });
  return [...byId.values()].sort((left, right) => {
    const leftSeq = Number.isSafeInteger(Number(left.seq)) ? Number(left.seq) : Number.MAX_SAFE_INTEGER;
    const rightSeq = Number.isSafeInteger(Number(right.seq)) ? Number(right.seq) : Number.MAX_SAFE_INTEGER;
    return leftSeq - rightSeq || timeOf(left.createdAt) - timeOf(right.createdAt);
  });
}

function createClientMutationId(now = Date.now, random = Math.random) {
  return `msg_${now().toString(36)}_${Math.floor(random() * 0x100000000).toString(36)}`;
}

function formatBadge(count) {
  const value = Math.max(0, Number(count || 0));
  return value > 99 ? '99+' : String(value);
}

function conversationAvailability(conversation, role, uid, branchId, now = Date.now()) {
  const state = principalStateFor(conversation, role, uid, branchId);
  const deadline = timeOf(conversation?.accessEndsAt);
  const readable = Boolean(conversation && ['active', 'read_only'].includes(conversation.status)
    && ['active', 'read_only'].includes(state?.accessState)
    && (!deadline || deadline > now)
    && (conversation.status !== 'read_only' || deadline > now));
  return { readable, sendable: readable && conversation.status === 'active' && state.accessState === 'active' };
}

module.exports = {
  conversationAvailability,
  createClientMutationId,
  formatBadge,
  isOwnMessage,
  mergeMessages,
  principalFor,
  principalStateFor,
  receiptFor,
  timeOf,
  totalUnread,
  unreadForConversation,
};
