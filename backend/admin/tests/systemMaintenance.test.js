const assert = require('node:assert/strict');
const test = require('node:test');

const { createAdminSystemMaintenanceHandler } = require('../systemMaintenanceHandler');
const {
  DEFAULT_RETENTION_POLICY,
  loadRetentionPolicy,
  previewCleanup,
  runCleanup,
} = require('../systemMaintenance');

const NOW = new Date('2026-09-28T04:00:00.000Z').getTime();
const hoursAgo = (hours) => new Date(NOW - hours * 60 * 60 * 1000);
const daysAgo = (days) => hoursAgo(days * 24);
const comparable = (value) => value instanceof Date ? value.getTime() : typeof value?.toMillis === 'function' ? value.toMillis() : value;

function fixture(seed = {}, { failCommitAt = 0 } = {}) {
  const records = new Map(Object.entries({
    'users/admin-1': { role: 'admin' },
    'users/user-1': { role: 'requester' },
    ...seed,
  }));
  let nextId = 0;
  let commitCount = 0;

  const refFor = (path) => ({
    path,
    id: path.split('/').pop(),
    parent: path.split('/').length >= 4 ? { parent: refFor(path.split('/').slice(0, -2).join('/')) } : null,
    get: async () => snapshot(path),
    set: async (value, options) => setRecord(path, value, options),
    update: async (value) => setRecord(path, value, { merge: true }),
    delete: async () => records.delete(path),
  });
  const snapshot = (path) => ({
    id: path.split('/').pop(),
    ref: refFor(path),
    exists: records.has(path),
    data: () => records.get(path),
  });
  const setRecord = (path, value, options) => {
    records.set(path, options?.merge ? { ...(records.get(path) || {}), ...value } : { ...value });
  };
  const queryFor = (name, filters = [], sort = null, maximum = null) => ({
    where: (field, op, value) => queryFor(name, [...filters, [field, op, value]], sort, maximum),
    orderBy: (field, direction) => queryFor(name, filters, [field, direction], maximum),
    limit: (value) => queryFor(name, filters, sort, value),
    get: async () => {
      let docs = [...records.keys()]
        .filter((path) => path.startsWith(`${name}/`) && path.split('/').length === 2)
        .map(snapshot)
        .filter((doc) => filters.every(([field, op, expected]) => {
          const actual = comparable(doc.data()?.[field]);
          const wanted = comparable(expected);
          if (op === '<=') return actual !== undefined && actual <= wanted;
          if (op === '==') return actual === wanted;
          if (op === 'in') return expected.includes(doc.data()?.[field]);
          return false;
        }));
      if (sort) {
        const [field, direction] = sort;
        docs.sort((a, b) => (comparable(a.data()?.[field]) || 0) - (comparable(b.data()?.[field]) || 0));
        if (direction === 'desc') docs.reverse();
      }
      if (maximum !== null) docs = docs.slice(0, maximum);
      return { docs, empty: docs.length === 0 };
    },
  });
  const collection = (name) => ({
    ...queryFor(name),
    doc: (id = `generated-${++nextId}`) => refFor(`${name}/${id}`),
    add: async (value) => { const ref = refFor(`${name}/generated-${++nextId}`); await ref.set(value); return ref; },
  });
  const batch = () => {
    const operations = [];
    return {
      delete: (ref) => operations.push(() => records.delete(ref.path)),
      update: (ref, value) => operations.push(() => setRecord(ref.path, value, { merge: true })),
      set: (ref, value, options) => operations.push(() => setRecord(ref.path, value, options)),
      commit: async () => {
        commitCount += 1;
        if (failCommitAt === commitCount) throw new Error('simulated batch failure');
        operations.forEach((operation) => operation());
      },
    };
  };
  const db = {
    collection,
    collectionGroup: (group) => {
      const groupQuery = (filters = [], sort = null, maximum = null) => ({
        where: (field, op, value) => groupQuery([...filters, [field, op, value]], sort, maximum),
        orderBy: (field, direction) => groupQuery(filters, [field, direction], maximum),
        limit: (value) => groupQuery(filters, sort, value),
        get: async () => {
          let docs = [...records.keys()].filter((path) => path.split('/').slice(-2, -1)[0] === group).map(snapshot).filter((doc) => filters.every(([field, op, expected]) => op === '<=' && comparable(doc.data()?.[field]) <= comparable(expected)));
          if (sort) docs.sort((a, b) => (comparable(a.data()?.[sort[0]]) || 0) - (comparable(b.data()?.[sort[0]]) || 0));
          if (sort?.[1] === 'desc') docs.reverse();
          return { docs: maximum == null ? docs : docs.slice(0, maximum) };
        },
      });
      return groupQuery();
    },
    batch,
    runTransaction: async (callback) => {
      const operations = [];
      const result = await callback({
        get: (ref) => ref.get(),
        delete: (ref) => operations.push(() => records.delete(ref.path)),
        update: (ref, value) => operations.push(() => setRecord(ref.path, value, { merge: true })),
        set: (ref, value, options) => operations.push(() => setRecord(ref.path, value, options)),
      });
      operations.forEach((operation) => operation());
      return result;
    },
  };
  const auth = {
    verifyIdToken: async (token) => token === 'admin-token'
      ? { uid: 'admin-1', role: 'admin', admin: true }
      : { uid: 'user-1', role: 'requester' },
  };
  const handler = createAdminSystemMaintenanceHandler(() => ({ auth, db }));
  const invoke = async (method, token, body) => {
    const result = { statusCode: 0, body: null };
    const req = { method, headers: { authorization: `Bearer ${token}` }, body };
    const res = {
      setHeader: () => {},
      status(code) { result.statusCode = code; return this; },
      json(value) { result.body = value; return this; },
      end() { return this; },
    };
    await handler(req, res);
    return result;
  };
  return { db, invoke, records, get commitCount() { return commitCount; } };
}

