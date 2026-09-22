const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdminDistributorsHandler } = require('../distributorManagementHandler');

function fixture() {
  const records = new Map([
    ['users/admin-1', { role: 'admin', email: 'admin@example.test' }],
    ['users/pending-distributor', { role: 'distributor', fullName: 'Pending Driver', distributorStatus: 'pending', approvalStatus: 'pending', status: 'Pending', requestedBranchId: 'north', requestedBranchNameSnapshot: 'North' }],
    ['users/other-pending', { role: 'distributor', fullName: 'Other Driver', distributorStatus: 'pending', approvalStatus: 'pending', status: 'Pending', requestedBranchId: 'inactive' }],
    ['branches/north', { name: 'North', status: 'active' }],
    ['branches/south', { name: 'South', status: 'active' }],
    ['branches/inactive', { name: 'Closed', status: 'inactive' }],
  ]);
  let autoId = 0;
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const docs = (name) => [...records.keys()].filter((path) => path.startsWith(`${name}/`)).map(snapshot);
  const collection = (name) => ({
    doc(id = `audit-${++autoId}`) { const path = `${name}/${id}`; return { id, path, get: async () => snapshot(path) }; },
    where(field, _operator, value) { return { get: async () => ({ docs: docs(name).filter((item) => item.data()?.[field] === value) }) }; },
    get: async () => ({ docs: docs(name) }),
  });
  const db = { collection, runTransaction: async (run) => run({ get: async (ref) => snapshot(ref.path), update(ref, data) { records.set(ref.path, { ...records.get(ref.path), ...data }); }, set(ref, data) { records.set(ref.path, data); } }) };
  const auth = { verifyIdToken: async () => ({ uid: 'admin-1', admin: true, role: 'admin' }) };
  return { records, handler: createAdminDistributorsHandler(() => ({ auth, db })) };
}
function response() { return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; }, end() {} }; }
async function call(handler, body) { const res = response(); await handler({ method: 'POST', headers: { authorization: 'Bearer admin-token' }, body }, res); return res; }

test('Admin approval atomically assigns the requested active branch and preserves application history', async () => {
  const f = fixture(); const result = await call(f.handler, { uid: 'pending-distributor', action: 'approve' });
  assert.equal(result.statusCode, 200);
  const profile = f.records.get('users/pending-distributor');
  assert.equal(profile.distributorStatus, 'active'); assert.equal(profile.branchId, 'north'); assert.equal(profile.requestedBranchId, 'north');
  assert.equal(profile.approvedBy, 'admin-1');
  assert.ok([...f.records.values()].some((entry) => entry.action === 'DISTRIBUTOR_APPROVED' && entry.branchId === 'north'));
});

test('Admin can choose a different active branch at approval, but cannot approve to an inactive branch', async () => {
  const f = fixture(); const different = await call(f.handler, { uid: 'pending-distributor', action: 'approve', branchId: 'south' });
  assert.equal(different.statusCode, 200); assert.equal(f.records.get('users/pending-distributor').branchId, 'south');
  const inactive = await call(f.handler, { uid: 'other-pending', action: 'approve', branchId: 'inactive' });
  assert.equal(inactive.statusCode, 409); assert.equal(inactive.body.error.reason, 'BRANCH_INACTIVE');
  assert.equal(f.records.get('users/other-pending').distributorStatus, 'pending');
});

test('Admin rejection keeps requested-branch history and clears operational branch assignment', async () => {
  const f = fixture(); const result = await call(f.handler, { uid: 'pending-distributor', action: 'reject', rejectionReason: 'Coverage is full.' });
  assert.equal(result.statusCode, 200); const profile = f.records.get('users/pending-distributor');
  assert.equal(profile.distributorStatus, 'rejected'); assert.equal(profile.branchId, null); assert.equal(profile.requestedBranchId, 'north');
  assert.ok([...f.records.values()].some((entry) => entry.action === 'DISTRIBUTOR_REJECTED' && entry.rejectionReason === 'Coverage is full.'));
});

test('Admin Distributor list returns requested and assigned branch display data only', async () => {
  const f = fixture(); const res = response(); await f.handler({ method: 'GET', headers: { authorization: 'Bearer admin-token' } }, res);
  assert.equal(res.statusCode, 200); const pending = res.body.distributors.find((item) => item.uid === 'pending-distributor');
  assert.equal(pending.requestedBranchName, 'North'); assert.equal(pending.branchId, '');
});
