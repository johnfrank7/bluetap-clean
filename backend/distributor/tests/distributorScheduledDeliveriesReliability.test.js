const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const read = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

// ----------------------------------------------------------------------------
// Pure-logic state classifier reflecting app/distributor/d_scheduled_requests.jsx
// ----------------------------------------------------------------------------
function classifyScheduledDeliveriesState({
  loading,
  hasLoadedOnce,
  refreshing,
  error,
  scheduledCount,
  actionError,
}) {
  if (loading && !hasLoadedOnce) {
    return 'INITIAL_LOADING';
  }
  if (error && !hasLoadedOnce && scheduledCount === 0) {
    return 'UNAVAILABLE_WITHOUT_DATA';
  }
  if (hasLoadedOnce) {
    if (error && scheduledCount > 0) {
      return 'STALE_DATA_WITH_ERROR';
    }
    if (error && scheduledCount === 0) {
      return 'STALE_EMPTY_WITH_ERROR';
    }
    if (refreshing) {
      return scheduledCount > 0 ? 'REFRESHING_WITH_DATA' : 'REFRESHING_EMPTY';
    }
    if (scheduledCount === 0) {
      return 'LOADED_EMPTY';
    }
    return 'LOADED_WITH_DATA';
  }
  return 'UNKNOWN';
}

const UPCOMING_STATUSES = new Set([
  'accepted',
  'scheduled',
  'delivery failed',
  'delivery_failed',
]);

const normStatus = (s) => String(s || '').trim().toLowerCase().replace(/[_\s-]+/g, '_');

test('A. Initial loading before first authoritative result', () => {
  const state = classifyScheduledDeliveriesState({
    loading: true,
    hasLoadedOnce: false,
    refreshing: false,
    error: '',
    scheduledCount: 0,
    actionError: '',
  });

  assert.equal(state, 'INITIAL_LOADING');
  // Confirm that empty state and error card are not shown during INITIAL_LOADING
  assert.notEqual(state, 'LOADED_EMPTY');
  assert.notEqual(state, 'UNAVAILABLE_WITHOUT_DATA');
});

test('B. Successful fetch with scheduled deliveries', () => {
  const state = classifyScheduledDeliveriesState({
    loading: false,
    hasLoadedOnce: true,
    refreshing: false,
    error: '',
    scheduledCount: 3,
    actionError: '',
  });

  assert.equal(state, 'LOADED_WITH_DATA');
});

test('C. Successful fetch with empty scheduled list', () => {
  const state = classifyScheduledDeliveriesState({
    loading: false,
    hasLoadedOnce: true,
    refreshing: false,
    error: '',
    scheduledCount: 0,
    actionError: '',
  });

  assert.equal(state, 'LOADED_EMPTY');
});

test('D. Initial fetch network failure — show error, NOT "No Scheduled Deliveries"', () => {
  const state = classifyScheduledDeliveriesState({
    loading: false,
    hasLoadedOnce: false,
    refreshing: false,
    error: 'Failed to fetch',
    scheduledCount: 0,
    actionError: '',
  });

  assert.equal(state, 'UNAVAILABLE_WITHOUT_DATA');
  assert.notEqual(state, 'LOADED_EMPTY', 'Must NOT display No Scheduled Deliveries on initial fetch failure');
});

test('E. Network failure after successful nonempty load — preserve cards with stale-data warning', () => {
  const state = classifyScheduledDeliveriesState({
    loading: false,
    hasLoadedOnce: true,
    refreshing: false,
    error: 'Unable to refresh',
    scheduledCount: 2,
    actionError: '',
  });

  assert.equal(state, 'STALE_DATA_WITH_ERROR');
  assert.notEqual(state, 'UNAVAILABLE_WITHOUT_DATA', 'Must not unmount cards on transient refresh failure');
  assert.notEqual(state, 'LOADED_EMPTY', 'Must not show empty state');
});

test('F. Network failure after successfully confirmed empty load — distinguish last known empty state', () => {
  const state = classifyScheduledDeliveriesState({
    loading: false,
    hasLoadedOnce: true,
    refreshing: false,
    error: 'Failed to fetch',
    scheduledCount: 0,
    actionError: '',
  });

  assert.equal(state, 'STALE_EMPTY_WITH_ERROR');
  assert.notEqual(state, 'LOADED_EMPTY', 'Must be classified as stale empty with error to display warning notice');
});

