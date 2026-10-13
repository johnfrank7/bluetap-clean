const assert = require('node:assert/strict');
const test = require('node:test');

const { requireAdmin, requireRequester, requireActiveDistributor, requireActiveManager, verifiedIdentity } = require('../authorization');
const { requireActiveAccount, ACCOUNT_STATUS } = require('../accountStatus');
const { createAdminAccountsHandler } = require('../../admin/accountManagementHandler');
const { createRequesterOrdersHandler, createRequesterCatalogHandler } = require('../../requester/orderingHandler');
const { createDistributorAssignedOrdersHandler } = require('../../distributor/assignedOrdersHandler');
const { createManagerDispatchHandler } = require('../../manager/dispatchHandler');
const { createManagerWorkspaceHandler } = require('../../manager/workspaceHandler');
const { createOrderDetailsHandler } = require('../../orders/orderDetailsHandler');
const { createModerationNoticesHandler } = require('../../moderation/moderationHandler');

function request({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  return {
    method,
    url,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body,
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

function buildFixture(options = {}) {
  const records = new Map([
    ['users/admin-1', {
      uid: 'admin-1',
      role: 'admin',
      fullName: 'Super Admin',
      email: 'admin@example.test',
      publicUid: 'ADM-0001',
      accountStatus: 'active',
    }],
    ['users/admin-target', {
      uid: 'admin-target',
      role: 'admin',
      fullName: 'Another Admin',
      email: 'admin2@example.test',
      publicUid: 'ADM-0002',
      accountStatus: 'active',
    }],
    ['users/requester-active', {
      uid: 'requester-active',
      role: 'requester',
      fullName: 'Rita Active',
      email: 'rita@example.test',
      publicUid: 'REQ-0001',
      accountStatus: 'active',
      branchId: 'branch-north',
      phone: '09171234567',
      address: '123 Main St, Poblacion, Toledo',
      barangay: 'Poblacion',
      city: 'Toledo',
    }],
    ['users/requester-suspended', {
      uid: 'requester-suspended',
      role: 'requester',
      fullName: 'Sam Suspended',
      email: 'sam@example.test',
      publicUid: 'REQ-0002',
      accountStatus: 'suspended',
      branchId: 'branch-north',
      phone: '09171234568',
      address: '456 Side St, Poblacion, Toledo',
      barangay: 'Poblacion',
      city: 'Toledo',
    }],
    ['users/requester-2', {
      uid: 'requester-2',
      role: 'requester',
      fullName: 'Rachel Requester',
      email: 'rachel@example.test',
      publicUid: 'REQ-0003',
      accountStatus: 'active',
      branchId: 'branch-north',
      phone: '09171234569',
      address: '789 Other St, Poblacion, Toledo',
      barangay: 'Poblacion',
      city: 'Toledo',
    }],
    ['users/distributor-active', {
      uid: 'distributor-active',
      role: 'distributor',
      fullName: 'Dave Active',
      email: 'dave@example.test',
      publicUid: 'DST-0001',
      accountStatus: 'active',
      distributorStatus: 'active',
      approvalStatus: 'active',
      status: 'Active',
      branchId: 'branch-north',
      phone: '09179876543',
      address: '10 Delivery Rd, Toledo',
    }],
    ['users/distributor-suspended', {
      uid: 'distributor-suspended',
      role: 'distributor',
      fullName: 'Dan Suspended',
      email: 'dan@example.test',
      publicUid: 'DST-0002',
      accountStatus: 'suspended',
      distributorStatus: 'suspended',
      branchId: 'branch-north',
      phone: '09179876544',
      address: '11 Delivery Rd, Toledo',
    }],
    ['users/distributor-pending', {
      uid: 'distributor-pending',
      role: 'distributor',
      fullName: 'Paul Pending',
      email: 'paul@example.test',
      publicUid: 'DST-0003',
      accountStatus: 'active',
      distributorStatus: 'pending',
      approvalStatus: 'pending',
      requestedBranchId: 'branch-north',
      phone: '09179876545',
      address: '12 Delivery Rd, Toledo',
    }],
    ['users/distributor-branch-suspended', {
      uid: 'distributor-branch-suspended',
      role: 'distributor',
      fullName: 'Bella BranchSuspended',
      email: 'bella@example.test',
      publicUid: 'DST-0004',
      accountStatus: 'active',
      distributorStatus: 'suspended',
      branchSuspended: true,
      branchId: 'branch-north',
      branchSuspensions: {
        'branch-north': { suspended: true, reasonCode: 'CONDUCT_VIOLATION' },
      },
    }],
    ['users/distributor-south', {
      uid: 'distributor-south',
      role: 'distributor',
      fullName: 'Doug South',
      email: 'doug@example.test',
      publicUid: 'DST-0005',
      accountStatus: 'active',
      distributorStatus: 'active',
      approvalStatus: 'active',
      branchId: 'branch-south',
      phone: '09179876546',
      address: '20 South Delivery Rd, Toledo',
    }],
    ['users/manager-active', {
      uid: 'manager-active',
      role: 'manager',
      fullName: 'Manny Active',
      email: 'manny@example.test',
      publicUid: 'MGR-0001',
      accountStatus: 'active',
      managerStatus: 'active',
      branchId: 'branch-north',
    }],
    ['users/manager-suspended', {
      uid: 'manager-suspended',
      role: 'manager',
      fullName: 'Mark Suspended',
      email: 'mark@example.test',
      publicUid: 'MGR-0002',
      accountStatus: 'suspended',
      managerStatus: 'active',
      branchId: 'branch-north',
    }],
    ['users/manager-south', {
      uid: 'manager-south',
      role: 'manager',
      fullName: 'Mike South',
      email: 'mikesouth@example.test',
      publicUid: 'MGR-0003',
      accountStatus: 'active',
      managerStatus: 'active',
      branchId: 'branch-south',
    }],
    ['branches/branch-north', {
      id: 'branch-north',
      name: 'North Station',
      status: 'active',
      latitude: 10.3756,
      longitude: 123.6358,
      serviceRadiusKm: 5,
      deliveryPricing: {
        baseDeliveryFee: 20,
        includedRadiusKm: 2,
        outsideRadiusFeePerKm: 10,
        serviceRadiusKm: 5,
      },
    }],
    ['branches/branch-south', {
      id: 'branch-south',
      name: 'South Station',
      status: 'active',
      latitude: 10.3600,
      longitude: 123.6200,
      serviceRadiusKm: 5,
      deliveryPricing: {
        baseDeliveryFee: 25,
        includedRadiusKm: 2,
        outsideRadiusFeePerKm: 12,
        serviceRadiusKm: 5,
      },
    }],
    ['branches/branch-inactive', {
      id: 'branch-inactive',
      name: 'Inactive Station',
      status: 'inactive',
      latitude: 10.3500,
      longitude: 123.6100,
      serviceRadiusKm: 5,
    }],
    ['products/product-1', {
      id: 'product-1',
      product_name: 'Purified Water 5 Gal',
      price: 35,
      active: true,
      branchIds: ['branch-north', 'branch-south'],
    }],
    ['requests/order-1', {
      id: 'order-1',
      requestId: 'REQ-2026-0001',
      requesterUid: 'requester-active',
      requester_id: 'requester-active',
      branchId: 'branch-north',
      currentBranchId: 'branch-north',
      status: 'pending',
      quantity: 2,
      totalAtOrder: 90,
      createdAt: new Date().toISOString(),
    }],
    ['requests/order-assigned-1', {
      id: 'order-assigned-1',
      requestId: 'REQ-2026-0002',
      requesterUid: 'requester-active',
      requester_id: 'requester-active',
      branchId: 'branch-north',
      currentBranchId: 'branch-north',
      assignedDistributorUid: 'distributor-active',
      status: 'distributor_assigned',
      quantity: 1,
      totalAtOrder: 55,
      createdAt: new Date().toISOString(),
    }],
    ['requests/order-out-1', {
      id: 'order-out-1',
      requestId: 'REQ-2026-0003',
      requesterUid: 'requester-active',
      requester_id: 'requester-active',
      branchId: 'branch-north',
      currentBranchId: 'branch-north',
      assignedDistributorUid: 'distributor-active',
      status: 'out_for_delivery',
      quantity: 1,
      totalAtOrder: 55,
      createdAt: new Date().toISOString(),
    }],
    ['moderationNotices/requester-suspended/items/notice-1', {
      id: 'notice-1',
      type: 'suspend_account',
      title: 'Account suspended',
      category: 'ACCOUNT_SUSPENSION',
      scope: 'platform',
      reason: 'Safety policy violation',
      createdAt: new Date().toISOString(),
      acknowledgedAt: null,
      seenAt: null,
    }],
  ]);

  const authUsers = new Map([
    ['admin-1', { uid: 'admin-1', email: 'admin@example.test', customClaims: { admin: true, role: 'admin' }, disabled: false }],
    ['admin-target', { uid: 'admin-target', email: 'admin2@example.test', customClaims: { admin: true, role: 'admin' }, disabled: false }],
    ['requester-active', { uid: 'requester-active', email: 'rita@example.test', customClaims: {}, disabled: false }],
    ['requester-suspended', { uid: 'requester-suspended', email: 'sam@example.test', customClaims: {}, disabled: true }],
    ['requester-2', { uid: 'requester-2', email: 'rachel@example.test', customClaims: {}, disabled: false }],
    ['distributor-active', { uid: 'distributor-active', email: 'dave@example.test', customClaims: {}, disabled: false }],
    ['distributor-suspended', { uid: 'distributor-suspended', email: 'dan@example.test', customClaims: {}, disabled: true }],
    ['distributor-pending', { uid: 'distributor-pending', email: 'paul@example.test', customClaims: {}, disabled: false }],
    ['distributor-branch-suspended', { uid: 'distributor-branch-suspended', email: 'bella@example.test', customClaims: {}, disabled: false }],
    ['distributor-south', { uid: 'distributor-south', email: 'doug@example.test', customClaims: {}, disabled: false }],
    ['manager-active', { uid: 'manager-active', email: 'manny@example.test', customClaims: { manager: true, role: 'manager' }, disabled: false }],
    ['manager-suspended', { uid: 'manager-suspended', email: 'mark@example.test', customClaims: { manager: true, role: 'manager' }, disabled: true }],
    ['manager-south', { uid: 'manager-south', email: 'mikesouth@example.test', customClaims: { manager: true, role: 'manager' }, disabled: false }],
  ]);

  const revokedUids = [];
  let autoId = 0;

  const snapshot = (path) => ({
    id: path.split('/').pop(),
    exists: records.has(path),
    data: () => records.get(path),
  });

  const allDocs = (name) =>
    [...records.keys()]
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
          if (options.failFirestoreUpdate) throw new Error('Simulated Firestore update failure');
          records.set(path, { ...records.get(path), ...data });
        },
        set: async (data) => {
          if (options.failFirestoreSet) throw new Error('Simulated Firestore set failure');
          records.set(path, data);
        },
        delete: async () => {
          records.delete(path);
        },
        collection(subName) {
          return collection(`${path}/${subName}`);
        },
      };
    },
    where(field, op, value) {
      return {
        limit() { return this; },
        orderBy() { return this; },
        get: async () => {
          const docs = allDocs(name).filter((doc) => {
            const data = doc.data();
            if (op === '==' || !op) return data?.[field] === value;
            return true;
          });
          return { docs, empty: docs.length === 0 };
        },
      };
    },
    orderBy() {
      return {
        limit() { return this; },
        get: async () => ({ docs: allDocs(name), empty: allDocs(name).length === 0 }),
      };
    },
    get: async () => ({ docs: allDocs(name), empty: allDocs(name).length === 0 }),
  });

  const db = {
    collection,
    runTransaction: async (run) => {
      if (options.failFirestoreTransaction) {
        throw new Error('Simulated Firestore transaction failure');
      }
      return run({
        get: async (ref) => snapshot(ref.path),
        create(ref, data) {
          records.set(ref.path, data);
        },
        update(ref, data) {
          if (options.failFirestoreTxUpdate) throw new Error('Simulated Firestore tx update failure');
          records.set(ref.path, { ...records.get(ref.path), ...data });
        },
        set(ref, data) {
          records.set(ref.path, data);
        },
        delete(ref) {
          records.delete(ref.path);
        },
      });
    },
  };

  const auth = {
    verifyIdToken: async (token, checkRevoked = false) => {
      if (token === 'revoked-token') {
        const error = new Error('Token has been revoked');
        error.code = 'auth/id-token-revoked';
        throw error;
      }
      if (token === 'admin-token') return { uid: 'admin-1', role: 'admin', admin: true };
      if (token === 'admin-target-token') return { uid: 'admin-target', role: 'admin', admin: true };
      if (token === 'admin-stale-token') return { uid: 'requester-active', role: 'admin', admin: true };
      if (token === 'requester-token') return { uid: 'requester-active', role: 'requester' };
      if (token === 'requester-suspended-token') return { uid: 'requester-suspended', role: 'requester' };
      if (token === 'requester-2-token') return { uid: 'requester-2', role: 'requester' };
      if (token === 'distributor-token') return { uid: 'distributor-active', role: 'distributor' };
      if (token === 'distributor-suspended-token') return { uid: 'distributor-suspended', role: 'distributor' };
      if (token === 'distributor-pending-token') return { uid: 'distributor-pending', role: 'distributor' };
      if (token === 'distributor-branch-suspended-token') return { uid: 'distributor-branch-suspended', role: 'distributor' };
      if (token === 'distributor-south-token') return { uid: 'distributor-south', role: 'distributor' };
      if (token === 'manager-token') return { uid: 'manager-active', role: 'manager', manager: true };
      if (token === 'manager-suspended-token') return { uid: 'manager-suspended', role: 'manager', manager: true };
      if (token === 'manager-south-token') return { uid: 'manager-south', role: 'manager', manager: true };
      const err = new Error('Invalid authentication token');
      err.code = 'auth/argument-error';
      throw err;
    },
    getUser: async (uid) => authUsers.get(uid) || null,
    updateUser: async (uid, changes) => {
      if (options.failAuthUpdate) {
        throw new Error('Simulated Firebase Auth update failure');
      }
      const cur = authUsers.get(uid) || { uid };
      authUsers.set(uid, { ...cur, ...changes });
      return authUsers.get(uid);
    },
    revokeRefreshTokens: async (uid) => {
      if (options.failAuthRevoke) {
        throw new Error('Simulated Firebase Auth token revocation failure');
      }
      revokedUids.push(uid);
    },
    listUsers: async () => ({ users: [...authUsers.values()] }),
    setCustomUserClaims: async () => {},
  };

  return { records, authUsers, revokedUids, getAdmin: () => ({ auth, db }) };
}

