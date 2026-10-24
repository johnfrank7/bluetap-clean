const { OtpError } = require('../utils/otpError');
const { requireActiveAccount } = require('../auth/accountStatus');
const { validatedReview, revisionFor, RESPONSE_WINDOW_MS } = require('./managerDeliveryReviewService');
const { DECISION_EVENT_KIND, DECISION_RESPONSIBILITIES, decisionEventIdFor } = require('./deliveryReviewPolicy');

const EVENT_KIND = DECISION_EVENT_KIND;
const RESPONSIBILITIES = DECISION_RESPONSIBILITIES;
const conflict = () => new OtpError(409, 'DELIVERY_REVIEW_CONFLICT', 'This delivery review has changed or has already been decided.');
const notFound = () => new OtpError(404, 'DELIVERY_REVIEW_NOT_FOUND', 'Delivery review not found.');
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128
  && value.trim() === value && value !== '.' && value !== '..' && !value.includes('/');
const dateOf = (value) => value?.toDate?.() || (value instanceof Date ? value : null);

function normalizeDecision(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).sort().join(',') !== 'attemptId,clientMutationId,decisionReason,expectedRevision,orderId,responsibility') {
    throw new OtpError(400, 'DELIVERY_DECISION_INVALID', 'The decision payload is invalid.');
  }
  if (typeof body.attemptId !== 'string' || !/^[a-f0-9]{64}$/.test(body.attemptId)
    || !validId(body.orderId)) {
    throw new OtpError(400, 'DELIVERY_REVIEW_ID_INVALID', 'The review reference is invalid.');
  }
  if (!RESPONSIBILITIES.has(body.responsibility)) {
    throw new OtpError(400, 'DELIVERY_RESPONSIBILITY_INVALID', 'Choose a supported responsibility outcome.');
  }
  if (typeof body.decisionReason !== 'string') {
    throw new OtpError(400, 'DELIVERY_DECISION_REASON_INVALID', 'Enter a factual reason of 10 to 500 characters.');
  }
  const decisionReason = body.decisionReason.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = Array.from(decisionReason).length;
  if (length < 10 || length > 500 || !/[\p{L}\p{N}]/u.test(decisionReason)) {
    throw new OtpError(400, 'DELIVERY_DECISION_REASON_INVALID', 'Enter a factual reason of 10 to 500 characters.');
  }
  if (typeof body.expectedRevision !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.expectedRevision)) {
    throw new OtpError(400, 'DELIVERY_REVIEW_REVISION_INVALID', 'Refresh this review before deciding.');
  }
  if (typeof body.clientMutationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.clientMutationId)) {
    throw new OtpError(400, 'DELIVERY_MUTATION_ID_INVALID', 'Use a valid delivery mutation ID.');
  }
  return { attemptId: body.attemptId, orderId: body.orderId, responsibility: body.responsibility,
    decisionReason, expectedRevision: body.expectedRevision, clientMutationId: body.clientMutationId };
}

function resultOf(event) {
  const decidedAt = dateOf(event.createdAt);
  if (!decidedAt || !Number.isFinite(decidedAt.getTime())) throw conflict();
  return { decision: { attemptId: event.attemptId, orderId: event.orderId,
    reportingBranchId: event.branchId, reviewState: 'resolved',
    responsibility: event.responsibility, decisionReason: event.decisionReason,
    decidedAt: decidedAt.toISOString() } };
}

function exactReplay(attempt, event, input, manager) {
  const saved = attempt.managerDecision;
  const eventTime = dateOf(event.createdAt);
  const savedTime = dateOf(saved?.decidedAt);
  return attempt.reviewState === 'resolved' && attempt.responsibility === input.responsibility
    && event.kind === EVENT_KIND && event.attemptId === input.attemptId && event.orderId === input.orderId
    && event.attemptNumber === attempt.attemptNumber
    && event.branchId === manager.branch.id && event.managerUid === manager.decoded.uid
    && event.actorUid === manager.decoded.uid && event.actorRole === 'manager'
    && event.previousReviewState === 'reported' && event.reviewState === 'resolved'
    && event.responsibility === input.responsibility && event.decisionReason === input.decisionReason
    && event.expectedRevision === input.expectedRevision && event.clientMutationId === input.clientMutationId
    && saved?.managerUid === manager.decoded.uid && saved.responsibility === input.responsibility
    && saved.decisionReason === input.decisionReason && saved.expectedRevision === input.expectedRevision
    && saved.clientMutationId === input.clientMutationId && eventTime && savedTime
    && eventTime.getTime() === savedTime.getTime();
}

