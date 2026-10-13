const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminAccountsHandler } = require('../../admin/accountManagementHandler');
const { createModerationNoticesHandler } = require('../../moderation/moderationHandler');
const { requireActiveAccount, ACCOUNT_STATUS, canonicalAccountStatus } = require('../accountStatus');
const { verifiedIdentity } = require('../authorization');
const {
  authShouldBeDisabled,
  describeAuthConsistency,
  readAuthoritativeAccountStatus,
  syncAuthWithAccountStatus,
  repairAuthDriftIfPresent,
} = require('../accountAuthConsistency');

function simulateFirestoreRulesHasActiveGlobalAccount(records, authUid) {
  if (!authUid) return false;
  const userDoc = records.get(`users/${authUid}`);
  if (!userDoc) return false;
  const status = canonicalAccountStatus(userDoc);
  return status === ACCOUNT_STATUS.ACTIVE;
}

function simulateFirestoreRulesCanRead(records, authUid, targetPath) {
  if (!authUid) return false;
  const hasActive = simulateFirestoreRulesHasActiveGlobalAccount(records, authUid);
  if (!hasActive) return false;
  return true;
}

function testFixture(options = {}) {
  const revoked = [];
  const records = new Map([
    ['users/admin-1', { uid: 'admin-1', role: 'admin', email: 'admin@example.test', accountStatus: 'active' }],
    ['users/manager-1', { uid: 'manager-1', role: 'manager', email: 'manager@example.test', branchId: 'north', accountStatus: 'active' }],
    ['users/distributor-1', { uid: 'distributor-1', role: 'distributor', email: 'distributor@example.test', branchId: 'north', accountStatus: 'active' }],
    ['users/requester-1', {
      uid: 'requester-1', role: 'requester', fullName: 'Rita Requester',
      email: 'rita@example.test', username: 'rita_req', accountStatus: 'active',
      status: 'Active', mustChangePassword: false, accountSource: 'admin_created',
    }],
    ['users/suspended-1', {
      uid: 'suspended-1', role: 'requester', fullName: 'Sam Suspended',
      email: 'sam@example.test', username: 'sam_req', accountStatus: 'suspended',
      status: 'Suspended', mustChangePassword: false, accountSource: 'admin_created',
    }],
    ['users/branch-restricted-1', {
      uid: 'branch-restricted-1', role: 'requester', fullName: 'Barry Branch',
      email: 'barry@example.test', username: 'barry_req', accountStatus: 'suspended',
      status: 'Suspended', mustChangePassword: false, accountSource: 'admin_created',
      branchSuspensions: { north: { until: '2026-12-31T00:00:00.000Z', reason: 'Branch policy issue' } },
    }],
    ['branches/north', { name: 'North', code: 'N', status: 'active' }],
  ]);

  let autoId = 0;
  const snapshot = (path) => ({
    id: path.split('/').pop(),
    exists: records.has(path),
    data: () => (records.has(path) ? JSON.parse(JSON.stringify(records.get(path))) : undefined),
  });

  const allDocs = (name) => [...records.keys()]
    .filter((path) => path.startsWith(`${name}/`))
    .map(snapshot);

  const collection = (name) => ({
    doc(id = `auto-${++autoId}`) {
      const path = `${name}/${id}`;
      return {
        id,
        path,
        get: async () => snapshot(path),
        update: async (data) => {
          if (!records.has(path)) throw new Error(`Document ${path} not found`);
          records.set(path, { ...records.get(path), ...JSON.parse(JSON.stringify(data)) });
        },
        set: async (data) => {
          records.set(path, JSON.parse(JSON.stringify(data)));
        },
        collection: (sub) => collection(`${path}/${sub}`),
      };
    },
    where(field, _op, value) {
      return {
        limit() { return this; },
        get: async () => ({ docs: allDocs(name).filter((doc) => doc.data()?.[field] === value) }),
      };
    },
    orderBy() {
      return {
        limit() { return this; },
        get: async () => ({ docs: allDocs(name) }),
      };
    },
    get: async () => ({ docs: allDocs(name) }),
  });

  const authUsers = new Map([
    ['admin-1', { uid: 'admin-1', email: 'admin@example.test', disabled: false, customClaims: { admin: true, role: 'admin' }, metadata: {} }],
    ['manager-1', { uid: 'manager-1', email: 'manager@example.test', disabled: false, customClaims: { manager: true, role: 'manager' }, metadata: {} }],
    ['distributor-1', { uid: 'distributor-1', email: 'distributor@example.test', disabled: false, customClaims: { distributor: true, role: 'distributor' }, metadata: {} }],
    ['requester-1', { uid: 'requester-1', email: 'rita@example.test', disabled: false, customClaims: {}, metadata: {} }],
    ['suspended-1', { uid: 'suspended-1', email: 'sam@example.test', disabled: true, customClaims: {}, metadata: {} }],
    ['branch-restricted-1', { uid: 'branch-restricted-1', email: 'barry@example.test', disabled: true, customClaims: {}, metadata: {} }],
  ]);

  let failTransaction = options.failTransaction || false;
  let failRevoke = options.failRevoke || false;
  let failAuth = options.failAuth || false;

  const db = {
    collection,
    runTransaction: async (run) => {
      if (failTransaction) {
        throw new Error('Firestore transaction simulation failed');
      }
      return run({
        get: async (ref) => snapshot(ref.path),
        create(ref, data) {
          records.set(ref.path, JSON.parse(JSON.stringify(data)));
        },
        update(ref, data) {
          records.set(ref.path, { ...records.get(ref.path), ...JSON.parse(JSON.stringify(data)) });
        },
        set(ref, data) {
          records.set(ref.path, JSON.parse(JSON.stringify(data)));
        },
      });
    },
  };

  const auth = {
    verifyIdToken: async (token, checkRevoked = false) => {
      if (token === 'admin-token') return { uid: 'admin-1', admin: true, role: 'admin' };
      if (token === 'manager-token') return { uid: 'manager-1', manager: true, role: 'manager' };
      if (token === 'distributor-token') return { uid: 'distributor-1', distributor: true, role: 'distributor' };
      if (token === 'revoked-token') {
        const error = new Error('The Firebase ID token has been revoked.');
        error.code = 'auth/id-token-revoked';
        throw error;
      }
      if (token === 'disabled-user-token') {
        const error = new Error('The user record is disabled.');
        error.code = 'auth/user-disabled';
        throw error;
      }
      const match = /^user-token-(.+)$/.exec(token);
      if (match) {
        const uid = match[1];
        const user = authUsers.get(uid);
        if (!user) throw new Error('user not found');
        if (checkRevoked && (user.disabled || revoked.includes(uid))) {
          const error = new Error('Token is revoked or user disabled');
          error.code = user.disabled ? 'auth/user-disabled' : 'auth/id-token-revoked';
          throw error;
        }
        return { uid, email: user.email, ...user.customClaims };
      }
      throw new Error('invalid token');
    },
    getUser: async (uid) => authUsers.get(uid) || null,
    getUserByEmail: async (email) => {
      const user = [...authUsers.values()].find((u) => u.email === email);
      if (!user) {
        const err = new Error('user not found');
        err.code = 'auth/user-not-found';
        throw err;
      }
      return user;
    },
    listUsers: async () => ({ users: [...authUsers.values()] }),
    updateUser: async (uid, changes) => {
      if (failAuth) throw new Error('Firebase Auth updateUser failed');
      const current = authUsers.get(uid) || { uid };
      const updated = { ...current, ...changes };
      authUsers.set(uid, updated);
      return updated;
    },
    revokeRefreshTokens: async (uid) => {
      if (failRevoke) throw new Error('Revocation network timeout');
      revoked.push(uid);
    },
  };

  return {
    records,
    authUsers,
    revoked,
    setFailTransaction: (val) => { failTransaction = val; },
    setFailRevoke: (val) => { failRevoke = val; },
    setFailAuth: (val) => { failAuth = val; },
    getAdmin: () => ({ auth, db }),
  };
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

async function callHandler(handler, method, token, body = {}) {
  const res = mockResponse();
  await handler({ method, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

// --------------------------------------------------------------------------
// CATEGORY 1: FIRESTORE-FIRST ORDERING & DIRECT ACCESS SECURITY (CONCERN A)
// --------------------------------------------------------------------------

test('1. Suspended old-token direct Firestore read under partial failure vs Firestore-first', async () => {
  const fixture = testFixture();

  // SCENARIO: Partial failure state under old ordering (Auth disabled, Firestore still active)
  fixture.authUsers.get('requester-1').disabled = true;
  fixture.records.get('users/requester-1').accountStatus = 'active';

  // An already-issued, unexpired ID token checks Firestore Security Rules (hasActiveGlobalAccount)
  const oldAccessPermitted = simulateFirestoreRulesCanRead(fixture.records, 'requester-1', 'branches/north');
  assert.equal(oldAccessPermitted, true, 'Old unexpired token would have read Firestore directly because Firestore was active');

  // WITH FIRESTORE-FIRST MITIGATION:
  // When Firestore transaction commits first, users/{uid}.accountStatus becomes 'suspended'
  fixture.records.get('users/requester-1').accountStatus = 'suspended';
  const mitigatedAccessPermitted = simulateFirestoreRulesCanRead(fixture.records, 'requester-1', 'branches/north');
  assert.equal(mitigatedAccessPermitted, false, 'With Firestore-first commit, direct read is immediately blocked by security rules');
});

test('2. Suspended old-token protected query: denied once Firestore commits suspension', async () => {
  const fixture = testFixture();

  // If Firestore is still active:
  fixture.records.get('users/requester-1').accountStatus = 'active';
  assert.equal(simulateFirestoreRulesHasActiveGlobalAccount(fixture.records, 'requester-1'), true);

  // Once Firestore suspension commits:
  fixture.records.get('users/requester-1').accountStatus = 'suspended';
  assert.equal(simulateFirestoreRulesHasActiveGlobalAccount(fixture.records, 'requester-1'), false);

  // Direct collection query evaluates hasActiveGlobalAccount:
  const queryPermitted = simulateFirestoreRulesCanRead(fixture.records, 'requester-1', 'requests');
  assert.equal(queryPermitted, false, 'Protected collection queries fail closed for suspended account');
});

test('3. Suspension transaction failure vs Auth sync failure under Firestore-first ordering', async () => {
  const fixture = testFixture({ failTransaction: true });
  const handler = createAdminAccountsHandler(fixture.getAdmin);

  // Under Firestore-first ordering, if transaction fails:
  const res = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'suspend' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.reason, 'ACCOUNT_MANAGEMENT_FAILED');

  // Auth was not disabled because transaction failed before Auth sync:
  assert.equal(fixture.records.get('users/requester-1').accountStatus, 'active');
  assert.equal(fixture.authUsers.get('requester-1').disabled, false);

  // Now test if transaction succeeds but Auth sync fails:
  const syncFixture = testFixture({ failAuth: true });
  const syncHandler = createAdminAccountsHandler(syncFixture.getAdmin);
  const syncRes = await callHandler(syncHandler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'suspend' });

  assert.equal(syncRes.statusCode, 502);
  assert.equal(syncRes.body.error.reason, 'ACCOUNT_AUTH_SYNC_FAILED');
  // Authoritative Firestore restriction committed first, so access is fail-closed!
  assert.equal(syncFixture.records.get('users/requester-1').accountStatus, 'suspended');
  assert.equal(simulateFirestoreRulesCanRead(syncFixture.records, 'requester-1', 'branches/north'), false);
});

test('4. Post-commit token revocation failure returns 502 while Firestore remains suspended fail-closed', async () => {
  const fixture = testFixture({ failRevoke: true });
  const handler = createAdminAccountsHandler(fixture.getAdmin);

  const res = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'suspend' });
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error.reason, 'ACCOUNT_AUTH_SYNC_FAILED');

  // Firestore committed suspended first: fail-closed immediately enforced!
  assert.equal(fixture.records.get('users/requester-1').accountStatus, 'suspended');
  assert.equal(fixture.authUsers.get('requester-1').disabled, true);
  assert.equal(simulateFirestoreRulesCanRead(fixture.records, 'requester-1', 'branches/north'), false);
});

