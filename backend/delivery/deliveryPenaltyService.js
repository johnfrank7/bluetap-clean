const { createHash } = require('node:crypto');
const { attemptIdFor } = require('./deliveryAttemptService');
const { decisionEventIdFor } = require('./deliveryReviewPolicy');
const { canonicalAppealBasis, canonicalAppealSubmission, canonicalAppealResolution,
  appealSubmissionEventIdFor, appealResolutionEventIdFor } = require('./deliveryAppealPolicy');
const { requesterAttributableFailure } = require('../moderation/moderationService');

const PENALTY_MS = 72 * 60 * 60 * 1000;
const SCAN_LIMIT = 256;
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128
  && value.trim() === value && value !== '.' && value !== '..' && !value.includes('/');
const dateOf = (value) => value?.toDate?.() || (value instanceof Date ? value : null);
const milliseconds = (value) => {
  const date = dateOf(value);
  return date && Number.isFinite(date.getTime()) ? date.getTime() : 0;
};
const penaltyEventIdFor = (uid) => createHash('sha256').update(`first-delivery-penalty|${uid}`).digest('hex');
const secondReviewIdFor = (uid) => createHash('sha256').update(`second-delivery-streak-review|${uid}`).digest('hex');
const transitionEventIdFor = (uid, appealEventId) => createHash('sha256')
  .update(`delivery-penalty-transition|${uid}|${appealEventId}`).digest('hex');

async function verifyOutcome(reader, db, snapshot, expectedKind) {
  const attempt = snapshot?.data() || {};
  const id = snapshot?.id;
  if (!/^[a-f0-9]{64}$/.test(id || '') || !validId(attempt.orderId)
    || !validId(attempt.requesterUid) || !validId(attempt.branchId)
    || !validId(attempt.distributorUid) || !Number.isSafeInteger(attempt.attemptNumber)
    || attempt.attemptNumber < 1 || id !== attemptIdFor(attempt.orderId, attempt.attemptNumber)
    || attempt.outcome !== (expectedKind === 'ATTEMPT_FAILED' ? 'failed' : 'delivered')
    || !milliseconds(attempt.endedAt)) return null;
  const [orderSnapshot, outcomeSnapshot] = await Promise.all([
    reader.get(db.collection('requests').doc(attempt.orderId)),
    reader.get(db.collection('deliveryAttemptEvents').doc(`${id}_outcome`)),
  ]);
  const order = orderSnapshot.exists ? orderSnapshot.data() || {} : null;
  const outcome = outcomeSnapshot.exists ? outcomeSnapshot.data() || {} : null;
  const owner = order && (order.requesterUid || order.requester_id);
  if (!order || owner !== attempt.requesterUid
    || order.requesterUid && order.requester_id && order.requesterUid !== order.requester_id
    || !outcome || outcome.schemaVersion !== 1 || outcome.kind !== expectedKind
    || outcome.attemptId !== id || outcome.attemptNumber !== attempt.attemptNumber
    || outcome.orderId !== attempt.orderId || outcome.branchId !== attempt.branchId
    || outcome.distributorUid !== attempt.distributorUid || outcome.actorUid !== attempt.distributorUid
    || outcome.actorRole !== 'distributor' || outcome.outcome !== attempt.outcome
    || milliseconds(outcome.createdAt) !== milliseconds(attempt.endedAt)) return null;
  if (expectedKind === 'ATTEMPT_DELIVERED') {
    if (String(order.status || '').toLowerCase() !== 'delivered') return null;
  } else if (outcome.reportedReasonCode !== attempt.reportedReasonCode
    || milliseconds(outcome.reportReceivedAt) !== milliseconds(attempt.reportReceivedAt)) return null;
  return { attempt, order, outcome };
}

