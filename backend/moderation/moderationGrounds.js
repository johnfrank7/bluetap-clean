const { OtpError } = require('../utils/otpError');
const { attemptIdFor } = require('../delivery/deliveryAttemptService');
const { decisionEventIdFor } = require('../delivery/deliveryReviewPolicy');
const { decisionFromEvent } = require('../delivery/requesterDeliveryReportService');
const { appealSubmissionEventIdFor, appealResolutionEventIdFor,
  canonicalAppealSubmission, canonicalAppealResolution } = require('../delivery/deliveryAppealPolicy');
const { cancellationConcern, hashId, timeOf } = require('./moderationService');

const MAX_GROUNDS = 5;
const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const invalid = () => new OtpError(409, 'MODERATION_GROUND_INELIGIBLE', 'A selected incident is not verified for this action.');

function selectedIncidentIds(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_GROUNDS || value.some((id) => !validHash(id))
    || new Set(value).size !== value.length) {
    throw new OtpError(400, 'MODERATION_GROUNDS_INVALID', 'Select up to five distinct incident references.');
  }
  return value;
}

function canonicalIdentity(order, field, legacyField) {
  const canonical = order[field];
  const legacy = order[legacyField];
  if (typeof canonical !== 'string' && typeof legacy !== 'string') return '';
  const left = typeof canonical === 'string' ? canonical.trim() : '';
  const right = typeof legacy === 'string' ? legacy.trim() : '';
  return left && right && left !== right ? '' : left || right;
}

function serverTime(value) {
  return value instanceof Date && Number.isFinite(value.getTime())
    || typeof value?.toDate === 'function' && Number.isFinite(value.toDate().getTime())
    ? timeOf(value) : 0;
}

async function validatedGroundsInTransaction(tx, db, reviewId, review, incidentIds) {
  if (!incidentIds.length || reviewId !== hashId(review.branchId, review.requesterUid)
    || !Array.isArray(review.incidents) || !review.requesterUid || !review.branchId) throw invalid();
  const grounds = [];
  for (const incidentId of incidentIds) {
    const matches = review.incidents.filter((item) => (item.incidentId || item.key) === incidentId);
    if (matches.length !== 1) throw invalid();
    const incident = matches[0];
    if (incident.type !== 'delivery_failure' && incident.type !== 'cancellation') throw invalid();
    const orderId = incident.orderId;
    if (typeof orderId !== 'string' || !orderId || orderId.includes('/')) throw invalid();
    const orderSnapshot = await tx.get(db.collection('requests').doc(orderId));
    const order = orderSnapshot.exists ? orderSnapshot.data() || {} : null;
    if (!order || canonicalIdentity(order, 'requesterUid', 'requester_id') !== review.requesterUid) throw invalid();

    if (incident.type === 'cancellation') {
      const stage = incident.stage;
      const cancelledAt = serverTime(order.cancelledAt);
      if (incident.incidentId != null && incident.incidentId !== incident.key
        || incident.key !== hashId(orderId, 'cancellation', 'REQUESTER_CANCELLED', stage, timeOf(incident.at))
        || incident.category !== 'REQUESTER_CANCELLED' || incident.concern !== cancellationConcern(stage)
        || incident.concern === 'low' || String(order.status).toLowerCase() !== 'cancelled'
        || ![order.branchId, order.currentBranchId].includes(review.branchId)
        || order.cancellationActorRole !== 'requester' || order.cancellationStageSnapshot !== stage
        || !cancelledAt || cancelledAt !== serverTime(incident.at)) throw invalid();
      grounds.push({ incidentId, type: 'cancellation', orderId, cancelledAt: order.cancelledAt });
      continue;
    }

    const attemptId = incident.attemptId;
    if (!validHash(attemptId) || incident.incidentId !== hashId('delivery_failure', attemptId)
      || incident.key !== incident.incidentId || incident.requesterUid !== review.requesterUid
      || incident.reportingBranchId !== review.branchId || incident.sourceEventId !== `${attemptId}_outcome`) throw invalid();
    const attemptSnapshot = await tx.get(db.collection('deliveryAttempts').doc(attemptId));
    const attempt = attemptSnapshot.exists ? attemptSnapshot.data() || {} : null;
    const effectiveResponsibility = attempt?.effectiveResponsibility || attempt?.responsibility;
    if (!attempt || !Number.isSafeInteger(attempt.attemptNumber) || attempt.attemptNumber < 1
      || attemptId !== attemptIdFor(orderId, attempt.attemptNumber) || attempt.orderId !== orderId
      || attempt.requesterUid !== review.requesterUid || attempt.branchId !== review.branchId
      || attempt.outcome !== 'failed' || attempt.reviewState !== 'resolved'
      || attempt.responsibility !== 'requester_responsible'
      || effectiveResponsibility !== 'requester_responsible'
      || (attempt.appeal != null || attempt.appealState != null)
        && (attempt.appealState !== 'upheld' || attempt.appeal?.state !== 'upheld')
      || attempt.reportedReasonCode !== incident.category
      || !serverTime(attempt.reportReceivedAt) || serverTime(attempt.reportReceivedAt) !== serverTime(incident.at)) throw invalid();
    if (attempt.appeal != null || attempt.appealState != null) {
      const submissionSnapshot = await tx.get(db.collection('deliveryAttemptEvents').doc(appealSubmissionEventIdFor(attemptId)));
      const resolutionSnapshot = await tx.get(db.collection('deliveryAttemptEvents').doc(appealResolutionEventIdFor(attemptId)));
      try {
        canonicalAppealSubmission(attemptId, attempt, submissionSnapshot.exists ? submissionSnapshot.data() || {} : null);
        canonicalAppealResolution(attemptId, attempt, resolutionSnapshot.exists ? resolutionSnapshot.data() || {} : null);
      } catch { throw invalid(); }
    }
    const failedSnapshot = await tx.get(db.collection('deliveryAttemptEvents').doc(incident.sourceEventId));
    const failed = failedSnapshot.exists ? failedSnapshot.data() || {} : null;
    if (!failed || failed.schemaVersion !== 1 || failed.kind !== 'ATTEMPT_FAILED'
      || failed.attemptId !== attemptId || failed.attemptNumber !== attempt.attemptNumber
      || failed.orderId !== orderId || failed.branchId !== review.branchId
      || failed.distributorUid !== attempt.distributorUid || failed.actorUid !== attempt.distributorUid
      || failed.actorRole !== 'distributor' || failed.outcome !== 'failed'
      || failed.reportedReasonCode !== incident.category
      || serverTime(failed.createdAt) !== serverTime(incident.at)
      || serverTime(failed.reportReceivedAt) !== serverTime(attempt.reportReceivedAt)) throw invalid();
    const decisionId = decisionEventIdFor(attemptId);
    const decisionSnapshot = await tx.get(db.collection('deliveryAttemptEvents').doc(decisionId));
    if (!decisionSnapshot.exists) throw invalid();
    try { decisionFromEvent(attemptId, attempt, decisionSnapshot.data() || {}); }
    catch { throw invalid(); }
    if (serverTime(decisionSnapshot.data()?.createdAt) < serverTime(attempt.reportReceivedAt)) throw invalid();
    grounds.push({ incidentId, type: 'delivery_failure', orderId, attemptId,
      failedOutcomeEventId: incident.sourceEventId, managerDecisionEventId: decisionId,
      reportingBranchId: review.branchId });
  }
  return grounds;
}

module.exports = { MAX_GROUNDS, selectedIncidentIds, validatedGroundsInTransaction };
