const { attemptIdFor } = require('./deliveryAttemptService');
const { RESPONSE_WINDOW_MS } = require('./deliveryReviewPolicy');
const { orderOwner, safeReport, validAttemptId } = require('./requesterDeliveryReportService');
const { OtpError } = require('../utils/otpError');

const EVENT_KIND = 'REQUESTER_INITIAL_RESPONSE_SUBMITTED';
const responseEventIdFor = (attemptId) => `${attemptId}_requester_response_v1`;
const conflict = () => new OtpError(409, 'DELIVERY_RESPONSE_CONFLICT', 'This delivery report already has a response or is no longer awaiting review.');
const notFound = () => new OtpError(404, 'DELIVERY_REPORT_NOT_FOUND', 'Delivery report not found.');

function normalizeResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).sort().join(',') !== 'attemptId,clientMutationId,explanation') {
    throw new OtpError(400, 'DELIVERY_RESPONSE_INVALID', 'The response payload is invalid.');
  }
  const { attemptId, clientMutationId } = body;
  if (!validAttemptId(attemptId)) throw new OtpError(400, 'DELIVERY_REPORT_ID_INVALID', 'The report ID is invalid.');
  if (typeof clientMutationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(clientMutationId)) {
    throw new OtpError(400, 'DELIVERY_MUTATION_ID_INVALID', 'Use a valid delivery mutation ID.');
  }
  if (typeof body.explanation !== 'string') {
    throw new OtpError(400, 'DELIVERY_RESPONSE_TEXT_INVALID', 'Enter a factual explanation of 10 to 500 characters.');
  }
  const explanation = body.explanation.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = Array.from(explanation).length;
  if (length < 10 || length > 500 || !/[\p{L}\p{N}]/u.test(explanation)) {
    throw new OtpError(400, 'DELIVERY_RESPONSE_TEXT_INVALID', 'Enter a factual explanation of 10 to 500 characters.');
  }
  return { attemptId, clientMutationId, explanation };
}

function assertOwnedAttempt(attemptSnapshot, orderSnapshot, requesterUid) {
  if (!attemptSnapshot.exists) throw notFound();
  const attempt = attemptSnapshot.data() || {};
  if (!orderSnapshot?.exists || !attempt.orderId || orderSnapshot.id !== attempt.orderId
    || attempt.requesterUid !== requesterUid || orderOwner(orderSnapshot.data() || {}) !== requesterUid
    || !Number.isSafeInteger(attempt.attemptNumber) || attempt.attemptNumber < 1
    || attemptSnapshot.id !== attemptIdFor(attempt.orderId, attempt.attemptNumber)) throw notFound();
  return attempt;
}

async function submitInitialResponse(db, requesterUid, body, now = () => new Date()) {
  const input = normalizeResponse(body);
  const attemptRef = db.collection('deliveryAttempts').doc(input.attemptId);
  const eventRef = db.collection('deliveryAttemptEvents').doc(responseEventIdFor(input.attemptId));
  return db.runTransaction(async (tx) => {
    const attemptSnapshot = await tx.get(attemptRef);
    if (!attemptSnapshot.exists) throw notFound();
    const candidate = attemptSnapshot.data() || {};
    if (typeof candidate.orderId !== 'string' || !candidate.orderId || candidate.orderId.includes('/') || candidate.orderId.length > 128) throw notFound();
    const orderSnapshot = await tx.get(db.collection('requests').doc(candidate.orderId));
    const eventSnapshot = await tx.get(eventRef);
    const attempt = assertOwnedAttempt(attemptSnapshot, orderSnapshot, requesterUid);
    if (attempt.outcome !== 'failed') throw notFound();

    const prior = attempt.requesterResponse;
    if (prior !== undefined && prior !== null) {
      if (prior.status !== 'submitted' || prior.requesterUid !== requesterUid
        || prior.clientMutationId !== input.clientMutationId || prior.explanation !== input.explanation
        || !prior.submittedAt || !eventSnapshot.exists) throw conflict();
      const event = eventSnapshot.data() || {};
      if (event.kind !== EVENT_KIND || event.attemptId !== input.attemptId
        || event.requesterUid !== requesterUid || event.clientMutationId !== input.clientMutationId
        || event.explanation !== input.explanation) throw conflict();
      return { report: safeReport(input.attemptId, attempt) };
    }
    if (eventSnapshot.exists || attempt.reviewState !== 'reported' || attempt.responsibility !== 'undetermined') throw conflict();

    const submittedAt = now();
    if (!(submittedAt instanceof Date) || !Number.isFinite(submittedAt.getTime())) throw new Error('Invalid server time.');
    const receivedAt = attempt.reportReceivedAt?.toDate?.()
      || (attempt.reportReceivedAt instanceof Date ? attempt.reportReceivedAt : null);
    if (!receivedAt || !Number.isFinite(receivedAt.getTime())
      || !Number.isFinite(receivedAt.getTime() + RESPONSE_WINDOW_MS)
      || receivedAt.getTime() > submittedAt.getTime()
      || submittedAt.getTime() >= receivedAt.getTime() + RESPONSE_WINDOW_MS) throw conflict();
    const response = { status: 'submitted', requesterUid, explanation: input.explanation,
      submittedAt, clientMutationId: input.clientMutationId };
    tx.update(attemptRef, { requesterResponse: response, updatedAt: submittedAt });
    tx.create(eventRef, {
      schemaVersion: 1, kind: EVENT_KIND, attemptId: input.attemptId,
      attemptNumber: attempt.attemptNumber, orderId: attempt.orderId,
      requesterUid, actorUid: requesterUid, actorRole: 'requester',
      explanation: input.explanation, clientMutationId: input.clientMutationId, createdAt: submittedAt,
    });
    return { report: safeReport(input.attemptId, { ...attempt, requesterResponse: response }) };
  });
}

module.exports = { EVENT_KIND, normalizeResponse, responseEventIdFor, submitInitialResponse };
