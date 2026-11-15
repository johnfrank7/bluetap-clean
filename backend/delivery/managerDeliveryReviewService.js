const { createHash } = require('node:crypto');
const { FieldPath } = require('firebase-admin/firestore');
const { attemptIdFor } = require('./deliveryAttemptService');
const { RESPONSE_WINDOW_MS } = require('./deliveryReviewPolicy');
const { orderOwner } = require('./requesterDeliveryReportService');
const { OtpError } = require('../utils/otpError');
const {
  deliveryFailureReasonForCode,
  DELIVERY_CONTACT_OPTIONS,
  DELIVERY_CONTACT_METHOD_LABELS,
  DELIVERY_CONTACT_OUTCOME_LABELS,
} = require('../../constants/deliveryFailureReasons');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 25;
const notFound = () => new OtpError(404, 'DELIVERY_REVIEW_NOT_FOUND', 'Delivery review not found.');
const invalidCursor = () => new OtpError(400, 'DELIVERY_REVIEW_CURSOR_INVALID', 'The review cursor is invalid.');
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128
  && value.trim() === value && value !== '.' && value !== '..' && !value.includes('/');
const validAttemptId = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clean = (value, max) => Array.from(String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim()).slice(0, max).join('');
const hasOnly = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every((key) => allowed.includes(key));

function dateOf(value) {
  const date = value?.toDate?.() || (value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null);
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
}

function pageSize(value) {
  if (value === null) return DEFAULT_PAGE_SIZE;
  if (!/^[1-9]\d*$/.test(value) || Number(value) > MAX_PAGE_SIZE) {
    throw new OtpError(400, 'DELIVERY_REVIEW_LIMIT_INVALID', `Choose a page size from 1 to ${MAX_PAGE_SIZE}.`);
  }
  return Number(value);
}

function revisionFor(snapshot) {
  const seconds = snapshot.updateTime?.seconds;
  const nanoseconds = snapshot.updateTime?.nanoseconds;
  if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(nanoseconds)) throw notFound();
  return createHash('sha256').update(`${snapshot.id}|${seconds}|${nanoseconds}`).digest('base64url');
}

function contactEvidence(attempt) {
  const code = attempt.reportedReasonCode;
  const options = DELIVERY_CONTACT_OPTIONS[code];
  if (attempt.reportFormat == null) {
    if (attempt.reportEvidence != null) throw notFound();
    return { contactAttempts: [], interactionNote: null };
  }
  if (attempt.reportFormat !== 'structured-v1') throw notFound();
  const evidence = attempt.reportEvidence;
  if (!hasOnly(evidence, ['contactAttempts', 'interactionNote']) || JSON.stringify(evidence).length > 1500) throw notFound();
  if (options) {
    if (!hasOnly(evidence, ['contactAttempts']) || !Array.isArray(evidence.contactAttempts)
      || evidence.contactAttempts.length < 1 || evidence.contactAttempts.length > 3) throw notFound();
    const contactAttempts = evidence.contactAttempts.map((entry) => {
      if (!hasOnly(entry, ['method', 'outcome', 'claimedAt']) || !Object.hasOwn(options, entry.method)
        || !options[entry.method].includes(entry.outcome)) throw notFound();
      const claimedAt = entry.claimedAt === undefined ? null : dateOf(entry.claimedAt);
      if (entry.claimedAt !== undefined && !claimedAt) throw notFound();
      return {
        method: DELIVERY_CONTACT_METHOD_LABELS[entry.method],
        outcome: DELIVERY_CONTACT_OUTCOME_LABELS[entry.outcome],
        ...(claimedAt ? { claimedAt: claimedAt.toISOString(), claimedAtUnverified: true } : {}),
      };
    });
    return { contactAttempts, interactionNote: null };
  }
  if (code === 'RECIPIENT_REFUSED') {
    if (!hasOnly(evidence, ['interactionNote']) || typeof evidence.interactionNote !== 'string') throw notFound();
    const note = clean(evidence.interactionNote, 241);
    if (Array.from(note).length < 10 || Array.from(note).length > 240) throw notFound();
    return { contactAttempts: [], interactionNote: note };
  }
  if (Object.keys(evidence).length) throw notFound();
  return { contactAttempts: [], interactionNote: null };
}

function responseOf(attempt) {
  const response = attempt.requesterResponse;
  if (response == null) return null;
  const submittedAt = dateOf(response.submittedAt);
  const explanation = typeof response.explanation === 'string' ? clean(response.explanation, 501) : '';
  if (response.status !== 'submitted' || response.requesterUid !== attempt.requesterUid
    || !submittedAt || Array.from(explanation).length < 10 || Array.from(explanation).length > 500
    || !/[\p{L}\p{N}]/u.test(explanation)) throw notFound();
  return { explanation, submittedAt: submittedAt.toISOString() };
}