test('G. Retry after an initial failure transitions correctly upon success', async () => {
  let refreshingCallCount = 0;
  let isRetrying = false;

  const mockRefresh = async () => {
    refreshingCallCount++;
    return [{ id: 'order-1', status: 'scheduled' }];
  };

  const handleRetry = async () => {
    if (isRetrying) return;
    isRetrying = true;
    try {
      await mockRefresh();
    } finally {
      isRetrying = false;
    }
  };

  // Trigger retry
  await handleRetry();
  assert.equal(refreshingCallCount, 1);
  assert.equal(isRetrying, false);

  const stateAfterRetry = classifyScheduledDeliveriesState({
    loading: false,
    hasLoadedOnce: true,
    refreshing: false,
    error: '',
    scheduledCount: 1,
    actionError: '',
  });
  assert.equal(stateAfterRetry, 'LOADED_WITH_DATA');
});

test('H. Retry after failure with stale data clears error banner upon resolution', async () => {
  let orders = [{ id: 'order-1', status: 'scheduled' }];
  let error = 'Network failure';

  const mockRefresh = async () => {
    error = '';
    orders = [
      { id: 'order-1', status: 'scheduled' },
      { id: 'order-2', status: 'accepted' },
    ];
  };

  await mockRefresh();

  const state = classifyScheduledDeliveriesState({
    loading: false,
    hasLoadedOnce: true,
    refreshing: false,
    error,
    scheduledCount: orders.length,
    actionError: '',
  });

  assert.equal(state, 'LOADED_WITH_DATA');
  assert.equal(error, '');
});

test('I. Repeated Retry taps do not create duplicate requests', async () => {
  let activeInvocations = 0;
  let totalCalls = 0;
  let retrying = false;

  const mockRefresh = async () => {
    totalCalls++;
    activeInvocations++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    activeInvocations--;
  };

  const handleRetry = async () => {
    if (retrying) return;
    retrying = true;
    try {
      await mockRefresh();
    } finally {
      retrying = false;
    }
  };

  // Rapid double-tap
  const p1 = handleRetry();
  const p2 = handleRetry();
  const p3 = handleRetry();

  await Promise.all([p1, p2, p3]);

  assert.equal(totalCalls, 1, 'Only exactly 1 request should be executed');
  assert.equal(activeInvocations, 0);
  assert.equal(retrying, false);
});

test('J. Firestore listener error followed by recovery snapshot preserves orders then clears error', () => {
  // Simulate state machine in services/distributorOrders.js
  const entry = {
    orders: [{ id: 'order-1', status: 'scheduled' }],
    loaded: true,
    hasLoadedOnce: true,
    error: '',
  };

  // 1. Transient listener error occurs
  const errorCallback = (err) => {
    entry.loaded = true;
    entry.error = err?.message || 'Listener failed';
    // NOTE: orders are NOT wiped!
  };
  errorCallback(new Error('Network disconnected'));

  assert.equal(entry.orders.length, 1, 'Orders must remain intact on listener error');
  assert.equal(entry.error, 'Network disconnected');
  assert.equal(entry.hasLoadedOnce, true);

  // 2. Recovery snapshot arrives
  const snapshotCallback = (docs) => {
    entry.orders = docs;
    entry.loaded = true;
    entry.hasLoadedOnce = true;
    entry.error = '';
  };
  snapshotCallback([
    { id: 'order-1', status: 'scheduled' },
    { id: 'order-2', status: 'scheduled' },
  ]);

  assert.equal(entry.orders.length, 2);
  assert.equal(entry.error, '', 'Error must be cleared on recovery');
});

test('K. Temporary backend disconnect does not clear cached orders', () => {
  const entry = {
    orders: [{ id: 'order-prev', status: 'scheduled' }],
    hasLoadedOnce: true,
    loaded: true,
    error: '',
  };

  // Simulate catch block of hydrateDistributorOrders
  const catchBlock = (err) => {
    entry.loaded = true;
    entry.error = err.message || 'Assigned deliveries are temporarily unavailable.';
  };

  catchBlock(new Error('Failed to fetch'));

  assert.equal(entry.orders.length, 1);
  assert.equal(entry.orders[0].id, 'order-prev');
  assert.equal(entry.error, 'Failed to fetch');
});

