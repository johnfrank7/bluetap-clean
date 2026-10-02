const { randomUUID } = require('node:crypto');
const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { canonicalAccountStatus, ACCOUNT_STATUS } = require('../auth/accountStatus');
const { requireActiveManager, requireAdmin, verifiedIdentity } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const {
  DAY_MS,
  boundedText,
  clean,
  durationDays,
  hashId,
  isoTimestamp,
  nextRestrictionProjection,
  noticeForAction,
  publicUidOf,
  safeNotice,
  safeRestriction,
  timeOf,
} = require('./moderationService');

const MANAGER_ACTIONS = new Set(['dismiss', 'warn', 'suspend_branch_chat', 'suspend_branch_ordering', 'escalate']);
const ADMIN_ACTIONS = new Set(['dismiss', 'warn', 'suspend_platform_chat', 'suspend_platform_ordering', 'suspend_account', 'terminate_account', 'reactivate']);
const RESTRICTION_ACTIONS = new Set(['suspend_branch_chat', 'suspend_branch_ordering', 'suspend_platform_chat', 'suspend_platform_ordering']);
const NOTICE_ACTIONS = new Set(['warn', ...RESTRICTION_ACTIONS, 'suspend_account']);

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'INVALID_MODERATION_REQUEST', 'The moderation request is invalid.'); }
}

function withId(snapshot) {
  return snapshot?.exists ? { id: snapshot.id, ...(snapshot.data() || {}) } : null;
}

function pageSize(value) {
  const parsed = Number(value || 25);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) throw new OtpError(400, 'MODERATION_PAGE_INVALID', 'Choose a page size from 1 to 50.');
  return parsed;
}

function statusFilter(value) {
  const status = clean(value, 24).toLowerCase();
  if (!status) return '';
  if (!['active', 'open', 'escalated', 'resolved'].includes(status)) throw new OtpError(400, 'REPORT_STATUS_INVALID', 'Choose active, open, escalated, or resolved.');
  return status;
}

function safeReport(report = {}, options = {}) {
  return {
    id: report.id,
    publicReference: clean(report.publicReference, 80),
    category: clean(report.category, 80),
    categoryLabel: clean(report.categoryLabel, 160),
    details: clean(report.details, 1000),
    status: clean(report.status, 24),
    reporter: {
      publicUid: clean(report.reporterPublicUidSnapshot, 80),
      name: clean(report.reporterNameSnapshot, 160),
      role: clean(report.reporterRole, 30),
    },
    reportedUser: {
      publicUid: clean(report.reportedPublicUidSnapshot, 80),
      name: clean(report.reportedNameSnapshot, 160),
      role: clean(report.reportedRole, 30),
    },
    branchId: clean(report.jurisdictionBranchId, 128),
    orderReference: clean(report.orderReferenceSnapshot, 80) || null,
    createdAt: isoTimestamp(report.createdAt),
    updatedAt: isoTimestamp(report.updatedAt),
    reviewedAt: isoTimestamp(report.reviewedAt),
    actionTaken: clean(report.actionTaken, 80) || null,
    escalatedAt: isoTimestamp(report.escalatedAt),
    resolvedAt: isoTimestamp(report.resolvedAt),
    ...(options.evidence ? { evidence: (report.evidenceSnapshot || []).slice(0, 5).map((message) => ({
      messageId: clean(message.messageId, 128),
      seq: Number(message.seq || 0),
      senderPublicUid: clean(message.senderPublicUidSnapshot, 80),
      senderRole: clean(message.senderRole, 30),
      body: clean(message.body, 2000),
      createdAt: isoTimestamp(message.createdAt),
      reported: clean(message.messageId, 128) === clean(report.messageId, 128),
    })) } : {}),
  };
}

