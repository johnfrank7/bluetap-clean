const assert = require('node:assert/strict');
const test = require('node:test');
const { backfillLegacyUids, createAdminAccountsHandler, emailFor, passwordFor, safeAccount, safeAudit, statusOf } = require('../accountManagementHandler');
const { authorityKeyHash, buildConversationFoundation } = require('../../chat/conversationService');

test('manual account input normalizes email and applies the shared password policy', () => {
  assert.equal(emailFor('  Person@Gmail.com '), 'person@gmail.com');
  assert.throws(() => emailFor('not-an-email'), (error) => error.reason === 'INVALID_EMAIL');
  assert.equal(passwordFor('SafePassword2026'), 'SafePassword2026');
  assert.throws(() => passwordFor('onlyeight'), (error) => error.reason === 'WEAK_PASSWORD');
});

test('account workspace DTO exposes only safe normalized fields', () => {
  const account = safeAccount('distributor-1', {
    role: 'distributor', firstName: 'Dina', lastName: 'Water', email: 'DINA@EXAMPLE.TEST',
    username: 'dinawater', approvalStatus: 'pending', branchId: 'branch-a', mustChangePassword: true,
    password: 'must-never-leak', faceEmbedding: [1, 2, 3], accountSource: 'public_registration',
  }, new Map([['branch-a', 'North Branch']]), { metadata: { lastSignInTime: '2026-09-20T00:00:00Z' } });
  assert.deepEqual(Object.keys(account).sort(), ['accountSource','branchId','branchName','createdAt','displayUid','email','fullName','lastSignInAt','mustChangePassword','noticeEligible','onboarding','pendingAccountActionId','publicUid','requestedBranchId','requestedBranchName','role','sessionIdleTimeoutOverrideMinutes','sessionPolicy','status','uid','uniqueId','updatedAt','username'].sort());
  assert.equal(account.status, 'pending');
  assert.equal(account.email, 'dina@example.test');
  assert.equal(account.branchName, 'North Branch');
  assert.equal(account.noticeEligible, false);
  assert.equal('password' in account, false);
  assert.equal('faceEmbedding' in account, false);
});

test('account-action eligibility requires a matching nonempty Firebase-verified email', () => {
  const profile = { email: 'requester@example.test', role: 'requester', accountSource: 'admin_created' };
  assert.equal(safeAccount('requester-1', profile, new Map(), { email: profile.email, emailVerified: false }).noticeEligible, false);
  assert.equal(safeAccount('requester-1', profile, new Map(), { email: 'other@example.test', emailVerified: true }).noticeEligible, false);
  const verified = safeAccount('requester-1', profile, new Map(), { email: profile.email, emailVerified: true });
  assert.equal(verified.noticeEligible, true);
  assert.equal(verified.onboarding.emailVerification, 'auth_verified');
  assert.equal(safeAccount('requester-1', { role: 'requester' }, new Map(), { emailVerified: true }).noticeEligible, false);
});

test('role-specific account status and audit DTO stay canonical and secret-free', () => {
  assert.equal(statusOf({ role: 'manager', managerStatus: 'inactive' }), 'inactive');
  assert.equal(statusOf({ role: 'distributor', approvalStatus: 'active', status: 'Pending' }), 'active');
  assert.equal(statusOf({ role: 'requester', accountStatus: 'active' }), 'active');
  assert.equal(statusOf({ role: 'manager', accountStatus: 'suspended', managerStatus: 'active' }), 'suspended');
  assert.equal(statusOf({ role: 'distributor', accountStatus: 'terminated', distributorStatus: 'active' }), 'terminated');
  const audit = safeAudit('log-1', { action: 'TEMP_PASSWORD_RESET', actorUid: 'admin-1', targetUid: 'user-1', role: 'requester', temporaryPassword: 'secret' });
  assert.equal(audit.action, 'TEMP_PASSWORD_RESET');
  assert.equal('temporaryPassword' in audit, false);
});

test('Admin suspension and termination disable Auth, revoke sessions, preserve records, and are retry-safe', async () => {
  const fixture = managementFixture(); const handler = accountHandler(fixture);
  const suspended = await call(handler, 'PATCH', 'admin-token', { uid: 'manager-1', action: 'suspend', clientMutationId: 'suspend-manager-1', reason: 'Reviewed account safety incident.' });
  assert.equal(suspended.statusCode, 200);
  assert.equal(fixture.records.get('users/manager-1').accountStatus, 'suspended');
  assert.equal(fixture.records.get('users/manager-1').managerStatus, 'active');
  assert.equal(fixture.authUsers.get('manager-1').disabled, true);

  const reactivated = await call(handler, 'PATCH', 'admin-token', { uid: 'manager-1',
    action: 'reactivate', clientMutationId: 'reactivate-manager-1' });
  assert.equal(reactivated.statusCode, 200);
  assert.equal(fixture.records.get('users/manager-1').accountStatus, 'active');
  assert.equal(fixture.authUsers.get('manager-1').disabled, false);

  const terminated = await call(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'terminate', clientMutationId: 'terminate-requester-1', reason: 'Reviewed account safety incident.' });
  assert.equal(terminated.statusCode, 200);
  assert.equal(fixture.records.get('users/requester-1').accountStatus, 'terminated');
  assert.equal(fixture.authUsers.get('requester-1').disabled, true);
  assert.ok(fixture.records.has('users/requester-1'));
  assert.ok([...fixture.records.values()].some((value) => value.action === 'ACCOUNT_TERMINATED'));

  const retried = await call(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'terminate', clientMutationId: 'terminate-requester-1', reason: 'Reviewed account safety incident.' });
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.body.accountAction.state, 'applied');
  const reactivationDenied = await call(handler, 'PATCH', 'admin-token', { uid: 'requester-1',
    action: 'reactivate', clientMutationId: 'reactivate-terminated-1' });
  assert.equal(reactivationDenied.statusCode, 409);
  assert.equal(reactivationDenied.body.error.reason, 'ACCOUNT_NOT_REACTIVATABLE');
});

