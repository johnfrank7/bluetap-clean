const { createHash } = require('node:crypto');
const { OtpError } = require('../utils/otpError');
const { ACCOUNT_STATUS, canonicalAccountStatus } = require('./accountStatus');
const { hashId } = require('../moderation/moderationService');
const { assertCanonicalConversationParticipants } = require('../chat/chatAuthorization');
const { verifiedRecipient, requestIdFor } = require('./accountActionNotice');

// Intent authorization is Firestore-only. Firebase Auth work belongs to the executor.
const SOURCE = 'admin_account';
const CHAT_SOURCE = 'chat_report';
const ACTIONS = new Set(['deactivate', 'suspend', 'terminate', 'reactivate']);
const TARGET_ROLES = new Set(['requester', 'distributor', 'manager']);
const STATES = Object.freeze({ AUTHORIZED: 'authorized', APPLYING: 'applying',
  APPLIED: 'applied', RECONCILE_REQUIRED: 'reconcile_required', FAILED: 'failed' });
const ACTIVE_STATES = new Set([STATES.AUTHORIZED, STATES.APPLYING, STATES.RECONCILE_REQUIRED]);
const MAX_LEASE_MS = 5 * 60 * 1000;
const EXTERNAL_BOUNDARY_VERSION = 1;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const validUid = (value) => typeof value === 'string' && value.length >= 1 && value.length <= 128
  && value.trim() === value && !value.includes('/');
const validMutation = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const validReason = (value) => typeof value === 'string' && value.trim() === value
  && value.length >= 20 && value.length <= 1000;
const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const asDate = (value) => value instanceof Date ? value : value?.toDate?.();
const validDate = (value) => asDate(value) instanceof Date && Number.isFinite(asDate(value).getTime());
const conflict = (reason, message) => new OtpError(409, reason, message);

function canonicalRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    || !['action', 'targetUid', 'clientMutationId', 'source'].every((key) =>
      Object.prototype.hasOwnProperty.call(input, key))
    || Object.keys(input).some((key) => !['action', 'targetUid', 'clientMutationId', 'source', 'reason'].includes(key))
    || input.source !== SOURCE || !ACTIONS.has(input.action)
    || !validUid(input.targetUid) || !validMutation(input.clientMutationId)
    || (['suspend', 'terminate'].includes(input.action) && !validReason(input.reason))
    || (input.reason !== undefined && !validReason(input.reason))) {
    throw new OtpError(400, 'ACCOUNT_ACTION_REQUEST_INVALID', 'Choose a valid account action and target.');
  }
  return Object.freeze({ action: input.action, targetUid: input.targetUid,
    clientMutationId: input.clientMutationId, source: SOURCE,
    ...(input.reason ? { reason: input.reason } : {}) });
}

function actionIdentity(actorUid, request) {
  return hash(JSON.stringify(['account_action_intent_v1', actorUid, request.clientMutationId]));
}

function payloadIdentity(request) {
  return hash(JSON.stringify([1, request.source, request.action, request.targetUid, request.reason || null]));
}

function desiredAuthDisabled(action) { return action !== 'reactivate'; }

function assertTargetTransition(profile, action) {
  const current = canonicalAccountStatus(profile);
  if (action === 'reactivate') {
    if (![ACCOUNT_STATUS.INACTIVE, ACCOUNT_STATUS.SUSPENDED].includes(current)) {
      throw conflict('ACCOUNT_NOT_REACTIVATABLE', 'Only inactive or suspended accounts can be reactivated.');
    }
  } else if (current !== ACCOUNT_STATUS.ACTIVE) {
    throw conflict('ACCOUNT_NOT_ACTIVE', 'Only an active account can receive this action.');
  }
}

