const { OtpError } = require('../utils/otpError');
const { requireActiveAccount } = require('../auth/accountStatus');
const { FieldPath } = require('firebase-admin/firestore');
const { decisionEventIdFor } = require('./deliveryReviewPolicy');
const { safeReport } = require('./requesterDeliveryReportService');
const { currentVerifiedStreak, penaltyEventIdFor, secondReviewIdFor, safePenaltyStatus,
  prepareAppealPenaltyTransition, prepareFirstPenalty,
  stagePenaltyWrites } = require('./deliveryPenaltyService');
const {
  APPEAL_RESOLUTION_EVENT_KIND,
  appealSubmissionEventIdFor,
  appealResolutionEventIdFor,
  APPEAL_RESOLUTIONS,
  OVERTURNED_RESPONSIBILITIES,
  canonicalAppealBasis,
  canonicalAppealSubmission,
  canonicalAppealResolution,
} = require('./deliveryAppealPolicy');

const conflict = (code, message) => new OtpError(409, code, message);
const notFound = (message = 'Delivery appeal not found.') => new OtpError(404, 'DELIVERY_APPEAL_NOT_FOUND', message);
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128
  && value.trim() === value && value !== '.' && value !== '..' && !value.includes('/');
const validAttemptId = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const dateOf = (value) => value?.toDate?.() || (value instanceof Date ? value : null);

function normalizeResolutionInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new OtpError(400, 'DELIVERY_APPEAL_INVALID', 'The appeal decision payload is invalid.');
  }
  const allowed = body.resolution === 'overturned'
    ? ['attemptId', 'resolution', 'resolutionReason', 'overturnedResponsibility', 'clientMutationId']
    : ['attemptId', 'resolution', 'resolutionReason', 'clientMutationId'];
  if (Object.keys(body).sort().join(',') !== allowed.sort().join(',')) {
    throw new OtpError(400, 'DELIVERY_APPEAL_INVALID', 'The appeal decision payload is invalid.');
  }
  if (!validAttemptId(body.attemptId)) {
    throw new OtpError(400, 'DELIVERY_APPEAL_ID_INVALID', 'The appeal attempt reference is invalid.');
  }
  if (!APPEAL_RESOLUTIONS.has(body.resolution)) {
    throw new OtpError(400, 'APPEAL_RESOLUTION_INVALID', 'Choose upheld or overturned.');
  }
  if (typeof body.resolutionReason !== 'string') {
    throw new OtpError(400, 'APPEAL_REASON_INVALID', 'Enter a factual resolution reason of 10 to 1000 characters.');
  }
  const reason = body.resolutionReason.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = Array.from(reason).length;
  if (length < 10 || length > 1000 || !/[\p{L}\p{N}]/u.test(reason)) {
    throw new OtpError(400, 'APPEAL_REASON_INVALID', 'Enter a factual resolution reason of 10 to 1000 characters.');
  }
  let overturnedResponsibility = null;
  if (body.resolution === 'overturned') {
    if (!OVERTURNED_RESPONSIBILITIES.has(body.overturnedResponsibility)) {
      throw new OtpError(400, 'OVERTURNED_RESPONSIBILITY_INVALID', 'Select a valid replacement responsibility outcome.');
    }
    overturnedResponsibility = body.overturnedResponsibility;
  }
  if (typeof body.clientMutationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.clientMutationId)) {
    throw new OtpError(400, 'DELIVERY_MUTATION_ID_INVALID', 'Use a valid delivery mutation ID.');
  }
  return {
    attemptId: body.attemptId,
    resolution: body.resolution,
    resolutionReason: reason,
    overturnedResponsibility,
    clientMutationId: body.clientMutationId,
  };
}