test('non-Admin cannot save, preview, or run System Maintenance', async () => {
  const f = fixture();
  for (const [method, body] of [
    ['PATCH', { policy: DEFAULT_RETENTION_POLICY }],
    ['POST', { action: 'preview' }],
    ['POST', { action: 'run' }],
  ]) {
    const result = await f.invoke(method, 'user-token', body);
    assert.equal(result.statusCode, 403);
    assert.equal(result.body.error.reason, 'ADMIN_REQUIRED');
  }
});

test('Admin saves a valid policy and unsafe negative or zero values are rejected', async () => {
  const f = fixture();
  const policy = { ...DEFAULT_RETENTION_POLICY, completedOrderArchiveDays: 180 };
  delete policy.version;
  const saved = await f.invoke('PATCH', 'admin-token', { policy });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.policy.completedOrderArchiveDays, 180);
  assert.equal(f.records.get('systemConfig/dataRetention').updatedBy, 'admin-1');
  assert.ok([...f.records.values()].some((entry) => entry.action === 'DATA_RETENTION_POLICY_UPDATED'));

  for (const value of [-1, 0]) {
    const invalid = await f.invoke('PATCH', 'admin-token', { policy: { ...policy, verificationRetentionHours: value } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.error.reason, 'UNSAFE_RETENTION_POLICY');
  }
});

test('an absent policy falls back to safe retention defaults', async () => {
  const f = fixture();
  assert.deepEqual(await loadRetentionPolicy(f.db), DEFAULT_RETENTION_POLICY);
});