function assertIntentShape(intent, id) {
  if (!intent || intent.schemaVersion !== 1 || intent.intentId !== id || !validHash(id)
    || !validUid(intent.actorUid) || !validUid(intent.targetUid)
    || !TARGET_ROLES.has(intent.targetRole)
    || (intent.source === SOURCE ? intent.caseRef !== null || intent.validatedGrounds?.length !== 0
      : intent.source === CHAT_SOURCE ? !intent.caseRef
        || intent.caseRef.type !== CHAT_SOURCE || !validUid(intent.caseRef.id)
        || !validUid(intent.caseRef.conversationId) || !validUid(intent.caseRef.branchId)
        || !['suspend_account', 'terminate_account'].includes(intent.action)
        || typeof intent.privateNote !== 'string' || intent.privateNote.length > 1000
        : true)
    || !Array.isArray(intent.validatedGrounds) || intent.validatedGrounds.length !== 0
    || (intent.source === SOURCE && !ACTIONS.has(intent.action))
    || (['suspend', 'terminate', 'suspend_account', 'terminate_account'].includes(intent.action) && !validReason(intent.reason))
    || (intent.reason != null && !validReason(intent.reason))
    || !validHash(intent.payloadHash) || !validHash(intent.mutationIdHash)
    || intent.reservationId !== intent.targetUid
    || !Object.values(STATES).includes(intent.state)
    || typeof intent.desiredAuthDisabled !== 'boolean'
    || intent.desiredAuthDisabled !== desiredAuthDisabled(intent.action)
    || !Number.isSafeInteger(intent.revision) || intent.revision < 0
    || !validDate(intent.createdAt) || !validDate(intent.updatedAt)
    || asDate(intent.updatedAt).getTime() < asDate(intent.createdAt).getTime()
    || !intent.reconciliation || typeof intent.reconciliation.required !== 'boolean'
    || (intent.state === STATES.AUTHORIZED && intent.lease !== null)
    || ([STATES.APPLYING, STATES.RECONCILE_REQUIRED].includes(intent.state) && !intent.lease)
    || (intent.lease !== null && (!intent.lease || !validUid(intent.lease.ownerId)
      || !Number.isSafeInteger(intent.lease.generation) || intent.lease.generation < 1
      || !validDate(intent.lease.expiresAt)))) {
    throw conflict('ACCOUNT_ACTION_INTENT_INVALID', 'The account action requires manual reconciliation.');
  }
  return intent;
}

function assertReservation(reservation, targetUid, intentId) {
  if (!reservation || reservation.schemaVersion !== 1 || reservation.targetUid !== targetUid
    || reservation.intentId !== intentId || reservation.state !== 'reserved'
    || !validDate(reservation.createdAt)) {
    throw conflict('ACCOUNT_ACTION_RESERVATION_INVALID', 'The account reservation requires manual reconciliation.');
  }
}

function safeResult(intent, created) {
  return Object.freeze({ created, intent: Object.freeze({ id: intent.intentId, targetUid: intent.targetUid,
    actorUid: intent.actorUid, action: intent.action, source: intent.source,
    state: intent.state, reservationId: intent.reservationId,
    desiredAuthDisabled: intent.desiredAuthDisabled,
    createdAt: asDate(intent.createdAt).toISOString(), revision: intent.revision }) });
}