function serializeAppealItem(docId, data = {}, { detail = false } = {}) {
  const submittedAt = dateOf(data.appeal?.submittedAt);
  const resolvedAt = dateOf(data.appeal?.resolvedAt);
  const decidedAt = dateOf(data.managerDecision?.decidedAt);
  const reportReceivedAt = dateOf(data.reportReceivedAt);

  return {
    attemptId: docId,
    attemptNumber: data.attemptNumber || 1,
    orderId: data.orderId || '',
    branchId: data.branchId || '',
    reportedReasonCode: data.reportedReasonCode || '',
    reportReceivedAt: reportReceivedAt ? reportReceivedAt.toISOString() : null,
    managerDecision: data.managerDecision ? {
      responsibility: data.managerDecision.responsibility,
      decidedAt: decidedAt ? decidedAt.toISOString() : null,
      ...(detail ? { decisionReason: data.managerDecision.decisionReason } : {}),
    } : null,
    appeal: data.appeal ? {
      state: data.appeal.state || 'submitted',
      submittedAt: submittedAt ? submittedAt.toISOString() : null,
      resolution: data.appeal.resolution || null,
      overturnedResponsibility: data.appeal.overturnedResponsibility || null,
      resolvedAt: resolvedAt ? resolvedAt.toISOString() : null,
      ...(detail ? { appealReason: data.appeal.appealReason,
        resolutionReason: data.appeal.resolutionReason || null } : {}),
    } : null,
    effectiveResponsibility: data.effectiveResponsibility || data.managerDecision?.responsibility || data.responsibility || 'undetermined',
    originalResponsibility: data.managerDecision?.responsibility || data.responsibility || 'undetermined',
    ...(detail ? {
      contactAttempts: safeReport(docId, data).contactAttempts,
      reportedReasonNote: typeof data.reportedReasonNote === 'string'
        ? Array.from(data.reportedReasonNote).slice(0, 240).join('') : null,
      requesterResponse: data.requesterResponse?.status === 'submitted'
        && data.requesterResponse.requesterUid === data.requesterUid
        && typeof data.requesterResponse.explanation === 'string'
        ? { explanation: Array.from(data.requesterResponse.explanation).slice(0, 500).join(''),
          submittedAt: dateOf(data.requesterResponse.submittedAt)?.toISOString() || null } : null,
    } : {}),
  };
}

function verifiedAppeal(snapshot, orderSnapshot, managerEventSnapshot, submissionSnapshot, resolutionSnapshot) {
  if (!snapshot?.exists || !validAttemptId(snapshot.id)) throw notFound();
  const attempt = snapshot.data() || {};
  canonicalAppealBasis(snapshot.id, attempt, orderSnapshot?.exists ? orderSnapshot.data() || {} : null,
    managerEventSnapshot?.exists ? managerEventSnapshot.data() || {} : null);
  canonicalAppealSubmission(snapshot.id, attempt,
    submissionSnapshot?.exists ? submissionSnapshot.data() || {} : null);
  canonicalAppealResolution(snapshot.id, attempt,
    resolutionSnapshot?.exists ? resolutionSnapshot.data() || {} : null);
  return attempt;
}

async function readVerifiedAppeal(db, snapshot) {
  if (!snapshot?.exists || !validAttemptId(snapshot.id) || !validId(snapshot.data()?.orderId)) throw notFound();
  const id = snapshot.id;
  const [order, manager, submission, resolution] = await Promise.all([
    db.collection('requests').doc(snapshot.data().orderId).get(),
    db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(id)).get(),
    db.collection('deliveryAttemptEvents').doc(appealSubmissionEventIdFor(id)).get(),
    db.collection('deliveryAttemptEvents').doc(appealResolutionEventIdFor(id)).get(),
  ]);
  return { attempt: verifiedAppeal(snapshot, order, manager, submission, resolution), order: order.data() || {} };
}