function safeAbuseReview(review = {}) {
  return {
    id: review.id,
    requester: {
      publicUid: clean(review.requesterPublicUidSnapshot, 80),
      name: clean(review.requesterNameSnapshot, 160),
    },
    branchId: clean(review.branchId, 128),
    branchName: clean(review.branchNameSnapshot, 160),
    windowDays: Number(review.windowDays || 30),
    incidentCount: Number(review.incidentCount || 0),
    severity: clean(review.severity, 40),
    status: clean(review.status || 'open', 24),
    firstIncidentAt: isoTimestamp(review.firstIncidentAt),
    lastIncidentAt: isoTimestamp(review.lastIncidentAt),
    incidents: (review.incidents || []).slice(-10).map((incident) => ({
      orderReference: clean(incident.orderReference, 80),
      type: clean(incident.type, 48),
      category: clean(incident.category, 80),
      stage: clean(incident.stage, 48),
      concern: clean(incident.concern, 24),
      at: isoTimestamp(incident.at),
    })),
  };
}

function safeAction(action = {}) {
  return {
    id: action.id,
    action: clean(action.action, 80),
    scope: clean(action.scope, 40),
    branchId: clean(action.branchId, 128) || null,
    targetPublicUid: clean(action.targetPublicUidSnapshot, 80),
    targetRole: clean(action.targetRole, 30),
    actorPublicUid: clean(action.actorPublicUidSnapshot, 80),
    actorRole: clean(action.actorRole, 30),
    reasonCategory: clean(action.reasonCategory, 80),
    reason: clean(action.reason, 1000),
    startsAt: isoTimestamp(action.startsAt),
    endsAt: isoTimestamp(action.endsAt),
    createdAt: isoTimestamp(action.createdAt),
  };
}

async function reportList(db, { branchId = '', status = '', limit = 25, cursor = '' } = {}) {
  let query = db.collection('chatReports');
  if (branchId) query = query.where('jurisdictionBranchId', '==', branchId);
  if (status === 'active') query = query.where('status', 'in', ['open', 'escalated']);
  else if (status) query = query.where('status', '==', status);
  query = query.orderBy('createdAt', 'desc').limit(limit + 1);
  if (cursor) {
    const cursorSnapshot = await db.collection('chatReports').doc(cursor).get();
    if (!cursorSnapshot.exists || (branchId && clean(cursorSnapshot.data()?.jurisdictionBranchId, 128) !== branchId)) {
      throw new OtpError(400, 'MODERATION_CURSOR_INVALID', 'The report cursor is invalid.');
    }
    query = query.startAfter(cursorSnapshot);
  }
  const snapshot = await query.get();
  const docs = snapshot.docs || [];
  return {
    reports: docs.slice(0, limit).map((item) => safeReport(withId(item))),
    nextCursor: docs.length > limit ? docs[limit - 1].id : null,
  };
}

async function abuseReviewList(db, { branchId = '', limit = 25 } = {}) {
  let query = db.collection('orderAbuseReviews');
  if (branchId) query = query.where('branchId', '==', branchId);
  const snapshot = await query.orderBy('updatedAt', 'desc').limit(limit).get();
  return { abuseReviews: (snapshot.docs || []).map((item) => safeAbuseReview(withId(item))) };
}

async function reportDetail(db, reportId, branchId = '') {
  const snapshot = await db.collection('chatReports').doc(clean(reportId, 128)).get();
  const report = withId(snapshot);
  if (!report || (branchId && clean(report.jurisdictionBranchId, 128) !== branchId)) {
    throw new OtpError(404, 'REPORT_NOT_FOUND', 'The report was not found.');
  }
  const [actions, chatRestriction, orderingRestriction] = await Promise.all([
    db.collection('moderationActions').where('reportId', '==', report.id).orderBy('createdAt', 'desc').limit(50).get(),
    db.collection('chatRestrictions').doc(report.reportedUid).get(),
    db.collection('orderingRestrictions').doc(report.reportedUid).get(),
  ]);
  const now = Date.now();
  const restrictions = [];
  for (const [kind, restrictionSnapshot] of [['chat', chatRestriction], ['ordering', orderingRestriction]]) {
    if (!restrictionSnapshot.exists) continue;
    const data = restrictionSnapshot.data() || {};
    if (data.platform && timeOf(data.platform.endsAt) > now) restrictions.push({ kind, ...safeRestriction(data.platform) });
    const branch = data.branches?.[report.jurisdictionBranchId];
    if (branch && timeOf(branch.endsAt) > now) restrictions.push({ kind, ...safeRestriction(branch) });
  }
  return {
    report: safeReport(report, { evidence: true }),
    actions: (actions.docs || []).map((item) => safeAction(withId(item))),
    restrictions,
  };
}

