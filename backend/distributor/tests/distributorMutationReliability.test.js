const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const babel = require('@babel/core');

const { createDistributorAssignedOrdersHandler } = require('../assignedOrdersHandler');
const { createManagerDispatchHandler } = require('../../manager/dispatchHandler');
const { DELIVERY_FAILURE_REASONS } = require('../../../constants/deliveryFailureReasons');

const root = resolve(__dirname, '../../..');
const read = (relPath) => readFileSync(resolve(root, relPath), 'utf8');

// ============================================================================
// Fixture helper for backend tests
// ============================================================================

function fixture(overrides = {}) {
  const records = new Map([
    ['branches/branch-a', { name: 'Branch A', status: 'active', latitude: 10.267, longitude: 123.584, serviceRadiusKm: 5 }],
    ['branches/branch-b', { name: 'Branch B', status: 'active', latitude: 10.31, longitude: 123.63, serviceRadiusKm: 10 }],
    ['users/manager-a', { role: 'manager', managerStatus: 'active', branchId: 'branch-a', fullName: 'Manager A' }],
    ['users/distributor-a', { role: 'distributor', approvalStatus: 'active', branchId: 'branch-a', fullName: 'Distributor A', phone: '09123456789', completeAddress: 'Poblacion, Toledo' }],
    ['users/distributor-a2', { role: 'distributor', approvalStatus: 'active', branchId: 'branch-a', fullName: 'Distributor A2', phone: '09123456789', completeAddress: 'Poblacion, Toledo' }],
    ['users/distributor-b', { role: 'distributor', approvalStatus: 'active', branchId: 'branch-b', fullName: 'Distributor B', phone: '09123456789', completeAddress: 'Poblacion, Toledo' }],
    ['requests/order-1', {
      requestId: 'BT-001',
      requesterUid: 'requester-1',
      requesterNameSnapshot: 'Requester One',
      branchId: 'branch-a',
      currentBranchId: 'branch-a',
      assignedDistributorUid: 'distributor-a',
      assignmentVersion: 2,
      status: 'distributor_assigned',
      items: [{ productId: 'prod-1', productNameSnapshot: 'Refill', quantity: 2, totalAtOrder: 70 }],
      totalAtOrder: 70,
    }],
    ['requests/order-scheduled', {
      requestId: 'BT-002',
      requesterUid: 'requester-1',
      branchId: 'branch-a',
      currentBranchId: 'branch-a',
      assignedDistributorUid: 'distributor-a',
      assignmentVersion: 2,
      status: 'scheduled',
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    }],
    ['requests/order-out', {
      requestId: 'BT-003',
      requesterUid: 'requester-1',
      branchId: 'branch-a',
      currentBranchId: 'branch-a',
      assignedDistributorUid: 'distributor-a',
      assignmentVersion: 2,
      status: 'out_for_delivery',
    }],
    ['requesterActiveOrders/requester-1', { orderId: 'order-1', requesterUid: 'requester-1' }],
    ...Object.entries(overrides),
  ]);

  const authUsers = new Map([
    ['manager-a', { disabled: false }],
    ['distributor-a', { disabled: false }],
    ['distributor-a2', { disabled: false }],
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
        'distributor-a-token': 'distributor-a',
        'distributor-a2-token': 'distributor-a2',
        'distributor-b-token': 'distributor-b',
      };
      const uid = mapping[token];
      if (!uid) throw new Error('bad token');
      return { uid, role: uid.startsWith('manager') ? 'manager' : 'distributor', ...(uid.startsWith('manager') ? { manager: true } : {}) };
    },
    async getUser(uid) { return authUsers.get(uid) || { disabled: true }; },
  };

  return { records, authUsers, getAdmin: () => ({ auth, db }) };
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

