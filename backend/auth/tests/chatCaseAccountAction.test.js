const assert = require('node:assert/strict');
const test = require('node:test');
const { applyModerationAction, createAdminModerationHandler } = require('../../moderation/moderationHandler');

const copy = (value) => value === undefined ? undefined : structuredClone(value);
const START = new Date('2026-10-25T00:00:00Z');
const body = (action = 'suspend_account', mutation = 'chat-mutation-1234') => ({
  reportId: 'report-a', action, reason: 'Reviewed specific chat safety evidence.',
  privateNote: 'Private reviewer context.', clientMutationId: mutation,
});

function fixture() {
  const records = new Map(Object.entries({
    'users/admin-a': { role: 'admin', accountStatus: 'active', publicUid: 'Adm001' },
    'users/requester-a': { role: 'requester', accountStatus: 'active', publicUid: 'Req001',
      email: 'requester-a@example.test' },
    'chatReports/report-a': { schemaVersion: 1, status: 'open', reporterUid: 'distributor-a',
      reporterRole: 'distributor', reportedUid: 'requester-a', reportedRole: 'requester',
      reportedPublicUidSnapshot: 'Req001', conversationId: 'conversation-a',
      jurisdictionBranchId: 'branch-a', category: 'SPAM' },
    'chatConversations/conversation-a': { type: 'requester_distributor', branchIds: ['branch-a'],
      requesterUid: 'requester-a', distributorUid: 'distributor-a',
      participantUserUids: ['requester-a', 'distributor-a'], participantBranchIds: [],
      participantState: [
        { principalType: 'user', principalId: 'requester-a' },
        { principalType: 'user', principalId: 'distributor-a' },
      ] },
  }).map(([path, value]) => [path, copy(value)]));
  const users = new Map([
    ['admin-a', { uid: 'admin-a', disabled: false, customClaims: { admin: true } }],
    ['requester-a', { uid: 'requester-a', disabled: false, email: 'requester-a@example.test',
      emailVerified: true, tokensValidAfterTime: null }],
  ]);
  const authCalls = [];
  let failUpdate = false;
  const snap = (path, map = records) => ({ id: path.split('/').pop(), exists: map.has(path),
    data: () => copy(map.get(path)) });
  const doc = (path) => ({ path, id: path.split('/').pop(), get: async () => snap(path),
    collection: (name) => ({ doc: (id) => doc(`${path}/${name}/${id}`) }) });
  const db = {
    collection: (name) => ({ doc: (id) => doc(`${name}/${id}`) }),
    async runTransaction(work) {
      const pending = new Map([...records].map(([path, value]) => [path, copy(value)]));
      let wrote = false;
      const tx = {
        async get(ref) { if (wrote) throw Error('Transaction read after write'); return snap(ref.path, pending); },
        create(ref, value) { wrote = true; if (pending.has(ref.path)) throw Error(`Duplicate ${ref.path}`);
          pending.set(ref.path, copy(value)); },
        update(ref, value) { wrote = true; if (!pending.has(ref.path)) throw Error(`Missing ${ref.path}`);
          pending.set(ref.path, { ...pending.get(ref.path), ...copy(value) }); },
        set(ref, value) { wrote = true; pending.set(ref.path, copy(value)); },
      };
      const result = await work(tx);
      records.clear(); for (const entry of pending) records.set(...entry);
      return result;
    },
  };
  const auth = {
    async verifyIdToken(token, revoked) { assert.equal(revoked, true);
      if (token === 'admin-token') return { uid: 'admin-a', admin: true };
      if (token === 'forged-token') return { uid: 'requester-a', admin: true };
      throw Error('Unauthenticated'); },
    async getUser(uid) { authCalls.push(['get', uid]); return copy(users.get(uid)); },
    async updateUser(uid, changes) { authCalls.push(['update', uid, changes]);
      if (failUpdate) throw Error('Auth timeout');
      users.set(uid, { ...users.get(uid), ...changes }); return copy(users.get(uid)); },
    async revokeRefreshTokens(uid) { authCalls.push(['revoke', uid]);
      users.set(uid, { ...users.get(uid), tokensValidAfterTime: START.toISOString() }); },
  };
  const apply = (request = body(), token = 'admin-token') => applyModerationAction({
    auth, db, actor: { uid: 'admin-a', role: 'admin', publicUid: 'Adm001' },
    actorRole: 'admin', body: request, idToken: token, now: START,
    sendEmail: async () => ({ provider: 'test', providerStatus: 200 }),
  });
  return { records, users, authCalls, auth, db, apply, failUpdate: () => { failUpdate = true; },
    recoverUpdate: () => { failUpdate = false; } };
}