function scopeForAction(action, role) {
  if (action === 'suspend_branch_chat') return 'branch_chat';
  if (action === 'suspend_branch_ordering') return 'branch_ordering';
  if (action === 'suspend_platform_chat') return 'platform_chat';
  if (action === 'suspend_platform_ordering') return 'platform_ordering';
  if (['suspend_account', 'terminate_account', 'reactivate'].includes(action)) return 'account';
  return role === 'manager' ? 'branch' : 'account';
}

function restrictionCollection(scope) {
  return scope.endsWith('_chat') ? 'chatRestrictions' : 'orderingRestrictions';
}

function accountStatusChanges(profile, action) {
  const current = canonicalAccountStatus(profile);
  if (action === 'suspend_account') {
    if (current !== ACCOUNT_STATUS.ACTIVE) throw new OtpError(409, 'ACCOUNT_NOT_ACTIVE', 'Only an active account can be suspended.');
    return { accountStatus: ACCOUNT_STATUS.SUSPENDED, ...(profile.role === 'requester' ? { status: 'Suspended' } : {}) };
  }
  if (action === 'terminate_account') {
    return { accountStatus: ACCOUNT_STATUS.TERMINATED, ...(profile.role === 'requester' ? { status: 'Terminated' } : {}) };
  }
  if (action === 'reactivate') {
    if (![ACCOUNT_STATUS.INACTIVE, ACCOUNT_STATUS.SUSPENDED].includes(current)) throw new OtpError(409, 'ACCOUNT_NOT_REACTIVATABLE', 'Only an inactive or suspended account can be reactivated.');
    return { accountStatus: ACCOUNT_STATUS.ACTIVE, ...(profile.role === 'requester' ? { status: 'Active' } : {}) };
  }
  return null;
}

async function applyAccountAuthState(auth, targetUid, action) {
  if (!['suspend_account', 'terminate_account', 'reactivate'].includes(action)) return;
  const disabled = action !== 'reactivate';
  await auth.updateUser(targetUid, { disabled });
  if (disabled) await auth.revokeRefreshTokens(targetUid);
}

function casePayload(report, abuseReview) {
  if (report) return {
    caseType: 'report', caseId: report.id, targetUid: report.reportedUid,
    targetPublicUid: report.reportedPublicUidSnapshot, targetRole: report.reportedRole,
    branchId: report.jurisdictionBranchId, category: report.category,
  };
  return {
    caseType: 'order_abuse', caseId: abuseReview.id, targetUid: abuseReview.requesterUid,
    targetPublicUid: abuseReview.requesterPublicUidSnapshot, targetRole: 'requester',
    branchId: abuseReview.branchId, category: 'ORDER_ABUSE',
  };
}

