const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPasswordChangeOtpHandler } = require('../passwordChangeOtpHandler');

function fixture(role = 'requester') {
  let time = Date.now();
  let sent = '';
  let shouldFailSend = false;
  let shouldFailUpdate = false;
  let shouldFailRevoke = false;
  const records = new Map([
    ['users/u1', { role, email: 'user@example.test', accountStatus: 'active', managerStatus: 'active', distributorStatus: 'active', branchId: 'b1' }],
    ['users/u2', { role, email: 'other@example.test', accountStatus: 'active', managerStatus: 'active', distributorStatus: 'active', branchId: 'b1' }],
    ['branches/b1', { status: 'active' }],
  ]);
  const users = { u1: { uid: 'u1', email: 'user@example.test', emailVerified: true, disabled: false }, u2: { uid: 'u2', email: 'other@example.test', emailVerified: true, disabled: false } };
  let updates = 0;
  let revocations = 0;
  const snap = (ref) => ({ exists: records.has(ref.path), id: ref.id, data: () => records.get(ref.path) });
  const collection = (name) => ({ doc: (id) => ({ id, path: `${name}/${id}`, get: async function () { return snap(this); }, update: async function (changes) { records.set(this.path, { ...records.get(this.path), ...changes }); } }) });
  let tail = Promise.resolve();
  const db = { collection, runTransaction: (fn) => {
    const operation = tail.then(async () => {
      const writes = [];
      const result = await fn({ get: async (ref) => snap(ref), set: (ref, value) => writes.push([ref, value, false]), update: (ref, value) => writes.push([ref, value, true]) });
      for (const [ref, value, merge] of writes) records.set(ref.path, merge ? { ...records.get(ref.path), ...value } : value);
      return result;
    });
    tail = operation.catch(() => {});
    return operation;
  } };
  const auth = {
    verifyIdToken: async (token) => {
      if (!['valid', 'other-user-token'].includes(token)) throw new Error('bad token');
      const uid = token === 'valid' ? 'u1' : 'u2';
      return { uid, email: users[uid].email, email_verified: users[uid].emailVerified, auth_time: Math.floor(time / 1000), role, ...(role === 'admin' ? { admin: true } : {}), ...(role === 'manager' ? { manager: true } : {}) };
    },
    getUser: async (uid) => users[uid],
    updateUser: async () => { updates++; if (shouldFailUpdate) throw new Error('offline'); },
    revokeRefreshTokens: async () => { revocations++; if (shouldFailRevoke) throw new Error('offline'); },
  };
  const handler = createPasswordChangeOtpHandler(() => ({ auth, db }), {
    now: () => time, secret: () => 'test-only-secret', checkTransport: () => {},
    send: async ({ text }) => { if (shouldFailSend) throw new Error('offline'); sent = /\b\d{6}\b/.exec(text)?.[0]; },
  });
  const call = async (body, token = 'valid') => {
    const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res);
    return res;
  };
  return { call, records, users, code: () => sent, updates: () => updates, revocations: () => revocations, advance: (ms) => { time += ms; }, failSend: () => { shouldFailSend = true; }, failUpdate: () => { shouldFailUpdate = true; }, failRevoke: () => { shouldFailRevoke = true; } };
}

const request = { action: 'request' };
const confirm = (code) => ({ action: 'confirm', code, newPassword: 'SafeTestPassword123' });

for (const role of ['requester', 'distributor', 'manager', 'admin']) test(`${role} password change requires a one-time code`, async () => {
  const f = fixture(role);
  assert.equal((await f.call(request)).statusCode, 200);
  const code = f.code();
  const result = await f.call(confirm(code));
  assert.equal(result.body.changed, true);
  assert.equal(result.body.signOutRequired, true);
  assert.equal(f.revocations(), 1);
  assert.ok(f.records.get('users/u1').passwordChangedAt instanceof Date);
  assert.equal(f.updates(), 1);
  assert.notEqual((await f.call(confirm(code))).statusCode, 200);
  assert.equal(f.updates(), 1);
});

test('invalid codes, attempts, cooldown, expiry, and unverified emails fail closed', async () => {
  const f = fixture();
  assert.equal((await f.call(request)).statusCode, 200);
  assert.equal((await f.call(request)).statusCode, 429);
  const wrong = f.code() === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.notEqual((await f.call(confirm(wrong))).statusCode, 200);
  assert.notEqual((await f.call(confirm(f.code()))).statusCode, 200);
  assert.equal(f.updates(), 0);
  const expired = fixture();
  await expired.call(request);
  expired.advance(11 * 60 * 1000);
  assert.notEqual((await expired.call(confirm(expired.code()))).statusCode, 200);
  const unverified = fixture();
  unverified.users.u1.emailVerified = false;
  assert.equal((await unverified.call(request)).body.error.reason, 'VERIFIED_EMAIL_REQUIRED');
  assert.equal(unverified.updates(), 0);
});

