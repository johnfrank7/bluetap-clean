const { randomUUID } = require('node:crypto');
const { OtpError } = require('../utils/otpError');
const { canonicalAccountStatus } = require('./accountStatus');
const { STATES, assertChatCase, claimIntentLease } = require('./accountActionIntentService');
const { noticeForAction, publicUidOf } = require('../moderation/moderationService');
const { ensureNoticeAccepted } = require('./accountActionNotice');

const conflict = (reason) => new OtpError(409, reason, 'This account action requires reconciliation.');
const when = (value) => value instanceof Date ? value : value?.toDate?.();
const statusFor = Object.freeze({ deactivate: 'inactive', suspend: 'suspended',
  terminate: 'terminated', suspend_account: 'suspended', terminate_account: 'terminated' });
const auditActionFor = Object.freeze({ deactivate: 'ACCOUNT_DEACTIVATED',
  suspend: 'ACCOUNT_SUSPENDED', terminate: 'ACCOUNT_TERMINATED',
  suspend_account: 'ACCOUNT_SUSPENDED', terminate_account: 'ACCOUNT_TERMINATED' });

function assertSupported(intent) {
  if (!intent || intent.schemaVersion !== 1
    || !['admin_account', 'chat_report'].includes(intent.source)
    || !(Object.hasOwn(statusFor, intent.action) || intent.source === 'admin_account'
      && intent.action === 'reactivate')
    || intent.desiredAuthDisabled !== (intent.action !== 'reactivate')
    || intent.targetUid !== intent.reservationId
    || (intent.source === 'admin_account' ? intent.caseRef !== null
      : intent.caseRef?.type !== 'chat_report' || !intent.caseRef?.id
        || !intent.caseRef?.conversationId || !intent.caseRef?.branchId)
    || !Array.isArray(intent.validatedGrounds) || intent.validatedGrounds.length !== 0
    || intent.externalBoundaryVersion !== 1
    || (intent.desiredAuthDisabled
      ? intent.noticeDelivery?.requestId == null || intent.noticeDelivery?.recipientHash == null
      : intent.noticeDelivery !== null || !intent.predecessorIntentId)
    || (intent.authTransitionFlight !== null &&
      (!intent.authTransitionFlight || !intent.authTransitionFlight.ownerId
        || !Number.isSafeInteger(intent.authTransitionFlight.generation)))
    || (intent.authRevocationFlight !== null &&
      (!intent.authRevocationFlight || !intent.authRevocationFlight.ownerId
        || !Number.isSafeInteger(intent.authRevocationFlight.generation)))) {
    throw conflict('ACCOUNT_ACTION_SOURCE_UNSUPPORTED');
  }
}

async function assertLeaseAndAuthority({ db, auth, intentId, ownerId, generation, now, actingUid }) {
  const intentSnap = await db.collection('accountActionIntents').doc(intentId).get();
  if (!intentSnap.exists) throw conflict('ACCOUNT_ACTION_INTENT_MISSING');
  const intent = intentSnap.data();
  assertSupported(intent);
  const [reservation, hold, target, actor] = await Promise.all([
    db.collection('accountActionReservations').doc(intent.targetUid).get(),
    db.collection('accountAccessHolds').doc(intent.targetUid).get(),
    db.collection('users').doc(intent.targetUid).get(),
    db.collection('users').doc(actingUid || intent.actorUid).get(),
  ]);
  if (intent.intentId !== intentId || ![STATES.APPLYING, STATES.RECONCILE_REQUIRED].includes(intent.state)
    || intent.lease?.ownerId !== ownerId || intent.lease?.generation !== generation
    || !when(intent.lease?.expiresAt) || when(intent.lease.expiresAt).getTime() <= now.getTime()
    || reservation.data()?.intentId !== intentId || reservation.data()?.state !== 'reserved'
    || hold.data()?.intentId !== intentId
    || hold.data()?.state !== (intent.desiredAuthDisabled ? 'pending_disable' : 'pending_enable')
    || target.data()?.accountActionHoldIntentId !== intentId
    || target.data()?.role !== intent.targetRole || !actor.exists || actor.data()?.role !== 'admin'
    || actor.data()?.mustChangePassword === true || canonicalAccountStatus(actor.data()) !== 'active'
    || actor.data()?.accountActionHoldIntentId) throw conflict('ACCOUNT_ACTION_AUTHORITY_CHANGED');
  const actorAuth = await auth.getUser(actingUid || intent.actorUid);
  if (actorAuth.disabled || !(actorAuth.customClaims?.admin === true || actorAuth.customClaims?.role === 'admin')) {
    throw conflict('ACCOUNT_ACTION_AUTHORITY_CHANGED');
  }
  if (intent.source === 'chat_report') {
    const [report, conversation] = await Promise.all([
      db.collection('chatReports').doc(intent.caseRef.id).get(),
      db.collection('chatConversations').doc(intent.caseRef.conversationId).get(),
    ]);
    assertChatCase(report.data(), conversation.data(), intent.targetUid, intent.caseRef, intentId);
  }
  return intent;
}