test('general account editor cannot bypass durable access actions', async () => {
  const fixture = managementFixture(); const handler = accountHandler(fixture);
  const before = fixture.authUsers.get('requester-1').disabled;
  const denied = await call(handler, 'PATCH', 'admin-token', { uid: 'requester-1',
    action: 'updateAccount', fullName: 'Rita Water', email: 'rita@example.test', active: false });
  assert.equal(denied.statusCode, 409);
  assert.equal(denied.body.error.reason, 'ACCOUNT_ACTION_ROUTE_REQUIRED');
  assert.equal(fixture.authUsers.get('requester-1').disabled, before);
  assert.equal(fixture.records.has('accountActionReservations/requester-1'), false);
});

test('changing an account email clears Auth verification and notice eligibility', async () => {
  const fixture = managementFixture();
  const handler = accountHandler(fixture);
  const changed = await call(handler, 'PATCH', 'admin-token', {
    uid: 'requester-1', action: 'updateAccount', role: 'requester',
    fullName: 'Rita Requester', email: 'new-rita@example.test', active: true,
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(fixture.authUsers.get('requester-1').emailVerified, false);
  assert.equal(fixture.records.get('users/requester-1').emailVerified, false);
  assert.equal(changed.body.account.noticeEligible, false);
  assert.equal(changed.body.account.onboarding.emailVerification, 'verification_required');
  assert.deepEqual(fixture.revoked, ['requester-1']);
});

test('unconfigured notice transport rejects a new action before access hold but permits exact replay', async () => {
  const fixture = managementFixture();
  const unavailable = createAdminAccountsHandler(fixture.getAdmin, { noticeEnv: {} });
  const body = { uid: 'requester-1', action: 'deactivate', clientMutationId: 'notice-config-1' };
  const rejected = await call(unavailable, 'PATCH', 'admin-token', body);
  assert.equal(rejected.statusCode, 503);
  assert.equal(rejected.body.error.reason, 'ACCOUNT_NOTICE_TRANSPORT_UNAVAILABLE');
  assert.equal(fixture.records.has('accountActionReservations/requester-1'), false);
  assert.equal(fixture.records.has('accountAccessHolds/requester-1'), false);
  assert.equal(fixture.authUsers.get('requester-1').disabled, undefined);
  const applied = await call(accountHandler(fixture), 'PATCH', 'admin-token', body);
  assert.equal(applied.body.accountAction.state, 'applied');
  const replay = await call(unavailable, 'PATCH', 'admin-token', body);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.accountAction.id, applied.body.accountAction.id);
});

test('protected account-action status and retry preserve intent identity and deny Manager access', async () => {
  const fixture = managementFixture(); const handler = accountHandler(fixture);
  const missingReason = await call(handler, 'PATCH', 'admin-token', {
    uid: 'requester-1', action: 'suspend', clientMutationId: 'reason-required-1',
  });
  assert.equal(missingReason.statusCode, 400);
  assert.equal(fixture.records.has('accountActionReservations/requester-1'), false);
  const created = await call(handler, 'PATCH', 'admin-token', {
    uid: 'requester-1', action: 'suspend', clientMutationId: 'reason-required-1',
    reason: 'Reviewed account safety incident.',
  });
  assert.equal(created.statusCode, 200);
  const intentId = created.body.accountAction.id;
  const status = await call(handler, 'PATCH', 'admin-token', { action: 'accountActionStatus', intentId });
  assert.equal(status.body.accountAction.state, 'applied');
  const denied = await call(handler, 'PATCH', 'manager-token', { action: 'retryAccountAction', intentId });
  assert.equal(denied.statusCode, 403);
  const forged = await call(handler, 'PATCH', 'admin-token', { action: 'retryAccountAction', intentId: '0'.repeat(64) });
  assert.equal(forged.statusCode, 404);
  const changed = await call(handler, 'PATCH', 'admin-token', {
    uid: 'requester-1', action: 'suspend', clientMutationId: 'reason-required-1',
    reason: 'Different reviewed factual reason.',
  });
  assert.equal(changed.statusCode, 409);
  assert.equal([...fixture.records.keys()].filter((key) => key.startsWith('adminAuditLogs/account_action_')).length, 1);
});

test('global account state changes do not grant Distributor operational approval', async () => {
  const fixture = managementFixture(); const handler = accountHandler(fixture);
  fixture.records.set('users/pending-distributor', { uid: 'pending-distributor', role: 'distributor', fullName: 'Pending Driver', email: 'pending@example.test', accountStatus: 'active', distributorStatus: 'pending', approvalStatus: 'pending', status: 'Pending' });
  fixture.authUsers.set('pending-distributor', { uid: 'pending-distributor', email: 'pending@example.test',
    emailVerified: true, customClaims: {}, metadata: {} });
  assert.equal((await call(handler, 'PATCH', 'admin-token', { uid: 'pending-distributor', action: 'deactivate', clientMutationId: 'deactivate-pending-1' })).statusCode, 200);
  assert.equal((await call(handler, 'PATCH', 'admin-token', { uid: 'pending-distributor',
    action: 'reactivate', clientMutationId: 'reactivate-pending-1' })).statusCode, 409);
  const profile = fixture.records.get('users/pending-distributor');
  assert.equal(profile.accountStatus, 'inactive');
  assert.equal(profile.distributorStatus, 'pending');
  assert.equal(profile.approvalStatus, 'pending');
});

function managementFixture() {
  const revoked = [];
  const records = new Map([
    ['users/admin-1', { role: 'admin', email: 'admin@example.test' }],
    ['users/requester-1', { uid: 'requester-1', role: 'requester', fullName: 'Rita Requester', email: 'rita@example.test', username: 'rita_req', accountStatus: 'active', mustChangePassword: false, accountSource: 'admin_created' }],
    ['users/manager-1', { uid: 'manager-1', role: 'manager', fullName: 'Manny Manager', email: 'manny@example.test', managerStatus: 'active', branchId: 'north', accountSource: 'admin_created' }],
    ['users/distributor-1', { uid: 'distributor-1', role: 'distributor', fullName: 'Dina Driver', email: 'dina@example.test', username: 'dina_driver', distributorStatus: 'active', approvalStatus: 'active', branchId: 'north', accountSource: 'admin_created' }],
    ['branches/north', { name: 'North', code: 'N', status: 'active' }],
  ]);
  let autoId = 0;
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const allDocs = (name) => [...records.keys()].filter((path) => path.startsWith(`${name}/`)).map(snapshot);
  const collection = (name) => ({
    doc(id = `auto-${++autoId}`) { const path = `${name}/${id}`; return { id, path, get: async () => snapshot(path), update: async (data) => { records.set(path, { ...records.get(path), ...data }); }, set: async (data) => { records.set(path, data); } }; },
    where(field, op, value) { const filters = [[field, op, value]]; return { where(key, operator, expected) { filters.push([key, operator, expected]); return this; }, limit() { return this; }, get: async () => ({ docs: allDocs(name).filter((doc) => filters.every(([key, operator, expected]) => operator === '!=' ? doc.data()?.[key] != null && doc.data()[key] !== expected : doc.data()?.[key] === expected)) }) }; },
    orderBy() { return { limit() { return this; }, get: async () => ({ docs: allDocs(name) }) }; },
    get: async () => ({ docs: allDocs(name) }),
  });
  const authUsers = new Map([
    ['admin-1', { uid: 'admin-1', email: 'admin@example.test', customClaims: { admin: true, role: 'admin' }, metadata: {} }],
    ['requester-1', { uid: 'requester-1', email: 'rita@example.test', emailVerified: true, customClaims: {}, metadata: { creationTime: '2026-01-01', lastSignInTime: '2026-02-01' } }],
    ['manager-1', { uid: 'manager-1', email: 'manny@example.test', emailVerified: true, customClaims: { manager: true }, metadata: {} }],
    ['distributor-1', { uid: 'distributor-1', email: 'dina@example.test', emailVerified: true, customClaims: {}, metadata: {} }],
  ]);
  const db = { collection, runTransaction: async (run) => {
    let hasWritten = false;
    const staged = [];
    const result = await run({
      get: async (ref) => {
        if (hasWritten) throw new Error('Firestore transactions require all reads to be executed before all writes.');
        return ref.path ? snapshot(ref.path) : ref.get();
      },
      create(ref, data) {
        hasWritten = true;
        staged.push(() => {
          if (records.has(ref.path)) throw new Error(`Document already exists: ${ref.path}`);
          records.set(ref.path, data);
        });
      },
      update(ref, data) { hasWritten = true; staged.push(() => records.set(ref.path, { ...records.get(ref.path), ...data })); },
      set(ref, data, options) { hasWritten = true; staged.push(() => records.set(ref.path, options?.merge ? { ...records.get(ref.path), ...data } : data)); },
      delete(ref) { hasWritten = true; staged.push(() => records.delete(ref.path)); },
    });
    staged.forEach((apply) => apply());
    return result;
  } };
  const auth = {
    verifyIdToken: async (token) => token === 'admin-token' ? { uid: 'admin-1', admin: true, role: 'admin' } : { uid: 'manager-1', manager: true, role: 'manager' },
    getUser: async (uid) => authUsers.get(uid), getUserByEmail: async (email) => { const user = [...authUsers.values()].find((item) => item.email === email); if (!user) throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' }); return user; }, listUsers: async () => ({ users: [...authUsers.values()] }),
    createUser: async ({ email, password, displayName, emailVerified = false }) => { const uid = `created-${authUsers.size}`; const user = { uid, email, password, displayName, emailVerified, metadata: {} }; authUsers.set(uid, user); return user; }, deleteUser: async (uid) => authUsers.delete(uid), setCustomUserClaims: async () => {},
    updateUser: async (uid, changes) => { const current = authUsers.get(uid); authUsers.set(uid, { ...current, ...changes }); return authUsers.get(uid); },
    revokeRefreshTokens: async (uid) => { revoked.push(uid); },
  };
  return { records, authUsers, revoked, getAdmin: () => ({ auth, db }) };
}
function accountHandler(fixture) {
  return createAdminAccountsHandler(fixture.getAdmin,
    { sendEmail: async () => ({ provider: 'test', providerStatus: 200 }) });
}
function response() { return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } }; }
async function call(handler, method, token, body = {}) { const res = response(); await handler({ method, headers: { authorization: `Bearer ${token}` }, body }, res); return res; }

