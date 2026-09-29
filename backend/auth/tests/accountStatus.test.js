const assert = require('node:assert/strict');
const test = require('node:test');

const {
  accountStatusFlags,
  canonicalAccountStatus,
  requireActiveAccount,
} = require('../accountStatus');
const { requireAdmin, requireRequester } = require('../authorization');

test('canonical accountStatus distinguishes every supported global state', () => {
  assert.equal(canonicalAccountStatus({ accountStatus: 'active' }), 'active');
  assert.equal(canonicalAccountStatus({ accountStatus: 'inactive' }), 'inactive');
  assert.equal(canonicalAccountStatus({ accountStatus: 'suspended' }), 'suspended');
  assert.equal(canonicalAccountStatus({ accountStatus: 'terminated' }), 'terminated');
  assert.deepEqual(accountStatusFlags({ accountStatus: 'suspended' }), {
    status: 'suspended', active: false, inactive: false, suspended: true, terminated: false,
  });
});

test('legacy accountStatus fallback preserves safe existing role behavior', () => {
  assert.equal(canonicalAccountStatus({ role: 'requester' }), 'active');
  assert.equal(canonicalAccountStatus({ role: 'requester', status: 'Inactive' }), 'inactive');
  assert.equal(canonicalAccountStatus({ role: 'manager', managerStatus: 'inactive' }), 'inactive');
  assert.equal(canonicalAccountStatus({ role: 'distributor', distributorStatus: 'pending' }), 'active');
  assert.equal(canonicalAccountStatus({ role: 'distributor', distributorStatus: 'rejected' }), 'active');
  assert.equal(canonicalAccountStatus({ role: 'distributor', distributorStatus: 'inactive' }), 'inactive');
  assert.equal(canonicalAccountStatus({ distributorStatus: 'pending', approvalStatus: 'terminated' }), 'terminated');
  assert.equal(canonicalAccountStatus({ accountStatus: 'unexpected-value' }), 'inactive');
});

test('active accounts pass while suspended and terminated remain distinguishable', () => {
  assert.equal(requireActiveAccount({ accountStatus: 'active' }), 'active');
  assert.throws(() => requireActiveAccount({ accountStatus: 'inactive' }), (error) => error.reason === 'ACCOUNT_INACTIVE');
  assert.throws(() => requireActiveAccount({ accountStatus: 'suspended' }), (error) => error.reason === 'ACCOUNT_SUSPENDED');
  assert.throws(() => requireActiveAccount({ accountStatus: 'terminated' }), (error) => error.reason === 'ACCOUNT_TERMINATED');
});

test('shared backend role guards reject terminated and suspended profiles', async () => {
  const auth = { verifyIdToken: async () => ({ uid: 'user-a', role: 'requester', admin: true }) };
  const dbFor = (profile) => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => profile }) }) }) });
  await assert.rejects(requireRequester({ headers: { authorization: 'Bearer token' } }, auth, dbFor({ role: 'requester', accountStatus: 'terminated' })), (error) => error.reason === 'ACCOUNT_TERMINATED');
  await assert.rejects(requireAdmin({ headers: { authorization: 'Bearer token' } }, auth, dbFor({ role: 'admin', accountStatus: 'suspended' })), (error) => error.reason === 'ACCOUNT_SUSPENDED');
});