async function applyModerationAction({ auth, db, actor, actorRole, actorBranch = null, body, now = new Date(), createActionId = randomUUID }) {
  const allowed = actorRole === 'manager' ? MANAGER_ACTIONS : ADMIN_ACTIONS;
  const action = clean(body.action, 80).toLowerCase();
  if (!allowed.has(action)) throw new OtpError(403, 'MODERATION_ACTION_DENIED', 'This moderation action is not permitted.');
  const reportId = clean(body.reportId, 128);
  const abuseReviewId = clean(body.abuseReviewId, 128);
  if ((!reportId && !abuseReviewId) || (reportId && abuseReviewId)) throw new OtpError(400, 'MODERATION_CASE_REQUIRED', 'Choose one report or order-abuse review.');
  const mutationId = clean(body.clientMutationId, 128);
  if (!mutationId) throw new OtpError(400, 'MODERATION_MUTATION_REQUIRED', 'A stable moderation mutation ID is required.');
  const reasonRequired = action !== 'dismiss';
  const reason = boundedText(body.reason, { required: reasonRequired, max: 1000, reason: 'MODERATION_REASON_TOO_LONG' });
  const privateNote = boundedText(body.privateNote, { max: 1000, reason: 'MODERATION_NOTE_TOO_LONG' });
  const duration = RESTRICTION_ACTIONS.has(action) ? durationDays(body.durationDays, actorRole) : null;
  if (abuseReviewId && !['warn', 'suspend_branch_ordering', 'suspend_platform_ordering', 'suspend_account', 'terminate_account', 'escalate'].includes(action)) {
    throw new OtpError(403, 'MODERATION_ACTION_DENIED', 'This action is not available for an order-abuse review.');
  }
  const actorUid = actor.uid || actor.decoded?.uid;
  const payloadHash = hashId(JSON.stringify({ action, reportId, abuseReviewId, reason, privateNote, duration }));
  const mutationRef = db.collection('moderationMutationIds').doc(hashId(actorUid, mutationId));
  const existingMutation = await mutationRef.get();
  if (existingMutation.exists) {
    if (existingMutation.data()?.payloadHash !== payloadHash) throw new OtpError(409, 'MODERATION_MUTATION_CONFLICT', 'This mutation ID was already used for a different action.');
    const existingAction = await db.collection('moderationActions').doc(existingMutation.data()?.actionId).get();
    if (existingAction.exists) return { created: false, action: safeAction(withId(existingAction)) };
  }

  const caseSnapshot = reportId
    ? await db.collection('chatReports').doc(reportId).get()
    : await db.collection('orderAbuseReviews').doc(abuseReviewId).get();
  const report = reportId ? withId(caseSnapshot) : null;
  const abuseReview = abuseReviewId ? withId(caseSnapshot) : null;
  if (!caseSnapshot.exists) throw new OtpError(404, 'MODERATION_CASE_NOT_FOUND', 'The moderation case was not found.');
  const source = casePayload(report, abuseReview);
  if (actorRole === 'manager' && source.branchId !== actorBranch?.id) {
    throw new OtpError(403, 'BRANCH_ACCESS_DENIED', 'Managers may moderate only their current branch.');
  }
  if (report && !['open', 'escalated'].includes(clean(report.status, 24))) throw new OtpError(409, 'REPORT_NOT_ACTIONABLE', 'This report has already been resolved.');
  if (abuseReview && clean(abuseReview.status || 'open', 24) === 'resolved') throw new OtpError(409, 'ABUSE_REVIEW_NOT_ACTIONABLE', 'This review has already been resolved.');
  const targetSnapshot = await db.collection('users').doc(source.targetUid).get();
  if (!targetSnapshot.exists) throw new OtpError(404, 'MODERATION_TARGET_NOT_FOUND', 'The reported account was not found.');
  const targetProfile = targetSnapshot.data() || {};
  if (!['requester', 'distributor'].includes(clean(targetProfile.role, 30))) throw new OtpError(403, 'MODERATION_TARGET_DENIED', 'This account cannot be moderated through this workflow.');
  if (actorRole === 'manager' && report) {
    const conversation = await db.collection('chatConversations').doc(report.conversationId).get();
    const participants = conversation.exists ? conversation.data()?.participantUserUids || [] : [];
    const branches = conversation.exists ? conversation.data()?.participantBranchIds || conversation.data()?.branchIds || [] : [];
    if (!conversation.exists || !participants.includes(source.targetUid) || !branches.includes(source.branchId)) {
      throw new OtpError(403, 'MODERATION_RELATIONSHIP_INVALID', 'The report no longer belongs to this branch relationship.');
    }
  }
  if (actorRole === 'manager' && action === 'suspend_branch_ordering' && targetProfile.role !== 'requester') {
    throw new OtpError(409, 'ORDERING_TARGET_INVALID', 'Branch ordering restrictions apply only to Requesters.');
  }
  if (actorRole === 'admin' && action === 'suspend_platform_ordering' && targetProfile.role !== 'requester') {
    throw new OtpError(409, 'ORDERING_TARGET_INVALID', 'Platform ordering restrictions apply only to Requesters.');
  }

  const accountChanges = accountStatusChanges(targetProfile, action);
  if (accountChanges) await applyAccountAuthState(auth, source.targetUid, action);
  const actionId = createActionId();
  const startsAt = now;
  const endsAt = duration ? new Date(timeOf(now) + duration * DAY_MS) : null;
  const scope = scopeForAction(action, actorRole);
  const branchName = actorRole === 'manager' ? clean(actorBranch?.name, 160) : '';

  return db.runTransaction(async (tx) => {
    const latestMutation = await tx.get(mutationRef);
    if (latestMutation.exists) {
      if (latestMutation.data()?.payloadHash !== payloadHash) throw new OtpError(409, 'MODERATION_MUTATION_CONFLICT', 'This mutation ID was already used for a different action.');
      const prior = await tx.get(db.collection('moderationActions').doc(latestMutation.data()?.actionId));
      if (prior.exists) return { created: false, action: safeAction(withId(prior)) };
    }
    const latestCaseRef = reportId ? db.collection('chatReports').doc(reportId) : db.collection('orderAbuseReviews').doc(abuseReviewId);
    const latestCase = await tx.get(latestCaseRef);
    if (!latestCase.exists) throw new OtpError(404, 'MODERATION_CASE_NOT_FOUND', 'The moderation case was not found.');
    const latestStatus = clean(latestCase.data()?.status || (reportId ? '' : 'open'), 24);
    if (reportId && !['open', 'escalated'].includes(latestStatus)) throw new OtpError(409, 'REPORT_NOT_ACTIONABLE', 'This report has already been resolved.');
    if (abuseReviewId && latestStatus === 'resolved') throw new OtpError(409, 'ABUSE_REVIEW_NOT_ACTIONABLE', 'This review has already been resolved.');

    let restrictionRef = null;
    let restrictionProjection = null;
    if (RESTRICTION_ACTIONS.has(action)) {
      restrictionRef = db.collection(restrictionCollection(scope)).doc(source.targetUid);
      const restrictionSnapshot = await tx.get(restrictionRef);
      const restriction = {
        scope,
        ...(scope.startsWith('branch_') ? { branchId: source.branchId, branchNameSnapshot: branchName } : {}),
        startsAt,
        endsAt,
        reasonCategory: source.category,
        sourceModerationActionId: actionId,
        updatedAt: now,
      };
      restrictionProjection = nextRestrictionProjection(restrictionSnapshot.exists ? restrictionSnapshot.data() || {} : {}, restriction, now);
    }

    const actionRecord = {
      schemaVersion: 1,
      ...(reportId ? { reportId } : { orderAbuseReviewId: abuseReviewId }),
      targetUid: source.targetUid,
      targetPublicUidSnapshot: publicUidOf(targetProfile) || source.targetPublicUid,
      targetRole: targetProfile.role,
      scope,
      ...(scope.startsWith('branch') ? { branchId: source.branchId } : {}),
      action,
      startsAt,
      ...(endsAt ? { endsAt } : {}),
      reasonCategory: source.category,
      reason,
      privateNote,
      actorUid,
      actorPublicUidSnapshot: publicUidOf(actor.profile || actor),
      actorRole,
      createdAt: now,
      clientMutationId: mutationId,
    };
    const actionRef = db.collection('moderationActions').doc(actionId);
    tx.create(actionRef, actionRecord);
    tx.create(mutationRef, { actorUid, actionId, payloadHash, createdAt: now });
    if (restrictionRef) tx.set(restrictionRef, restrictionProjection);
    if (accountChanges) {
      tx.update(db.collection('users').doc(source.targetUid), { ...accountChanges, updatedAt: now, updatedBy: actorUid });
      tx.set(db.collection('adminAuditLogs').doc(), {
        action: action === 'suspend_account' ? 'ACCOUNT_SUSPENDED' : action === 'terminate_account' ? 'ACCOUNT_TERMINATED' : 'ACCOUNT_REACTIVATED',
        actorUid,
        targetUid: source.targetUid,
        role: targetProfile.role,
        before: { accountStatus: canonicalAccountStatus(targetProfile) },
        after: { accountStatus: accountChanges.accountStatus },
        createdAt: now,
      });
    }

    const remainsActionable = action === 'escalate' || (actorRole === 'manager' && action === 'warn');
    const nextStatus = action === 'escalate' ? 'escalated' : remainsActionable ? latestStatus : 'resolved';
    tx.update(latestCaseRef, {
      status: nextStatus,
      reviewedByUid: actorUid,
      reviewedByPublicUidSnapshot: publicUidOf(actor.profile || actor),
      reviewedByRole: actorRole,
      reviewedAt: now,
      actionTaken: action,
      ...(!remainsActionable ? { resolvedAt: now } : {}),
      ...(action === 'escalate' ? { escalatedAt: now, escalationReason: reason } : {}),
      updatedAt: now,
    });
    if (NOTICE_ACTIONS.has(action)) {
      const notice = noticeForAction({ actionId, action, scope, category: source.category, branchId: scope.startsWith('branch') ? source.branchId : null, branchName, startsAt, endsAt, createdAt: now });
      tx.create(db.collection('moderationNotices').doc(source.targetUid).collection('items').doc(actionId), notice);
    }
    tx.set(db.collection('moderationActivity').doc(`user_${source.targetUid}`), { uid: source.targetUid, updatedAt: now, revision: randomUUID() });
    tx.set(db.collection('moderationActivity').doc('admin'), { updatedAt: now, revision: randomUUID() });
    if (source.branchId) tx.set(db.collection('moderationActivity').doc(`branch_${source.branchId}`), { branchId: source.branchId, updatedAt: now, revision: randomUUID() });
    return { created: true, action: safeAction({ id: actionId, ...actionRecord }) };
  });
}