async function call(handler, method, token, body = {}) {
  const res = response();
  await handler({ method, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

// ============================================================================
// Load services/distributorOrders.js via Babel for client-side tests
// ============================================================================

function loadDistributorOrdersService(mocks = {}) {
  const rawCode = read('services/distributorOrders.js');
  const transformed = babel.transformSync(rawCode, {
    presets: ['babel-preset-expo'],
    filename: resolve(root, 'services/distributorOrders.js'),
  }).code;

  const customRequire = (specifier) => {
    if (specifier.includes('firebase')) {
      return {
        auth: {
          currentUser: mocks.currentUser || { uid: 'distributor-a', getIdToken: async () => 'distributor-a-token' },
          onAuthStateChanged: () => () => {},
        },
        db: mocks.db || {},
        collection: () => ({}),
        doc: () => ({}),
        getDoc: async () => ({ exists: () => false, data: () => ({}) }),
        onSnapshot: () => () => {},
        query: () => ({}),
        where: () => ({}),
      };
    }
    if (specifier.includes('apiClient')) {
      return { getApiUrl: (path) => path };
    }
    if (specifier.includes('useProtectedReadSession')) {
      return {
        subscribeProtectedReadSession: () => () => {},
        useProtectedReadSession: () => ({ readiness: 'READY', uid: 'distributor-a', profile: { branchId: 'branch-a' } }),
      };
    }
    if (specifier.includes('protectedReadReadiness')) {
      return { protectedReadReadiness: () => 'READY' };
    }
    if (specifier.includes('uniqueIds')) {
      return require(resolve(root, 'services/uniqueIds'));
    }
    if (specifier.includes('notificationTimestamp')) {
      return { parseTimestamp: (v) => v ? new Date(v) : null };
    }
    if (specifier.includes('deliveryFailureReasons')) {
      return require(resolve(root, 'constants/deliveryFailureReasons'));
    }
    return require(specifier);
  };

  const moduleObj = { exports: {} };
  const runner = new Function('require', 'exports', 'module', transformed);
  runner(customRequire, moduleObj.exports, moduleObj);
  return moduleObj.exports;
}

// ============================================================================
// Test Suites
// ============================================================================

// ----------------------------------------------------------------------------
// ACCEPT ASSIGNMENT (Tests 1–6)
// ----------------------------------------------------------------------------

test('1. Idempotent re-accept by assigned distributor returns 200 with unchanged order', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  // Initial accept
  const res1 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'accept-assignment',
    clientMutationId: 'mut-acc-1',
  });
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.order.status, 'accepted');

  // Second accept with same or different mutationId
  const res2 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'accept-assignment',
    clientMutationId: 'mut-acc-1',
  });
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.order.status, 'accepted');
  // State not corrupted or double-evented
  const orderDoc = f.records.get('requests/order-1');
  assert.equal(orderDoc.distributorDeliveryHistory.filter((e) => e.event === 'ASSIGNMENT_ACCEPTED').length, 1);
});

test('2. Accept by unassigned distributor is rejected (404/403)', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);
  const res = await call(handler, 'PATCH', 'distributor-b-token', {
    orderId: 'order-1',
    action: 'accept-assignment',
  });
  assert.ok(res.statusCode === 404 || res.statusCode === 403);
});

test('3. Accept with stale assignmentVersion is rejected (409 STALE_ASSIGNMENT)', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);
  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'accept-assignment',
    expectedAssignmentVersion: 1, // Current is 2
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.reason, 'STALE_ASSIGNMENT');
});

test('4. Accept on order that is already delivered or cancelled is rejected (409)', async () => {
  const f = fixture();
  f.records.set('requests/order-delivered', {
    ...f.records.get('requests/order-1'),
    status: 'delivered',
  });
  f.records.set('requests/order-cancelled', {
    ...f.records.get('requests/order-1'),
    status: 'cancelled',
  });
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  const resDelivered = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-delivered',
    action: 'accept-assignment',
  });
  assert.equal(resDelivered.statusCode, 409);

  const resCancelled = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-cancelled',
    action: 'accept-assignment',
  });
  assert.equal(resCancelled.statusCode, 409);
});