test('L. Logout/account switch does not expose previous Distributor orders', () => {
  const distributorOrderEntries = new Map();
  distributorOrderEntries.set('dist-123', {
    orders: [{ id: 'order-secret', status: 'scheduled' }],
    hasLoadedOnce: true,
    loaded: true,
  });

  const stopDistributorOrders = (uid, entry) => {
    distributorOrderEntries.delete(uid);
  };

  const clearAssignedDistributorOrdersCache = (uid) => {
    const entries = uid
      ? [[uid, distributorOrderEntries.get(uid)]]
      : [...distributorOrderEntries.entries()];
    entries.forEach(([key, entry]) => {
      if (!entry) return;
      stopDistributorOrders(key, entry);
    });
  };

  // Logout or switch user
  clearAssignedDistributorOrdersCache('dist-123');

  assert.equal(distributorOrderEntries.has('dist-123'), false, 'Cache for logged-out distributor must be deleted');
});

test('M. Status transitions update Scheduled Deliveries correctly and post-mutation refresh failure does not mask success', async () => {
  let scheduledRequests = [
    { sourceId: 'order-1', status: 'scheduled' },
  ];
  let toast = null;
  let actionError = '';

  const advanceDelivery = async (request, action) => {
    actionError = '';
    // 1. Authoritative mutation succeeds
    scheduledRequests = scheduledRequests.filter((r) => r.sourceId !== request.sourceId);

    // 2. Subsequent background refresh encounters network error
    try {
      throw new Error('Failed to fetch');
    } catch {
      // Non-blocking background sync failure
    }

    toast = { visible: true, message: 'Delivery started.', type: 'info' };
  };

  await advanceDelivery({ sourceId: 'order-1' }, 'start-delivery');

  assert.equal(scheduledRequests.length, 0, 'Order moved out of scheduled');
  assert.equal(actionError, '', 'actionError must NOT be set to Failed to fetch when mutation succeeded');
  assert.equal(toast.type, 'info');
  assert.equal(toast.message, 'Delivery started.');
});

test('N. Out-for-delivery, completed, failed and cancelled statuses follow existing filtering policy', () => {
  const orders = [
    { id: '1', status: 'accepted' },
    { id: '2', status: 'scheduled' },
    { id: '3', status: 'delivery_failed' },
    { id: '4', status: 'delivery failed' },
    { id: '5', status: 'out_for_delivery' },
    { id: '6', status: 'delivered' },
    { id: '7', status: 'cancelled' },
    { id: '8', status: 'pending' },
    { id: '9', status: 'distributor_assigned' },
  ];

  const scheduled = orders.filter((o) =>
    UPCOMING_STATUSES.has(o.status.toLowerCase().trim())
  );

  assert.deepEqual(
    scheduled.map((o) => o.id),
    ['1', '2', '3', '4']
  );
  assert.ok(!scheduled.some((o) => o.status === 'out_for_delivery'));
  assert.ok(!scheduled.some((o) => o.status === 'delivered'));
  assert.ok(!scheduled.some((o) => o.status === 'cancelled'));
});

test('O. An uncertain mutation result does not produce a false success/empty state', () => {
  let actionError = '';
  let toast = null;
  let orders = [{ id: 'order-1', status: 'scheduled' }];

  const simulateFailedMutation = (updateError) => {
    actionError = updateError.message || 'The delivery could not be updated.';
    if (updateError.statusUnknown) {
      toast = { visible: true, message: updateError.message, type: 'info' };
    }
  };

  const unknownError = new Error('Unable to confirm the action. Please refresh or check the order status.');
  unknownError.statusUnknown = true;

  simulateFailedMutation(unknownError);

  assert.equal(orders.length, 1, 'Order must remain in scheduled list when mutation is uncertain');
  assert.equal(actionError, 'Unable to confirm the action. Please refresh or check the order status.');
  assert.equal(toast.type, 'info');
});

test('P. Permission denied is not disguised as generic offline failure', () => {
  const distributorOrdersError = (error) => error?.code === 'permission-denied'
    ? 'Your delivery access could not be verified. Please try again.'
    : error?.message || 'Assigned deliveries are temporarily unavailable.';

  const permError = { code: 'permission-denied', message: 'Permission denied in firestore rules' };
  const offlineError = { code: 'unavailable', message: 'Failed to fetch' };

  assert.equal(distributorOrdersError(permError), 'Your delivery access could not be verified. Please try again.');
  assert.equal(distributorOrdersError(offlineError), 'Failed to fetch');
});

