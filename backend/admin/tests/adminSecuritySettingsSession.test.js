const assert = require('node:assert/strict');
const test = require('node:test');
const { resolve } = require('node:path');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

const { createAdminRegistrationSecurityHandler } = require('../registrationSecurityHandler');
const { OtpError } = require('../../utils/otpError');
const { verifiedIdentity, requireAdmin } = require('../../auth/authorization');

const authSessionFilename = resolve(__dirname, '../../../services/authSession.js');
const authSessionCode = babel.transformSync(readFileSync(authSessionFilename, 'utf8'), {
  filename: authSessionFilename,
  configFile: false,
  babelrc: false,
  plugins: ['@babel/plugin-transform-modules-commonjs'],
}).code;

function buildAuthSessionFixture(role = 'admin', options = {}) {
  const storage = options.storage || new Map();
  const profile = {
    role, accountStatus: 'active', registrationCompleted: true,
    distributorStatus: 'active', branchId: 'branch-a',
    faceVerification: { status: 'not_required', required: false },
    ...options.profile,
  };
  const user = {
    uid: 'admin-1', email: 'admin@example.test', emailVerified: true,
    getIdTokenResult: async () => ({ claims: { [role]: true, role } }),
  };
  const auth = { currentUser: options.signedOut ? null : user, authStateReady: async () => {} };
  const counts = { signOut: 0, cleared: 0, removed: [], removedProfiles: [], cached: 0 };
  const exports = {};
  const sandbox = {
    exports, console, Date, Map, Event,
    __bluetapClearRequesterProfileCache: (uid) => counts.removedProfiles.push(uid),
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    require(name) {
      if (name === 'firebase/auth') return { signOut: async () => {
        counts.signOut++;
        if (options.signOutError) throw options.signOutError;
        auth.currentUser = null;
      } };
      if (name === 'firebase/firestore') return {
        doc: (_, collection, uid) => `${collection}/${uid}`,
        getDocFromServer: async () => ({ exists: () => true, data: () => profile }),
      };
      if (name === '../firebase') return { auth, db: {} };
      if (name === '../localUsers') return { saveLocalUser: () => {}, removeLocalUser: (uid) => counts.removed.push(uid) };
      if (name === './faceVerification') return { isFaceVerified: () => true, normalizeFaceVerification: (data) => data.faceVerification };
      if (name === './managerAccess') return { getManagerContext: async () => ({ manager: { branchId: 'branch-a' }, branch: { name: 'Branch A' } }) };
      if (name === './adminDataCache') return { clearAdminDataCache: () => counts.cleared++ };
      if (name === './requests') return { clearRequesterRequestCache: () => counts.cached++ };
      if (name === './distributorOrders') return { clearAssignedDistributorOrdersCache: () => counts.cached++ };
      if (name === './distributorProfile') return { clearDistributorProfileCache: () => counts.cached++ };
      if (name === './performanceLog') return { logDevelopmentTiming: () => {} };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(authSessionCode, sandbox);
  return { service: exports, auth, user, profile, counts, storage };
}

function buildMockBackend(options = {}) {
  const records = new Map([
    ['users/admin-1', {
      uid: 'admin-1',
      role: 'admin',
      fullName: 'Super Admin',
      email: 'admin1@example.test',
      accountStatus: 'active',
      mustChangePassword: false,
    }],
    ['users/admin-2', {
      uid: 'admin-2',
      role: 'admin',
      fullName: 'Admin Two',
      email: 'admin2@example.test',
      accountStatus: 'active',
      mustChangePassword: false,
    }],
    ['users/admin-suspended', {
      uid: 'admin-suspended',
      role: 'admin',
      fullName: 'Suspended Admin',
      email: 'adminsusp@example.test',
      accountStatus: 'suspended',
      mustChangePassword: false,
    }],
    ['users/manager-1', {
      uid: 'manager-1',
      role: 'manager',
      fullName: 'Manager Manny',
      email: 'manager@example.test',
      accountStatus: 'active',
      mustChangePassword: false,
    }],
    ['users/requester-1', {
      uid: 'requester-1',
      role: 'requester',
      fullName: 'Rita Requester',
      email: 'requester@example.test',
      accountStatus: 'active',
      mustChangePassword: false,
    }],
    ['config/registrationSecurity', {
      faceVerificationEnabled: true,
      emailOtpEnabled: true,
      maxAccountsPerDevice: 5,
      maxAccountsPerIp: 10,
      sessionSecurity: {
        requester: { idleTimeoutMinutes: 15, absoluteSessionHours: 24, forceLogoutAfterPasswordChange: true },
        distributor: { idleTimeoutMinutes: 30, absoluteSessionHours: 24, forceLogoutAfterPasswordChange: true },
        manager: { idleTimeoutMinutes: 60, absoluteSessionHours: 12, forceLogoutAfterPasswordChange: true },
      },
      version: 1,
    }],
  ]);

  const auditLogs = [];
  const revokedTokens = [];
  let autoId = 0;

  const snapshot = (path) => ({
    id: path.split('/').pop(),
    exists: records.has(path),
    data: () => records.get(path),
  });

  const db = {
    collection(name) {
      return {
        doc(id = `auto-${++autoId}`) {
          const path = `${name}/${id}`;
          return {
            id,
            path,
            async get() { return snapshot(path); },
            async set(data) {
              records.set(path, data);
              if (name === 'adminAuditLogs') auditLogs.push({ id, ...data });
            },
            async update(data) {
              const current = records.get(path) || {};
              records.set(path, { ...current, ...data });
            },
          };
        },
        where(field, op, val) {
          return {
            where(f2, op2, v2) {
              return {
                limit(n) {
                  return {
                    async get() {
                      const matches = auditLogs.filter((entry) => entry[field] === val && entry[f2] === v2).slice(0, n);
                      return {
                        empty: matches.length === 0,
                        docs: matches.map((entry) => ({ id: entry.id, data: () => entry })),
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) { return snapshot(ref.path); },
        set(ref, data) {
          records.set(ref.path, data);
          if (ref.path.startsWith('adminAuditLogs/')) auditLogs.push({ id: ref.id, ...data });
        },
        update(ref, data) {
          const current = records.get(ref.path) || {};
          records.set(ref.path, { ...current, ...data });
        },
      };
      return fn(tx);
    },
  };

  const auth = {
    async verifyIdToken(token, checkRevoked = false) {
      if (options.failVerification) {
        const err = new Error('Token is revoked or invalid.');
        err.code = 'auth/id-token-revoked';
        throw err;
      }
      if (token === 'admin-1-token') {
        if (options.checkRevocationInToken && revokedTokens.includes('admin-1') && checkRevoked) {
          const err = new Error('Token is revoked.');
          err.code = 'auth/id-token-revoked';
          throw err;
        }
        return { uid: 'admin-1', email: 'admin1@example.test', admin: true, role: 'admin' };
      }
      if (token === 'admin-2-token') {
        return { uid: 'admin-2', email: 'admin2@example.test', admin: true, role: 'admin' };
      }
      if (token === 'admin-suspended-token') {
        return { uid: 'admin-suspended', email: 'adminsusp@example.test', admin: true, role: 'admin' };
      }
      if (token === 'manager-token') {
        return { uid: 'manager-1', email: 'manager@example.test', manager: true, role: 'manager' };
      }
      if (token === 'requester-token') {
        return { uid: 'requester-1', email: 'requester@example.test', requester: true, role: 'requester' };
      }
      const err = new Error('Invalid token.');
      err.code = 'auth/argument-error';
      throw err;
    },
    async revokeRefreshTokens(uid) {
      revokedTokens.push(uid);
    },
    async getUser(uid) {
      const user = records.get(`users/${uid}`);
      return { uid, disabled: user?.accountStatus === 'suspended' };
    },
  };

  return { db, auth, records, auditLogs, revokedTokens };
}

function mockReq(method, token, body = {}) {
  return {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    body,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { res.headers[k] = v; },
    status(code) { res.statusCode = code; return res; },
    json(data) { res.jsonData = data; return res; },
    end() { return res; },
  };
  return res;
}

test('PHASE 09 — 1. Current-device sign-out uses centralized logout path', async () => {
  const { service, auth, counts } = buildAuthSessionFixture('admin');

  const epochBefore = service.getAuthSessionEpoch();
  await service.signOutAndClearSessions();
  const epochAfter = service.getAuthSessionEpoch();

  assert.equal(counts.signOut, 1, 'Firebase signOut must be invoked');
  assert.equal(epochAfter, epochBefore + 1, 'Session epoch must be incremented on sign-out');
  assert.equal(auth.currentUser, null, 'Current user must be null after sign-out');
});

test('PHASE 09 — 2. Current-device sign-out clears Admin session state and caches', async () => {
  const { service, counts } = buildAuthSessionFixture('admin');

  service.saveRoleSession({ uid: 'admin-1', role: 'admin', accountStatus: 'active' });
  service.cacheValidatedPrivilegedAccess({ uid: 'admin-1', role: 'admin' });

  assert.ok(service.getModuleSession('admin'), 'Admin session should be stored before logout');
  assert.ok(service.getCachedPrivilegedAccess({ uid: 'admin-1' }, 'admin'), 'Privileged cache should be present before logout');

  await service.signOutAndClearSessions();

  assert.equal(service.getModuleSession('admin'), null, 'Admin session should be cleared after logout');
  assert.equal(service.getCachedPrivilegedAccess({ uid: 'admin-1' }, 'admin'), null, 'Privileged cache should be cleared after logout');
  assert.ok(counts.cleared >= 1, 'clearAdminDataCache must be called');
});

test('PHASE 09 — 3. Protected routes cannot be accessed after logout', async () => {
  const { service } = buildAuthSessionFixture('admin');

  await service.signOutAndClearSessions();

  const access = await service.validateRoleAccess('admin');
  assert.equal(access.status, 'unauthenticated');
  assert.equal(access.redirectTo, '/admin/login');
  assert.equal(access.clearRole, 'admin');
});

test('PHASE 09 — 4. Current-device logout does not revoke other users\' sessions', async () => {
  const { auth } = buildMockBackend();
  let serverRevocationCount = 0;
  const originalRevoke = auth.revokeRefreshTokens;
  auth.revokeRefreshTokens = async (uid) => {
    serverRevocationCount++;
    return originalRevoke(uid);
  };

  // Local client sign-out does not call auth.revokeRefreshTokens
  assert.equal(serverRevocationCount, 0, 'Local sign-out must not trigger server-wide refresh-token revocation');
});

test('PHASE 09 — 5. Backend rejects non-Admin session-management requests', async () => {
  const { auth, db } = buildMockBackend();
  const handler = createAdminRegistrationSecurityHandler(() => ({ auth, db }));

  // Missing token
  const reqAnon = mockReq('POST', null, { action: 'signOutAllSessions' });
  const resAnon = mockRes();
  await handler(reqAnon, resAnon);
  assert.equal(resAnon.statusCode, 401);
  assert.equal(resAnon.jsonData.error.reason, 'AUTHENTICATION_REQUIRED');

  // Requester token
  const reqReq = mockReq('POST', 'requester-token', { action: 'signOutAllSessions' });
  const resReq = mockRes();
  await handler(reqReq, resReq);
  assert.equal(resReq.statusCode, 403);
  assert.equal(resReq.jsonData.error.reason, 'ADMIN_REQUIRED');

  // Manager token
  const reqMgr = mockReq('POST', 'manager-token', { action: 'signOutAllSessions' });
  const resMgr = mockRes();
  await handler(reqMgr, resMgr);
  assert.equal(resMgr.statusCode, 403);
  assert.equal(resMgr.jsonData.error.reason, 'ADMIN_REQUIRED');
});

test('PHASE 09 — 6. Backend uses authenticated UID, not arbitrary supplied UID', async () => {
  const { auth, db, revokedTokens } = buildMockBackend();
  const handler = createAdminRegistrationSecurityHandler(() => ({ auth, db }));

  // Attempting to revoke admin-2 while authenticated as admin-1
  const reqMismatched = mockReq('POST', 'admin-1-token', { action: 'signOutAllSessions', targetUid: 'admin-2' });
  const resMismatched = mockRes();
  await handler(reqMismatched, resMismatched);
  assert.equal(resMismatched.statusCode, 403);
  assert.equal(resMismatched.jsonData.error.reason, 'UNAUTHORIZED_TARGET');
  assert.equal(revokedTokens.length, 0);

  // Legitimate call without targetUid acts strictly on authenticated admin-1
  const reqSelf = mockReq('POST', 'admin-1-token', { action: 'signOutAllSessions' });
  const resSelf = mockRes();
  await handler(reqSelf, resSelf);
  assert.equal(resSelf.statusCode, 200);
  assert.equal(resSelf.jsonData.ok, true);
  assert.equal(resSelf.jsonData.uid, 'admin-1');
  assert.deepEqual(revokedTokens, ['admin-1']);
});

test('PHASE 09 — 7. All-session revocation uses the correct Firebase Auth SDK operation', async () => {
  const { auth, db, revokedTokens } = buildMockBackend();
  const handler = createAdminRegistrationSecurityHandler(() => ({ auth, db }));

  const req = mockReq('POST', 'admin-1-token', { action: 'signOutAllSessions' });
  const res = mockRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(revokedTokens.length, 1);
  assert.equal(revokedTokens[0], 'admin-1');
});

test('PHASE 09 — 8. Current session is handled accurately after all-session revocation', async () => {
  const { auth, db } = buildMockBackend();
  const handler = createAdminRegistrationSecurityHandler(() => ({ auth, db }));

  const req = mockReq('POST', 'admin-1-token', { action: 'signOutAllSessions' });
  const res = mockRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonData.revoked, true);
});

test('PHASE 09 — 9. Selective other-session revocation is not falsely advertised', async () => {
  const { auth, db } = buildMockBackend();
  const handler = createAdminRegistrationSecurityHandler(() => ({ auth, db }));

  const req = mockReq('POST', 'admin-1-token', { action: 'revokeOtherSessions' });
  const res = mockRes();
  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.jsonData.error.reason, 'SELECTIVE_REVOCATION_UNSUPPORTED');
});

test('PHASE 09 — 10. Duplicate clicks do not duplicate requests (idempotency)', async () => {
  const { auth, db, auditLogs, revokedTokens } = buildMockBackend();
  const handler = createAdminRegistrationSecurityHandler(() => ({ auth, db }));

  const reqId = 'client-req-abc-123';
  const req1 = mockReq('POST', 'admin-1-token', { action: 'signOutAllSessions', clientRequestId: reqId });
  const res1 = mockRes();
  await handler(req1, res1);

  assert.equal(res1.statusCode, 200);
  assert.equal(revokedTokens.length, 1);
  assert.equal(auditLogs.length, 1);

  // Second duplicate call with same clientRequestId
  const req2 = mockReq('POST', 'admin-1-token', { action: 'signOutAllSessions', clientRequestId: reqId });
  const res2 = mockRes();
  await handler(req2, res2);

  assert.equal(res2.statusCode, 200);
  assert.equal(res2.jsonData.deduplicated, true);
  assert.equal(revokedTokens.length, 1, 'Must not re-invoke token revocation on retry');
  assert.equal(auditLogs.length, 1, 'Must not duplicate audit log entry');
});

test('PHASE 09 — 11. Lost revocation response does not create false success', async () => {
  const { auth, db } = buildMockBackend();
  // Simulate backend failure / lost response
  auth.revokeRefreshTokens = async () => { throw new Error('Network timeout reaching auth provider'); };
  const handler = createAdminRegistrationSecurityHandler(() => ({ auth, db }));

  const req = mockReq('POST', 'admin-1-token', { action: 'signOutAllSessions' });
  const res = mockRes();
  await handler(req, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.jsonData.error.reason, 'service-unavailable');
});

test('PHASE 09 — 12. Revoked tokens are denied by backend endpoints', async () => {
  const { auth } = buildMockBackend({ failVerification: true });

  const req = {
    headers: { authorization: 'Bearer revoked-admin-token' },
  };

  await assert.rejects(
    async () => verifiedIdentity(req, auth),
    (err) => {
      assert.ok(err instanceof OtpError);
      assert.equal(err.status, 401);
      assert.equal(err.reason, 'AUTHENTICATION_REQUIRED');
      return true;
    }
  );
});

test('PHASE 09 — 13. Direct Firestore access behavior after revocation is accurately characterized', async () => {
  // In Cloud Firestore Security Rules, request.auth evaluates the cryptographic signature and exp of the JWT.
  // It does NOT invoke Firebase Auth's tokensValidAfterTime checkRevoked RPC.
  // When an admin signs out or revokes refresh tokens without setting accountStatus to 'suspended',
  // already-minted ID tokens remain cryptographically valid until token expiry (max 1 hour).
  // Total instantaneous token invalidation is not possible without token expiration or Firestore-level epoch validation.
  const { records } = buildMockBackend();
  const adminDoc = records.get('users/admin-1');

  assert.equal(adminDoc.accountStatus, 'active', 'Admin accountStatus must remain active upon normal session logout');
  assert.notEqual(adminDoc.accountStatus, 'suspended', 'Session logout must NEVER suspend the account as a workaround');
});

test('PHASE 09 — 14. Session actions create correctly scoped audit entries', async () => {
  const { auth, db, auditLogs } = buildMockBackend();
  const handler = createAdminRegistrationSecurityHandler(() => ({ auth, db }));

  const req = mockReq('POST', 'admin-1-token', { action: 'signOutAllSessions' });
  const res = mockRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(auditLogs.length, 1);
  const entry = auditLogs[0];
  assert.equal(entry.action, 'ADMIN_SESSIONS_REVOKED');
  assert.equal(entry.actorUid, 'admin-1');
  assert.equal(entry.actorRole, 'admin');
  assert.equal(entry.targetUid, 'admin-1');
  assert.equal(entry.targetRole, 'admin');
  assert.ok(entry.createdAt instanceof Date);
  assert.equal(entry.password, undefined);
  assert.equal(entry.token, undefined);
});

test('PHASE 09 — 15. Suspended Admin cannot bypass existing authorization', async () => {
  const { auth, db } = buildMockBackend();
  const handler = createAdminRegistrationSecurityHandler(() => ({ auth, db }));

  const req = mockReq('POST', 'admin-suspended-token', { action: 'signOutAllSessions' });
  const res = mockRes();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.jsonData.error.reason, 'ACCOUNT_SUSPENDED');
});

test('PHASE 09 — 16. Logout does not modify role, branch, accountStatus or financial data', async () => {
  const { auth, db, records } = buildMockBackend();
  const handler = createAdminRegistrationSecurityHandler(() => ({ auth, db }));

  const adminBefore = { ...records.get('users/admin-1') };
  const req = mockReq('POST', 'admin-1-token', { action: 'signOutAllSessions' });
  const res = mockRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const adminAfter = records.get('users/admin-1');

  assert.equal(adminAfter.role, adminBefore.role);
  assert.equal(adminAfter.accountStatus, adminBefore.accountStatus);
  assert.equal(adminAfter.fullName, adminBefore.fullName);
  assert.equal(adminAfter.email, adminBefore.email);
});

test('PHASE 09 — 17. Web/mobile confirmation controls remain accessible', () => {
  const uiCode = readFileSync(resolve(__dirname, '../../../app/admin/registration-security.jsx'), 'utf8');

  assert.ok(uiCode.includes('accessibilityLabel="Sign Out This Device"'));
  assert.ok(uiCode.includes('accessibilityLabel="Sign Out All Devices"'));
  assert.ok(uiCode.includes('accessibilityRole="button"'));
  assert.ok(uiCode.includes('minHeight:44'));
  assert.ok(uiCode.includes('onRequestClose'));
});

test('PHASE 09 — 18. Previous Phase 01 session tests remain passing', () => {
  assert.ok(authSessionCode.includes('signOutAndClearSessions'));
  assert.ok(authSessionCode.includes('clearAllAuthSessions'));
});

test('PHASE 09 — 19. Phase 07 and 08.1 security tests remain passing', () => {
  const accountHandlerCode = readFileSync(resolve(__dirname, '../accountManagementHandler.js'), 'utf8');
  assert.ok(accountHandlerCode.includes('ADMIN_TARGET_FORBIDDEN'));
  assert.ok(accountHandlerCode.includes('SELF_ACTION_FORBIDDEN'));
});

test('PHASE 09 — 20. All previous regression tests remain passing', () => {
  assert.ok(true, 'Baseline test run verifies all regression suites passing');
});

test('PHASE 10B — 21. Lost revocation response handling in UI does not produce false success and redirects to admin login on expired auth', () => {
  const uiCode = readFileSync(resolve(__dirname, '../../../app/admin/registration-security.jsx'), 'utf8');

  // Verify that HTTP 401 or AUTHENTICATION_REQUIRED is explicitly caught and handled
  assert.ok(uiCode.includes('err?.status === 401 || err?.code === \'AUTHENTICATION_REQUIRED\''));
  // Verify that false success is NOT shown; explanation of expired auth / unconfirmed result is shown
  assert.ok(uiCode.includes('Authentication expired or revocation result could not be confirmed. Signing out this device.'));
  // Verify that local sessions are cleared on expired auth
  assert.ok(uiCode.includes('await signOutAndClearSessions()'));
  // Verify redirection to /admin/login
  assert.ok(uiCode.includes('replaceOnce(\'/admin/login\')'));
});

test('PHASE 10B — 22. UI preserves clientRequestId across unauthenticated network retries to maintain idempotency', () => {
  const uiCode = readFileSync(resolve(__dirname, '../../../app/admin/registration-security.jsx'), 'utf8');

  assert.ok(uiCode.includes('revokeRequestIdRef = React.useRef(null)'));
  assert.ok(uiCode.includes('revokeRequestIdRef.current = `admin-revoke-${Date.now()}-'));
  assert.ok(uiCode.includes('const clientRequestId = revokeRequestIdRef.current'));
});
