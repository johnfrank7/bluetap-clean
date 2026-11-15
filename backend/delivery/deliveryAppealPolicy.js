const APPEAL_SUBMISSION_EVENT_KIND = 'REQUESTER_DELIVERY_APPEAL';
const APPEAL_RESOLUTION_EVENT_KIND = 'ADMIN_APPEAL_RESOLUTION';

const appealSubmissionEventIdFor = (attemptId) => `${attemptId}_requester_appeal_v1`;
const appealResolutionEventIdFor = (attemptId) => `${attemptId}_admin_appeal_resolution_v1`;

const APPEAL_RESOLUTIONS = Object.freeze(new Set(['upheld', 'overturned']));
const OVERTURNED_RESPONSIBILITIES = Object.freeze(new Set(['provider_responsible', 'shared', 'undetermined']));
const { OtpError } = require('../utils/otpError');
const { attemptIdFor } = require('./deliveryAttemptService');
const { decisionFromEvent, orderOwner } = require('./requesterDeliveryReportService');

const invalid = () => new OtpError(404, 'DELIVERY_APPEAL_NOT_FOUND', 'Delivery appeal not found.');
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128
  && value.trim() === value && !value.includes('/') && value !== '.' && value !== '..';
const validAttemptId = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const dateOf = (value) => {
  const date = value?.toDate?.() || (value instanceof Date ? value : null);
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
};

function canonicalAppealBasis(id, attempt, order, managerEvent) {
  if (!validAttemptId(id) || !validId(attempt?.orderId) || !validId(attempt?.requesterUid)
    || !validId(attempt?.branchId) || !Number.isSafeInteger(attempt?.attemptNumber)
    || attempt.attemptNumber < 1 || id !== attemptIdFor(attempt.orderId, attempt.attemptNumber)
    || attempt.outcome !== 'failed' || attempt.reviewState !== 'resolved' || !order) throw invalid();
  try {
    if (orderOwner(order) !== attempt.requesterUid) throw invalid();
    return decisionFromEvent(id, attempt, managerEvent);
  } catch { throw invalid(); }
}

function canonicalAppealSubmission(id, attempt, event) {
  const appeal = attempt?.appeal;
  const submittedAt = dateOf(appeal?.submittedAt);
  if (!appeal || !['submitted', 'upheld', 'overturned'].includes(attempt.appealState)
    || appeal.state !== attempt.appealState || appeal.requesterUid !== attempt.requesterUid
    || typeof appeal.appealReason !== 'string' || Array.from(appeal.appealReason).length < 10
    || Array.from(appeal.appealReason).length > 1000 || !submittedAt
    || !/^[A-Za-z0-9_-]{8,128}$/.test(appeal.clientMutationId || '')
    || event?.schemaVersion !== 1 || event.kind !== APPEAL_SUBMISSION_EVENT_KIND
    || event.attemptId !== id || event.attemptNumber !== attempt.attemptNumber
    || event.orderId !== attempt.orderId || event.branchId !== attempt.branchId
    || event.requesterUid !== attempt.requesterUid || event.actorUid !== attempt.requesterUid
    || event.actorRole !== 'requester' || event.appealReason !== appeal.appealReason
    || event.clientMutationId !== appeal.clientMutationId
    || dateOf(event.createdAt)?.getTime() !== submittedAt.getTime()) throw invalid();
  return appeal;
}

function canonicalAppealResolution(id, attempt, event) {
  if (attempt.appealState === 'submitted') {
    if (event || attempt.appeal?.resolution || attempt.effectiveResponsibility !== attempt.responsibility) throw invalid();
    return null;
  }
  const appeal = attempt.appeal;
  const expectedEffective = appeal.state === 'overturned'
    ? appeal.overturnedResponsibility : attempt.responsibility;
  if (!event || event.schemaVersion !== 1 || event.kind !== APPEAL_RESOLUTION_EVENT_KIND
    || event.attemptId !== id || event.attemptNumber !== attempt.attemptNumber
    || event.orderId !== attempt.orderId || event.branchId !== attempt.branchId
    || event.requesterUid !== attempt.requesterUid || event.actorRole !== 'admin'
    || !validId(event.adminUid) || event.actorUid !== event.adminUid
    || appeal.adminUid !== event.adminUid || appeal.resolution !== appeal.state
    || event.resolution !== appeal.state || !APPEAL_RESOLUTIONS.has(event.resolution)
    || event.resolutionReason !== appeal.resolutionReason
    || event.overturnedResponsibility !== appeal.overturnedResponsibility
    || event.originalManagerResponsibility !== attempt.responsibility
    || event.effectiveResponsibility !== expectedEffective
    || attempt.effectiveResponsibility !== expectedEffective
    || event.clientMutationId !== appeal.resolutionMutationId
    || !dateOf(appeal.resolvedAt)
    || dateOf(event.createdAt)?.getTime() !== dateOf(appeal.resolvedAt).getTime()
    || (appeal.state === 'overturned' && !OVERTURNED_RESPONSIBILITIES.has(appeal.overturnedResponsibility))
    || (appeal.state === 'upheld' && appeal.overturnedResponsibility != null)) throw invalid();
  return appeal;
}

module.exports = {
  APPEAL_SUBMISSION_EVENT_KIND,
  APPEAL_RESOLUTION_EVENT_KIND,
  appealSubmissionEventIdFor,
  appealResolutionEventIdFor,
  APPEAL_RESOLUTIONS,
  OVERTURNED_RESPONSIBILITIES,
  canonicalAppealBasis,
  canonicalAppealSubmission,
  canonicalAppealResolution,
  dateOf,
  validId,
  validAttemptId,
};