async function updateProgress({ db, intentId, ownerId, generation, now, fields }) {
  const ref = db.collection('accountActionIntents').doc(intentId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const intent = snap.data();
    if (!snap.exists || ![STATES.APPLYING, STATES.RECONCILE_REQUIRED].includes(intent.state)
      || intent.lease?.ownerId !== ownerId || intent.lease?.generation !== generation) {
      throw conflict('ACCOUNT_ACTION_LEASE_STALE');
    }
    const reservation = await tx.get(db.collection('accountActionReservations').doc(intent.targetUid));
    if (reservation.data()?.intentId !== intentId) throw conflict('ACCOUNT_ACTION_RESERVATION_INVALID');
    tx.update(ref, { ...fields, revision: intent.revision + 1, updatedAt: now });
  });
}

async function markUncertain({ db, intentId, ownerId, generation, now, errorClass }) {
  try {
    await updateProgress({ db, intentId, ownerId, generation, now, fields: {
      state: STATES.RECONCILE_REQUIRED,
      reconciliation: { required: true, errorClass, lastCheckedAt: now },
    } });
  } catch { /* A lost lease leaves applying; its expiry drives the next reconciliation. */ }
}

async function beginExternalCall({ db, intentId, ownerId, generation, now, field }) {
  if (!['authTransitionFlight', 'authRevocationFlight'].includes(field)) throw new TypeError('Unsupported external call');
  const ref = db.collection('accountActionIntents').doc(intentId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const intent = snap.data();
    assertSupported(intent);
    const reservation = await tx.get(db.collection('accountActionReservations').doc(intent.targetUid));
    const hold = await tx.get(db.collection('accountAccessHolds').doc(intent.targetUid));
    const target = await tx.get(db.collection('users').doc(intent.targetUid));
    if (!snap.exists || ![STATES.APPLYING, STATES.RECONCILE_REQUIRED].includes(intent.state)
      || intent.lease?.ownerId !== ownerId || intent.lease?.generation !== generation
      || when(intent.lease.expiresAt)?.getTime() <= now.getTime()
      || intent.authTransitionFlight !== null || intent.authRevocationFlight !== null
      || reservation.data()?.intentId !== intentId
      || hold.data()?.intentId !== intentId || target.data()?.accountActionHoldIntentId !== intentId) {
      throw conflict('ACCOUNT_ACTION_EXTERNAL_UNRESOLVED');
    }
    tx.update(ref, { [field]: { ownerId, generation,
      desiredDisabled: intent.desiredAuthDisabled, startedAt: now },
    revision: intent.revision + 1, updatedAt: now });
  });
}

// Completion is recorded even if the lease changed while the external call was
// running. A stale owner can clear only its own call marker, never finalize.
async function completeExternalCall({ db, intentId, ownerId, generation, now, field }) {
  if (!['authTransitionFlight', 'authRevocationFlight'].includes(field)) throw new TypeError('Unsupported external call');
  const ref = db.collection('accountActionIntents').doc(intentId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const flight = snap.data()?.[field];
    if (!snap.exists || flight?.ownerId !== ownerId || flight.generation !== generation) {
      throw conflict('ACCOUNT_ACTION_EXTERNAL_UNRESOLVED');
    }
    tx.update(ref, { [field]: null, [`${field}CompletedAt`]: now,
      revision: snap.data().revision + 1, updatedAt: now });
  });
}