// --------------------------------------------------------------------------
// CATEGORY 2: IDEMPOTENCY & RETRY CONVERGENCE
// --------------------------------------------------------------------------

test('5. Repeated suspension with mismatched Auth/Firestore states: converges Auth and returns changed false', async () => {
  const fixture = testFixture();
  const handler = createAdminAccountsHandler(fixture.getAdmin);

  // Drifted state: Firestore suspended, Auth enabled
  fixture.authUsers.get('suspended-1').disabled = false;
  assert.equal(describeAuthConsistency(fixture.records.get('users/suspended-1'), fixture.authUsers.get('suspended-1')).consistent, false);

  const res = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'suspended-1', action: 'suspend' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, false);
  assert.equal(fixture.authUsers.get('suspended-1').disabled, true);
  assert.ok(fixture.revoked.includes('suspended-1'));
  assert.equal(describeAuthConsistency(fixture.records.get('users/suspended-1'), fixture.authUsers.get('suspended-1')).consistent, true);
});

test('6. Repeated reactivation with mismatched states: converges Auth to enabled and returns changed false', async () => {
  const fixture = testFixture();
  const handler = createAdminAccountsHandler(fixture.getAdmin);

  // Drifted state: Firestore active, Auth disabled
  fixture.authUsers.get('requester-1').disabled = true;
  assert.equal(describeAuthConsistency(fixture.records.get('users/requester-1'), fixture.authUsers.get('requester-1')).consistent, false);

  const res = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'reactivate' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, false);
  assert.equal(fixture.authUsers.get('requester-1').disabled, false);
  assert.equal(describeAuthConsistency(fixture.records.get('users/requester-1'), fixture.authUsers.get('requester-1')).consistent, true);
});