test('codes are bound to account identity and failed delivery never enables an update', async () => {
  const f = fixture();
  await f.call(request);
  assert.notEqual((await f.call(confirm(f.code()), 'other-user-token')).statusCode, 200);
  const failed = fixture();
  failed.failSend();
  assert.equal((await failed.call(request)).statusCode, 503);
  assert.notEqual((await failed.call(confirm('123456'))).statusCode, 200);
  assert.equal(failed.updates(), 0);
});

test('mandatory first login and changed email cannot use a normal password-change code', async () => {
  const firstLogin = fixture('manager');
  firstLogin.records.set('users/u1', { ...firstLogin.records.get('users/u1'), mustChangePassword: true });
  assert.equal((await firstLogin.call(request)).statusCode, 403);
  const changedEmail = fixture();
  await changedEmail.call(request);
  changedEmail.users.u1.email = 'new@example.test';
  assert.equal((await changedEmail.call(confirm(changedEmail.code()))).statusCode, 403);
  assert.equal(changedEmail.updates(), 0);
});

test('uncertain password updates cannot reuse the code or start a second operation', async () => {
  const f = fixture();
  await f.call(request);
  const code = f.code();
  f.failUpdate();
  assert.equal((await f.call(confirm(code))).statusCode, 503);
  assert.notEqual((await f.call(confirm(code))).statusCode, 200);
  f.advance(11 * 60 * 1000);
  assert.equal((await f.call(request)).body.error.reason, 'CHANGE_IN_PROGRESS');
  assert.equal(f.updates(), 1);
});

test('simultaneous confirmation requests perform at most one password update', async () => {
  const f = fixture();
  await f.call(request);
  const results = await Promise.all([f.call(confirm(f.code())), f.call(confirm(f.code()))]);
  assert.equal(results.filter((result) => result.body.changed === true).length, 1);
  assert.equal(f.updates(), 1);
});

test('session revocation follows the saved role policy and uncertain revocation fails closed', async () => {
  const { SECURE_DEFAULTS } = require('../../registration/registrationSecurity');
  const allowed = fixture('manager');
  allowed.records.set('systemConfig/registrationSecurity', { ...SECURE_DEFAULTS, sessionSecurity: { ...SECURE_DEFAULTS.sessionSecurity, manager: { ...SECURE_DEFAULTS.sessionSecurity.manager, forceLogoutAfterPasswordChange: false } } });
  await allowed.call(request);
  const result = await allowed.call(confirm(allowed.code()));
  assert.equal(result.body.changed, true);
  assert.equal(result.body.signOutRequired, false);
  assert.equal(allowed.revocations(), 0);
  assert.equal(allowed.records.get('users/u1').sessionRevokedAt, undefined);
  const failed = fixture();
  await failed.call(request);
  const code = failed.code();
  failed.failRevoke();
  assert.equal((await failed.call(confirm(code))).statusCode, 503);
  assert.equal(failed.records.get('passwordChangeOtpSessions/u1').status, 'outcome-unknown');
  assert.equal((await failed.call(confirm(code))).statusCode !== 200, true);
  assert.equal(failed.updates(), 1);
});

test('normal flow keeps first-login, recovery, and three role entry points separate', () => {
  const read = (...file) => fs.readFileSync(path.resolve(__dirname, '../../..', ...file), 'utf8');
  const modal = read('components', 'ChangePasswordModal.jsx');
  assert.match(modal, /reauthenticateWithCredential/);
  assert.doesNotMatch(modal, /updatePassword\(/);
  for (const file of ['app/requester/r_profile.jsx', 'app/distributor/d_profile.jsx', fs.existsSync(path.resolve(__dirname, '../../../app/manager/settings.jsx')) ? 'app/manager/settings.jsx' : 'app/manager/profile.jsx']) assert.match(read(...file.split('/')), /<ChangePasswordModal/);
  assert.doesNotMatch(read('app', 'admin', 'registration-security.jsx'), /<ChangePasswordModal|Administrator password/);
  assert.match(read('app', 'required-password-change.jsx'), /completeRequiredPasswordChange/);
  assert.match(read('backend', 'auth', 'passwordRecoveryHandler.js'), /PASSWORD_RESET/);
});
