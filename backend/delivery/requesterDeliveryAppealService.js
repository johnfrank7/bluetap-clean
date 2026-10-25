const { OtpError } = require('../utils/otpError');
const { requireActiveAccount } = require('../auth/accountStatus');
const { attemptIdFor } = require('./deliveryAttemptService');
const { decisionEventIdFor } = require('./deliveryReviewPolicy');
const {
  APPEAL_SUBMISSION_EVENT_KIND,
  appealSubmissionEventIdFor,
  appealResolutionEventIdFor,
  canonicalAppealBasis,
  canonicalAppealSubmission,
  canonicalAppealResolution,
} = require('./deliveryAppealPolicy');

const conflict = (code, message) => new OtpError(409, code, message);
const notFound = () => new OtpError(404, 'DELIVERY_REPORT_NOT_FOUND', 'Delivery report not found.');
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128
  && value.trim() === value && value !== '.' && value !== '..' && !value.includes('/');
const validAttemptId = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const dateOf = (value) => value?.toDate?.() || (value instanceof Date ? value : null);

function orderOwner(order) {
  const canonical = typeof order.requesterUid === 'string' ? order.requesterUid.trim() : '';
  const legacy = typeof order.requester_id === 'string' ? order.requester_id.trim() : '';
  if (!canonical && !legacy || canonical && legacy && canonical !== legacy) throw notFound();
  return canonical || legacy;
}

function normalizeAppealInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new OtpError(400, 'DELIVERY_APPEAL_INVALID', 'The appeal payload is invalid.');
  }
  const allowed = ['attemptId', 'orderId', 'appealReason', 'clientMutationId'];
  const keys = Object.keys(body).sort();
  if (keys.join(',') !== allowed.sort().join(',')) {
    throw new OtpError(400, 'DELIVERY_APPEAL_INVALID', 'The appeal payload is invalid.');
  }
  if (!validAttemptId(body.attemptId) || !validId(body.orderId)) {
    throw new OtpError(400, 'DELIVERY_APPEAL_ID_INVALID', 'The appeal reference is invalid.');
  }
  if (typeof body.appealReason !== 'string') {
    throw new OtpError(400, 'DELIVERY_APPEAL_REASON_INVALID', 'Enter a factual appeal reason of 10 to 1000 characters.');
  }
  const reason = body.appealReason.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = Array.from(reason).length;
  if (length < 10 || length > 1000 || !/[\p{L}\p{N}]/u.test(reason)) {
    throw new OtpError(400, 'DELIVERY_APPEAL_REASON_INVALID', 'Enter a factual appeal reason of 10 to 1000 characters.');
  }
  if (typeof body.clientMutationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.clientMutationId)) {
    throw new OtpError(400, 'DELIVERY_MUTATION_ID_INVALID', 'Use a valid delivery mutation ID.');
  }
  return {
    attemptId: body.attemptId,
    orderId: body.orderId,
    appealReason: reason,
    clientMutationId: body.clientMutationId,
  };
}

function serializeAppeal(attempt, appealData) {
  const submittedAt = dateOf(appealData.submittedAt);
  const resolvedAt = dateOf(appealData.resolvedAt);
  return {
    attemptId: attempt.id || attempt.attemptId,
    orderId: attempt.orderId,
    state: appealData.state || 'submitted',
    appealReason: appealData.appealReason,
    submittedAt: submittedAt ? submittedAt.toISOString() : null,
    resolution: appealData.resolution || null,
    resolutionReason: appealData.resolutionReason || null,
    overturnedResponsibility: appealData.overturnedResponsibility || null,
    effectiveResponsibility: attempt.effectiveResponsibility || attempt.managerDecision?.responsibility || attempt.responsibility,
    resolvedAt: resolvedAt ? resolvedAt.toISOString() : null,
  };
}

