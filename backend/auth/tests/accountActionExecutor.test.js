const assert = require('node:assert/strict');
const test = require('node:test');
const { authorizeAccountActionIntent, actionIdentity, claimIntentLease } = require('../accountActionIntentService');
const { resumePendingIntent } = require('../accountActionExecutor');

const NOW = new Date('2026-10-25T00:00:00Z');
const request = { source: 'admin_account', action: 'suspend', targetUid: 'target-a',
  clientMutationId: 'mutation-1234', reason: 'Reviewed account safety incident.' };
const copy = (value) => structuredClone(value);

function fixture({ sendEmail = async () => ({ provider: 'test', providerStatus: 200 }) } = {}) {
  const records = new Map([
    ['users/admin-a', { role: 'admin', accountStatus: 'active' }],
    ['users/target-a', { role: 'requester', accountStatus: 'active', email: 'target@example.test' }],
  ]);
  const users = new Map([
    ['admin-a', { uid: 'admin-a', disabled: false, customClaims: { admin: true } }],
    ['target-a', { uid: 'target-a', disabled: false, email: 'target@example.test',
      emailVerified: true, tokensValidAfterTime: null }],
  ]);
  const calls = [];
  const sent = [];
  let failUpdate = false;
  let failRevoke = false;
  let failFinalization = false;
  let ambiguousFinalization = false;
  const snap = (path) => ({ exists: records.has(path), data: () => copy(records.get(path)) });
  const db = {
    collection(name) { return { doc(id) { return { path: `${name}/${id}`,
      get: async () => snap(`${name}/${id}`) }; } }; },
    async runTransaction(work) {
      const pending = new Map([...records].map(([key, value]) => [key, copy(value)]));
      let written = false;
      const tx = {
        async get(ref) {
          if (written) throw Error('Transaction read after write');
          return { exists: pending.has(ref.path), data: () => copy(pending.get(ref.path)) };
        },
        create(ref, value) {
          written = true;
          if (pending.has(ref.path)) throw Error('Duplicate document');
          pending.set(ref.path, copy(value));
        },
        update(ref, value) {
          written = true;
          if (!pending.has(ref.path)) throw Error('Missing document');
          pending.set(ref.path, { ...pending.get(ref.path), ...copy(value) });
        },
        delete(ref) { written = true; pending.delete(ref.path); },
      };
      const result = await work(tx);
      const applied = pending.get(`accountActionIntents/${actionIdentity('admin-a', request)}`)?.state === 'applied';
      const wasApplied = records.get(`accountActionIntents/${actionIdentity('admin-a', request)}`)?.state === 'applied';
      if (failFinalization && applied) {
        throw Error('finalization commit unknown');
      }
      records.clear(); for (const [key, value] of pending) records.set(key, value);
      if (ambiguousFinalization && applied && !wasApplied) {
        throw Error('finalization acknowledgement lost');
      }
      return result;
    },
  };
  const auth = {
    async verifyIdToken(token, checkRevoked) {
      assert.equal(checkRevoked, true);
      if (token !== 'admin-token') throw Error('unauthorized');
      return { uid: 'admin-a', admin: true };
    },
    async getUser(uid) { calls.push(['get', uid]); return copy(users.get(uid)); },
    async updateUser(uid, changes) {
      calls.push(['update', uid, changes]);
      if (failUpdate) throw Error('network timeout');
      users.set(uid, { ...users.get(uid), ...changes });
      return copy(users.get(uid));
    },
    async revokeRefreshTokens(uid) {
      calls.push(['revoke', uid]);
      if (failRevoke) throw Error('revocation timeout');
      users.set(uid, { ...users.get(uid), tokensValidAfterTime: NOW.toISOString() });
    },
  };
  const authorize = (input = request) => authorizeAccountActionIntent({ db, auth, idToken: 'admin-token', request: input, now: NOW });
  const execute = (intentId, timestamp = NOW) => resumePendingIntent({ db, auth, intentId,
    now: () => timestamp, leaseMs: 1000,
    sendEmail: async (message) => { sent.push(message); return sendEmail(message); } });
  return { records, users, calls, sent, auth, db, authorize, execute,
    failUpdate: () => { failUpdate = true; }, recoverUpdate: () => { failUpdate = false; },
    failRevoke: () => { failRevoke = true; }, recoverRevoke: () => { failRevoke = false; },
    failFinalization: () => { failFinalization = true; }, recoverFinalization: () => { failFinalization = false; },
    loseFinalizationAck: () => { ambiguousFinalization = true; } };
}

