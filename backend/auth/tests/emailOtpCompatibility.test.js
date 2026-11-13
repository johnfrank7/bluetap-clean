const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createEmailOtpService } = require('../emailOtp');

const root = resolve(__dirname, '../../..');
function loadDestination(auth) {
  const source = readFileSync(resolve(root, 'services/authSession.js'), 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace(/export const /g, 'const ')
    .replace(/^export \{[^}]+\};\r?\n/gm, '');
  return vm.runInNewContext(`${source}\ngetPostAuthenticationDestination`, { auth });
}

function fixture(role, { verified = false, mustChangePassword = false, failSync = false } = {}) {
  const uid = `mock-${role}`;
  const email = `${role}@example.test`;
  const user = { uid, email, emailVerified: verified };
  const auth = {
    currentUser: user,
    getUser: async (requestedUid) => { assert.equal(requestedUid, uid); return { ...user }; },
    updateUser: async (requestedUid, changes) => { assert.equal(requestedUid, uid); Object.assign(user, changes); return { ...user }; },
  };
  let records = new Map([[`users/${uid}`, {
    uid, email, role, accountStatus: 'active', accountSource: 'admin_created',
    emailVerificationRequired: true, emailVerified: false, mustChangePassword,
    emailOtpVerification: { required: true, status: 'reconciliation-failed', profileSynced: false },
    registrationCompleted: true, faceVerification: { required: false, status: 'not_required' },
    managerStatus: 'active', distributorStatus: 'active', branchId: 'test-branch',
  }]]);
  const copy = (value) => value === undefined ? undefined : structuredClone(value);
  const snapshot = (map, path) => ({ exists: map.has(path), data: () => copy(map.get(path)) });
  const ref = (path) => ({ path, get: async () => snapshot(records, path),
    set: async (data, options) => records.set(path, options?.merge ? { ...records.get(path), ...copy(data) } : copy(data)) });
  const db = {
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    runTransaction: async (callback) => {
      const next = new Map([...records].map(([key, value]) => [key, copy(value)]));
      const tx = {
        get: async (docRef) => snapshot(next, docRef.path),
        set: (docRef, data, options) => next.set(docRef.path, options?.merge ? { ...next.get(docRef.path), ...copy(data) } : copy(data)),
        update: (docRef, data) => {
          if (failSync && docRef.path.startsWith('users/')) throw new Error('mock profile transaction failure');
          assert.ok(next.has(docRef.path));
          next.set(docRef.path, { ...next.get(docRef.path), ...copy(data) });
        },
      };
      const result = await callback(tx);
      records = next;
      return result;
    },
  };
  const sent = [];
  const service = createEmailOtpService({ auth, db, hashSecret: 'isolated-test-only-key',
    sendEmailOtp: async (message) => { sent.push(message); } });
  return { uid, user, auth, service, sent, profile: () => copy(records.get(`users/${uid}`)),
    otp: () => copy(records.get(`emailOtpVerifications/${uid}`)) };
}

test('verified OTP reconciles stale profile markers before all three role dashboards', async () => {
  for (const [role, home] of [['requester', '/requester/r_dashboard'],
    ['distributor', '/distributor/d_dashboard'], ['manager', '/manager/dashboard']]) {
    const f = fixture(role);
    const destination = loadDestination(f.auth);
    assert.equal(destination(f.profile()), '/email-verification');
    await f.service.request(f.uid);
    assert.equal(f.sent.length, 1);
    assert.deepEqual(await f.service.verify(f.uid, f.sent[0].code), { verified: true });
    assert.equal(f.user.emailVerified, true);
    assert.equal(f.profile().emailVerified, true);
    assert.equal(f.profile().emailOtpVerification.status, 'verified');
    assert.equal(f.profile().emailOtpVerification.profileSynced, true);
    assert.equal(f.otp().profileSynced, true);
    assert.equal(destination(f.profile()), home);
  }
});

test('already verified Auth identity can reconcile its own eligible profile without resending OTP', async () => {
  const f = fixture('requester', { verified: true });
  assert.deepEqual(await f.service.request(f.uid), { alreadyVerified: true });
  assert.equal(f.sent.length, 0);
  assert.equal(f.profile().emailOtpVerification.profileSynced, true);
  assert.equal(loadDestination(f.auth)(f.profile()), '/requester/r_dashboard');
});

test('pending first-login password and failed profile synchronization remain blocked', async () => {
  for (const role of ['manager', 'distributor']) {
    const pending = fixture(role, { mustChangePassword: true });
    await assert.rejects(pending.service.request(pending.uid), (error) => error.reason === 'PASSWORD_CHANGE_REQUIRED');
    assert.equal(pending.sent.length, 0);
    assert.equal(loadDestination(pending.auth)(pending.profile()), '/required-password-change');
  }

  const failed = fixture('distributor', { failSync: true });
  await failed.service.request(failed.uid);
  await assert.rejects(failed.service.verify(failed.uid, failed.sent[0].code),
    (error) => error.reason === 'EMAIL_VERIFICATION_SYNC_FAILED');
  assert.equal(failed.user.emailVerified, false);
  assert.equal(failed.profile().emailOtpVerification.profileSynced, false);
  assert.equal(loadDestination(failed.auth)(failed.profile()), '/email-verification');
});
