const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyUsernameMapping, run, CONFIRMATION } = require('../../../scripts/cleanup-orphan-usernames');

function fixture({ users = {}, profiles = {}, mappings = {} } = {}) {
  const records = new Map(Object.entries(mappings).map(([id, data]) => [`usernames/${id}`, data]));
  const ref = (path) => ({ path, delete: async () => records.delete(path) });
  const db = {
    collection: (name) => ({
      doc: (id) => ({ get: async () => ({ exists: Object.hasOwn(profiles, id), data: () => profiles[id] }) }),
      get: async () => ({ size: Object.keys(mappings).length, docs: Object.entries(mappings).map(([id, data]) => ({ id, data: () => data, ref: ref(`${name}/${id}`) })) }),
    }),
  };
  const auth = { getUser: async (uid) => {
    if (!users[uid]) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
    return users[uid];
  } };
  return { auth, db, records };
}

const finalized = { uid: 'uid-1', usernameNormalized: 'nishi', registrationCompleted: true, onboardingStatus: 'complete', email: 'nishi@example.test' };

test('cleanup keeps a completed UID/Auth/profile chain when username mapping has no email', async () => {
  const f = fixture({ users: { 'uid-1': { uid: 'uid-1', email: 'nishi@example.test' } }, profiles: { 'uid-1': finalized } });
  assert.deepEqual(await classifyUsernameMapping({ ...f, id: 'nishi', mapping: { uid: 'uid-1' } }), { kind: 'valid', reason: 'finalized-uid-auth-profile-chain' });
});

test('cleanup flags mappings with a missing Auth user or unfinished profile as orphans', async () => {
  const missing = fixture();
  assert.deepEqual(await classifyUsernameMapping({ ...missing, id: 'missing_user', mapping: { uid: 'missing' } }), { kind: 'orphan', reason: 'firebase-auth-user-missing' });
  const unfinished = fixture({ users: { 'uid-1': { uid: 'uid-1', email: 'nishi@example.test' } }, profiles: { 'uid-1': { ...finalized, registrationCompleted: false } } });
  assert.deepEqual(await classifyUsernameMapping({ ...unfinished, id: 'nishi', mapping: { uid: 'uid-1' } }), { kind: 'orphan', reason: 'registration-not-finalized' });
});

test('cleanup apply deletes only confirmed orphan username mappings', async () => {
  const f = fixture({
    users: { 'uid-1': { uid: 'uid-1', email: 'nishi@example.test' } },
    profiles: { 'uid-1': finalized },
    mappings: { nishi: { uid: 'uid-1' }, stale_name: { uid: 'missing' } },
  });
  const logs = [];
  await run({ ...f, log: (line) => logs.push(line), applying: true, confirmation: CONFIRMATION });
  assert.equal(f.records.has('usernames/nishi'), true);
  assert.equal(f.records.has('usernames/stale_name'), false);
  assert.match(logs.join('\n'), /Orphan mappings: 1/);
});
