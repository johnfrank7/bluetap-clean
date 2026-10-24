const ATTEMPT_ID = /^[a-f0-9]{64}$/;
const RESPONSIBILITY_LABELS = Object.freeze({
  requester_responsible: 'Requester responsibility',
  provider_responsible: 'Provider responsibility',
  shared: 'Shared responsibility',
  undetermined: 'Responsibility undetermined',
});

function reviewViewModel(value) {
  if (!value || !ATTEMPT_ID.test(value.attemptId)
    || typeof value.orderId !== 'string' || !value.orderId || value.orderId.length > 128
    || value.orderId.includes('/') || typeof value.orderReference !== 'string'
    || !value.orderReference || value.orderReference.length > 80) return null;
  if (value.reviewStatus === 'pending_review' && value.summary === 'Your reported delivery attempt is awaiting Manager review.'
    && value.responsibility === undefined && value.decidedAt === undefined) {
    return { attemptId: value.attemptId, orderId: value.orderId, orderReference: value.orderReference,
      reviewStatus: 'pending_review', statusLabel: 'Pending Review', summary: value.summary };
  }
  if (value.reviewStatus !== 'completed' || value.summary !== 'The Manager review of your reported delivery attempt is complete.'
    || !Object.hasOwn(RESPONSIBILITY_LABELS, value.responsibility)
    || typeof value.decidedAt !== 'string' || !Number.isFinite(Date.parse(value.decidedAt))) return null;
  return { attemptId: value.attemptId, orderId: value.orderId, orderReference: value.orderReference,
    reviewStatus: 'completed', statusLabel: 'Review Completed', summary: value.summary,
    responsibility: value.responsibility, responsibilityLabel: RESPONSIBILITY_LABELS[value.responsibility],
    decidedAt: value.decidedAt };
}

module.exports = { reviewViewModel };
