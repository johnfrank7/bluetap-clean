const assert = require('node:assert/strict');
const test = require('node:test');

const { createManagerWorkspaceHandler } = require('../workspaceHandler');

function fixture() {
  const records = new Map([
    ['users/manager-north', { role: 'manager', managerStatus: 'active', branchId: 'north', fullName: 'North Manager' }],
    ['users/pending-north', { role: 'distributor', distributorStatus: 'pending', approvalStatus: 'pending', status: 'Pending', requestedBranchId: 'north', fullName: 'North Applicant' }],
    ['users/pending-south', { role: 'distributor', distributorStatus: 'pending', approvalStatus: 'pending', status: 'Pending', requestedBranchId: 'south', fullName: 'South Applicant' }],
    ['branches/north', { name: 'North', status: 'active' }],
    ['branches/south', { name: 'South', status: 'active' }],
    ['products/refill', { product_name: 'Refill', price: 35, active: true, deliveryDays: ['monday'], maxQuantityPerRequester: 10 }],
    ['requests/north-order', { requestId: 'BT-N', branchId: 'north', status: 'delivered', quantity: 2, totalAtOrder: 70 }],
    ['requests/south-order', { requestId: 'BT-S', branchId: 'south', status: 'delivered', quantity: 9, totalAtOrder: 315 }],
  ]);
  let nextId = 0;
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const docs = (name) => [...records.keys()].filter((path) => path.startsWith(`${name}/`)).map(snapshot);
  const collection = (name) => ({
    doc(id = `auto-${++nextId}`) {
      const path = `${name}/${id}`;
      return {
        id,
        path,
        get: async () => snapshot(path),
        collection: (subName) => collection(`${path}/${subName}`),
      };
    },
    get: async () => ({ docs: docs(name) }),
    where(field, _operator, value) {
      return { get: async () => ({ docs: docs(name).filter((item) => item.data()?.[field] === value) }) };
    },
  });
  const db = {
    collection,
    runTransaction: async (run) => run({
      get: async (ref) => snapshot(ref.path),
      update(ref, value) { records.set(ref.path, { ...(records.get(ref.path) || {}), ...value }); },
      set(ref, value) { records.set(ref.path, value); },
    }),
  };
  const auth = {
    verifyIdToken: async (token) => token === 'north-token'
      ? { uid: 'manager-north', role: 'manager', manager: true }
      : Promise.reject(new Error('invalid token')),
  };
  return { records, getAdmin: () => ({ auth, db }) };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    getHeader() { return ''; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

async function call(handler, method, body) {
  const res = response();
  await handler({ method, headers: { authorization: 'Bearer north-token' }, body }, res);
  return res;
}

test('Manager product policy write is forced to the authenticated Manager branch', async () => {
  const f = fixture();
  const result = await call(createManagerWorkspaceHandler(f.getAdmin), 'POST', {
    action: 'updateProductPolicy',
    productId: 'refill',
    branchId: 'south',
    deliveryDays: ['tuesday', 'thursday'],
    maxQuantityPerRequester: 6,
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(f.records.get('branches/north').productPolicyOverrides.refill.deliveryDays, ['tuesday', 'thursday']);
  assert.equal(f.records.get('branches/north').productPolicyOverrides.refill.maxQuantityPerRequester, 6);
  assert.equal(f.records.get('branches/south').productPolicyOverrides, undefined);
  assert.ok([...f.records.values()].some((record) => record.action === 'MANAGER_BRANCH_PRODUCT_POLICY_UPDATED' && record.branchId === 'north'));
});

test('Manager workspace analytics and product policy are scoped to the own branch', async () => {
  const f = fixture();
  f.records.set('branches/north', {
    ...f.records.get('branches/north'),
    productPolicyOverrides: { refill: { deliveryDays: ['friday'], maxQuantityPerRequester: 4 } },
  });
  const result = await call(createManagerWorkspaceHandler(f.getAdmin), 'GET');

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.orders.map((order) => order.requestId), ['BT-N']);
  assert.deepEqual(result.body.products[0].effectivePolicy.deliveryDays, ['friday']);
  assert.equal(result.body.products[0].effectivePolicy.maxQuantityPerRequester, 4);
});

test('Manager approval activates only a pending Distributor requesting the authoritative Manager branch', async () => {
  const f = fixture();
  const result = await call(createManagerWorkspaceHandler(f.getAdmin), 'POST', {
    action: 'approveDistributor',
    distributorUid: 'pending-north',
    branchId: 'south',
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.idempotent, false);
  const profile = f.records.get('users/pending-north');
  assert.equal(profile.distributorStatus, 'active');
  assert.equal(profile.branchId, 'north');
  assert.equal(profile.requestedBranchId, 'north');
  assert.equal(profile.branchMembershipVersion, 2);
  assert.equal(profile.approvedBy, 'manager-north');
  assert.ok([...f.records.values()].some((record) => record.action === 'MANAGER_DISTRIBUTOR_APPROVED' && record.branchId === 'north'));
});

test('Manager Distributor approval safely returns the existing own-branch approval on retry', async () => {
  const f = fixture();
  const handler = createManagerWorkspaceHandler(f.getAdmin);
  const body = { action: 'approveDistributor', distributorUid: 'pending-north' };
  assert.equal((await call(handler, 'POST', body)).statusCode, 200);
  const retried = await call(handler, 'POST', body);

  assert.equal(retried.statusCode, 200);
  assert.equal(retried.body.idempotent, true);
  assert.equal(f.records.get('users/pending-north').branchMembershipVersion, 2);
  assert.equal([...f.records.values()].filter((record) => record.action === 'MANAGER_DISTRIBUTOR_APPROVED').length, 1);
});

test('Manager Distributor approval rejects another branch and inactive Manager or branch authority', async () => {
  const f = fixture();
  const handler = createManagerWorkspaceHandler(f.getAdmin);
  const outsideBranch = await call(handler, 'POST', { action: 'approveDistributor', distributorUid: 'pending-south' });
  assert.equal(outsideBranch.statusCode, 403);
  assert.equal(outsideBranch.body.error.reason, 'BRANCH_ACCESS_DENIED');
  assert.equal(f.records.get('users/pending-south').distributorStatus, 'pending');

  f.records.set('users/manager-north', { ...f.records.get('users/manager-north'), accountStatus: 'inactive' });
  const inactiveAccount = await call(handler, 'POST', { action: 'approveDistributor', distributorUid: 'pending-north' });
  assert.equal(inactiveAccount.statusCode, 403);
  assert.equal(inactiveAccount.body.error.reason, 'MANAGER_INACTIVE');

  f.records.set('users/manager-north', { ...f.records.get('users/manager-north'), accountStatus: 'active' });
  f.records.set('users/manager-north', { ...f.records.get('users/manager-north'), managerStatus: 'inactive' });
  const inactiveManager = await call(handler, 'POST', { action: 'approveDistributor', distributorUid: 'pending-north' });
  assert.equal(inactiveManager.statusCode, 403);
  assert.equal(inactiveManager.body.error.reason, 'MANAGER_INACTIVE');

  f.records.set('users/manager-north', { ...f.records.get('users/manager-north'), managerStatus: 'active' });
  f.records.set('branches/north', { ...f.records.get('branches/north'), status: 'inactive' });
  const inactiveBranch = await call(handler, 'POST', { action: 'approveDistributor', distributorUid: 'pending-north' });
  assert.equal(inactiveBranch.statusCode, 403);
  assert.equal(inactiveBranch.body.error.reason, 'BRANCH_INACTIVE');
});

test('Manager delivery pricing update is scoped to own branch and audited', async () => {
  const f = fixture();
  const handler = createManagerWorkspaceHandler(f.getAdmin);
  const result = await call(handler, 'POST', {
    action: 'updateDeliveryPricing',
    baseDeliveryFee: 45,
    includedRadiusKm: 4,
    outsideRadiusFeePerKm: 12,
    serviceRadiusKm: 15,
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.branchId, 'north');
  assert.equal(result.body.pricing.baseDeliveryFee, 45);
  const northBranch = f.records.get('branches/north');
  assert.equal(northBranch.baseDeliveryFee, 45);
  assert.equal(northBranch.includedRadiusKm, 4);
  assert.equal(northBranch.outsideRadiusFeePerKm, 12);
  assert.equal(northBranch.serviceRadiusKm, 15);
  assert.ok([...f.records.values()].some((r) => r.action === 'MANAGER_BRANCH_DELIVERY_PRICING_UPDATED' && r.branchId === 'north'));
});

test('Manager branch suspension and restoration are branch-scoped and audited', async () => {
  const f = fixture();
  f.records.set('users/requester-test', { role: 'requester', fullName: 'Test Requester', accountStatus: 'active' });
  f.records.set('users/admin-test', { role: 'admin', fullName: 'Test Admin', accountStatus: 'active' });
  f.records.set('users/dist-south', { role: 'distributor', branchId: 'south', distributorStatus: 'active' });
  f.records.set('users/dist-north', { role: 'distributor', branchId: 'north', distributorStatus: 'active' });

  const handler = createManagerWorkspaceHandler(f.getAdmin);

  // Privileged target rejected
  const privResult = await call(handler, 'POST', { action: 'suspendBranchUser', targetUid: 'admin-test', reason: 'Misconduct' });
  assert.equal(privResult.statusCode, 403);
  assert.equal(privResult.body.error.reason, 'PRIVILEGED_TARGET_FORBIDDEN');

  // Cross-branch distributor rejected
  const crossDist = await call(handler, 'POST', { action: 'suspendBranchUser', targetUid: 'dist-south', reason: 'Misconduct' });
  assert.equal(crossDist.statusCode, 403);
  assert.equal(crossDist.body.error.reason, 'CROSS_BRANCH_FORBIDDEN');

  // Missing reason rejected
  const noReason = await call(handler, 'POST', { action: 'suspendBranchUser', targetUid: 'requester-test' });
  assert.equal(noReason.statusCode, 400);
  assert.equal(noReason.body.error.reason, 'REASON_REQUIRED');

  // Invalid structured reason code rejected
  const badReason = await call(handler, 'POST', { action: 'suspendBranchUser', targetUid: 'requester-test', reasonCode: 'invalid_code' });
  assert.equal(badReason.statusCode, 400);
  assert.equal(badReason.body.error.reason, 'INVALID_SUSPENSION_REASON');

  // Suspend own-branch requester with structured reason code
  const suspReq = await call(handler, 'POST', { action: 'suspendBranchUser', targetUid: 'requester-test', reasonCode: 'suspected_fraud' });
  assert.equal(suspReq.statusCode, 200);
  const updatedReq = f.records.get('users/requester-test');
  assert.equal(updatedReq.branchSuspensions?.north?.suspended, true);
  assert.equal(updatedReq.branchSuspensions?.north?.reasonCode, 'suspected_fraud');
  assert.equal(updatedReq.branchSuspensions?.north?.reason, 'Suspected fraud or scam');
  assert.ok([...f.records.values()].some((r) => r.action === 'MANAGER_REQUESTER_BRANCH_SUSPENDED' && r.targetUid === 'requester-test'));
  assert.ok([...f.records.keys()].some((k) => k.startsWith('moderationNotices/requester-test/items/')));
  assert.ok(f.records.has('moderationActivity/user_requester-test'));

  // Restore requester
  const restReq = await call(handler, 'POST', { action: 'restoreBranchUser', targetUid: 'requester-test', reason: 'Resolved' });
  assert.equal(restReq.statusCode, 200);
  assert.equal(f.records.get('users/requester-test').branchSuspensions?.north, undefined);
  assert.ok([...f.records.values()].some((r) => r.action === 'MANAGER_REQUESTER_BRANCH_RESTORED' && r.targetUid === 'requester-test'));

  // Suspend own-branch distributor with structured reason
  const suspDist = await call(handler, 'POST', { action: 'suspendBranchUser', targetUid: 'dist-north', reasonCode: 'branch_policy_violation' });
  assert.equal(suspDist.statusCode, 200);
  assert.equal(f.records.get('users/dist-north').distributorStatus, 'suspended');
  assert.equal(f.records.get('users/dist-north').branchSuspended, true);
  assert.equal(f.records.get('users/dist-north').branchSuspensionReasonCode, 'branch_policy_violation');
  assert.equal(f.records.get('users/dist-north').branchSuspensionReason, 'Branch policy violation');
  assert.ok([...f.records.values()].some((r) => r.action === 'MANAGER_DISTRIBUTOR_SUSPENDED' && r.targetUid === 'dist-north'));

  // Restore own-branch distributor
  const restDist = await call(handler, 'POST', { action: 'restoreBranchUser', targetUid: 'dist-north', reason: 'Reinstated' });
  assert.equal(restDist.statusCode, 200);
  assert.equal(f.records.get('users/dist-north').distributorStatus, 'active');
  assert.equal(f.records.get('users/dist-north').branchSuspended, false);
  assert.ok([...f.records.values()].some((r) => r.action === 'MANAGER_DISTRIBUTOR_RESTORED' && r.targetUid === 'dist-north'));
});

test('Manager workspace POST safely parses raw JSON string body without 400', async () => {
  const f = fixture();
  const handler = createManagerWorkspaceHandler(f.getAdmin);

  // Stringified delivery pricing payload (as received from HTTP body parser)
  const rawPricingBody = JSON.stringify({
    action: 'updateDeliveryPricing',
    baseDeliveryFee: 45,
    includedRadiusKm: 5,
    outsideRadiusFeePerKm: 15,
    serviceRadiusKm: 20,
  });

  const res = await call(handler, 'POST', rawPricingBody);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.branchId, 'north');
  assert.equal(res.body.pricing.baseDeliveryFee, 45);
  const north = f.records.get('branches/north');
  assert.equal(north.baseDeliveryFee, 45);
  assert.equal(north.outsideRadiusFeePerKm, 15);
});