test('authorized disable holds access before Auth and finalizes once with observation and audit', async () => {
  const f = fixture();
  const { intent: { id } } = await f.authorize();
  assert.equal(f.records.get('users/target-a').accountStatus, 'active');
  assert.equal(f.records.get('users/target-a').accountActionHoldIntentId, id);
  assert.equal(f.records.get('accountAccessHolds/target-a').intentId, id);
  assert.equal(f.calls.some(([kind]) => kind === 'update' || kind === 'revoke'), false);
  const result = await f.execute(id);
  assert.equal(result.state, 'applied');
  assert.equal(f.records.get('users/target-a').accountStatus, 'suspended');
  assert.equal(f.records.get('users/target-a').accountActionHoldIntentId, '');
  assert.equal(f.records.get(`accountActionIntents/${id}`).observation.revocationAcknowledged, true);
  assert.equal(f.records.get(`accountActionIntents/${id}`).noticeDelivery.state, 'accepted');
  assert.equal(f.records.get(`accountActionIntents/${id}`).noticeDelivery.deliveryConfirmed, false);
  assert.equal(f.sent.length, 1);
  assert.equal(f.records.get(`adminAuditLogs/account_action_${id}`).intentId, id);
  assert.equal(f.records.get('accountActionReservations/target-a').intentId, id);
  await assert.rejects(f.execute(id), (error) => error.reason === 'ACCOUNT_ACTION_FINALIZED');
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('adminAuditLogs/')).length, 1);
  assert.equal(f.sent.length, 1);
});

test('notice provider uncertainty blocks Auth and does not resend on retry', async () => {
  const f = fixture({ sendEmail: async () => { throw Error('mail timeout'); } });
  const { intent: { id } } = await f.authorize();
  await assert.rejects(f.execute(id), (error) => error.reason === 'ACCOUNT_NOTICE_DELIVERY_UNCERTAIN');
  assert.equal(f.records.get(`accountActionIntents/${id}`).noticeDelivery.state, 'sending');
  assert.equal(f.records.get('users/target-a').accountActionHoldIntentId, id);
  await assert.rejects(f.execute(id, new Date(NOW.getTime() + 1001)),
    (error) => error.reason === 'ACCOUNT_NOTICE_DELIVERY_UNCERTAIN');
  assert.equal(f.sent.length, 1);
  assert.equal(f.calls.some(([kind]) => kind === 'update' || kind === 'revoke'), false);
});

test('a missing provider acceptance response never authorizes Auth disablement', async () => {
  const f = fixture({ sendEmail: async () => undefined });
  const { intent: { id } } = await f.authorize();
  await assert.rejects(f.execute(id), (error) => error.reason === 'ACCOUNT_NOTICE_DELIVERY_UNCERTAIN');
  assert.equal(f.records.get(`accountActionIntents/${id}`).noticeDelivery.state, 'sending');
  assert.equal(f.calls.some(([kind]) => kind === 'update' || kind === 'revoke'), false);
});

