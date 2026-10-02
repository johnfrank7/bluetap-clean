const assert = require('node:assert/strict');
const test = require('node:test');

const { applyModerationAction, expandChatReview, safeAction, safeReport } = require('../moderationHandler');
const { safeNotice } = require('../moderationService');

const clone = (value) => value === undefined ? undefined : structuredClone(value);

test('moderation DTOs serialize Firestore and legacy timestamps as ISO strings', () => {
  const timestamp = { seconds: 1767225600, nanoseconds: 125000000 };
  const report = safeReport({ id: 'r', messageId: 'm1', createdAt: timestamp, evidenceSnapshot: [{ messageId: 'm1', createdAt: timestamp }] }, { evidence: true });
  const action = safeAction({ id: 'a', createdAt: timestamp, startsAt: timestamp, endsAt: timestamp });
  const notice = safeNotice('n', { createdAt: timestamp, startsAt: timestamp, endsAt: timestamp });
  assert.equal(report.createdAt, '2026-01-01T00:00:00.125Z');
  assert.equal(report.evidence[0].createdAt, '2026-01-01T00:00:00.125Z');
  assert.equal(report.evidence[0].reported, true);
  assert.equal(action.endsAt, '2026-01-01T00:00:00.125Z');
  assert.equal(notice.createdAt, '2026-01-01T00:00:00.125Z');
});

function fixture({ reportBranch = 'branch-a', accountStatus = 'active' } = {}) {
  const records = new Map(Object.entries({
    'chatReports/report-a': {
      status: 'open', category: 'SPAM', jurisdictionBranchId: reportBranch,
      reportedUid: 'requester-a', reportedPublicUidSnapshot: 'Req001', reportedRole: 'requester',
      conversationId: 'conversation-a', reporterUid: 'distributor-a',
    },
    'users/requester-a': { role: 'requester', accountStatus, publicUid: 'Req001', status: accountStatus === 'active' ? 'Active' : 'Suspended' },
    'chatConversations/conversation-a': { participantUserUids: ['requester-a', 'distributor-a'], participantBranchIds: [reportBranch] },
  }).map(([key, value]) => [key, clone(value)]));
  let id = 0;
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => clone(records.get(path)) });
  const collection = (path) => ({
    doc(value = `auto-${++id}`) {
      const docPath = `${path}/${value}`;
      return {
        path: docPath, id: value,
        get: async () => snapshot(docPath),
        update: async (data) => records.set(docPath, { ...(records.get(docPath) || {}), ...clone(data) }),
        collection: (name) => collection(`${docPath}/${name}`),
      };
    },
  });
  const db = {
    collection,
    async runTransaction(run) {
      const working = new Map([...records.entries()].map(([key, value]) => [key, clone(value)]));
      const workingSnapshot = (path) => ({ id: path.split('/').pop(), exists: working.has(path), data: () => clone(working.get(path)) });
      const tx = {
        get: async (ref) => workingSnapshot(ref.path),
        create(ref, data) {
          if (working.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
          working.set(ref.path, clone(data));
        },
        set(ref, data, options) { working.set(ref.path, options?.merge ? { ...(working.get(ref.path) || {}), ...clone(data) } : clone(data)); },
        update(ref, data) {
          if (!working.has(ref.path)) throw new Error(`missing: ${ref.path}`);
          working.set(ref.path, { ...working.get(ref.path), ...clone(data) });
        },
      };
      const result = await run(tx);
      records.clear();
      for (const [key, value] of working) records.set(key, value);
      return result;
    },
  };
  const authCalls = [];
  const auth = {
    updateUser: async (uid, changes) => authCalls.push(['updateUser', uid, changes]),
    revokeRefreshTokens: async (uid) => authCalls.push(['revokeRefreshTokens', uid]),
  };
  const manager = { decoded: { uid: 'manager-a' }, profile: { uid: 'manager-a', role: 'manager', publicUid: 'Man001', branchId: 'branch-a' }, branch: { id: 'branch-a', name: 'BlueTap A' } };
  const admin = { uid: 'admin-a', role: 'admin', publicUid: 'Adm001', profile: { uid: 'admin-a', role: 'admin', publicUid: 'Adm001' } };
  return { auth, authCalls, db, records, manager, admin };
}

const apply = (f, actorRole, body, actionId = 'action-a') => applyModerationAction({
  auth: f.auth,
  db: f.db,
  actor: actorRole === 'manager' ? f.manager : f.admin,
  actorRole,
  actorBranch: actorRole === 'manager' ? f.manager.branch : null,
  body,
  now: new Date('2026-10-01T00:00:00Z'),
  createActionId: () => actionId,
});

