const { FieldPath } = require('firebase-admin/firestore');
const { attemptIdFor } = require('./deliveryAttemptService');
const { OtpError } = require('../utils/otpError');
const {
  deliveryFailureReasonForCode,
  DELIVERY_CONTACT_OPTIONS,
  DELIVERY_CONTACT_METHOD_LABELS,
  DELIVERY_CONTACT_OUTCOME_LABELS,
} = require('../../constants/deliveryFailureReasons');

const MAX_PAGE_SIZE = 25;
const DEFAULT_PAGE_SIZE = 20;
const notFound = () => new OtpError(404, 'DELIVERY_REPORT_NOT_FOUND', 'Delivery report not found.');
const invalidCursor = () => new OtpError(400, 'DELIVERY_REPORT_CURSOR_INVALID', 'The report cursor is invalid.');
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128
  && value !== '.' && value !== '..' && !value.includes('/');
const validCursorId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 1500
  && value !== '.' && value !== '..' && !value.includes('/');
const validAttemptId = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function pageSize(value) {
  if (value === null) return DEFAULT_PAGE_SIZE;
  if (!/^[1-9]\d*$/.test(value) || Number(value) > MAX_PAGE_SIZE) {
    throw new OtpError(400, 'DELIVERY_REPORT_LIMIT_INVALID', `Choose a page size from 1 to ${MAX_PAGE_SIZE}.`);
  }
  return Number(value);
}

function orderOwner(order) {
  const canonical = typeof order.requesterUid === 'string' ? order.requesterUid.trim() : '';
  const legacy = typeof order.requester_id === 'string' ? order.requester_id.trim() : '';
  if (!canonical && !legacy || canonical && legacy && canonical !== legacy) throw notFound();
  return canonical || legacy;
}

async function ownedOrder(db, orderId, requesterUid, cache = new Map()) {
  if (!validId(orderId)) throw notFound();
  if (!cache.has(orderId)) {
    const snapshot = await db.collection('requests').doc(orderId).get();
    cache.set(orderId, snapshot.exists ? snapshot.data() || {} : null);
  }
  const order = cache.get(orderId);
  if (!order || orderOwner(order) !== requesterUid) throw notFound();
  return order;
}

async function verifiedAttempt(db, snapshot, requesterUid, expectedOrderId, cache) {
  if (!snapshot.exists) throw notFound();
  const attempt = snapshot.data() || {};
  if (attempt.outcome !== 'failed' || !validId(attempt.orderId)
    || expectedOrderId && attempt.orderId !== expectedOrderId
    || attempt.requesterUid !== requesterUid
    || !Number.isSafeInteger(attempt.attemptNumber) || attempt.attemptNumber < 1
    || snapshot.id !== attemptIdFor(attempt.orderId, attempt.attemptNumber)) throw notFound();
  await ownedOrder(db, attempt.orderId, requesterUid, cache);
  return attempt;
}

function isoTime(value) {
  const date = value?.toDate?.() || (value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null);
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeContactAttempts(attempt, code) {
  const options = DELIVERY_CONTACT_OPTIONS[code];
  if (attempt.reportFormat !== 'structured-v1' || !options || !Array.isArray(attempt.reportEvidence?.contactAttempts)) return [];
  return attempt.reportEvidence.contactAttempts.slice(0, 3).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || !Object.hasOwn(options, entry.method)
      || !options[entry.method].includes(entry.outcome)) return [];
    const claimedAt = isoTime(entry.claimedAt);
    return [{
      method: DELIVERY_CONTACT_METHOD_LABELS[entry.method],
      outcome: DELIVERY_CONTACT_OUTCOME_LABELS[entry.outcome],
      ...(claimedAt ? { claimedAt, claimedAtUnverified: true } : {}),
    }];
  });
}

function safeReport(id, attempt) {
  const reason = deliveryFailureReasonForCode(attempt.reportedReasonCode);
  const response = attempt.requesterResponse;
  const ownResponse = response?.status === 'submitted' && response.requesterUid === attempt.requesterUid
    && typeof response.explanation === 'string' && isoTime(response.submittedAt);
  return {
    attemptId: id,
    orderId: attempt.orderId,
    attemptNumber: attempt.attemptNumber,
    reportedReasonCode: reason?.code || null,
    reportedReasonLabel: reason?.label || 'Delivery could not be completed',
    reportedStatus: 'reported_by_distributor',
    reportReceivedAt: isoTime(attempt.reportReceivedAt) || isoTime(attempt.endedAt),
    contactAttempts: safeContactAttempts(attempt, reason?.code),
    reviewState: attempt.reviewState === 'reported' ? 'awaiting_review' : 'status_unavailable',
    requesterResponseStatus: ownResponse ? 'submitted' : 'not_submitted',
    requesterResponse: ownResponse
      ? { explanation: response.explanation, submittedAt: isoTime(response.submittedAt) }
      : null,
  };
}

async function reportDetail(db, attemptId, requesterUid, orderId = '') {
  if (!validAttemptId(attemptId)) throw new OtpError(400, 'DELIVERY_REPORT_ID_INVALID', 'The report ID is invalid.');
  const cache = new Map();
  if (orderId) await ownedOrder(db, orderId, requesterUid, cache);
  const snapshot = await db.collection('deliveryAttempts').doc(attemptId).get();
  const attempt = await verifiedAttempt(db, snapshot, requesterUid, orderId, cache);
  return { report: safeReport(snapshot.id, attempt) };
}

async function reportList(db, { requesterUid, orderId = '', limit = DEFAULT_PAGE_SIZE, cursor = '' }) {
  const cache = new Map();
  if (orderId) await ownedOrder(db, orderId, requesterUid, cache);
  const attempts = db.collection('deliveryAttempts');
  let query = orderId ? attempts.where('orderId', '==', orderId) : attempts.where('requesterUid', '==', requesterUid);
  query = query.where('outcome', '==', 'failed')
    .orderBy('endedAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(limit + 1);
  if (cursor) {
    if (!(orderId ? validAttemptId(cursor) : validCursorId(cursor))) throw invalidCursor();
    const position = await attempts.doc(cursor).get();
    try {
      if (orderId) await verifiedAttempt(db, position, requesterUid, orderId, cache);
      // A global cursor may point to a skipped record, so validate its query scope
      // without granting it report visibility or relying on its parent order.
      else if (!position.exists || position.data()?.requesterUid !== requesterUid
        || position.data()?.outcome !== 'failed') throw invalidCursor();
      if (!isoTime(position.data().endedAt)) throw invalidCursor();
    } catch (error) {
      if (error instanceof OtpError) throw invalidCursor();
      throw error;
    }
    query = query.startAfter(position);
  }
  const snapshot = await query.get();
  const docs = (snapshot.docs || []).slice(0, limit);
  const reports = [];
  for (const doc of docs) {
    try {
      const attempt = await verifiedAttempt(db, doc, requesterUid, orderId, cache);
      reports.push(safeReport(doc.id, attempt));
    } catch (error) {
      if (orderId || !(error instanceof OtpError) || error.status !== 404) throw error;
      // The global feed advances past invalid candidates without publishing their data.
    }
  }
  return { reports, nextCursor: (snapshot.docs || []).length > limit ? docs[docs.length - 1].id : null };
}

module.exports = { MAX_PAGE_SIZE, orderOwner, pageSize, reportDetail, reportList, safeReport, validAttemptId };