test('preview selects only expired ephemeral records and performs zero mutations', async () => {
  const f = fixture({
    'registrationSessions/expired': { completed: false, createdAt: hoursAgo(60), expiresAt: hoursAgo(59) },
    'registrationSessions/fresh': { completed: false, createdAt: hoursAgo(2), expiresAt: hoursAgo(1) },
    'registrationSessions/completed': { completed: true, createdAt: hoursAgo(60), expiresAt: hoursAgo(59) },
    'usernameReservations/expired': { createdAt: hoursAgo(60), expiresAt: hoursAgo(59), ownerHash: 'private-owner-hash' },
    'usernameReservations/fresh': { createdAt: hoursAgo(2), expiresAt: hoursAgo(1), ownerHash: 'private-owner-hash' },
    'emailOtpVerifications/expired': { createdAt: hoursAgo(30), expiresAt: hoursAgo(29) },
    'emailOtpVerifications/fresh': { createdAt: hoursAgo(1), expiresAt: new Date(NOW + 60_000) },
    'passwordResetSessions/expired': { createdAt: hoursAgo(25), expiresAt: hoursAgo(24) },
    'authRateLimits/expired': { resetAt: daysAgo(8) },
    'authRateLimits/fresh': { resetAt: daysAgo(1) },
    'passwordResetRateLimits/expired': { lastSentAt: daysAgo(8) },
    'emailOtpVerifications/registration-ip-old': { resetAt: NOW - 8 * 24 * 60 * 60 * 1000 },
    'requests/terminal-old': { status: 'delivered', deliveredAt: daysAgo(91) },
    'requests/active-old': { status: 'out_for_delivery', createdAt: daysAgo(100) },
  });
  const before = new Map(f.records);
  const preview = await previewCleanup(f.db, DEFAULT_RETENTION_POLICY, NOW);
  assert.deepEqual(preview.counts, {
    expiredNotifications: 0,
    expiredRegistrationSessions: 1,
    expiredUsernameReservations: 1,
    expiredVerificationSessions: 2,
    expiredRateLimitRecords: 3,
    ordersEligibleForArchive: 1,
    expiredChatMessages: 0,
    chatMessagesProtectedByEvidence: 0,
    chatMessagesSkipped: 0,
    openReportEvidenceProtected: 0,
    reportEvidenceEligibleForPurge: 0,
    expiredRestrictionProjections: 0,
    closedConversationsEligible: 0,
    temporaryRecordsEligible: 7,
  });
  assert.equal(preview.notificationArchitecture, 'derived');
  assert.deepEqual(f.records, before);
});

test('cleanup preserves protected data, deletes ephemeral records, and archives authoritative orders in place', async () => {
  const f = fixture({
    'users/requester': { role: 'requester' },
    'counters/unique_ids': { requester: 19 },
    'branches/north': { name: 'North' },
    'products/refill': { name: 'Refill' },
    'adminAuditLogs/existing': { action: 'ACCOUNT_UPDATED', createdAt: daysAgo(400) },
    'systemConfig/registrationSecurity': { emailOtpEnabled: true },
    'registrationSessions/expired': { completed: false, createdAt: hoursAgo(60), expiresAt: hoursAgo(59) },
    'usernameReservations/expired': { createdAt: hoursAgo(60), expiresAt: hoursAgo(59), ownerHash: 'private-owner-hash' },
    'emailOtpVerifications/expired': { createdAt: hoursAgo(30), expiresAt: hoursAgo(29), otpHash: 'secret-hash' },
    'requests/delivered': { status: 'delivered', deliveredAt: daysAgo(100), totalAtOrder: 250 },
    'requests/active': { status: 'out_for_delivery', createdAt: daysAgo(100) },
  });
  const result = await runCleanup(f.db, DEFAULT_RETENTION_POLICY, 'admin-1', NOW);
  assert.equal(result.summary.totalTemporaryRecordsRemoved, 3);
  assert.equal(result.summary.archivedOrders, 1);
  assert.equal(f.records.has('registrationSessions/expired'), false);
  assert.equal(f.records.has('usernameReservations/expired'), false);
  assert.equal(f.records.has('emailOtpVerifications/expired'), false);
  assert.equal(f.records.get('requests/delivered').archived, true);
  assert.equal(f.records.get('requests/delivered').totalAtOrder, 250);
  assert.equal(f.records.get('requests/active').archived, undefined);
  for (const path of ['users/requester', 'counters/unique_ids', 'branches/north', 'products/refill', 'adminAuditLogs/existing', 'systemConfig/registrationSecurity']) {
    assert.equal(f.records.has(path), true, `${path} remains protected`);
  }
  const cleanupAudit = [...f.records.values()].find((entry) => entry.action === 'SYSTEM_MAINTENANCE_CLEANUP');
  assert.equal(cleanupAudit.actorUid, 'admin-1');
  assert.equal(JSON.stringify(cleanupAudit).includes('secret-hash'), false);
  assert.equal(JSON.stringify(cleanupAudit).includes('private-owner-hash'), false);
});

