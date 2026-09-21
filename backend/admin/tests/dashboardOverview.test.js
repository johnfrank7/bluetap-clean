const assert = require('node:assert/strict');
const test = require('node:test');

const { createAdminDashboardOverviewHandler } = require('../dashboardOverviewHandler');

function fixture() {
  const records = new Map([
    ['users/admin-1', { role: 'admin' }],
    ['users/manager-1', { role: 'manager', managerStatus: 'active', branchId: 'north', fullName: 'North Manager', createdAt: new Date('2026-01-03') }],
    ['users/requester-1', { role: 'requester', accountStatus: 'inactive', fullName: 'Requester One', createdAt: new Date('2026-01-02') }],
    ['users/distributor-1', { role: 'distributor', approvalStatus: 'pending', fullName: 'Distributor One', createdAt: new Date('2026-01-04') }],
    ['branches/north', { name: 'North', code: 'NORTH', city: 'Toledo', status: 'active', createdAt: new Date('2026-01-01') }],
    ['branches/south', { name: 'South', code: 'SOUTH', city: 'Toledo', status: 'inactive', createdAt: new Date('2025-12-01') }],
    ['systemConfig/registrationSecurity', {
      faceVerificationEnabled: true, emailOtpEnabled: true, maxAccountsPerDevice: 3, maxAccountsPerIp: 4,
      sessionSecurity: {
        requester: { idleTimeoutMinutes: 30, absoluteSessionHours: 24, forceLogoutAfterPasswordChange: true },
        distributor: { idleTimeoutMinutes: 30, absoluteSessionHours: 24, forceLogoutAfterPasswordChange: true },
        manager: { idleTimeoutMinutes: 15, absoluteSessionHours: 24, forceLogoutAfterPasswordChange: true },
      },
    }],
  ]);
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const db = { collection(name) { return {
    doc(id) { return { get: async () => snapshot(`${name}/${id}`) }; },
    async get() { return { docs: [...records.keys()].filter((path) => path.startsWith(`${name}/`)).map(snapshot) }; },
  }; } };
  const auth = { async verifyIdToken(token) {
    if (token === 'admin-token') return { uid: 'admin-1', admin: true, role: 'admin' };
    if (token === 'manager-token') return { uid: 'manager-1', manager: true, role: 'manager' };
    throw new Error('bad token');
  } };
  return { getAdmin: () => ({ auth, db }) };
}

function response() {
  return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
}

async function call(handler, token) {
  const res = response();
  await handler({ method: 'GET', headers: { authorization: `Bearer ${token}` } }, res);
  return res;
}

test('dashboard overview consolidates only lightweight Admin summary data', async () => {
  const handler = createAdminDashboardOverviewHandler(fixture().getAdmin);
  const result = await call(handler, 'admin-token');
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.summary, {
    totalBranches: 2, activeBranches: 1, totalAccounts: 3, activeAccounts: 2,
    managers: 1, requesters: 1, distributors: 1, pendingDistributors: 1,
  });
  assert.equal(result.body.branches[0].managerCount, 1);
  assert.equal(result.body.security.maxAccountsPerIp, 4);
  assert.equal(result.body.recentActivity.length, 5);
  assert.equal(Object.hasOwn(result.body, 'accounts'), false);
});

test('dashboard overview preserves server-side Admin authorization', async () => {
  const handler = createAdminDashboardOverviewHandler(fixture().getAdmin);
  const result = await call(handler, 'manager-token');
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.reason, 'ADMIN_REQUIRED');
});