async function classifyFailure(reader, db, snapshot, overlay = {}) {
  const verified = await verifyOutcome(reader, db, snapshot, 'ATTEMPT_FAILED');
  if (!verified) return { kind: 'barrier' };
  const { attempt } = verified;
  if (attempt.reviewState !== 'resolved' || !requesterAttributableFailure(attempt.reportedReasonCode)) {
    return { kind: 'barrier' };
  }
  const id = snapshot.id;
  const isOverlay = id === overlay.attemptId;
  const managerSnapshot = await reader.get(db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(id)));
  const managerEvent = isOverlay && overlay.managerEvent
    || (managerSnapshot.exists ? managerSnapshot.data() || {} : null);
  try {
    canonicalAppealBasis(id, attempt, verified.order, managerEvent);
    let resolutionEventId = null;
    if (attempt.appeal != null || attempt.appealState != null) {
      const [submission, resolution] = await Promise.all([
        reader.get(db.collection('deliveryAttemptEvents').doc(appealSubmissionEventIdFor(id))),
        reader.get(db.collection('deliveryAttemptEvents').doc(appealResolutionEventIdFor(id))),
      ]);
      canonicalAppealSubmission(id, attempt, (isOverlay && overlay.submissionEvent)
        || (submission.exists ? submission.data() || {} : null));
      canonicalAppealResolution(id, attempt, (isOverlay && overlay.resolutionEvent)
        || (resolution.exists ? resolution.data() || {} : null));
      if (attempt.appealState === 'upheld') resolutionEventId = appealResolutionEventIdFor(id);
    } else if (attempt.effectiveResponsibility != null
      && attempt.effectiveResponsibility !== attempt.responsibility) return { kind: 'barrier' };
    if (attempt.appealState === 'submitted' || attempt.appealState === 'overturned'
      || attempt.responsibility !== 'requester_responsible'
      || (attempt.effectiveResponsibility || attempt.responsibility) !== 'requester_responsible') {
      return { kind: 'barrier' };
    }
    return { kind: 'qualifying', attemptId: id, orderId: attempt.orderId,
      outcomeEventId: `${id}_outcome`, managerDecisionEventId: decisionEventIdFor(id),
      ...(resolutionEventId ? { appealResolutionEventId: resolutionEventId } : {}) };
  } catch { return { kind: 'barrier' }; }
}

async function currentVerifiedStreak(reader, db, requesterUid, overlay = {}) {
  if (!validId(requesterUid)) return { count: 0, incidents: [], complete: false };
  const attempts = db.collection('deliveryAttempts');
  const [failed, delivered] = await Promise.all([
    reader.get(attempts.where('requesterUid', '==', requesterUid).where('outcome', '==', 'failed')
      .orderBy('endedAt', 'desc').limit(SCAN_LIMIT)),
    reader.get(attempts.where('requesterUid', '==', requesterUid).where('outcome', '==', 'delivered')
      .orderBy('endedAt', 'desc').limit(1)),
  ]);
  let lastSuccessAt = 0;
  if (delivered.docs?.length) {
    const success = await verifyOutcome(reader, db, delivered.docs[0], 'ATTEMPT_DELIVERED');
    if (!success) return { count: 0, incidents: [], complete: false };
    lastSuccessAt = milliseconds(success.attempt.endedAt);
  }
  const seenOrders = new Set();
  const incidents = [];
  for (const snapshot of failed.docs || []) {
    const stored = snapshot.data() || {};
    const endedAt = milliseconds(stored.endedAt);
    if (!endedAt) return { count: incidents.length, incidents, complete: false };
    if (lastSuccessAt && endedAt <= lastSuccessAt) break;
    if (!validId(stored.orderId)) return { count: incidents.length, incidents, complete: false };
    if (seenOrders.has(stored.orderId)) continue;
    seenOrders.add(stored.orderId);
    const candidate = snapshot.id === overlay.attemptId
      ? { id: snapshot.id, data: () => overlay.attempt } : snapshot;
    const classification = await classifyFailure(reader, db, candidate, overlay);
    if (classification.kind !== 'qualifying') break;
    incidents.push(classification);
    if (incidents.length === 3) break;
  }
  const incomplete = incidents.length < 3 && (failed.docs || []).length === SCAN_LIMIT
    && seenOrders.size < 3 && !lastSuccessAt;
  return { count: incidents.length, incidents, complete: !incomplete, lastSuccessAt };
}