test('5. Accept on order that was reassigned to a different distributor is rejected', async () => {
  const f = fixture();
  // Order reassigned to distributor-a2
  f.records.set('requests/order-reassigned', {
    ...f.records.get('requests/order-1'),
    assignedDistributorUid: 'distributor-a2',
    assignmentVersion: 3,
  });
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-reassigned',
    action: 'accept-assignment',
  });
  assert.ok(res.statusCode === 403 || res.statusCode === 404 || res.statusCode === 409);
});

test('6. Accept transitions order from distributor_assigned to accepted with timestamps and history', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);
  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'accept-assignment',
    expectedAssignmentVersion: 2,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.order.status, 'accepted');
  const stored = f.records.get('requests/order-1');
  assert.ok(stored.acceptedAt);
  assert.equal(stored.distributorDeliveryHistory[0].event, 'ASSIGNMENT_ACCEPTED');
});

// ----------------------------------------------------------------------------
// START DELIVERY (Tests 7–12)
// ----------------------------------------------------------------------------

test('7. Idempotent re-start delivery by assigned distributor returns 200 without duplicate events', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  // Initially scheduled
  const res1 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-scheduled',
    action: 'start-delivery',
    clientMutationId: 'mut-start-1',
  });
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.order.status, 'out_for_delivery');

  // Second start-delivery
  const res2 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-scheduled',
    action: 'start-delivery',
    clientMutationId: 'mut-start-1',
  });
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.order.status, 'out_for_delivery');
  const stored = f.records.get('requests/order-scheduled');
  assert.equal(stored.distributorDeliveryHistory.filter((e) => e.event === 'DELIVERY_STARTED').length, 1);
});

test('8. Start delivery when order is not accepted or scheduled is rejected (409)', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);
  // order-1 is still distributor_assigned (not yet accepted)
  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'start-delivery',
  });
  assert.equal(res.statusCode, 409);
});

test('9. Start delivery by unassigned distributor is rejected (404/403)', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);
  const res = await call(handler, 'PATCH', 'distributor-b-token', {
    orderId: 'order-scheduled',
    action: 'start-delivery',
  });
  assert.ok(res.statusCode === 404 || res.statusCode === 403);
});

test('10. Start delivery with stale assignmentVersion is rejected (409 STALE_ASSIGNMENT)', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);
  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-scheduled',
    action: 'start-delivery',
    expectedAssignmentVersion: 1, // Current is 2
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.reason, 'STALE_ASSIGNMENT');
});

test('11. Start delivery on already delivered or cancelled order is rejected (409)', async () => {
  const f = fixture();
  f.records.set('requests/order-deliv', {
    ...f.records.get('requests/order-scheduled'),
    status: 'delivered',
  });
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);
  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-deliv',
    action: 'start-delivery',
  });
  assert.equal(res.statusCode, 409);
});

test('12. Start delivery transitions accepted/scheduled order to out_for_delivery with timestamps', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);
  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-scheduled',
    action: 'start-delivery',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.order.status, 'out_for_delivery');
  const stored = f.records.get('requests/order-scheduled');
  assert.ok(stored.deliveryStartedAt);
  assert.equal(stored.distributorDeliveryHistory[0].event, 'DELIVERY_STARTED');
});

// ----------------------------------------------------------------------------
// DELIVERY FAILED (Tests 13–18)
// ----------------------------------------------------------------------------

test('13. Idempotent delivery-failed with matching reason code returns 200 without overwriting', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  const res1 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-out',
    action: 'fail-delivery',
    failureReasonCode: 'CUSTOMER_UNAVAILABLE',
    failureReasonNote: 'Knocked 3 times',
    clientMutationId: 'mut-fail-1',
  });
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.order.status, 'delivery_failed');

  // Second call with same reason code and same note
  const res2 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-out',
    action: 'fail-delivery',
    failureReasonCode: 'CUSTOMER_UNAVAILABLE',
    failureReasonNote: 'Knocked 3 times',
    clientMutationId: 'mut-fail-1',
  });
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.order.status, 'delivery_failed');
  const stored = f.records.get('requests/order-out');
  assert.equal(stored.distributorDeliveryHistory.filter((e) => e.event === 'DELIVERY_FAILED').length, 1);
  assert.equal(stored.failureReasonNote, 'Knocked 3 times');
});