async function finalizeObservedDisable({ db, intentId, ownerId, generation, now, actingUid }) {
  const intentRef = db.collection('accountActionIntents').doc(intentId);
  return db.runTransaction(async (tx) => {
    const intentSnap = await tx.get(intentRef);
    const intent = intentSnap.data();
    assertSupported(intent);
    if (!intentSnap.exists || ![STATES.APPLYING, STATES.RECONCILE_REQUIRED].includes(intent.state)
      || intent.lease?.ownerId !== ownerId || intent.lease?.generation !== generation
      || when(intent.lease.expiresAt).getTime() <= now.getTime()
      || intent.authTransitionFlight !== null || intent.authRevocationFlight !== null
      || intent.noticeDelivery?.state !== 'accepted'
      || intent.observation?.disabled !== true || intent.observation?.revocationAcknowledged !== true) {
      throw conflict('ACCOUNT_ACTION_FINALIZATION_UNVERIFIED');
    }
    const targetRef = db.collection('users').doc(intent.targetUid);
    const holdRef = db.collection('accountAccessHolds').doc(intent.targetUid);
    const reservationRef = db.collection('accountActionReservations').doc(intent.targetUid);
    const actorRef = db.collection('users').doc(actingUid || intent.actorUid);
    const reportRef = intent.source === 'chat_report'
      ? db.collection('chatReports').doc(intent.caseRef.id) : null;
    const conversationRef = reportRef
      ? db.collection('chatConversations').doc(intent.caseRef.conversationId) : null;
    const [target, hold, reservation, actor] = await Promise.all([
      tx.get(targetRef), tx.get(holdRef), tx.get(reservationRef), tx.get(actorRef),
    ]);
    const report = reportRef ? await tx.get(reportRef) : null;
    const conversation = conversationRef ? await tx.get(conversationRef) : null;
    if (!target.exists || target.data()?.role !== intent.targetRole
      || target.data()?.accountActionHoldIntentId !== intentId
      || hold.data()?.intentId !== intentId || hold.data()?.state !== 'pending_disable'
      || reservation.data()?.intentId !== intentId || reservation.data()?.state !== 'reserved'
      || !actor.exists || actor.data()?.role !== 'admin' || canonicalAccountStatus(actor.data()) !== 'active'
      || actor.data()?.accountActionHoldIntentId) {
      throw conflict('ACCOUNT_ACTION_FINALIZATION_CONFLICT');
    }
    const current = canonicalAccountStatus(target.data());
    if (current !== 'active') throw conflict('ACCOUNT_ACTION_TARGET_CHANGED');
    if (reportRef) assertChatCase(report.data(), conversation.data(), intent.targetUid, intent.caseRef, intentId);
    const nextStatus = statusFor[intent.action];
    const changes = { accountStatus: nextStatus, accountActionHoldIntentId: '',
      updatedAt: now, updatedBy: actingUid || intent.actorUid,
      ...(intent.targetRole === 'requester' ? { status: nextStatus[0].toUpperCase() + nextStatus.slice(1) } : {}) };
    tx.update(targetRef, changes);
    tx.update(holdRef, { state: 'applied_disable', updatedAt: now });
    tx.update(intentRef, { state: STATES.APPLIED, lease: null, revision: intent.revision + 1,
      reconciliation: { required: false, errorClass: null, lastCheckedAt: now }, updatedAt: now });
    tx.create(db.collection('adminAuditLogs').doc(`account_action_${intentId}`), {
      action: auditActionFor[intent.action], actorUid: intent.actorUid,
      executedByUid: actingUid || intent.actorUid,
      targetUid: intent.targetUid, role: intent.targetRole, source: intent.source,
      reason: intent.reason || null,
      intentId, before: { accountStatus: current }, after: { accountStatus: nextStatus }, createdAt: now,
    });
    if (reportRef) {
      const actionId = `account_${intentId}`;
      const source = report.data();
      tx.create(db.collection('moderationActions').doc(actionId), {
        schemaVersion: 1, reportId: intent.caseRef.id, targetUid: intent.targetUid,
        targetPublicUidSnapshot: publicUidOf(target.data()) || source.reportedPublicUidSnapshot || '',
        targetRole: intent.targetRole, scope: 'account', action: intent.action,
        startsAt: intent.createdAt, reasonCategory: source.category || '',
        reason: intent.reason, privateNote: intent.privateNote,
        actorUid: intent.actorUid, actorPublicUidSnapshot: publicUidOf(actor.data()),
        actorRole: 'admin', createdAt: now, accountActionIntentId: intentId,
      });
      if (intent.action === 'suspend_account') {
        tx.create(db.collection('moderationNotices').doc(intent.targetUid).collection('items').doc(actionId),
          noticeForAction({ actionId, action: intent.action, scope: 'account',
            category: source.category || '', startsAt: intent.createdAt, createdAt: now }));
      }
      tx.update(reportRef, { status: 'resolved', pendingAccountActionIntentId: '',
        reviewedByUid: intent.actorUid, reviewedByPublicUidSnapshot: publicUidOf(actor.data()),
        reviewedByRole: 'admin', reviewedAt: now, actionTaken: intent.action,
        resolvedAt: now, updatedAt: now });
      tx.set(db.collection('moderationActivity').doc(`user_${intent.targetUid}`),
        { uid: intent.targetUid, updatedAt: now, revision: intentId });
      tx.set(db.collection('moderationActivity').doc('admin'),
        { updatedAt: now, revision: intentId });
      tx.set(db.collection('moderationActivity').doc(`branch_${intent.caseRef.branchId}`),
        { branchId: intent.caseRef.branchId, updatedAt: now, revision: intentId });
    }
    return { intentId, state: STATES.APPLIED, targetUid: intent.targetUid, accountStatus: nextStatus };
  });
}

