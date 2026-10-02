const { createHash } = require('node:crypto');
const { OtpError } = require('../utils/otpError');

const DAY_MS = 24 * 60 * 60 * 1000;
const REPORT_RATE_LIMIT = 5;
const REPORT_RATE_WINDOW_MS = 60 * 60 * 1000;
const REPORT_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const ABUSE_REVIEW_WINDOW_DAYS = 30;
const ABUSE_REVIEW_THRESHOLD = 3;
const ABUSE_STRONG_THRESHOLD = 5;
const REQUESTER_ATTRIBUTABLE_FAILURE_CODES = new Set([
  'CUSTOMER_UNAVAILABLE',
  'NO_RESPONSE',
  'RECIPIENT_REFUSED',
]);
const NON_ATTRIBUTABLE_FAILURE_CODES = new Set([
  'WEATHER_OR_ROAD',
  'VEHICLE_ISSUE',
  'PRODUCT_ISSUE',
  'PAYMENT_ISSUE',
  'LOCATION_INACCESSIBLE',
  'ADDRESS_ISSUE',
]);
const MANAGER_DURATIONS = new Set([1, 3, 7]);
const ADMIN_DURATIONS = new Set([1, 3, 7, 30]);

const clean = (value, max = 1000) => Array.from(String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim()).slice(0, max).join('');
const timeOf = (value) => value?.toMillis?.() || value?.getTime?.() || Number(value?.seconds || value?._seconds || 0) * 1000 || new Date(value || 0).getTime() || 0;
const isoTimestamp = (value) => {
  const carriesWholeSeconds = typeof value?.toMillis !== 'function' && typeof value?.getTime !== 'function';
  const nanoseconds = carriesWholeSeconds ? Number(value?.nanoseconds ?? value?._nanoseconds ?? 0) : 0;
  const milliseconds = timeOf(value) + (Number.isFinite(nanoseconds) ? Math.floor(nanoseconds / 1e6) : 0);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  try { return new Date(milliseconds).toISOString(); } catch { return null; }
};
const publicUidOf = (profile = {}) => clean(profile.publicUid || profile.displayUid || profile.unique_id, 80);
const displayNameOf = (profile = {}) => clean(profile.fullName || `${profile.firstName || ''} ${profile.lastName || ''}`, 160);
const hashId = (...parts) => createHash('sha256').update(parts.map((part) => clean(part, 256)).join('|')).digest('hex');

function boundedText(value, { required = false, max = 1000, reason = 'DETAILS_TOO_LONG' } = {}) {
  const normalized = String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = Array.from(normalized).length;
  if (required && !normalized) throw new OtpError(400, 'DETAILS_REQUIRED', 'Add a meaningful description.');
  if (length > max) throw new OtpError(400, reason, `Use ${max} characters or fewer.`);
  return normalized;
}

function durationDays(value, role) {
  const days = Number(value);
  const allowed = role === 'manager' ? MANAGER_DURATIONS : ADMIN_DURATIONS;
  if (!Number.isInteger(days) || !allowed.has(days)) {
    throw new OtpError(400, 'MODERATION_DURATION_INVALID', 'Choose a supported restriction duration.');
  }
  return days;
}

function restrictionBranch(record = {}, branchId = '', now = Date.now()) {
  const branch = record.branches?.[clean(branchId, 128)] || null;
  return branch && timeOf(branch.endsAt) > timeOf(now) ? branch : null;
}

function restrictionPlatform(record = {}, now = Date.now()) {
  const platform = record.platform || null;
  return platform && timeOf(platform.endsAt) > timeOf(now) ? platform : null;
}

function effectiveRestriction(record = {}, branchId = '', now = Date.now()) {
  return restrictionPlatform(record, now) || restrictionBranch(record, branchId, now);
}

async function restrictionRecord(reader, db, collection, uid) {
  const ref = db.collection(collection).doc(clean(uid, 128));
  const snapshot = await reader.get(ref);
  return { ref, data: snapshot.exists ? snapshot.data() || {} : {} };
}

