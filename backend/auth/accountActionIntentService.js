const { createHash } = require('node:crypto');
const { OtpError } = require('../utils/otpError');
const { ACCOUNT_STATUS, canonicalAccountStatus } = require('./accountStatus');

// Foundation only. No live route calls this module, and it never calls Auth mutation APIs.
const SOURCE = 'admin_account';
const ACTIONS = new Set(['deactivate', 'suspend', 'terminate', 'reactivate']);
const TARGET_ROLES = new Set(['requester', 'distributor', 'manager']);
const STATES = Object.freeze({ AUTHORIZED: 'authorized', APPLYING: 'applying',
  APPLIED: 'applied', RECONCILE_REQUIRED: 'reconcile_required', FAILED: 'failed' });
const ACTIVE_STATES = new Set([STATES.AUTHORIZED, STATES.APPLYING, STATES.RECONCILE_REQUIRED]);
const MAX_LEASE_MS = 5 * 60 * 1000;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const validUid = (value) => typeof value === 'string' && value.length >= 1 && value.length <= 128
  && value.trim() === value && !value.includes('/');
const validMutation = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const asDate = (value) => value instanceof Date ? value : value?.toDate?.();
const validDate = (value) => asDate(value) instanceof Date && Number.isFinite(asDate(value).getTime());
const conflict = (reason, message) => new OtpError(409, reason, message);

function canonicalRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    || !['action', 'targetUid', 'clientMutationId', 'source'].every((key) =>
      Object.prototype.hasOwnProperty.call(input, key))
    || Object.keys(input).some((key) => !['action', 'targetUid', 'clientMutationId', 'source'].includes(key))
    || input.source !== SOURCE || !ACTIONS.has(input.action)
    || !validUid(input.targetUid) || !validMutation(input.clientMutationId)) {
    throw new OtpError(400, 'ACCOUNT_ACTION_REQUEST_INVALID', 'Choose a valid account action and target.');
  }
  return Object.freeze({ action: input.action, targetUid: input.targetUid,
    clientMutationId: input.clientMutationId, source: SOURCE });
}

function actionIdentity(actorUid, request) {
  return hash(JSON.stringify(['account_action_intent_v1', actorUid, request.clientMutationId]));
}

function payloadIdentity(request) {
  return hash(JSON.stringify([1, request.source, request.action, request.targetUid]));
}

function desiredAuthDisabled(action) { return action !== 'reactivate'; }

function assertTargetTransition(profile, action) {
  const current = canonicalAccountStatus(profile);
  if (action === 'reactivate') {
    if (![ACCOUNT_STATUS.INACTIVE, ACCOUNT_STATUS.SUSPENDED].includes(current)) {
      throw conflict('ACCOUNT_NOT_REACTIVATABLE', 'Only inactive or suspended accounts can be reactivated.');
    }
  } else if (action === 'terminate') {
    if (current === ACCOUNT_STATUS.TERMINATED) throw conflict('ACCOUNT_ALREADY_TERMINATED', 'The account is already terminated.');
  } else if (current !== ACCOUNT_STATUS.ACTIVE) {
    throw conflict('ACCOUNT_NOT_ACTIVE', 'Only an active account can receive this action.');
  }
}

function assertIntentShape(intent, id) {
  if (!intent || intent.schemaVersion !== 1 || intent.intentId !== id || !validHash(id)
    || !validUid(intent.actorUid) || !validUid(intent.targetUid)
    || !TARGET_ROLES.has(intent.targetRole) || intent.caseRef !== null
    || !Array.isArray(intent.validatedGrounds) || intent.validatedGrounds.length !== 0
    || intent.source !== SOURCE || !ACTIONS.has(intent.action)
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

async function authorizeAccountActionIntent({ db, auth, idToken, request, now = new Date() }) {
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
  const payloadHash = payloadIdentity(normalized);
  const actorRef = db.collection('users').doc(actorUid);
  const targetRef = db.collection('users').doc(normalized.targetUid);
  const intentRef = db.collection('accountActionIntents').doc(intentId);
  const reservationRef = db.collection('accountActionReservations').doc(normalized.targetUid);
  return db.runTransaction(async (tx) => {
    // All authority, identity, reservation and replay reads precede every write.
    const actorSnapshot = await tx.get(actorRef);
    const targetSnapshot = await tx.get(targetRef);
    const intentSnapshot = await tx.get(intentRef);
    const reservationSnapshot = await tx.get(reservationRef);
    const actor = actorSnapshot.exists ? actorSnapshot.data() || {} : null;
    if (!actor || actor.role !== 'admin' || actor.mustChangePassword === true
      || canonicalAccountStatus(actor) !== ACCOUNT_STATUS.ACTIVE) {
      throw new OtpError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
    }
    const target = targetSnapshot.exists ? targetSnapshot.data() || {} : null;
    if (!target || !TARGET_ROLES.has(target.role)) throw new OtpError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
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
      }
      return safeResult(intent, false);
    }
    if (reservationSnapshot.exists) {
      // A lease expiring never releases this reservation. Only a later, observed
      // finalization policy may replace it, and that policy is not implemented here.
      throw conflict('ACCOUNT_ACTION_RESERVED', 'Another account action is pending for this account.');
    }
    assertTargetTransition(target, normalized.action);
    if (normalized.action === 'reactivate' && ['manager', 'distributor'].includes(target.role)) {
      const branchId = target.branchId;
      if (!validUid(branchId)) throw conflict('ACCOUNT_BRANCH_INVALID', 'The account branch must be reviewed before reactivation.');
      const branchSnapshot = await tx.get(db.collection('branches').doc(branchId));
      if (!branchSnapshot.exists || branchSnapshot.data()?.status !== 'active') {
        throw conflict('ACCOUNT_BRANCH_INVALID', 'The account branch must be active before reactivation.');
      }
    }
    const intent = { schemaVersion: 1, intentId, actorUid, targetUid: normalized.targetUid,
      targetRole: target.role, action: normalized.action, source: SOURCE, caseRef: null,
      validatedGrounds: [], payloadHash, mutationIdHash: hash(normalized.clientMutationId),
      desiredAuthDisabled: desiredAuthDisabled(normalized.action), state: STATES.AUTHORIZED,
      reservationId: normalized.targetUid, revision: 0, lease: null, observation: null,
      reconciliation: { required: false, errorClass: null, lastCheckedAt: null },
      createdAt: now, updatedAt: now };
    const reservation = { schemaVersion: 1, targetUid: normalized.targetUid,
      intentId, state: 'reserved', createdAt: now, updatedAt: now };
    tx.create(intentRef, intent);
    tx.create(reservationRef, reservation);
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
  claimIntentLease, desiredAuthDisabled, payloadIdentity, renewIntentLease };