async function authorizeAccountActionIntent({ db, auth, idToken, request, now = new Date(),
  noticeTransportCheck = () => {} }) {
  const normalized = canonicalRequest(request);
  if (!validDate(now)) throw new TypeError('A valid server time is required.');
  // The UID and Admin claim come from a verified Firebase token, never the payload.
  let decoded;
  try { decoded = await auth.verifyIdToken(idToken, true); }
  catch { throw new OtpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.'); }
  if (!validUid(decoded?.uid) || !(decoded.admin === true || decoded.role === 'admin')) {
    throw new OtpError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
  }
  const actorUid = decoded.uid;
  if (actorUid === normalized.targetUid) throw new OtpError(403, 'ACCOUNT_ACTION_SELF_DENIED', 'An Admin cannot target their own account.');
  const intentId = actionIdentity(actorUid, normalized);
  const intentRef = db.collection('accountActionIntents').doc(intentId);
  const preTarget = await db.collection('users').doc(normalized.targetUid).get();
  if (!preTarget.exists) throw new OtpError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
  const authRecipient = normalized.action === 'reactivate' ? null
    : await verifiedRecipient(auth, normalized.targetUid, preTarget.data());
  const payloadHash = payloadIdentity(normalized);
  const actorRef = db.collection('users').doc(actorUid);
  const targetRef = db.collection('users').doc(normalized.targetUid);
  const reservationRef = db.collection('accountActionReservations').doc(normalized.targetUid);
  const holdRef = db.collection('accountAccessHolds').doc(normalized.targetUid);
  return db.runTransaction(async (tx) => {
    // All authority, identity, reservation and replay reads precede every write.
    const actorSnapshot = await tx.get(actorRef);
    const targetSnapshot = await tx.get(targetRef);
    const intentSnapshot = await tx.get(intentRef);
    const reservationSnapshot = await tx.get(reservationRef);
    const holdSnapshot = await tx.get(holdRef);
    const actor = actorSnapshot.exists ? actorSnapshot.data() || {} : null;
    if (!actor || actor.role !== 'admin' || actor.mustChangePassword === true
      || canonicalAccountStatus(actor) !== ACCOUNT_STATUS.ACTIVE || actor.accountActionHoldIntentId) {
      throw new OtpError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
    }
    const target = targetSnapshot.exists ? targetSnapshot.data() || {} : null;
    if (!target || !TARGET_ROLES.has(target.role)) throw new OtpError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
    if (authRecipient && (target.email?.trim().toLowerCase() !== authRecipient.email)) {
      throw conflict('ACCOUNT_NOTICE_RECIPIENT_CHANGED', 'The notice recipient requires review.');
    }
    if (intentSnapshot.exists) {
      const intent = assertIntentShape(intentSnapshot.data(), intentId);
      if (intent.actorUid !== actorUid || intent.targetUid !== normalized.targetUid
        || intent.targetRole !== target.role
        || intent.action !== normalized.action || intent.payloadHash !== payloadHash) {
        throw conflict('ACCOUNT_ACTION_MUTATION_CONFLICT', 'This mutation ID was used for another account action.');
      }
      if (ACTIVE_STATES.has(intent.state)) {
        if (!reservationSnapshot.exists) throw conflict('ACCOUNT_ACTION_RESERVATION_MISSING', 'The account reservation requires manual reconciliation.');
        assertReservation(reservationSnapshot.data(), normalized.targetUid, intentId);
        if (intent.desiredAuthDisabled && (!holdSnapshot.exists
          || holdSnapshot.data()?.intentId !== intentId
          || target.accountActionHoldIntentId !== intentId)) {
          throw conflict('ACCOUNT_ACTION_HOLD_INVALID', 'The account access hold requires reconciliation.');
        }
      }
      return safeResult(intent, false);
    }
    if (normalized.action !== 'reactivate' && !authRecipient) {
      throw conflict('ACCOUNT_NOTICE_RECIPIENT_UNVERIFIED', 'The notice recipient requires review.');
    }
    assertTargetTransition(target, normalized.action);
    let predecessor = null;
    if (reservationSnapshot.exists) {
      const previousId = reservationSnapshot.data()?.intentId;
      if (!validHash(previousId)) throw conflict('ACCOUNT_ACTION_RESERVATION_INVALID', 'The account reservation requires reconciliation.');
      const previousSnapshot = await tx.get(db.collection('accountActionIntents').doc(previousId));
      predecessor = previousSnapshot.exists ? assertIntentShape(previousSnapshot.data(), previousId) : null;
      assertReservation(reservationSnapshot.data(), normalized.targetUid, previousId);
      if (!predecessor || predecessor.targetUid !== normalized.targetUid) {
        throw conflict('ACCOUNT_ACTION_RECOVERY_REQUIRED', 'A previous account action requires manual reconciliation.');
      }
      if (predecessor.state !== STATES.APPLIED) {
        throw conflict('ACCOUNT_ACTION_RESERVED', 'Another account action is pending for this account.');
      }
      if (predecessor.externalBoundaryVersion !== EXTERNAL_BOUNDARY_VERSION
        || predecessor.authTransitionFlight !== null
        || predecessor.authRevocationFlight !== null) {
        throw conflict('ACCOUNT_ACTION_RECOVERY_REQUIRED', 'A previous account action requires manual reconciliation.');
      }
      if (normalized.action === 'reactivate') {
        if (predecessor.desiredAuthDisabled !== true || !holdSnapshot.exists
          || holdSnapshot.data()?.intentId !== previousId
          || holdSnapshot.data()?.state !== 'applied_disable'
          || target.accountActionHoldIntentId) {
          throw conflict('ACCOUNT_ACTION_RECOVERY_REQUIRED', 'The disabled account requires manual reconciliation.');
        }
      } else if (predecessor.desiredAuthDisabled !== false || holdSnapshot.exists
        || target.accountActionHoldIntentId) {
        throw conflict('ACCOUNT_ACTION_RESERVED', 'Another account action is pending for this account.');
      }
    } else if (holdSnapshot.exists || target.accountActionHoldIntentId || normalized.action === 'reactivate') {
      throw conflict('ACCOUNT_ACTION_RECOVERY_REQUIRED', 'The account action history requires manual reconciliation.');
    }
    if (normalized.action === 'reactivate' && ['manager', 'distributor'].includes(target.role)) {
      const branchId = target.branchId;
      if (!validUid(branchId)) throw conflict('ACCOUNT_BRANCH_INVALID', 'The account branch must be reviewed before reactivation.');
      const branchSnapshot = await tx.get(db.collection('branches').doc(branchId));
      if (!branchSnapshot.exists || branchSnapshot.data()?.status !== 'active') {
        throw conflict('ACCOUNT_BRANCH_INVALID', 'The account branch must be active before reactivation.');
      }
    }
    if (normalized.action !== 'reactivate') noticeTransportCheck();
    const intent = { schemaVersion: 1, intentId, actorUid, targetUid: normalized.targetUid,
      targetRole: target.role, action: normalized.action, source: SOURCE, caseRef: null,
      reason: normalized.reason || null,
      validatedGrounds: [], payloadHash, mutationIdHash: hash(normalized.clientMutationId),
      desiredAuthDisabled: desiredAuthDisabled(normalized.action), state: STATES.AUTHORIZED,
      reservationId: normalized.targetUid, revision: 0, lease: null, observation: null,
      externalBoundaryVersion: EXTERNAL_BOUNDARY_VERSION, authTransitionFlight: null,
      authRevocationFlight: null,
      predecessorIntentId: predecessor?.intentId || null,
      noticeDelivery: authRecipient ? { state: 'pending',
        requestId: requestIdFor(intentId), recipientHash: authRecipient.hash } : null,
      reconciliation: { required: false, errorClass: null, lastCheckedAt: null },
      createdAt: now, updatedAt: now };
    const reservation = { schemaVersion: 1, targetUid: normalized.targetUid,
      intentId, state: 'reserved', createdAt: now, updatedAt: now };
    tx.create(intentRef, intent);
    if (predecessor) tx.update(reservationRef, { intentId, updatedAt: now, previousIntentId: predecessor.intentId });
    else tx.create(reservationRef, reservation);
    if (intent.desiredAuthDisabled) {
      tx.create(holdRef, { schemaVersion: 1, targetUid: normalized.targetUid,
        intentId, state: 'pending_disable', createdAt: now, updatedAt: now });
      tx.update(targetRef, { accountActionHoldIntentId: intentId });
    } else {
      tx.update(holdRef, { intentId, state: 'pending_enable', updatedAt: now });
      tx.update(targetRef, { accountActionHoldIntentId: intentId });
    }
    return safeResult(intent, true);
  });
}

function assertChatCase(report, conversation, targetUid, caseRef, intentId = null) {
  if (!report || !conversation || report.schemaVersion !== 1
    || !['open', 'escalated'].includes(report.status)
    || (report.pendingAccountActionIntentId && report.pendingAccountActionIntentId !== intentId)
    || report.reportedUid !== targetUid || !['requester', 'distributor'].includes(report.reportedRole)
    || !['requester', 'distributor', 'manager'].includes(report.reporterRole)
    || report.conversationId !== caseRef.conversationId
    || report.jurisdictionBranchId !== caseRef.branchId
    || !Array.isArray(conversation.participantUserUids)
    || !conversation.participantUserUids.includes(targetUid)
    || (report.reportedRole === 'requester' && conversation.requesterUid !== targetUid)
    || (report.reportedRole === 'distributor' && conversation.distributorUid !== targetUid)
    || (conversation.type === 'requester_distributor'
      ? !Array.isArray(conversation.branchIds) || conversation.branchIds.length !== 1
        || conversation.branchIds[0] !== caseRef.branchId
      : !Array.isArray(conversation.participantBranchIds)
        || !conversation.participantBranchIds.includes(caseRef.branchId))
    || !validUid(report.reporterUid) || report.reporterUid === targetUid
    || (report.reporterRole === 'requester' && conversation.requesterUid !== report.reporterUid)
    || (report.reporterRole === 'distributor' && conversation.distributorUid !== report.reporterUid)
    || (report.reporterRole === 'manager'
      ? !Array.isArray(conversation.participantBranchIds)
        || !conversation.participantBranchIds.includes(caseRef.branchId)
      : !conversation.participantUserUids.includes(report.reporterUid))) {
    throw conflict('MODERATION_RELATIONSHIP_INVALID', 'The chat case relationship requires review.');
  }
  assertCanonicalConversationParticipants(conversation);
}

async function authorizeChatCaseAccountIntent({ db, auth, idToken, actingUid, request,
  now = new Date(), noticeTransportCheck = () => {} }) {
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).some((key) => !['reportId', 'action', 'reason', 'privateNote', 'clientMutationId'].includes(key))
    || !validUid(request.reportId) || !['suspend_account', 'terminate_account'].includes(request.action)
    || !validReason(request.reason) || !validMutation(request.clientMutationId)
    || typeof request.privateNote !== 'string' || request.privateNote.length > 1000
    || !validDate(now)) {
    throw new OtpError(400, 'ACCOUNT_ACTION_REQUEST_INVALID', 'Choose a valid chat-case account action.');
  }
  let decoded;
  try { decoded = await auth.verifyIdToken(idToken, true); }
  catch { throw new OtpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.'); }
  if (!validUid(decoded?.uid) || !(decoded.admin === true || decoded.role === 'admin')) {
    throw new OtpError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
  }
  const actorUid = decoded.uid;
  if (actingUid !== actorUid) {
    throw new OtpError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
  }
  const intentId = actionIdentity(actorUid, request);
  const payloadHash = hash(JSON.stringify([2, CHAT_SOURCE, request.reportId, request.action,
    request.reason, request.privateNote]));
  const actorRef = db.collection('users').doc(actorUid);
  const caseRef = db.collection('chatReports').doc(request.reportId);
  const intentRef = db.collection('accountActionIntents').doc(intentId);
  const mutationRef = db.collection('moderationMutationIds').doc(hashId(actorUid, request.clientMutationId));
  return db.runTransaction(async (tx) => {
    const [actorSnap, reportSnap, intentSnap, mutationSnap] = await Promise.all([
      tx.get(actorRef), tx.get(caseRef), tx.get(intentRef), tx.get(mutationRef),
    ]);
    const actor = actorSnap.data();
    if (!actorSnap.exists || actor?.role !== 'admin' || actor.mustChangePassword === true
      || canonicalAccountStatus(actor) !== ACCOUNT_STATUS.ACTIVE || actor.accountActionHoldIntentId) {
      throw new OtpError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
    }
    if (!reportSnap.exists) throw new OtpError(404, 'MODERATION_CASE_NOT_FOUND', 'The moderation case was not found.');
    const report = reportSnap.data() || {};
    if (!validUid(report.reportedUid) || !validUid(report.conversationId)
      || !validUid(report.jurisdictionBranchId) || actorUid === report.reportedUid) {
      throw conflict('MODERATION_CASE_INVALID', 'The chat case requires review.');
    }
    const targetUid = report.reportedUid;
    const storedCaseRef = { type: CHAT_SOURCE, id: request.reportId,
      conversationId: report.conversationId, branchId: report.jurisdictionBranchId };
    const targetRef = db.collection('users').doc(targetUid);
    const conversationRef = db.collection('chatConversations').doc(report.conversationId);
    const reservationRef = db.collection('accountActionReservations').doc(targetUid);
    const holdRef = db.collection('accountAccessHolds').doc(targetUid);
    const [targetSnap, conversationSnap, reservationSnap, holdSnap] = await Promise.all([
      tx.get(targetRef), tx.get(conversationRef), tx.get(reservationRef), tx.get(holdRef),
    ]);
    const target = targetSnap.data();
    if (!targetSnap.exists || !['requester', 'distributor'].includes(target?.role)
      || target.role !== report.reportedRole) {
      throw conflict('MODERATION_TARGET_CHANGED', 'The reported account requires review.');
    }
    if (intentSnap.exists) {
      const intent = assertIntentShape(intentSnap.data(), intentId);
      if (intent.source !== CHAT_SOURCE || intent.actorUid !== actorUid
        || intent.targetUid !== targetUid || intent.targetRole !== target.role
        || intent.action !== request.action || intent.payloadHash !== payloadHash
        || JSON.stringify(intent.caseRef) !== JSON.stringify(storedCaseRef)) {
        throw conflict('ACCOUNT_ACTION_MUTATION_CONFLICT', 'This mutation ID was used for another action.');
      }
      if (!mutationSnap.exists || mutationSnap.data()?.intentId !== intentId) {
        throw conflict('ACCOUNT_ACTION_MUTATION_CONFLICT', 'The moderation mutation requires reconciliation.');
      }
      if (ACTIVE_STATES.has(intent.state)) {
        assertReservation(reservationSnap.data(), targetUid, intentId);
        if (holdSnap.data()?.intentId !== intentId || target.accountActionHoldIntentId !== intentId
          || report.pendingAccountActionIntentId !== intentId) {
          throw conflict('ACCOUNT_ACTION_HOLD_INVALID', 'The action requires reconciliation.');
        }
      }
      return safeResult(intent, false);
    }
    if (mutationSnap.exists) {
      throw conflict('ACCOUNT_ACTION_MUTATION_CONFLICT', 'This mutation ID was used for another action.');
    }
    assertChatCase(report, conversationSnap.data(), targetUid, storedCaseRef);
    const authRecipient = await verifiedRecipient(auth, targetUid, target);
    let predecessor = null;
    if (reservationSnap.exists) {
      const previousId = reservationSnap.data()?.intentId;
      if (!validHash(previousId)) throw conflict('ACCOUNT_ACTION_RESERVATION_INVALID', 'The account reservation requires reconciliation.');
      const previousSnap = await tx.get(db.collection('accountActionIntents').doc(previousId));
      predecessor = previousSnap.exists ? assertIntentShape(previousSnap.data(), previousId) : null;
      assertReservation(reservationSnap.data(), targetUid, previousId);
      if (!predecessor || predecessor.targetUid !== targetUid || predecessor.state !== STATES.APPLIED
        || predecessor.desiredAuthDisabled !== false
        || predecessor.externalBoundaryVersion !== EXTERNAL_BOUNDARY_VERSION
        || predecessor.authTransitionFlight !== null
        || predecessor.authRevocationFlight !== null || holdSnap.exists
        || target.accountActionHoldIntentId) {
        throw conflict('ACCOUNT_ACTION_RESERVED', 'Another account action is pending.');
      }
    } else if (holdSnap.exists || target.accountActionHoldIntentId) {
      throw conflict('ACCOUNT_ACTION_RESERVED', 'Another account action is pending.');
    }
    assertTargetTransition(target, request.action);
    noticeTransportCheck();
    const intent = { schemaVersion: 1, intentId, actorUid, targetUid,
      targetRole: target.role, action: request.action, source: CHAT_SOURCE,
      caseRef: storedCaseRef, reason: request.reason, privateNote: request.privateNote,
      validatedGrounds: [], payloadHash, mutationIdHash: hash(request.clientMutationId),
      desiredAuthDisabled: true, state: STATES.AUTHORIZED, reservationId: targetUid,
      revision: 0, lease: null, observation: null,
      externalBoundaryVersion: EXTERNAL_BOUNDARY_VERSION, authTransitionFlight: null,
      authRevocationFlight: null,
      predecessorIntentId: predecessor?.intentId || null,
      noticeDelivery: { state: 'pending', requestId: requestIdFor(intentId),
        recipientHash: authRecipient.hash },
      reconciliation: { required: false, errorClass: null, lastCheckedAt: null },
      createdAt: now, updatedAt: now };
    tx.create(intentRef, intent);
    tx.create(mutationRef, { actorUid, actionId: `account_${intentId}`,
      intentId, payloadHash: `account:${payloadHash}`, createdAt: now });
    if (predecessor) tx.update(reservationRef, { intentId, updatedAt: now, previousIntentId: predecessor.intentId });
    else tx.create(reservationRef, { schemaVersion: 1, targetUid, intentId,
      state: 'reserved', createdAt: now, updatedAt: now });
    tx.create(holdRef, { schemaVersion: 1, targetUid, intentId,
      state: 'pending_disable', createdAt: now, updatedAt: now });
    tx.update(targetRef, { accountActionHoldIntentId: intentId });
    tx.update(caseRef, { pendingAccountActionIntentId: intentId, updatedAt: now });
    return safeResult(intent, true);
  });
}

