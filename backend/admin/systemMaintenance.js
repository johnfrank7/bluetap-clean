const { OtpError } = require('../utils/otpError');
const { createRegistrationLimitService } = require('../registration/registrationLimits');

const CONFIG_PATH = Object.freeze(['systemConfig', 'dataRetention']);
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 400;

const DEFAULT_RETENTION_POLICY = Object.freeze({
  notificationRetentionDays: 30,
  incompleteRegistrationRetentionHours: 48,
  verificationRetentionHours: 24,
  rateLimitRetentionDays: 7,
  completedOrderArchiveDays: 90,
  chatMessageRetentionDays: 90,
  chatReportEvidenceRetentionDays: 180,
  version: 1,
});

const POLICY_OPTIONS = Object.freeze({
  notificationRetentionDays: Object.freeze([30]),
  incompleteRegistrationRetentionHours: Object.freeze([24, 48, 72, 168]),
  verificationRetentionHours: Object.freeze([12, 24, 48, 72]),
  rateLimitRetentionDays: Object.freeze([1, 7, 14, 30]),
  completedOrderArchiveDays: Object.freeze([30, 60, 90, 180, 365]),
  chatMessageRetentionDays: Object.freeze([30, 60, 90, 180]),
  chatReportEvidenceRetentionDays: Object.freeze([90, 180, 365]),
});

const PROTECTED_DATA = Object.freeze([
  'User accounts',
  'Firebase Auth identities',
  'Public UID counters',
  'Branch records',
  'Authoritative historical orders',
  'Financial and order snapshots',
  'Admin audit records',
  'Security configuration',
]);

const TERMINAL_ORDER_STATUSES = Object.freeze([
  'delivered', 'completed', 'cancelled', 'canceled', 'rejected', 'declined',
  'declined_outside_service_area',
]);

const TERMINAL_ORDER_QUERY_STATUSES = Object.freeze([
  'delivered', 'completed', 'Cancelled', 'cancelled', 'canceled', 'rejected',
  'declined', 'declined_outside_service_area',
]);

function millis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRetentionPolicy(value) {
  const source = value && typeof value === 'object' ? value : {};
  const policy = {};
  for (const [key, allowed] of Object.entries(POLICY_OPTIONS)) {
    const parsed = Number(source[key]);
    policy[key] = allowed.includes(parsed) ? parsed : DEFAULT_RETENTION_POLICY[key];
  }
  const version = Number(source.version);
  policy.version = Number.isInteger(version) && version > 0 ? version : DEFAULT_RETENTION_POLICY.version;
  return policy;
}

function validateRetentionPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OtpError(400, 'INVALID_RETENTION_POLICY', 'Retention policy settings are invalid.');
  }
  const policy = {};
  for (const [key, allowed] of Object.entries(POLICY_OPTIONS)) {
    const parsed = Number(value[key]);
    if (!Number.isInteger(parsed) || !allowed.includes(parsed)) {
      throw new OtpError(400, 'UNSAFE_RETENTION_POLICY', 'Choose one of the supported safe retention periods.');
    }
    policy[key] = parsed;
  }
  return policy;
}

async function loadMaintenanceDocument(db) {
  const snapshot = await db.collection(CONFIG_PATH[0]).doc(CONFIG_PATH[1]).get();
  return snapshot.exists ? snapshot.data() || {} : {};
}

async function loadRetentionPolicy(db) {
  return normalizeRetentionPolicy(await loadMaintenanceDocument(db));
}

function queryBefore(db, collectionName, field, cutoff) {
  return db.collection(collectionName).where(field, '<=', new Date(cutoff)).get();
}

function documents(snapshot) {
  return Array.isArray(snapshot?.docs) ? snapshot.docs : [];
}

function expiredSession(doc, cutoff, now, { incomplete = false } = {}) {
  const data = doc.data() || {};
  if (incomplete && data.completed === true) return false;
  return millis(data.createdAt) > 0 && millis(data.createdAt) <= cutoff &&
    millis(data.expiresAt) > 0 && millis(data.expiresAt) <= now;
}

function orderArchiveTime(data) {
  return millis(data.deliveredAt || data.delivered_at || data.cancelledAt || data.cancelled_at ||
    data.canceled_at || data.rejectedAt || data.declinedAt || data.updatedAt || data.updated_at ||
    data.createdAt || data.created_at);
}