// -----------------------------------------------------------------------------
// Category 1: Authentication & Sessions
// -----------------------------------------------------------------------------

test('1. Suspended account rejection with old valid token (returns 403 ACCOUNT_SUSPENDED)', async () => {
  const { getAdmin } = buildFixture();
  const { auth, db } = getAdmin();
  const req = request({ headers: { authorization: 'Bearer requester-suspended-token' } });

  await assert.rejects(
    async () => requireRequester(req, auth, db),
    (err) => err.status === 403 && err.reason === 'ACCOUNT_SUSPENDED'
  );
});

test('2. Revoked token rejected immediately via verifyIdToken(token, true) (returns 401 AUTHENTICATION_REQUIRED)', async () => {
  const { getAdmin } = buildFixture();
  const { auth } = getAdmin();
  const req = request({ headers: { authorization: 'Bearer revoked-token' } });

  await assert.rejects(
    async () => verifiedIdentity(req, auth),
    (err) => err.status === 401 && err.reason === 'AUTHENTICATION_REQUIRED'
  );
});

test('3. Active account preserves permissions', async () => {
  const { getAdmin } = buildFixture();
  const { auth, db } = getAdmin();

  const req = request({ headers: { authorization: 'Bearer requester-token' } });
  const requester = await requireRequester(req, auth, db);
  assert.equal(requester.decoded.uid, 'requester-active');
  assert.equal(requester.profile.role, 'requester');
});