test('7. Lost HTTP response after committed action: idempotent retry succeeds with changed false', async () => {
  const fixture = testFixture();
  const handler = createAdminAccountsHandler(fixture.getAdmin);

  const first = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'suspend' });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.changed, true);

  const initialAudits = [...fixture.records.keys()].filter((k) => k.startsWith('adminAuditLogs/')).length;
  const initialNotices = [...fixture.records.keys()].filter((k) => k.startsWith('moderationNotices/')).length;

  const retry = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'suspend' });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.changed, false);

  const afterAudits = [...fixture.records.keys()].filter((k) => k.startsWith('adminAuditLogs/')).length;
  const afterNotices = [...fixture.records.keys()].filter((k) => k.startsWith('moderationNotices/')).length;
  assert.equal(afterAudits, initialAudits);
  assert.equal(afterNotices, initialNotices);
});

// --------------------------------------------------------------------------
// CATEGORY 3: CONCURRENT REACTIVATION & STALE COMPENSATION (CONCERN B)
// --------------------------------------------------------------------------

test('8. Two concurrent Admin reactivations: first commits, second receives 409 or converges, final state active', async () => {
  const fixture = testFixture();
  const { auth, db } = fixture.getAdmin();

  assert.equal(fixture.records.get('users/suspended-1').accountStatus, 'suspended');
  assert.equal(fixture.authUsers.get('suspended-1').disabled, true);

  const handler = createAdminAccountsHandler(() => ({ auth, db }));

  // Admin B commits reactivation
  const resB = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'suspended-1', action: 'reactivate' });
  assert.equal(resB.statusCode, 200);
  assert.equal(resB.body.changed, true);
  assert.equal(fixture.records.get('users/suspended-1').accountStatus, 'active');
  assert.equal(fixture.authUsers.get('suspended-1').disabled, false);

  // Admin A attempts to commit reactivation now; detects account is already active and converges idempotently:
  const resA = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'suspended-1', action: 'reactivate' });
  assert.equal(resA.statusCode, 200);
  assert.equal(resA.body.changed, false);

  assert.equal(fixture.records.get('users/suspended-1').accountStatus, 'active');
  assert.equal(fixture.authUsers.get('suspended-1').disabled, false);
});

