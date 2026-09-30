const { OtpError } = require('../utils/otpError');
const { publishChatActivity } = require('./chatActivity');
const { getBranchMembershipVersion } = require('../utils/relationshipEpochs');
const {
  CONVERSATION_TYPES,
  normalizedStatus,
  orderRequesterUid,
  owningBranchId,
} = require('./chatAuthorization');
const {
  AUTHORITY_REASONS,
  CONVERSATION_STATUS,
  addAuthorityReason,
  authorityKeyHash,
  hasActiveAuthorityReason,
  normalizeAuthorityReasons,
  removeAuthorityReason,
  reconcileOrderAuthorityTransition,
} = require('./conversationService');

const POST_ORDER_FOLLOWUP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const clean = (value) => String(value || '').trim();
const timeOf = (value) => value?.toMillis?.() || value?.getTime?.() || Number(value?.seconds || 0) * 1000 || new Date(value || 0).getTime() || 0;

function isAccessExpired(accessEndsAt, now = Date.now()) {
  const deadline = timeOf(accessEndsAt);
  return deadline > 0 && deadline <= timeOf(now);
}

function postOrderAccessEndsAt(deliveredAt) {
  const deliveredTime = timeOf(deliveredAt);
  if (!deliveredTime) throw new OtpError(409, 'CHAT_DELIVERY_TIME_REQUIRED', 'A trusted delivery time is required for chat follow-up.');
  return new Date(deliveredTime + (POST_ORDER_FOLLOWUP_DAYS * DAY_MS));
}

function participantAccessProjection(conversation = {}, accessState = 'active') {
  const participantState = (Array.isArray(conversation.participantState) ? conversation.participantState : []).map((state) => ({
    ...state,
    accessState,
  }));
  const participantUserAccess = Object.fromEntries((conversation.participantUserUids || []).map((uid) => [clean(uid), accessState]).filter(([uid]) => uid));
  const participantBranchAccess = Object.fromEntries((conversation.participantBranchIds || []).map((branchId) => [clean(branchId), accessState]).filter(([branchId]) => branchId));
  return { participantState, participantUserAccess, participantBranchAccess };
}

function orderIdOf(order = {}) {
  return clean(order.id || order.orderId || order.requestId || order.request_id);
}

function authorityIsComplete(type, authority = {}) {
  if (type === CONVERSATION_TYPES.REQUESTER_BRANCH) return Boolean(clean(authority.requesterUid) && clean(authority.branchId));
  if (type === CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR) {
    return Boolean(clean(authority.orderId) && clean(authority.requesterUid) && clean(authority.distributorUid)
      && Number.isSafeInteger(authority.assignmentVersion) && authority.assignmentVersion > 0);
  }
  if (type === CONVERSATION_TYPES.DISTRIBUTOR_BRANCH) {
    return Boolean(clean(authority.distributorUid) && clean(authority.branchId)
      && Number.isSafeInteger(authority.branchMembershipVersion) && authority.branchMembershipVersion > 0);
  }
  return true;
}

function terminalOrderContext(order = {}) {
  const status = normalizedStatus(order.status);
  if (!['delivered', 'completed', 'cancelled', 'canceled', 'rejected', 'declined', 'declined_outside_service_area'].includes(status)) return null;
  const productSummary = Array.isArray(order.items)
    ? order.items.slice(0, 20).map((item) => ({
      name: clean(item.productNameSnapshot || item.product_name || item.name).slice(0, 160),
      quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0,
    }))
    : [];
  return {
    orderId: orderIdOf(order),
    publicOrderReference: clean(order.requestId || order.request_id).slice(0, 80),
    productSummary,
    finalStatus: status,
    branchDisplayName: clean(order.currentBranchNameSnapshot || order.branchNameSnapshot || order.water_station).slice(0, 160),
    deliveryDate: order.deliveredAt || order.delivered_at || null,
    totalSnapshot: Number.isFinite(Number(order.totalAtOrder ?? order.total_cost)) ? Number(order.totalAtOrder ?? order.total_cost) : null,
  };
}

async function loadExistingConversation(tx, db, type, authority) {
  const hash = authorityKeyHash(type, authority);
  const registryRef = db.collection('chatAuthorityRegistry').doc(hash);
  const registrySnapshot = await tx.get(registryRef);
  if (!registrySnapshot.exists) return null;
  const conversationId = clean(registrySnapshot.data()?.conversationId);
  if (!conversationId) throw new OtpError(409, 'CHAT_STATE_INVALID', 'Conversation authority registry is invalid.');
  const ref = db.collection('chatConversations').doc(conversationId);
  const snapshot = await tx.get(ref);
  if (!snapshot.exists) throw new OtpError(409, 'CHAT_STATE_INVALID', 'Conversation authority registry points to a missing conversation.');
  const conversation = { id: conversationId, ...(snapshot.data() || {}) };
  if (conversation.authorityKeyHash !== hash || conversation.type !== type) {
    throw new OtpError(409, 'CHAT_STATE_INVALID', 'Conversation authority does not match its registry.');
  }
  return { hash, ref, conversation };
}

function reasonDeadline(authorityReasons, now) {
  const reasons = Object.values(normalizeAuthorityReasons(authorityReasons));
  if (reasons.some((reason) => reason.active === true && !reason.accessEndsAt)) return null;
  const deadlines = reasons.map((reason) => timeOf(reason.accessEndsAt)).filter((deadline) => deadline > timeOf(now));
  return deadlines.length ? new Date(Math.max(...deadlines)) : now;
}