// Firestore-only lease primitives for a future executor. A lease grants work
// ownership, never account authorization or permission to discard a reservation.
async function claimIntentLease({ db, intentId, ownerId, now = new Date(), leaseMs = 60_000 }) {
  if (!validHash(intentId) || !validUid(ownerId) || !validDate(now)
    || !Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > MAX_LEASE_MS) {
    throw new OtpError(400, 'ACCOUNT_ACTION_LEASE_INVALID', 'The executor lease request is invalid.');
  }
  const intentRef = db.collection('accountActionIntents').doc(intentId);
  return db.runTransaction(async (tx) => {
    const intentSnapshot = await tx.get(intentRef);
    if (!intentSnapshot.exists) throw conflict('ACCOUNT_ACTION_INTENT_MISSING', 'The account action was not found.');
    const intent = assertIntentShape(intentSnapshot.data(), intentId);
    const reservationRef = db.collection('accountActionReservations').doc(intent.targetUid);
    const reservationSnapshot = await tx.get(reservationRef);
    if (!reservationSnapshot.exists) throw conflict('ACCOUNT_ACTION_RESERVATION_MISSING', 'The account reservation requires manual reconciliation.');
    assertReservation(reservationSnapshot.data(), intent.targetUid, intentId);
    if (!ACTIVE_STATES.has(intent.state)) throw conflict('ACCOUNT_ACTION_FINALIZED', 'This account action is final.');
    const holdSnapshot = await tx.get(db.collection('accountAccessHolds').doc(intent.targetUid));
    const targetSnapshot = await tx.get(db.collection('users').doc(intent.targetUid));
    if (!holdSnapshot.exists || holdSnapshot.data()?.intentId !== intentId
      || holdSnapshot.data()?.state !== (intent.desiredAuthDisabled ? 'pending_disable' : 'pending_enable')
      || !targetSnapshot.exists || targetSnapshot.data()?.accountActionHoldIntentId !== intentId) {
      throw conflict('ACCOUNT_ACTION_HOLD_INVALID', 'The account access hold requires reconciliation.');
    }
    if (intent.lease && asDate(intent.lease.expiresAt).getTime() > now.getTime()) {
      throw conflict('ACCOUNT_ACTION_LEASE_HELD', 'Another executor currently owns this action.');
    }
    const generation = (intent.lease?.generation || 0) + 1;
    const state = intent.state === STATES.APPLYING ? STATES.RECONCILE_REQUIRED : intent.state;
    const next = { ...intent, state: state === STATES.AUTHORIZED ? STATES.APPLYING : state,
      revision: intent.revision + 1, lease: { ownerId, generation, expiresAt: new Date(now.getTime() + leaseMs) },
      reconciliation: state === STATES.RECONCILE_REQUIRED
        ? { required: true, errorClass: 'prior_execution_unknown', lastCheckedAt: null }
        : intent.reconciliation, updatedAt: now };
    tx.update(intentRef, { state: next.state, revision: next.revision, lease: next.lease,
      reconciliation: next.reconciliation, updatedAt: now });
    return Object.freeze({ intentId, targetUid: intent.targetUid, state: next.state,
      ownerId, generation, expiresAt: next.lease.expiresAt.toISOString() });
  });
}

