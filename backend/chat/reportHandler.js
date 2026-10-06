const { randomUUID } = require('node:crypto');
const { REPORT_CATEGORY_BY_CODE } = require('../../constants/reportCategories');
const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { verifiedIdentity } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { authorizeConversation } = require('./chatHandler');
const {
  REPORT_DUPLICATE_WINDOW_MS,
  REPORT_RATE_LIMIT,
  REPORT_RATE_WINDOW_MS,
  boundedText,
  clean,
  hashId,
  publicUidOf,
  timeOf,
} = require('../moderation/moderationService');

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'INVALID_REPORT_REQUEST', 'The report request is invalid.'); }
}

function requireOnlyReportFields(body = {}) {
  const allowed = new Set(['conversationId', 'messageId', 'orderId', 'category', 'details']);
  const unexpected = Object.keys(body).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new OtpError(400, 'REPORT_AUTHORITY_SERVER_OWNED', 'BlueTap derives report participants and jurisdiction.');
}

function reportCategory(value, details) {
  const code = clean(value, 64).toUpperCase();
  const category = REPORT_CATEGORY_BY_CODE[code];
  if (!category) throw new OtpError(400, 'REPORT_CATEGORY_INVALID', 'Choose a supported report category.');
  const normalizedDetails = boundedText(details, { required: code === 'OTHER', max: 1000, reason: 'REPORT_DETAILS_TOO_LONG' });
  return { ...category, details: normalizedDetails };
}

function withId(snapshot) {
  return snapshot?.exists ? { id: snapshot.id, ...(snapshot.data() || {}) } : null;
}

function oppositeParticipant(conversation, callerUid, callerRole, reportedMessageSenderUid = null) {
  const requesterUid = clean(conversation.requesterUid, 128);
  const distributorUid = clean(conversation.distributorUid, 128);

  if (callerRole === 'requester') {
    if (conversation.type === 'requester_distributor' && callerUid === requesterUid && distributorUid) {
      return { uid: distributorUid, role: 'distributor' };
    }
    throw new OtpError(403, 'REPORT_RELATIONSHIP_REQUIRED', 'This conversation does not provide a reportable user relationship.');
  }

  if (callerRole === 'distributor') {
    if (conversation.type === 'requester_distributor' && callerUid === distributorUid && requesterUid) {
      return { uid: requesterUid, role: 'requester' };
    }
    throw new OtpError(403, 'REPORT_RELATIONSHIP_REQUIRED', 'This conversation does not provide a reportable user relationship.');
  }

  if (callerRole === 'manager') {
    if (conversation.type === 'requester_branch') {
      if (!requesterUid) throw new OtpError(403, 'REPORT_RELATIONSHIP_REQUIRED', 'Requester participant not found in this conversation.');
      if (requesterUid === callerUid) throw new OtpError(403, 'REPORT_SELF_FORBIDDEN', 'You cannot report yourself.');
      return { uid: requesterUid, role: 'requester' };
    }
    if (conversation.type === 'distributor_branch') {
      if (!distributorUid) throw new OtpError(403, 'REPORT_RELATIONSHIP_REQUIRED', 'Distributor participant not found in this conversation.');
      if (distributorUid === callerUid) throw new OtpError(403, 'REPORT_SELF_FORBIDDEN', 'You cannot report yourself.');
      return { uid: distributorUid, role: 'distributor' };
    }
    if (conversation.type === 'requester_distributor') {
      if (reportedMessageSenderUid) {
        if (reportedMessageSenderUid === requesterUid) return { uid: requesterUid, role: 'requester' };
        if (reportedMessageSenderUid === distributorUid) return { uid: distributorUid, role: 'distributor' };
      }
      throw new OtpError(400, 'REPORT_TARGET_REQUIRED', 'Choose a message from the requester or distributor to report in this order conversation.');
    }
  }

  throw new OtpError(403, 'REPORT_RELATIONSHIP_REQUIRED', 'This conversation does not provide a reportable user relationship.');
}

function evidenceMessage(message = {}) {
  return {
    messageId: clean(message.id, 128),
    seq: Number(message.seq || 0),
    senderPublicUidSnapshot: clean(message.senderPublicUidSnapshot, 80),
    senderRole: clean(message.senderRole, 30),
    body: boundedText(message.body, { max: 2000, reason: 'REPORT_EVIDENCE_INVALID' }),
    createdAt: message.createdAt || null,
  };
}