async function submitManagerDecision(db, manager, body, now = () => new Date()) {
  const input = normalizeDecision(body);
  const managerRef = db.collection('users').doc(manager.decoded.uid);
  const attemptRef = db.collection('deliveryAttempts').doc(input.attemptId);
  const eventRef = db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(input.attemptId));
  return db.runTransaction(async (tx) => {
    const managerSnapshot = await tx.get(managerRef);
    const profile = managerSnapshot.data() || {};
    if (!managerSnapshot.exists || profile.role !== 'manager' || profile.mustChangePassword === true
      || profile.managerStatus !== 'active') {
      throw new OtpError(403, 'MANAGER_INACTIVE', 'Active Manager access is required.');
    }
    requireActiveAccount(profile);
    const branchId = typeof profile.branchId === 'string' ? profile.branchId.trim() : '';
    if (!branchId || branchId !== manager.branch.id || branchId.includes('/')) {
      throw new OtpError(403, 'BRANCH_ACCESS_DENIED', 'Manager branch access has changed.');
    }
    const branchSnapshot = await tx.get(db.collection('branches').doc(branchId));
    if (!branchSnapshot.exists || branchSnapshot.data()?.status !== 'active') {
      throw new OtpError(403, 'BRANCH_INACTIVE', 'The Manager branch is inactive.');
    }
    const attemptSnapshot = await tx.get(attemptRef);
    if (!attemptSnapshot.exists) throw notFound();
    const candidate = attemptSnapshot.data() || {};
    if (!validId(candidate.orderId)) throw notFound();
    const orderSnapshot = await tx.get(db.collection('requests').doc(candidate.orderId));
    const eventSnapshot = await tx.get(eventRef);
    const { attempt } = validatedReview(attemptSnapshot, orderSnapshot, manager);
    if (attempt.orderId !== input.orderId) throw notFound();

    if (eventSnapshot.exists) {
      const event = eventSnapshot.data() || {};
      if (!exactReplay(attempt, event, input, manager)) throw conflict();
      return resultOf(event);
    }
    if (attempt.reviewState !== 'reported' || attempt.responsibility !== 'undetermined'
      || attempt.managerDecision != null || revisionFor(attemptSnapshot) !== input.expectedRevision) throw conflict();
    const decidedAt = now();
    if (!(decidedAt instanceof Date) || !Number.isFinite(decidedAt.getTime())) throw new Error('Invalid server time.');
    const receivedAt = dateOf(attempt.reportReceivedAt);
    if (!receivedAt || !Number.isFinite(receivedAt.getTime())) throw conflict();
    const deadline = receivedAt.getTime() + RESPONSE_WINDOW_MS;
    if (!Number.isFinite(deadline)) throw conflict();
    if (attempt.requesterResponse == null && decidedAt.getTime() < deadline) {
      throw new OtpError(409, 'DELIVERY_RESPONSE_WINDOW_OPEN', 'Wait for the Requester response window or a submitted response.');
    }
    const managerDecision = { managerUid: manager.decoded.uid, responsibility: input.responsibility,
      decisionReason: input.decisionReason, expectedRevision: input.expectedRevision,
      clientMutationId: input.clientMutationId, decidedAt };
    const event = { schemaVersion: 1, kind: EVENT_KIND, attemptId: input.attemptId,
      attemptNumber: attempt.attemptNumber, orderId: input.orderId, branchId,
      managerUid: manager.decoded.uid, actorUid: manager.decoded.uid, actorRole: 'manager',
      previousReviewState: 'reported', reviewState: 'resolved',
      responsibility: input.responsibility, decisionReason: input.decisionReason,
      expectedRevision: input.expectedRevision, clientMutationId: input.clientMutationId,
      createdAt: decidedAt };
    tx.update(attemptRef, { reviewState: 'resolved', responsibility: input.responsibility,
      managerDecision, updatedAt: decidedAt });
    tx.create(eventRef, event);
    return resultOf(event);
  });
}

module.exports = { EVENT_KIND, decisionEventIdFor, normalizeDecision, submitManagerDecision };