async function assertChatSendAllowed(reader, db, uid, branchId, now = Date.now()) {
  const { data } = await restrictionRecord(reader, db, 'chatRestrictions', uid);
  const platform = restrictionPlatform(data, now);
  if (platform) throw new OtpError(403, 'CHAT_PLATFORM_SUSPENDED', 'Your BlueTap messaging access is temporarily suspended.', { scope: 'platform_chat', endsAt: platform.endsAt });
  const branch = restrictionBranch(data, branchId, now);
  if (branch) throw new OtpError(403, 'CHAT_BRANCH_SUSPENDED', 'Messaging is temporarily unavailable for this branch.', { scope: 'branch_chat', branchName: branch.branchNameSnapshot || '', endsAt: branch.endsAt });
  return null;
}

async function assertOrderingAllowed(reader, db, uid, branchId, now = Date.now()) {
  const { data } = await restrictionRecord(reader, db, 'orderingRestrictions', uid);
  const platform = restrictionPlatform(data, now);
  if (platform) throw new OtpError(403, 'ORDERING_SUSPENDED', 'You cannot place new BlueTap orders while this restriction is active.', { scope: 'platform_ordering', endsAt: platform.endsAt });
  const branch = restrictionBranch(data, branchId, now);
  if (branch) throw new OtpError(403, 'ORDERING_BRANCH_SUSPENDED', 'You cannot place new orders from this branch while this restriction is active.', { scope: 'branch_ordering', branchName: branch.branchNameSnapshot || '', endsAt: branch.endsAt });
  return null;
}

function nextRestrictionProjection(current = {}, restriction, now) {
  const branches = { ...(current.branches || {}) };
  let platform = current.platform || null;
  if (restriction.scope.startsWith('platform_')) platform = restriction;
  else branches[restriction.branchId] = restriction;
  const expiries = [platform, ...Object.values(branches)].map((entry) => timeOf(entry?.endsAt)).filter((value) => value > timeOf(now));
  return {
    schemaVersion: 1,
    platform,
    branches,
    nextExpiryAt: expiries.length ? new Date(Math.min(...expiries)) : null,
    updatedAt: now,
  };
}

function safeRestriction(entry = {}) {
  return {
    scope: clean(entry.scope, 40),
    branchId: clean(entry.branchId, 128) || null,
    branchName: clean(entry.branchNameSnapshot, 160) || null,
    reasonCategory: clean(entry.reasonCategory, 80),
    startsAt: isoTimestamp(entry.startsAt),
    endsAt: isoTimestamp(entry.endsAt),
  };
}

function requesterAttributableFailure(code) {
  return REQUESTER_ATTRIBUTABLE_FAILURE_CODES.has(clean(code, 48).toUpperCase());
}

function cancellationConcern(stage) {
  const normalized = clean(stage, 48).toLowerCase();
  if (normalized === 'out_for_delivery') return 'high';
  if (['approved', 'assigned', 'distributor_assigned', 'accepted', 'scheduled'].includes(normalized)) return 'moderate';
  return 'low';
}

