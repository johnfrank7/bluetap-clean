const test = require('node:test');
const assert = require('node:assert/strict');
const { recoverProfile, validSnapshot } = require('../profileRecovery');

const user = { uid: 'trusted-user', email: 'user@example.test', emailVerified: true, disabled: false };
const snapshot = {
  uid: user.uid, email: user.email, role: 'requester', username: 'Trusted_User', usernameNormalized: 'trusted_user', unique_id: 'REQ-000001',
  approvalStatus: 'approved', status: 'Approved', emailVerificationRequired: true, emailVerified: true,
  registrationCompleted: true, onboardingStatus: 'complete', termsAcceptance: { accepted: true },
  faceVerification: { status: 'verified', livenessPassed: true, duplicateCheck: 'clear', verificationReference: user.uid },
};

test('trusted recovery requires a complete, UID-bound finalized snapshot', async () => {
  assert.equal(validSnapshot(snapshot, user), true);
  assert.equal(validSnapshot({ ...snapshot, uid: 'attacker' }, user), false);
  assert.equal(validSnapshot({ ...snapshot, faceVerification: { ...snapshot.faceVerification, status: 'unverified' } }, user), false);
});

test('recovery restores only the trusted snapshot and never fabricates one', async () => {
  const records = new Map([['usernames/trusted_user', { uid: user.uid }]]);
  const ref = (key) => ({ key, get: async () => ({ exists: records.has(key), data: () => records.get(key) }) });
  const sessionRef = ref('registrationSessions/session');
  const db = {
    collection: (name) => ({
      doc: (id) => ref(`${name}/${id}`),
      where: () => ({ get: async () => ({ docs: name === 'registrationSessions' ? [{ ref: sessionRef, data: () => ({ completed: true, emailVerified: true, profileRecovery: snapshot }) }] : [] }) }),
    }),
    runTransaction: async (callback) => callback({
      get: async (reference) => reference.get(),
      set: (reference, value) => records.set(reference.key, value),
      update: (reference, value) => records.set(reference.key, { ...records.get(reference.key), ...value }),
    }),
  };
  const result = await recoverProfile({ auth: { getUser: async () => user }, db, uid: user.uid });
  assert.deepEqual(result, { recovered: true });
  assert.equal(records.get(`users/${user.uid}`).role, 'requester');
  assert.equal(records.get(`users/${user.uid}`).faceVerification.status, 'verified');
});

test('recovery leaves an Auth-only account untouched without trusted evidence', async () => {
  const db = {
    collection: (name) => ({
      doc: (id) => ({ key: `${name}/${id}`, get: async () => ({ exists: false, data: () => undefined }) }),
      where: () => ({ get: async () => ({ docs: [] }) }),
    }),
  };
  assert.deepEqual(await recoverProfile({ auth: { getUser: async () => user }, db, uid: user.uid }), { recovered: false, reason: 'no-trusted-session' });
});
