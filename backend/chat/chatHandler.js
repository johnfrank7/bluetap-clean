const { randomUUID } = require('node:crypto');
const { publishChatActivity } = require('./chatActivity');
const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { canonicalAccountStatus } = require('../auth/accountStatus');
const { assertChatSendAllowed } = require('../moderation/moderationService');
const { verifiedIdentity } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { getAssignmentVersion, getBranchMembershipVersion } = require('../utils/relationshipEpochs');
const {
  CONVERSATION_TYPES,
  TERMINAL_ORDER_STATUSES,
  assertCanonicalConversationParticipants,
  authorizeBranchCoordination,
  authorizeDistributorBranch,
  authorizeRequesterBranch,
  authorizeRequesterDistributor,
  failedDeliveryChatEndsAt,
  normalizedStatus,
  orderRequesterUid,
  owningBranchId,
  requireActiveBranch,
  requireActiveDistributor,
  requireActiveManager,
  requireRole,
} = require('./chatAuthorization');
const {
  AUTHORITY_REASONS,
  CONVERSATION_STATUS,
  MAX_AUTHORITY_REASON_ORDER_IDS,
  addAuthorityReason,
  authorityKeyHash,
  buildConversationFoundation,
  createOpaqueConversationId,
  hasActiveAuthorityReason,
  normalizeAuthorityReasons,
} = require('./conversationService');
const { isAccessExpired, participantAccessProjection } = require('./conversationLifecycleService');
const {
  advanceParticipantReadState,
  applyMessageToParticipantState,
  assertMessageMutationWindow,
  consumeMessageRateLimit,
  messageBodyHash,
  messagePreview,
  mutationRegistryId,
  normalizeClientMutationId,
  normalizeMessageBody,
  normalizeMessagePage,
  principalKey,
  rateLimitDocumentId,
} = require('./chatMessageService');

const clean = (value, max = 256) => String(value || '').trim().slice(0, max);
const timeOf = (value) => value?.toMillis?.() || value?.getTime?.() || Number(value?.seconds || 0) * 1000 || new Date(value || 0).getTime() || 0;

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { throw new OtpError(400, 'INVALID_JSON', 'The request body must be valid JSON.'); }
}

function withId(snapshot) {
  return snapshot?.exists ? { id: snapshot.id, ...(snapshot.data() || {}) } : null;
}

function requiredId(value, reason, message) {
  const id = clean(value, 128);
  if (!id) throw new OtpError(400, reason, message);
  return id;
}

function requireNoClientAuthorityFields(body = {}) {
  const forbidden = [
    'participantUserUids', 'participantBranchIds', 'participants', 'participantUids', 'branchIds',
    'requesterUid', 'distributorUid', 'assignmentVersion', 'branchMembershipVersion', 'authorityKeyHash',
    'participantState', 'createdByUid', 'createdByRole', 'nextSequence', 'status',
  ];
  if (forbidden.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    throw new OtpError(400, 'CHAT_AUTHORITY_SERVER_OWNED', 'Conversation authority is resolved by BlueTap.');
  }
}

function requireNoClientSenderFields(body = {}) {
  const forbidden = ['senderUid', 'senderRole', 'senderPrincipalType', 'senderBranchId', 'principalId', 'principalType'];
  if (forbidden.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    throw new OtpError(400, 'CHAT_SENDER_SERVER_OWNED', 'Message sender authority is resolved by BlueTap.');
  }
}

function requireNoClientReadPrincipal(body = {}) {
  const forbidden = ['principalId', 'principalType', 'branchId'];
  if (forbidden.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    throw new OtpError(400, 'CHAT_READ_PRINCIPAL_SERVER_OWNED', 'Read authority is resolved by BlueTap.');
  }
}

function requireOnlyFields(body, allowed) {
  const unexpected = Object.keys(body || {}).filter((field) => !allowed.has(field));
  if (unexpected.length) throw new OtpError(400, 'CHAT_REQUEST_FIELDS_INVALID', 'The chat request contains unsupported fields.');
}

function chatAccountError(profile = {}) {
  const status = canonicalAccountStatus(profile);
  if (status === 'active') return;
  const reason = {
    inactive: 'CHAT_ACCOUNT_INACTIVE',
    suspended: 'CHAT_ACCOUNT_SUSPENDED',
    terminated: 'CHAT_ACCOUNT_TERMINATED',
  }[status] || 'CHAT_ACCOUNT_INACTIVE';
  throw new OtpError(403, reason, `This account is ${status}.`);
}

function requireChatProfile(profile, uid, expectedRole = '') {
  if (!profile || !clean(uid)) throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'Chat access is not authorized.');
  chatAccountError(profile);
  if (profile.mustChangePassword === true) throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'Complete the required password change first.');
  const role = clean(profile.role).toLowerCase();
  if (!['requester', 'distributor', 'manager'].includes(role) || (expectedRole && role !== expectedRole)) {
    throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'Chat access is not authorized.');
  }
  return { ...profile, uid: clean(uid) };
}

async function verifyChatIdentity(req, auth) {
  const decoded = await verifiedIdentity(req, auth);
  if (typeof auth.getUser === 'function') {
    const account = await auth.getUser(decoded.uid).catch(() => null);
    if (!account || account.disabled === true) throw new OtpError(403, 'CHAT_ACCOUNT_INACTIVE', 'This account is inactive.');
  }
  return decoded;
}

async function readRequired(reader, ref, reason, message) {
  const snapshot = await reader.get(ref);
  if (!snapshot.exists) throw new OtpError(404, reason, message);
  return withId(snapshot);
}

function activeBranch(branch, expectedId = '') {
  try { requireActiveBranch(branch, expectedId); } catch (error) {
    if (error instanceof OtpError) throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'The required branch is unavailable.');
    throw error;
  }
  return branch;
}

function activeRequester(profile, uid) {
  const value = requireChatProfile(profile, uid, 'requester');
  try { requireRole(value, 'requester'); } catch (error) {
    if (error instanceof OtpError) throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'Requester chat access is not authorized.');
    throw error;
  }
  return value;
}

function activeDistributor(profile, uid) {
  const value = requireChatProfile(profile, uid, 'distributor');
  try { return requireActiveDistributor(value); } catch (error) {
    if (error instanceof OtpError && error.reason.startsWith('ACCOUNT_')) chatAccountError(value);
    if (error instanceof OtpError) throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'Distributor chat access is not authorized.');
    throw error;
  }
}

function activeManager(profile, uid, branch, claims = null) {
  const value = requireChatProfile(profile, uid, 'manager');
  if (claims && !(claims.manager === true || claims.role === 'manager')) {
    throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'Trusted Manager authority is required.');
  }
  try { requireActiveManager(value, branch); } catch (error) {
    if (error instanceof OtpError && error.reason.startsWith('ACCOUNT_')) chatAccountError(value);
    if (error instanceof OtpError) throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'Manager chat access is not authorized.');
    throw error;
  }
  return value;
}