test('chat retention preserves open report evidence and purges eligible resolved evidence', async () => {
  const f = fixture({
    'chatConversations/conversation-1': { lastMessageSeq: 2, lastMessagePreview: 'old ordinary' },
    'chatConversations/conversation-1/messages/evidence': { seq: 1, body: 'held', createdAt: daysAgo(120) },
    'chatConversations/conversation-1/messages/ordinary': { seq: 2, body: 'old ordinary', createdAt: daysAgo(120) },
    'chatReports/open-report': { status: 'open', conversationId: 'conversation-1', createdAt: daysAgo(120), evidenceSnapshot: [{ messageId: 'evidence' }], retentionHold: true },
    'chatReports/resolved-report': { status: 'resolved', conversationId: 'conversation-1', createdAt: daysAgo(300), resolvedAt: daysAgo(200), evidenceSnapshot: [{ messageId: 'gone' }], retentionHold: true },
    'chatRestrictions/user-old': { platform: { endsAt: daysAgo(1) }, branches: {}, nextExpiryAt: daysAgo(1) },
  });
  const preview = await previewCleanup(f.db, DEFAULT_RETENTION_POLICY, NOW);
  assert.equal(preview.counts.expiredChatMessages, 1);
  assert.equal(preview.counts.chatMessagesProtectedByEvidence, 1);
  assert.equal(preview.counts.openReportEvidenceProtected, 1);
  assert.equal(preview.counts.reportEvidenceEligibleForPurge, 1);
  assert.equal(preview.counts.expiredRestrictionProjections, 1);
  const result = await runCleanup(f.db, DEFAULT_RETENTION_POLICY, 'admin-1', NOW);
  assert.equal(f.records.has('chatConversations/conversation-1/messages/evidence'), true);
  assert.equal(f.records.has('chatConversations/conversation-1/messages/ordinary'), false);
  assert.deepEqual(f.records.get('chatReports/resolved-report').evidenceSnapshot, []);
  assert.equal(f.records.has('chatRestrictions/user-old'), false);
  assert.equal(result.summary.chatMessagesProtectedByEvidence, 1);
});

test('cleanup releases a stale registration-limit reservation before deleting its session', async () => {
  const f = fixture({
    'registrationSessions/expired': {
      completed: false,
      createdAt: hoursAgo(60),
      expiresAt: hoursAgo(59),
      registrationLimitKeys: { deviceHash: 'device', ipHash: 'network' },
      registrationLimitReservation: { uid: 'pending-user', status: 'reserved' },
    },
    'registrationLimits/device_device': { reservedCount: 1, finalizedCount: 2 },
    'registrationLimits/ip_network': { reservedCount: 1, finalizedCount: 3 },
  });
  await runCleanup(f.db, DEFAULT_RETENTION_POLICY, 'admin-1', NOW);
  assert.equal(f.records.has('registrationSessions/expired'), false);
  assert.deepEqual(
    [f.records.get('registrationLimits/device_device').reservedCount, f.records.get('registrationLimits/device_device').finalizedCount],
    [0, 2]
  );
  assert.deepEqual(
    [f.records.get('registrationLimits/ip_network').reservedCount, f.records.get('registrationLimits/ip_network').finalizedCount],
    [0, 3]
  );
});

test('cleanup safely retries and a zero-eligible run records a successful no-op', async () => {
  const f = fixture({ 'requests/delivered': { status: 'delivered', deliveredAt: daysAgo(100) } });
  const first = await runCleanup(f.db, DEFAULT_RETENTION_POLICY, 'admin-1', NOW);
  const second = await runCleanup(f.db, DEFAULT_RETENTION_POLICY, 'admin-1', NOW);
  assert.equal(first.summary.archivedOrders, 1);
  assert.equal(second.summary.archivedOrders, 0);
  assert.equal(second.result, 'no-op');
  assert.equal(f.records.get('requests/delivered').archived, true);
});