test('unverified recipient rejects authorization before reservation or Auth mutation', async () => {
  const f = fixture();
  f.users.get('target-a').emailVerified = false;
  await assert.rejects(f.authorize(), (error) => error.reason === 'ACCOUNT_NOTICE_RECIPIENT_UNVERIFIED');
  assert.equal(f.records.has('accountActionReservations/target-a'), false);
  assert.equal(f.calls.some(([kind]) => kind === 'update' || kind === 'revoke'), false);
  const mismatched = fixture();
  mismatched.users.get('target-a').email = 'different@example.test';
  await assert.rejects(mismatched.authorize(), (error) => error.reason === 'ACCOUNT_NOTICE_RECIPIENT_UNVERIFIED');
  assert.equal(mismatched.records.has('accountActionReservations/target-a'), false);
  assert.equal(mismatched.calls.some(([kind]) => kind === 'update' || kind === 'revoke'), false);
});

test('ambiguous Auth timeout retains its external flight and requires manual recovery', async () => {
  const f = fixture();
  const { intent: { id } } = await f.authorize();
  f.failUpdate();
  await assert.rejects(f.execute(id), /network timeout/);
  assert.equal(f.records.get(`accountActionIntents/${id}`).state, 'reconcile_required');
  assert.equal(f.records.get('users/target-a').accountStatus, 'active');
  assert.equal(f.records.get('users/target-a').accountActionHoldIntentId, id);
  f.recoverUpdate();
  f.users.set('target-a', { ...f.users.get('target-a'), disabled: true });
  await assert.rejects(f.execute(id, new Date(NOW.getTime() + 1001)),
    (error) => error.reason === 'ACCOUNT_ACTION_EXTERNAL_UNRESOLVED');
  assert.equal(f.calls.filter(([kind]) => kind === 'update').length, 1);
  assert.equal(f.records.get('users/target-a').accountStatus, 'active');
  assert.equal(f.records.get('users/target-a').accountActionHoldIntentId, id);
});

test('unknown token revocation remains held without a repeated external call', async () => {
  const f = fixture();
  const { intent: { id } } = await f.authorize();
  f.failRevoke();
  await assert.rejects(f.execute(id), /revocation timeout/);
  assert.equal(f.records.get(`accountActionIntents/${id}`).state, 'reconcile_required');
  assert.equal(f.records.get('users/target-a').accountActionHoldIntentId, id);
  f.recoverRevoke();
  await assert.rejects(f.execute(id, new Date(NOW.getTime() + 1001)),
    (error) => error.reason === 'ACCOUNT_ACTION_EXTERNAL_UNRESOLVED');
  assert.equal(f.calls.filter(([kind]) => kind === 'revoke').length, 1);
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('adminAuditLogs/')).length, 0);
});

test('Firestore finalization failure retries without duplicate audit or Auth disable', async () => {
  const f = fixture();
  const { intent: { id } } = await f.authorize();
  f.failFinalization();
  await assert.rejects(f.execute(id), /finalization commit unknown/);
  assert.equal(f.records.get(`accountActionIntents/${id}`).state, 'reconcile_required');
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('adminAuditLogs/')).length, 0);
  f.recoverFinalization();
  await f.execute(id, new Date(NOW.getTime() + 1001));
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('adminAuditLogs/')).length, 1);
  assert.equal(f.calls.filter(([kind]) => kind === 'update').length, 1);
});

test('lost Firestore acknowledgement after commit is recognized as applied without a second audit', async () => {
  const f = fixture();
  const { intent: { id } } = await f.authorize();
  f.loseFinalizationAck();
  await assert.rejects(f.execute(id), /finalization acknowledgement lost/);
  assert.equal(f.records.get(`accountActionIntents/${id}`).state, 'applied');
  assert.equal((await f.authorize()).intent.state, 'applied');
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('adminAuditLogs/')).length, 1);
});