test('14. Delivery failed with invalid/missing reason code is rejected (400 INVALID_FAILURE_REASON)', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  const resMissing = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-out',
    action: 'fail-delivery',
  });
  assert.equal(resMissing.statusCode, 400);
  assert.equal(resMissing.body.error.reason, 'FAILURE_REASON_INVALID');

  const resInvalid = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-out',
    action: 'fail-delivery',
    failureReasonCode: 'NON_EXISTENT_CODE_XYZ',
  });
  assert.equal(resInvalid.statusCode, 400);
  assert.equal(resInvalid.body.error.reason, 'FAILURE_REASON_INVALID');
});

test('15. Delivery failed when order is not out_for_delivery is rejected (409)', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);
  // order-1 is distributor_assigned
  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'fail-delivery',
    failureReasonCode: 'CUSTOMER_UNAVAILABLE',
  });
  assert.equal(res.statusCode, 409);
});

test('16. Delivery failed by unassigned distributor is rejected (404/403)', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);
  const res = await call(handler, 'PATCH', 'distributor-b-token', {
    orderId: 'order-out',
    action: 'fail-delivery',
    failureReasonCode: 'CUSTOMER_UNAVAILABLE',
  });
  assert.ok(res.statusCode === 404 || res.statusCode === 403);
});

test('17. Delivery failed with stale assignmentVersion is rejected (409 STALE_ASSIGNMENT)', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);
  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-out',
    action: 'fail-delivery',
    failureReasonCode: 'CUSTOMER_UNAVAILABLE',
    expectedAssignmentVersion: 1, // Current is 2
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.reason, 'STALE_ASSIGNMENT');
});

test('18. Delivery failed transitions out_for_delivery order to delivery_failed with codes, timestamps, and history', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);
  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-out',
    action: 'fail-delivery',
    failureReasonCode: 'CUSTOMER_UNAVAILABLE',
    failureReasonNote: 'Gate locked, no answer',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.order.status, 'delivery_failed');
  const stored = f.records.get('requests/order-out');
  assert.equal(stored.failureReasonCode, 'CUSTOMER_UNAVAILABLE');
  assert.equal(stored.failureReasonLabel, 'Customer unavailable');
  assert.equal(stored.failureReasonNote, 'Gate locked, no answer');
  assert.ok(stored.deliveryFailedAt);
  assert.equal(stored.distributorDeliveryHistory[0].event, 'DELIVERY_FAILED');
});

// ----------------------------------------------------------------------------
// RECONCILIATION & CLIENT RESILIENCE (Tests 19–26)
// ----------------------------------------------------------------------------