test('4. Reactivated account restores original role permissions without privilege inflation', async () => {
  const fixture = buildFixture();
  const { records, getAdmin } = fixture;
  const { auth, db } = getAdmin();

  // Initially suspended
  const req = request({ headers: { authorization: 'Bearer requester-suspended-token' } });
  await assert.rejects(
    async () => requireRequester(req, auth, db),
    (err) => err.status === 403 && err.reason === 'ACCOUNT_SUSPENDED'
  );

  // Reactivate user in Firestore
  const user = records.get('users/requester-suspended');
  records.set('users/requester-suspended', { ...user, accountStatus: 'active' });

  // Now passes requireRequester
  const requester = await requireRequester(req, auth, db);
  assert.equal(requester.decoded.uid, 'requester-suspended');
  assert.equal(requester.profile.role, 'requester');

  // Does NOT have Admin permissions (no privilege inflation)
  await assert.rejects(
    async () => requireAdmin(req, auth, db),
    (err) => err.status === 403 && err.reason === 'ADMIN_REQUIRED'
  );
});

test('5. Token with stale role or branch claim rejected when Firestore profile is authoritative', async () => {
  const { getAdmin } = buildFixture();
  const { auth, db } = getAdmin();

  // Token claims admin: true and role: 'admin', but Firestore profile has role: 'requester'
  const req = request({ headers: { authorization: 'Bearer admin-stale-token' } });

  await assert.rejects(
    async () => requireAdmin(req, auth, db),
    (err) => err.status === 403 && err.reason === 'ADMIN_REQUIRED'
  );
});

