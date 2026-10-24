const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { actionIdentity, authorizeAccountActionIntent, canonicalRequest,
  claimIntentLease, renewIntentLease, STATES } = require('../accountActionIntentService');

const NOW = new Date('2026-10-25T00:00:00Z');
const request = (action = 'suspend', clientMutationId = 'mutation-1234', targetUid = 'requester-a') =>
  ({ source: 'admin_account', action, targetUid, clientMutationId });
const clone = (value) => structuredClone(value);

function fixture() {
  const records = new Map([
    ['users/admin-a', { role: 'admin', accountStatus: 'active' }],
    ['users/requester-a', { role: 'requester', accountStatus: 'active' }],
    ['users/requester-b', { role: 'requester', accountStatus: 'active' }],
    ['users/manager-a', { role: 'manager', accountStatus: 'inactive', managerStatus: 'active', branchId: 'branch-a' }],
    ['branches/branch-a', { status: 'active' }],
  ]);
  const calls = [];
  const auth = {
    async verifyIdToken(token, checkRevoked) {
      calls.push(['verify', token, checkRevoked]);
      if (token === 'admin') return { uid: 'admin-a', admin: true };
      if (token === 'forged') return { uid: 'requester-b', admin: true };
      if (token === 'no-claim') return { uid: 'admin-a' };
      throw Error('Invalid token');
    },
    async updateUser() { throw Error('Auth mutation must not run'); },
    async revokeRefreshTokens() { throw Error('Auth mutation must not run'); },
  };
  const db = { collection(name) { return { doc(id) { return { id, path: `${name}/${id}` }; } }; },
    async runTransaction(callback) {
      const work = new Map([...records].map(([key, value]) => [key, clone(value)]));
      let written = false;
      const tx = {
        async get(ref) {
          if (written) throw Error('Transaction read after write');
          return { exists: work.has(ref.path), data: () => clone(work.get(ref.path)) };
        },
        create(ref, value) { written = true; if (work.has(ref.path)) throw Error('Duplicate document'); work.set(ref.path, clone(value)); },
        update(ref, value) { written = true; if (!work.has(ref.path)) throw Error('Missing document'); work.set(ref.path, { ...work.get(ref.path), ...clone(value) }); },
      };
      const result = await callback(tx);
      records.clear();
      for (const entry of work) records.set(...entry);
      return result;
    } };
  const authorize = (input = request(), idToken = 'admin') => authorizeAccountActionIntent({ db, auth, idToken,
    request: input, now: NOW });
  return { records, calls, auth, db, authorize };
}

test('canonical requests are strict, deterministic and exclude client-derived authority', () => {
  const normalized = canonicalRequest(request());
  assert.deepEqual(normalized, request());
  assert.equal(actionIdentity('admin-a', normalized), actionIdentity('admin-a', request()));
  assert.equal(actionIdentity('admin-a', normalized).length, 64);
  for (const bad of [request('warn'), request('suspend', 'short'), request('suspend', 'mutation-1234', '../other'),
    { ...request(), actorUid: 'admin-a' }, { ...request(), authorized: true },
    { ...request(), source: 'chat_report', caseRef: 'case-a' }]) {
    assert.throws(() => canonicalRequest(bad), (error) => error.reason === 'ACCOUNT_ACTION_REQUEST_INVALID');
  }
});

test('transaction creates one durable authorized intent and stable account reservation without Auth mutation', async () => {
  const f = fixture();
  const result = await f.authorize();
  const id = actionIdentity('admin-a', request());
  assert.equal(result.created, true);
  assert.equal(result.intent.id, id);
  assert.equal(result.intent.state, STATES.AUTHORIZED);
  assert.equal(Object.isFrozen(result.intent), true);
  const intent = f.records.get(`accountActionIntents/${id}`);
  const reservation = f.records.get('accountActionReservations/requester-a');
  assert.equal(intent.targetUid, 'requester-a');
  assert.equal(intent.actorUid, 'admin-a');
  assert.equal(intent.desiredAuthDisabled, true);
  assert.equal(intent.caseRef, null);
  assert.deepEqual(intent.validatedGrounds, []);
  assert.equal(intent.lease, null);
  assert.equal(intent.observation, null);
  assert.deepEqual(reservation, { schemaVersion: 1, targetUid: 'requester-a', intentId: id,
    state: 'reserved', createdAt: NOW, updatedAt: NOW });
  assert.deepEqual(f.calls, [['verify', 'admin', true]]);
  assert.equal(f.records.get('users/requester-a').accountStatus, 'active');
});