function profileDisplayName(profile = {}) {
  const composed = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
  return clean(profile.fullName || profile.full_name || composed || profile.username, 160);
}

function safeOrderContext(order = {}, requester = {}) {
  const orderId = clean(order.id || order.orderId || order.requestId || order.request_id, 128);
  const reference = clean(order.requestId || order.request_id || order.publicOrderReference, 80);
  const total = Number(order.totalAtOrder ?? order.total_cost ?? order.totalAmount);
  return {
    id: orderId,
    orderId,
    requestId: reference,
    publicOrderReference: reference,
    requesterName: clean(order.requesterNameSnapshot || order.requester_name || profileDisplayName(requester), 160),
    status: normalizedStatus(order.status),
    ...(Number.isFinite(total) ? { totalAtOrder: total } : {}),
    currentBranchName: clean(order.currentBranchNameSnapshot || order.branchNameSnapshot || order.water_station, 160),
    ...(order.distributorChatGraceUntil ? { distributorChatGraceUntil: order.distributorChatGraceUntil } : {}),
    ...(order.deliveryFailedAt || order.delivery_failed_at ? { deliveryFailedAt: order.deliveryFailedAt || order.delivery_failed_at } : {}),
  };
}

async function resolveConversationIntent(tx, db, callerUid, callerClaims, body, now) {
  requireNoClientAuthorityFields(body);
  const type = clean(body.type, 64);
  if (!Object.values(CONVERSATION_TYPES).includes(type)) {
    throw new OtpError(400, 'CHAT_TYPE_UNSUPPORTED', 'Choose a supported conversation type.');
  }
  const callerRef = db.collection('users').doc(callerUid);
  const caller = requireChatProfile(await readRequired(tx, callerRef, 'CHAT_NOT_AUTHORIZED', 'Chat access is not authorized.'), callerUid);
  const createdBy = { uid: callerUid, role: caller.role };

  if (type === CONVERSATION_TYPES.REQUESTER_BRANCH) {
    const requester = activeRequester(caller, callerUid);
    const intent = clean(body.intent, 64);
    if (!['inquiry', 'order_followup'].includes(intent)) {
      throw new OtpError(400, 'CHAT_INTENT_INVALID', 'Choose inquiry or order_followup.');
    }
    if (intent === 'inquiry') {
      requireOnlyFields(body, new Set(['type', 'intent', 'branchId']));
      const branchId = requiredId(body.branchId, 'CHAT_BRANCH_REQUIRED', 'Choose a branch.');
      const branch = activeBranch(await readRequired(tx, db.collection('branches').doc(branchId), 'CHAT_NOT_AUTHORIZED', 'The branch is unavailable.'), branchId);
      const authority = authorizeRequesterBranch({ requester, branch, requesterInitiated: true });
      return {
        type,
        authority,
        authorityReasons: addAuthorityReason({}, AUTHORITY_REASONS.REQUESTER_INQUIRY, { grantedAt: now }),
        reason: AUTHORITY_REASONS.REQUESTER_INQUIRY,
        reasonOptions: { grantedAt: now },
        createdBy,
        presentation: { requesterDisplayName: profileDisplayName(requester) },
      };
    }

    requireOnlyFields(body, new Set(['type', 'intent', 'orderId']));
    const orderId = requiredId(body.orderId, 'CHAT_ORDER_REQUIRED', 'Choose an order.');
    const order = await readRequired(tx, db.collection('requests').doc(orderId), 'CHAT_CONVERSATION_NOT_FOUND', 'The order was not found.');
    const branchId = owningBranchId(order);
    const branch = activeBranch(await readRequired(tx, db.collection('branches').doc(branchId), 'CHAT_NOT_AUTHORIZED', 'The branch is unavailable.'), branchId);
    const status = normalizedStatus(order.status);
    const delivered = ['delivered', 'completed'].includes(status);
    const accessEndsAt = order.chatAccessEndsAt || order.postOrderChatAccessEndsAt || null;
    let reason = AUTHORITY_REASONS.ACTIVE_ORDER;
    if (TERMINAL_ORDER_STATUSES.has(status)) {
      if (!delivered || timeOf(accessEndsAt) <= timeOf(now) || orderRequesterUid(order) !== callerUid || owningBranchId(order) !== branchId) {
        throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'This order no longer grants branch chat access.');
      }
      reason = AUTHORITY_REASONS.POST_ORDER_FOLLOWUP;
    } else {
      authorizeRequesterBranch({ requester, branch, order });
    }
    const authority = { requesterUid: callerUid, branchId };
    const reasonOptions = { orderId, grantedAt: now, ...(reason === AUTHORITY_REASONS.POST_ORDER_FOLLOWUP ? { accessEndsAt } : {}) };
    return {
      type,
      authority,
      authorityReasons: addAuthorityReason({}, reason, reasonOptions),
      reason,
      reasonOptions,
      createdBy,
      presentation: { requesterDisplayName: profileDisplayName(requester), orderContext: safeOrderContext(order, requester) },
    };
  }

  if (type === CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR) {
    requireOnlyFields(body, new Set(['type', 'orderId']));
    const orderId = requiredId(body.orderId, 'CHAT_ORDER_REQUIRED', 'Choose an order.');
    const order = await readRequired(tx, db.collection('requests').doc(orderId), 'CHAT_CONVERSATION_NOT_FOUND', 'The order was not found.');
    const requesterUid = orderRequesterUid(order);
    const distributorUid = clean(order.assignedDistributorUid || order.distributor_id, 128);
    if (!requesterUid || !distributorUid || ![requesterUid, distributorUid].includes(callerUid)) {
      throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'This order does not grant direct chat access.');
    }
    const branchId = owningBranchId(order);
    const [requester, distributor, branch] = await Promise.all([
      readRequired(tx, db.collection('users').doc(requesterUid), 'CHAT_NOT_AUTHORIZED', 'The Requester is unavailable.'),
      readRequired(tx, db.collection('users').doc(distributorUid), 'CHAT_NOT_AUTHORIZED', 'The Distributor is unavailable.'),
      readRequired(tx, db.collection('branches').doc(branchId), 'CHAT_NOT_AUTHORIZED', 'The branch is unavailable.'),
    ]);
    let authority;
    try {
      const assignmentVersion = getAssignmentVersion(order);
      authority = authorizeRequesterDistributor({
        requester: activeRequester(requester, requesterUid),
        distributor: activeDistributor(distributor, distributorUid),
        branch: activeBranch(branch, branchId),
        order,
        assignmentVersion,
        now,
      });
    } catch (error) {
      if (error instanceof OtpError && ['INVALID_ASSIGNMENT_VERSION', 'CHAT_ASSIGNMENT_VERSION_STALE'].includes(error.reason)) {
        throw new OtpError(409, 'CHAT_STALE_ASSIGNMENT', 'The Distributor assignment has changed.');
      }
      throw error;
    }
    return {
      type,
      authority: { ...authority, branchId },
      authorityReasons: {},
      createdBy,
      presentation: {
        requesterDisplayName: profileDisplayName(requester),
        distributorDisplayName: profileDisplayName(distributor),
        orderContext: safeOrderContext(order, requester),
      },
    };
  }

  if (type === CONVERSATION_TYPES.DISTRIBUTOR_BRANCH) {
    requireOnlyFields(body, new Set(['type', 'distributorId']));
    const managerInitiated = caller.role === 'manager';
    const distributorId = managerInitiated
      ? requiredId(body.distributorId, 'CHAT_DISTRIBUTOR_REQUIRED', 'Choose a branch Distributor.')
      : callerUid;
    if (!managerInitiated && body.distributorId) throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'Use your own branch relationship.');
    const distributor = managerInitiated
      ? activeDistributor(await readRequired(tx, db.collection('users').doc(distributorId), 'CHAT_NOT_AUTHORIZED', 'The Distributor is unavailable.'), distributorId)
      : activeDistributor(caller, callerUid);
    const branchId = clean(distributor.branchId, 128);
    const branch = activeBranch(await readRequired(tx, db.collection('branches').doc(branchId), 'CHAT_NOT_AUTHORIZED', 'The branch is unavailable.'), branchId);
    if (managerInitiated) activeManager(caller, callerUid, branch, callerClaims);
    let authority;
    try {
      const branchMembershipVersion = getBranchMembershipVersion(distributor);
      authority = authorizeDistributorBranch({ distributor, branch, branchMembershipVersion });
    } catch (error) {
      if (error instanceof OtpError && ['INVALID_BRANCH_MEMBERSHIP_VERSION', 'CHAT_MEMBERSHIP_VERSION_STALE'].includes(error.reason)) {
        throw new OtpError(409, 'CHAT_STALE_BRANCH_MEMBERSHIP', 'The Distributor branch membership has changed.');
      }
      throw error;
    }
    return { type, authority, authorityReasons: {}, createdBy };
  }

  requireOnlyFields(body, new Set(['type', 'targetBranchId']));
  const managerProfile = requireChatProfile(caller, callerUid, 'manager');
  const sourceBranchId = requiredId(managerProfile.branchId, 'CHAT_NOT_AUTHORIZED', 'The Manager branch is unavailable.');
  const targetBranchId = requiredId(body.targetBranchId, 'CHAT_BRANCH_REQUIRED', 'Choose a target branch.');
  const [sourceBranch, targetBranch] = await Promise.all([
    readRequired(tx, db.collection('branches').doc(sourceBranchId), 'CHAT_NOT_AUTHORIZED', 'The Manager branch is unavailable.'),
    readRequired(tx, db.collection('branches').doc(targetBranchId), 'CHAT_NOT_AUTHORIZED', 'The target branch is unavailable.'),
  ]);
  const manager = activeManager(managerProfile, callerUid, sourceBranch, callerClaims);
  const resolved = authorizeBranchCoordination({ manager, sourceBranch, targetBranch });
  return {
    type,
    authority: { branchIdA: resolved.branchIds[0], branchIdB: resolved.branchIds[1] },
    authorityReasons: {},
    createdBy,
  };
}