async function renewIntentLease({ db, intentId, ownerId, generation, now = new Date(), leaseMs = 60_000 }) {
  if (!validHash(intentId) || !validUid(ownerId) || !Number.isSafeInteger(generation)
    || generation < 1 || !validDate(now) || !Number.isSafeInteger(leaseMs)
    || leaseMs < 1_000 || leaseMs > MAX_LEASE_MS) {
    throw new OtpError(400, 'ACCOUNT_ACTION_LEASE_INVALID', 'The executor lease request is invalid.');
  }
  const intentRef = db.collection('accountActionIntents').doc(intentId);
  return db.runTransaction(async (tx) => {
    const intentSnapshot = await tx.get(intentRef);
    if (!intentSnapshot.exists) throw conflict('ACCOUNT_ACTION_INTENT_MISSING', 'The account action was not found.');
    const intent = assertIntentShape(intentSnapshot.data(), intentId);
    const reservationSnapshot = await tx.get(db.collection('accountActionReservations').doc(intent.targetUid));
    if (!reservationSnapshot.exists) throw conflict('ACCOUNT_ACTION_RESERVATION_MISSING', 'The account reservation requires manual reconciliation.');
    assertReservation(reservationSnapshot.data(), intent.targetUid, intentId);
    if (!ACTIVE_STATES.has(intent.state) || intent.lease?.ownerId !== ownerId
      || intent.lease.generation !== generation || asDate(intent.lease.expiresAt).getTime() <= now.getTime()) {
      throw conflict('ACCOUNT_ACTION_LEASE_STALE', 'The executor no longer owns this account action.');
    }
    const expiresAt = new Date(now.getTime() + leaseMs);
    tx.update(intentRef, { lease: { ownerId, generation, expiresAt },
      revision: intent.revision + 1, updatedAt: now });
    return Object.freeze({ intentId, ownerId, generation, expiresAt: expiresAt.toISOString() });
  });
}

module.exports = { STATES, actionIdentity, authorizeAccountActionIntent, canonicalRequest,
  authorizeChatCaseAccountIntent, assertChatCase, claimIntentLease,
  desiredAuthDisabled, payloadIdentity, renewIntentLease };
