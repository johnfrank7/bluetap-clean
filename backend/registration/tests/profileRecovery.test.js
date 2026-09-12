const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { recoverProfile, validSnapshot, restartIncompleteRegistration } = require('../profileRecovery');

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

function restartFixture({ session = null, profile = null, activity = false, reservation = true } = {}) {
  const records = new Map();
  if (profile) records.set(`users/${user.uid}`, profile);
  if (session) records.set('registrationSessions/temp-session', session);
  if (reservation) records.set('usernameReservations/temp_name', { ownerHash: createHmac('sha256', 'secret').update(`email:${user.email}`).digest('hex') });
  if (activity) records.set('requests/activity', { requester_id: user.uid });
  const ref = (key) => ({
    path: key,
    get: async () => ({ exists: records.has(key), data: () => records.get(key) }),
  });
  const docsFor = (name, field, value) => [...records.entries()]
    .filter(([key, data]) => key.startsWith(`${name}/`) &&
      (field === 'userUid' ? data.userUid === value : field === 'profileRecovery.uid' ? data.profileRecovery?.uid === value :
        field === 'ownerHash' ? data.ownerHash === value : data[field] === value))
    .map(([key, data]) => ({ ref: ref(key), id: key.split('/')[1], data: () => data }));
  const db = {
    collection: (name) => ({
      doc: (id) => ref(`${name}/${id}`),
      where: (field, _operator, value) => {
        const query = { get: async () => { const docs = docsFor(name, field, value); return { docs, empty: docs.length === 0 }; } };
        query.limit = () => query;
        return query;
      },
    }),
    batch: () => {
      const deletes = [];
      return { delete: (reference) => deletes.push(reference.path), commit: async () => deletes.forEach((key) => records.delete(key)) };
    },
  };
  let deletedUid = null;
  return { records, db, auth: { getUser: async () => user, deleteUser: async (uid) => { deletedUid = uid; } }, deleted: () => deletedUid };
}

test('restart removes only an Auth-only account and its incomplete private records', async () => {
  const f = restartFixture({ session: { userUid: user.uid, completed: false, emailVerified: false,
    faceVerification: { status: 'unverified', verificationReference: null } } });
  const result = await restartIncompleteRegistration({ auth: f.auth, db: f.db, uid: user.uid, hashSecret: 'secret' });
  assert.deepEqual(result, { restarted: true });
  assert.equal(f.deleted(), user.uid);
  assert.equal(f.records.has('registrationSessions/temp-session'), false);
  assert.equal(f.records.has(`emailOtpVerifications/${user.uid}`), false);
  assert.equal(f.records.has('usernameReservations/temp_name'), false);
});

test('restart discards only the temporary registration face before removing its session', async () => {
  const f = restartFixture({ session: { userUid: user.uid, completed: false, emailVerified: false,
    faceVerification: { status: 'passed_pending_finalization', verificationReference: 'temp-session' } } });
  const calls = [];
  await restartIncompleteRegistration({ auth: f.auth, db: f.db, uid: user.uid, hashSecret: 'secret', render: async (path, form) => {
    calls.push([path, form.get('registration_session_id')]);
    return { discarded: true };
  } });
  assert.deepEqual(calls, [['/discard-registration-face', 'temp-session']]);
  assert.equal(f.deleted(), user.uid);
});

test('restart fails closed when a profile, activity, completed session, or finalized face exists', async () => {
  const cases = [
    restartFixture({ profile: { role: 'requester' } }),
    restartFixture({ activity: true }),
    restartFixture({ session: { userUid: user.uid, completed: true } }),
    restartFixture({ session: { userUid: user.uid, faceVerification: { status: 'verified', verificationReference: user.uid } } }),
  ];
  for (const f of cases) {
    await assert.rejects(restartIncompleteRegistration({ auth: f.auth, db: f.db, uid: user.uid, hashSecret: 'secret' }), /cannot be automatically restarted/);
    assert.equal(f.deleted(), null);
  }
});