function errorResponse(res, error) {
  const known = error instanceof OtpError;
  return res.status(known ? error.status : 500).json({ error: {
    reason: known ? error.reason : 'MODERATION_SERVICE_UNAVAILABLE',
    message: known ? error.message : 'Reports & Safety is temporarily unavailable.',
  } });
}

function paramsOf(req, fallbackPath) {
  return new URL(req.url || fallbackPath, 'http://localhost').searchParams;
}

function createModerationHandler(role, getAdmin = getFirebaseAdmin, dependencies = {}) {
  const now = dependencies.now || (() => new Date());
  const createActionId = dependencies.createActionId || randomUUID;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or POST.' } });
    try {
      const { auth, db } = getAdmin();
      const actor = role === 'manager' ? await requireActiveManager(req, auth, db) : await requireAdmin(req, auth, db);
      const actorProfile = role === 'manager' ? actor.profile : (await db.collection('users').doc(actor.uid).get()).data() || {};
      const actorValue = role === 'manager' ? actor : { uid: actor.uid, ...actorProfile, profile: actorProfile };
      if (req.method === 'POST') {
        const result = await applyModerationAction({ auth, db, actor: actorValue, actorRole: role, actorBranch: actor.branch || null, body: bodyOf(req), now: now(), createActionId });
        return res.status(result.created ? 201 : 200).json(result);
      }
      const params = paramsOf(req, `/api/${role}/moderation`);
      const kind = clean(params.get('kind') || 'reports', 24);
      const limit = pageSize(params.get('limit'));
      const branchId = role === 'manager' ? actor.branch.id : '';
      if (kind === 'detail') return res.status(200).json(await reportDetail(db, params.get('reportId'), branchId));
      if (kind === 'abuse') return res.status(200).json(await abuseReviewList(db, { branchId, limit }));
      return res.status(200).json(await reportList(db, { branchId, status: statusFilter(params.get('status')), limit, cursor: clean(params.get('cursor'), 128) }));
    } catch (error) { return errorResponse(res, error); }
  };
}

