const test = require('node:test');
const assert = require('node:assert/strict');
const { createRegistrationService } = require('./registration');

const form = { firstName: 'Test', lastName: 'Person', phone: '+639123456789',
  barangay: 'Awihao', role: 'requester', password: 'test-password-only' };
function fixture() {
  let time = 1800000000000;
  const records = new Map();
  const users = new Map();
  const sent = [];
  let failEmail = false;
  let failProfile = false;
  let creates = 0;
  let queue = Promise.resolve();
  const snapshot = (key) => ({ exists: records.has(key), data: () => records.get(key) });
  const db = {
    collection: (collection) => ({ doc: (id) => ({ key: collection + '/' + id, get: async () => snapshot(collection + '/' + id) }) }),
    runTransaction: (callback) => {
      const task = queue.then(async () => {
        const writes = [];
        const result = await callback({
          get: async (ref) => snapshot(ref.key),
          set: (ref, data, options) => {
            if (failProfile && ref.key.startsWith('users/')) throw new Error('Profile write unavailable');
            writes.push([ref.key, options?.merge ? { ...records.get(ref.key), ...data } : data]);
          },
          update: (ref, data) => writes.push([ref.key, { ...records.get(ref.key), ...data }]),
        });
        for (const [key, data] of writes) records.set(key, data);
        return result;
      });
      queue = task.catch(() => {});
      return task;
    },
  };
  const auth = {
    getUserByEmail: async (email) => {
      const user = [...users.values()].find((u) => u.email === email);
      if (!user) throw Object.assign(new Error('Not found'), { code: 'auth/user-not-found' });
      return { ...user };
    },
    createUser: async (data) => {
      creates++;
      const user = { ...data, uid: 'new-user' };
      users.set(user.uid, user);
      return user;
    },
    deleteUser: async (uid) => users.delete(uid),
    updateUser: async (uid, data) => users.set(uid, { ...users.get(uid), ...data }),
    createCustomToken: async (uid) => 'test-custom-token-for-' + uid,
  };
  const service = createRegistrationService({ auth, db, hashSecret: 'test-signing-key', now: () => time,
    sendEmailOtp: async (message) => { if (failEmail) throw new Error('Test provider outage'); sent.push(message); },
  });
  return { service, users, records, sent, get creates() { return creates; },
    advance: (ms) => { time += ms; }, failEmail: () => { failEmail = true; }, failProfile: () => { failProfile = true; } };
}
const reason = (expected) => (error) => error.reason === expected;

test('requesting and abandoning OTP creates neither Auth user nor user profile', async () => {
  const f = fixture();
  await f.service.request('new@example.test', 'test-ip');
  assert.equal(f.users.size, 0);
  assert.equal(f.creates, 0);
  assert.equal([...f.records.keys()].some((key) => key.startsWith('users/')), false);
  assert.equal([...f.records.values()].some((data) => JSON.stringify(data).includes(form.password)), false);
});

test('provider failure and wrong OTP never create an account', async () => {
  const failed = fixture();
  failed.failEmail();
  await assert.rejects(failed.service.request('new@example.test', 'test-ip'));
  assert.equal(failed.creates, 0);
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  await assert.rejects(f.service.complete(result.challenge, '000000', form), reason('incorrect-code'));
  assert.equal(f.creates, 0);
});

test('correct OTP creates verified Auth account and server-owned profile exactly once', async () => {
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  const completed = await f.service.complete(result.challenge, f.sent[0].code, { ...form, uid: 'forged', email: 'forged@example.test', emailVerified: true, approvalStatus: 'approved' });
  assert.equal(f.creates, 1);
  assert.equal(f.users.get('new-user').email, 'new@example.test');
  assert.equal(f.users.get('new-user').emailVerified, true);
  const profile = f.records.get('users/new-user');
  assert.equal(profile.email, 'new@example.test');
  assert.equal(profile.uid, 'new-user');
  assert.equal(profile.unique_id, 'REQ-000001');
  assert.equal(profile.faceVerification.status, 'unverified');
  assert.equal(profile.password, undefined);
  assert.equal(completed.verified, true);
  assert.match(completed.customToken, /^test-custom-token/);
  await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, form), reason('no-active-code'));
  assert.equal(f.creates, 1);
});

test('distributor registration cannot set its own approval or face verification', async () => {
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  await f.service.complete(result.challenge, f.sent[0].code, { ...form, role: 'distributor', approvalStatus: 'approved', faceVerification: { status: 'verified' } });
  const profile = f.records.get('users/new-user');
  assert.equal(profile.approvalStatus, 'pending');
  assert.equal(profile.faceVerification.status, 'unverified');
  assert.equal(profile.unique_id, 'DIS-000001');
});

test('tampered challenge and admin role cannot create an account', async () => {
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  await assert.rejects(f.service.complete(result.challenge + 'x', f.sent[0].code, form), reason('registration-expired'));
  await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, { ...form, role: 'admin' }), reason('invalid-registration'));
  assert.equal(f.creates, 0);
});

test('existing orphaned unverified signup is completed only after OTP without duplication', async () => {
  const f = fixture();
  f.users.set('old', { uid: 'old', email: 'old@example.test', emailVerified: false });
  const result = await f.service.request('old@example.test', 'test-ip');
  assert.equal(f.records.has('users/old'), false);
  await f.service.complete(result.challenge, f.sent[0].code, form);
  assert.equal(f.users.size, 1);
  assert.equal(f.creates, 0);
  assert.equal(f.users.get('old').emailVerified, true);
  assert.equal(f.records.get('users/old').role, 'requester');
});

test('existing unverified distributor keeps role and approval on recovery', async () => {
  const f = fixture();
  f.users.set('old', { uid: 'old', email: 'old@example.test', emailVerified: false });
  f.records.set('users/old', { role: 'distributor', approvalStatus: 'rejected', unique_id: 'DIS-000007' });
  const result = await f.service.request('old@example.test', 'test-ip');
  await f.service.complete(result.challenge, f.sent[0].code, form);
  assert.equal(f.records.get('users/old').role, 'distributor');
  assert.equal(f.records.get('users/old').approvalStatus, 'rejected');
  assert.equal(f.records.get('users/old').unique_id, 'DIS-000007');
});

test('verified accounts and admin profiles cannot be overwritten by registration', async () => {
  for (const admin of [true, false]) {
    const f = fixture();
    f.users.set('old', { uid: 'old', email: 'old@example.test', emailVerified: !admin });
    if (admin) f.records.set('users/old', { role: 'admin' });
    const result = await f.service.request('old@example.test', 'test-ip');
    await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, form), reason('account-exists'));
    assert.equal(f.creates, 0);
    assert.equal(f.users.get('old').password, undefined);
  }
});

test('profile write failure rolls back only the newly created Auth account', async () => {
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  f.failProfile();
  await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, form));
  assert.equal(f.users.size, 0);
  assert.equal(f.records.has('users/new-user'), false);
});

test('expired registration challenge requires restarting and does not create an account', async () => {
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  f.advance(3600000);
  await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, form), reason('registration-expired'));
  assert.equal(f.creates, 0);
});

test('public request endpoint rate limits sends across different emails by IP', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) await f.service.request(`test${i}@example.test`, 'one-ip');
  await assert.rejects(f.service.request('another@example.test', 'one-ip'), reason('resend-limit-reached'));
  assert.equal(f.creates, 0);
});