async function finalizeObservedEnable({ db, intentId, ownerId, generation, now, actingUid }) {
  const intentRef = db.collection('accountActionIntents').doc(intentId);
  return db.runTransaction(async (tx) => {
    const intentSnap = await tx.get(intentRef);
    const intent = intentSnap.data();
    assertSupported(intent);
    if (!intentSnap.exists || intent.action !== 'reactivate'
      || ![STATES.APPLYING, STATES.RECONCILE_REQUIRED].includes(intent.state)
      || intent.lease?.ownerId !== ownerId || intent.lease?.generation !== generation
      || when(intent.lease.expiresAt)?.getTime() <= now.getTime()
      || intent.authTransitionFlight !== null || intent.authRevocationFlight !== null
      || intent.observation?.disabled !== false) {
      throw conflict('ACCOUNT_ACTION_FINALIZATION_UNVERIFIED');
    }
    const targetRef = db.collection('users').doc(intent.targetUid);
    const holdRef = db.collection('accountAccessHolds').doc(intent.targetUid);
    const [target, hold, reservation, actor, predecessor] = await Promise.all([
      tx.get(targetRef), tx.get(holdRef),
      tx.get(db.collection('accountActionReservations').doc(intent.targetUid)),
      tx.get(db.collection('users').doc(actingUid || intent.actorUid)),
      tx.get(db.collection('accountActionIntents').doc(intent.predecessorIntentId)),
    ]);
    const branch = ['manager', 'distributor'].includes(intent.targetRole)
      ? await tx.get(db.collection('branches').doc(target.data()?.branchId || '__invalid__')) : null;
    if (!target.exists || target.data()?.role !== intent.targetRole
      || target.data()?.accountActionHoldIntentId !== intentId
      || !['inactive', 'suspended'].includes(canonicalAccountStatus(target.data()))
      || !hold.exists || hold.data()?.intentId !== intentId || hold.data()?.state !== 'pending_enable'
      || reservation.data()?.intentId !== intentId || !actor.exists
      || actor.data()?.role !== 'admin' || canonicalAccountStatus(actor.data()) !== 'active'
      || actor.data()?.accountActionHoldIntentId
      || !predecessor.exists || predecessor.data()?.state !== STATES.APPLIED
      || predecessor.data()?.targetUid !== intent.targetUid
      || predecessor.data()?.authTransitionFlight !== null
      || predecessor.data()?.authRevocationFlight !== null
      || (branch && branch.data()?.status !== 'active')) {
      throw conflict('ACCOUNT_ACTION_FINALIZATION_CONFLICT');
    }
    const previousStatus = canonicalAccountStatus(target.data());
    tx.update(targetRef, { accountStatus: 'active', accountActionHoldIntentId: '',
      updatedAt: now, updatedBy: actingUid || intent.actorUid,
      ...(intent.targetRole === 'requester' ? { status: 'Active' } : {}) });
    tx.delete(holdRef);
    tx.update(intentRef, { state: STATES.APPLIED, lease: null, revision: intent.revision + 1,
      reconciliation: { required: false, errorClass: null, lastCheckedAt: now }, updatedAt: now });
    tx.create(db.collection('adminAuditLogs').doc(`account_action_${intentId}`), {
      action: 'ACCOUNT_REACTIVATED', actorUid: intent.actorUid,
      executedByUid: actingUid || intent.actorUid, targetUid: intent.targetUid,
      role: intent.targetRole, source: intent.source, intentId,
      before: { accountStatus: previousStatus }, after: { accountStatus: 'active' }, createdAt: now,
    });
    return { intentId, state: STATES.APPLIED, targetUid: intent.targetUid, accountStatus: 'active' };
  });
}