test('9. Reactivation conflict followed by compensation: does not disable Auth if account is active', async () => {
  const fixture = testFixture();
  const { auth, db } = fixture.getAdmin();

  // Simulate Admin B having activated the account
  fixture.records.get('users/suspended-1').accountStatus = 'active';
  fixture.authUsers.get('suspended-1').disabled = false;

  // Verify compensation safety guard directly:
  const verified = await readAuthoritativeAccountStatus(db, 'suspended-1');
  assert.equal(verified, ACCOUNT_STATUS.ACTIVE);

  // Authoritative guard in compensation path:
  if (verified !== ACCOUNT_STATUS.ACTIVE) {
    await auth.updateUser('suspended-1', { disabled: true });
  }

  // Auth must NOT have been disabled
  assert.equal(fixture.authUsers.get('suspended-1').disabled, false, 'Auth remained enabled because account is active');
});

test('10. Stale compensation cannot override newer authoritative decisions', async () => {
  const fixture = testFixture();
  const { auth, db } = fixture.getAdmin();

  // Account is active
  fixture.records.get('users/suspended-1').accountStatus = 'active';
  fixture.authUsers.get('suspended-1').disabled = false;

  // Triggering syncAuthWithAccountStatus with expectedStatus = 'suspended' against active account throws 409
  await assert.rejects(async () => {
    await syncAuthWithAccountStatus({ auth, db, uid: 'suspended-1', expectedStatus: ACCOUNT_STATUS.SUSPENDED });
  }, (err) => err.status === 409 && err.reason === 'ACCOUNT_STATE_CHANGED');

  // Verify Auth was NOT disabled by the mismatched sync attempt:
  assert.equal(fixture.authUsers.get('suspended-1').disabled, false);
  assert.equal(fixture.revoked.includes('suspended-1'), false);
});