async function listAdminAppeals(db, admin, { status = 'pending', limit = 20, cursor = '' } = {}) {
  const adminUid = admin.uid || admin.decoded?.uid;
  const adminSnapshot = await db.collection('users').doc(adminUid).get();
  const adminProfile = adminSnapshot.data() || {};
  if (!adminSnapshot.exists || adminProfile.role !== 'admin') {
    throw new OtpError(403, 'FORBIDDEN', 'Admin access required.');
  }
  requireActiveAccount(adminProfile);

  if (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 25) {
    throw new OtpError(400, 'DELIVERY_APPEAL_LIMIT_INVALID', 'Choose a page size from 1 to 25.');
  }
  const parsedLimit = Number(limit);

  let query = db.collection('deliveryAttempts');
  let states;
  if (status === 'pending') {
    states = ['submitted'];
  } else if (status === 'resolved') {
    states = ['upheld', 'overturned'];
  } else if (status === 'all') {
    states = ['submitted', 'upheld', 'overturned'];
  } else {
    throw new OtpError(400, 'INVALID_APPEAL_STATUS', 'Filter by pending, resolved, or all.');
  }
  query = states.length === 1 ? query.where('appealState', '==', states[0])
    : query.where('appealState', 'in', states);
  query = query.orderBy('appeal.submittedAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc').limit(parsedLimit + 1);
  if (cursor) {
    if (!validAttemptId(cursor)) throw new OtpError(400, 'DELIVERY_APPEAL_CURSOR_INVALID', 'The appeal cursor is invalid.');
    const position = await db.collection('deliveryAttempts').doc(cursor).get();
    if (!position.exists || !states.includes(position.data()?.appealState)
      || !dateOf(position.data()?.appeal?.submittedAt)) {
      throw new OtpError(400, 'DELIVERY_APPEAL_CURSOR_INVALID', 'The appeal cursor is invalid.');
    }
    query = query.startAfter(position);
  }

  const snapshot = await query.get();
  const docs = snapshot.docs || [];
  const hasMore = docs.length > parsedLimit;
  const pageDocs = hasMore ? docs.slice(0, parsedLimit) : docs;
  const nextCursor = hasMore ? pageDocs[pageDocs.length - 1].id : null;
  const appeals = [];
  for (const doc of pageDocs) {
    try {
      const { attempt } = await readVerifiedAppeal(db, doc);
      appeals.push(serializeAppealItem(doc.id, attempt));
    } catch (error) {
      if (!(error instanceof OtpError) || error.status !== 404) throw error;
    }
  }
  return {
    appeals,
    nextCursor,
  };
}

async function getAdminAppealDetail(db, admin, attemptId) {
  if (!validAttemptId(attemptId)) throw notFound('Invalid attempt ID.');
  const adminUid = admin.uid || admin.decoded?.uid;
  const adminSnapshot = await db.collection('users').doc(adminUid).get();
  const adminProfile = adminSnapshot.data() || {};
  if (!adminSnapshot.exists || adminProfile.role !== 'admin') {
    throw new OtpError(403, 'FORBIDDEN', 'Admin access required.');
  }
  requireActiveAccount(adminProfile);

  const attemptSnapshot = await db.collection('deliveryAttempts').doc(attemptId).get();
  if (!attemptSnapshot.exists) throw notFound();
  const { attempt, order: orderData } = await readVerifiedAppeal(db, attemptSnapshot);
  return {
    appeal: { ...serializeAppealItem(attemptSnapshot.id, attempt, { detail: true }),
      requesterUid: attempt.requesterUid },
    order: {
      id: attempt.orderId,
      branchId: orderData.branchId,
      status: orderData.status,
      orderReference: String(orderData.requestId || orderData.request_id || attempt.orderId).slice(0, 80),
      createdAt: dateOf(orderData.createdAt)?.toISOString() || null,
    },
  };
}