async function resumePendingIntent({ db, auth, intentId, actingUid, ownerId = randomUUID(),
  now = () => new Date(), leaseMs = 60_000, sendEmail }) {
  const startedAt = now();
  const lease = await claimIntentLease({ db, intentId, ownerId, now: startedAt, leaseMs });
  try {
    const intent = await assertLeaseAndAuthority({ db, auth, intentId, ownerId, generation: lease.generation, now: now(), actingUid });
    if (intent.desiredAuthDisabled) {
      await ensureNoticeAccepted({ db, auth, intentId, ownerId,
        generation: lease.generation, now, sendEmail });
    }
    const before = await auth.getUser(intent.targetUid);
    if (before.uid !== intent.targetUid) throw conflict('ACCOUNT_ACTION_TARGET_CHANGED');
    if (intent.authTransitionFlight !== null || intent.authRevocationFlight !== null) {
      throw conflict('ACCOUNT_ACTION_EXTERNAL_UNRESOLVED');
    }
    if (before.disabled !== intent.desiredAuthDisabled) {
      await assertLeaseAndAuthority({ db, auth, intentId, ownerId, generation: lease.generation, now: now(), actingUid });
      await beginExternalCall({ db, intentId, ownerId, generation: lease.generation,
        now: now(), field: 'authTransitionFlight' });
      await auth.updateUser(intent.targetUid, { disabled: intent.desiredAuthDisabled });
      await completeExternalCall({ db, intentId, ownerId, generation: lease.generation,
        now: now(), field: 'authTransitionFlight' });
    }
    if (!intent.desiredAuthDisabled) {
      const observed = await auth.getUser(intent.targetUid);
      if (observed.uid !== intent.targetUid || observed.disabled !== false) {
        throw conflict('ACCOUNT_ACTION_AUTH_OBSERVATION_MISMATCH');
      }
      await updateProgress({ db, intentId, ownerId, generation: lease.generation, now: now(), fields: {
        observation: { disabled: false, observedAt: now(), revocationAcknowledged: false },
      } });
      return await finalizeObservedEnable({ db, intentId, ownerId, generation: lease.generation,
        now: now(), actingUid });
    }
    // A returned call is the evidence. An unknown result retains its flight marker.
    await assertLeaseAndAuthority({ db, auth, intentId, ownerId, generation: lease.generation, now: now(), actingUid });
    await beginExternalCall({ db, intentId, ownerId, generation: lease.generation,
      now: now(), field: 'authRevocationFlight' });
    await auth.revokeRefreshTokens(intent.targetUid);
    await completeExternalCall({ db, intentId, ownerId, generation: lease.generation,
      now: now(), field: 'authRevocationFlight' });
    const observed = await auth.getUser(intent.targetUid);
    if (observed.uid !== intent.targetUid || observed.disabled !== true) {
      throw conflict('ACCOUNT_ACTION_AUTH_OBSERVATION_MISMATCH');
    }
    await updateProgress({ db, intentId, ownerId, generation: lease.generation, now: now(), fields: {
      observation: { disabled: true, observedAt: now(), revocationAcknowledged: true,
        tokensValidAfterTime: observed.tokensValidAfterTime || null },
    } });
    return await finalizeObservedDisable({ db, intentId, ownerId, generation: lease.generation, now: now(), actingUid });
  } catch (error) {
    await markUncertain({ db, intentId, ownerId, generation: lease.generation, now: now(),
      errorClass: error instanceof OtpError ? error.reason : 'external_or_firestore_unknown' });
    throw error;
  }
}

module.exports = { resumePendingIntent };