test('forged, rejected and unsupported intents never mutate Firebase Auth', async () => {
  const f = fixture();
  await assert.rejects(f.execute('0'.repeat(64)), (error) => error.reason === 'ACCOUNT_ACTION_INTENT_MISSING');
  assert.equal(f.calls.some(([kind]) => kind === 'update' || kind === 'revoke'), false);
  const { intent: { id } } = await f.authorize();
  f.records.get(`accountActionIntents/${id}`).source = 'forged_source';
  await assert.rejects(f.execute(id), (error) => error.reason === 'ACCOUNT_ACTION_INTENT_INVALID');
  assert.equal(f.calls.some(([kind]) => kind === 'update' || kind === 'revoke'), false);
});

test('late disable cannot be followed by unsafe reactivation, even after its lease expires', async () => {
  const f = fixture();
  const { intent: { id } } = await f.authorize();
  let entered;
  let release;
  const enteredCall = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const update = f.auth.updateUser;
  f.auth.updateUser = async (...args) => { entered(); await gate; return update(...args); };
  const running = f.execute(id);
  await enteredCall;
  await assert.rejects(f.authorize({ source: 'admin_account', action: 'reactivate',
    targetUid: 'target-a', clientMutationId: 'reactivation-1234' }),
  (error) => error.reason === 'ACCOUNT_NOT_REACTIVATABLE');
  assert.equal(f.records.get('accountAccessHolds/target-a').intentId, id);
  assert.equal(f.records.get('accountActionReservations/target-a').intentId, id);
  await claimIntentLease({ db: f.db, intentId: id, ownerId: 'second-executor',
    now: new Date(NOW.getTime() + 1001), leaseMs: 1000 });
  release();
  await assert.rejects(running, (error) => error.reason === 'ACCOUNT_ACTION_AUTHORITY_CHANGED');
  await assert.rejects(f.authorize({ source: 'admin_account', action: 'reactivate',
    targetUid: 'target-a', clientMutationId: 'reactivation-1234' }),
  (error) => error.reason === 'ACCOUNT_NOT_REACTIVATABLE');
  assert.equal(f.users.get('target-a').disabled, true);
  assert.equal(f.records.get('users/target-a').accountStatus, 'active');
  assert.equal(f.records.get('users/target-a').accountActionHoldIntentId, id);
});

test('settled suspension reactivates through a new intent and restores access after Auth observation', async () => {
  const f = fixture();
  const suspended = await f.authorize();
  await f.execute(suspended.intent.id);
  const request = { source: 'admin_account', action: 'reactivate', targetUid: 'target-a',
    clientMutationId: 'reactivate-1234' };
  const authorized = await f.authorize(request);
  assert.equal(authorized.created, true);
  assert.equal(f.records.get('users/target-a').accountStatus, 'suspended');
  assert.equal(f.records.get('users/target-a').accountActionHoldIntentId, authorized.intent.id);
  assert.equal(f.records.get('accountActionReservations/target-a').intentId, authorized.intent.id);
  assert.equal(f.records.get('accountAccessHolds/target-a').state, 'pending_enable');
  const result = await f.execute(authorized.intent.id);
  assert.equal(result.state, 'applied');
  assert.equal(f.users.get('target-a').disabled, false);
  assert.equal(f.records.get('users/target-a').accountStatus, 'active');
  assert.equal(f.records.get('users/target-a').accountActionHoldIntentId, '');
  assert.equal(f.records.has('accountAccessHolds/target-a'), false);
  assert.equal(f.records.get(`adminAuditLogs/account_action_${authorized.intent.id}`).action, 'ACCOUNT_REACTIVATED');
  assert.equal((await f.authorize(request)).created, false);
  assert.equal(f.calls.filter(([kind, uid, changes]) => kind === 'update'
    && uid === 'target-a' && changes.disabled === false).length, 1);
  const again = await f.authorize({ source: 'admin_account', action: 'suspend',
    targetUid: 'target-a', clientMutationId: 'second-disable',
    reason: 'Another reviewed safety incident occurred.' });
  assert.equal(again.created, true);
  assert.equal(f.records.get('accountActionReservations/target-a').intentId, again.intent.id);
});