test('19. Case A: Network drop after backend commit reconciles as success and primes cache', async () => {
  const service = loadDistributorOrdersService();

  // Mock fetch to simulate dropped response after commit (throws TypeError: Failed to fetch)
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    // Reconciler returns the order already committed on server
    const committedOrder = {
      id: 'order-1',
      status: 'accepted',
      assignedDistributorUid: 'distributor-a',
      assignmentVersion: 2,
    };

    const result = await service.updateAssignedDistributorOrder('order-1', 'accept-assignment', {}, {
      reconciler: async () => committedOrder,
    });

    assert.equal(result.status, 'accepted');
    assert.equal(result.reconciled, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('20. Case B: Network drop when order was reassigned or cancelled reconciles as rejected error', async () => {
  const service = loadDistributorOrdersService();

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    // Reconciler reveals order reassigned to someone else
    const reassignedOrder = {
      id: 'order-1',
      status: 'distributor_assigned',
      assignedDistributorUid: 'distributor-other',
      assignmentVersion: 3,
    };

    await assert.rejects(
      async () => {
        await service.updateAssignedDistributorOrder('order-1', 'accept-assignment', {}, {
          reconciler: async () => reassignedOrder,
        });
      },
      (err) => {
        assert.equal(err.rejected, true);
        assert.equal(err.reconciledOrder.assignedDistributorUid, 'distributor-other');
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('21. Case C: Network drop when order remains unchanged authoritatively returns unchanged error', async () => {
  const service = loadDistributorOrdersService();

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    // Reconciler reveals order is still in original state (distributor_assigned)
    const unchangedOrder = {
      id: 'order-1',
      status: 'distributor_assigned',
      assignedDistributorUid: 'distributor-a',
      assignmentVersion: 2,
    };

    await assert.rejects(
      async () => {
        await service.updateAssignedDistributorOrder('order-1', 'accept-assignment', {}, {
          reconciler: async () => unchangedOrder,
        });
      },
      (err) => {
        assert.equal(err.unchanged, true);
        assert.match(err.message, /Network connection was interrupted/i);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('22. Case D: Network drop when server is unreachable returns statusUnknown error', async () => {
  const service = loadDistributorOrdersService();

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    await assert.rejects(
      async () => {
        await service.updateAssignedDistributorOrder('order-1', 'accept-assignment', {}, {
          reconciler: async () => null, // Server completely unreachable
        });
      },
      (err) => {
        assert.equal(err.statusUnknown, true);
        assert.match(err.message, /Unable to confirm the action/i);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('23. Client mutation ID is forwarded and stored, preventing duplicate side effects', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'accept-assignment',
    clientMutationId: 'client-mut-unique-999',
  });
  assert.equal(res.statusCode, 200);
  const stored = f.records.get('requests/order-1');
  assert.equal(stored.distributorDeliveryHistory[0].clientMutationId, 'client-mut-unique-999');
});

test('24. UI processing state and disabled buttons prevent double-clicks in d_requests, d_scheduled, d_dashboard', () => {
  const requestsSrc = read('app/distributor/d_requests.jsx');
  const scheduledSrc = read('app/distributor/d_scheduled_requests.jsx');
  const dashboardSrc = read('app/distributor/d_dashboard.jsx');

  // Verify processing checks in d_requests
  assert.match(requestsSrc, /if\s*\(processingRequestId\)\s*return;/);
  assert.match(requestsSrc, /setProcessingRequestId\(request\.sourceId\)/);
  assert.match(requestsSrc, /finally\s*\{\s*setProcessingRequestId\(''\);/);

  // Verify processing checks in d_scheduled_requests
  assert.match(scheduledSrc, /if\s*\(processingRequestId\)\s*return;/);
  assert.match(scheduledSrc, /setProcessingRequestId\(request\.sourceId\)/);
  assert.match(scheduledSrc, /finally\s*\{\s*setProcessingRequestId\(''\);/);

  // Verify processing checks in d_dashboard
  assert.match(dashboardSrc, /if\s*\(!deliveryAction\s*\|\|\s*processing\)\s*return;/);
  assert.match(dashboardSrc, /setProcessing\(true\)/);
  assert.match(dashboardSrc, /finally\s*\{\s*setProcessing\(false\);/);
});

test('25. Transient fetch failure preserves cached orders in listener/hydration', () => {
  const serviceSrc = read('services/distributorOrders.js');
  // Check that hydrateDistributorOrders does NOT wipe entry.orders in catch
  assert.match(serviceSrc, /hydrateDistributorOrders\s*=\s*\(uid,\s*entry\)\s*=>/);
  // Verify emitDistributorOrders is called with entry.loaded = true and error set without zeroing orders
  const catchHydrateBlock = serviceSrc.match(/\.catch\(\(error\)\s*=>\s*\{[\s\S]*?entry\.refreshPromise\s*=\s*null;/)?.[0] || '';
  assert.doesNotMatch(catchHydrateBlock, /entry\.orders\s*=\s*\[\]/);

  // Check onSnapshot error does not clear orders
  const snapshotErrorBlock = serviceSrc.match(/\(error\)\s*=>\s*\{\s*entry\.loaded\s*=\s*true;\s*entry\.error[\s\S]*?\}/)?.[0] || '';
  assert.doesNotMatch(snapshotErrorBlock, /entry\.orders\s*=\s*\[\]/);
});

test('26. Status unknown error renders neutral/caution toast rather than false failure toast', () => {
  const requestsSrc = read('app/distributor/d_requests.jsx');
  const scheduledSrc = read('app/distributor/d_scheduled_requests.jsx');
  const dashboardSrc = read('app/distributor/d_dashboard.jsx');

  // Verify d_requests checks statusUnknown and sets type: 'info'
  assert.match(requestsSrc, /if\s*\(acceptErr\.statusUnknown\)\s*\{\s*setToast\(\{\s*visible:\s*true,\s*message:[\s\S]*?type:\s*'info'\s*\}\)/);

  // Verify d_scheduled_requests checks statusUnknown and sets type: 'info'
  assert.match(scheduledSrc, /if\s*\(updateError\.statusUnknown\)\s*\{\s*setToast\(\{\s*visible:\s*true,\s*message:[\s\S]*?type:\s*'info'\s*\}\)/);

  // Verify d_dashboard checks statusUnknown and sets type: 'info'
  assert.match(dashboardSrc, /if\s*\(error\.statusUnknown\)\s*\{\s*setToast\(\{\s*visible:\s*true,\s*type:\s*'info',/);
});

// ----------------------------------------------------------------------------
// REGRESSIONS & INTEGRATION (Tests 27–29)
// ----------------------------------------------------------------------------

test('27. Mark delivered still works and is idempotent for assigned distributor', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  // Mark delivered
  const res1 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-out',
    action: 'mark-delivered',
    clientMutationId: 'mut-deliv-1',
  });
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.order.status, 'delivered');
  assert.ok(f.records.get('requests/order-out').deliveredAt);

  // Re-mark delivered
  const res2 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-out',
    action: 'mark-delivered',
    clientMutationId: 'mut-deliv-1',
  });
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.order.status, 'delivered');
  const stored = f.records.get('requests/order-out');
  assert.equal(stored.distributorDeliveryHistory.filter((e) => e.event === 'DELIVERY_COMPLETED').length, 1);
});

test('28. Decline assignment still releases assignment properly', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'decline-assignment',
    declineReason: 'Vehicle trouble',
  });
  assert.equal(res.statusCode, 200);
  const stored = f.records.get('requests/order-1');
  assert.equal(stored.assignedDistributorUid, null);
  const lastHistory = stored.assignmentHistory[stored.assignmentHistory.length - 1];
  assert.equal(lastHistory.declineReason, 'Vehicle trouble');
});

test('29. Cross-role state consistency: Requester and Manager views reflect reconciled status without desync', async () => {
  const f = fixture();
  const distributorHandler = createDistributorAssignedOrdersHandler(f.getAdmin);
  const managerHandler = createManagerDispatchHandler(f.getAdmin);

  // Distributor starts delivery on order-scheduled
  const resStart = await call(distributorHandler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-scheduled',
    action: 'start-delivery',
  });
  assert.equal(resStart.statusCode, 200);
  assert.equal(resStart.body.order.status, 'out_for_delivery');

  // Manager inspects orders
  const resManager = await call(managerHandler, 'GET', 'manager-a-token');
  assert.equal(resManager.statusCode, 200);
  const managerOrder = resManager.body.orders.find((o) => o.id === 'order-scheduled');
  assert.ok(managerOrder);
  assert.equal(managerOrder.status, 'out_for_delivery');
  assert.equal(managerOrder.assignedDistributorUid, 'distributor-a');
});

// ============================================================================
// PHASE 06B.1 AUDIT TESTS (Scenarios A through L)
// ============================================================================

test('30. Audit A: Stale cache cannot prove success when fresh reads fail', async () => {
  const service = loadDistributorOrdersService();

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    // Both fresh Firestore getDoc and getAssignedDistributorOrders API fail
    await assert.rejects(
      async () => {
        await service.updateAssignedDistributorOrder('order-1', 'accept-assignment', {}, {
          fetchAuthoritativeOrder: async () => null,
        });
      },
      (err) => {
        assert.equal(err.statusUnknown, true);
        assert.doesNotMatch(err.message, /success/i);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('31. Audit B: Firestore read permission-denied falls back to backend read API', async () => {
  const service = loadDistributorOrdersService();

  const originalFetch = global.fetch;
  // PATCH fails with dropped transport
  global.fetch = async (url) => {
    if (url.includes('/api/distributor/orders')) {
      throw new TypeError('Failed to fetch');
    }
    return { ok: true, json: async () => ({}) };
  };

  try {
    const result = await service.reconcileAuthoritativeDistributorOrder('order-1', {
      // direct getDoc throws permission-denied
      fetchAuthoritativeOrder: async () => {
        const err = new Error('Missing or insufficient permissions.');
        err.code = 'permission-denied';
        throw err;
      },
      // authenticated backend read API succeeds
      getAssignedOrders: async () => [
        { id: 'order-1', status: 'accepted', assignedDistributorUid: 'distributor-a', assignmentVersion: 2 },
      ],
    });

    assert.ok(result);
    assert.equal(result.id, 'order-1');
    assert.equal(result.status, 'accepted');
  } finally {
    global.fetch = originalFetch;
  }
});

test('32. Audit C: Delayed server commit race produces honest uncertain outcome instead of false failure', async () => {
  const service = loadDistributorOrdersService();

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    // Reconciler observes order still in pre-mutation status (scheduled)
    const orderStillScheduled = {
      id: 'order-scheduled',
      status: 'scheduled',
      assignedDistributorUid: 'distributor-a',
      assignmentVersion: 2,
    };

    await assert.rejects(
      async () => {
        await service.updateAssignedDistributorOrder('order-scheduled', 'start-delivery', {}, {
          reconciler: async () => orderStillScheduled,
        });
      },
      (err) => {
        // Honest uncertain outcome: not classified as definitive failure
        assert.equal(err.statusUnknown, true);
        assert.equal(err.uncertain, true);
        assert.equal(err.unchanged, true);
        assert.match(err.message, /update may still be processing/i);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('33. Audit D: Full disconnect leaves operation result honestly uncertain', async () => {
  const service = loadDistributorOrdersService();

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    await assert.rejects(
      async () => {
        await service.updateAssignedDistributorOrder('order-1', 'accept-assignment', {}, {
          reconciler: async () => {
            throw new Error('Network unreachable');
          },
        });
      },
      (err) => {
        assert.equal(err.statusUnknown, true);
        assert.match(err.message, /Unable to confirm/i);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('34. Audit E: Same clientMutationId repeated with the same payload is acknowledged as idempotent', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  const res1 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'accept-assignment',
    clientMutationId: 'audit-mut-e',
  });
  assert.equal(res1.statusCode, 200);

  const res2 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'accept-assignment',
    clientMutationId: 'audit-mut-e',
  });
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.order.status, 'accepted');
  const stored = f.records.get('requests/order-1');
  assert.equal(stored.distributorDeliveryHistory.filter((h) => h.clientMutationId === 'audit-mut-e').length, 1);
});

test('35. Audit F: Same clientMutationId reused with a different action/payload is rejected (409 MUTATION_ID_CONFLICT)', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  // Accept with clientMutationId
  const res1 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'accept-assignment',
    clientMutationId: 'audit-mut-f',
  });
  assert.equal(res1.statusCode, 200);

  // Reuse same clientMutationId for start-delivery
  const res2 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'start-delivery',
    clientMutationId: 'audit-mut-f',
  });
  assert.equal(res2.statusCode, 409);
  assert.equal(res2.body.error.reason, 'MUTATION_ID_CONFLICT');
});

test('36. Audit G: Same status but stale assignment epoch is rejected (409 STALE_ASSIGNMENT)', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'accept-assignment',
    expectedAssignmentVersion: 1, // Current is 2
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.reason, 'STALE_ASSIGNMENT');
});

test('37. Audit H: Same failure reason code but different failure payload is rejected (409 ORDER_NOT_FAILABLE)', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  const res1 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-out',
    action: 'fail-delivery',
    failureReasonCode: 'CUSTOMER_UNAVAILABLE',
    failureReasonNote: 'Original Note',
  });
  assert.equal(res1.statusCode, 200);

  // Different note without rescheduling
  const res2 = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-out',
    action: 'fail-delivery',
    failureReasonCode: 'CUSTOMER_UNAVAILABLE',
    failureReasonNote: 'Different Note Sent Later',
  });
  assert.equal(res2.statusCode, 409);
  assert.equal(res2.body.error.reason, 'ORDER_NOT_FAILABLE');
});

test('38. Audit I: Reassigned distributor cannot receive false success', async () => {
  const f = fixture();
  // Order was reassigned to distributor-a2
  f.records.set('requests/order-reassigned-audit', {
    ...f.records.get('requests/order-1'),
    assignedDistributorUid: 'distributor-a2',
    assignmentVersion: 3,
  });
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  const res = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-reassigned-audit',
    action: 'accept-assignment',
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.reason, 'ORDER_NOT_FOUND');
});

test('39. Audit J: Normal successful delivery lifecycle operates end-to-end', async () => {
  const f = fixture();
  const handler = createDistributorAssignedOrdersHandler(f.getAdmin);

  // 1. Accept
  const acceptRes = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'accept-assignment',
  });
  assert.equal(acceptRes.statusCode, 200);
  assert.equal(acceptRes.body.order.status, 'accepted');

  // 2. Start
  const startRes = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'start-delivery',
  });
  assert.equal(startRes.statusCode, 200);
  assert.equal(startRes.body.order.status, 'out_for_delivery');

  // 3. Mark delivered
  const deliverRes = await call(handler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-1',
    action: 'mark-delivered',
  });
  assert.equal(deliverRes.statusCode, 200);
  assert.equal(deliverRes.body.order.status, 'delivered');
});

