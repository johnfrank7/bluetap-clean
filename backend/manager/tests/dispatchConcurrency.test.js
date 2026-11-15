const assert = require('node:assert/strict');
const test = require('node:test');

const { createManagerDispatchHandler } = require('../dispatchHandler');

function concurrencyFixture() {
  const records = new Map([
    ['branches/branch-concurrency', {
      name: 'Toledo Central Station',
      status: 'active',
      latitude: 10.267,
      longitude: 123.584,
      serviceRadiusKm: 15,
    }],
    ['users/manager-conc', {
      role: 'manager',
      managerStatus: 'active',
      branchId: 'branch-concurrency',
      fullName: 'Concurrency Test Manager',
    }],
    ['users/distributor-conc', {
      role: 'distributor',
      approvalStatus: 'active',
      branchId: 'branch-concurrency',
      fullName: 'Test Distributor Concurrency',
      phone: '09170001111',
      completeAddress: 'Poblacion, Toledo City',
    }],
    ['products/prod-5gal', {
      name: 'Standard 5-Gallon Round Container',
      product_name: 'Standard 5-Gallon Round Container',
      active: true,
      price: 35,
      branchIds: ['branch-concurrency'],
    }],
  ]);

  const authUsers = new Map([
    ['manager-conc', { disabled: false }],
    ['distributor-conc', { disabled: false }],
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
      const docs = () =>
        [...records.entries()]
          .filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value)
          .map(([path]) => snapshot(path));
      return {
        async get() {
          return { docs: docs() };
        },
        limit(count) {
          return {
            async get() {
              return { docs: docs().slice(0, count) };
            },
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

  // Transaction queue that serializes transactions while tracking document read/write locks
  let transactionQueue = Promise.resolve();
  const db = {
    collection,
    async runTransaction(run) {
      const previous = transactionQueue;
      let release;
      transactionQueue = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        const writes = [];
        const stage = (method, ref, data) => writes.push({ method, ref, data });
        const result = await run({
          get: async (ref) => {
            if (writes.length) throw new Error('Firestore transactions require all reads before writes.');
            return ref.get();
          },
          set(ref, data) { stage('set', ref, data); },
          update(ref, data) { stage('update', ref, data); },
          delete(ref) { stage('delete', ref); },
        });
        for (const { method, ref, data } of writes) {
          if (method === 'delete') records.delete(ref.path);
          else if (method === 'update') records.set(ref.path, { ...records.get(ref.path), ...data });
          else records.set(ref.path, data);
        }
        return result;
      } finally {
        release();
      }
    },
  };

  const auth = {
    async verifyIdToken(token) {
      if (token === 'manager-conc-token') {
        return { uid: 'manager-conc', role: 'manager', manager: true };
      }
      throw new Error('bad token');
    },
    async getUser(uid) {
      return authUsers.get(uid) || { disabled: true };
    },
  };

  return { records, authUsers, getAdmin: () => ({ auth, db }) };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    },
  };
}

async function call(handler, method, token, body) {
  const res = response();
  await handler({ method, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

test('Multi-Trip Concurrency Gate: two simultaneous assignments adding 8 containers to a 50-container trip cannot exceed 60', async () => {
  const f = concurrencyFixture();
  const handler = createManagerDispatchHandler(f.getAdmin);

  const scheduledTime = new Date(Date.now() + 2 * 3600 * 1000).toISOString();

  // Step 1: Base order with 50 containers on Trip #1
  f.records.set('requests/base-order-50', {
    requestId: 'BT-BASE-50',
    requesterUid: 'req-base',
    branchId: 'branch-concurrency',
    status: 'awaiting_distributor_assignment',
    waterType: 'Standard 5-Gallon Round Container',
    quantity: 50,
    containers: 50,
    items: [{ productId: 'prod-5gal', productNameSnapshot: 'Standard 5-Gallon Round Container', quantity: 50, price: 35 }],
  });

  const baseRes = await call(handler, 'PATCH', 'manager-conc-token', {
    orderId: 'base-order-50',
    action: 'assign-distributor',
    distributorUid: 'distributor-conc',
    scheduledAt: scheduledTime,
    tripId: 'trip-1',
  });
  assert.equal(baseRes.statusCode, 200);
  assert.equal(baseRes.body.order.tripContainers, 50);

  // Step 2: Two candidate orders, 8 containers each (50 + 8 + 8 = 66 > 60)
  f.records.set('requests/competing-order-a', {
    requestId: 'BT-COMPETE-A',
    requesterUid: 'req-compete-a',
    branchId: 'branch-concurrency',
    status: 'awaiting_distributor_assignment',
    waterType: 'Standard 5-Gallon Round Container',
    quantity: 8,
    containers: 8,
    items: [{ productId: 'prod-5gal', productNameSnapshot: 'Standard 5-Gallon Round Container', quantity: 8, price: 35 }],
  });

  f.records.set('requests/competing-order-b', {
    requestId: 'BT-COMPETE-B',
    requesterUid: 'req-compete-b',
    branchId: 'branch-concurrency',
    status: 'awaiting_distributor_assignment',
    waterType: 'Standard 5-Gallon Round Container',
    quantity: 8,
    containers: 8,
    items: [{ productId: 'prod-5gal', productNameSnapshot: 'Standard 5-Gallon Round Container', quantity: 8, price: 35 }],
  });

  // Step 3: Dispatch both competing assignments concurrently targeting the same distributor/trip
  const dispatchOrder = (orderId) =>
    call(handler, 'PATCH', 'manager-conc-token', {
      orderId,
      action: 'assign-distributor',
      distributorUid: 'distributor-conc',
      scheduledAt: scheduledTime,
      tripId: 'trip-1',
    });

  const [resA, resB] = await Promise.all([
    dispatchOrder('competing-order-a'),
    dispatchOrder('competing-order-b'),
  ]);

  // Step 4: Verify exactly ONE assignment succeeded (200) and ONE failed with 409 TRIP_CAPACITY_EXCEEDED
  const statusCodes = [resA.statusCode, resB.statusCode].sort();
  assert.deepEqual(statusCodes, [200, 409], 'Exactly one assignment must succeed (200) and one must fail (409)');

  const rejectedRes = resA.statusCode === 409 ? resA : resB;
  assert.equal(rejectedRes.body.error.reason, 'TRIP_CAPACITY_EXCEEDED');
  assert.match(rejectedRes.body.error.message, /capacity exceeded/i);

  // Step 5: Verify committed trip capacity in Firestore never exceeded 60 (equals exactly 58)
  const guard = f.records.get('distributorDispatchGuards/distributor-conc');
  assert.ok(guard, 'distributorDispatchGuards document must exist');
  assert.equal(guard.schemaVersion, 1);
  assert.equal(guard.initialized, true);
  assert.equal(guard.trips['trip-1'].containers, 58, 'Committed capacity must be exactly 58 (never 66)');
  assert.ok(guard.trips['trip-1'].containers <= 60, 'Committed containers must never exceed 60');

  // Verify only one candidate order is committed as distributor_assigned in requests
  const orderA = f.records.get('requests/competing-order-a');
  const orderB = f.records.get('requests/competing-order-b');
  const assignedCount = [orderA.status, orderB.status].filter((s) => s === 'distributor_assigned').length;
  assert.equal(assignedCount, 1, 'Exactly one order must be committed as distributor_assigned');
});

test('Multi-Trip Concurrency Gate: simultaneous assignments for conflicting schedule slots reject the overlapping trip', async () => {
  const f = concurrencyFixture();
  const handler = createManagerDispatchHandler(f.getAdmin);

  const slot1Time = new Date(Date.now() + 3 * 3600 * 1000); // 3h in future
  const slot2TimeConflicting = new Date(slot1Time.getTime() + 20 * 60 * 1000); // 20 min later (< 45 min)

  f.records.set('requests/order-slot-1', {
    requestId: 'BT-SLOT-1',
    requesterUid: 'req-slot-1',
    branchId: 'branch-concurrency',
    status: 'awaiting_distributor_assignment',
    waterType: 'Standard 5-Gallon Round Container',
    quantity: 10,
    containers: 10,
    items: [{ productId: 'prod-5gal', productNameSnapshot: 'Standard 5-Gallon Round Container', quantity: 10, price: 35 }],
  });

  f.records.set('requests/order-slot-2', {
    requestId: 'BT-SLOT-2',
    requesterUid: 'req-slot-2',
    branchId: 'branch-concurrency',
    status: 'awaiting_distributor_assignment',
    waterType: 'Standard 5-Gallon Round Container',
    quantity: 10,
    containers: 10,
    items: [{ productId: 'prod-5gal', productNameSnapshot: 'Standard 5-Gallon Round Container', quantity: 10, price: 35 }],
  });

  // Assign slot 1 to establish Trip #1
  const res1 = await call(handler, 'PATCH', 'manager-conc-token', {
    orderId: 'order-slot-1',
    action: 'assign-distributor',
    distributorUid: 'distributor-conc',
    scheduledAt: slot1Time.toISOString(),
    tripId: 'trip-morning',
  });
  assert.equal(res1.statusCode, 200);

  // Attempt to assign slot 2 only 20 min later to a new trip (must conflict with 45-min turnaround)
  const res2 = await call(handler, 'PATCH', 'manager-conc-token', {
    orderId: 'order-slot-2',
    action: 'assign-distributor',
    distributorUid: 'distributor-conc',
    scheduledAt: slot2TimeConflicting.toISOString(),
    tripId: 'trip-turnaround-conflict',
  });

  assert.equal(res2.statusCode, 409);
  assert.equal(res2.body.error.reason, 'DISTRIBUTOR_SCHEDULE_CONFLICT');
  assert.match(res2.body.error.message, /overlap|45 minutes/i);
});

test('Multi-Trip Concurrency Gate: identical retry of successful assignment is idempotent and does not inflate container count', async () => {
  const f = concurrencyFixture();
  const handler = createManagerDispatchHandler(f.getAdmin);

  const scheduledTime = new Date(Date.now() + 4 * 3600 * 1000).toISOString();

  f.records.set('requests/order-idempotent', {
    requestId: 'BT-IDEMPOTENT',
    requesterUid: 'req-idem',
    branchId: 'branch-concurrency',
    status: 'awaiting_distributor_assignment',
    waterType: 'Standard 5-Gallon Round Container',
    quantity: 12,
    containers: 12,
    items: [{ productId: 'prod-5gal', productNameSnapshot: 'Standard 5-Gallon Round Container', quantity: 12, price: 35 }],
  });

  const payload = {
    orderId: 'order-idempotent',
    action: 'assign-distributor',
    distributorUid: 'distributor-conc',
    scheduledAt: scheduledTime,
    tripId: 'trip-idempotent',
  };

  // First assignment
  const first = await call(handler, 'PATCH', 'manager-conc-token', payload);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.order.tripContainers, 12);

  // Guard container count after first
  const guardAfterFirst = f.records.get('distributorDispatchGuards/distributor-conc');
  assert.equal(guardAfterFirst.trips['trip-idempotent'].containers, 12);

  // Re-run identical assignment (e.g. network retry)
  const retry = await call(handler, 'PATCH', 'manager-conc-token', payload);
  assert.equal(retry.statusCode, 200);

  // Guard container count must NOT be doubled to 24
  const guardAfterRetry = f.records.get('distributorDispatchGuards/distributor-conc');
  assert.equal(guardAfterRetry.trips['trip-idempotent'].containers, 12, 'Container count must remain 12 after retry');
});