// -----------------------------------------------------------------------------
// Category 2: Requester Restrictions
// -----------------------------------------------------------------------------

test('6. Suspended requester cannot place order (POST /api/requester/orders)', async () => {
  const { getAdmin } = buildFixture();
  const handler = createRequesterOrdersHandler(getAdmin);
  const req = request({
    method: 'POST',
    headers: { authorization: 'Bearer requester-suspended-token' },
    body: { productId: 'product-1', quantity: 1 },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'ACCOUNT_SUSPENDED');
});

test('7. Suspended requester cannot edit or cancel order (PATCH /api/requester/orders)', async () => {
  const { getAdmin } = buildFixture();
  const handler = createRequesterOrdersHandler(getAdmin);
  const req = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer requester-suspended-token' },
    body: { orderId: 'order-1', action: 'edit-order', quantity: 3 },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'ACCOUNT_SUSPENDED');
});

test('8. Suspended requester cannot view protected order catalog/products (GET /api/requester/catalog)', async () => {
  const { getAdmin } = buildFixture();
  const handler = createRequesterCatalogHandler(getAdmin);
  const req = request({
    method: 'GET',
    headers: { authorization: 'Bearer requester-suspended-token' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'ACCOUNT_SUSPENDED');
});

test("9. Suspended requester cannot view another requester's data or orders (GET /api/orders/details)", async () => {
  const { getAdmin } = buildFixture();
  const handler = createOrderDetailsHandler(getAdmin);
  const req = request({
    method: 'GET',
    url: '/api/orders/details?orderId=order-1',
    headers: { authorization: 'Bearer requester-suspended-token' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'ACCOUNT_SUSPENDED');
});

test('10. Suspended requester can view their moderation notices (GET /api/moderation/notices)', async () => {
  const { getAdmin } = buildFixture();
  const handler = createModerationNoticesHandler(getAdmin);
  const req = request({
    method: 'GET',
    headers: { authorization: 'Bearer requester-suspended-token' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert(Array.isArray(res.body?.notices));
  assert.equal(res.body.notices.length, 1);
  assert.equal(res.body.notices[0].type, 'suspend_account');
});

// -----------------------------------------------------------------------------
// Category 3: Distributor Restrictions
// -----------------------------------------------------------------------------

test('11. Suspended distributor cannot accept assigned delivery (PATCH /api/distributor/orders)', async () => {
  const { getAdmin } = buildFixture();
  const handler = createDistributorAssignedOrdersHandler(getAdmin);
  const req = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer distributor-suspended-token' },
    body: { orderId: 'order-assigned-1', action: 'accept-assignment' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'ACCOUNT_SUSPENDED');
});

test('12. Suspended distributor cannot start delivery or schedule delivery', async () => {
  const { getAdmin } = buildFixture();
  const handler = createDistributorAssignedOrdersHandler(getAdmin);
  const req = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer distributor-suspended-token' },
    body: { orderId: 'order-assigned-1', action: 'start-delivery' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'ACCOUNT_SUSPENDED');
});

test('13. Suspended distributor cannot mark delivered or report delivery failure', async () => {
  const { getAdmin } = buildFixture();
  const handler = createDistributorAssignedOrdersHandler(getAdmin);
  const req = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer distributor-suspended-token' },
    body: { orderId: 'order-out-1', action: 'mark-delivered' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'ACCOUNT_SUSPENDED');
});

test('14. Branch-restricted distributor cannot operate outside policy', async () => {
  const { getAdmin } = buildFixture();
  const { auth, db } = getAdmin();
  const req = request({ headers: { authorization: 'Bearer distributor-branch-suspended-token' } });

  // Distributor whose branch status is suspended fails requireActiveDistributor
  await assert.rejects(
    async () => requireActiveDistributor(req, auth, db),
    (err) => err.status === 403 && err.reason === 'DISTRIBUTOR_INACTIVE'
  );
});

test('15. Reassigned distributor cannot accept orders from former branch', async () => {
  const { getAdmin } = buildFixture();
  const handler = createDistributorAssignedOrdersHandler(getAdmin);

  // Doug South belongs to branch-south, trying to act on order-assigned-1 (which belongs to branch-north)
  const req = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer distributor-south-token' },
    body: { orderId: 'order-assigned-1', action: 'accept-assignment' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body?.error?.reason, 'ORDER_NOT_FOUND');
});

test('16. Pending distributor applicant cannot accept deliveries before approval', async () => {
  const { getAdmin } = buildFixture();
  const handler = createDistributorAssignedOrdersHandler(getAdmin);
  const req = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer distributor-pending-token' },
    body: { orderId: 'order-assigned-1', action: 'accept-assignment' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'DISTRIBUTOR_INACTIVE');
});

// -----------------------------------------------------------------------------
// Category 4: Manager Restrictions
// -----------------------------------------------------------------------------

test('17. Suspended manager cannot dispatch orders (PATCH /api/manager/dispatch-orders)', async () => {
  const { getAdmin } = buildFixture();
  const handler = createManagerDispatchHandler(getAdmin);
  const req = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer manager-suspended-token' },
    body: { orderId: 'order-1', action: 'assign-distributor', distributorUid: 'distributor-active' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'ACCOUNT_SUSPENDED');
});

test('18. Suspended manager cannot initiate branch transfers', async () => {
  const { getAdmin } = buildFixture();
  const handler = createManagerDispatchHandler(getAdmin);
  const req = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer manager-suspended-token' },
    body: { orderId: 'order-1', action: 'request-transfer', targetBranchId: 'branch-south', transferReason: 'Out of stock' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'ACCOUNT_SUSPENDED');
});

test('19. Suspended manager cannot approve or reject distributor applications', async () => {
  const { getAdmin } = buildFixture();
  const handler = createManagerWorkspaceHandler(getAdmin);
  const req = request({
    method: 'POST',
    headers: { authorization: 'Bearer manager-suspended-token' },
    body: { action: 'approveDistributor', distributorUid: 'distributor-pending' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'ACCOUNT_SUSPENDED');
});

test('20. Manager cannot modify users/orders of another branch (cross-branch isolation)', async () => {
  const { getAdmin } = buildFixture();
  const handler = createManagerWorkspaceHandler(getAdmin);

  // Manny Active manages branch-north, attempts to suspend distributor-south (assigned to branch-south)
  const req = request({
    method: 'POST',
    headers: { authorization: 'Bearer manager-token' },
    body: {
      action: 'suspendBranchUser',
      targetUid: 'distributor-south',
      reasonCode: 'branch_policy_violation',
    },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'CROSS_BRANCH_FORBIDDEN');
});

test('21. Manager cannot override global account suspension', async () => {
  const { getAdmin } = buildFixture();
  const handler = createManagerWorkspaceHandler(getAdmin);

  // Manny Active attempts to restore a globally suspended user at branch level
  const req = request({
    method: 'POST',
    headers: { authorization: 'Bearer manager-token' },
    body: {
      action: 'restoreBranchUser',
      targetUid: 'distributor-suspended',
      reason: 'Attempting branch restoration of globally suspended account',
    },
  });
  const res = response();
  await handler(req, res);

  // Fails with 409 ACCOUNT_GLOBALLY_SUSPENDED
  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.error?.reason, 'ACCOUNT_GLOBALLY_SUSPENDED');
});

test('22. Manager cannot approve a pending distributor into a different branch', async () => {
  const { getAdmin } = buildFixture();
  const handler = createManagerWorkspaceHandler(getAdmin);

  // Mike South (manager of branch-south) attempts to approve distributor-pending (requested branch-north)
  const req = request({
    method: 'POST',
    headers: { authorization: 'Bearer manager-south-token' },
    body: {
      action: 'approveDistributor',
      distributorUid: 'distributor-pending',
    },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'BRANCH_ACCESS_DENIED');
});

// -----------------------------------------------------------------------------
// Category 5: Admin Safeguards & Idempotency
// -----------------------------------------------------------------------------

test('23. Non-admin cannot invoke suspension or reactivation endpoints (POST /api/admin/accounts)', async () => {
  const { getAdmin } = buildFixture();
  const handler = createAdminAccountsHandler(getAdmin);

  // Requester attempting admin endpoint
  const req = request({
    method: 'POST',
    headers: { authorization: 'Bearer requester-token' },
    body: { uid: 'requester-suspended', action: 'reactivate' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'ADMIN_REQUIRED');
});

test('24. Admin cannot suspend themselves (self-suspension safeguard)', async () => {
  const { getAdmin } = buildFixture();
  const handler = createAdminAccountsHandler(getAdmin);

  const req = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer admin-token' },
    body: { uid: 'admin-1', action: 'suspend', reason: 'Self testing' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error?.reason, 'SELF_ACTION_FORBIDDEN');
});

test('25. Admin cannot suspend another Admin', async () => {
  const { getAdmin } = buildFixture();
  const handler = createAdminAccountsHandler(getAdmin);

  const req = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer admin-token' },
    body: { uid: 'admin-target', action: 'suspend', reason: 'Testing admin target' },
  });
  const res = response();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.reason, 'ADMIN_TARGET_FORBIDDEN');
});

test('26. Duplicate suspend/reactivate requests succeed idempotently without creating duplicate moderation notices or corrupting state', async () => {
  const fixture = buildFixture();
  const { records, getAdmin } = fixture;
  const handler = createAdminAccountsHandler(getAdmin);

  // 1st suspend call on requester-active
  const req1 = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer admin-token' },
    body: { uid: 'requester-active', action: 'suspend', reason: 'Conduct check' },
  });
  const res1 = response();
  await handler(req1, res1);

  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body?.account?.status, 'suspended');

  const countNoticesAfterFirst = [...records.keys()].filter((k) => k.startsWith('moderationNotices/requester-active/')).length;
  assert.equal(countNoticesAfterFirst, 1);

  // 2nd suspend call (duplicate)
  const req2 = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer admin-token' },
    body: { uid: 'requester-active', action: 'suspend', reason: 'Conduct check duplicate' },
  });
  const res2 = response();
  await handler(req2, res2);

  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body?.changed, false);

  // Notices count did not increase
  const countNoticesAfterSecond = [...records.keys()].filter((k) => k.startsWith('moderationNotices/requester-active/')).length;
  assert.equal(countNoticesAfterSecond, 1);
});

// -----------------------------------------------------------------------------
// Category 6: Consistency & Partial Failure Resilience
// -----------------------------------------------------------------------------

test('27. Auth succeeds, Firestore write fails: simulated failure preserves consistency', async () => {
  // Setup fixture where runTransaction throws
  const fixture = buildFixture({ failFirestoreTransaction: true });
  const { getAdmin } = fixture;
  const handler = createAdminAccountsHandler(getAdmin);

  const req = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer admin-token' },
    body: { uid: 'requester-active', action: 'suspend', reason: 'Testing transaction error' },
  });
  const res = response();
  await handler(req, res);

  // Request should fail cleanly (500)
  assert.equal(res.statusCode, 500);
  assert.equal(res.body?.error?.reason, 'ACCOUNT_MANAGEMENT_FAILED');

  // Firestore user document remained active
  const user = fixture.records.get('users/requester-active');
  assert.equal(user.accountStatus, 'active');
});

test('28. Firestore succeeds, Auth fails: error handled before state desynchronization', async () => {
  // Setup fixture where auth.updateUser throws
  const fixture = buildFixture({ failAuthUpdate: true });
  const { getAdmin } = fixture;
  const handler = createAdminAccountsHandler(getAdmin);

  const req = request({
    method: 'PATCH',
    headers: { authorization: 'Bearer admin-token' },
    body: { uid: 'requester-active', action: 'suspend', reason: 'Testing auth update error' },
  });
  const res = response();
  await handler(req, res);

  // Handled cleanly with 502 ACCOUNT_AUTH_SYNC_FAILED
  assert.equal(res.statusCode, 502);
  assert.equal(res.body?.error?.reason, 'ACCOUNT_AUTH_SYNC_FAILED');

  // Firestore user document committed suspended (fail-closed immediately cuts off access)
  const user = fixture.records.get('users/requester-active');
  assert.equal(user.accountStatus, 'suspended');
});
