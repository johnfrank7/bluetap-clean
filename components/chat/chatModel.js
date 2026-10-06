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

function sendContextOrderId(conversation = {}) {
  const clean = (value) => String(value || '').trim();
  if (conversation.type === 'requester_distributor') return clean(conversation.orderId);
  if (conversation.type !== 'requester_branch') return '';
  const orderId = clean(conversation.orderContext?.id || conversation.orderContext?.orderId);
  if (!orderId) return '';
  const authorizedOrderIds = Object.values(conversation.authorityReasons || {})
    .flatMap((reason) => Array.isArray(reason?.orderIds) ? reason.orderIds : [])
    .map(clean);
  return authorizedOrderIds.includes(orderId) ? orderId : '';
}

function messageFailurePresentation(code) {
  if (['CHAT_READ_ONLY', 'CHAT_CLOSED', 'CHAT_STALE_ASSIGNMENT', 'CHAT_STALE_BRANCH_MEMBERSHIP'].includes(code)) {
    return { retryable: false, label: 'Messaging for this delivery has ended.' };
  }
  if (['CHAT_NOT_AUTHORIZED', 'CHAT_ACCOUNT_INACTIVE', 'CHAT_ACCOUNT_SUSPENDED', 'CHAT_ACCOUNT_TERMINATED', 'CHAT_MANAGER_INACTIVE'].includes(code)) {
    return { retryable: false, label: 'You no longer have access to this conversation.' };
  }
  return { retryable: true, label: 'Tap to retry' };
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

function conversationLifecycleNotice(conversation, now = Date.now()) {
  if (clean(conversation?.type) !== 'requester_distributor') return null;
  const order = conversation.orderContextLocal || conversation.orderContext || {};
  const status = clean(order.status || order.finalStatus).toLowerCase().replace(/[\s-]+/g, '_');
  if (['delivered', 'completed'].includes(status)) {
    return { state: 'closed', title: 'Delivery completed', body: 'Messaging for this delivery has ended.' };
  }
  if (status !== 'delivery_failed') return null;
  const deadline = timeOf(conversation.accessEndsAt || order.distributorChatGraceUntil);
  if (deadline > now) {
    const minutes = Math.max(1, Math.ceil((deadline - now) / 60000));
    return { state: 'grace', title: 'Delivery attempt failed', body: `Messaging remains available for ${minutes} more ${minutes === 1 ? 'minute' : 'minutes'}.`, minutes };
  }
  return { state: 'closed', title: 'Messaging window ended', body: 'Contact the station if you still need assistance.' };
}

function messageActionNames({ own = false, withinWindow = false, reportable = false, replyable = false } = {}) {
  if (replyable) {
    if (own) {
      return withinWindow ? ['Reply', 'Edit', 'Delete'] : ['Reply'];
    }
    return reportable ? ['Reply', 'Report'] : ['Reply'];
  }
  if (own) {
    return withinWindow ? ['Edit', 'Delete'] : [];
  }
  return reportable ? ['Report'] : [];
}

function messageActionTriggerVisible({ hovered = false, focused = false, menuOpen = false } = {}) {
  return Boolean(hovered || focused || menuOpen);
}

function orderIdOf(order) {
  if (!order || typeof order !== 'object') return '';
  const source = clean(order.sourceId);
  if (source && source !== 'Not set') return source;
  return clean(order.id || order.requestId || order.request_id || order.orderId);
}

function normalizeChatIntent(options = {}) {
  const type = clean(options.type);
  const order = options.order || null;
  const target = options.target || null;
  const orderId = orderIdOf(order) || clean(options.orderId);

  if (type === 'requester_branch') {
    if (orderId) {
      return {
        type: 'requester_branch',
        intent: clean(options.intent) || 'order_followup',
        orderId,
      };
    }
    const branchId = clean(options.branchId || target?.branchId || target?.id || target);
    return {
      type: 'requester_branch',
      intent: 'inquiry',
      branchId,
    };
  }

  if (type === 'requester_distributor') {
    return {
      type: 'requester_distributor',
      orderId,
    };
  }

  if (type === 'distributor_branch') {
    const distributorId = clean(options.distributorId || target?.distributorId || target?.uid || target?.id);
    return {
      type: 'distributor_branch',
      ...(distributorId ? { distributorId } : {}),
    };
  }

  if (type === 'branch_coordination') {
    const targetBranchId = clean(options.targetBranchId || target?.branchId || target?.id || target);
    return {
      type: 'branch_coordination',
      targetBranchId,
    };
  }

  return { ...options, ...(orderId ? { orderId } : {}) };
}

function mapResolveError(error) {
  const code = String(error?.code || error?.error || error?.message || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  if (code.includes('CHAT_BRANCH_REQUIRED') || message.includes('branch is required') || message.includes('no branch')) {
    return 'No water station is currently assigned to your account.';
  }
  if (code.includes('CHAT_RESTRICTED') || message.includes('restricted')) {
    return 'Chat is temporarily restricted for your account.';
  }
  if (
    code.includes('CHAT_BRANCH_MISMATCH') ||
    message.includes('another branch') ||
    message.includes('not available for this branch')
  ) {
    return 'This conversation is not available for this branch.';
  }
  if (code.includes('CHAT_NOT_AUTHORIZED') && (message.includes('unavailable') || message.includes('branch'))) {
    return 'Your water station is currently unavailable.';
  }
  if (
    code.includes('CHAT_STALE_ASSIGNMENT') ||
    code.includes('CHAT_ASSIGNMENT_NOT_WRITABLE') ||
    code.includes('CHAT_ASSIGNMENT_MISMATCH') ||
    code.includes('CHAT_ORDER_OWNER_MISMATCH') ||
    code.includes('CHAT_CONVERSATION_NOT_FOUND') ||
    code.includes('CHAT_READ_ONLY') ||
    code.includes('CHAT_CLOSED') ||
    message.includes('assignment has changed') ||
    message.includes('no longer available')
  ) {
    return 'This conversation is no longer available for this delivery.';
  }
  return 'Unable to open conversation. Please try again.';
}

module.exports = {
  conversationAvailability,
  conversationLifecycleNotice,
  createClientMutationId,
  formatBadge,
  isOwnMessage,
  mapResolveError,
  messageFailurePresentation,
  mergeMessages,
  messageActionNames,
  messageActionTriggerVisible,
  normalizeChatIntent,
  orderIdOf,
  principalFor,
  principalStateFor,
  receiptFor,
  sendContextOrderId,
  timeOf,
  totalUnread,
  unreadForConversation,
};