async function recordOrderAbuseIncidentInTransaction({ tx, db, orderId, order = {}, incidentType, category, stage, now = new Date() }) {
  const requesterUid = clean(order.requesterUid || order.requester_id, 128);
  const branchId = clean(order.currentBranchId || order.branchId, 128);
  if (!requesterUid || !branchId) return { recorded: false, reason: 'missing-authority' };
  const normalizedCategory = clean(category, 80).toUpperCase();
  if (incidentType === 'delivery_failure' && !requesterAttributableFailure(normalizedCategory)) {
    return { recorded: false, reason: NON_ATTRIBUTABLE_FAILURE_CODES.has(normalizedCategory) ? 'non-attributable' : 'unclassified' };
  }
  const concern = incidentType === 'cancellation' ? cancellationConcern(stage) : 'moderate';
  if (incidentType === 'cancellation' && concern === 'low') return { recorded: false, reason: 'low-concern-cancellation' };

  const ref = db.collection('orderAbuseReviews').doc(hashId(branchId, requesterUid));
  const snapshot = await tx.get(ref);
  const current = snapshot.exists ? snapshot.data() || {} : {};
  const cutoff = timeOf(now) - ABUSE_REVIEW_WINDOW_DAYS * DAY_MS;
  const incidentKey = hashId(orderId, incidentType, normalizedCategory, stage, timeOf(now));
  const incidents = (Array.isArray(current.incidents) ? current.incidents : [])
    .filter((incident) => timeOf(incident.at) > cutoff && incident.key !== incidentKey)
    .slice(-49);
  incidents.push({
    key: incidentKey,
    orderId: clean(orderId, 128),
    orderReference: clean(order.requestId || order.request_id || orderId, 80),
    type: incidentType,
    category: normalizedCategory,
    stage: clean(stage, 48).toLowerCase(),
    concern,
    at: now,
  });
  const incidentCount = incidents.length;
  const severity = incidentCount >= ABUSE_STRONG_THRESHOLD ? 'strong_review' : incidentCount >= ABUSE_REVIEW_THRESHOLD ? 'review' : 'monitor';
  tx.set(ref, {
    schemaVersion: 1,
    requesterUid,
    requesterPublicUidSnapshot: clean(order.requesterPublicUidSnapshot || order.requesterUniqueId || order.requester_unique_id, 80),
    requesterNameSnapshot: clean(order.requesterNameSnapshot || order.requesterName || order.full_name, 160),
    branchId,
    branchNameSnapshot: clean(order.currentBranchNameSnapshot || order.branchNameSnapshot || order.water_station, 160),
    windowDays: ABUSE_REVIEW_WINDOW_DAYS,
    incidentCount,
    severity,
    incidents,
    firstIncidentAt: incidents[0]?.at || now,
    lastIncidentAt: incidents[incidents.length - 1]?.at || now,
    updatedAt: now,
    status: current.status || 'open',
    reviewedAt: current.reviewedAt || null,
    actionTaken: current.actionTaken || null,
  }, { merge: true });
  return { recorded: true, incidentCount, severity };
}

function noticeForAction({ actionId, action, scope, category, branchId, branchName, startsAt, endsAt, createdAt }) {
  const titles = {
    warn: 'BlueTap Warning',
    suspend_branch_chat: 'Messaging temporarily restricted',
    suspend_platform_chat: 'Messaging temporarily suspended',
    suspend_branch_ordering: 'Ordering temporarily restricted',
    suspend_platform_ordering: 'Ordering temporarily suspended',
    suspend_account: 'Account temporarily suspended',
  };
  return {
    schemaVersion: 1,
    actionId,
    type: action,
    title: titles[action] || 'BlueTap account notice',
    category,
    scope,
    branchId: branchId || null,
    branchName: branchName || null,
    startsAt: startsAt || createdAt,
    endsAt: endsAt || null,
    createdAt,
    acknowledgedAt: null,
    seenAt: null,
  };
}

function safeNotice(id, notice = {}) {
  return {
    id,
    type: clean(notice.type, 60),
    title: clean(notice.title, 160),
    category: clean(notice.category, 80),
    scope: clean(notice.scope, 40),
    branchId: clean(notice.branchId, 128) || null,
    branchName: clean(notice.branchName, 160) || null,
    startsAt: isoTimestamp(notice.startsAt),
    endsAt: isoTimestamp(notice.endsAt),
    createdAt: isoTimestamp(notice.createdAt),
    acknowledgedAt: isoTimestamp(notice.acknowledgedAt),
    seenAt: isoTimestamp(notice.seenAt),
  };
}

module.exports = {
  ABUSE_REVIEW_THRESHOLD,
  ABUSE_REVIEW_WINDOW_DAYS,
  ABUSE_STRONG_THRESHOLD,
  ADMIN_DURATIONS,
  DAY_MS,
  MANAGER_DURATIONS,
  NON_ATTRIBUTABLE_FAILURE_CODES,
  REPORT_DUPLICATE_WINDOW_MS,
  REPORT_RATE_LIMIT,
  REPORT_RATE_WINDOW_MS,
  REQUESTER_ATTRIBUTABLE_FAILURE_CODES,
  assertChatSendAllowed,
  assertOrderingAllowed,
  boundedText,
  cancellationConcern,
  clean,
  displayNameOf,
  durationDays,
  effectiveRestriction,
  hashId,
  isoTimestamp,
  nextRestrictionProjection,
  noticeForAction,
  publicUidOf,
  recordOrderAbuseIncidentInTransaction,
  requesterAttributableFailure,
  restrictionBranch,
  restrictionPlatform,
  safeNotice,
  safeRestriction,
  timeOf,
};