test('Manager moderation is branch-scoped and cannot invoke platform or account actions', async () => {
  const crossBranch = fixture({ reportBranch: 'branch-b' });
  await assert.rejects(apply(crossBranch, 'manager', {
    reportId: 'report-a', action: 'warn', reason: 'Branch warning', clientMutationId: 'cross-branch',
  }), (error) => error.reason === 'BRANCH_ACCESS_DENIED');
  assert.equal([...crossBranch.records.keys()].some((key) => key.startsWith('moderationActions/')), false);

  const global = fixture();
  await assert.rejects(apply(global, 'manager', {
    reportId: 'report-a', action: 'suspend_platform_chat', durationDays: 1, reason: 'No', clientMutationId: 'global',
  }), (error) => error.reason === 'MODERATION_ACTION_DENIED');
  await assert.rejects(apply(global, 'manager', {
    reportId: 'report-a', action: 'terminate_account', reason: 'No', clientMutationId: 'terminate',
  }), (error) => error.reason === 'MODERATION_ACTION_DENIED');
});

test('Manager warning is append-only, user-visible, private-note safe, and idempotent', async () => {
  const f = fixture();
  const body = {
    reportId: 'report-a', action: 'warn', reason: 'Repeated unsuccessful deliveries',
    privateNote: 'Reporter-specific context stays private', clientMutationId: 'warn-1',
  };
  const first = await apply(f, 'manager', body);
  const retry = await apply(f, 'manager', body);
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('moderationActions/')).length, 1);
  const notice = f.records.get('moderationNotices/requester-a/items/action-a');
  assert.equal(notice.title, 'BlueTap Warning');
  assert.equal('privateNote' in notice, false);
  assert.equal('reporterUid' in notice, false);
  assert.equal(f.records.get('chatReports/report-a').status, 'open');

  await apply(f, 'manager', {
    reportId: 'report-a', action: 'escalate', reason: 'Admin review is required', clientMutationId: 'warn-then-escalate',
  }, 'action-b');
  assert.equal(f.records.get('chatReports/report-a').status, 'escalated');
  assert.equal(f.records.get('chatReports/report-a').actionTaken, 'escalate');
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('moderationActions/')).length, 2);
});

test('Manager branch chat and ordering restrictions support only 1, 3, and 7 days', async () => {
  for (const days of [1, 3, 7]) {
    const chat = fixture();
    await apply(chat, 'manager', {
      reportId: 'report-a', action: 'suspend_branch_chat', durationDays: days,
      reason: 'Temporary branch messaging restriction', clientMutationId: `chat-${days}`,
    }, `chat-action-${days}`);
    const chatEntry = chat.records.get('chatRestrictions/requester-a').branches['branch-a'];
    assert.equal((new Date(chatEntry.endsAt).getTime() - new Date(chatEntry.startsAt).getTime()) / 86400000, days);

    const ordering = fixture();
    await apply(ordering, 'manager', {
      reportId: 'report-a', action: 'suspend_branch_ordering', durationDays: days,
      reason: 'Temporary branch ordering restriction', clientMutationId: `ordering-${days}`,
    }, `order-action-${days}`);
    assert.equal(ordering.records.get('orderingRestrictions/requester-a').branches['branch-a'].scope, 'branch_ordering');
  }
  const invalid = fixture();
  await assert.rejects(apply(invalid, 'manager', {
    reportId: 'report-a', action: 'suspend_branch_chat', durationDays: 30,
    reason: 'Too long', clientMutationId: 'invalid-duration',
  }), (error) => error.reason === 'MODERATION_DURATION_INVALID');
});

test('Manager escalation preserves the case for Admin without creating a user restriction', async () => {
  const f = fixture();
  await apply(f, 'manager', {
    reportId: 'report-a', action: 'escalate', reason: 'Platform review required', clientMutationId: 'escalate-1',
  });
  assert.equal(f.records.get('chatReports/report-a').status, 'escalated');
  assert.equal(f.records.has('chatRestrictions/requester-a'), false);
  assert.equal(f.records.has('orderingRestrictions/requester-a'), false);
});