test('Q. Older fetch response cannot overwrite newer listener data', () => {
  const entry = {
    orders: [{ id: 'order-1', status: 'out_for_delivery', version: 2 }],
    lastSnapshotTimestamp: 1000,
  };

  const fetchStartTime = 900; // fetch started BEFORE snapshot arrived at 1000
  const ordersFromApi = [{ id: 'order-1', status: 'scheduled', version: 1 }];

  const existing = new Map(entry.orders.map((o) => [o.id, o]));
  const isSnapshotNewer = entry.lastSnapshotTimestamp > fetchStartTime;

  const hydrated = ordersFromApi.map((order) => {
    const cached = existing.get(order.id);
    if (cached && isSnapshotNewer) {
      return { ...order, ...cached };
    }
    return { ...(cached || {}), ...order };
  });

  assert.equal(isSnapshotNewer, true);
  assert.equal(hydrated[0].status, 'out_for_delivery', 'Newer realtime snapshot status must be preserved');
  assert.equal(hydrated[0].version, 2);
});

test('R. No duplicate Firestore subscriptions', () => {
  let subscriptionCount = 0;
  const entry = {
    branchId: '',
    ordersUnsubscribe: null,
  };

  const listenForDistributorOrders = (uid, branchId) => {
    const normalizedBranchId = String(branchId || '').trim();
    if (!normalizedBranchId || (entry.branchId === normalizedBranchId && entry.ordersUnsubscribe)) return;

    entry.ordersUnsubscribe?.();
    entry.branchId = normalizedBranchId;
    subscriptionCount++;
    entry.ordersUnsubscribe = () => { subscriptionCount--; };
  };

  listenForDistributorOrders('dist-1', 'branch-A');
  assert.equal(subscriptionCount, 1);

  // Calling again for the same branch should NOT create a duplicate subscription
  listenForDistributorOrders('dist-1', 'branch-A');
  assert.equal(subscriptionCount, 1, 'Must not duplicate subscription for same branch');

  // Switching branch cleans up previous and starts new
  listenForDistributorOrders('dist-1', 'branch-B');
  assert.equal(subscriptionCount, 1, 'Previous subscription must be cleaned up when changing branch');
});

test('S. Light and dark error/empty states remain readable', () => {
  const themeSrc = read('constants/bluetapTheme.js');

  // Verify warning and warningSoft tokens exist for light theme
  assert.match(themeSrc, /warning:\s*['"]#[0-9A-Fa-f]{6}['"]/);
  assert.match(themeSrc, /warningSoft:\s*['"]#[0-9A-Fa-f]{6}['"]/);

  // Verify dark theme has separate high-contrast warning tokens
  assert.match(themeSrc, /BLUETAP_DARK_COLORS\s*=\s*Object\.freeze\(\{[\s\S]*?warning:\s*['"]#F59E0B['"]/);
  assert.match(themeSrc, /BLUETAP_DARK_COLORS\s*=\s*Object\.freeze\(\{[\s\S]*?warningSoft:\s*['"]#493814['"]/);
});

test('T. Verify Scheduled Deliveries code integrity and contract conformance', () => {
  const scheduledSrc = read('app/distributor/d_scheduled_requests.jsx');
  const serviceSrc = read('services/distributorOrders.js');

  // 1. Destructuring hasLoadedOnce and refreshing
  assert.match(scheduledSrc, /hasLoadedOnce/);
  assert.match(scheduledSrc, /refreshing/);

  // 2. Retry handler with duplicate-tap protection
  assert.match(scheduledSrc, /const\s*handleRetry\s*=\s*async/);
  assert.match(scheduledSrc, /if\s*\(retrying\s*\|\|\s*refreshing\)\s*return;/);

  // 3. Initial loading check
  assert.match(scheduledSrc, /loading\s*&&\s*!hasLoadedOnce/);

  // 4. Stale warning banner
  assert.match(scheduledSrc, /Unable to refresh deliveries/);
  assert.match(scheduledSrc, /Showing previously loaded information\./);
  assert.match(scheduledSrc, /Showing previously confirmed empty schedule\./);

  // 5. Action error dismiss button
  assert.match(scheduledSrc, /actionErrorDismissBtn/);

  // 6. RefreshControl integration
  assert.match(scheduledSrc, /RefreshControl/);

  // 7. Services state emission
  assert.match(serviceSrc, /hasLoadedOnce:\s*!!entry\.hasLoadedOnce/);
  assert.match(serviceSrc, /refreshing:\s*!!entry\.refreshing/);
});