test('40. Audit K: Reconciliation never sends automatic duplicate PATCH requests', async () => {
  const service = loadDistributorOrdersService();

  let patchCount = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (options.method === 'PATCH') {
      patchCount += 1;
      throw new TypeError('Failed to fetch');
    }
    return { ok: true, json: async () => ({ orders: [] }) };
  };

  try {
    await assert.rejects(
      async () => {
        await service.updateAssignedDistributorOrder('order-1', 'accept-assignment', {}, {
          reconciler: async () => null,
        });
      },
      (err) => err.statusUnknown === true
    );
    // Exactly 1 PATCH attempt was made; no automatic duplicate PATCH was issued
    assert.equal(patchCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('41. Audit L: All Phase 06B baseline mutation reliability checks pass', () => {
  const serviceSrc = read('services/distributorOrders.js');
  const handlerSrc = read('backend/distributor/assignedOrdersHandler.js');

  // Ensure idempotency, reconciliation, and epoch checks remain present in code
  assert.match(handlerSrc, /idempotent:\s*true/);
  assert.match(handlerSrc, /STALE_ASSIGNMENT/);
  assert.match(handlerSrc, /MUTATION_ID_CONFLICT/);
  assert.match(serviceSrc, /isDistributorActionCommitted/);
  assert.match(serviceSrc, /reconcileAuthoritativeDistributorOrder/);
});