function eligibleOrder(doc, cutoff) {
  const data = doc.data() || {};
  const status = String(data.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const terminalAt = orderArchiveTime(data);
  return data.archived !== true && TERMINAL_ORDER_STATUSES.includes(status) && terminalAt > 0 && terminalAt <= cutoff;
}

async function collectMaintenanceTargets(db, policy, now = Date.now()) {
  const registrationCutoff = now - policy.incompleteRegistrationRetentionHours * 60 * 60 * 1000;
  const verificationCutoff = now - policy.verificationRetentionHours * 60 * 60 * 1000;
  const rateLimitCutoff = now - policy.rateLimitRetentionDays * DAY_MS;
  const orderCutoff = now - policy.completedOrderArchiveDays * DAY_MS;
  const chatCutoff = now - policy.chatMessageRetentionDays * DAY_MS;
  const reportEvidenceCutoff = now - policy.chatReportEvidenceRetentionDays * DAY_MS;

  const [registrations, usernameReservations, emailVerifications, passwordVerifications, authRateLimits, registrationOtpRateLimits, passwordRateLimits, orders] = await Promise.all([
    queryBefore(db, 'registrationSessions', 'createdAt', registrationCutoff),
    queryBefore(db, 'usernameReservations', 'createdAt', registrationCutoff),
    queryBefore(db, 'emailOtpVerifications', 'createdAt', verificationCutoff),
    queryBefore(db, 'passwordResetSessions', 'createdAt', verificationCutoff),
    queryBefore(db, 'authRateLimits', 'resetAt', rateLimitCutoff),
    db.collection('emailOtpVerifications').where('resetAt', '<=', rateLimitCutoff).get(),
    queryBefore(db, 'passwordResetRateLimits', 'lastSentAt', rateLimitCutoff),
    db.collection('requests').where('status', 'in', TERMINAL_ORDER_QUERY_STATUSES).get(),
  ]);

  const registrationSessions = documents(registrations).filter((doc) => expiredSession(doc, registrationCutoff, now, { incomplete: true }));
  const expiredUsernameReservations = documents(usernameReservations).filter((doc) => {
    const data = doc.data() || {};
    return millis(data.createdAt) > 0 && millis(data.createdAt) <= registrationCutoff && millis(data.expiresAt) > 0 && millis(data.expiresAt) <= now;
  });
  const emailOtpVerifications = documents(emailVerifications).filter((doc) => expiredSession(doc, verificationCutoff, now));
  const passwordResetSessions = documents(passwordVerifications).filter((doc) => expiredSession(doc, verificationCutoff, now));
  const expiredAuthRateLimits = documents(authRateLimits).filter((doc) => millis(doc.data()?.resetAt) <= rateLimitCutoff);
  const expiredRegistrationOtpRateLimits = documents(registrationOtpRateLimits)
    .filter((doc) => String(doc.id || '').startsWith('registration-ip-') && millis(doc.data()?.resetAt) <= rateLimitCutoff);
  const expiredPasswordRateLimits = documents(passwordRateLimits).filter((doc) => millis(doc.data()?.lastSentAt) <= rateLimitCutoff);
  const ordersToArchive = documents(orders).filter((doc) => eligibleOrder(doc, orderCutoff));

  let chatMessages = [];
  let openChatReports = [];
  let escalatedChatReports = [];
  let resolvedChatReports = [];
  let chatRestrictions = [];
  let orderingRestrictions = [];
  if (typeof db.collectionGroup === 'function') {
    const [messageSnapshot, openReportSnapshot, escalatedReportSnapshot, resolvedReportSnapshot, chatRestrictionSnapshot, orderingRestrictionSnapshot] = await Promise.all([
      db.collectionGroup('messages').where('createdAt', '<=', new Date(chatCutoff)).orderBy('createdAt', 'asc').limit(BATCH_SIZE).get(),
      db.collection('chatReports').where('status', '==', 'open').orderBy('createdAt', 'desc').limit(BATCH_SIZE).get(),
      db.collection('chatReports').where('status', '==', 'escalated').orderBy('createdAt', 'desc').limit(BATCH_SIZE).get(),
      db.collection('chatReports').where('resolvedAt', '<=', new Date(reportEvidenceCutoff)).orderBy('resolvedAt', 'asc').limit(BATCH_SIZE).get(),
      db.collection('chatRestrictions').where('nextExpiryAt', '<=', new Date(now)).limit(BATCH_SIZE).get(),
      db.collection('orderingRestrictions').where('nextExpiryAt', '<=', new Date(now)).limit(BATCH_SIZE).get(),
    ]);
    chatMessages = documents(messageSnapshot);
    openChatReports = documents(openReportSnapshot);
    escalatedChatReports = documents(escalatedReportSnapshot);
    resolvedChatReports = documents(resolvedReportSnapshot).filter((doc) => String(doc.data()?.status || '').toLowerCase() === 'resolved');
    chatRestrictions = documents(chatRestrictionSnapshot);
    orderingRestrictions = documents(orderingRestrictionSnapshot);
  }
  const evidenceHeldMessageKeys = new Set();
  for (const reportDoc of [...openChatReports, ...escalatedChatReports]) {
    const report = reportDoc.data() || {};
    const status = String(report.status || '').toLowerCase();
    if (!['open', 'escalated'].includes(status)) continue;
    for (const message of report.evidenceSnapshot || []) {
      if (report.conversationId && message.messageId) evidenceHeldMessageKeys.add(`${report.conversationId}/${message.messageId}`);
    }
  }
  for (const messageDoc of chatMessages) {
    for (const reportId of (messageDoc.data()?.retentionHoldReportIds || []).slice(0, 10)) {
      const reportSnapshot = await db.collection('chatReports').doc(String(reportId)).get();
      if (!reportSnapshot.exists) continue;
      const report = reportSnapshot.data() || {};
      const status = String(report.status || '').toLowerCase();
      const stillHeld = ['open', 'escalated'].includes(status) || (status === 'resolved' && millis(report.resolvedAt) + policy.chatReportEvidenceRetentionDays * DAY_MS > now);
      if (stillHeld) evidenceHeldMessageKeys.add(messageKeyFromPath(messageDoc));
    }
  }
  function messageKeyFromPath(doc) { const segments = String(doc.ref?.path || '').split('/'); return segments.length >= 4 ? `${segments[1]}/${doc.id}` : ''; }
  const messageKey = messageKeyFromPath;
  const chatMessagesProtectedByEvidence = chatMessages.filter((doc) => evidenceHeldMessageKeys.has(messageKey(doc)));
  const chatMessagesToDelete = chatMessages.filter((doc) => !evidenceHeldMessageKeys.has(messageKey(doc)));
  const reportEvidenceToPurge = resolvedChatReports.filter((doc) => {
    const report = doc.data() || {};
    return String(report.status || '').toLowerCase() === 'resolved' && millis(report.resolvedAt) > 0 && millis(report.resolvedAt) <= reportEvidenceCutoff && (report.evidenceSnapshot || []).length > 0;
  });

  return {
    registrationSessions,
    usernameReservations: expiredUsernameReservations,
    emailOtpVerifications,
    passwordResetSessions,
    authRateLimits: expiredAuthRateLimits,
    registrationOtpRateLimits: expiredRegistrationOtpRateLimits,
    passwordResetRateLimits: expiredPasswordRateLimits,
    ordersToArchive,
    chatMessagesToDelete,
    chatMessagesProtectedByEvidence,
    reportEvidenceToPurge,
    openReportEvidenceProtected: [...openChatReports, ...escalatedChatReports].filter((doc) => (doc.data()?.evidenceSnapshot || []).length > 0),
    expiredRestrictionProjections: [...chatRestrictions, ...orderingRestrictions],
  };
}

function summarizeTargets(targets) {
  const expiredRegistrationSessions = targets.registrationSessions.length;
  const expiredUsernameReservations = targets.usernameReservations.length;
  const expiredVerificationSessions = targets.emailOtpVerifications.length + targets.passwordResetSessions.length;
  const expiredRateLimitRecords = targets.authRateLimits.length + targets.registrationOtpRateLimits.length + targets.passwordResetRateLimits.length;
  const ordersEligibleForArchive = targets.ordersToArchive.length;
  const expiredChatMessages = targets.chatMessagesToDelete.length;
  const chatMessagesProtectedByEvidence = targets.chatMessagesProtectedByEvidence.length;
  const reportEvidenceEligibleForPurge = targets.reportEvidenceToPurge.length;
  const expiredRestrictionProjections = targets.expiredRestrictionProjections.length;
  const openReportEvidenceProtected = targets.openReportEvidenceProtected.length;
  return {
    expiredNotifications: 0,
    expiredRegistrationSessions,
    expiredUsernameReservations,
    expiredVerificationSessions,
    expiredRateLimitRecords,
    ordersEligibleForArchive,
    expiredChatMessages,
    chatMessagesProtectedByEvidence,
    chatMessagesSkipped: chatMessagesProtectedByEvidence,
    openReportEvidenceProtected,
    reportEvidenceEligibleForPurge,
    expiredRestrictionProjections,
    closedConversationsEligible: 0,
    temporaryRecordsEligible: expiredRegistrationSessions + expiredUsernameReservations + expiredVerificationSessions + expiredRateLimitRecords + expiredChatMessages,
  };
}

async function previewCleanup(db, policy, now = Date.now()) {
  const targets = await collectMaintenanceTargets(db, policy, now);
  return {
    counts: summarizeTargets(targets),
    notificationArchitecture: 'derived',
    notificationWindowDays: policy.notificationRetentionDays,
    protectedData: [...PROTECTED_DATA],
    calculatedAt: new Date(now),
  };
}

function operationChunks(operations) {
  const chunks = [];
  for (let index = 0; index < operations.length; index += BATCH_SIZE) chunks.push(operations.slice(index, index + BATCH_SIZE));
  return chunks;
}

async function commitOperations(db, operations) {
  for (const chunk of operationChunks(operations)) {
    const batch = db.batch();
    for (const operation of chunk) {
      if (operation.type === 'delete') batch.delete(operation.ref);
      else batch.update(operation.ref, operation.data);
    }
    await batch.commit();
  }
}

async function writeCleanupAudit(db, entry) {
  const auditRef = db.collection('adminAuditLogs').doc();
  const configRef = db.collection(CONFIG_PATH[0]).doc(CONFIG_PATH[1]);
  const batch = db.batch();
  batch.set(auditRef, entry);
  batch.set(configRef, { lastCleanup: entry }, { merge: true });
  await batch.commit();
}

async function runCleanup(db, policy, triggeredBy, now = Date.now()) {
  const startedAt = Date.now();
  const targets = await collectMaintenanceTargets(db, policy, now);
  const preview = summarizeTargets(targets);
  const archivedAt = new Date(now);
  const operations = [];
  const safeFailures = [];
  const deletableRegistrationSessions = [];
  const registrationLimits = createRegistrationLimitService({ db, now: () => now });
  for (const doc of targets.registrationSessions) {
    const reservation = doc.data()?.registrationLimitReservation;
    try {
      if (reservation?.status === 'reserved' && reservation.uid) await registrationLimits.release(doc.id, reservation.uid);
      deletableRegistrationSessions.push(doc);
    } catch {
      safeFailures.push({ category: 'incomplete-registration', count: 1, reason: 'reservation-release-failed' });
    }
  }
  const actualTargets = { ...targets, registrationSessions: deletableRegistrationSessions };
  for (const key of ['registrationSessions', 'usernameReservations', 'emailOtpVerifications', 'passwordResetSessions', 'authRateLimits', 'registrationOtpRateLimits', 'passwordResetRateLimits']) {
    for (const doc of actualTargets[key]) operations.push({ type: 'delete', ref: doc.ref });
  }
  for (const doc of targets.ordersToArchive) {
    operations.push({ type: 'update', ref: doc.ref, data: { archived: true, archivedAt, archivedByMaintenance: true } });
  }
  const previewClears = new Set();
  for (const doc of targets.chatMessagesToDelete) {
    operations.push({ type: 'delete', ref: doc.ref });
    const conversationRef = doc.ref?.parent?.parent;
    if (!conversationRef?.get || previewClears.has(conversationRef.path)) continue;
    const conversationSnapshot = await conversationRef.get();
    if (conversationSnapshot.exists && Number(conversationSnapshot.data()?.lastMessageSeq || 0) === Number(doc.data()?.seq || -1)) {
      previewClears.add(conversationRef.path);
      operations.push({ type: 'update', ref: conversationRef, data: { lastMessagePreview: '', lastMessageAt: null, retentionPreviewClearedAt: archivedAt } });
    }
  }
  for (const doc of targets.reportEvidenceToPurge) {
    operations.push({ type: 'update', ref: doc.ref, data: { evidenceSnapshot: [], retentionHold: false, evidencePurgedAt: archivedAt, updatedAt: archivedAt } });
  }
  for (const doc of targets.expiredRestrictionProjections) {
    const current = doc.data() || {};
    const platform = millis(current.platform?.endsAt) > now ? current.platform : null;
    const branches = Object.fromEntries(Object.entries(current.branches || {}).filter(([, entry]) => millis(entry?.endsAt) > now));
    const expiries = [platform, ...Object.values(branches)].map((entry) => millis(entry?.endsAt)).filter((value) => value > now);
    if (!platform && Object.keys(branches).length === 0) operations.push({ type: 'delete', ref: doc.ref });
    else operations.push({ type: 'update', ref: doc.ref, data: { platform, branches, nextExpiryAt: expiries.length ? new Date(Math.min(...expiries)) : null, updatedAt: archivedAt } });
  }
  try {
    await commitOperations(db, operations);
  } catch {
    const failedAudit = {
      action: 'SYSTEM_MAINTENANCE_CLEANUP',
      actorUid: triggeredBy || 'system',
      triggeredBy: triggeredBy || 'system',
      result: 'failed',
      policySnapshot: { ...policy },
      summary: { deleted: { incompleteRegistrationSessions: 0, usernameReservations: 0, verificationSessions: 0, rateLimitRecords: 0 }, archivedOrders: 0, totalTemporaryRecordsRemoved: 0 },
      safeFailures: [{ category: 'cleanup-batch', count: operations.length, reason: 'write-failed' }],
      durationMs: Math.max(0, Date.now() - startedAt),
      createdAt: archivedAt,
    };
    try { await writeCleanupAudit(db, failedAudit); } catch { /* preserve the sanitized cleanup failure */ }
    throw new OtpError(503, 'CLEANUP_WRITE_FAILED', 'Cleanup could not be completed safely. No retry has been started automatically.');
  }

  const summary = {
    deleted: {
      incompleteRegistrationSessions: actualTargets.registrationSessions.length,
      usernameReservations: targets.usernameReservations.length,
      verificationSessions: targets.emailOtpVerifications.length + targets.passwordResetSessions.length,
      rateLimitRecords: targets.authRateLimits.length + targets.registrationOtpRateLimits.length + targets.passwordResetRateLimits.length,
      chatMessages: targets.chatMessagesToDelete.length,
    },
    reportEvidencePurged: targets.reportEvidenceToPurge.length,
    restrictionProjectionsCleaned: targets.expiredRestrictionProjections.length,
    chatMessagesProtectedByEvidence: targets.chatMessagesProtectedByEvidence.length,
    archivedOrders: targets.ordersToArchive.length,
    totalTemporaryRecordsRemoved: actualTargets.registrationSessions.length + targets.usernameReservations.length + targets.emailOtpVerifications.length +
      targets.passwordResetSessions.length + targets.authRateLimits.length + targets.registrationOtpRateLimits.length + targets.passwordResetRateLimits.length + targets.chatMessagesToDelete.length,
  };
  const audit = {
    action: 'SYSTEM_MAINTENANCE_CLEANUP',
    actorUid: triggeredBy || 'system',
    triggeredBy: triggeredBy || 'system',
    result: safeFailures.length ? 'partial' : operations.length ? 'success' : 'no-op',
    policySnapshot: { ...policy },
    summary,
    safeFailures,
    durationMs: Math.max(0, Date.now() - startedAt),
    createdAt: archivedAt,
  };
  await writeCleanupAudit(db, audit);
  return { counts: preview, summary, result: audit.result, safeFailures, completedAt: archivedAt };
}

async function loadCleanupHistory(db) {
  const snapshot = await db.collection('adminAuditLogs').orderBy('createdAt', 'desc').limit(50).get();
  return documents(snapshot)
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((entry) => entry.action === 'SYSTEM_MAINTENANCE_CLEANUP')
    .slice(0, 10)
    .map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt || null,
      triggeredBy: entry.triggeredBy || entry.actorUid || 'system',
      result: entry.result || 'success',
      temporaryRecordsRemoved: Number(entry.summary?.totalTemporaryRecordsRemoved || 0),
      ordersArchived: Number(entry.summary?.archivedOrders || 0),
    }));
}

async function loadMaintenanceOverview(db) {
  const document = await loadMaintenanceDocument(db);
  return {
    policy: normalizeRetentionPolicy(document),
    status: {
      lastCleanupAt: document.lastCleanup?.createdAt || null,
      nextScheduledCleanupAt: null,
      cleanupMode: 'Manual',
      automaticCleanupConfigured: false,
    },
    protectedData: [...PROTECTED_DATA],
    history: await loadCleanupHistory(db),
  };
}

module.exports = {
  CONFIG_PATH,
  DEFAULT_RETENTION_POLICY,
  POLICY_OPTIONS,
  PROTECTED_DATA,
  collectMaintenanceTargets,
  eligibleOrder,
  loadMaintenanceOverview,
  loadRetentionPolicy,
  normalizeRetentionPolicy,
  previewCleanup,
  runCleanup,
  summarizeTargets,
  validateRetentionPolicy,
};