async function resolveOrCreateConversation({ db, callerUid, callerClaims, body, now, createConversationId }) {
  return db.runTransaction(async (tx) => {
    const resolved = await resolveConversationIntent(tx, db, callerUid, callerClaims, body, now);
    const hash = authorityKeyHash(resolved.type, resolved.authority);
    const registryRef = db.collection('chatAuthorityRegistry').doc(hash);
    const registrySnapshot = await tx.get(registryRef);
    let conversationRef = null;
    let conversation = null;
    let created = false;

    if (registrySnapshot.exists) {
      const conversationId = clean(registrySnapshot.data()?.conversationId, 128);
      if (!conversationId) throw new OtpError(409, 'CHAT_STATE_INVALID', 'Conversation authority registry is invalid.');
      conversationRef = db.collection('chatConversations').doc(conversationId);
      conversation = await readRequired(tx, conversationRef, 'CHAT_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
    } else {
      const existingQuery = db.collection('chatConversations').where('authorityKeyHash', '==', hash).limit(2);
      const existingSnapshot = await tx.get(existingQuery);
      if ((existingSnapshot.docs || []).length > 1) throw new OtpError(409, 'CHAT_STATE_INVALID', 'Duplicate conversation authority requires repair.');
      if ((existingSnapshot.docs || []).length === 1) {
        conversation = withId(existingSnapshot.docs[0]);
        conversationRef = db.collection('chatConversations').doc(conversation.id);
        tx.create(registryRef, { authorityKeyHash: hash, conversationId: conversation.id, type: resolved.type, createdAt: now });
      } else {
        const conversationId = createConversationId();
        conversationRef = db.collection('chatConversations').doc(conversationId);
        const foundation = { ...buildConversationFoundation({ ...resolved, now }), ...(resolved.presentation || {}) };
        conversation = { id: conversationId, ...foundation };
        tx.create(conversationRef, foundation);
        tx.create(registryRef, { authorityKeyHash: hash, conversationId, type: resolved.type, createdAt: now });
        created = true;
      }
    }

    if (conversation.authorityKeyHash !== hash || conversation.type !== resolved.type) {
      throw new OtpError(409, 'CHAT_STATE_INVALID', 'Conversation authority does not match its registry.');
    }
    assertCanonicalConversationParticipants(conversation);
    if (conversation.status === CONVERSATION_STATUS.CLOSED) throw new OtpError(409, 'CHAT_CLOSED', 'This conversation is closed.');

    if (resolved.type === CONVERSATION_TYPES.REQUESTER_BRANCH && !created) {
      const authorityReasons = addAuthorityReason(conversation.authorityReasons, resolved.reason, resolved.reasonOptions);
      const status = hasActiveAuthorityReason(authorityReasons, timeOf(now)) ? CONVERSATION_STATUS.ACTIVE : conversation.status;
      const projection = participantAccessProjection(conversation, status === CONVERSATION_STATUS.ACTIVE ? 'active' : 'read_only');
      const reasons = Object.values(normalizeAuthorityReasons(authorityReasons));
      const accessEndsAt = reasons.some((reason) => !reason.accessEndsAt) ? null : new Date(Math.max(...reasons.map((reason) => timeOf(reason.accessEndsAt))));
      tx.update(conversationRef, { authorityReasons, status, accessEndsAt, readAccessEndsAt: accessEndsAt, ...projection, ...(resolved.presentation || {}), updatedAt: now });
      conversation = { ...conversation, authorityReasons, status, accessEndsAt, readAccessEndsAt: accessEndsAt, ...projection, ...(resolved.presentation || {}), updatedAt: now };
    } else if (!created) {
      const directAssignment = resolved.type === CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR;
      const status = directAssignment ? CONVERSATION_STATUS.ACTIVE : conversation.status;
      const accessEndsAt = directAssignment ? (resolved.authority.accessEndsAt || null) : conversation.accessEndsAt;
      const accessFields = directAssignment ? { accessEndsAt, readAccessEndsAt: accessEndsAt } : {};
      const projection = participantAccessProjection(conversation, status === CONVERSATION_STATUS.ACTIVE ? 'active' : 'read_only');
      tx.update(conversationRef, { status, ...accessFields, ...projection, ...(resolved.presentation || {}), updatedAt: now });
      conversation = { ...conversation, status, ...accessFields, ...projection, ...(resolved.presentation || {}), updatedAt: now };
    }
    publishChatActivity(tx, db, conversation, now);
    return { created, conversation };
  });
}

function hasBoundedHistoricalRead(conversation, nowMs) {
  return conversation.status === CONVERSATION_STATUS.READ_ONLY &&
    timeOf(conversation.readAccessEndsAt || conversation.accessEndsAt) > nowMs;
}

function reasonOrderIds(conversation, reason) {
  const ids = normalizeAuthorityReasons(conversation.authorityReasons)?.[reason]?.orderIds || [];
  if (ids.length > MAX_AUTHORITY_REASON_ORDER_IDS) throw new OtpError(409, 'CHAT_STATE_INVALID', 'Conversation authority metadata is too large.');
  return ids;
}

async function requesterBranchAuthorityCurrent(tx, db, conversation, nowMs) {
  const reasons = normalizeAuthorityReasons(conversation.authorityReasons);
  const inquiryCurrent = reasons.requester_inquiry?.active === true &&
    (!reasons.requester_inquiry.accessEndsAt || timeOf(reasons.requester_inquiry.accessEndsAt) > nowMs);
  const validOrderIds = new Set();
  for (const reason of [AUTHORITY_REASONS.ACTIVE_ORDER, AUTHORITY_REASONS.POST_ORDER_FOLLOWUP]) {
    for (const orderId of reasonOrderIds(conversation, reason)) {
      const snapshot = await tx.get(db.collection('requests').doc(orderId));
      if (!snapshot.exists) continue;
      const order = withId(snapshot);
      if (orderRequesterUid(order) !== clean(conversation.requesterUid) || owningBranchId(order) !== clean(conversation.branchIds?.[0])) continue;
      const status = normalizedStatus(order.status);
      if (reason === AUTHORITY_REASONS.ACTIVE_ORDER && !TERMINAL_ORDER_STATUSES.has(status)) validOrderIds.add(orderId);
      const accessEndsAt = reasons[reason]?.accessEndsAt;
      if (reason === AUTHORITY_REASONS.POST_ORDER_FOLLOWUP && ['delivered', 'completed'].includes(status) && timeOf(accessEndsAt) > nowMs) validOrderIds.add(orderId);
    }
  }
  return { current: inquiryCurrent || validOrderIds.size > 0, validOrderIds };
}

async function authorizeConversation(tx, db, conversation, callerUid, callerClaims, mode, nowMs) {
  if (!conversation) throw new OtpError(404, 'CHAT_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
  assertCanonicalConversationParticipants(conversation);
  const caller = requireChatProfile(await readRequired(tx, db.collection('users').doc(callerUid), 'CHAT_NOT_AUTHORIZED', 'Chat access is not authorized.'), callerUid);
  if (mode === 'send') {
    const branchContextId = conversation.type === CONVERSATION_TYPES.BRANCH_COORDINATION
      ? clean(caller.branchId, 128)
      : clean(conversation.branchIds?.[0] || conversation.participantBranchIds?.[0], 128);
    await assertChatSendAllowed(tx, db, callerUid, branchContextId, nowMs);
  }
  if (conversation.status === CONVERSATION_STATUS.CLOSED) throw new OtpError(409, 'CHAT_CLOSED', 'This conversation is closed.');
  if (isAccessExpired(conversation.accessEndsAt, nowMs) || (conversation.status === CONVERSATION_STATUS.READ_ONLY && !hasBoundedHistoricalRead(conversation, nowMs))) {
    throw new OtpError(mode === 'send' ? 409 : 403, mode === 'send' ? 'CHAT_READ_ONLY' : 'CHAT_NOT_AUTHORIZED', 'Conversation access has ended.');
  }
  let principal;
  let senderBranchId = '';
  let validContextOrderIds = new Set();

  if (conversation.type === CONVERSATION_TYPES.REQUESTER_BRANCH) {
    const branchId = clean(conversation.branchIds?.[0] || conversation.participantBranchIds?.[0], 128);
    const [branch, requester] = await Promise.all([
      readRequired(tx, db.collection('branches').doc(branchId), 'CHAT_NOT_AUTHORIZED', 'The branch is unavailable.'),
      readRequired(tx, db.collection('users').doc(clean(conversation.requesterUid, 128)), 'CHAT_NOT_AUTHORIZED', 'The Requester is unavailable.'),
    ]);
    activeBranch(branch, branchId);
    activeRequester(requester, conversation.requesterUid);
    if (callerUid === clean(conversation.requesterUid) && caller.role === 'requester') {
      activeRequester(caller, callerUid);
      principal = { principalType: 'user', principalId: callerUid };
    } else if (caller.role === 'manager' && clean(caller.branchId) === branchId) {
      activeManager(caller, callerUid, branch, callerClaims);
      principal = { principalType: 'branch', principalId: branchId };
      senderBranchId = branchId;
    } else {
      throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'This conversation is not available to this account.');
    }
    const relationship = await requesterBranchAuthorityCurrent(tx, db, conversation, nowMs);
    validContextOrderIds = relationship.validOrderIds;
    if (!relationship.current && !(mode === 'read' && hasBoundedHistoricalRead(conversation, nowMs))) {
      throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'The branch relationship is no longer current.');
    }
  } else if (conversation.type === CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR) {
    const orderId = clean(conversation.orderId, 128);
    const requesterUid = clean(conversation.requesterUid, 128);
    const distributorUid = clean(conversation.distributorUid, 128);
    if (callerUid === requesterUid && caller.role === 'requester') principal = { principalType: 'user', principalId: callerUid };
    else if (callerUid === distributorUid && caller.role === 'distributor') principal = { principalType: 'user', principalId: callerUid };
    else throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'This conversation is not available to this account.');

    const order = await readRequired(tx, db.collection('requests').doc(orderId), 'CHAT_CONVERSATION_NOT_FOUND', 'The order was not found.');
    const branchId = owningBranchId(order);
    const [requester, distributor, branch] = await Promise.all([
      readRequired(tx, db.collection('users').doc(requesterUid), 'CHAT_NOT_AUTHORIZED', 'The Requester is unavailable.'),
      readRequired(tx, db.collection('users').doc(distributorUid), 'CHAT_NOT_AUTHORIZED', 'The Distributor is unavailable.'),
      readRequired(tx, db.collection('branches').doc(branchId), 'CHAT_NOT_AUTHORIZED', 'The branch is unavailable.'),
    ]);
    activeRequester(requester, requesterUid);
    activeDistributor(distributor, distributorUid);
    activeBranch(branch, branchId);
    let current = false;
    try {
      current = getAssignmentVersion(order) === conversation.assignmentVersion &&
        orderRequesterUid(order) === requesterUid &&
        clean(order.assignedDistributorUid || order.distributor_id) === distributorUid &&
        clean(distributor.branchId) === branchId;
    } catch (error) {
      if (error instanceof OtpError) throw new OtpError(409, 'CHAT_STALE_ASSIGNMENT', 'The Distributor assignment has changed.');
      throw error;
    }
    if (!current) {
      if (!(mode === 'read' && hasBoundedHistoricalRead(conversation, nowMs))) {
        throw new OtpError(409, 'CHAT_STALE_ASSIGNMENT', 'The Distributor assignment has changed.');
      }
    }
    const status = normalizedStatus(order.status);
    const deliveredHistoricalReadActive = ['delivered', 'completed'].includes(status)
      && hasBoundedHistoricalRead(conversation, nowMs);
    if (mode === 'send' && ['delivered', 'completed'].includes(status)) {
      throw new OtpError(409, 'CHAT_READ_ONLY', 'Delivery completion ended messaging for this conversation.');
    }
    if (status === 'delivery_failed') {
      const trustedGraceEndsAt = timeOf(failedDeliveryChatEndsAt(order));
      if (!trustedGraceEndsAt || trustedGraceEndsAt <= nowMs) {
        throw new OtpError(mode === 'send' ? 409 : 403, mode === 'send' ? 'CHAT_READ_ONLY' : 'CHAT_NOT_AUTHORIZED', 'The failed-delivery messaging window has ended.');
      }
    }
    if (mode === 'send' && TERMINAL_ORDER_STATUSES.has(status)) {
      throw new OtpError(409, 'CHAT_READ_ONLY', 'This conversation is read-only.');
    }
    if (mode === 'read' && TERMINAL_ORDER_STATUSES.has(status) && !deliveredHistoricalReadActive && !hasBoundedHistoricalRead(conversation, nowMs)) {
      throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'Historical conversation access has ended.');
    }
    if (caller.role === 'distributor') senderBranchId = branchId;
  } else if (conversation.type === CONVERSATION_TYPES.DISTRIBUTOR_BRANCH) {
    const distributorUid = clean(conversation.distributorUid, 128);
    const branchId = clean(conversation.branchIds?.[0] || conversation.participantBranchIds?.[0], 128);
    const [distributor, branch] = await Promise.all([
      readRequired(tx, db.collection('users').doc(distributorUid), 'CHAT_NOT_AUTHORIZED', 'The Distributor is unavailable.'),
      readRequired(tx, db.collection('branches').doc(branchId), 'CHAT_NOT_AUTHORIZED', 'The branch is unavailable.'),
    ]);
    activeDistributor(distributor, distributorUid);
    activeBranch(branch, branchId);
    if (callerUid === distributorUid && caller.role === 'distributor') principal = { principalType: 'user', principalId: callerUid };
    else if (caller.role === 'manager' && clean(caller.branchId) === branchId) principal = { principalType: 'branch', principalId: branchId };
    else throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'This conversation is not available to this account.');
    if (caller.role === 'manager') activeManager(caller, callerUid, branch, callerClaims);
    if (caller.role === 'distributor') activeDistributor(caller, callerUid);
    senderBranchId = branchId;
    let current = false;
    try {
      current = getBranchMembershipVersion(distributor) === conversation.branchMembershipVersion && clean(distributor.branchId) === branchId;
    } catch (error) {
      if (error instanceof OtpError) throw new OtpError(409, 'CHAT_STALE_BRANCH_MEMBERSHIP', 'The Distributor branch membership has changed.');
      throw error;
    }
    if (!current && !(mode === 'read' && hasBoundedHistoricalRead(conversation, nowMs))) {
      throw new OtpError(409, 'CHAT_STALE_BRANCH_MEMBERSHIP', 'The Distributor branch membership has changed.');
    }
  } else if (conversation.type === CONVERSATION_TYPES.BRANCH_COORDINATION) {
    if (caller.role !== 'manager') throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'Manager branch authority is required.');
    const branchIds = Array.isArray(conversation.branchIds) ? conversation.branchIds.map((id) => clean(id, 128)) : [];
    const callerBranchId = clean(caller.branchId, 128);
    if (branchIds.length !== 2 || !branchIds.includes(callerBranchId)) throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'This branch is not a conversation participant.');
    const branches = await Promise.all(branchIds.map((id) => readRequired(tx, db.collection('branches').doc(id), 'CHAT_NOT_AUTHORIZED', 'A participating branch is unavailable.')));
    branches.forEach((branch, index) => activeBranch(branch, branchIds[index]));
    activeManager(caller, callerUid, branches[branchIds.indexOf(callerBranchId)], callerClaims);
    principal = { principalType: 'branch', principalId: callerBranchId };
    senderBranchId = callerBranchId;
  } else {
    throw new OtpError(409, 'CHAT_STATE_INVALID', 'The conversation type is invalid.');
  }

  if (mode === 'send' && conversation.status === CONVERSATION_STATUS.READ_ONLY) {
    throw new OtpError(409, 'CHAT_READ_ONLY', 'This conversation is read-only.');
  }
  const principalState = (conversation.participantState || []).find((state) => principalKey(state) === principalKey(principal));
  if (!principalState || principalState.accessState === 'closed') {
    throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'The logical principal is not a participant.');
  }
  if (mode === 'send' && principalState.accessState !== 'active') throw new OtpError(409, 'CHAT_READ_ONLY', 'This conversation is read-only.');
  return { caller, principal, senderBranchId, validContextOrderIds };
}

