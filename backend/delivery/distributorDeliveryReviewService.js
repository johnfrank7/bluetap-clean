const { FieldPath } = require('firebase-admin/firestore');
const { attemptIdFor } = require('./deliveryAttemptService');
const { verifiedDecision, orderOwner } = require('./requesterDeliveryReportService');
const { OtpError } = require('../utils/otpError');

const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 25;
const validAttemptId = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const notFound = () => new OtpError(404, 'DELIVERY_REVIEW_NOT_FOUND', 'Delivery review not found.');
const invalidCursor = () => new OtpError(400, 'DELIVERY_REVIEW_CURSOR_INVALID', 'The review cursor is invalid.');

function pageSize(value) {
  if (value === null) return DEFAULT_PAGE_SIZE;
  if (!/^[1-9]\d*$/.test(value) || Number(value) > MAX_PAGE_SIZE) {
    throw new OtpError(400, 'DELIVERY_REVIEW_LIMIT_INVALID', `Choose a page size from 1 to ${MAX_PAGE_SIZE}.`);
  }
  return Number(value);
}

async function reviewOf(db, snapshot, distributorUid, orderCache = new Map()) {
  if (!snapshot?.exists || !validAttemptId(snapshot.id)) throw notFound();
  const attempt = snapshot.data() || {};
  if (attempt.distributorUid !== distributorUid || attempt.outcome !== 'failed'
    || typeof attempt.orderId !== 'string' || !attempt.orderId || attempt.orderId.length > 128
    || attempt.orderId.includes('/') || typeof attempt.requesterUid !== 'string' || !attempt.requesterUid
    || typeof attempt.branchId !== 'string' || !attempt.branchId
    || !Number.isSafeInteger(attempt.attemptNumber) || attempt.attemptNumber < 1
    || snapshot.id !== attemptIdFor(attempt.orderId, attempt.attemptNumber)
    || !['reported', 'resolved'].includes(attempt.reviewState)) throw notFound();
  if (!orderCache.has(attempt.orderId)) {
    orderCache.set(attempt.orderId, await db.collection('requests').doc(attempt.orderId).get());
  }
  const orderSnapshot = orderCache.get(attempt.orderId);
  if (!orderSnapshot?.exists || orderOwner(orderSnapshot.data() || {}) !== attempt.requesterUid) throw notFound();
  const order = orderSnapshot.data() || {};
  const reference = order.requestId || order.request_id || attempt.orderId;
  const orderReference = (typeof reference === 'string' ? reference.trim().slice(0, 80) : '') || attempt.orderId;
  const review = { attemptId: snapshot.id, orderId: attempt.orderId, orderReference,
    reviewStatus: attempt.reviewState === 'resolved' ? 'completed' : 'pending_review',
    summary: attempt.reviewState === 'resolved'
      ? 'The Manager review of your reported delivery attempt is complete.'
      : 'Your reported delivery attempt is awaiting Manager review.' };
  if (attempt.reviewState === 'reported') {
    if (attempt.responsibility !== 'undetermined' || attempt.managerDecision != null) throw notFound();
    return review;
  }
  try {
    const decision = await verifiedDecision(db, snapshot.id, attempt);
    return { ...review, responsibility: decision.responsibility, decidedAt: decision.decidedAt };
  } catch (error) {
    if (error instanceof OtpError && error.status === 404) throw notFound();
    throw error;
  }
}

async function reviewDetail(db, attemptId, distributorUid) {
  if (!validAttemptId(attemptId)) throw new OtpError(400, 'DELIVERY_REVIEW_ID_INVALID', 'The review ID is invalid.');
  return { review: await reviewOf(db, await db.collection('deliveryAttempts').doc(attemptId).get(), distributorUid) };
}

async function reviewList(db, { distributorUid, limit = DEFAULT_PAGE_SIZE, cursor = '' }) {
  const attempts = db.collection('deliveryAttempts');
  let query = attempts.where('distributorUid', '==', distributorUid)
    .orderBy(FieldPath.documentId()).limit(limit + 1);
  if (cursor) {
    if (!validAttemptId(cursor)) throw invalidCursor();
    const position = await attempts.doc(cursor).get();
    if (!position.exists || position.data()?.distributorUid !== distributorUid) throw invalidCursor();
    query = query.startAfter(position);
  }
  const snapshot = await query.get();
  const docs = (snapshot.docs || []).slice(0, limit);
  const reviews = [];
  const orderCache = new Map();
  for (const doc of docs) {
    try { reviews.push(await reviewOf(db, doc, distributorUid, orderCache)); }
    catch (error) { if (!(error instanceof OtpError) || error.status !== 404) throw error; }
  }
  return { reviews, nextCursor: (snapshot.docs || []).length > limit ? docs[docs.length - 1].id : null };
}

module.exports = { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageSize, reviewDetail, reviewList };