function candidateOf(snapshot, manager) {
  if (!snapshot?.exists || !validAttemptId(snapshot.id)) throw notFound();
  const attempt = snapshot.data() || {};
  if (!validId(attempt.orderId) || !validId(attempt.requesterUid) || !validId(attempt.distributorUid)
    || !validId(attempt.branchId) || attempt.branchId !== manager.branch.id
    || attempt.distributorUid === manager.decoded.uid
    || !Number.isSafeInteger(attempt.attemptNumber) || attempt.attemptNumber < 1
    || snapshot.id !== attemptIdFor(attempt.orderId, attempt.attemptNumber)
    || attempt.outcome !== 'failed' || !['reported', 'resolved'].includes(attempt.reviewState)
    || !['undetermined', 'requester_responsible', 'provider_responsible', 'shared'].includes(attempt.responsibility)
    || (attempt.reviewState === 'reported' && attempt.responsibility !== 'undetermined')
    || !deliveryFailureReasonForCode(attempt.reportedReasonCode)
    || (attempt.reportedReasonNote != null && (typeof attempt.reportedReasonNote !== 'string'
      || Array.from(attempt.reportedReasonNote).length > 240))
    || !dateOf(attempt.endedAt) || !dateOf(attempt.reportReceivedAt)) throw notFound();
  return attempt;
}

async function verifiedReview(db, snapshot, manager, orderCache = new Map()) {
  const attempt = candidateOf(snapshot, manager);
  if (!orderCache.has(attempt.orderId)) {
    orderCache.set(attempt.orderId, await db.collection('requests').doc(attempt.orderId).get());
  }
  return validatedReview(snapshot, orderCache.get(attempt.orderId), manager);
}

function validatedReview(snapshot, orderSnapshot, manager) {
  const attempt = candidateOf(snapshot, manager);
  contactEvidence(attempt);
  responseOf(attempt);
  if (!orderSnapshot?.exists || orderSnapshot.id !== attempt.orderId
    || orderOwner(orderSnapshot.data() || {}) !== attempt.requesterUid) throw notFound();
  return { attempt, order: orderSnapshot.data() || {} };
}

function summary(snapshot, attempt, order) {
  return {
    attemptId: snapshot.id,
    orderId: attempt.orderId,
    orderReference: clean(order.requestId || order.request_id || attempt.orderId, 80),
    attemptNumber: attempt.attemptNumber,
    reportingBranchId: attempt.branchId,
    reportedReasonLabel: deliveryFailureReasonForCode(attempt.reportedReasonCode).label,
    reportReceivedAt: dateOf(attempt.reportReceivedAt).toISOString(),
    reviewState: attempt.reviewState,
    requesterResponseStatus: attempt.requesterResponse == null ? 'not_submitted' : 'submitted',
  };
}

function detail(snapshot, attempt, order, now = new Date()) {
  const base = summary(snapshot, attempt, order);
  const evidence = contactEvidence(attempt);
  const requesterResponse = responseOf(attempt);
  const deadline = new Date(dateOf(attempt.reportReceivedAt).getTime() + RESPONSE_WINDOW_MS);
  if (!Number.isFinite(deadline.getTime())) throw notFound();
  const currentTime = dateOf(now);
  if (!currentTime) throw new Error('Invalid server time.');
  return {
    ...base,
    reportedReasonCode: attempt.reportedReasonCode,
    reportedReasonNote: clean(attempt.reportedReasonNote, 240) || null,
    contactAttempts: evidence.contactAttempts,
    interactionNote: evidence.interactionNote,
    requesterResponse,
    endedAt: dateOf(attempt.endedAt).toISOString(),
    responsibility: attempt.responsibility,
    revision: revisionFor(snapshot),
    responseDeadlineAt: deadline.toISOString(),
    canFinalizeNow: attempt.reviewState === 'reported' && (Boolean(requesterResponse) || currentTime >= deadline),
  };
}

async function reviewDetail(db, attemptId, manager, now = new Date()) {
  if (!validAttemptId(attemptId)) throw new OtpError(400, 'DELIVERY_REVIEW_ID_INVALID', 'The review ID is invalid.');
  const snapshot = await db.collection('deliveryAttempts').doc(attemptId).get();
  const { attempt, order } = await verifiedReview(db, snapshot, manager);
  return { review: detail(snapshot, attempt, order, now) };
}

async function reviewList(db, { manager, limit = DEFAULT_PAGE_SIZE, cursor = '' }) {
  const attempts = db.collection('deliveryAttempts');
  let query = attempts.where('branchId', '==', manager.branch.id)
    .where('outcome', '==', 'failed').where('reviewState', '==', 'reported')
    .orderBy('endedAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(limit + 1);
  if (cursor) {
    if (!validAttemptId(cursor)) throw invalidCursor();
    const position = await attempts.doc(cursor).get();
    const record = position.exists ? position.data() || {} : {};
    if (!position.exists || record.branchId !== manager.branch.id || record.outcome !== 'failed'
      || record.reviewState !== 'reported' || !dateOf(record.endedAt)) throw invalidCursor();
    query = query.startAfter(position);
  }
  const snapshot = await query.get();
  const docs = (snapshot.docs || []).slice(0, limit);
  const reviews = [];
  const orderCache = new Map();
  for (const doc of docs) {
    try {
      const { attempt, order } = await verifiedReview(db, doc, manager, orderCache);
      reviews.push(summary(doc, attempt, order));
    } catch (error) {
      if (!(error instanceof OtpError) || error.status !== 404) throw error;
    }
  }
  const nextCursor = (snapshot.docs || []).length > limit ? docs[docs.length - 1].id : null;
  if (nextCursor === cursor) throw invalidCursor();
  return { reviews, nextCursor };
}

module.exports = { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, RESPONSE_WINDOW_MS, pageSize, reviewDetail, reviewList, revisionFor, validatedReview };