function activePenalty(record, now = new Date()) {
  const penalty = record?.deliveryPenalty;
  return penalty?.state === 'active' && milliseconds(penalty.endsAt) > milliseconds(now) ? penalty : null;
}

function safePenaltyStatus(record, streak, now = new Date()) {
  const penalty = record?.deliveryPenalty;
  const valid = penalty?.schemaVersion === 1 && /^[a-f0-9]{64}$/.test(penalty.eventId || '')
    && Array.isArray(penalty.supportingAttemptIds) && penalty.supportingAttemptIds.length === 3
    && milliseconds(penalty.startsAt) && milliseconds(penalty.endsAt);
  return {
    verifiedStreak: streak?.complete ? Math.min(streak.count, 3) : null,
    restriction: valid ? {
      state: penalty.state === 'active' && milliseconds(penalty.endsAt) <= milliseconds(now)
        ? 'expired' : penalty.state,
      active: Boolean(activePenalty(record, now)),
      startsAt: dateOf(penalty.startsAt).toISOString(),
      endsAt: dateOf(penalty.endsAt).toISOString(),
    } : null,
  };
}

async function prepareFirstPenalty({ tx, db, requesterUid, now, overlay = {} }) {
  const streak = await currentVerifiedStreak(tx, db, requesterUid, overlay);
  if (!streak.complete || streak.count < 3) return { streak, writes: [] };
  const eventId = penaltyEventIdFor(requesterUid);
  const eventRef = db.collection('deliveryPenaltyEvents').doc(eventId);
  const restrictionRef = db.collection('orderingRestrictions').doc(requesterUid);
  const [existingEvent, restrictionSnapshot] = await Promise.all([
    tx.get(eventRef), tx.get(restrictionRef),
  ]);
  if (existingEvent.exists) {
    const first = existingEvent.data() || {};
    if (first.kind !== 'FIRST_VERIFIED_DELIVERY_ORDERING_RESTRICTION'
      || first.requesterUid !== requesterUid || milliseconds(first.endsAt) > now.getTime()
      || !Array.isArray(first.supportingAttemptIds)
      || first.supportingAttemptIds.some((id) => streak.incidents.some((item) => item.attemptId === id))) {
      return { streak, writes: [] };
    }
    const reviewRef = db.collection('deliveryPenaltyEvents').doc(secondReviewIdFor(requesterUid));
    const reviewSnapshot = await tx.get(reviewRef);
    if (reviewSnapshot.exists) return { streak, writes: [] };
    return { streak, adminReviewFlagged: true, writes: [
      (transaction) => transaction.create(reviewRef, { schemaVersion: 1,
        kind: 'SECOND_VERIFIED_DELIVERY_STREAK_FOR_ADMIN_REVIEW', requesterUid,
        firstPenaltyEventId: eventId, supportingAttemptIds: [...streak.incidents].reverse()
          .map((item) => item.attemptId), incidents: [...streak.incidents].reverse(), createdAt: now }),
    ] };
  }
  const endsAt = new Date(now.getTime() + PENALTY_MS);
  const incidents = [...streak.incidents].reverse();
  const penalty = { schemaVersion: 1, eventId, state: 'active', startsAt: now, endsAt,
    supportingAttemptIds: incidents.map((item) => item.attemptId) };
  const event = { ...penalty, kind: 'FIRST_VERIFIED_DELIVERY_ORDERING_RESTRICTION', requesterUid,
    incidents, createdAt: now };
  const noticeRef = db.collection('moderationNotices').doc(requesterUid).collection('items').doc(`delivery_penalty_${eventId}`);
  const current = restrictionSnapshot.exists ? restrictionSnapshot.data() || {} : {};
  return { streak, writes: [
    (tx) => tx.create(eventRef, event),
    (tx) => tx.set(restrictionRef, { ...current, deliveryPenalty: penalty, updatedAt: now }),
    (tx) => tx.create(noticeRef, { schemaVersion: 1, type: 'suspend_platform_ordering',
      title: 'Ordering temporarily restricted', category: 'verified_failed_delivery',
      scope: 'platform_ordering', reasonLabel: 'Three verified requester-attributable failed deliveries',
      targetUid: requesterUid, startsAt: now, endsAt, createdAt: now, seenAt: null, acknowledgedAt: null }),
  ] };
}