test('exact replay is read-only; changed payload and conflicting target action are rejected', async () => {
  const f = fixture();
  await f.authorize();
  const before = clone([...f.records]);
  assert.equal((await f.authorize()).created, false);
  assert.deepEqual([...f.records], before);
  await assert.rejects(f.authorize(request('terminate')),
    (error) => error.reason === 'ACCOUNT_ACTION_MUTATION_CONFLICT');
  await assert.rejects(f.authorize(request('terminate', 'second-mutation')),
    (error) => error.reason === 'ACCOUNT_ACTION_RESERVED');
  await assert.rejects(f.authorize(request('suspend', 'mutation-1234', 'requester-b')),
    (error) => error.reason === 'ACCOUNT_ACTION_MUTATION_CONFLICT');
  assert.deepEqual([...f.records], before);
});

test('forged actor, forged target, missing trusted authority and rejected transitions create no records', async () => {
  const f = fixture();
  await assert.rejects(f.authorize(request(), 'forged'), (error) => error.reason === 'ADMIN_REQUIRED');
  await assert.rejects(f.authorize(request(), 'no-claim'), (error) => error.reason === 'ADMIN_REQUIRED');
  await assert.rejects(f.authorize(request(), 'invalid'), (error) => error.reason === 'AUTHENTICATION_REQUIRED');
  await assert.rejects(f.authorize(request('suspend', 'mutation-1234', 'missing')),
    (error) => error.reason === 'ACCOUNT_NOT_FOUND');
  await assert.rejects(f.authorize(request('reactivate')),
    (error) => error.reason === 'ACCOUNT_NOT_REACTIVATABLE');
  await assert.rejects(f.authorize(request('suspend', 'mutation-1234', 'admin-a')),
    (error) => error.reason === 'ACCOUNT_ACTION_SELF_DENIED');
  assert.equal([...f.records.keys()].some((key) => key.startsWith('accountAction')), false);
});

test('uncommitted transaction leaves no intent; malformed replay fails closed', async () => {
  const f = fixture();
  const original = f.db.runTransaction;
  f.db.runTransaction = async (fn) => {
    await original.call(f.db, async (tx) => { await fn(tx); throw Error('commit aborted'); });
  };
  await assert.rejects(f.authorize(), /commit aborted/);
  assert.equal([...f.records.keys()].some((key) => key.startsWith('accountAction')), false);
  f.db.runTransaction = original;
  await f.authorize();
  f.records.get(`accountActionIntents/${actionIdentity('admin-a', request())}`).schemaVersion = 999;
  await assert.rejects(f.authorize(), (error) => error.reason === 'ACCOUNT_ACTION_INTENT_INVALID');
});

test('lease expiry preserves reservation, requires reconciliation and rejects stale ownership', async () => {
  const f = fixture();
  const { intent: { id } } = await f.authorize();
  const first = await claimIntentLease({ db: f.db, intentId: id, ownerId: 'worker-a', now: NOW, leaseMs: 1000 });
  assert.equal(first.state, STATES.APPLYING);
  assert.equal(first.generation, 1);
  await assert.rejects(claimIntentLease({ db: f.db, intentId: id, ownerId: 'worker-b', now: NOW }),
    (error) => error.reason === 'ACCOUNT_ACTION_LEASE_HELD');
  const later = new Date(NOW.getTime() + 1001);
  const second = await claimIntentLease({ db: f.db, intentId: id, ownerId: 'worker-b', now: later });
  assert.equal(second.state, STATES.RECONCILE_REQUIRED);
  assert.equal(second.generation, 2);
  await assert.rejects(renewIntentLease({ db: f.db, intentId: id, ownerId: 'worker-a',
    generation: 1, now: later }), (error) => error.reason === 'ACCOUNT_ACTION_LEASE_STALE');
  assert.equal((await renewIntentLease({ db: f.db, intentId: id, ownerId: 'worker-b',
    generation: 2, now: later })).generation, 2);
  assert.equal(f.records.get('accountActionReservations/requester-a').intentId, id);
  f.records.delete('accountActionReservations/requester-a');
  await assert.rejects(claimIntentLease({ db: f.db, intentId: id, ownerId: 'worker-c',
    now: new Date(later.getTime() + 60_001) }),
  (error) => error.reason === 'ACCOUNT_ACTION_RESERVATION_MISSING');
});

test('Firestore rules explicitly deny client access to intents and reservations', () => {
  const rules = readFileSync(resolve(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8');
  for (const name of ['accountActionIntents', 'accountActionReservations']) {
    assert.match(rules, new RegExp(`match /${name}/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`));
  }
});