test('Admin platform restrictions and canonical account termination are explicit, audited, and retry-safe', async () => {
  const platform = fixture();
  await apply(platform, 'admin', {
    reportId: 'report-a', action: 'suspend_platform_ordering', durationDays: 30,
    reason: 'Reviewed platform abuse', clientMutationId: 'platform-ordering',
  });
  assert.equal(platform.records.get('orderingRestrictions/requester-a').platform.scope, 'platform_ordering');

  const terminated = fixture();
  const body = { reportId: 'report-a', action: 'terminate_account', reason: 'Severe reviewed abuse', clientMutationId: 'terminate-1' };
  await apply(terminated, 'admin', body);
  const retry = await apply(terminated, 'admin', body);
  assert.equal(retry.created, false);
  assert.equal(terminated.records.get('users/requester-a').accountStatus, 'terminated');
  assert.deepEqual(terminated.authCalls, [
    ['updateUser', 'requester-a', { disabled: true }],
    ['revokeRefreshTokens', 'requester-a'],
  ]);
  assert.equal([...terminated.records.keys()].filter((key) => key.startsWith('moderationActions/')).length, 1);
  assert.equal([...terminated.records.keys()].filter((key) => key.startsWith('adminAuditLogs/')).length, 1);
});

test('Admin account suspension uses canonical state, disables Auth, revokes sessions, and creates a safe notice', async () => {
  const f = fixture();
  await apply(f, 'admin', { reportId: 'report-a', action: 'suspend_account', reason: 'Reviewed safety concern', clientMutationId: 'suspend-1' });
  assert.equal(f.records.get('users/requester-a').accountStatus, 'suspended');
  assert.deepEqual(f.authCalls, [['updateUser', 'requester-a', { disabled: true }], ['revokeRefreshTokens', 'requester-a']]);
  const notice = f.records.get('moderationNotices/requester-a/items/action-a');
  assert.equal(notice.type, 'suspend_account');
  assert.equal('reporterUid' in notice, false);
});

test('Admin reactivation never reactivates a terminated account and preserves history', async () => {
  const suspended = fixture({ accountStatus: 'suspended' });
  await apply(suspended, 'admin', {
    reportId: 'report-a', action: 'reactivate', reason: 'Restriction review completed', clientMutationId: 'reactivate-1',
  });
  assert.equal(suspended.records.get('users/requester-a').accountStatus, 'active');
  assert.deepEqual(suspended.authCalls, [['updateUser', 'requester-a', { disabled: false }]]);

  const terminated = fixture({ accountStatus: 'terminated' });
  await assert.rejects(apply(terminated, 'admin', {
    reportId: 'report-a', action: 'reactivate', reason: 'Not permitted', clientMutationId: 'reactivate-terminated',
  }), (error) => error.reason === 'ACCOUNT_NOT_REACTIVATABLE');
});

test('expanded Admin chat review requires a reason, returns at most 20 messages, and writes an audit', async () => {
  const records = new Map([
    ['chatReports/report-a', { conversationId: 'conversation-a' }],
    ['chatConversations/conversation-a', { status: 'active' }],
    ['users/admin-a', { role: 'admin', publicUid: 'Adm001' }],
  ]);
  for (let seq = 1; seq <= 25; seq += 1) records.set(`chatConversations/conversation-a/messages/message-${seq}`, { seq, senderRole: 'requester', senderPublicUidSnapshot: 'Req001', body: `message ${seq}`, createdAt: new Date(seq * 1000) });
  let audit = null;
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => clone(records.get(path)) });
  const db = {
    collection: (name) => ({
      doc: (id = 'audit') => {
        const path = `${name}/${id}`;
        return {
          path,
          get: async () => snapshot(path),
          set: async (value) => { audit = clone(value); },
          collection: (child) => ({
            orderBy: () => ({
              limit: (maximum) => ({
                get: async () => ({
                  docs: [...records.keys()]
                    .filter((key) => key.startsWith(`${path}/${child}/`))
                    .map(snapshot)
                    .sort((a, b) => b.data().seq - a.data().seq)
                    .slice(0, maximum),
                }),
              }),
            }),
          }),
        };
      },
    }),
  };
  await assert.rejects(expandChatReview({ db, admin: { uid: 'admin-a' }, body: { reportId: 'report-a', reason: '' }, now: new Date() }), (error) => error.reason === 'DETAILS_REQUIRED');
  const result = await expandChatReview({ db, admin: { uid: 'admin-a' }, body: { reportId: 'report-a', reason: 'Investigate escalated safety report' }, now: new Date('2026-10-01T00:00:00Z') });
  assert.equal(result.context.length, 20);
  assert.deepEqual(result.context.map((message) => message.seq), Array.from({ length: 20 }, (_, index) => index + 6));
  assert.equal(audit.action, 'CHAT_REVIEW_EXPANDED');
  assert.equal(audit.reason, 'Investigate escalated safety report');
  assert.equal(audit.messageCount, 20);
});