async function prepareAppealPenaltyTransition({ tx, db, requesterUid, attemptId, appealState, now }) {
  const restrictionRef = db.collection('orderingRestrictions').doc(requesterUid);
  const snapshot = await tx.get(restrictionRef);
  const current = snapshot.exists ? snapshot.data() || {} : {};
  const penalty = current.deliveryPenalty;
  if (!penalty?.supportingAttemptIds?.includes(attemptId) || !penalty.eventId
    || !['submitted', 'upheld', 'overturned'].includes(appealState)) return [];
  const eventRef = db.collection('deliveryPenaltyEvents').doc(penalty.eventId);
  const eventSnapshot = await tx.get(eventRef);
  if (!eventSnapshot.exists || eventSnapshot.data()?.requesterUid !== requesterUid) return [];
  const otherStates = await Promise.all(penalty.supportingAttemptIds.filter((id) => id !== attemptId)
    .map((id) => tx.get(db.collection('deliveryAttempts').doc(id))));
  const hasOverturn = appealState === 'overturned'
    || otherStates.some((item) => item.data()?.appealState === 'overturned');
  const hasPending = appealState === 'submitted'
    || otherStates.some((item) => item.data()?.appealState === 'submitted');
  const nextState = hasOverturn ? 'invalidated' : hasPending ? 'paused'
    : milliseconds(penalty.endsAt) > now.getTime() ? 'active' : 'expired';
  if (nextState === penalty.state) return [];
  const sourceEventId = appealState === 'submitted'
    ? appealSubmissionEventIdFor(attemptId) : appealResolutionEventIdFor(attemptId);
  const transitionRef = db.collection('deliveryPenaltyEvents').doc(transitionEventIdFor(requesterUid, sourceEventId));
  const transitionSnapshot = await tx.get(transitionRef);
  if (transitionSnapshot.exists) return [];
  const noticeRef = db.collection('moderationNotices').doc(requesterUid).collection('items')
    .doc(`delivery_penalty_${penalty.eventId}`);
  const noticeSnapshot = await tx.get(noticeRef);
  return [
    (tx) => tx.update(restrictionRef, { deliveryPenalty: { ...penalty, state: nextState,
      stateUpdatedAt: now }, updatedAt: now }),
    (tx) => tx.create(transitionRef, { schemaVersion: 1, kind: 'DELIVERY_PENALTY_STATE_CHANGED',
      requesterUid, penaltyEventId: penalty.eventId, sourceEventId, attemptId,
      previousState: penalty.state, state: nextState, createdAt: now }),
    ...(noticeSnapshot.exists ? [(tx) => tx.update(noticeRef,
      { endsAt: nextState === 'active' ? penalty.endsAt : now })] : []),
  ];
}

function stagePenaltyWrites(tx, writes) { for (const write of writes) write(tx); }

module.exports = { PENALTY_MS, SCAN_LIMIT, activePenalty, currentVerifiedStreak,
  penaltyEventIdFor, secondReviewIdFor, prepareAppealPenaltyTransition, prepareFirstPenalty, safePenaltyStatus,
  stagePenaltyWrites };