function applyTransition(conversation, transition, after, now) {
  const reason = clean(transition.reason || transition.authorityReason || 'relationship_changed');
  if (transition.action === 'read_only') {
    return {
      ...conversation,
      status: CONVERSATION_STATUS.READ_ONLY,
      accessEndsAt: now,
      readAccessEndsAt: now,
      lifecycleReason: reason,
      ...participantAccessProjection(conversation, 'read_only'),
      updatedAt: now,
    };
  }
  if (transition.action === 'eligible') {
    const accessEndsAt = transition.accessEndsAt || null;
    return {
      ...conversation,
      status: CONVERSATION_STATUS.ACTIVE,
      accessEndsAt,
      readAccessEndsAt: accessEndsAt,
      lifecycleReason: reason,
      closedAt: null,
      closedReason: null,
      ...(terminalOrderContext(after) ? { orderContext: terminalOrderContext(after) } : {}),
      ...participantAccessProjection(conversation, 'active'),
      updatedAt: now,
    };
  }
  let authorityReasons = conversation.authorityReasons;
  if (transition.action === 'add_authority_reason') {
    authorityReasons = addAuthorityReason(authorityReasons, transition.authorityReason, {
      orderId: transition.orderId,
      grantedAt: now,
      accessEndsAt: transition.accessEndsAt || null,
    });
  } else if (transition.action === 'remove_authority_reason') {
    authorityReasons = removeAuthorityReason(authorityReasons, transition.authorityReason, { orderId: transition.orderId });
  } else {
    return conversation;
  }
  const active = hasActiveAuthorityReason(authorityReasons, timeOf(now));
  const accessEndsAt = active ? reasonDeadline(authorityReasons, now) : now;
  return {
    ...conversation,
    authorityReasons,
    status: active ? CONVERSATION_STATUS.ACTIVE : CONVERSATION_STATUS.READ_ONLY,
    accessEndsAt,
    readAccessEndsAt: accessEndsAt,
    lifecycleReason: reason,
    ...participantAccessProjection(conversation, active ? 'active' : 'read_only'),
    updatedAt: now,
  };
}

async function reconcileOrderLifecycleInTransaction({ tx, db, before = {}, after = {}, event, now = new Date() }) {
  if (!tx || !db) throw new OtpError(500, 'CHAT_RECONCILIATION_REQUIRED', 'Chat lifecycle reconciliation requires a transaction.');
  const timestamp = now instanceof Date ? now : new Date(timeOf(now));
  const afterStatus = normalizedStatus(after.status);
  const accessEndsAt = ['delivered', 'completed'].includes(afterStatus)
    ? (after.chatAccessEndsAt || after.postOrderChatAccessEndsAt || postOrderAccessEndsAt(after.deliveredAt || after.delivered_at || timestamp))
    : null;
  const plan = reconcileOrderAuthorityTransition({ before, after, event, accessEndsAt, now: timeOf(timestamp) });
  const loaded = new Map();
  for (const transition of plan.transitions) {
    const type = transition.authority?.type;
    if (!type || !authorityIsComplete(type, transition.authority)) continue;
    const hash = authorityKeyHash(type, transition.authority);
    if (!loaded.has(hash)) loaded.set(hash, await loadExistingConversation(tx, db, type, transition.authority));
  }
  let reconciled = 0;
  for (const transition of plan.transitions) {
    const type = transition.authority?.type;
    if (!type || !authorityIsComplete(type, transition.authority)) continue;
    const hash = authorityKeyHash(type, transition.authority);
    const entry = loaded.get(hash);
    if (!entry) continue;
    entry.conversation = applyTransition(entry.conversation, transition, after, timestamp);
    entry.changed = true;
  }
  for (const entry of loaded.values()) {
    if (!entry?.changed) continue;
    const { id: _id, ...update } = entry.conversation;
    tx.update(entry.ref, update);
    publishChatActivity(tx, db, update, timestamp);
    reconciled += 1;
  }
  return { ...plan, accessEndsAt, reconciled };
}

async function reconcileDistributorMembershipInTransaction({ tx, db, distributorUid, before = {}, after = {}, now = new Date(), reason = 'branch_membership_changed' }) {
  const beforeBranchId = clean(before.branchId);
  const afterBranchId = clean(after.branchId);
  const beforeVersion = getBranchMembershipVersion(before);
  const afterVersion = getBranchMembershipVersion(after);
  if (beforeBranchId === afterBranchId && beforeVersion === afterVersion) return { changed: false, reconciled: 0 };
  if (!beforeBranchId || clean(before.role).toLowerCase() !== 'distributor') return { changed: true, reconciled: 0 };
  const authority = {
    distributorUid: clean(distributorUid || before.uid || before.id),
    branchId: beforeBranchId,
    branchMembershipVersion: beforeVersion,
  };
  const entry = await loadExistingConversation(tx, db, CONVERSATION_TYPES.DISTRIBUTOR_BRANCH, authority);
  if (!entry) return { changed: true, reconciled: 0 };
  const timestamp = now instanceof Date ? now : new Date(timeOf(now));
  const conversation = {
    ...entry.conversation,
    status: CONVERSATION_STATUS.CLOSED,
    accessEndsAt: timestamp,
    readAccessEndsAt: timestamp,
    closedAt: timestamp,
    closedReason: clean(reason),
    lifecycleReason: clean(reason),
    ...participantAccessProjection(entry.conversation, 'closed'),
    updatedAt: timestamp,
  };
  const { id: _id, ...update } = conversation;
  tx.update(entry.ref, update);
  publishChatActivity(tx, db, update, timestamp);
  return { changed: true, reconciled: 1 };
}

module.exports = {
  POST_ORDER_FOLLOWUP_DAYS,
  isAccessExpired,
  participantAccessProjection,
  postOrderAccessEndsAt,
  reconcileDistributorMembershipInTransaction,
  reconcileOrderLifecycleInTransaction,
  terminalOrderContext,
};