async function submitRequesterAppeal(db, requester, body, now = () => new Date()) {
  const input = normalizeAppealInput(body);
  const requesterUid = requester.uid || requester.decoded?.uid;
  const requesterRef = db.collection('users').doc(requesterUid);
  const attemptRef = db.collection('deliveryAttempts').doc(input.attemptId);
  const orderRef = db.collection('requests').doc(input.orderId);
  const eventRef = db.collection('deliveryAttemptEvents').doc(appealSubmissionEventIdFor(input.attemptId));
  const managerEventRef = db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(input.attemptId));
  const resolutionEventRef = db.collection('deliveryAttemptEvents').doc(appealResolutionEventIdFor(input.attemptId));
  const noticeRef = db.collection('moderationNotices').doc(requesterUid).collection('items').doc(`appeal_sub_${input.attemptId}`);
  const requesterActivityRef = db.collection('moderationActivity').doc(`user_${requesterUid}`);
  const adminActivityRef = db.collection('moderationActivity').doc('admin');

  return db.runTransaction(async (tx) => {
    const requesterSnapshot = await tx.get(requesterRef);
    if (!requesterSnapshot.exists) throw new OtpError(403, 'REQUESTER_INACTIVE', 'Active account required.');
    const requesterProfile = requesterSnapshot.data() || {};
    if (requesterProfile.role !== 'requester') throw new OtpError(403, 'FORBIDDEN', 'Requester access required.');
    requireActiveAccount(requesterProfile);

    const orderSnapshot = await tx.get(orderRef);
    if (!orderSnapshot.exists) throw notFound();
    const order = orderSnapshot.data() || {};
    if (orderOwner(order) !== requesterUid) throw notFound();

    const attemptSnapshot = await tx.get(attemptRef);
    if (!attemptSnapshot.exists) throw notFound();
    const attempt = attemptSnapshot.data() || {};
    if (attempt.outcome !== 'failed' || attempt.orderId !== input.orderId || attempt.requesterUid !== requesterUid
      || attempt.attemptNumber == null || attemptSnapshot.id !== attemptIdFor(attempt.orderId, attempt.attemptNumber)) {
      throw notFound();
    }

    const managerEventSnapshot = await tx.get(managerEventRef);
    canonicalAppealBasis(input.attemptId, attempt, order,
      managerEventSnapshot.exists ? managerEventSnapshot.data() || {} : null);

    const eventSnapshot = await tx.get(eventRef);
    if (eventSnapshot.exists) {
      const event = eventSnapshot.data() || {};
      canonicalAppealSubmission(input.attemptId, attempt, event);
      const resolutionSnapshot = await tx.get(resolutionEventRef);
      canonicalAppealResolution(input.attemptId, attempt,
        resolutionSnapshot.exists ? resolutionSnapshot.data() || {} : null);
      if (event.kind === APPEAL_SUBMISSION_EVENT_KIND
        && event.attemptId === input.attemptId
        && event.requesterUid === requesterUid
        && event.clientMutationId === input.clientMutationId
        && event.appealReason === input.appealReason) {
        return {
          created: false,
          appeal: serializeAppeal({ id: input.attemptId, ...attempt }, attempt.appeal || event),
        };
      }
      throw conflict('APPEAL_ALREADY_EXISTS', 'An appeal has already been submitted for this delivery attempt.');
    }

    if (attempt.appeal || attempt.appealState) {
      throw conflict('APPEAL_ALREADY_EXISTS', 'An appeal has already been submitted for this delivery attempt.');
    }

    const submittedAt = now();
    if (!(submittedAt instanceof Date) || !Number.isFinite(submittedAt.getTime())) {
      throw new Error('Invalid server time.');
    }

    const appealRecord = {
      state: 'submitted',
      appealReason: input.appealReason,
      requesterUid,
      clientMutationId: input.clientMutationId,
      submittedAt,
    };

    const eventRecord = {
      schemaVersion: 1,
      kind: APPEAL_SUBMISSION_EVENT_KIND,
      attemptId: input.attemptId,
      attemptNumber: attempt.attemptNumber,
      orderId: input.orderId,
      branchId: attempt.branchId,
      requesterUid,
      actorUid: requesterUid,
      actorRole: 'requester',
      appealReason: input.appealReason,
      managerDecision: attempt.managerDecision,
      clientMutationId: input.clientMutationId,
      createdAt: submittedAt,
    };

    const noticeRecord = {
      schemaVersion: 1,
      type: 'delivery_appeal_submitted',
      title: 'Delivery review appeal received',
      message: 'Your delivery review appeal is awaiting Admin review.',
      targetUid: requesterUid,
      attemptId: input.attemptId,
      orderId: input.orderId,
      seenAt: null,
      acknowledgedAt: null,
      createdAt: submittedAt,
    };

    tx.update(attemptRef, {
      appeal: appealRecord,
      appealState: 'submitted',
      effectiveResponsibility: attempt.managerDecision.responsibility || attempt.responsibility,
      updatedAt: submittedAt,
    });
    tx.create(eventRef, eventRecord);
    tx.create(noticeRef, noticeRecord);
    tx.set(requesterActivityRef, { updatedAt: submittedAt }, { merge: true });
    tx.set(adminActivityRef, { updatedAt: submittedAt }, { merge: true });

    return {
      created: true,
      appeal: serializeAppeal({ id: input.attemptId, ...attempt }, appealRecord),
    };
  });
}

async function getRequesterAppeal(db, requesterUid, attemptId) {
  if (!validAttemptId(attemptId)) throw notFound();
  const attemptSnapshot = await db.collection('deliveryAttempts').doc(attemptId).get();
  if (!attemptSnapshot.exists) throw notFound();
  const attempt = attemptSnapshot.data() || {};
  if (attempt.requesterUid !== requesterUid || !attempt.appeal) throw notFound();
  if (!validId(attempt.orderId)) throw notFound();
  const [orderSnapshot, managerEventSnapshot, submissionSnapshot, resolutionSnapshot] = await Promise.all([
    db.collection('requests').doc(attempt.orderId).get(),
    db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(attemptId)).get(),
    db.collection('deliveryAttemptEvents').doc(appealSubmissionEventIdFor(attemptId)).get(),
    db.collection('deliveryAttemptEvents').doc(appealResolutionEventIdFor(attemptId)).get(),
  ]);
  canonicalAppealBasis(attemptId, attempt, orderSnapshot.exists ? orderSnapshot.data() || {} : null,
    managerEventSnapshot.exists ? managerEventSnapshot.data() || {} : null);
  canonicalAppealSubmission(attemptId, attempt, submissionSnapshot.exists ? submissionSnapshot.data() || {} : null);
  canonicalAppealResolution(attemptId, attempt, resolutionSnapshot.exists ? resolutionSnapshot.data() || {} : null);
  return { appeal: serializeAppeal({ id: attemptSnapshot.id, ...attempt }, attempt.appeal) };
}

module.exports = {
  getRequesterAppeal,
  normalizeAppealInput,
  serializeAppeal,
  submitRequesterAppeal,
};