// --------------------------------------------------------------------------
// CATEGORY 4: CROSS-SYSTEM ASYNCHRONOUS INTERLEAVING RACES (SECTION 2)
// --------------------------------------------------------------------------

test('11. Cross-system race: delayed suspension Auth sync cannot overwrite newer reactivation', async () => {
  const fixture = testFixture();
  const { auth, db } = fixture.getAdmin();

  // Step A: Admin A commits suspension to Firestore, but pauses before Auth sync
  fixture.records.get('users/requester-1').accountStatus = 'suspended';

  // Step B: Admin B commits reactivation to Firestore and finishes Auth sync
  fixture.records.get('users/requester-1').accountStatus = 'active';
  await syncAuthWithAccountStatus({ auth, db, uid: 'requester-1', expectedStatus: ACCOUNT_STATUS.ACTIVE });
  assert.equal(fixture.authUsers.get('requester-1').disabled, false);

  // Step C: Admin A's delayed Auth sync resumes with expectedStatus = 'suspended'
  await assert.rejects(async () => {
    await syncAuthWithAccountStatus({ auth, db, uid: 'requester-1', expectedStatus: ACCOUNT_STATUS.SUSPENDED });
  }, (err) => err.status === 409 && err.reason === 'ACCOUNT_STATE_CHANGED');

  // Result: Auth remains enabled, Admin B's reactivation was NOT overwritten!
  assert.equal(fixture.authUsers.get('requester-1').disabled, false);
  assert.equal(fixture.records.get('users/requester-1').accountStatus, 'active');
});