test('Accounts & Audit endpoint lists all operational roles and rejects Manager access', async () => {
  const fixture = managementFixture(); const handler = accountHandler(fixture);
  const allowed = await call(handler, 'GET', 'admin-token');
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(allowed.body.accounts.map((account) => account.role).sort(), ['distributor', 'manager', 'requester']);
  assert.deepEqual(allowed.body.activity, []);
  const denied = await call(handler, 'GET', 'manager-token');
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.error.reason, 'ADMIN_REQUIRED');
});

test('Admin deactivation and temporary-password reset are authoritative and audited', async () => {
  const fixture = managementFixture(); const handler = accountHandler(fixture);
  const deactivated = await call(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'deactivate', clientMutationId: 'deactivate-requester-1' });
  assert.equal(deactivated.statusCode, 200);
  assert.equal(fixture.records.get('users/requester-1').accountStatus, 'inactive');
  assert.equal(fixture.authUsers.get('requester-1').disabled, true);
  const reset = await call(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'resetPassword', temporaryPassword: 'NewTemporary2026' });
  assert.equal(reset.statusCode, 200);
  assert.equal(fixture.records.get('users/requester-1').mustChangePassword, true);
  assert.equal(fixture.authUsers.get('requester-1').password, 'NewTemporary2026');
  assert.ok([...fixture.records.values()].some((value) => value.action === 'ACCOUNT_DEACTIVATED'));
  assert.ok([...fixture.records.values()].some((value) => value.action === 'TEMP_PASSWORD_RESET'));
  assert.deepEqual(fixture.revoked, ['requester-1', 'requester-1']);
});