async function call(handler, body) {
  const response = { statusCode: 200, body: null, setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; } };
  await handler({ method: 'POST', headers: { authorization: 'Bearer admin-token' },
    body, url: '/api/admin/moderation' }, response);
  return response;
}

test('chat-case account suspension is authorized before Auth and finalizes once', async () => {
  const f = fixture();
  const first = await f.apply();
  assert.equal(first.accountAction.state, 'applied');
  assert.equal(first.action.action, 'suspend_account');
  const id = first.accountAction.id;
  assert.equal(f.records.get('users/requester-a').accountStatus, 'suspended');
  assert.equal(f.users.get('requester-a').disabled, true);
  assert.equal(f.records.get('accountActionReservations/requester-a').intentId, id);
  assert.equal(f.records.get('chatReports/report-a').status, 'resolved');
  assert.equal(f.records.get(`moderationActions/account_${id}`).privateNote, 'Private reviewer context.');
  assert.equal(f.records.get(`adminAuditLogs/account_action_${id}`).action, 'ACCOUNT_SUSPENDED');
  assert.equal('privateNote' in f.records.get(`moderationNotices/requester-a/items/account_${id}`), false);
  const before = copy([...f.records]);
  const replay = await f.apply();
  assert.equal(replay.created, false);
  assert.deepEqual([...f.records], before);
  assert.equal(f.authCalls.filter(([kind]) => kind === 'update').length, 1);
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('adminAuditLogs/')).length, 1);
  await assert.rejects(f.apply({ ...body(), reason: 'A changed factual moderation reason.' }),
    (error) => error.reason === 'ACCOUNT_ACTION_MUTATION_CONFLICT');
});

test('chat-case notice configuration fails before a durable hold and preserves authentication errors', async () => {
  const f = fixture();
  const apply = (idToken) => applyModerationAction({ auth: f.auth, db: f.db,
    actor: { uid: 'admin-a', role: 'admin', publicUid: 'Adm001' }, actorRole: 'admin',
    body: body(), idToken, now: START, noticeEnv: {} });
  await assert.rejects(apply('invalid-token'), (error) => error.reason === 'AUTHENTICATION_REQUIRED');
  await assert.rejects(apply('admin-token'),
    (error) => error.reason === 'ACCOUNT_NOTICE_TRANSPORT_UNAVAILABLE');
  assert.equal(f.records.has('accountActionReservations/requester-a'), false);
  assert.equal(f.records.has('accountAccessHolds/requester-a'), false);
  assert.equal(f.authCalls.some(([kind]) => kind === 'update' || kind === 'revoke'), false);
});

test('chat-case termination is disabled Auth state, not user deletion', async () => {
  const f = fixture();
  const result = await f.apply(body('terminate_account', 'terminate-mutation-1234'));
  assert.equal(result.accountAction.state, 'applied');
  assert.equal(f.records.get('users/requester-a').accountStatus, 'terminated');
  assert.equal(f.records.get(`adminAuditLogs/account_action_${result.accountAction.id}`).action, 'ACCOUNT_TERMINATED');
  assert.equal(f.users.get('requester-a').disabled, true);
  assert.equal(f.records.has('users/requester-a'), true);
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('moderationNotices/')).length, 0);
});

