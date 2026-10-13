const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const babel = require('@babel/core');

const { createRequesterOrdersHandler } = require('../orderingHandler');

const root = resolve(__dirname, '../../..');
const read = (relPath) => readFileSync(resolve(root, relPath), 'utf8');

// ============================================================================
// Load services/requests.js via Babel for direct service-level tests
// ============================================================================

function loadRequestsService(requesterOrderingMocks = {}) {
  const rawCode = read('services/requests.js');
  const transformed = babel.transformSync(rawCode, {
    presets: ['babel-preset-expo'],
    filename: resolve(root, 'services/requests.js'),
  }).code;

  const customRequire = (specifier) => {
    if (specifier.includes('requesterOrdering')) {
      return {
        cancelRequesterOrder: async (orderId) => ({ id: orderId, status: 'Cancelled' }),
        getRequesterOrders: async () => [],
        createRequesterOrder: async () => ({}),
        updateRequesterOrder: async () => ({}),
        ...requesterOrderingMocks,
      };
    }
    if (specifier.includes('firebase')) {
      return {
        db: {},
        collection: () => {},
        doc: () => {},
        getDoc: async () => ({ exists: () => false }),
        onSnapshot: () => () => {},
        query: () => {},
        where: () => {},
      };
    }
    if (specifier.includes('requesterOrderStatus')) {
      return require(resolve(root, 'constants/requesterOrderStatus'));
    }
    if (specifier.includes('notificationTimestamp')) {
      return { parseTimestamp: () => 0 };
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
// Mock DB & Auth for Server-Authoritative Testing
// ============================================================================

function fixture(overrides = {}) {
  const records = new Map([
    ['users/requester-1', { role: 'requester', fullName: 'Nishi Requester', contactNumber: '09171234567', address: 'Poblacion, Pinamungajan' }],
    ['users/requester-2', { role: 'requester', fullName: 'Other Requester', contactNumber: '09170000000', address: 'Cebu' }],
    ['branches/central', { name: 'BlueTap Central', address: 'Main Street', barangay: 'Poblacion', city: 'Toledo City', latitude: 10.267, longitude: 123.584, serviceRadiusKm: 5, status: 'active' }],
    ['requests/order-pending-1', {
      requesterUid: 'requester-1',
      requester_id: 'requester-1',
      status: 'Pending',
      branchId: 'central',
      totalAtOrder: 247.5,
      deliveryFeeAtOrder: 67.5,
      subtotalAtOrder: 180,
    }],
    ['requests/order-delivered-1', {
      requesterUid: 'requester-1',
      requester_id: 'requester-1',
      status: 'Delivered',
      branchId: 'central',
      totalAtOrder: 247.5,
    }],
    ['requests/order-cancelled-1', {
      requesterUid: 'requester-1',
      requester_id: 'requester-1',
      status: 'Cancelled',
      branchId: 'central',
      totalAtOrder: 247.5,
    }],
    ['requesterActiveOrders/requester-1', {
      orderId: 'order-pending-1',
      status: 'Pending',
      branchId: 'central',
    }],
  ]);

  for (const [path, value] of Object.entries(overrides)) records.set(path, value);

  let autoId = 0;
  const snapshot = (path) => ({
    id: path.split('/').pop(),
    exists: records.has(path),
    data: () => records.get(path),
  });

  const collection = (name) => ({
    doc(id = `auto-${++autoId}`) {
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
    async get() {
      return { docs: [...records.keys()].filter((path) => path.startsWith(`${name}/`)).map(snapshot) };
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
  });

  const db = {
    collection,
    async runTransaction(run) {
      return run({
        async get(ref) { return snapshot(ref.path); },
        create(ref, data) {
          assert.equal(records.has(ref.path), false);
          records.set(ref.path, data);
        },
        update(ref, data) {
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

  const tokenUsers = {
    'requester-token': { uid: 'requester-1', role: 'requester' },
    'requester-2-token': { uid: 'requester-2', role: 'requester' },
  };

  const auth = {
    async verifyIdToken(token) {
      if (!tokenUsers[token]) throw new Error('bad token');
      return tokenUsers[token];
    },
  };

  return { records, getAdmin: () => ({ auth, db }) };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

async function call(handler, method, token, body) {
  const res = response();
  await handler(
    {
      method,
      headers: token
        ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
        : { 'content-type': 'application/json' },
      body,
    },
    res
  );
  return res;
}

// ============================================================================
// 1. Shared CancelRequestModal Component Verification
// ============================================================================

test('CancelRequestModal renders title, description, and action buttons', () => {
  const modalCode = read('components/CancelRequestModal.jsx');

  // Title and message
  assert.match(modalCode, /Cancel Water Request\?/);
  assert.match(modalCode, /Are you sure you want to cancel this water request\? This action cannot be undone\./);

  // Both action buttons
  assert.match(modalCode, /Keep Request/);
  assert.match(modalCode, /Cancel Request/);
});

test('CancelRequestModal enforces theme-safe solid surfaces, high overlay elevation, and accessibility', () => {
  const modalCode = read('components/CancelRequestModal.jsx');

  // Solid theme surfaces (no translucent container bleed)
  assert.match(modalCode, /backgroundColor:\s*(isDark \? colors\.surface : '#FFFFFF'|colors\.surface)/);
  assert.match(modalCode, /'rgba\(15, 23, 42, 0\.6\)'/);

  // High overlay stacking
  assert.match(modalCode, /zIndex:\s*(9999|10000)/);
  assert.match(modalCode, /elevation:\s*24/);

  // Accessibility roles and labels
  assert.match(modalCode, /accessibilityRole="alertdialog"/);
  assert.match(modalCode, /accessibilityViewIsModal/);
  assert.match(modalCode, /accessibilityLabel=\{keepLabel\}/);
  assert.match(modalCode, /accessibilityLabel=\{busy \? 'Cancelling water request\.\.\.' : cancelLabel\}/);

  // Reachable touch targets (minHeight >= 44px)
  assert.match(modalCode, /minHeight:\s*46/);

  // Responsive button layout for narrow viewports
  assert.match(modalCode, /styles\.actionsNarrow/);
  assert.match(modalCode, /styles\.buttonNarrow/);
});

test('CancelRequestModal supports keyboard Escape and Android hardware back dismissal', () => {
  const modalCode = read('components/CancelRequestModal.jsx');

  // Android hardware back
  assert.match(modalCode, /onRequestClose=\{handleDismiss\}/);

  // Web Escape key listener
  assert.match(modalCode, /window\.addEventListener\('keydown', handleKeyDown\)/);
  assert.match(modalCode, /window\.removeEventListener\('keydown', handleKeyDown\)/);
  assert.match(modalCode, /event\.key === 'Escape'/);
});

test('CancelRequestModal handles busy and disabled states correctly', () => {
  const modalCode = read('components/CancelRequestModal.jsx');

  // Disables buttons when busy
  assert.match(modalCode, /disabled=\{busy\}/);

  // Shows ActivityIndicator when busy
  assert.match(modalCode, /<ActivityIndicator/);
  assert.match(modalCode, /size="small"/);

  // Does not allow dismissal when busy
  assert.match(modalCode, /if \(busy\) return;/);
});

// ============================================================================
// 2. Screen Wiring & Integration Verification
// ============================================================================

test('Current Request (r_dashboard.jsx) uses CancelRequestModal without Alert.alert or window.confirm', () => {
  const dashCode = read('app/requester/r_dashboard.jsx');

  // Imports and mounts CancelRequestModal
  assert.match(dashCode, /import CancelRequestModal from '\.\.\/\.\.\/components\/CancelRequestModal';/);
  assert.match(dashCode, /<CancelRequestModal/);
  assert.match(dashCode, /visible=\{Boolean\(requestToCancel\)\}/);
  assert.match(dashCode, /onKeep=\{closeCancelModal\}/);
  assert.match(dashCode, /onConfirm=\{proceedWithCancelRequest\}/);

  // Uses TopToastFeedback for result notification
  assert.match(dashCode, /import TopToastFeedback from '\.\.\/\.\.\/components\/TopToastFeedback';/);
  assert.match(dashCode, /<TopToastFeedback/);
  assert.match(dashCode, /Water request cancelled successfully\./);

  // Forwards cancel action from RequestDetailsModal
  assert.match(dashCode, /onCancel=\{detailsRequest && isPendingRequest\(detailsRequest\) \? \(\) =>/);

  // Zero occurrences of legacy confirmation mechanisms
  assert.doesNotMatch(dashCode, /Alert\.alert/);
  assert.doesNotMatch(dashCode, /window\.confirm/);
});

test('My Orders (r_request.jsx) uses CancelRequestModal without Alert.alert or window.confirm', () => {
  const reqCode = read('app/requester/r_request.jsx');

  // Imports and mounts CancelRequestModal
  assert.match(reqCode, /import CancelRequestModal from '\.\.\/\.\.\/components\/CancelRequestModal';/);
  assert.match(reqCode, /<CancelRequestModal/);
  assert.match(reqCode, /visible=\{Boolean\(requestToCancel\)\}/);
  assert.match(reqCode, /onKeep=\{closeCancelModal\}/);
  assert.match(reqCode, /onConfirm=\{proceedWithCancelRequest\}/);

  // Uses TopToastFeedback
  assert.match(reqCode, /<TopToastFeedback/);
  assert.match(reqCode, /Water request cancelled successfully\./);

  // Forwards cancel action from RequestDetailsModal
  assert.match(reqCode, /onCancel=\{liveSelectedRequest && isPendingRequest\(liveSelectedRequest\) \? \(\) =>/);

  // Zero occurrences of native confirmation or alert
  assert.doesNotMatch(reqCode, /Alert\.alert/);
  assert.doesNotMatch(reqCode, /window\.confirm/);
});

test('Both entry points protect against double clicks while cancellation is in progress', () => {
  const dashCode = read('app/requester/r_dashboard.jsx');
  const reqCode = read('app/requester/r_request.jsx');

  // Guard in proceedWithCancelRequest
  assert.match(dashCode, /const proceedWithCancelRequest = async \(\) => {\s*if \(!requestToCancel \|\| cancellingRequestId\) return;/);
  assert.match(reqCode, /const proceedWithCancelRequest = async \(\) => {\s*if \(!requestToCancel \|\| cancellingRequestId\) return;/);

  // Guard in cancelPendingRequest
  assert.match(dashCode, /const cancelPendingRequest = async \(request\) => {\s*if \(!request\?\.id \|\| cancellingRequestId\) return;/);
  assert.match(reqCode, /const cancelPendingRequest = async \(request\) => {\s*if \(!request\?\.id \|\| cancellingRequestId\) return;/);
});

test('Status eligibility checks in services/requests.js and screens encompass all pending statuses', () => {
  const reqService = read('services/requests.js');
  const dashCode = read('app/requester/r_dashboard.jsx');

  // Status whitelist includes pending, outside radius pending approval, and manager approval pending
  assert.match(reqService, /'pending',\s*'outside radius pending approval',\s*'manager approval pending'/);
  assert.match(dashCode, /'pending',\s*'outside radius pending approval',\s*'manager approval pending'/);
});

test('Neither screen retains unconfirmed error.savedLocal or "Water request cancelled locally"', () => {
  const dashCode = read('app/requester/r_dashboard.jsx');
  const reqCode = read('app/requester/r_request.jsx');

  // Zero occurrences of client-only false savedLocal branch
  assert.doesNotMatch(dashCode, /error\.savedLocal/);
  assert.doesNotMatch(reqCode, /error\.savedLocal/);
  assert.doesNotMatch(dashCode, /Water request cancelled locally\./);
  assert.doesNotMatch(reqCode, /Water request cancelled locally\./);

  // Both screens use authoritative status failure message
  assert.match(dashCode, /Unable to confirm cancellation\. Please check your order status\./);
  assert.match(reqCode, /Unable to confirm cancellation\. Please check your order status\./);
});

test('Keep Request handler closes the modal without mutating request state', () => {
  const dashCode = read('app/requester/r_dashboard.jsx');
  const reqCode = read('app/requester/r_request.jsx');

  // Both screens close modal onKeep by resetting requestToCancel without network mutations
  assert.match(dashCode, /const closeCancelModal = \(\) => {\s*if \(cancellingRequestId\) return;\s*setRequestToCancel\(null\);\s*};/);
  assert.match(reqCode, /const closeCancelModal = \(\) => {\s*if \(cancellingRequestId\) return;\s*setRequestToCancel\(null\);\s*};/);
});

test('Failed cancel safely shows single error toast and clears cancelling state', () => {
  const dashCode = read('app/requester/r_dashboard.jsx');
  const reqCode = read('app/requester/r_request.jsx');

  // Clearing cancellingRequestId in finally block
  assert.match(dashCode, /finally {\s*setCancellingRequestId\(''\);\s*}/);
  assert.match(reqCode, /finally {\s*setCancellingRequestId\(''\);\s*}/);
});

// ============================================================================
// 3. Authoritative Service-Level Cancellation & Reconciliation
// ============================================================================

test('cancelRequest handles normal successful cancellation', async () => {
  const { cancelRequest } = loadRequestsService({
    cancelRequesterOrder: async (orderId) => ({ id: orderId, status: 'Cancelled', requesterUid: 'u1' }),
  });

  const result = await cancelRequest({ id: 'order-ok', status: 'Pending' });
  assert.equal(result.id, 'order-ok');
  assert.equal(result.status, 'Cancelled');
});

test('cancelRequest reconciles when response packet is dropped after server successfully cancels', async () => {
  let patchCalls = 0;
  const { cancelRequest } = loadRequestsService();

  const result = await cancelRequest(
    { id: 'order-lost-response', status: 'Pending' },
    {
      cancelRequesterOrder: async () => {
        patchCalls++;
        // Simulates network drop after server committed
        const err = new TypeError('Failed to fetch');
        throw err;
      },
      reconcileOrderStatus: async (orderId) => {
        // Authoritative reconciliation reads the order from server, confirming status is Cancelled
        return { id: orderId, status: 'Cancelled', requesterUid: 'u1' };
      },
    }
  );

  assert.equal(patchCalls, 1, 'Never retries cancellation mutation automatically');
  assert.equal(result.id, 'order-lost-response');
  assert.equal(result.status, 'Cancelled');
});

test('cancelRequest rejects when network drops before request reaches server (order still active)', async () => {
  let patchCalls = 0;
  const { cancelRequest } = loadRequestsService();

  await assert.rejects(
    async () => {
      await cancelRequest(
        { id: 'order-network-lost', status: 'Pending' },
        {
          cancelRequesterOrder: async () => {
            patchCalls++;
            throw new TypeError('Failed to fetch');
          },
          reconcileOrderStatus: async (orderId) => {
            // Authoritative reconciliation reads the order from server, confirming it is STILL PENDING
            return { id: orderId, status: 'Pending', requesterUid: 'u1' };
          },
        }
      );
    },
    (err) => {
      assert.match(err.message, /Cancellation could not be completed\. Your order remains active\./);
      assert.equal(err.orderActive, true);
      return true;
    }
  );

  assert.equal(patchCalls, 1, 'Never retries cancellation mutation automatically');
});

test('cancelRequest rejects with clear status-unknown message when network is completely offline', async () => {
  let patchCalls = 0;
  const { cancelRequest } = loadRequestsService();

  await assert.rejects(
    async () => {
      await cancelRequest(
        { id: 'order-offline', status: 'Pending' },
        {
          cancelRequesterOrder: async () => {
            patchCalls++;
            throw new TypeError('Network request failed');
          },
          reconcileOrderStatus: async () => {
            // Both mutation and reconciliation are unreachable
            throw new TypeError('Network request failed');
          },
        }
      );
    },
    (err) => {
      assert.match(err.message, /Unable to confirm cancellation\. Please check your order status\./);
      assert.equal(err.statusUnknown, true);
      return true;
    }
  );

  assert.equal(patchCalls, 1, 'Never retries cancellation mutation automatically');
});

test('cancelRequest re-throws 4xx client errors immediately without reconciliation loop', async () => {
  let reconcileCalls = 0;
  const { cancelRequest } = loadRequestsService();

  await assert.rejects(
    async () => {
      await cancelRequest(
        { id: 'order-already-dispatched', status: 'Pending' },
        {
          cancelRequesterOrder: async () => {
            const err = new Error('Only pending orders can be cancelled.');
            err.status = 409;
            err.code = 'ORDER_NOT_CANCELLABLE';
            throw err;
          },
          reconcileOrderStatus: async () => {
            reconcileCalls++;
            return null;
          },
        }
      );
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /Only pending orders can be cancelled\./);
      return true;
    }
  );

  assert.equal(reconcileCalls, 0, 'Does not reconcile on explicit 4xx rejection');
});

// ============================================================================
// 4. Authoritative Backend Cancellation API Tests
// ============================================================================

test('Backend allows requester to cancel a pending order and clears active order guard', async () => {
  const { records, getAdmin } = fixture();
  const handler = createRequesterOrdersHandler(getAdmin);

  const res = await call(handler, 'PATCH', 'requester-token', {
    orderId: 'order-pending-1',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.order.status, 'Cancelled');

  // Check stored record
  const saved = records.get('requests/order-pending-1');
  assert.equal(saved.status, 'Cancelled');
  assert.equal(saved.cancellationActorRole, 'requester');
  assert.ok(saved.cancelledAt instanceof Date);

  // Check active order guard is removed
  assert.equal(records.has('requesterActiveOrders/requester-1'), false);
});

test('Backend rejects cancellation for delivered or completed orders with 409', async () => {
  const { records, getAdmin } = fixture();
  const handler = createRequesterOrdersHandler(getAdmin);

  const res = await call(handler, 'PATCH', 'requester-token', {
    orderId: 'order-delivered-1',
  });

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error.message, /Only pending orders can be cancelled/i);

  // Order status unchanged
  const saved = records.get('requests/order-delivered-1');
  assert.equal(saved.status, 'Delivered');
});

test('Backend rejects cancellation for already cancelled orders with 409', async () => {
  const { records, getAdmin } = fixture();
  const handler = createRequesterOrdersHandler(getAdmin);

  const res = await call(handler, 'PATCH', 'requester-token', {
    orderId: 'order-cancelled-1',
  });

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error.message, /Only pending orders can be cancelled/i);
});

test('Backend rejects cancellation by a different requester with 404', async () => {
  const { records, getAdmin } = fixture();
  const handler = createRequesterOrdersHandler(getAdmin);

  const res = await call(handler, 'PATCH', 'requester-2-token', {
    orderId: 'order-pending-1',
  });

  assert.equal(res.statusCode, 404);
  assert.match(res.body.error.message, /Order not found/i);

  // Order status unchanged
  const saved = records.get('requests/order-pending-1');
  assert.equal(saved.status, 'Pending');
});

test('Backend preserves requesterActiveOrders guard when cancellation fails or is not committed', async () => {
  const { records, getAdmin } = fixture({
    'requests/order-active-other': {
      requesterUid: 'requester-2',
      requester_id: 'requester-2',
      status: 'Pending',
      branchId: 'central',
    },
    'requesterActiveOrders/requester-2': {
      orderId: 'order-active-other',
      status: 'Pending',
    },
  });
  const handler = createRequesterOrdersHandler(getAdmin);

  // Requester 1 attempts to cancel requester 2's active order
  const res = await call(handler, 'PATCH', 'requester-token', {
    orderId: 'order-active-other',
  });

  assert.equal(res.statusCode, 404);

  // Active order guard for requester-2 must NOT be deleted
  assert.equal(records.has('requesterActiveOrders/requester-2'), true);
  assert.equal(records.get('requesterActiveOrders/requester-2').orderId, 'order-active-other');
});