test('Admin can revoke every session for one account without changing its profile status', async () => {
  const fixture = managementFixture(); const handler = accountHandler(fixture);
  const result = await call(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'signOutAllSessions' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(fixture.revoked, ['requester-1']);
  assert.equal(fixture.records.get('users/requester-1').accountStatus, 'active');
  assert.ok([...fixture.records.values()].some((value) => value.action === 'USER_SESSIONS_REVOKED'));
});

test('Admin account edits keep the session override and Manager branch server-authoritative and audited', async () => {
  const fixture = managementFixture();
  fixture.records.set('branches/south', { name: 'South', code: 'S', status: 'active' });
  const handler = accountHandler(fixture);
  const requester = await call(handler, 'PATCH', 'admin-token', {
    uid: 'requester-1', action: 'updateAccount', fullName: 'Rita Updated', email: 'rita@example.test', role: 'requester',
    sessionIdleTimeoutOverrideMinutes: 10, requirePasswordChange: true, active: true,
  });
  assert.equal(requester.statusCode, 200);
  assert.equal(fixture.records.get('users/requester-1').sessionIdleTimeoutOverrideMinutes, 10);
  assert.equal(fixture.records.get('users/requester-1').mustChangePassword, true);
  assert.ok([...fixture.records.values()].some((value) => value.action === 'ACCOUNT_SESSION_POLICY_CHANGED'));
  assert.ok([...fixture.records.values()].some((value) => value.action === 'PASSWORD_CHANGE_REQUIRED'));

  const manager = await call(handler, 'PATCH', 'admin-token', {
    uid: 'manager-1', action: 'updateAccount', fullName: 'Manny Manager', email: 'manny@example.test', role: 'manager', branchId: 'south', active: true,
  });
  assert.equal(manager.statusCode, 200);
  assert.equal(fixture.records.get('users/manager-1').branchId, 'south');
  assert.ok([...fixture.records.values()].some((value) => value.action === 'MANAGER_BRANCH_REASSIGNED'));
});

test('Admin Distributor reassignment requires an active branch, records an audit, and blocks active deliveries', async () => {
  const fixture = managementFixture(); fixture.records.set('branches/south', { name: 'South', status: 'active' });
  const membershipAuthority = { distributorUid: 'distributor-1', branchId: 'north', branchMembershipVersion: 1 };
  const membershipHash = authorityKeyHash('distributor_branch', membershipAuthority);
  fixture.records.set(`chatAuthorityRegistry/${membershipHash}`, { authorityKeyHash: membershipHash, conversationId: 'old-membership-thread', type: 'distributor_branch' });
  fixture.records.set('chatConversations/old-membership-thread', buildConversationFoundation({ type: 'distributor_branch', authority: membershipAuthority, createdBy: { uid: 'distributor-1', role: 'distributor' }, now: new Date('2026-09-29T00:00:00Z') }));
  const handler = accountHandler(fixture);
  const moved = await call(handler, 'PATCH', 'admin-token', { uid: 'distributor-1', action: 'updateAccount', fullName: 'Dina Driver', email: 'dina@example.test', role: 'distributor', branchId: 'south', active: true });
  assert.equal(moved.statusCode, 200); assert.equal(fixture.records.get('users/distributor-1').branchId, 'south');
  assert.equal(fixture.records.get('users/distributor-1').branchMembershipVersion, 2);
  assert.equal(fixture.records.get('chatConversations/old-membership-thread').status, 'closed');
  assert.equal(fixture.records.get('chatConversations/old-membership-thread').participantBranchAccess.north, 'closed');
  const profileEdit = await call(handler, 'PATCH', 'admin-token', { uid: 'distributor-1', action: 'updateAccount', fullName: 'Dina Driver Updated', email: 'dina@example.test', role: 'distributor', branchId: 'south', active: true });
  assert.equal(profileEdit.statusCode, 200);
  assert.equal(fixture.records.get('users/distributor-1').branchMembershipVersion, 2);
  const audit = [...fixture.records.values()].find((value) => value.action === 'DISTRIBUTOR_BRANCH_CHANGED');
  assert.equal(audit.previousBranchId, 'north'); assert.equal(audit.newBranchId, 'south'); assert.equal(audit.changedByAdminUid, 'admin-1');
  fixture.records.set('requests/open-delivery', { assignedDistributorUid: 'distributor-1', status: 'out_for_delivery' });
  const blocked = await call(handler, 'PATCH', 'admin-token', { uid: 'distributor-1', action: 'updateAccount', fullName: 'Dina Driver Updated', email: 'dina@example.test', role: 'distributor', branchId: 'north', active: true });
  assert.equal(blocked.statusCode, 409); assert.equal(blocked.body.error.reason, 'DISTRIBUTOR_ACTIVE_DELIVERIES');
  assert.match(blocked.body.error.message, /active deliveries/i);
});

test('Admin can manually assign an active branch to a legacy active Distributor with no branch', async () => {
  const fixture = managementFixture(); const handler = accountHandler(fixture);
  fixture.records.set('users/legacy-distributor', { uid: 'legacy-distributor', role: 'distributor', fullName: 'Legacy Driver', email: 'legacy@example.test', username: 'legacy_driver', distributorStatus: 'active', approvalStatus: 'active', branchId: null });
  fixture.authUsers.set('legacy-distributor', { uid: 'legacy-distributor', email: 'legacy@example.test', customClaims: {}, metadata: {} });
  const assigned = await call(handler, 'PATCH', 'admin-token', { uid: 'legacy-distributor', action: 'updateAccount', fullName: 'Legacy Driver', email: 'legacy@example.test', role: 'distributor', branchId: 'north', active: true });
  assert.equal(assigned.statusCode, 200); assert.equal(fixture.records.get('users/legacy-distributor').branchId, 'north');
  assert.equal(fixture.records.get('users/legacy-distributor').branchMembershipVersion, 2);
  assert.ok([...fixture.records.values()].some((value) => value.action === 'DISTRIBUTOR_BRANCH_CHANGED' && value.targetUid === 'legacy-distributor'));
});

test('Distributor branch and actual Auth changes must be saved separately before any writes', async () => {
  for (const changes of [
    { fullName: 'Changed Name' }, { email: 'new@example.test' },
    { temporaryPassword: 'SafePassword2026' }, { role: 'manager' },
  ]) {
    const fixture = managementFixture();
    fixture.records.set('branches/south', { name: 'South', status: 'active' });
    const { auth, db } = fixture.getAdmin(); let authWrites = 0; let transactions = 0;
    auth.updateUser = async () => { authWrites++; }; auth.setCustomUserClaims = async () => { authWrites++; };
    const run = db.runTransaction; db.runTransaction = async (fn) => { transactions++; return run(fn); };
    const before = structuredClone(fixture.records.get('users/distributor-1'));
    const result = await call(accountHandler(fixture), 'PATCH', 'admin-token', { uid: 'distributor-1', action: 'updateAccount', branchId: 'south', ...changes });
    assert.equal(result.statusCode, 409); assert.equal(result.body.error.reason, 'SEPARATE_BRANCH_AND_AUTH_CHANGES');
    assert.equal(authWrites, 0); assert.equal(transactions, 0); assert.deepEqual(fixture.records.get('users/distributor-1'), before);
  }
});

test('unchanged submitted Auth fields do not prevent a branch-only edit and credentials save separately', async () => {
  const fixture = managementFixture(); fixture.records.set('branches/south', { name: 'South', status: 'active' });
  const handler = accountHandler(fixture);
  const branch = await call(handler, 'PATCH', 'admin-token', { uid: 'distributor-1', action: 'updateAccount', branchId: 'south', fullName: ' Dina Driver ', email: ' DINA@EXAMPLE.TEST ', role: 'distributor', temporaryPassword: '' });
  assert.equal(branch.statusCode, 200); assert.equal(fixture.records.get('users/distributor-1').branchId, 'south');
  const credentials = await call(handler, 'PATCH', 'admin-token', { uid: 'distributor-1', action: 'updateAccount', email: 'new-driver@example.test' });
  assert.equal(credentials.statusCode, 200); assert.equal(fixture.records.get('users/distributor-1').branchId, 'south');
  assert.equal(fixture.authUsers.get('distributor-1').email, 'new-driver@example.test');
  assert.equal(fixture.authUsers.get('distributor-1').emailVerified, false);
});

test('branch transaction rejects changed account, inactive destination, and legacy failed assignment', async () => {
  for (const race of ['account', 'branch', 'failed']) {
    const fixture = managementFixture(); fixture.records.set('branches/south', { name: 'South', status: 'active' });
    const { db } = fixture.getAdmin(); const run = db.runTransaction;
    db.runTransaction = async (fn) => {
      if (race === 'account') fixture.records.set('users/distributor-1', { ...fixture.records.get('users/distributor-1'), branchId: 'east' });
      if (race === 'branch') fixture.records.set('branches/south', { name: 'South', status: 'inactive' });
      if (race === 'failed') fixture.records.set('requests/failed', { distributor_id: 'distributor-1', status: 'delivery_failed' });
      return run(fn);
    };
    const result = await call(accountHandler(fixture), 'PATCH', 'admin-token', { uid: 'distributor-1', action: 'updateAccount', branchId: 'south' });
    assert.equal(result.statusCode, 409); assert.notEqual(fixture.records.get('users/distributor-1').branchId, 'south');
    assert.equal(result.body.error.reason, { account: 'DISTRIBUTOR_MEMBERSHIP_CHANGED', branch: 'BRANCH_INACTIVE', failed: 'DISTRIBUTOR_ACTIVE_DELIVERIES' }[race]);
  }
});

test('role changes still set claims and ambiguous Auth failure is never reported as success', async () => {
  const fixture = managementFixture(); const { auth } = fixture.getAdmin(); let claims;
  auth.setCustomUserClaims = async (uid, value) => { claims = { uid, value }; };
  const result = await call(accountHandler(fixture), 'PATCH', 'admin-token', { uid: 'distributor-1', action: 'updateAccount', role: 'manager', branchId: 'north' });
  assert.equal(result.statusCode, 200); assert.deepEqual(claims, { uid: 'distributor-1', value: { role: 'manager', manager: true } });
  const failed = managementFixture(); const authFailed = failed.getAdmin().auth; let calls = 0;
  authFailed.updateUser = async () => { calls++; throw new Error('unknown outcome'); };
  const response = await call(accountHandler(failed), 'PATCH', 'admin-token', { uid: 'distributor-1', action: 'updateAccount', temporaryPassword: 'SafePassword2026' });
  assert.equal(response.statusCode, 500); assert.equal(calls, 1); assert.equal(failed.records.get('users/distributor-1').mustChangePassword, undefined);
});

test('Manager cannot invoke the Admin account editor', async () => {
  const fixture = managementFixture(); const result = await call(accountHandler(fixture), 'PATCH', 'manager-token', { uid: 'distributor-1', action: 'updateAccount', branchId: 'south', temporaryPassword: 'SafePassword2026' });
  assert.equal(result.statusCode, 403);
  assert.equal(fixture.records.get('users/distributor-1').branchId, 'north');
});

test('Firestore emulator enforces the separation and revalidates failed assignments in a transaction',
  { skip: process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.GCLOUD_PROJECT !== 'demo-bluetap' }, async () => {
    const { randomUUID } = require('node:crypto');
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    const suffix = randomUUID().slice(0, 8); const app = initializeApp({ projectId: 'demo-bluetap' }, `account-separation-${suffix}`);
    const db = getFirestore(app); const uid = `dist-${suffix}`; const adminUid = `admin-${suffix}`; const north = `north-${suffix}`; const south = `south-${suffix}`;
    const authUser = { uid, email: `${uid}@example.test`, emailVerified: true, metadata: {} }; let authWrites = 0;
    const auth = { verifyIdToken: async () => ({ uid: adminUid, role: 'admin', admin: true }), getUser: async () => authUser,
      updateUser: async () => { authWrites++; }, setCustomUserClaims: async () => { authWrites++; }, revokeRefreshTokens: async () => {} };
    try {
      await Promise.all([
        db.collection('users').doc(adminUid).set({ role: 'admin', accountStatus: 'active' }),
        db.collection('users').doc(uid).set({ role: 'distributor', fullName: 'Emulator Driver', email: authUser.email, distributorStatus: 'active', approvalStatus: 'active', branchId: north }),
        db.collection('branches').doc(north).set({ name: 'North', status: 'active' }),
        db.collection('branches').doc(south).set({ name: 'South', status: 'active' }),
      ]);
      const handler = createAdminAccountsHandler(() => ({ auth, db }));
      const mixed = await call(handler, 'PATCH', 'admin-token', { uid, action: 'updateAccount', branchId: south, temporaryPassword: 'SafePassword2026' });
      assert.equal(mixed.statusCode, 409); assert.equal(authWrites, 0);
      const moved = await call(handler, 'PATCH', 'admin-token', { uid, action: 'updateAccount', branchId: south });
      assert.equal(moved.statusCode, 200);
      const run = db.runTransaction.bind(db);
      db.runTransaction = async (fn) => {
        await db.collection('requests').doc(`failed-${suffix}`).set({ distributor_id: uid, status: 'delivery_failed' });
        return run(fn);
      };
      const blocked = await call(handler, 'PATCH', 'admin-token', { uid, action: 'updateAccount', branchId: north });
      assert.equal(blocked.statusCode, 409); assert.equal(blocked.body.error.reason, 'DISTRIBUTOR_ACTIVE_DELIVERIES');
      assert.equal((await db.collection('users').doc(uid).get()).data().branchId, south);
    } finally { await deleteApp(app); }
  });

test('Firestore emulator blocks a stale Manager assignment after a branch change',
  { skip: process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.GCLOUD_PROJECT !== 'demo-bluetap', timeout: 30000 }, async () => {
    const { randomUUID } = require('node:crypto');
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    const { createManagerDispatchHandler } = require('../../manager/dispatchHandler');
    const suffix = randomUUID().slice(0, 8); const app = initializeApp({ projectId: 'demo-bluetap' }, `branch-race-${suffix}`); const db = getFirestore(app);
    const uid = `dist-${suffix}`; const adminUid = `admin-${suffix}`; const managerUid = `manager-${suffix}`; const north = `north-${suffix}`; const south = `south-${suffix}`; const orderId = `order-${suffix}`;
    let reached; let release; const waiting = new Promise((resolve) => { reached = resolve; }); const gate = new Promise((resolve) => { release = resolve; });
    const adminAuth = { verifyIdToken: async () => ({ uid: adminUid, role: 'admin', admin: true }), getUser: async (id) => ({ uid: id, email: `${uid}@example.test`, metadata: {} }) };
    const managerAuth = { verifyIdToken: async () => ({ uid: managerUid, role: 'manager', manager: true }), getUser: async (id) => { if (id === uid) { reached(); await gate; } return { uid: id, disabled: false }; } };
    try {
      await Promise.all([
        db.doc(`users/${adminUid}`).set({ role: 'admin', accountStatus: 'active' }),
        db.doc(`users/${managerUid}`).set({ role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId: north }),
        db.doc(`users/${uid}`).set({ role: 'distributor', accountStatus: 'active', distributorStatus: 'active', approvalStatus: 'active', fullName: 'Race Driver', email: `${uid}@example.test`, branchId: north }),
        db.doc(`distributorDispatchGuards/${uid}`).set({ schemaVersion: 1, initialized: true, distributorUid: uid, revision: 0, reservations: [] }),
        db.doc(`branches/${north}`).set({ name: 'North', status: 'active' }), db.doc(`branches/${south}`).set({ name: 'South', status: 'active' }),
        db.doc(`requests/${orderId}`).set({ status: 'awaiting_distributor_assignment', branchId: north, currentBranchId: north, requesterUid: `requester-${suffix}`, items: [] }),
      ]);
      const manager = createManagerDispatchHandler(() => ({ auth: managerAuth, db }));
      const admin = createAdminAccountsHandler(() => ({ auth: adminAuth, db }));
      const assigning = call(manager, 'PATCH', 'manager-token', { action: 'assign-distributor', orderId, distributorUid: uid, scheduledAt: new Date(Date.now() + 86400000).toISOString() });
      await waiting;
      try {
        const moved = await call(admin, 'PATCH', 'admin-token', { uid, action: 'updateAccount', branchId: south });
        assert.equal(moved.statusCode, 200);
      } finally { release(); }
      const assigned = await assigning;
      assert.equal(assigned.statusCode, 409);
      assert.equal((await db.doc(`users/${uid}`).get()).data().branchId, south);
      assert.equal((await db.doc(`requests/${orderId}`).get()).data().assignedDistributorUid, undefined);
    } finally { release(); await deleteApp(app); }
  });

test('Admin-created active Distributor requires and receives an authoritative active branch', async () => {
  const fixture = managementFixture(); const handler = accountHandler(fixture);
  const missing = await call(handler, 'POST', 'admin-token', { role: 'distributor', fullName: 'New Driver', email: 'new@example.test', username: 'new_driver', temporaryPassword: 'SafePassword2026' });
  assert.equal(missing.statusCode, 404); assert.equal(missing.body.error.reason, 'BRANCH_NOT_FOUND');
  const created = await call(handler, 'POST', 'admin-token', { role: 'distributor', fullName: 'New Driver', email: 'new@example.test', username: 'new_driver', temporaryPassword: 'SafePassword2026', branchId: 'north' });
  assert.equal(created.statusCode, 201); assert.equal(created.body.account.status, 'active'); assert.equal(created.body.account.branchId, 'north');
  const profile = fixture.records.get(`users/${created.body.account.uid}`); assert.equal(profile.distributorStatus, 'active'); assert.equal(profile.branchId, 'north');
  assert.equal(profile.emailVerificationRequired, true);
  assert.equal(fixture.authUsers.get(created.body.account.uid).emailVerified, false);
  assert.equal(created.body.account.noticeEligible, false);
  assert.equal(created.body.account.onboarding.emailVerification, 'verification_required');
  assert.equal(profile.branchMembershipVersion, 1);
});

test('backfillLegacyUids is idempotent, converts legacy hyphenated UIDs, and does not overwrite existing public UIDs', async () => {
  const fixture = managementFixture();
  const { auth, db } = fixture.getAdmin();

  // Add a legacy user with hyphenated unique_id
  fixture.records.set('users/legacy-1', {
    role: 'requester',
    email: 'legacy@example.test',
    unique_id: 'REQ-000007',
  });
  // Add a user that already has a publicUid
  fixture.records.set('users/existing-1', {
    uid: 'existing-1',
    role: 'distributor',
    email: 'existing@example.test',
    publicUid: 'Dis042',
  });
  fixture.records.set('users/legacy-manager', {
    uid: 'legacy-manager', role: 'manager', email: 'manager@example.test', publicUid: 'Mgr009', managerStatus: 'active', branchId: 'north',
  });
  fixture.records.set('users/requester-duplicate-oldest', {
    uid: 'requester-duplicate-oldest', role: 'requester', publicUid: 'Req005', createdAt: '2020-01-01T00:00:00Z',
  });
  fixture.records.set('users/requester-duplicate-newer', {
    uid: 'requester-duplicate-newer', role: 'requester', publicUid: 'Req005', createdAt: '2021-01-01T00:00:00Z',
  });
  fixture.records.set('users/missing-requester', {
    uid: 'missing-requester', role: 'requester', createdAt: '2019-01-01T00:00:00Z',
  });
  fixture.records.set('users/missing-distributor', {
    uid: 'missing-distributor', role: 'distributor', createdAt: '2019-01-01T00:00:00Z',
  });
  fixture.records.set('users/missing-manager', {
    uid: 'missing-manager', role: 'manager', createdAt: '2019-01-01T00:00:00Z',
  });

  await backfillLegacyUids({
    auth,
    db,
    admin: { uid: 'admin-1', email: 'admin@example.test' },
  });

  // Verify legacy-1 received formatted Req007
  const legacyUser = fixture.records.get('users/legacy-1');
  assert.equal(legacyUser.publicUid, 'Req007');
  assert.equal(legacyUser.displayUid, 'Req007');

  // Verify existing-1 was preserved
  const existingUser = fixture.records.get('users/existing-1');
  assert.equal(existingUser.publicUid, 'Dis042');
  assert.equal(fixture.records.get('users/legacy-manager').publicUid, 'Man009');
  assert.equal(fixture.records.get('users/requester-duplicate-oldest').publicUid, 'Req005');
  assert.notEqual(fixture.records.get('users/requester-duplicate-newer').publicUid, 'Req005');
  assert.match(fixture.records.get('users/missing-requester').publicUid, /^Req\d{3,}$/);
  assert.match(fixture.records.get('users/missing-distributor').publicUid, /^Dis\d{3,}$/);
  assert.match(fixture.records.get('users/missing-manager').publicUid, /^Man\d{3,}$/);
  const requesterIds = [...fixture.records.entries()]
    .filter(([path, value]) => path.startsWith('users/') && value.role === 'requester')
    .map(([, value]) => value.publicUid)
    .filter(Boolean);
  assert.equal(new Set(requesterIds).size, requesterIds.length);

  // Rerun backfill - should be idempotent and not change anything
  await backfillLegacyUids({
    auth,
    db,
    admin: { uid: 'admin-1', email: 'admin@example.test' },
  });
  assert.equal(fixture.records.get('users/legacy-1').publicUid, 'Req007');
  assert.equal(fixture.records.get('users/existing-1').publicUid, 'Dis042');
  assert.equal(fixture.records.get('users/legacy-manager').publicUid, 'Man009');
  assert.equal(fixture.records.get('users/requester-duplicate-oldest').publicUid, 'Req005');
});

test('Admin account creation enforces Firestore read-before-write, rejects duplicate usernames, and leaves no partial state on transaction failure', async () => {
  const fixture = managementFixture();
  const handler = accountHandler(fixture);

  const distRes = await call(handler, 'POST', 'admin-token', {
    role: 'distributor', fullName: 'Dist One', email: 'dist1@example.test',
    username: 'dist_one', temporaryPassword: 'SafePassword2026', branchId: 'north',
  });
  assert.equal(distRes.statusCode, 201);
  assert.equal(distRes.body.account.publicUid, 'Dis001');
  assert.equal(fixture.records.get('usernames/dist_one')?.uid, distRes.body.account.uid);

  const reqRes = await call(handler, 'POST', 'admin-token', {
    role: 'requester', fullName: 'Req One', email: 'req1@example.test',
    username: 'req_one', temporaryPassword: 'SafePassword2026',
  });
  assert.equal(reqRes.statusCode, 201);
  assert.equal(reqRes.body.account.publicUid, 'Req001');
  assert.equal(fixture.records.get('usernames/req_one')?.uid, reqRes.body.account.uid);

  const mgrRes = await call(handler, 'POST', 'admin-token', {
    role: 'manager', fullName: 'Mgr One', email: 'mgr1@example.test',
    temporaryPassword: 'SafePassword2026', branchId: 'north',
  });
  assert.equal(mgrRes.statusCode, 201);
  assert.equal(mgrRes.body.account.publicUid, 'Man001');

  const authCountBeforeDup = fixture.authUsers.size;
  const dupPrecheck = await call(handler, 'POST', 'admin-token', {
    role: 'requester', fullName: 'Req Dup', email: 'reqdup@example.test',
    username: 'req_one', temporaryPassword: 'SafePassword2026',
  });
  assert.equal(dupPrecheck.statusCode, 409);
  assert.equal(dupPrecheck.body.error.reason, 'USERNAME_ALREADY_IN_USE');
  assert.equal(fixture.authUsers.size, authCountBeforeDup);
  assert.equal(fixture.records.get('accountCounters/requester')?.lastNumber, 1);

  // Simulate a concurrent username claim racing between pre-check and transaction execution
  const { auth, db } = fixture.getAdmin();
  const originalRunTransaction = db.runTransaction;
  db.runTransaction = async (run) => {
    fixture.records.set('usernames/raced_user', { uid: 'concurrent-owner' });
    return originalRunTransaction(run);
  };
  const raced = await call(handler, 'POST', 'admin-token', {
    role: 'distributor', fullName: 'Raced Dist', email: 'raced@example.test',
    username: 'raced_user', temporaryPassword: 'SafePassword2026', branchId: 'north',
  });
  db.runTransaction = originalRunTransaction;
  assert.equal(raced.statusCode, 409);
  assert.equal(raced.body.error.reason, 'USERNAME_ALREADY_IN_USE');
  assert.equal([...fixture.authUsers.values()].some((u) => u.email === 'raced@example.test'), false);
  assert.equal([...fixture.records.values()].some((d) => d?.email === 'raced@example.test'), false);
  assert.equal(fixture.records.get('usernames/raced_user')?.uid, 'concurrent-owner');
  assert.equal(fixture.records.get('accountCounters/distributor')?.lastNumber, 1);
});

const emulatorReady = Boolean(
  process.env.FIRESTORE_EMULATOR_HOST &&
  process.env.FIREBASE_AUTH_EMULATOR_HOST &&
  (!process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT === 'demo-bluetap')
);

test('real Auth and Firestore emulators provision Admin-created Distributor, Requester, and Manager accounts atomically and reject duplicate usernames without partial records',
  { skip: !emulatorReady }, async () => {
    const { randomUUID } = require('node:crypto');
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    const { getFirestore } = require('firebase-admin/firestore');
    const suffix = randomUUID().slice(0, 8);
    const projectId = 'demo-bluetap';
    const app = initializeApp({ projectId }, `admin-create-tx-${suffix}`);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const adminUid = `admin-${suffix}`;
    const branchId = `branch-${suffix}`;
    try {
      await db.collection('users').doc(adminUid).set({ uid: adminUid, role: 'admin', email: `admin-${suffix}@example.test`, accountStatus: 'active' });
      await db.collection('branches').doc(branchId).set({ name: 'North Emulator Branch', code: 'NEB', status: 'active' });
      const authFacade = {
        verifyIdToken: async (token) => token === 'admin-token' ? { uid: adminUid, admin: true, role: 'admin', email: `admin-${suffix}@example.test` } : Promise.reject(new Error('invalid token')),
        getUser: (uid) => auth.getUser(uid),
        getUserByEmail: (email) => auth.getUserByEmail(email),
        listUsers: (max) => auth.listUsers(max),
        createUser: (props) => auth.createUser(props),
        deleteUser: (uid) => auth.deleteUser(uid),
        setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
        updateUser: (uid, props) => auth.updateUser(uid, props),
        revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
      };
      const handler = createAdminAccountsHandler(() => ({ auth: authFacade, db }), {
        sendEmail: async () => ({ provider: 'test', providerStatus: 200 }),
      });

      // 1. Admin-created Distributor (with username)
      const distUsername = `dist_${suffix}`.slice(0, 20);
      const distEmail = `dist-${suffix}@example.test`;
      const distRes = await call(handler, 'POST', 'admin-token', {
        role: 'distributor', fullName: 'Emulator Distributor', email: distEmail,
        username: distUsername, temporaryPassword: 'SafePassword2026', branchId,
      });
      assert.equal(distRes.statusCode, 201);
      const distUid = distRes.body.account.uid;
      assert.match(distRes.body.account.publicUid, /^Dis\d{3,}$/);
      assert.equal((await auth.getUser(distUid)).emailVerified, false);
      assert.equal((await db.collection('usernames').doc(distUsername).get()).data()?.uid, distUid);
      assert.equal((await db.collection('users').doc(distUid).get()).data()?.accountSource, 'admin_created');

      // 2. Admin-created Requester (with username)
      const reqUsername = `req_${suffix}`.slice(0, 20);
      const reqEmail = `req-${suffix}@example.test`;
      const reqRes = await call(handler, 'POST', 'admin-token', {
        role: 'requester', fullName: 'Emulator Requester', email: reqEmail,
        username: reqUsername, temporaryPassword: 'SafePassword2026',
      });
      assert.equal(reqRes.statusCode, 201);
      const reqUid = reqRes.body.account.uid;
      assert.match(reqRes.body.account.publicUid, /^Req\d{3,}$/);
      assert.equal((await auth.getUser(reqUid)).emailVerified, false);
      assert.equal((await db.collection('usernames').doc(reqUsername).get()).data()?.uid, reqUid);
      assert.equal((await db.collection('users').doc(reqUid).get()).data()?.accountSource, 'admin_created');

      // 3. Admin-created Manager (without username)
      const mgrEmail = `mgr-${suffix}@example.test`;
      const mgrRes = await call(handler, 'POST', 'admin-token', {
        role: 'manager', fullName: 'Emulator Manager', email: mgrEmail,
        temporaryPassword: 'SafePassword2026', branchId,
      });
      assert.equal(mgrRes.statusCode, 201);
      const mgrUid = mgrRes.body.account.uid;
      assert.match(mgrRes.body.account.publicUid, /^Man\d{3,}$/);
      const mgrAuthUser = await auth.getUser(mgrUid);
      assert.equal(mgrAuthUser.emailVerified, false);
      assert.equal(mgrAuthUser.customClaims?.manager, true);
      assert.equal((await db.collection('users').doc(mgrUid).get()).data()?.accountSource, 'admin_created');

      // 4. Duplicate username rejection (pre-check and in-transaction race) + rollback verification
      const dupEmail = `dup-${suffix}@example.test`;
      const dupRes = await call(handler, 'POST', 'admin-token', {
        role: 'distributor', fullName: 'Duplicate Distributor', email: dupEmail,
        username: distUsername, temporaryPassword: 'SafePassword2026', branchId,
      });
      assert.equal(dupRes.statusCode, 409);
      assert.equal(dupRes.body.error.reason, 'USERNAME_ALREADY_IN_USE');
      await assert.rejects(auth.getUserByEmail(dupEmail), (err) => err.code === 'auth/user-not-found');
      assert.equal((await db.collection('usernames').doc(distUsername).get()).data()?.uid, distUid);

      // In-transaction race: claim username right before db.runTransaction runs
      const racedUsername = `race_${suffix}`.slice(0, 20);
      const racedEmail = `race-${suffix}@example.test`;
      const counterBeforeRace = (await db.collection('accountCounters').doc('requester').get()).data()?.lastNumber;
      const realRunTransaction = db.runTransaction.bind(db);
      db.runTransaction = async (updateFn) => {
        await db.collection('usernames').doc(racedUsername).set({ uid: 'existing-race-winner', createdAt: new Date() });
        return realRunTransaction(updateFn);
      };
      try {
        const raceRes = await call(handler, 'POST', 'admin-token', {
          role: 'requester', fullName: 'Raced Requester', email: racedEmail,
          username: racedUsername, temporaryPassword: 'SafePassword2026',
        });
        assert.equal(raceRes.statusCode, 409);
        assert.equal(raceRes.body.error.reason, 'USERNAME_ALREADY_IN_USE');
      } finally {
        db.runTransaction = realRunTransaction;
      }
      await assert.rejects(auth.getUserByEmail(racedEmail), (err) => err.code === 'auth/user-not-found');
      assert.equal((await db.collection(' users'.trim()).where('email', '==', racedEmail).get()).empty, true);
      assert.equal((await db.collection('usernames').doc(racedUsername).get()).data()?.uid, 'existing-race-winner');
      assert.equal((await db.collection('accountCounters').doc('requester').get()).data()?.lastNumber, counterBeforeRace);
    } finally {
      await deleteApp(app);
    }
  });
