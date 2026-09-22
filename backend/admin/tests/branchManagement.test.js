const assert = require('node:assert/strict');
const test = require('node:test');

const { createAdminBranchesHandler, createAdminManagersHandler } = require('../branchManagementHandler');
const { createManagerContextHandler } = require('../../manager/managerContextHandler');
const { requireActiveManager, requireManagerBranch } = require('../../auth/authorization');

function fixture() {
  const records = new Map([
    ['users/admin-1', { role: 'admin', email: 'admin@example.test' }],
    ['users/manager-1', { role: 'requester', email: 'manager@example.test', usernameNormalized: 'managerone', firstName: 'Manager', lastName: 'One' }],
  ]);
  const authUsers = new Map([
    ['admin-1', { uid: 'admin-1', email: 'admin@example.test', customClaims: { admin: true, role: 'admin' } }],
    ['manager-1', { uid: 'manager-1', email: 'manager@example.test', customClaims: {} }],
  ]);
  let autoId = 0;
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const collection = (name) => ({
    doc(id = `auto-${++autoId}`) {
      const path = `${name}/${id}`;
      return { id, path, get: async () => snapshot(path) };
    },
    where(field, op, value) {
      let limit = Infinity;
      return {
        limit(valueToSet) { limit = valueToSet; return this; },
        async get() {
          const docs = [...records.entries()].filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value).slice(0, limit).map(([path]) => snapshot(path));
          return { docs };
        },
      };
    },
    async get() { return { docs: [...records.keys()].filter((path) => path.startsWith(`${name}/`)).map(snapshot) }; },
  });
  const db = {
    collection,
    async runTransaction(run) {
      return run({
        create(ref, data) { if (records.has(ref.path)) throw new Error('exists'); records.set(ref.path, data); },
        set(ref, data) { records.set(ref.path, data); },
        update(ref, data) { records.set(ref.path, { ...(records.get(ref.path) || {}), ...data }); },
      });
    },
  };
  const tokenUids = { 'admin-token': 'admin-1', 'manager-token': 'manager-1' };
  const auth = {
    async verifyIdToken(token) { const user = authUsers.get(tokenUids[token]); if (!user) throw new Error('bad token'); return { uid: user.uid, ...user.customClaims }; },
    async getUser(uid) { return authUsers.get(uid); },
    async getUserByEmail(email) { const user = [...authUsers.values()].find((item) => item.email === email); if (!user) throw new Error('missing'); return user; },
    async setCustomUserClaims(uid, claims) { authUsers.get(uid).customClaims = claims; },
  };
  return { auth, db, records, getAdmin: () => ({ auth, db }) };
}

function response() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

async function call(handler, method, token, body) {
  const res = response();
  await handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
  return res;
}

const branch = (code) => ({ name: `Branch ${code}`, code, barangay: 'Poblacion', city: 'Toledo City', address: `${code} Main Street`, latitude: 10.267, longitude: 123.584 });

test('legacy Manager promotion endpoint is retired', async () => {
  const f = fixture();
  const branches = createAdminBranchesHandler(f.getAdmin);
  const managers = createAdminManagersHandler(f.getAdmin);
  assert.equal((await call(branches, 'POST', 'admin-token', branch('A1'))).statusCode, 201);
  const result = await call(managers, 'POST', 'admin-token', { identifier: 'manager@example.test', branchId: 'a1' });
  assert.equal(result.statusCode, 405);
  assert.equal(f.records.get('users/manager-1').role, 'requester');
});

test('new Toledo City branches receive the configured normal delivery radius and reject unsupported locations', async () => {
  const f = fixture(); const branches = createAdminBranchesHandler(f.getAdmin);
  const created = await call(branches, 'POST', 'admin-token', branch('RADIUS'));
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.branch.city, 'Toledo City');
  assert.equal(created.body.branch.serviceRadiusKm, 5);
  assert.equal(created.body.branch.active, true);
  const invalidBarangay = await call(branches, 'POST', 'admin-token', { ...branch('BAD-BGY'), barangay: 'Not a Toledo barangay' });
  assert.equal(invalidBarangay.statusCode, 400);
  assert.equal(invalidBarangay.body.error.reason, 'INVALID_TOLEDO_BARANGAY');
  const invalidCity = await call(branches, 'POST', 'admin-token', { ...branch('BAD-CITY'), city: 'Cebu City' });
  assert.equal(invalidCity.statusCode, 400);
  assert.equal(invalidCity.body.error.reason, 'UNSUPPORTED_BRANCH_CITY');
});

test('Manager context derives its active Branch and rejects cross-branch or inactive access', async () => {
  const f = fixture();
  f.records.set('branches/a', { ...branch('A'), status: 'active' });
  f.records.set('branches/b', { ...branch('B'), status: 'active' });
  f.records.set('users/manager-1', { ...f.records.get('users/manager-1'), role: 'manager', managerStatus: 'active', branchId: 'a' });
  await f.auth.setCustomUserClaims('manager-1', { role: 'manager', manager: true });
  const context = await requireActiveManager({ headers: { authorization: 'Bearer manager-token' } }, f.auth, f.db);
  assert.equal(requireManagerBranch(context, 'a'), 'a');
  assert.throws(() => requireManagerBranch(context, 'b'), (error) => error.reason === 'BRANCH_ACCESS_DENIED');

  f.records.set('users/manager-1', { ...f.records.get('users/manager-1'), managerStatus: 'inactive' });
  await assert.rejects(requireActiveManager({ headers: { authorization: 'Bearer manager-token' } }, f.auth, f.db), (error) => error.reason === 'MANAGER_INACTIVE');

  f.records.set('users/manager-1', { ...f.records.get('users/manager-1'), managerStatus: 'active' });
  f.records.set('branches/a', { ...f.records.get('branches/a'), status: 'inactive' });
  await assert.rejects(requireActiveManager({ headers: { authorization: 'Bearer manager-token' } }, f.auth, f.db), (error) => error.reason === 'BRANCH_INACTIVE');
});

test('Manager cannot call Admin branch or Manager-management endpoints', async () => {
  const f = fixture();
  f.records.set('users/manager-1', { ...f.records.get('users/manager-1'), role: 'manager', managerStatus: 'active', branchId: 'a' });
  await f.auth.setCustomUserClaims('manager-1', { role: 'manager', manager: true });
  const deniedBranch = await call(createAdminBranchesHandler(f.getAdmin), 'POST', 'manager-token', branch('NO'));
  const deniedManager = await call(createAdminManagersHandler(f.getAdmin), 'GET', 'manager-token');
  assert.equal(deniedBranch.statusCode, 403);
  assert.equal(deniedManager.statusCode, 403);
  assert.equal(deniedManager.body.error.reason, 'ADMIN_REQUIRED');
});
