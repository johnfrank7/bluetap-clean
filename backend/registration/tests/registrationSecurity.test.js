const test = require('node:test');
const assert = require('node:assert/strict');
const { SECURE_DEFAULTS, normalizeRegistrationSecurity, policySnapshot, validateRegistrationSecurity } = require('../registrationSecurity');
const { createAdminRegistrationSecurityHandler } = require('../../admin/registrationSecurityHandler');

test('registration security accepts three valid verification combinations and rejects both off', () => {
  for (const [faceVerificationEnabled, emailOtpEnabled] of [[true, true], [true, false], [false, true]]) {
    const value = validateRegistrationSecurity({ faceVerificationEnabled, emailOtpEnabled, maxAccountsPerDevice: 3, maxAccountsPerIp: 3 });
    assert.equal(value.faceVerificationEnabled, faceVerificationEnabled);
    assert.equal(value.emailOtpEnabled, emailOtpEnabled);
  }
  assert.throws(() => validateRegistrationSecurity({ faceVerificationEnabled: false, emailOtpEnabled: false, maxAccountsPerDevice: 3, maxAccountsPerIp: 3 }), (error) => error.reason === 'VERIFICATION_METHOD_REQUIRED');
});

test('missing and malformed policies fail closed to secure defaults', () => {
  assert.deepEqual(normalizeRegistrationSecurity(null), SECURE_DEFAULTS);
  assert.deepEqual(policySnapshot(null), { faceVerificationRequired: true, emailOtpRequired: true, maxAccountsPerDevice: 3, maxAccountsPerIp: 3, policyVersion: 1 });
  for (const value of [0, -1, 1.5, 21, '3', NaN]) {
    assert.throws(() => validateRegistrationSecurity({ faceVerificationEnabled: true, emailOtpEnabled: true, maxAccountsPerDevice: value, maxAccountsPerIp: 3 }));
  }
});

function response() {
  return { statusCode: 0, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() {} };
}

function adminFixture(role, claims = {}) {
  const records = new Map([['users/user-1', { role }]]);
  let auditId = 0;
  const snapshot = (key) => ({ exists: records.has(key), data: () => records.get(key) });
  const db = {
    collection: (name) => ({ doc: (id) => ({ key: `${name}/${id || `audit-${++auditId}`}`, get: async function () { return snapshot(this.key); } }) }),
    runTransaction: async (callback) => {
      const writes = [];
      const result = await callback({ get: async (ref) => snapshot(ref.key), set: (ref, data) => writes.push([ref.key, data]) });
      writes.forEach(([key, data]) => records.set(key, data));
      return result;
    },
  };
  const auth = { verifyIdToken: async () => ({ uid: 'user-1', ...claims }) };
  return { records, handler: createAdminRegistrationSecurityHandler(() => ({ auth, db })) };
}

test('only Firebase-authenticated trusted admin can change registration security', async () => {
  for (const role of ['manager', 'requester', 'distributor']) {
    const f = adminFixture(role, { role });
    const res = response();
    await f.handler({ method: 'PATCH', headers: { authorization: 'Bearer valid' }, body: { faceVerificationEnabled: true, emailOtpEnabled: true, maxAccountsPerDevice: 5, maxAccountsPerIp: 3 } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.reason, 'ADMIN_REQUIRED');
  }
  const f = adminFixture('admin', { admin: true });
  const res = response();
  await f.handler({ method: 'PATCH', headers: { authorization: 'Bearer valid' }, body: { faceVerificationEnabled: true, emailOtpEnabled: false, maxAccountsPerDevice: 5, maxAccountsPerIp: 4 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(f.records.get('systemConfig/registrationSecurity').maxAccountsPerDevice, 5);
  assert.equal([...f.records.values()].some((value) => value.action === 'REGISTRATION_SECURITY_UPDATED'), true);
});
