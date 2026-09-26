const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { DEFAULT_SESSION_SECURITY, SECURE_DEFAULTS, normalizeRegistrationSecurity, policySnapshot, validateRegistrationSecurity } = require('../registrationSecurity');
const { createAdminRegistrationSecurityHandler } = require('../../admin/registrationSecurityHandler');
const { createRegistrationSessionHandler } = require('../registrationSessionHandler');
const { getClientIp } = require('../../utils/request');
const { createSessionPolicyHandler } = require('../../auth/sessionPolicyHandler');

test('registration security accepts all four verification combinations', () => {
  for (const [faceVerificationEnabled, emailOtpEnabled] of [[true, true], [true, false], [false, true], [false, false]]) {
    const value = validateRegistrationSecurity({ faceVerificationEnabled, emailOtpEnabled, maxAccountsPerDevice: 3, maxAccountsPerIp: 3 });
    assert.equal(value.faceVerificationEnabled, faceVerificationEnabled);
    assert.equal(value.emailOtpEnabled, emailOtpEnabled);
  }
});

test('missing and malformed policies fail closed to secure defaults', () => {
  assert.deepEqual(normalizeRegistrationSecurity(null), SECURE_DEFAULTS);
  assert.deepEqual(policySnapshot(null), { faceVerificationRequired: true, emailOtpRequired: true, maxAccountsPerDevice: 3, maxAccountsPerIp: 3, policyVersion: 1 });
  for (const value of [0, -1, 1.5, 21, '3', NaN]) {
    assert.throws(() => validateRegistrationSecurity({ faceVerificationEnabled: true, emailOtpEnabled: true, maxAccountsPerDevice: value, maxAccountsPerIp: 3 }));
  }
});

test('session security accepts only supported role-specific timeout values', () => {
  const valid = validateRegistrationSecurity({ faceVerificationEnabled: true, emailOtpEnabled: true, maxAccountsPerDevice: 3, maxAccountsPerIp: 3, sessionSecurity: DEFAULT_SESSION_SECURITY });
  assert.deepEqual(valid.sessionSecurity, DEFAULT_SESSION_SECURITY);
  assert.throws(() => validateRegistrationSecurity({ faceVerificationEnabled: true, emailOtpEnabled: true, maxAccountsPerDevice: 3, maxAccountsPerIp: 3, sessionSecurity: { ...DEFAULT_SESSION_SECURITY, manager: { ...DEFAULT_SESSION_SECURITY.manager, idleTimeoutMinutes: 14 } } }), (error) => error.reason === 'INVALID_SESSION_SECURITY_CONFIG');
});

test('role-scoped session endpoint exposes only the requested non-Admin policy', async () => {
  const records = new Map([['systemConfig/registrationSecurity', { ...SECURE_DEFAULTS, sessionSecurity: { ...DEFAULT_SESSION_SECURITY, manager: { ...DEFAULT_SESSION_SECURITY.manager, idleTimeoutMinutes: 10 } } }]]);
  const db = { collection: (name) => ({ doc: (id) => ({ get: async () => ({ exists: records.has(`${name}/${id}`), data: () => records.get(`${name}/${id}`) }) }) }) };
  const handler = createSessionPolicyHandler(() => ({ db }));
  const managerResponse = response();
  await handler({ method: 'POST', headers: {}, body: { role: 'manager' } }, managerResponse);
  assert.equal(managerResponse.statusCode, 200);
  assert.deepEqual(managerResponse.body.policy, { idleTimeoutMinutes: 10, absoluteSessionHours: 24, forceLogoutAfterPasswordChange: true });
  const adminResponse = response();
  await handler({ method: 'POST', headers: {}, body: { role: 'admin' } }, adminResponse);
  assert.equal(adminResponse.statusCode, 400);
});

