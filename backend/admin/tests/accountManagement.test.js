const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdminAccountsHandler, emailFor, passwordFor, safeAccount, safeAudit, statusOf } = require('../accountManagementHandler');

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
  assert.deepEqual(Object.keys(account).sort(), ['accountSource','branchId','branchName','createdAt','email','fullName','lastSignInAt','mustChangePassword','role','status','uid','updatedAt','username'].sort());
  assert.equal(account.status, 'pending');
  assert.equal(account.email, 'dina@example.test');
  assert.equal(account.branchName, 'North Branch');
  assert.equal('password' in account, false);
  assert.equal('faceEmbedding' in account, false);
});

test('role-specific account status and audit DTO stay canonical and secret-free', () => {
  assert.equal(statusOf({ role: 'manager', managerStatus: 'inactive' }), 'inactive');
  assert.equal(statusOf({ role: 'distributor', approvalStatus: 'active', status: 'Pending' }), 'active');
  assert.equal(statusOf({ role: 'requester', accountStatus: 'active' }), 'active');
  const audit = safeAudit('log-1', { action: 'TEMP_PASSWORD_RESET', actorUid: 'admin-1', targetUid: 'user-1', role: 'requester', temporaryPassword: 'secret' });
  assert.equal(audit.action, 'TEMP_PASSWORD_RESET');
  assert.equal('temporaryPassword' in audit, false);
});

function managementFixture() {
  const records = new Map([
    ['users/admin-1', { role: 'admin', email: 'admin@example.test' }],
    ['users/requester-1', { uid: 'requester-1', role: 'requester', fullName: 'Rita Requester', email: 'rita@example.test', username: 'rita_req', accountStatus: 'active', mustChangePassword: false, accountSource: 'admin_created' }],
    ['users/manager-1', { uid: 'manager-1', role: 'manager', fullName: 'Manny Manager', email: 'manny@example.test', managerStatus: 'active', branchId: 'north', accountSource: 'admin_created' }],
    ['branches/north', { name: 'North', code: 'N', status: 'active' }],
  ]);
  let autoId = 0;
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const allDocs = (name) => [...records.keys()].filter((path) => path.startsWith(`${name}/`)).map(snapshot);
  const collection = (name) => ({
    doc(id = `auto-${++autoId}`) { const path = `${name}/${id}`; return { id, path, get: async () => snapshot(path) }; },
    where(field, _op, value) { return { limit() { return this; }, get: async () => ({ docs: allDocs(name).filter((doc) => doc.data()?.[field] === value) }) }; },
    orderBy() { return { limit() { return this; }, get: async () => ({ docs: allDocs(name) }) }; },
    get: async () => ({ docs: allDocs(name) }),
  });
  const authUsers = new Map([
    ['admin-1', { uid: 'admin-1', email: 'admin@example.test', customClaims: { admin: true, role: 'admin' }, metadata: {} }],
    ['requester-1', { uid: 'requester-1', email: 'rita@example.test', customClaims: {}, metadata: { creationTime: '2026-01-01', lastSignInTime: '2026-02-01' } }],
    ['manager-1', { uid: 'manager-1', email: 'manny@example.test', customClaims: { manager: true }, metadata: {} }],
  ]);
  const db = { collection, runTransaction: async (run) => run({ update(ref, data) { records.set(ref.path, { ...records.get(ref.path), ...data }); }, set(ref, data) { records.set(ref.path, data); } }) };
  const auth = {
    verifyIdToken: async (token) => token === 'admin-token' ? { uid: 'admin-1', admin: true, role: 'admin' } : { uid: 'manager-1', manager: true, role: 'manager' },
    getUser: async (uid) => authUsers.get(uid), listUsers: async () => ({ users: [...authUsers.values()] }),
    updateUser: async (uid, changes) => { const current = authUsers.get(uid); authUsers.set(uid, { ...current, ...changes }); return authUsers.get(uid); },
  };
  return { records, authUsers, getAdmin: () => ({ auth, db }) };
}
function response() { return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } }; }
async function call(handler, method, token, body = {}) { const res = response(); await handler({ method, headers: { authorization: `Bearer ${token}` }, body }, res); return res; }

test('Accounts & Audit endpoint lists all operational roles and rejects Manager access', async () => {
  const fixture = managementFixture(); const handler = createAdminAccountsHandler(fixture.getAdmin);
  const allowed = await call(handler, 'GET', 'admin-token');
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(allowed.body.accounts.map((account) => account.role).sort(), ['manager', 'requester']);
  assert.deepEqual(allowed.body.activity, []);
  const denied = await call(handler, 'GET', 'manager-token');
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.error.reason, 'ADMIN_REQUIRED');
});

test('Admin deactivation and temporary-password reset are authoritative and audited', async () => {
  const fixture = managementFixture(); const handler = createAdminAccountsHandler(fixture.getAdmin);
  const deactivated = await call(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'deactivate' });
  assert.equal(deactivated.statusCode, 200);
  assert.equal(fixture.records.get('users/requester-1').accountStatus, 'inactive');
  assert.equal(fixture.authUsers.get('requester-1').disabled, true);
  const reset = await call(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'resetPassword', temporaryPassword: 'NewTemporary2026' });
  assert.equal(reset.statusCode, 200);
  assert.equal(fixture.records.get('users/requester-1').mustChangePassword, true);
  assert.equal(fixture.authUsers.get('requester-1').password, 'NewTemporary2026');
  assert.ok([...fixture.records.values()].some((value) => value.action === 'ACCOUNT_DEACTIVATED'));
  assert.ok([...fixture.records.values()].some((value) => value.action === 'TEMP_PASSWORD_RESET'));
});