test('cleanup batches more than 400 records and writes its audit event', async () => {
  const seed = {};
  for (let index = 0; index < 425; index += 1) {
    seed[`emailOtpVerifications/expired-${index}`] = { createdAt: hoursAgo(30), expiresAt: hoursAgo(29) };
  }
  const f = fixture(seed);
  const result = await runCleanup(f.db, DEFAULT_RETENTION_POLICY, 'admin-1', NOW);
  assert.equal(result.summary.totalTemporaryRecordsRemoved, 425);
  assert.ok(f.commitCount >= 3);
  assert.ok([...f.records.values()].some((entry) => entry.action === 'SYSTEM_MAINTENANCE_CLEANUP'));
});

test('a failed cleanup batch returns a sanitized error and records a safe failure audit', async () => {
  const f = fixture({
    'emailOtpVerifications/expired': { createdAt: hoursAgo(30), expiresAt: hoursAgo(29), otpHash: 'do-not-log' },
  }, { failCommitAt: 1 });
  await assert.rejects(() => runCleanup(f.db, DEFAULT_RETENTION_POLICY, 'admin-1', NOW), (error) => {
    assert.equal(error.reason, 'CLEANUP_WRITE_FAILED');
    assert.equal(error.message.includes('simulated'), false);
    return true;
  });
  const audit = [...f.records.values()].find((entry) => entry.action === 'SYSTEM_MAINTENANCE_CLEANUP');
  assert.equal(audit.result, 'failed');
  assert.deepEqual(audit.safeFailures, [{ category: 'cleanup-batch', count: 1, reason: 'write-failed' }]);
  assert.equal(JSON.stringify(audit).includes('do-not-log'), false);
});

test('unsupported browser-selected cleanup categories are rejected safely', async () => {
  const f = fixture();
  const result = await f.invoke('POST', 'admin-token', { action: 'run', categories: ['users'] });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.reason, 'UNSUPPORTED_CLEANUP_CATEGORY');
  assert.equal(f.records.has('users/user-1'), true);
});

test('GET overview returns lastCleanupAt: null and all 7 policy fields when never run', async () => {
  const f = fixture();
  const result = await f.invoke('GET', 'admin-token');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.lastCleanupAt, null);
  assert.equal(result.body.cleanupMode, 'Manual');
  assert.equal(typeof result.body.policy.chatMessageRetentionDays, 'number');
  assert.equal(typeof result.body.policy.chatReportEvidenceRetentionDays, 'number');
  assert.equal(typeof result.body.policy.completedOrderArchiveDays, 'number');
  assert.equal(typeof result.body.policy.incompleteRegistrationRetentionHours, 'number');
  assert.equal(typeof result.body.policy.notificationRetentionDays, 'number');
  assert.equal(typeof result.body.policy.rateLimitRetentionDays, 'number');
  assert.equal(typeof result.body.policy.verificationRetentionHours, 'number');
});

test('previewCleanup and runCleanup degrade safely without throwing 500 when queries fail or indexes are missing', async () => {
  const f = fixture();
  f.db.collectionGroup = () => ({
    where: () => ({
      orderBy: () => ({
        limit: () => ({
          get: async () => { throw new Error('9 FAILED_PRECONDITION: The query requires an index.'); },
        }),
      }),
    }),
  });
  const preview = await previewCleanup(f.db, DEFAULT_RETENTION_POLICY, NOW);
  assert.ok(preview);
  assert.equal(typeof preview.counts.temporaryRecordsEligible, 'number');

  const run = await runCleanup(f.db, DEFAULT_RETENTION_POLICY, 'admin-1', NOW);
  assert.ok(run);
  assert.equal(typeof run.summary.totalTemporaryRecordsRemoved, 'number');
});