test('authenticated session policy applies only that user’s idle override over the role default', async () => {
  const records = new Map([
    ['systemConfig/registrationSecurity', { ...SECURE_DEFAULTS }],
    ['users/requester-1', { role: 'requester', sessionIdleTimeoutOverrideMinutes: 10 }],
  ]);
  const db = { collection: (name) => ({ doc: (id) => ({ get: async () => ({ exists: records.has(`${name}/${id}`), data: () => records.get(`${name}/${id}`) }) }) }) };
  const auth = { verifyIdToken: async () => ({ uid: 'requester-1' }) };
  const handler = createSessionPolicyHandler(() => ({ auth, db }));
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid' }, body: { role: 'requester' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.policy.idleTimeoutMinutes, 10);
  assert.equal(res.body.rolePolicy.idleTimeoutMinutes, 30);
  assert.equal(res.body.overrideIdleTimeoutMinutes, 10);
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
  assert.deepEqual(f.records.get('systemConfig/registrationSecurity').sessionSecurity, DEFAULT_SESSION_SECURITY);
  const audit = [...f.records.values()].find((value) => value.action === 'REGISTRATION_SECURITY_UPDATED');
  assert.deepEqual({
    actorUid: audit.actorUid,
    previousFaceVerificationEnabled: audit.previousFaceVerificationEnabled,
    newFaceVerificationEnabled: audit.newFaceVerificationEnabled,
    previousEmailOtpEnabled: audit.previousEmailOtpEnabled,
    newEmailOtpEnabled: audit.newEmailOtpEnabled,
    previousMaxAccountsPerDevice: audit.previousMaxAccountsPerDevice,
    newMaxAccountsPerDevice: audit.newMaxAccountsPerDevice,
    previousMaxAccountsPerIp: audit.previousMaxAccountsPerIp,
    newMaxAccountsPerIp: audit.newMaxAccountsPerIp,
  }, {
    actorUid: 'user-1',
    previousFaceVerificationEnabled: true,
    newFaceVerificationEnabled: true,
    previousEmailOtpEnabled: true,
    newEmailOtpEnabled: false,
    previousMaxAccountsPerDevice: 3,
    newMaxAccountsPerDevice: 5,
    previousMaxAccountsPerIp: 3,
    newMaxAccountsPerIp: 4,
  });
  assert.equal('adminUid' in audit, false);

  const missingClaim = adminFixture('admin');
  const missingClaimResponse = response();
  await missingClaim.handler({ method: 'PATCH', headers: { authorization: 'Bearer valid' }, body: {
    faceVerificationEnabled: true, emailOtpEnabled: true, maxAccountsPerDevice: 3, maxAccountsPerIp: 3,
  } }, missingClaimResponse);
  assert.equal(missingClaimResponse.statusCode, 403);

  const missingProfileRole = adminFixture('requester', { admin: true });
  const missingProfileRoleResponse = response();
  await missingProfileRole.handler({ method: 'PATCH', headers: { authorization: 'Bearer valid' }, body: {
    faceVerificationEnabled: true, emailOtpEnabled: true, maxAccountsPerDevice: 3, maxAccountsPerIp: 3,
  } }, missingProfileRoleResponse);
  assert.equal(missingProfileRoleResponse.statusCode, 403);
});

