const assert = require('node:assert/strict');
const test = require('node:test');

const { createManagerDispatchHandler } = require('../dispatchHandler');
const { getRoleOrderNotifications, requesterTransferMessage } = require('../../../services/orderNotifications');
const { resolveOrderFromList } = require('../../../services/orderNormalizer');

function fixture() {
  const records = new Map([
    ['branches/branch-a', { name: 'Branch A', status: 'active', latitude: 10.267, longitude: 123.584, serviceRadiusKm: 5 }],
    ['branches/branch-b', { name: 'Branch B', status: 'active', latitude: 10.31, longitude: 123.63, serviceRadiusKm: 10 }],
    ['branches/branch-c', { name: 'Branch C', status: 'active', latitude: 10.32, longitude: 123.65, serviceRadiusKm: 5 }],
    ['users/manager-a', { role: 'manager', managerStatus: 'active', branchId: 'branch-a', fullName: 'Manager A' }],
    ['users/manager-b', { role: 'manager', managerStatus: 'active', branchId: 'branch-b', fullName: 'Manager B' }],
    ['users/manager-c', { role: 'manager', managerStatus: 'active', branchId: 'branch-c', fullName: 'Manager C' }],
    ['users/distributor-a', { role: 'distributor', approvalStatus: 'active', branchId: 'branch-a', fullName: 'Distributor A', phone: '09123456789' }],
    ['users/distributor-b', { role: 'distributor', approvalStatus: 'active', branchId: 'branch-b', fullName: 'Distributor B', phone: '09123456789' }],
    ['requests/order-transfer-test', {
      requestId: 'BT-1001',
      requester_id: 'requester-1',
      requesterNameSnapshot: 'Alice Requester',
      requesterUniqueIdSnapshot: 'REQ-001',
      contactNumberSnapshot: '09123456789',
      branchId: 'branch-a',
      currentBranchId: 'branch-a',
      initialBranchId: 'branch-a',
      branchNameSnapshot: 'Branch A',
      status: 'awaiting_distributor_assignment',
      deliveryLocation: { latitude: 10.29, longitude: 123.6, address: '123 Main St' },
      items: [{ productId: 'prod-1', productNameSnapshot: 'Mineral Water 5-Gal', quantity: 2, unitPriceAtOrder: 50, totalAtOrder: 100 }],
      subtotalAtOrder: 100,
      deliveryFeeAtOrder: 30,
      totalAtOrder: 130,
      deliveryFeePolicy: { baseFee: 30 },
      createdAt: '2026-10-12T08:00:00.000Z',
      updatedAt: '2026-10-12T08:00:00.000Z',
    }],
    ['requests/order-decline-test', {
      requestId: 'BT-1002',
      requester_id: 'requester-2',
      requesterNameSnapshot: 'Bob Requester',
      branchId: 'branch-a',
      currentBranchId: 'branch-a',
      initialBranchId: 'branch-a',
      branchNameSnapshot: 'Branch A',
      status: 'awaiting_distributor_assignment',
      items: [{ productId: 'prod-1', productNameSnapshot: 'Mineral Water 5-Gal', quantity: 1, totalAtOrder: 50 }],
      subtotalAtOrder: 50,
      deliveryFeeAtOrder: 30,
      totalAtOrder: 80,
      createdAt: '2026-10-12T08:00:00.000Z',
      updatedAt: '2026-10-12T08:00:00.000Z',
    }],
  ]);

  const authUsers = new Map([
    ['manager-a', { disabled: false }],
    ['manager-b', { disabled: false }],
    ['manager-c', { disabled: false }],
    ['distributor-a', { disabled: false }],
    ['distributor-b', { disabled: false }],
  ]);

  const snapshot = (path) => ({
    id: path.split('/').pop(),
    exists: records.has(path),
    data: () => records.get(path),
  });

  const collection = (name) => ({
    doc(id) {
      const path = `${name}/${id}`;
      return {
        id,
        path,
        get: async () => snapshot(path),
        set: async (data) => records.set(path, data),
        update: async (data) => records.set(path, { ...records.get(path), ...data }),
        delete: async () => records.delete(path),
      };
    },
    where(field, operator, value) {
      return {
        async get() {
          return {
            docs: [...records.entries()]
              .filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value)
              .map(([path]) => snapshot(path)),
          };
        },
      };
    },
    async get() {
      return {
        docs: [...records.keys()]
          .filter((path) => path.startsWith(`${name}/`))
          .map(snapshot),
      };
    },
  });

  const db = {
    collection,
    async runTransaction(run) {
      return run({
        get: async (ref) => ref.get(),
        set(ref, data) { records.set(ref.path, data); },
        update(ref, data) { records.set(ref.path, { ...records.get(ref.path), ...data }); },
        delete(ref) { records.delete(ref.path); },
      });
    },
  };

  const auth = {
    async verifyIdToken(token) {
      const mapping = {
        'manager-a-token': 'manager-a',
        'manager-b-token': 'manager-b',
        'manager-c-token': 'manager-c',
        'distributor-a-token': 'distributor-a',
        'distributor-b-token': 'distributor-b',
      };
      const uid = mapping[token];
      if (!uid) throw new Error('bad token');
      return {
        uid,
        role: uid.startsWith('manager') ? 'manager' : 'distributor',
        ...(uid.startsWith('manager') ? { manager: true } : {}),
      };
    },
    async getUser(uid) {
      return authUsers.get(uid) || { disabled: true };
    },
  };

  return { records, getAdmin: () => ({ auth, db }) };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