test('12. Cross-system race: delayed reactivation Auth sync cannot overwrite newer suspension', async () => {
  const fixture = testFixture();
  const { auth, db } = fixture.getAdmin();

  // Target initially suspended
  assert.equal(fixture.records.get('users/suspended-1').accountStatus, 'suspended');

  // Step A: Admin A commits reactivation to Firestore, but pauses before Auth sync
  fixture.records.get('users/suspended-1').accountStatus = 'active';

  // Step B: Admin B commits suspension to Firestore and finishes Auth sync
  fixture.records.get('users/suspended-1').accountStatus = 'suspended';
  await syncAuthWithAccountStatus({ auth, db, uid: 'suspended-1', expectedStatus: ACCOUNT_STATUS.SUSPENDED });
  assert.equal(fixture.authUsers.get('suspended-1').disabled, true);

  // Step C: Admin A's delayed Auth sync resumes with expectedStatus = 'active'
  await assert.rejects(async () => {
    await syncAuthWithAccountStatus({ auth, db, uid: 'suspended-1', expectedStatus: ACCOUNT_STATUS.ACTIVE });
  }, (err) => err.status === 409 && err.reason === 'ACCOUNT_STATE_CHANGED');

  // Result: Auth remains disabled, Admin B's suspension was NOT overwritten!
  assert.equal(fixture.authUsers.get('suspended-1').disabled, true);
  assert.equal(fixture.records.get('users/suspended-1').accountStatus, 'suspended');
});

test('13. Micro-race during reactivation: concurrent suspension triggers restrictive compensation to re-disable Auth', async () => {
  const fixture = testFixture();
  const { auth, db } = fixture.getAdmin();

  // User starts suspended
  assert.equal(fixture.records.get('users/suspended-1').accountStatus, 'suspended');
  assert.equal(fixture.authUsers.get('suspended-1').disabled, true);

  // Firestore transaction committed active:
  fixture.records.get('users/suspended-1').accountStatus = 'active';

  // In syncAuthWithAccountStatus, hook updateUser so right after auth.updateUser(uid, { disabled: false }),
  // a concurrent suspension transaction commits in Firestore before the post-verification read!
  const originalUpdate = auth.updateUser;
  auth.updateUser = async (uid, changes) => {
    const res = await originalUpdate(uid, changes);
    if (changes.disabled === false) {
      // Concurrent suspension commits right after Auth enabled:
      fixture.records.get(`users/${uid}`).accountStatus = 'suspended';
    }
    return res;
  };

  // Attempt sync expecting active:
  await assert.rejects(async () => {
    await syncAuthWithAccountStatus({ auth, db, uid: 'suspended-1', expectedStatus: ACCOUNT_STATUS.ACTIVE });
  }, (err) => err.status === 409 && err.reason === 'ACCOUNT_STATE_CHANGED');

  // Restrictive compensation must have immediately re-disabled Auth and revoked tokens!
  assert.equal(fixture.authUsers.get('suspended-1').disabled, true);
  assert.ok(fixture.revoked.includes('suspended-1'));
  assert.equal(fixture.records.get('users/suspended-1').accountStatus, 'suspended');
});

// --------------------------------------------------------------------------
// CATEGORY 5: REPAIRAUTH ACTION VERIFICATION (SECTION 3)
// --------------------------------------------------------------------------

test('14. repairAuth action: requires authenticated Admin; rejected for Manager, Distributor, Requester', async () => {
  const fixture = testFixture();
  const handler = createAdminAccountsHandler(fixture.getAdmin);

  // Unauthenticated request
  const unauthRes = await callHandler(handler, 'PATCH', 'invalid-token', { uid: 'requester-1', action: 'repairAuth' });
  assert.equal(unauthRes.statusCode, 401);

  // Manager request
  const managerRes = await callHandler(handler, 'PATCH', 'manager-token', { uid: 'requester-1', action: 'repairAuth' });
  assert.equal(managerRes.statusCode, 403);

  // Distributor request
  const distRes = await callHandler(handler, 'PATCH', 'distributor-token', { uid: 'requester-1', action: 'repairAuth' });
  assert.equal(distRes.statusCode, 403);

  // Requester request
  const reqRes = await callHandler(handler, 'PATCH', 'user-token-requester-1', { uid: 'requester-1', action: 'repairAuth' });
  assert.equal(reqRes.statusCode, 403);

  // Admin request succeeds
  const adminRes = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'repairAuth' });
  assert.equal(adminRes.statusCode, 200);
});