test('admin endpoint persists and audits both optional verification methods disabled', async () => {
  const f = adminFixture('admin', { admin: true });
  const res = response();
  await f.handler({ method: 'PATCH', headers: { authorization: 'Bearer valid' }, body: {
    faceVerificationEnabled: false,
    emailOtpEnabled: false,
    maxAccountsPerDevice: 3,
    maxAccountsPerIp: 3,
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(f.records.get('systemConfig/registrationSecurity').faceVerificationEnabled, false);
  assert.equal(f.records.get('systemConfig/registrationSecurity').emailOtpEnabled, false);
  assert.equal([...f.records.values()].some((value) => value.action === 'REGISTRATION_SECURITY_UPDATED'), true);
});

test('public registration policy exposes only the step requirements', async () => {
  const f = adminFixture('admin', { admin: true });
  f.records.set('systemConfig/registrationSecurity', {
    faceVerificationEnabled: false, emailOtpEnabled: true,
    maxAccountsPerDevice: 7, maxAccountsPerIp: 6, version: 4,
  });
  const res = response();
  await createRegistrationSessionHandler('policy', () => ({ db: {
    collection: (name) => ({ doc: (id) => ({ key: `${name}/${id}`, get: async function () {
      const value = f.records.get(this.key);
      return { exists: value !== undefined, data: () => value };
    } }) }),
  } }))({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { securityPolicy: {
    faceVerificationRequired: false, emailOtpRequired: true, policyVersion: 4,
  } });
});

test('Admin UI loads authoritative policy, updates from save response, and reverts a failed save', () => {
  const source = readFileSync(resolve(__dirname, '..', '..', '..', 'app', 'admin', 'registration-security.jsx'), 'utf8');
  assert.match(source, /useAdminData\(ADMIN_CACHE_KEYS\.security, getRegistrationSecurity\)/);
  assert.match(source, /setSavedSettings\(authoritative\)/);
  assert.match(source, /setDraftSettings\(authoritative\)/);
  assert.match(source, /await updateRegistrationSecurity\(next\)/);
  assert.match(source, /setDraftSettings\(savedSettings\)/);
  assert.match(source, /title="Security Settings"/);
  assert.match(source, /SESSION SECURITY/);
  assert.match(source, /Idle timeout/);
  assert.match(source, /Absolute session lifetime/);
});

test('shared session guard owns warning, idle, and absolute timers without affecting Admin', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const guard = readFileSync(resolve(root, 'components', 'SessionSecurityGuard.jsx'), 'utf8');
  const roleGate = readFileSync(resolve(root, 'components', 'RoleGate.jsx'), 'utf8');
  assert.match(guard, /WARNING_MS/);
  assert.match(guard, /idleTimeoutMinutes/);
  assert.match(guard, /absoluteSessionHours/);
  assert.match(guard, /signOutAndClearSessions\(\)/);
  assert.match(guard, /getRoleLoginPath\(role\)/);
  assert.match(guard, /\['requester', 'distributor', 'manager'\]\.includes\(role\)/);
  assert.match(roleGate, /SessionSecurityGuard/);
});

test('installation identity is persisted once and registration secrets remain server-only', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const installation = readFileSync(resolve(root, 'services', 'installationId.js'), 'utf8');
  const registrationClient = readFileSync(resolve(root, 'services', 'registrationSession.js'), 'utf8');
  const registrationHandler = readFileSync(resolve(root, 'backend', 'registration', 'registrationSessionHandler.js'), 'utf8');
  assert.match(installation, /AsyncStorage\.getItem\(INSTALLATION_ID_KEY\)/);
  assert.match(installation, /AsyncStorage\.setItem\(INSTALLATION_ID_KEY, created\)/);
  assert.match(installation, /installationIdPromise/);
  assert.match(registrationClient, /installationId: await getInstallationId\(\)/);
  assert.match(registrationHandler, /process\.env\.REGISTRATION_DEVICE_HASH_SECRET/);
  assert.match(registrationHandler, /process\.env\.REGISTRATION_IP_HASH_SECRET/);
  assert.doesNotMatch(registrationClient + installation, /REGISTRATION_(DEVICE|IP)_HASH_SECRET|EXPO_PUBLIC.*HASH_SECRET/);
});

test('production client IP comes from the trusted proxy chain, never request data', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.2' }, socket: { remoteAddress: '10.0.0.1' }, body: { ip: '198.51.100.9' } };
  assert.equal(getClientIp(req, { RENDER: 'true' }), '203.0.113.7');
  assert.equal(getClientIp(req, {}), '10.0.0.1');
});