async function call(handler, method, token, body) {
  const res = response();
  await handler({ method, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

test('1. Initiating transfer does not falsely notify completed transfer', async () => {
  const f = fixture();
  const handler = createManagerDispatchHandler(f.getAdmin);

  const req = await call(handler, 'PATCH', 'manager-a-token', {
    orderId: 'order-transfer-test',
    action: 'request-transfer',
    targetBranchId: 'branch-b',
    transferReason: 'Customer requested Branch B delivery coverage.',
  });
  assert.equal(req.statusCode, 200);

  const order = f.records.get('requests/order-transfer-test');
  assert.equal(order.status, 'branch_transfer_pending');
  assert.equal(order.transferState, 'pending');

  const notifications = getRoleOrderNotifications([order], 'requester');
  const transferCompleted = notifications.find((n) => n.status === 'transferred');
  assert.equal(transferCompleted, undefined, 'Must not emit completed transfer notification while pending');
  assert.ok(notifications.some((n) => n.message.includes('has a branch transfer in progress')));
});

test('2. Source retains ownership before target acceptance', async () => {
  const f = fixture();
  const handler = createManagerDispatchHandler(f.getAdmin);

  await call(handler, 'PATCH', 'manager-a-token', {
    orderId: 'order-transfer-test',
    action: 'request-transfer',
    targetBranchId: 'branch-b',
    transferReason: 'Customer requested Branch B delivery coverage.',
  });

  const order = f.records.get('requests/order-transfer-test');
  assert.equal(order.branchId, 'branch-a');
  assert.equal(order.transferFromBranchId, 'branch-a');

  // Target manager B cannot assign distributor while transfer is pending
  const assignAttempt = await call(handler, 'PATCH', 'manager-b-token', {
    orderId: 'order-transfer-test',
    action: 'assign-distributor',
    distributorUid: 'distributor-b',
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(assignAttempt.statusCode, 403, 'Target branch must not manage order before acceptance');
});

test('3. Authorized target acceptance changes effective branch', async () => {
  const f = fixture();
  const handler = createManagerDispatchHandler(f.getAdmin);

  await call(handler, 'PATCH', 'manager-a-token', {
    orderId: 'order-transfer-test',
    action: 'request-transfer',
    targetBranchId: 'branch-b',
    transferReason: 'Customer requested Branch B delivery coverage.',
  });

  const accept = await call(handler, 'PATCH', 'manager-b-token', {
    orderId: 'order-transfer-test',
    action: 'accept-transfer',
  });
  assert.equal(accept.statusCode, 200);

  const order = f.records.get('requests/order-transfer-test');
  assert.equal(order.branchId, 'branch-b');
  assert.equal(order.currentBranchId, 'branch-b');
  assert.equal(order.currentBranchNameSnapshot, 'Branch B');
  assert.equal(order.status, 'awaiting_distributor_assignment');
  assert.equal(order.transferState, 'accepted');
});

test('4, 5, 6, 7. Acceptance creates correct Requester notification with public reference, branch names, and safe reason', async () => {
  const f = fixture();
  const handler = createManagerDispatchHandler(f.getAdmin);

  await call(handler, 'PATCH', 'manager-a-token', {
    orderId: 'order-transfer-test',
    action: 'request-transfer',
    targetBranchId: 'branch-b',
    transferReason: 'Customer requested Branch B delivery coverage.',
  });

  await call(handler, 'PATCH', 'manager-b-token', {
    orderId: 'order-transfer-test',
    action: 'accept-transfer',
  });

  const order = f.records.get('requests/order-transfer-test');
  const notifications = getRoleOrderNotifications([order], 'requester');

  const transferNotice = notifications.find((n) => n.status === 'transferred');
  assert.ok(transferNotice, 'Must produce a transferred notification');
  assert.equal(transferNotice.title, 'Order Transferred');
  assert.equal(transferNotice.requestId, 'BT-1001');

  // Test 5: Public BT order reference
  assert.ok(transferNotice.message.includes('BT-1001'), 'Message must contain public reference BT-1001');
  assert.ok(!transferNotice.message.includes('order-transfer-test'), 'Message must not contain raw doc ID');
  assert.ok(!transferNotice.message.includes('manager-'), 'Message must not leak manager UIDs');

  // Test 6: Source and target display names
  assert.ok(transferNotice.message.includes('Branch A'), 'Message must contain source Branch A');
  assert.ok(transferNotice.message.includes('Branch B'), 'Message must contain target Branch B');

  // Test 7: Saved safe reason
  assert.ok(transferNotice.message.includes('Customer requested Branch B delivery coverage.'), 'Message must contain safe reason');
  assert.equal(transferNotice.metadata, 'Reason: Customer requested Branch B delivery coverage.');
});

test('8, 9. Correct Requester receives notification and other Requesters do not', async () => {
  const f = fixture();
  const handler = createManagerDispatchHandler(f.getAdmin);

  await call(handler, 'PATCH', 'manager-a-token', {
    orderId: 'order-transfer-test',
    action: 'request-transfer',
    targetBranchId: 'branch-b',
    transferReason: 'Coverage optimization.',
  });

  await call(handler, 'PATCH', 'manager-b-token', {
    orderId: 'order-transfer-test',
    action: 'accept-transfer',
  });

  const order = f.records.get('requests/order-transfer-test');

  // Requester 1 sees their transferred order notification
  const r1Orders = [order].filter((o) => o.requester_id === 'requester-1');
  const r1Notifs = getRoleOrderNotifications(r1Orders, 'requester');
  assert.ok(r1Notifs.some((n) => n.status === 'transferred' && n.requestId === 'BT-1001'));

  // Requester 2 sees only their own orders
  const r2Orders = [order].filter((o) => o.requester_id === 'requester-2');
  const r2Notifs = getRoleOrderNotifications(r2Orders, 'requester');
  assert.equal(r2Notifs.length, 0, 'Requester 2 must not see Requester 1 notifications');
});

test('10. Duplicate acceptance/retry does not produce duplicate notification', async () => {
  const f = fixture();
  const handler = createManagerDispatchHandler(f.getAdmin);

  await call(handler, 'PATCH', 'manager-a-token', {
    orderId: 'order-transfer-test',
    action: 'request-transfer',
    targetBranchId: 'branch-b',
    transferReason: 'Coverage optimization.',
  });

  const accept1 = await call(handler, 'PATCH', 'manager-b-token', {
    orderId: 'order-transfer-test',
    action: 'accept-transfer',
  });
  assert.equal(accept1.statusCode, 200);

  // Duplicate accept attempt is rejected by backend
  const accept2 = await call(handler, 'PATCH', 'manager-b-token', {
    orderId: 'order-transfer-test',
    action: 'accept-transfer',
  });
  assert.equal(accept2.statusCode, 409, 'Duplicate acceptance must be rejected');

  const order = f.records.get('requests/order-transfer-test');
  const notifications = getRoleOrderNotifications([order], 'requester');
  const transferNotices = notifications.filter((n) => n.status === 'transferred');
  assert.equal(transferNotices.length, 1, 'Must produce exactly one transferred notification');
});

test('11. Target rejection produces no successful-transfer notice', async () => {
  const f = fixture();
  const handler = createManagerDispatchHandler(f.getAdmin);

  await call(handler, 'PATCH', 'manager-a-token', {
    orderId: 'order-decline-test',
    action: 'request-transfer',
    targetBranchId: 'branch-b',
    transferReason: 'Capacity overflow at Branch A.',
  });

  const decline = await call(handler, 'PATCH', 'manager-b-token', {
    orderId: 'order-decline-test',
    action: 'decline-transfer',
    transferDeclineReason: 'Branch B capacity also full.',
  });
  assert.equal(decline.statusCode, 200);

  const order = f.records.get('requests/order-decline-test');
  assert.equal(order.branchId, 'branch-a');
  assert.equal(order.transferState, 'declined');

  const notifications = getRoleOrderNotifications([order], 'requester');
  const transferSuccess = notifications.find((n) => n.status === 'transferred');
  assert.equal(transferSuccess, undefined, 'Rejection must not produce transferred notification');
});

test('12. Wrong Manager or branch cannot accept transfer', async () => {
  const f = fixture();
  const handler = createManagerDispatchHandler(f.getAdmin);

  await call(handler, 'PATCH', 'manager-a-token', {
    orderId: 'order-transfer-test',
    action: 'request-transfer',
    targetBranchId: 'branch-b',
    transferReason: 'Coverage optimization.',
  });

  // Manager C (from branch-c) attempts to accept
  const unauthorizedAccept = await call(handler, 'PATCH', 'manager-c-token', {
    orderId: 'order-transfer-test',
    action: 'accept-transfer',
  });
  assert.equal(unauthorizedAccept.statusCode, 403, 'Wrong branch manager must be rejected');

  const order = f.records.get('requests/order-transfer-test');
  assert.equal(order.branchId, 'branch-a', 'Ownership must remain at source branch');
  assert.equal(order.transferState, 'pending');
});

test('13. Order notification opens correct Request Details', () => {
  const order = {
    id: 'order-transfer-test',
    requestId: 'BT-1001',
    transferState: 'accepted',
    transferFromBranchNameSnapshot: 'Branch A',
    transferToBranchNameSnapshot: 'Branch B',
    currentBranchName: 'Branch B',
    transferReason: 'Coverage optimization.',
    transferAcceptedAt: new Date(),
    status: 'awaiting_distributor_assignment',
    items: [{ productId: 'prod-1', productNameSnapshot: 'Mineral Water 5-Gal', quantity: 2, unitPriceAtOrder: 50, totalAtOrder: 100 }],
    subtotalAtOrder: 100,
    deliveryFeeAtOrder: 30,
    totalAtOrder: 130,
  };

  const notifications = getRoleOrderNotifications([order], 'requester');
  const transferNotice = notifications.find((n) => n.status === 'transferred');
  assert.ok(transferNotice);

  const resolved = resolveOrderFromList(transferNotice.orderId, [order]);
  assert.ok(resolved);
  assert.equal(resolved.requestId, 'BT-1001');
  assert.equal(resolved.transferFromBranchNameSnapshot, 'Branch A');
  assert.equal(resolved.transferReason, 'Coverage optimization.');
  assert.equal(resolved.waterStation, 'Branch B');
});

test('14. Requester unread count updates correctly', () => {
  const order = {
    id: 'order-transfer-test',
    requestId: 'BT-1001',
    transferState: 'accepted',
    transferFromBranchNameSnapshot: 'Branch A',
    transferToBranchNameSnapshot: 'Branch B',
    transferReason: 'Coverage optimization.',
    transferAcceptedAt: new Date(),
    status: 'awaiting_distributor_assignment',
  };

  const notifications = getRoleOrderNotifications([order], 'requester');
  const seen = new Set();

  const initialUnread = notifications.filter((n) => !seen.has(n.id)).length;
  assert.ok(initialUnread > 0, 'Must have unread notifications');

  // Mark all seen
  notifications.forEach((n) => seen.add(n.id));
  const finalUnread = notifications.filter((n) => !seen.has(n.id)).length;
  assert.equal(finalUnread, 0, 'All notifications must be marked seen');
});

test('15. Transfer does not reprice historical order', async () => {
  const f = fixture();
  const handler = createManagerDispatchHandler(f.getAdmin);

  await call(handler, 'PATCH', 'manager-a-token', {
    orderId: 'order-transfer-test',
    action: 'request-transfer',
    targetBranchId: 'branch-b',
    transferReason: 'Coverage optimization.',
  });

  await call(handler, 'PATCH', 'manager-b-token', {
    orderId: 'order-transfer-test',
    action: 'accept-transfer',
  });

  const order = f.records.get('requests/order-transfer-test');
  assert.equal(order.subtotalAtOrder, 100, 'Historical subtotal must be preserved');
  assert.equal(order.deliveryFeeAtOrder, 30, 'Historical delivery fee must be preserved');
  assert.equal(order.totalAtOrder, 130, 'Historical total must be preserved');
  assert.deepEqual(order.deliveryFeePolicy, { baseFee: 30 }, 'Historical policy snapshot must be preserved');
});

test('16. Manager authority remains branch-scoped after handoff', async () => {
  const f = fixture();
  const handler = createManagerDispatchHandler(f.getAdmin);

  await call(handler, 'PATCH', 'manager-a-token', {
    orderId: 'order-transfer-test',
    action: 'request-transfer',
    targetBranchId: 'branch-b',
    transferReason: 'Coverage optimization.',
  });

  await call(handler, 'PATCH', 'manager-b-token', {
    orderId: 'order-transfer-test',
    action: 'accept-transfer',
  });

  // Source manager A cannot assign distributor after handoff
  const sourceAssign = await call(handler, 'PATCH', 'manager-a-token', {
    orderId: 'order-transfer-test',
    action: 'assign-distributor',
    distributorUid: 'distributor-a',
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(sourceAssign.statusCode, 403, 'Source manager cannot assign after transfer handoff');

  // Target manager B can assign distributor
  const targetAssign = await call(handler, 'PATCH', 'manager-b-token', {
    orderId: 'order-transfer-test',
    action: 'assign-distributor',
    distributorUid: 'distributor-b',
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(targetAssign.statusCode, 200, 'Target manager can assign distributor');
});

test('17. Formatted transfer message handles presence and absence of transfer note', () => {
  const withNote = requesterTransferMessage({
    requestId: 'BT-5555',
    transferFromBranchNameSnapshot: 'Branch North',
    transferToBranchNameSnapshot: 'Branch South',
    transferReason: 'Closer proximity.',
  });
  assert.equal(withNote, 'Your water request BT-5555 has been transferred from Branch North to Branch South. Reason: Closer proximity.');

  const withoutNote = requesterTransferMessage({
    requestId: 'BT-5555',
    transferFromBranchNameSnapshot: 'Branch North',
    transferToBranchNameSnapshot: 'Branch South',
  });
  assert.equal(withoutNote, 'Your water request BT-5555 has been transferred from Branch North to Branch South.');
});