function contextualOrderId(conversation, suppliedOrderId, authorization) {
  const orderId = clean(suppliedOrderId, 128);
  if (!orderId) return conversation.type === CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR ? clean(conversation.orderId, 128) : '';
  if (conversation.type === CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR && orderId === clean(conversation.orderId, 128)) return orderId;
  if (conversation.type === CONVERSATION_TYPES.REQUESTER_BRANCH && authorization.validContextOrderIds.has(orderId)) return orderId;
  throw new OtpError(400, 'CHAT_ORDER_CONTEXT_INVALID', 'The order is not valid for this conversation.');
}

function requesterBranchContextOrderId(conversation, validOrderIds) {
  const preferred = clean(conversation.orderContext?.orderId || conversation.orderContext?.id, 128);
  if (preferred && validOrderIds.has(preferred)) return preferred;
  const candidates = [
    ...reasonOrderIds(conversation, AUTHORITY_REASONS.ACTIVE_ORDER),
    ...reasonOrderIds(conversation, AUTHORITY_REASONS.POST_ORDER_FOLLOWUP),
  ];
  return candidates.reverse().find((orderId) => validOrderIds.has(orderId)) || '';
}

async function conversationPresentation(tx, db, conversation, authorization) {
  if (conversation.type === CONVERSATION_TYPES.REQUESTER_BRANCH) {
    const requesterSnapshot = await tx.get(db.collection('users').doc(clean(conversation.requesterUid, 128)));
    const requester = requesterSnapshot.exists ? withId(requesterSnapshot) : {};
    const orderId = requesterBranchContextOrderId(conversation, authorization.validContextOrderIds || new Set());
    const orderSnapshot = orderId ? await tx.get(db.collection('requests').doc(orderId)) : null;
    return {
      requesterDisplayName: profileDisplayName(requester),
      orderContext: orderSnapshot?.exists ? safeOrderContext(withId(orderSnapshot), requester) : null,
    };
  }
  if (conversation.type === CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR) {
    const [requesterSnapshot, distributorSnapshot, orderSnapshot] = await Promise.all([
      tx.get(db.collection('users').doc(clean(conversation.requesterUid, 128))),
      tx.get(db.collection('users').doc(clean(conversation.distributorUid, 128))),
      tx.get(db.collection('requests').doc(clean(conversation.orderId, 128))),
    ]);
    const requester = requesterSnapshot.exists ? withId(requesterSnapshot) : {};
    const distributor = distributorSnapshot.exists ? withId(distributorSnapshot) : {};
    return {
      requesterDisplayName: profileDisplayName(requester),
      distributorDisplayName: profileDisplayName(distributor),
      orderContext: orderSnapshot.exists ? safeOrderContext(withId(orderSnapshot), requester) : null,
    };
  }
  if (conversation.type === CONVERSATION_TYPES.DISTRIBUTOR_BRANCH) {
    const distributorSnapshot = await tx.get(db.collection('users').doc(clean(conversation.distributorUid, 128)));
    return { distributorDisplayName: distributorSnapshot.exists ? profileDisplayName(withId(distributorSnapshot)) : '' };
  }
  return {};
}

