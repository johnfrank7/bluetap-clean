const assert = require('node:assert/strict');
const test = require('node:test');

const { createRequiredPasswordChangeHandler, validateNewPassword } = require('../requiredPasswordChangeHandler');

const now = Date.UTC(2026, 8, 14, 12, 0, 0);

function fixture({ role = 'admin', mustChangePassword = true, claims = { admin: true, role: 'admin' } } = {}) {
  const profile = { role, mustChangePassword };
  const calls = { updates: [], revoked: [] };
  const profileRef = {
    async get() { return { exists: true, data: () => ({ ...profile }) }; },
    async update(changes) { Object.assign(profile, changes); },
  };
  const auth = {
    async verifyIdToken(token) {
      if (token !== 'valid-token') throw new Error('invalid');
      return { uid: 'admin-1', auth_time: Math.floor(now / 1000), ...claims };
    },
    async updateUser(uid, changes) { calls.updates.push({ uid, changes }); },
    async revokeRefreshTokens(uid) { calls.revoked.push(uid); },
  };
  const db = { collection: () => ({ doc: () => profileRef }) };
  return { calls, getAdmin: () => ({ auth, db }), profile };
}

function response() {
  return {
    statusCode: 200, body: null, setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

async function call(handler, token, body) {
  const res = response();
  await handler({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
  return res;
}

test('required Admin password change updates Auth before clearing the enforcement flag', async () => {
  const f = fixture();
  const res = await call(createRequiredPasswordChangeHandler(f.getAdmin, () => now), 'valid-token', { newPassword: 'FreshAdmin2026' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, true);
  assert.equal(f.calls.updates[0].uid, 'admin-1');
  assert.equal(f.calls.updates[0].changes.password, 'FreshAdmin2026');
  assert.equal(f.profile.mustChangePassword, false);
  assert.deepEqual(f.calls.revoked, ['admin-1']);
});

test('password change rejects weak passwords, non-Admins, stale login, and accounts without the flag', async () => {
  assert.throws(() => validateNewPassword('short'), (error) => error.reason === 'WEAK_PASSWORD');
  let f = fixture({ role: 'requester', claims: {} });
  assert.equal((await call(createRequiredPasswordChangeHandler(f.getAdmin, () => now), 'valid-token', { newPassword: 'FreshAdmin2026' })).body.error.reason, 'ADMIN_REQUIRED');
  f = fixture({ mustChangePassword: false });
  assert.equal((await call(createRequiredPasswordChangeHandler(f.getAdmin, () => now), 'valid-token', { newPassword: 'FreshAdmin2026' })).body.error.reason, 'PASSWORD_CHANGE_NOT_REQUIRED');
  f = fixture();
  const staleNow = () => now + (11 * 60 * 1000);
  assert.equal((await call(createRequiredPasswordChangeHandler(f.getAdmin, staleNow), 'valid-token', { newPassword: 'FreshAdmin2026' })).body.error.reason, 'REAUTHENTICATION_REQUIRED');
});