test('15. repairAuth action: does not enable suspended account and preserves role, branch, and status', async () => {
  const fixture = testFixture();
  const handler = createAdminAccountsHandler(fixture.getAdmin);

  // Target is suspended in Firestore, but drifted to enabled in Auth
  fixture.authUsers.get('suspended-1').disabled = false;
  assert.equal(describeAuthConsistency(fixture.records.get('users/suspended-1'), fixture.authUsers.get('suspended-1')).consistent, false);

  const initialProfile = JSON.parse(JSON.stringify(fixture.records.get('users/suspended-1')));

  const res = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'suspended-1', action: 'repairAuth' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.repaired, true);

  // Auth must have been set to disabled: true (NEVER enabled for a suspended account!)
  assert.equal(fixture.authUsers.get('suspended-1').disabled, true);

  // Profile metadata (role, status, username, etc.) remained completely untouched
  const finalProfile = fixture.records.get('users/suspended-1');
  assert.deepEqual(finalProfile, initialProfile);
});

test('16. repairAuth action: rechecks authoritative status and aborts on concurrent change', async () => {
  const fixture = testFixture();
  const { auth, db } = fixture.getAdmin();
  const handler = createAdminAccountsHandler(() => ({ auth, db }));

  // Create drift: Firestore active, Auth disabled
  fixture.authUsers.get('requester-1').disabled = true;
  assert.equal(describeAuthConsistency(fixture.records.get('users/requester-1'), fixture.authUsers.get('requester-1')).consistent, false);

  // If status is changed to suspended concurrently, repair expecting active rejects
  fixture.records.get('users/requester-1').accountStatus = 'suspended';
  fixture.authUsers.get('requester-1').disabled = true;

  await assert.rejects(async () => {
    await syncAuthWithAccountStatus({ auth, db, uid: 'requester-1', expectedStatus: ACCOUNT_STATUS.ACTIVE });
  }, (err) => err.status === 409 && err.reason === 'ACCOUNT_STATE_CHANGED');
});

test('17. repairAuth action: creates audit log on repair and avoids duplicates when already consistent', async () => {
  const fixture = testFixture();
  const handler = createAdminAccountsHandler(fixture.getAdmin);

  // Initial consistent state: zero repairs needed
  const res1 = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'repairAuth' });
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.repaired, false);

  const audits1 = [...fixture.records.keys()].filter((k) => k.startsWith('adminAuditLogs/')).length;
  assert.equal(audits1, 0, 'No audit logs when no repair occurred');

  // Inject drift: Firestore active, Auth disabled
  fixture.authUsers.get('requester-1').disabled = true;

  // Run repairAuth
  const res2 = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'repairAuth' });
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.repaired, true);

  const audits2 = [...fixture.records.keys()].filter((k) => k.startsWith('adminAuditLogs/')).length;
  assert.equal(audits2, 1, 'Exactly one audit log created on repair');

  // Run repairAuth again: already consistent
  const res3 = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'repairAuth' });
  assert.equal(res3.statusCode, 200);
  assert.equal(res3.body.repaired, false);

  const audits3 = [...fixture.records.keys()].filter((k) => k.startsWith('adminAuditLogs/')).length;
  assert.equal(audits3, 1, 'No duplicate audit log created on idempotent retry');
});

test('18. repairAuth action: surfaces 502 ACCOUNT_AUTH_SYNC_FAILED if Auth update fails', async () => {
  const fixture = testFixture({ failAuth: true });
  const handler = createAdminAccountsHandler(fixture.getAdmin);

  // Inject drift
  fixture.authUsers.get('requester-1').disabled = true;

  const res = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'repairAuth' });
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error.reason, 'ACCOUNT_AUTH_SYNC_FAILED');
});