async function evidenceForReport(tx, conversationRef, messageId, targetUid) {
  if (messageId) {
    const reportedSnapshot = await tx.get(conversationRef.collection('messages').doc(messageId));
    if (!reportedSnapshot.exists) throw new OtpError(404, 'REPORT_MESSAGE_NOT_FOUND', 'The selected message was not found.');
    const reported = withId(reportedSnapshot);
    if (clean(reported.senderUid, 128) !== targetUid) {
      throw new OtpError(403, 'REPORT_MESSAGE_NOT_ELIGIBLE', 'Only an incoming message from the reported user can be reported.');
    }
    const seq = Number(reported.seq);
    const snapshot = await tx.get(conversationRef.collection('messages')
      .where('seq', '>=', Math.max(1, seq - 2)).where('seq', '<=', seq + 2).orderBy('seq', 'asc').limit(5));
    const messages = (snapshot.docs || []).map(withId);
    if (!messages.some((message) => message.id === messageId)) throw new OtpError(409, 'REPORT_EVIDENCE_UNAVAILABLE', 'The selected message could not be captured safely.');
    const sourceMessages = messages.slice(0, 5);
    return { evidence: sourceMessages.map(evidenceMessage), sourceMessages };
  }
  const snapshot = await tx.get(conversationRef.collection('messages').orderBy('seq', 'desc').limit(5));
  const sourceMessages = (snapshot.docs || []).map(withId).reverse();
  return { evidence: sourceMessages.map(evidenceMessage), sourceMessages };
}

function rateRecord(current = {}, nowMs) {
  const recent = (Array.isArray(current.timestamps) ? current.timestamps : [])
    .map(timeOf).filter((timestamp) => timestamp > nowMs - REPORT_RATE_WINDOW_MS).sort((a, b) => a - b);
  if (recent.length >= REPORT_RATE_LIMIT) {
    const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + REPORT_RATE_WINDOW_MS - nowMs) / 1000));
    throw new OtpError(429, 'REPORT_RATE_LIMITED', 'Too many reports were submitted. Try again later.', { retryAfterSeconds });
  }
  recent.push(nowMs);
  return { timestamps: recent.map((timestamp) => new Date(timestamp)), cleanupAfter: new Date(nowMs + REPORT_RATE_WINDOW_MS), updatedAt: new Date(nowMs) };
}