test('forged actor, changed case relationship and reserved target create no Auth mutation', async () => {
  const forged = fixture();
  await assert.rejects(forged.apply(body(), 'forged-token'), (error) => error.reason === 'ADMIN_REQUIRED');
  assert.equal(forged.authCalls.some(([kind]) => kind === 'update'), false);
  assert.equal(forged.records.has('accountActionReservations/requester-a'), false);
  const changed = fixture();
  changed.records.get('chatConversations/conversation-a').branchIds = ['branch-b'];
  await assert.rejects(changed.apply(), (error) => error.reason === 'MODERATION_RELATIONSHIP_INVALID');
  assert.equal(changed.records.has('accountActionReservations/requester-a'), false);
  const reserved = fixture();
  reserved.records.set('accountActionReservations/requester-a', { intentId: 'other' });
  await assert.rejects(reserved.apply(), (error) => error.reason === 'ACCOUNT_ACTION_RESERVATION_INVALID');
  assert.equal(reserved.authCalls.some(([kind]) => kind === 'update'), false);
});

test('canonical Manager-reported branch case is supported, while resolved or forged cases fail closed', async () => {
  const branch = fixture();
  branch.records.set('chatConversations/conversation-a', {
    type: 'requester_branch', requesterUid: 'requester-a', branchIds: ['branch-a'],
    participantUserUids: ['requester-a'], participantBranchIds: ['branch-a'],
    participantState: [
      { principalType: 'user', principalId: 'requester-a' },
      { principalType: 'branch', principalId: 'branch-a' },
    ],
  });
  branch.records.get('chatReports/report-a').reporterRole = 'manager';
  branch.records.get('chatReports/report-a').reporterUid = 'manager-a';
  assert.equal((await branch.apply()).accountAction.state, 'applied');

  const resolved = fixture();
  resolved.records.get('chatReports/report-a').status = 'resolved';
  await assert.rejects(resolved.apply(), (error) => error.reason === 'MODERATION_RELATIONSHIP_INVALID');
  assert.equal(resolved.authCalls.some(([kind]) => kind === 'update'), false);

  const forged = fixture();
  forged.records.get('chatReports/report-a').reportedUid = 'other-requester';
  await assert.rejects(forged.apply(), (error) => error.reason === 'MODERATION_TARGET_CHANGED');
  assert.equal(forged.records.has('accountActionReservations/requester-a'), false);

  const roleForgery = fixture();
  roleForgery.records.get('chatReports/report-a').reporterRole = 'requester';
  await assert.rejects(roleForgery.apply(), (error) => error.reason === 'MODERATION_RELATIONSHIP_INVALID');
  assert.equal(roleForgery.records.has('accountActionReservations/requester-a'), false);
});

test('unknown Auth outcome stays held and exact request remains pending', async () => {
  const f = fixture(); f.failUpdate();
  const result = await f.apply();
  assert.equal(result.accountAction.pending, true);
  const id = result.accountAction.id;
  assert.equal(f.records.get('users/requester-a').accountActionHoldIntentId, id);
  assert.equal(f.records.get('chatReports/report-a').pendingAccountActionIntentId, id);
  assert.equal(f.records.get('chatReports/report-a').status, 'open');
  assert.equal(f.records.has(`moderationActions/account_${id}`), false);
  assert.equal(f.records.has(`adminAuditLogs/account_action_${id}`), false);
  f.recoverUpdate();
  assert.equal((await f.apply()).accountAction.pending, true);
  assert.equal(f.authCalls.filter(([kind]) => kind === 'update').length, 1);
});

test('Admin retry keeps an unresolved external Auth call pending without another notice or audit', async () => {
  const f = fixture(); f.failUpdate();
  const handler = createAdminModerationHandler(() => ({ auth: f.auth, db: f.db }),
    { sendEmail: async () => ({ provider: 'test', providerStatus: 200 }) });
  const initial = await call(handler, body());
  assert.equal(initial.statusCode, 202);
  const id = initial.body.accountAction.id;
  assert.equal(f.records.get('chatReports/report-a').pendingAccountActionIntentId, id);
  f.recoverUpdate();
  f.records.get(`accountActionIntents/${id}`).lease.expiresAt = new Date(0);
  const recovered = await call(handler, { action: 'retryChatAccountAction', reportId: 'report-a' });
  assert.equal(recovered.statusCode, 202);
  assert.equal(recovered.body.accountAction.state, 'reconcile_required');
  assert.equal(f.records.get('chatReports/report-a').status, 'open');
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('moderationNotices/')).length, 0);
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('adminAuditLogs/')).length, 0);
  assert.equal(f.authCalls.filter(([kind]) => kind === 'update').length, 1);
});