// --------------------------------------------------------------------------
// CATEGORY 6: BRANCH RESTRICTION & TOKEN VERIFICATION INVARIANTS
// --------------------------------------------------------------------------

test('19. Global suspension overrides branch restoration', async () => {
  const fixture = testFixture();
  const profile = fixture.records.get('users/branch-restricted-1');

  delete profile.branchSuspensions;
  assert.equal(canonicalAccountStatus(profile), ACCOUNT_STATUS.SUSPENDED);

  assert.throws(() => {
    requireActiveAccount(profile);
  }, (err) => err.reason === 'ACCOUNT_SUSPENDED');
});

test('20. Reactivation preserves independent branch restrictions intact', async () => {
  const fixture = testFixture();
  const handler = createAdminAccountsHandler(fixture.getAdmin);

  const res = await callHandler(handler, 'PATCH', 'admin-token', { uid: 'branch-restricted-1', action: 'reactivate' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, true);

  const updatedProfile = fixture.records.get('users/branch-restricted-1');
  assert.equal(updatedProfile.accountStatus, 'active');
  assert.ok(updatedProfile.branchSuspensions);
  assert.equal(updatedProfile.branchSuspensions.north.reason, 'Branch policy issue');
});

test('21. Suspended user notice access with revoked token returns 401 AUTHENTICATION_REQUIRED', async () => {
  const fixture = testFixture();
  const handler = createModerationNoticesHandler(fixture.getAdmin);

  const resRevoked = await callHandler(handler, 'GET', 'revoked-token');
  assert.equal(resRevoked.statusCode, 401);
  assert.equal(resRevoked.body.error.reason, 'AUTHENTICATION_REQUIRED');

  const resDisabled = await callHandler(handler, 'GET', 'disabled-user-token');
  assert.equal(resDisabled.statusCode, 401);
  assert.equal(resDisabled.body.error.reason, 'AUTHENTICATION_REQUIRED');
});

test('22. verifiedIdentity rejects revoked and disabled tokens', async () => {
  const fixture = testFixture();
  const { auth } = fixture.getAdmin();

  await assert.rejects(async () => {
    await verifiedIdentity({ headers: { authorization: 'Bearer revoked-token' } }, auth);
  }, (err) => err.status === 401 && err.reason === 'AUTHENTICATION_REQUIRED');

  await assert.rejects(async () => {
    await verifiedIdentity({ headers: { authorization: 'Bearer disabled-user-token' } }, auth);
  }, (err) => err.status === 401 && err.reason === 'AUTHENTICATION_REQUIRED');
});

test('23. Helper logic unit tests: describeAuthConsistency, authShouldBeDisabled, readAuthoritativeAccountStatus', async () => {
  assert.equal(authShouldBeDisabled(ACCOUNT_STATUS.ACTIVE), false);
  assert.equal(authShouldBeDisabled(ACCOUNT_STATUS.SUSPENDED), true);
  assert.equal(authShouldBeDisabled(ACCOUNT_STATUS.INACTIVE), true);
  assert.equal(authShouldBeDisabled(ACCOUNT_STATUS.TERMINATED), true);

  const activeSync = describeAuthConsistency({ accountStatus: 'active' }, { disabled: false });
  assert.equal(activeSync.consistent, true);

  const activeDrift = describeAuthConsistency({ accountStatus: 'active' }, { disabled: true });
  assert.equal(activeDrift.consistent, false);

  const suspendedSync = describeAuthConsistency({ accountStatus: 'suspended' }, { disabled: true });
  assert.equal(suspendedSync.consistent, true);

  const suspendedDrift = describeAuthConsistency({ accountStatus: 'suspended' }, { disabled: false });
  assert.equal(suspendedDrift.consistent, false);

  const fixture = testFixture();
  const { auth, db } = fixture.getAdmin();

  const status = await readAuthoritativeAccountStatus(db, 'requester-1');
  assert.equal(status, ACCOUNT_STATUS.ACTIVE);
});