async function getAdminDeliveryPenaltyDetail(db, admin, requesterUid, now = new Date()) {
  if (!validId(requesterUid)) throw notFound('Invalid Requester identity.');
  const adminUid = admin.uid || admin.decoded?.uid;
  const adminSnapshot = await db.collection('users').doc(adminUid).get();
  const adminProfile = adminSnapshot.data() || {};
  if (!adminSnapshot.exists || adminProfile.role !== 'admin') {
    throw new OtpError(403, 'FORBIDDEN', 'Admin access required.');
  }
  requireActiveAccount(adminProfile);
  const requesterSnapshot = await db.collection('users').doc(requesterUid).get();
  if (!requesterSnapshot.exists || requesterSnapshot.data()?.role !== 'requester') throw notFound();
  const [restriction, streak, first, second, audit] = await Promise.all([
    db.collection('orderingRestrictions').doc(requesterUid).get(),
    currentVerifiedStreak({ get: (ref) => ref.get() }, db, requesterUid),
    db.collection('deliveryPenaltyEvents').doc(penaltyEventIdFor(requesterUid)).get(),
    db.collection('deliveryPenaltyEvents').doc(secondReviewIdFor(requesterUid)).get(),
    db.collection('deliveryPenaltyEvents').where('requesterUid', '==', requesterUid).limit(16).get(),
  ]);
  const firstData = first.exists && first.data()?.requesterUid === requesterUid
    && first.data()?.kind === 'FIRST_VERIFIED_DELIVERY_ORDERING_RESTRICTION'
    ? first.data() : null;
  const secondData = second.exists && second.data()?.requesterUid === requesterUid
    && second.data()?.firstPenaltyEventId === penaltyEventIdFor(requesterUid)
    ? second.data() : null;
  const supportingAttemptIds = firstData?.supportingAttemptIds?.filter(validAttemptId).slice(0, 3) || [];
  const attempts = await Promise.all(supportingAttemptIds.map((id) => db.collection('deliveryAttempts').doc(id).get()));
  return { requesterUid, ...safePenaltyStatus(restriction.data() || {}, streak, now),
    supportingIncidents: attempts.map((item) => {
      const attempt = item.data() || {};
      return { attemptId: item.id, orderId: validId(attempt.orderId) ? attempt.orderId : null,
        reportedReasonCode: String(attempt.reportedReasonCode || '').slice(0, 60),
        managerResponsibility: attempt.managerDecision?.responsibility || null,
        effectiveResponsibility: attempt.effectiveResponsibility || attempt.responsibility || null,
        appealState: attempt.appealState || null };
    }),
    adminReviewFlag: Boolean(secondData?.kind === 'SECOND_VERIFIED_DELIVERY_STREAK_FOR_ADMIN_REVIEW'),
    secondReviewAttemptIds: secondData?.supportingAttemptIds?.filter(validAttemptId).slice(0, 3) || [],
    audit: (audit.docs || []).filter((item) => item.id === penaltyEventIdFor(requesterUid)
      || item.data()?.penaltyEventId === penaltyEventIdFor(requesterUid)
      || item.id === secondReviewIdFor(requesterUid))
      .map((item) => ({ kind: String(item.data()?.kind || '').slice(0, 80),
        state: String(item.data()?.state || '').slice(0, 24) || null,
        attemptId: validAttemptId(item.data()?.attemptId) ? item.data().attemptId : null,
        createdAt: dateOf(item.data()?.createdAt)?.toISOString() || null })),
  };
}

async function listAdminDeliveryPenaltyReviews(db, admin, { cursor = '' } = {}) {
  const adminUid = admin.uid || admin.decoded?.uid;
  const adminSnapshot = await db.collection('users').doc(adminUid).get();
  if (!adminSnapshot.exists || adminSnapshot.data()?.role !== 'admin') {
    throw new OtpError(403, 'FORBIDDEN', 'Admin access required.');
  }
  requireActiveAccount(adminSnapshot.data() || {});
  if (cursor && !validAttemptId(cursor)) {
    throw new OtpError(400, 'DELIVERY_PENALTY_CURSOR_INVALID', 'The review cursor is invalid.');
  }
  let query = db.collection('deliveryPenaltyEvents')
    .where('kind', '==', 'SECOND_VERIFIED_DELIVERY_STREAK_FOR_ADMIN_REVIEW')
    .orderBy(FieldPath.documentId()).limit(26);
  if (cursor) query = query.startAfter(cursor);
  const result = await query.get();
  const docs = (result.docs || []).slice(0, 25);
  return { reviews: docs.map((item) => ({ requesterUid: validId(item.data()?.requesterUid)
    && item.id === secondReviewIdFor(item.data().requesterUid)
    && item.data()?.firstPenaltyEventId === penaltyEventIdFor(item.data().requesterUid)
    ? item.data().requesterUid : null, createdAt: dateOf(item.data()?.createdAt)?.toISOString() || null,
  })).filter((item) => item.requesterUid),
  nextCursor: (result.docs || []).length > 25 ? docs[docs.length - 1].id : null };
}