async function submitReport({ db, callerUid, callerClaims, body, now, createReportId = randomUUID }) {
  requireOnlyReportFields(body);
  const conversationId = clean(body.conversationId, 128);
  const messageId = clean(body.messageId, 128);
  const suppliedOrderId = clean(body.orderId, 128);
  if (!conversationId) throw new OtpError(400, 'REPORT_CONVERSATION_REQUIRED', 'Choose a conversation to report.');
  const category = reportCategory(body.category, body.details);
  const nowMs = timeOf(now);
  const conversationRef = db.collection('chatConversations').doc(conversationId);

  return db.runTransaction(async (tx) => {
    const conversationSnapshot = await tx.get(conversationRef);
    if (!conversationSnapshot.exists) throw new OtpError(404, 'REPORT_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
    const conversation = withId(conversationSnapshot);
    const authorization = await authorizeConversation(tx, db, conversation, callerUid, callerClaims, 'read', nowMs);
    const reporter = authorization.caller;

    let reportedMessageSenderUid = null;
    if (messageId) {
      const reportedSnapshot = await tx.get(conversationRef.collection('messages').doc(messageId));
      if (!reportedSnapshot.exists) throw new OtpError(404, 'REPORT_MESSAGE_NOT_FOUND', 'The selected message was not found.');
      const reportedMsg = withId(reportedSnapshot);
      reportedMessageSenderUid = clean(reportedMsg.senderUid, 128);
    }

    const target = oppositeParticipant(conversation, callerUid, reporter.role, reportedMessageSenderUid);
    if (target.uid === callerUid) {
      throw new OtpError(403, 'REPORT_SELF_FORBIDDEN', 'You cannot report yourself.');
    }

    const targetSnapshot = await tx.get(db.collection('users').doc(target.uid));
    const targetProfile = targetSnapshot.exists ? targetSnapshot.data() || {} : null;
    if (!targetProfile || clean(targetProfile.role, 30) !== target.role) {
      throw new OtpError(403, 'REPORT_RELATIONSHIP_REQUIRED', 'The reported user relationship is no longer valid.');
    }
    if (['admin', 'manager'].includes(clean(targetProfile.role, 30))) {
      throw new OtpError(403, 'REPORT_PRIVILEGED_FORBIDDEN', 'Administrative accounts cannot be reported through chat.');
    }

    const orderId = clean(conversation.orderId, 128);
    if (suppliedOrderId && suppliedOrderId !== orderId) throw new OtpError(400, 'REPORT_ORDER_INVALID', 'The order does not belong to this reportable relationship.');
    const branchId = clean(conversation.branchId || conversation.branchIds?.[0] || conversation.participantBranchIds?.[0] || reporter?.branchId, 128);
    if (!branchId) throw new OtpError(409, 'REPORT_JURISDICTION_UNAVAILABLE', 'The report jurisdiction could not be established.');

    if (reporter.role === 'manager') {
      const managerBranchId = clean(callerClaims?.branchId || reporter?.branchId, 128);
      if (managerBranchId && branchId !== managerBranchId) {
        throw new OtpError(403, 'CROSS_BRANCH_FORBIDDEN', 'You can only report users within your branch.');
      }
    }
    const orderSnapshot = orderId ? await tx.get(db.collection('requests').doc(orderId)) : null;
    const order = orderSnapshot?.exists ? orderSnapshot.data() || {} : {};

    const duplicateRef = db.collection('chatReportDuplicates').doc(hashId(callerUid, conversationId, messageId || 'conversation', category.code));
    const rateRef = db.collection('chatReportRateLimits').doc(callerUid);
    const [duplicateSnapshot, rateSnapshot, evidenceBundle] = await Promise.all([
      tx.get(duplicateRef),
      tx.get(rateRef),
      evidenceForReport(tx, conversationRef, messageId, target.uid),
    ]);
    if (duplicateSnapshot.exists && timeOf(duplicateSnapshot.data()?.expiresAt) > nowMs) {
      const existingId = clean(duplicateSnapshot.data()?.reportId, 128);
      const existing = existingId ? await tx.get(db.collection('chatReports').doc(existingId)) : null;
      if (existing?.exists) return { duplicate: true, report: withId(existing) };
    }
    const nextRate = rateRecord(rateSnapshot.exists ? rateSnapshot.data() || {} : {}, nowMs);
    const reportId = createReportId();
    const reportRef = db.collection('chatReports').doc(reportId);
    const report = {
      schemaVersion: 1,
      publicReference: `REP-${reportId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase()}`,
      reporterUid: callerUid,
      reporterPublicUidSnapshot: publicUidOf(reporter),
      reporterNameSnapshot: clean(reporter.fullName || `${reporter.firstName || ''} ${reporter.lastName || ''}`, 160),
      reporterRole: reporter.role,
      reportedUid: target.uid,
      reportedPublicUidSnapshot: publicUidOf(targetProfile),
      reportedNameSnapshot: clean(targetProfile.fullName || `${targetProfile.firstName || ''} ${targetProfile.lastName || ''}`, 160),
      reportedRole: target.role,
      jurisdictionBranchId: branchId,
      conversationId,
      ...(messageId ? { messageId } : {}),
      ...(orderId ? { orderId } : {}),
      ...(orderId ? { orderReferenceSnapshot: clean(order.requestId || order.request_id || orderId, 80) } : {}),
      category: category.code,
      categoryLabel: category.label,
      details: category.details,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      reviewedByUid: null,
      reviewedByPublicUidSnapshot: null,
      reviewedByRole: null,
      reviewedAt: null,
      actionTaken: null,
      escalatedAt: null,
      escalationReason: null,
      resolvedAt: null,
      evidenceSnapshot: evidenceBundle.evidence,
      retentionHold: true,
      retentionClass: 'moderation_evidence',
    };
    tx.create(reportRef, report);
    for (const message of evidenceBundle.sourceMessages) {
      const holdIds = [...new Set([...(message.retentionHoldReportIds || []), reportId])].slice(-10);
      tx.set(conversationRef.collection('messages').doc(message.id), { retentionHold: true, retentionHoldReportIds: holdIds }, { merge: true });
    }
    tx.set(rateRef, nextRate);
    tx.set(duplicateRef, { reportId, reporterUid: callerUid, createdAt: now, expiresAt: new Date(nowMs + REPORT_DUPLICATE_WINDOW_MS) });
    tx.set(db.collection('moderationActivity').doc(`branch_${branchId}`), { branchId, updatedAt: now, revision: randomUUID() });
    tx.set(db.collection('moderationActivity').doc('admin'), { updatedAt: now, revision: randomUUID() });
    return { duplicate: false, report: { id: reportId, ...report } };
  });
}

function safeSubmission(result) {
  return {
    reportId: result.report.id,
    status: result.report.status === 'resolved' ? 'Resolved' : result.report.status === 'escalated' ? 'Under review' : 'Submitted',
    createdAt: result.report.createdAt,
    duplicate: result.duplicate,
  };
}

function errorResponse(res, error) {
  const known = error instanceof OtpError;
  return res.status(known ? error.status : 500).json({ error: {
    reason: known ? error.reason : 'REPORT_SERVICE_UNAVAILABLE',
    message: known ? error.message : 'Reporting is temporarily unavailable.',
    ...(Number.isFinite(error?.details?.retryAfterSeconds) ? { retryAfterSeconds: error.details.retryAfterSeconds } : {}),
  } });
}

function createChatReportsHandler(getAdmin = getFirebaseAdmin, dependencies = {}) {
  const now = dependencies.now || (() => new Date());
  const createReportId = dependencies.createReportId || randomUUID;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      const { auth, db } = getAdmin();
      const decoded = await verifiedIdentity(req, auth);
      const result = await submitReport({ db, callerUid: decoded.uid, callerClaims: decoded, body: bodyOf(req), now: now(), createReportId });
      return res.status(result.duplicate ? 200 : 201).json(safeSubmission(result));
    } catch (error) { return errorResponse(res, error); }
  };
}

module.exports = {
  createChatReportsHandler,
  evidenceMessage,
  oppositeParticipant,
  rateRecord,
  reportCategory,
  safeSubmission,
  submitReport,
};