function createAdminChatReviewHandler(getAdmin = getFirebaseAdmin, dependencies = {}) {
  const now = dependencies.now || (() => new Date());
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      const { auth, db } = getAdmin();
      const admin = await requireAdmin(req, auth, db);
      return res.status(200).json(await expandChatReview({ db, admin, body: bodyOf(req), now: now() }));
    } catch (error) { return errorResponse(res, error); }
  };
}

async function expandChatReview({ db, admin, body, now }) {
  const reportId = clean(body.reportId, 128);
  const reason = boundedText(body.reason, { required: true, max: 1000, reason: 'CHAT_REVIEW_REASON_TOO_LONG' });
  const reportSnapshot = reportId ? await db.collection('chatReports').doc(reportId).get() : null;
  const report = withId(reportSnapshot);
  if (!report) throw new OtpError(404, 'REPORT_NOT_FOUND', 'The report was not found.');
  const conversationRef = db.collection('chatConversations').doc(report.conversationId);
  const conversationSnapshot = await conversationRef.get();
  if (!conversationSnapshot.exists) throw new OtpError(404, 'REPORT_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
  const messageSnapshot = await conversationRef.collection('messages').orderBy('seq', 'desc').limit(20).get();
  const context = (messageSnapshot.docs || []).map(withId).reverse().map((message) => ({
    messageId: message.id,
    seq: Number(message.seq || 0),
    senderPublicUid: clean(message.senderPublicUidSnapshot, 80),
    senderRole: clean(message.senderRole, 30),
    body: clean(message.body, 2000),
    createdAt: isoTimestamp(message.createdAt),
  }));
  await db.collection('adminAuditLogs').doc().set({
    action: 'CHAT_REVIEW_EXPANDED', actorUid: admin.uid,
    actorPublicUidSnapshot: publicUidOf((await db.collection('users').doc(admin.uid).get()).data() || {}),
    reportId, conversationId: report.conversationId, reason, messageCount: context.length, createdAt: now,
  });
  return { reportId, context };
}

function createModerationNoticesHandler(getAdmin = getFirebaseAdmin, dependencies = {}) {
  const now = dependencies.now || (() => new Date());
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or POST.' } });
    try {
      const { auth, db } = getAdmin();
      const decoded = await verifiedIdentity(req, auth);
      const profileSnapshot = await db.collection('users').doc(decoded.uid).get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : null;
      if (!profile || !['requester', 'distributor'].includes(clean(profile.role, 30))) throw new OtpError(403, 'NOTICE_ACCESS_DENIED', 'Account notices are unavailable.');
      const collection = db.collection('moderationNotices').doc(decoded.uid).collection('items');
      if (req.method === 'GET') {
        const snapshot = await collection.orderBy('createdAt', 'desc').limit(50).get();
        return res.status(200).json({ notices: (snapshot.docs || []).map((item) => safeNotice(item.id, item.data() || {})) });
      }
      const body = bodyOf(req);
      const noticeId = clean(body.noticeId, 128);
      const action = clean(body.action || 'acknowledge', 24).toLowerCase();
      if (!['seen', 'acknowledge'].includes(action)) throw new OtpError(400, 'NOTICE_ACTION_INVALID', 'Choose seen or acknowledge.');
      const ref = collection.doc(noticeId);
      const snapshot = noticeId ? await ref.get() : null;
      if (!snapshot?.exists) throw new OtpError(404, 'NOTICE_NOT_FOUND', 'The account notice was not found.');
      const timestamp = now();
      const seenAt = snapshot.data()?.seenAt || timestamp;
      const acknowledgedAt = action === 'acknowledge' ? snapshot.data()?.acknowledgedAt || timestamp : snapshot.data()?.acknowledgedAt || null;
      await ref.update({ seenAt, ...(action === 'acknowledge' ? { acknowledgedAt } : {}) });
      return res.status(200).json({ notice: safeNotice(noticeId, { ...snapshot.data(), acknowledgedAt, seenAt }) });
    } catch (error) { return errorResponse(res, error); }
  };
}

const createManagerModerationHandler = (getAdmin, dependencies) => createModerationHandler('manager', getAdmin, dependencies);
const createAdminModerationHandler = (getAdmin, dependencies) => createModerationHandler('admin', getAdmin, dependencies);

module.exports = {
  ADMIN_ACTIONS,
  MANAGER_ACTIONS,
  applyModerationAction,
  createAdminChatReviewHandler,
  createAdminModerationHandler,
  createManagerModerationHandler,
  createModerationNoticesHandler,
  expandChatReview,
  reportDetail,
  reportList,
  safeAbuseReview,
  safeAction,
  safeReport,
};