async function resolveAdminAppeal(db, admin, body, now = () => new Date()) {
  const input = normalizeResolutionInput(body);
  const adminUid = admin.uid || admin.decoded?.uid;
  const adminRef = db.collection('users').doc(adminUid);
  const attemptRef = db.collection('deliveryAttempts').doc(input.attemptId);
  const resolutionEventRef = db.collection('deliveryAttemptEvents').doc(appealResolutionEventIdFor(input.attemptId));
  const adminActivityRef = db.collection('moderationActivity').doc('admin');

  return db.runTransaction(async (tx) => {
    const adminSnapshot = await tx.get(adminRef);
    if (!adminSnapshot.exists) throw new OtpError(403, 'ADMIN_INACTIVE', 'Active account required.');
    const adminProfile = adminSnapshot.data() || {};
    if (adminProfile.role !== 'admin') throw new OtpError(403, 'FORBIDDEN', 'Admin access required.');
    requireActiveAccount(adminProfile);

    const attemptSnapshot = await tx.get(attemptRef);
    if (!attemptSnapshot.exists) throw notFound();
    const attempt = attemptSnapshot.data() || {};
    if (!validId(attempt.orderId)) throw notFound();
    const orderSnapshot = await tx.get(db.collection('requests').doc(attempt.orderId));
    const managerEventSnapshot = await tx.get(db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(input.attemptId)));
    const submissionSnapshot = await tx.get(db.collection('deliveryAttemptEvents').doc(appealSubmissionEventIdFor(input.attemptId)));

    const eventSnapshot = await tx.get(resolutionEventRef);
    verifiedAppeal(attemptSnapshot, orderSnapshot, managerEventSnapshot, submissionSnapshot, eventSnapshot);
    if (eventSnapshot.exists) {
      const event = eventSnapshot.data() || {};
      if (event.kind === APPEAL_RESOLUTION_EVENT_KIND
        && event.attemptId === input.attemptId
        && event.adminUid === adminUid
        && event.clientMutationId === input.clientMutationId
        && event.resolution === input.resolution
        && event.resolutionReason === input.resolutionReason
        && (input.resolution !== 'overturned' || event.overturnedResponsibility === input.overturnedResponsibility)) {
        return {
          created: false,
          appeal: serializeAppealItem(input.attemptId, attempt, { detail: true }),
        };
      }
      throw conflict('APPEAL_ALREADY_RESOLVED', 'This appeal has already been resolved with a different decision or mutation ID.');
    }

    if (!attempt.appeal || attempt.appealState !== 'submitted') {
      throw conflict('APPEAL_NOT_PENDING', 'This delivery review does not have an open appeal pending review.');
    }

    const resolvedAt = now();
    if (!(resolvedAt instanceof Date) || !Number.isFinite(resolvedAt.getTime())) {
      throw new Error('Invalid server time.');
    }

    const originalManagerResponsibility = attempt.managerDecision?.responsibility || attempt.responsibility || 'undetermined';
    const effectiveResponsibility = input.resolution === 'overturned'
      ? input.overturnedResponsibility
      : originalManagerResponsibility;

    const appealUpdate = {
      ...attempt.appeal,
      state: input.resolution,
      resolution: input.resolution,
      resolutionReason: input.resolutionReason,
      overturnedResponsibility: input.overturnedResponsibility,
      resolutionMutationId: input.clientMutationId,
      adminUid,
      resolvedAt,
    };

    const eventRecord = {
      schemaVersion: 1,
      kind: APPEAL_RESOLUTION_EVENT_KIND,
      attemptId: input.attemptId,
      attemptNumber: attempt.attemptNumber || 1,
      orderId: attempt.orderId,
      branchId: attempt.branchId,
      requesterUid: attempt.requesterUid,
      adminUid,
      actorUid: adminUid,
      actorRole: 'admin',
      resolution: input.resolution,
      resolutionReason: input.resolutionReason,
      overturnedResponsibility: input.overturnedResponsibility,
      effectiveResponsibility,
      originalManagerResponsibility,
      clientMutationId: input.clientMutationId,
      createdAt: resolvedAt,
    };

    const noticeRef = db.collection('moderationNotices').doc(attempt.requesterUid).collection('items').doc(`appeal_res_${input.attemptId}`);
    const requesterActivityRef = db.collection('moderationActivity').doc(`user_${attempt.requesterUid}`);

    const noticeRecord = {
      schemaVersion: 1,
      type: 'delivery_appeal_resolved',
      title: input.resolution === 'overturned' ? 'Delivery review appeal overturned' : 'Delivery review appeal upheld',
      message: 'Your delivery review appeal has an Admin decision. Open the report for details.',
      targetUid: attempt.requesterUid,
      attemptId: input.attemptId,
      orderId: attempt.orderId,
      resolution: input.resolution,
      effectiveResponsibility,
      seenAt: null,
      acknowledgedAt: null,
      createdAt: resolvedAt,
    };

    const auditRef = db.collection('adminAuditLogs').doc(appealResolutionEventIdFor(input.attemptId));
    const auditRecord = {
      schemaVersion: 1,
      action: 'RESOLVE_DELIVERY_APPEAL',
      actorUid: adminUid,
      actorRole: 'admin',
      targetUid: attempt.requesterUid,
      attemptId: input.attemptId,
      orderId: attempt.orderId,
      resolution: input.resolution,
      resolutionReason: input.resolutionReason,
      overturnedResponsibility: input.overturnedResponsibility,
      effectiveResponsibility,
      originalManagerResponsibility,
      createdAt: resolvedAt,
    };

    const penalty = input.resolution === 'upheld'
      ? await prepareFirstPenalty({ tx, db, requesterUid: attempt.requesterUid, now: resolvedAt,
        overlay: { attemptId: input.attemptId,
          attempt: { ...attempt, appeal: appealUpdate, appealState: input.resolution,
            effectiveResponsibility }, resolutionEvent: eventRecord } })
      : { writes: [] };
    const penaltyTransition = await prepareAppealPenaltyTransition({ tx, db,
      requesterUid: attempt.requesterUid, attemptId: input.attemptId,
      appealState: input.resolution, now: resolvedAt });

    tx.update(attemptRef, {
      appeal: appealUpdate,
      appealState: input.resolution,
      effectiveResponsibility,
      updatedAt: resolvedAt,
    });
    tx.create(resolutionEventRef, eventRecord);
    tx.create(noticeRef, noticeRecord);
    tx.set(requesterActivityRef, { updatedAt: resolvedAt }, { merge: true });
    tx.set(adminActivityRef, { updatedAt: resolvedAt }, { merge: true });
    tx.create(auditRef, auditRecord);
    stagePenaltyWrites(tx, penalty.writes);
    stagePenaltyWrites(tx, penaltyTransition);

    return {
      created: true,
      appeal: serializeAppealItem(input.attemptId, {
        ...attempt,
        appeal: appealUpdate,
        effectiveResponsibility,
      }, { detail: true }),
    };
  });
}

module.exports = {
  getAdminAppealDetail,
  getAdminDeliveryPenaltyDetail,
  listAdminDeliveryPenaltyReviews,
  listAdminAppeals,
  normalizeResolutionInput,
  resolveAdminAppeal,
  serializeAppealItem,
};