async function sendMessage({ db, callerUid, callerClaims, body, now, createMessageId }) {
  requireNoClientSenderFields(body);
  requireOnlyFields(body, new Set(['conversationId', 'clientMutationId', 'clientMessageId', 'body', 'orderId', 'replyToMessageId']));
  const conversationId = requiredId(body.conversationId, 'CHAT_CONVERSATION_REQUIRED', 'conversationId is required.');
  const clientMutationId = normalizeClientMutationId(body.clientMutationId || body.clientMessageId);
  const normalizedBody = normalizeMessageBody(body.body);
  const replyToMessageId = typeof body.replyToMessageId === 'string' ? clean(body.replyToMessageId, 128) : '';
  const conversationRef = db.collection('chatConversations').doc(conversationId);

  return db.runTransaction(async (tx) => {
    const conversation = await readRequired(tx, conversationRef, 'CHAT_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
    const authorization = await authorizeConversation(tx, db, conversation, callerUid, callerClaims, 'send', timeOf(now));
    const orderId = contextualOrderId(conversation, body.orderId, authorization);

    let replyTo = null;
    if (replyToMessageId) {
      const replySnapshot = await tx.get(conversationRef.collection('messages').doc(replyToMessageId));
      if (!replySnapshot.exists) {
        throw new OtpError(404, 'CHAT_REPLY_TARGET_NOT_FOUND', 'The message you are replying to was not found.');
      }
      const target = withId(replySnapshot);
      if (!Number.isSafeInteger(Number(target.seq)) || Number(target.seq) < 1) {
        throw new OtpError(400, 'CHAT_REPLY_TARGET_INVALID', 'The reply target is invalid.');
      }
      let senderDisplayName = '';
      if (target.senderRole === 'manager') {
        senderDisplayName = clean(conversation.branchDisplayName || 'Station', 80);
      } else if (target.senderUid) {
        const senderSnapshot = await tx.get(db.collection('users').doc(clean(target.senderUid, 128)));
        senderDisplayName = senderSnapshot.exists ? profileDisplayName(withId(senderSnapshot)) : '';
      }
      if (!senderDisplayName) {
        senderDisplayName = target.senderRole === 'distributor' ? 'Distributor' : 'Requester';
      }
      const isDeleted = Boolean(target.deletedAt);
      const snippet = isDeleted ? 'Message deleted' : clean(target.body, 140);
      replyTo = {
        messageId: target.id,
        seq: Number(target.seq),
        senderUid: clean(target.senderUid, 128),
        senderRole: clean(target.senderRole, 30),
        senderPublicUidSnapshot: clean(target.senderPublicUidSnapshot, 80),
        senderDisplayName,
        snippet,
      };
    }

    const mutationId = mutationRegistryId(authorization.principal, clientMutationId);
    const mutationRef = db.collection('chatMutationIds').doc(mutationId);
    const mutationSnapshot = await tx.get(mutationRef);
    const bodyHash = messageBodyHash(conversationId, normalizedBody, orderId);
    if (mutationSnapshot.exists) {
      const mutation = mutationSnapshot.data() || {};
      if (mutation.conversationId !== conversationId || mutation.bodyHash !== bodyHash || mutation.senderPrincipalKey !== principalKey(authorization.principal)) {
        throw new OtpError(409, 'CHAT_MUTATION_CONFLICT', 'clientMutationId was already used for a different message.');
      }
      const existing = await readRequired(tx, conversationRef.collection('messages').doc(clean(mutation.messageId, 128)), 'CHAT_STATE_INVALID', 'The committed message could not be loaded.');
      return { created: false, message: existing, conversation };
    }

    const rateRef = db.collection('chatRateLimits').doc(rateLimitDocumentId(callerUid));
    const rateSnapshot = await tx.get(rateRef);
    const rateRecord = consumeMessageRateLimit(rateSnapshot.data() || {}, timeOf(now));
    const seq = conversation.nextSequence;
    const lastMessageSeq = conversation.lastMessageSeq;
    if (!Number.isSafeInteger(seq) || seq < 1 || seq >= Number.MAX_SAFE_INTEGER ||
        !Number.isSafeInteger(lastMessageSeq) || lastMessageSeq < 0 || seq !== lastMessageSeq + 1) {
      throw new OtpError(409, 'CHAT_STATE_INVALID', 'Conversation sequence state is invalid.');
    }
    const participantUpdate = applyMessageToParticipantState(conversation.participantState, authorization.principal, seq, now);
    const messageId = createMessageId();
    const message = {
      seq,
      clientMutationId,
      senderUid: callerUid,
      senderRole: authorization.caller.role,
      senderPrincipalType: authorization.principal.principalType,
      ...(authorization.senderBranchId ? { senderBranchId: authorization.senderBranchId } : {}),
      senderPublicUidSnapshot: clean(authorization.caller.publicUid || authorization.caller.displayUid || authorization.caller.unique_id, 80),
      type: 'text',
      body: normalizedBody,
      ...(orderId ? { orderId } : {}),
      ...(replyTo ? { replyTo } : {}),
      createdAt: now,
      retentionHold: false,
      retentionClass: clean(conversation.retentionClass, 64) || 'standard',
      principalIncomingCounts: participantUpdate.principalIncomingCounts,
    };
    const summary = {
      participantState: participantUpdate.participantState,
      nextSequence: seq + 1,
      lastMessageId: messageId,
      lastMessageSeq: seq,
      lastMessageAt: now,
      lastMessagePreview: messagePreview(normalizedBody),
      updatedAt: now,
    };
    tx.create(conversationRef.collection('messages').doc(messageId), message);
    tx.update(conversationRef, summary);
    publishChatActivity(tx, db, conversation, now);
    tx.create(mutationRef, {
      conversationId,
      messageId,
      bodyHash,
      senderPrincipalKey: principalKey(authorization.principal),
      clientMutationId,
      createdAt: now,
    });
    tx.set(rateRef, rateRecord);
    return { created: true, message: { id: messageId, ...message }, conversation: { ...conversation, ...summary } };
  });
}

async function mutateMessage({ db, callerUid, callerClaims, body, now, operation, createRevisionId = randomUUID }) {
  requireNoClientSenderFields(body);
  const editing = operation === 'edit';
  requireOnlyFields(body, new Set(['conversationId', 'messageId', 'clientMutationId', ...(editing ? ['body'] : [])]));
  const conversationId = requiredId(body.conversationId, 'CHAT_CONVERSATION_REQUIRED', 'conversationId is required.');
  const messageId = requiredId(body.messageId, 'CHAT_MESSAGE_REQUIRED', 'messageId is required.');
  const clientMutationId = normalizeClientMutationId(body.clientMutationId);
  const normalizedBody = editing ? normalizeMessageBody(body.body) : '';
  const conversationRef = db.collection('chatConversations').doc(conversationId);
  const messageRef = conversationRef.collection('messages').doc(messageId);

  return db.runTransaction(async (tx) => {
    const conversation = await readRequired(tx, conversationRef, 'CHAT_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
    const authorization = await authorizeConversation(tx, db, conversation, callerUid, callerClaims, editing ? 'send' : 'read', timeOf(now));
    const message = await readRequired(tx, messageRef, 'CHAT_MESSAGE_NOT_FOUND', 'The message was not found.');
    if (clean(message.senderUid, 128) !== callerUid) throw new OtpError(403, 'CHAT_MESSAGE_MUTATION_DENIED', 'Only the original sender may change this message.');
    assertMessageMutationWindow(message, timeOf(now));
    if (message.deletedAt) {
      if (!editing) return { created: false, message };
      throw new OtpError(409, 'CHAT_MESSAGE_DELETED', 'A deleted message cannot be edited.');
    }
    const mutationId = mutationRegistryId(authorization.principal, `${operation}:${clientMutationId}`);
    const mutationRef = db.collection('chatMutationIds').doc(mutationId);
    const mutationSnapshot = await tx.get(mutationRef);
    const bodyHash = messageBodyHash(conversationId, editing ? normalizedBody : 'Message deleted', messageId);
    if (mutationSnapshot.exists) {
      const mutation = mutationSnapshot.data() || {};
      if (mutation.conversationId !== conversationId || mutation.messageId !== messageId || mutation.bodyHash !== bodyHash || mutation.operation !== operation) {
        throw new OtpError(409, 'CHAT_MUTATION_CONFLICT', 'clientMutationId was already used for a different message change.');
      }
      return { created: false, message: await readRequired(tx, messageRef, 'CHAT_MESSAGE_NOT_FOUND', 'The message was not found.') };
    }
    const revision = Number(message.revision || 0) + 1;
    const revisionId = createRevisionId();
    const revisionRecord = {
      schemaVersion: 1, operation, conversationId, messageId, revision,
      actorUid: callerUid, previousBody: String(message.body || ''),
      ...(editing ? { newBody: normalizedBody } : {}), createdAt: now,
    };
    const update = editing
      ? { body: normalizedBody, editedAt: now, revision }
      : { body: '', deletedAt: now, deletedByUid: callerUid, revision };
    tx.create(db.collection('chatMessageRevisions').doc(revisionId), revisionRecord);
    tx.update(messageRef, update);
    if (clean(conversation.lastMessageId, 128) === messageId) {
      tx.update(conversationRef, { lastMessagePreview: editing ? messagePreview(normalizedBody) : 'Message deleted' });
    }
    tx.create(mutationRef, {
      conversationId, messageId, bodyHash, operation,
      senderPrincipalKey: principalKey(authorization.principal), clientMutationId, createdAt: now,
    });
    publishChatActivity(tx, db, conversation, now);
    return { created: true, message: { id: messageId, ...message, ...update } };
  });
}

const editMessage = (options) => mutateMessage({ ...options, operation: 'edit' });
const deleteMessage = (options) => mutateMessage({ ...options, operation: 'delete' });

async function advanceReadState({ db, callerUid, callerClaims, body, now }) {
  requireNoClientReadPrincipal(body);
  requireOnlyFields(body, new Set(['conversationId', 'lastReadSeq']));
  const conversationId = requiredId(body.conversationId, 'CHAT_CONVERSATION_REQUIRED', 'conversationId is required.');
  const lastReadSeq = Number(body.lastReadSeq);
  if (!Number.isSafeInteger(lastReadSeq) || lastReadSeq < 1) {
    throw new OtpError(400, 'CHAT_INVALID_READ_CURSOR', 'lastReadSeq must identify a committed message.');
  }
  const conversationRef = db.collection('chatConversations').doc(conversationId);
  return db.runTransaction(async (tx) => {
    const conversation = await readRequired(tx, conversationRef, 'CHAT_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
    const authorization = await authorizeConversation(tx, db, conversation, callerUid, callerClaims, 'read', timeOf(now));
    if (lastReadSeq > Number(conversation.lastMessageSeq || 0)) {
      throw new OtpError(400, 'CHAT_INVALID_READ_CURSOR', 'lastReadSeq exceeds the committed conversation sequence.');
    }
    const messageQuery = conversationRef.collection('messages').where('seq', '==', lastReadSeq).limit(1);
    const messageSnapshot = await tx.get(messageQuery);
    if ((messageSnapshot.docs || []).length !== 1) {
      throw new OtpError(400, 'CHAT_INVALID_READ_CURSOR', 'lastReadSeq does not identify a committed message.');
    }
    const message = withId(messageSnapshot.docs[0]);
    const participantState = advanceParticipantReadState(
      conversation.participantState,
      authorization.principal,
      lastReadSeq,
      message.principalIncomingCounts,
      now
    );
    const previous = (conversation.participantState || []).find((state) => principalKey(state) === principalKey(authorization.principal));
    const advanced = lastReadSeq > Number(previous?.lastReadSeq || 0);
    if (advanced) {
      tx.update(conversationRef, { participantState });
      publishChatActivity(tx, db, conversation, now);
    }
    return { advanced, conversation: { ...conversation, participantState } };
  });
}

async function listMessages({ db, callerUid, callerClaims, conversationId, page, now }) {
  const conversationRef = db.collection('chatConversations').doc(conversationId);
  return db.runTransaction(async (tx) => {
    const conversation = await readRequired(tx, conversationRef, 'CHAT_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
    await authorizeConversation(tx, db, conversation, callerUid, callerClaims, 'read', timeOf(now));
    let query = conversationRef.collection('messages').orderBy('seq', 'desc');
    if (page.beforeSeq) query = query.where('seq', '<', page.beforeSeq);
    query = query.limit(page.limit);
    const snapshot = await tx.get(query);
    const messages = (snapshot.docs || []).map(withId);
    return {
      messages,
      nextBeforeSeq: messages.length === page.limit ? messages[messages.length - 1].seq : null,
      lastMessageSeq: Number(conversation.lastMessageSeq || 0),
      participantState: conversation.participantState || [],
    };
  });
}

async function listConversations({ db, callerUid, callerClaims, now }) {
  return db.runTransaction(async (tx) => {
    const caller = requireChatProfile(await readRequired(tx, db.collection('users').doc(callerUid), 'CHAT_NOT_AUTHORIZED', 'Chat access is not authorized.'), callerUid);
    const manager = caller.role === 'manager';
    if (manager) {
      const branch = await readRequired(tx, db.collection('branches').doc(caller.branchId), 'CHAT_NOT_AUTHORIZED', 'Your branch is unavailable.');
      activeManager(caller, callerUid, branch, callerClaims);
    } else if (caller.role === 'distributor') activeDistributor(caller, callerUid);
    const query = db.collection('chatConversations')
      .where(manager ? 'participantBranchIds' : 'participantUserUids', 'array-contains', manager ? caller.branchId : callerUid)
      .orderBy('updatedAt', 'desc').limit(50);
    const snapshot = await tx.get(query);
    const conversations = [];
    for (const item of snapshot.docs) {
      const conversation = withId(item);
      try {
        const authorization = await authorizeConversation(tx, db, conversation, callerUid, callerClaims, 'read', timeOf(now));
        const presentation = await conversationPresentation(tx, db, conversation, authorization);
        if (conversation.type === CONVERSATION_TYPES.BRANCH_COORDINATION) {
          const branchNameSnapshots = {};
          for (const branchId of conversation.participantBranchIds || []) {
            const branchSnapshot = await tx.get(db.collection('branches').doc(branchId));
            if (branchSnapshot.exists) branchNameSnapshots[branchId] = clean(branchSnapshot.data()?.name, 160);
          }
          conversations.push({ ...conversation, ...presentation, branchNameSnapshots });
        } else if (conversation.type === CONVERSATION_TYPES.REQUESTER_BRANCH) {
          const branchId = clean(conversation.branchIds?.[0] || conversation.participantBranchIds?.[0], 128);
          const branchSnapshot = await tx.get(db.collection('branches').doc(branchId));
          conversations.push({ ...conversation, ...presentation, branchNameSnapshot: branchSnapshot.exists ? clean(branchSnapshot.data()?.name, 160) : '' });
        } else conversations.push({ ...conversation, ...presentation });
      } catch (error) {
        if (!(error instanceof OtpError) || ![403, 404, 409].includes(error.status)) throw error;
      }
    }
    return { conversations };
  });
}

function errorResponse(res, error) {
  const known = error instanceof OtpError;
  const details = known && error.details && typeof error.details === 'object' ? error.details : {};
  return res.status(known ? error.status : 500).json({
    error: {
      reason: known ? error.reason : 'CHAT_SERVICE_UNAVAILABLE',
      message: known ? error.message : 'Chat is temporarily unavailable.',
      ...(Number.isFinite(details.retryAfterSeconds) ? { retryAfterSeconds: details.retryAfterSeconds } : {}),
      ...(details.scope ? { scope: details.scope } : {}),
      ...(details.branchName ? { branchName: details.branchName } : {}),
      ...(details.endsAt ? { endsAt: details.endsAt } : {}),
    },
  });
}

function createChatHandler(mode, getAdmin = getFirebaseAdmin, dependencies = {}) {
  const now = dependencies.now || (() => new Date());
  const createConversationId = dependencies.createConversationId || createOpaqueConversationId;
  const createMessageId = dependencies.createMessageId || randomUUID;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    const allowed = mode === 'messages' ? ['GET', 'POST', 'PATCH', 'DELETE'] : mode === 'conversations' ? ['GET', 'POST'] : ['POST'];
    if (!allowed.includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: `Use ${allowed.join(' or ')}.` } });
    try {
      const { auth, db } = getAdmin();
      const decoded = await verifyChatIdentity(req, auth);
      const timestamp = now();
      if (mode === 'conversations') {
        if (req.method === 'GET') return res.status(200).json(await listConversations({ db, callerUid: decoded.uid, callerClaims: decoded, now: timestamp }));
        const result = await resolveOrCreateConversation({ db, callerUid: decoded.uid, callerClaims: decoded, body: parseBody(req), now: timestamp, createConversationId });
        return res.status(result.created ? 201 : 200).json(result);
      }
      if (mode === 'read-state') {
        const result = await advanceReadState({ db, callerUid: decoded.uid, callerClaims: decoded, body: parseBody(req), now: timestamp });
        return res.status(200).json(result);
      }
      if (req.method === 'POST') {
        const result = await sendMessage({ db, callerUid: decoded.uid, callerClaims: decoded, body: parseBody(req), now: timestamp, createMessageId });
        return res.status(result.created ? 201 : 200).json(result);
      }
      if (req.method === 'PATCH') {
        const result = await editMessage({ db, callerUid: decoded.uid, callerClaims: decoded, body: parseBody(req), now: timestamp });
        return res.status(200).json(result);
      }
      if (req.method === 'DELETE') {
        const result = await deleteMessage({ db, callerUid: decoded.uid, callerClaims: decoded, body: parseBody(req), now: timestamp });
        return res.status(200).json(result);
      }
      const params = new URL(req.url || '/api/chat/messages', 'http://localhost').searchParams;
      const conversationId = requiredId(params.get('conversationId'), 'CHAT_CONVERSATION_REQUIRED', 'conversationId is required.');
      const page = normalizeMessagePage({ limit: params.get('limit'), beforeSeq: params.get('beforeSeq') });
      return res.status(200).json(await listMessages({ db, callerUid: decoded.uid, callerClaims: decoded, conversationId, page, now: timestamp }));
    } catch (error) {
      return errorResponse(res, error);
    }
  };
}

const createChatConversationsHandler = (getAdmin, dependencies) => createChatHandler('conversations', getAdmin, dependencies);
const createChatMessagesHandler = (getAdmin, dependencies) => createChatHandler('messages', getAdmin, dependencies);
const createChatReadStateHandler = (getAdmin, dependencies) => createChatHandler('read-state', getAdmin, dependencies);

module.exports = {
  advanceReadState,
  authorizeConversation,
  createChatConversationsHandler,
  createChatMessagesHandler,
  createChatReadStateHandler,
  deleteMessage,
  editMessage,
  listMessages,
  listConversations,
  resolveOrCreateConversation,
  sendMessage,
};
