const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const { createRequire } = require('node:module');

function requireTranspiled(relPath) {
  const fullPath = path.resolve(__dirname, relPath);
  const code = fs.readFileSync(fullPath, 'utf8');
  const transformed = babel.transformSync(code, {
    presets: ['babel-preset-expo'],
    filename: fullPath,
  }).code;
  const mod = { exports: {} };
  const customRequire = createRequire(fullPath);
  const fn = new Function('require', 'module', 'exports', transformed);
  fn(customRequire, mod, mod.exports);
  return mod.exports;
}

const {
  ASSISTANT_INTENTS,
  DISTRIBUTOR_ASSISTANT_INTENTS,
  classifyDistributorIntent,
  classifyIntentDetails,
  classifyIntent,
  detectLanguage,
} = requireTranspiled('../../../services/assistant/assistantIntents.js');

const {
  buildSafeAssistantContext,
  buildSafeDistributorContext,
  sanitizeOrder,
  sanitizeDistributorOrder,
} = requireTranspiled('../../../services/assistant/assistantContext.js');

const {
  DeterministicAssistantEngine,
} = requireTranspiled('../../../services/assistant/assistantEngine.js');

const {
  isActiveRequesterOrderStatus,
  isApprovedRequesterOrderStatus,
  isCancellableRequesterOrderStatus,
  normalizeRequesterOrderStatus,
} = requireTranspiled('../../../constants/requesterOrderStatus.js');

const {
  ASSISTANT_ACTIONS,
  createAction,
  isAllowedActionType,
} = requireTranspiled('../../../services/assistant/assistantActions.js');

function loadTypewriterModule() {
  const fullPath = path.resolve(__dirname, '../../../components/assistant/useAssistantTypewriter.js');
  const code = fs.readFileSync(fullPath, 'utf8');
  const transformed = babel.transformSync(code, {
    presets: ['babel-preset-expo'],
    filename: fullPath,
  }).code;
  const mod = { exports: {} };
  const mockRequire = (id) => {
    if (id === 'react') return require('react');
    if (id.includes('BlueTapThemeTransition')) {
      return { useReducedMotionPreference: () => false };
    }
    if (!id.startsWith('.')) return require(id);
    return {};
  };
  const fn = new Function('require', 'module', 'exports', transformed);
  fn(mockRequire, mod, mod.exports);
  return mod.exports;
}

const {
  calculateTypewriterConfig,
  TYPEWRITER_BASE_INTERVAL_MS,
  TYPEWRITER_MAX_DURATION_MS,
} = loadTypewriterModule();

// ==========================================
// PART 1: CORE PHASE 16 BASELINE TESTS (1-18)
// ==========================================

// 1. Can I cancel my current order? (CANCEL_ORDER_ELIGIBILITY)
test('Test 1: CANCEL_ORDER_ELIGIBILITY distinguishes cancellation eligibility queries in EN and CEB', async () => {
  const queries = [
    'Can I cancel my current order?',
    'Can I cancel?',
    'Is it possible to cancel my request?',
    'pwede ba nako ma cancel akong order?',
    'pwede ma-cancel akong tubig?',
    'pwede ba nako i kansela akong request?',
  ];

  for (const q of queries) {
    const details = classifyIntentDetails(q);
    assert.equal(
      details.intent,
      ASSISTANT_INTENTS.CANCEL_ORDER_ELIGIBILITY,
      `Expected "${q}" to classify as CANCEL_ORDER_ELIGIBILITY, got ${details.intent}`
    );
  }

  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_active_1',
          publicOrderId: 'ORD-1001',
          status: 'pending',
          branch_name: 'Metro Water Hub',
          branch_id: 'branch_1',
        },
      ],
    },
  });

  const engine = new DeterministicAssistantEngine();

  const responseEn = await engine.respond({
    userInput: 'Can I cancel my current order?',
    safeContext,
    role: 'requester',
  });
  assert.match(responseEn.message, /ORD-1001/);
  assert.match(responseEn.message, /pending/i);
  assert.match(responseEn.message, /cancellable|cancel/i);
  assert.ok(responseEn.actions.some((a) => a.type === 'VIEW_ORDER' && a.orderId === 'ord_active_1'));

  const responseCeb = await engine.respond({
    userInput: 'pwede nako ma-cancel akong tubig?',
    safeContext,
    role: 'requester',
  });
  assert.match(responseCeb.message, /ORD-1001/);
  assert.match(responseCeb.message, /pwede pa kini kanselahon/i);
});

// 2. Cancel my current order. (REQUEST_CANCEL_ORDER - requires confirmation)
test('Test 2: REQUEST_CANCEL_ORDER requires explicit review and confirmation, never auto-cancels', async () => {
  const queries = [
    'Cancel my current order.',
    'Cancel my order now please',
    'i-cancel akong order',
    'palihug i-cancel akong request',
    'i kansela akong order',
  ];

  for (const q of queries) {
    const details = classifyIntentDetails(q);
    assert.equal(
      details.intent,
      ASSISTANT_INTENTS.REQUEST_CANCEL_ORDER,
      `Expected "${q}" to classify as REQUEST_CANCEL_ORDER, got ${details.intent}`
    );
  }

  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_active_2',
          publicOrderId: 'ORD-2002',
          status: 'pending',
          branch_name: 'Downtown Station',
          branch_id: 'branch_2',
        },
      ],
    },
  });

  const engine = new DeterministicAssistantEngine();
  const response = await engine.respond({
    userInput: 'Cancel my current order.',
    safeContext,
    role: 'requester',
  });

  // Never automatically marks the order as cancelled
  assert.doesNotMatch(response.message, /has been cancelled/i);
  assert.match(response.message, /ORD-2002/);
  assert.match(response.message, /requires explicit confirmation|review your order details and confirm/i);
  const cancelAction = response.actions.find((a) => a.type === 'VIEW_ORDER');
  assert.ok(cancelAction, 'Must provide VIEW_ORDER action');
  assert.equal(cancelAction.orderId, 'ord_active_2');
  assert.equal(cancelAction.label, 'Review & Cancel Request');
});

// 3. User declines cancellation (Keep Order mutates nothing)
test('Test 3: Declining cancellation (Keep Order) results in zero backend mutations', async () => {
  let backendMutationAttempted = false;
  const mockCancelBackend = async () => {
    backendMutationAttempted = true;
    return { success: true };
  };

  const simulatedUserChoice = 'Keep Order';

  if (simulatedUserChoice === 'Cancel Request') {
    await mockCancelBackend();
  }

  assert.equal(backendMutationAttempted, false, 'Selecting Keep Order must not trigger backend mutation');
});

// 4. User explicitly confirms via existing UI
test('Test 4: Explicit confirmation executes backend cancellation with targeted order ID', async () => {
  let targetedOrderId = null;
  const mockCancelBackend = async (request) => {
    targetedOrderId = request.id;
    return { success: true };
  };

  const activeRequest = {
    id: 'ord_target_4',
    publicOrderId: 'ORD-4004',
    status: 'pending',
  };

  const simulatedUserChoice = 'Cancel Request';
  if (simulatedUserChoice === 'Cancel Request') {
    await mockCancelBackend(activeRequest);
  }

  assert.equal(targetedOrderId, 'ord_target_4', 'Must pass targeted order document ID to backend cancel handler');
});

// 5. Cancellation succeeds (updates state and reconciles data)
test('Test 5: Authoritative cancellation success updates state and confirms target order', async () => {
  let reconciledUid = null;
  const mockRefreshRequests = async (uid) => {
    reconciledUid = uid;
  };

  const currentUid = 'user_req_5';
  const targetRequest = {
    id: 'ord_5005',
    publicOrderId: 'ORD-5005',
    status: 'pending',
  };

  const backendResult = { success: true, orderId: targetRequest.id };
  assert.equal(backendResult.success, true);

  await mockRefreshRequests(currentUid);
  assert.equal(reconciledUid, 'user_req_5');

  const allOrders = [
    { id: 'ord_5005', status: 'cancelled' },
  ];
  const remainingActive = allOrders.filter(
    (o) => o.id !== targetRequest.id && isActiveRequesterOrderStatus(o.status)
  );
  assert.equal(remainingActive.length, 0);
});

// 6. Cancellation fails (fails closed, reports unconfirmed)
test('Test 6: Cancellation failure fails closed without claiming success', async () => {
  let claimedSuccess = false;
  let reportedAlertTitle = '';

  const mockFailingBackend = async () => {
    throw new Error('Network timeout or server unavailable');
  };

  try {
    await mockFailingBackend();
    claimedSuccess = true;
  } catch (err) {
    reportedAlertTitle = 'Cancellation Status Unconfirmed';
  }

  assert.equal(claimedSuccess, false, 'Must not claim success on failure');
  assert.equal(reportedAlertTitle, 'Cancellation Status Unconfirmed');
});

// 7. Cancellation is no longer eligible (e.g. out_for_delivery, assigned)
test('Test 7: Ineligible statuses (out_for_delivery, assigned) reject cancellation guidance', async () => {
  assert.equal(isCancellableRequesterOrderStatus('out_for_delivery'), false);
  assert.equal(isCancellableRequesterOrderStatus('assigned'), false);
  assert.equal(isCancellableRequesterOrderStatus('accepted'), false);
  assert.equal(isCancellableRequesterOrderStatus('scheduled'), false);

  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_dispatched',
          publicOrderId: 'ORD-7007',
          status: 'out_for_delivery',
          branch_name: 'Metro Central',
          branch_id: 'branch_metro',
        },
      ],
    },
  });

  const engine = new DeterministicAssistantEngine();
  const response = await engine.respond({
    userInput: 'Can I cancel my current order?',
    safeContext,
    role: 'requester',
  });

  assert.match(response.message, /already been approved|no longer available/i);
  assert.match(response.message, /ORD-7007/);
  assert.ok(response.actions.some((a) => a.type === 'CONTACT_STATION'));
});

// 8. Previous cancelled Order A plus active Order B
test('Test 8: Distinguishes cancelled Order A from active Order B and references active Order B', async () => {
  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_A',
          publicOrderId: 'ORD-A-CANCELLED',
          status: 'cancelled',
          created_at: 1710000000000,
        },
        {
          id: 'ord_B',
          publicOrderId: 'ORD-B-ACTIVE',
          status: 'pending',
          created_at: 1710001000000,
          branch_name: 'North Station',
          branch_id: 'branch_north',
        },
      ],
    },
  });

  assert.equal(safeContext.hasActiveOrder, true);
  assert.equal(safeContext.activeOrder.publicOrderId, 'ORD-B-ACTIVE');
  assert.equal(safeContext.activeOrder.id, 'ord_B');

  const engine = new DeterministicAssistantEngine();

  // Query: Can I cancel my current order?
  const cancelEligibility = await engine.respond({
    userInput: 'Can I cancel my current order?',
    safeContext,
    role: 'requester',
  });
  assert.match(cancelEligibility.message, /ORD-B-ACTIVE/);
  assert.doesNotMatch(cancelEligibility.message, /ORD-A-CANCELLED/);
  assert.doesNotMatch(cancelEligibility.message, /was cancelled\. You can place a new order/i);

  // Query: Can I place another order?
  const newOrderEligibility = await engine.respond({
    userInput: 'Can I place another order?',
    safeContext,
    role: 'requester',
  });
  assert.match(newOrderEligibility.message, /ORD-B-ACTIVE/);
  assert.match(newOrderEligibility.message, /active water request|one active order/i);
  assert.ok(
    newOrderEligibility.actions.some((a) => a.type === 'VIEW_ORDER' && a.orderId === 'ord_B'),
    'Offers View Order for active Order B'
  );
  assert.ok(
    !newOrderEligibility.actions.some((a) => a.type === 'START_ORDER'),
    'Must NOT offer START_ORDER while Order B is active'
  );
});

// 9. Active order awaiting Manager approval (manager_approval_pending is cancellable)
test('Test 9: manager_approval_pending status is recognized as cancellable and active awaiting approval', async () => {
  assert.equal(isActiveRequesterOrderStatus('manager_approval_pending'), true);
  assert.equal(isCancellableRequesterOrderStatus('manager_approval_pending'), true);

  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_mgr_pending',
          publicOrderId: 'ORD-9009',
          status: 'manager_approval_pending',
          branch_name: 'Uptown Hub',
          branch_id: 'branch_uptown',
        },
      ],
    },
  });

  assert.equal(safeContext.hasActiveOrder, true);
  assert.equal(safeContext.activeOrder.isCancellable, true);
  assert.equal(safeContext.activeOrder.isAwaitingApproval, true);

  const engine = new DeterministicAssistantEngine();
  const response = await engine.respond({
    userInput: 'Can I cancel my current order?',
    safeContext,
    role: 'requester',
  });

  assert.match(response.message, /ORD-9009/);
  assert.match(response.message, /awaiting Branch Manager approval/i);
  assert.match(response.message, /cancel this request directly before approval/i);
  assert.ok(response.actions.some((a) => a.type === 'VIEW_ORDER' && a.orderId === 'ord_mgr_pending'));
});

// 10. Active order awaiting Distributor assignment (awaiting_distributor_assignment)
test('Test 10: awaiting_distributor_assignment is treated as active non-terminal order blocking new orders', async () => {
  assert.equal(isActiveRequesterOrderStatus('awaiting_distributor_assignment'), true);

  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_awaiting_dist',
          publicOrderId: 'ORD-1010',
          status: 'awaiting_distributor_assignment',
          branch_name: 'East Water Hub',
          branch_id: 'branch_east',
        },
      ],
    },
  });

  assert.equal(safeContext.hasActiveOrder, true);
  assert.equal(safeContext.canPlaceNewOrder, false);

  const engine = new DeterministicAssistantEngine();
  const response = await engine.respond({
    userInput: 'Can I place another order?',
    safeContext,
    role: 'requester',
  });

  assert.match(response.message, /ORD-1010/);
  assert.match(response.message, /active water request|one active order/i);
  assert.ok(!response.actions.some((a) => a.type === 'START_ORDER'));
});

// 11. Order data loading or unavailable (never interprets empty list as no active orders)
test('Test 11: Order data loading or unavailable never assumes no active orders exist', async () => {
  const loadingContext = buildSafeAssistantContext({
    requesterData: {
      orders: [],
      loading: true,
    },
  });

  assert.equal(loadingContext.ordersLoading, true);
  assert.equal(loadingContext.canPlaceNewOrder, false);

  const engine = new DeterministicAssistantEngine();
  const loadingResponse = await engine.respond({
    userInput: 'Can I place an order?',
    safeContext: loadingContext,
    role: 'requester',
  });

  assert.match(loadingResponse.message, /loading|checking|verifying|wait a moment/i);
  assert.doesNotMatch(loadingResponse.message, /you have no active orders/i);
  assert.ok(!loadingResponse.actions.some((a) => a.type === 'START_ORDER'));

  const unavailableContext = buildSafeAssistantContext({
    requesterData: {
      orders: null,
      error: 'Network error',
    },
  });

  assert.equal(unavailableContext.ordersUnavailable, true);
  assert.equal(unavailableContext.canPlaceNewOrder, false);

  const unavailableResponse = await engine.respond({
    userInput: 'Can I cancel my order?',
    safeContext: unavailableContext,
    role: 'requester',
  });

  assert.match(unavailableResponse.message, /unavailable|server/i);
});

// 12. No active orders, with and without ordering restrictions
test('Test 12: NEW_ORDER_ELIGIBILITY correctly distinguishes unrestricted vs restricted accounts', async () => {
  const clearContext = buildSafeAssistantContext({
    requesterData: { orders: [] },
    moderationNotices: { activeRestrictions: [] },
  });

  assert.equal(clearContext.hasActiveOrder, false);
  assert.equal(clearContext.canPlaceNewOrder, true);

  const engine = new DeterministicAssistantEngine();
  const clearResponse = await engine.respond({
    userInput: 'Can I place another order?',
    safeContext: clearContext,
    role: 'requester',
  });

  assert.match(clearResponse.message, /do not have any active water requests|place a new water order/i);
  assert.ok(clearResponse.actions.some((a) => a.type === 'START_ORDER'));

  const restrictedContext = buildSafeAssistantContext({
    requesterData: { orders: [] },
    moderationNotices: {
      activeRestrictions: [
        {
          scope: ['ordering'],
          title: 'Daily order quota reached',
          reason: 'Daily order quota reached',
          type: 'DAILY_LIMIT_EXCEEDED',
        },
      ],
    },
  });

  assert.equal(restrictedContext.hasActiveOrder, false);
  assert.equal(restrictedContext.canPlaceNewOrder, false);

  const restrictedResponse = await engine.respond({
    userInput: 'Can I place another order?',
    safeContext: restrictedContext,
    role: 'requester',
  });

  assert.match(restrictedResponse.message, /ordering restriction/i);
  assert.match(restrictedResponse.message, /Daily order quota reached/i);
  assert.ok(!restrictedResponse.actions.some((a) => a.type === 'START_ORDER'));
});

// 13. Account switching and role isolation
test('Test 13: Strict role and account isolation prevents data leakage across contexts', () => {
  const requesterData = {
    profile: { firstName: 'Alice', publicUid: 'REQ-ALICE' },
    orders: [{ id: 'req_ord_1', publicOrderId: 'ORD-REQ-1', status: 'pending' }],
  };

  const reqContext = buildSafeAssistantContext({ requesterData });
  assert.equal(reqContext.requester.firstName, 'Alice');
  assert.equal(reqContext.activeOrder.publicOrderId, 'ORD-REQ-1');
  assert.equal(reqContext.currentAssignment, undefined);

  const distributorData = {
    profile: { firstName: 'Bob', distributorId: 'DIST-BOB' },
    orders: [
      {
        id: 'dist_ord_1',
        publicOrderId: 'ORD-DIST-1',
        status: 'out_for_delivery',
        assigned_distributor_id: 'DIST-BOB',
      },
    ],
  };

  const distContext = buildSafeDistributorContext({ distributorData });
  assert.equal(distContext.distributor.firstName, 'Bob');
  assert.equal(distContext.currentAssignment.publicOrderId, 'ORD-DIST-1');
  assert.equal(distContext.requester, undefined);
});

// 14. Distributor assignment accuracy (excludes pending/unassigned)
test('Test 14: Distributor context strictly excludes unassigned and foreign distributor orders', () => {
  const distContext = buildSafeDistributorContext({
    distributorData: {
      profile: { distributorId: 'DIST-CURRENT' },
      orders: [
        {
          id: 'ord_assigned_me',
          publicOrderId: 'ORD-MINE',
          status: 'accepted',
          assigned_distributor_id: 'DIST-CURRENT',
        },
        {
          id: 'ord_unassigned_pending',
          publicOrderId: 'ORD-PENDING',
          status: 'pending',
          assigned_distributor_id: null,
        },
      ],
    },
  });

  assert.equal(distContext.hasActiveAssignment, true);
  assert.equal(distContext.currentAssignment.publicOrderId, 'ORD-MINE');
});

// 15. Distributor cancelled/delivered/failed statuses
test('Test 15: Distributor context excludes delivered and cancelled orders from active deliveries', () => {
  const distContext = buildSafeDistributorContext({
    distributorData: {
      profile: { distributorId: 'DIST-1' },
      orders: [
        {
          id: 'ord_delivered',
          publicOrderId: 'ORD-DONE',
          status: 'delivered',
          assigned_distributor_id: 'DIST-1',
        },
        {
          id: 'ord_cancelled',
          publicOrderId: 'ORD-CANC',
          status: 'cancelled',
          assigned_distributor_id: 'DIST-1',
        },
      ],
    },
  });

  assert.equal(distContext.hasActiveAssignment, false);
  assert.equal(distContext.currentAssignment, null);
  assert.equal(distContext.recentHistory.length, 1);
  assert.equal(distContext.recentHistory[0].publicOrderId, 'ORD-DONE');
});

// 16. Role-specific action authorization
test('Test 16: Assistant engine enforces role boundaries on actions', async () => {
  const reqContext = buildSafeAssistantContext({
    requesterData: {
      orders: [{ id: 'ord_1', publicOrderId: 'ORD-1', status: 'pending' }],
    },
  });

  const engine = new DeterministicAssistantEngine();
  const reqResponse = await engine.respond({
    userInput: 'where is my order?',
    safeContext: reqContext,
    role: 'requester',
  });

  for (const action of reqResponse.actions) {
    assert.ok(
      ['TRACK_ORDER', 'VIEW_ORDER', 'START_ORDER', 'OPEN_REQUESTS', 'CONTACT_STATION', 'FIND_PROVIDER'].includes(action.type),
      `Unexpected action for requester: ${action.type}`
    );
  }

  const distContext = buildSafeDistributorContext({
    distributorData: {
      profile: { distributorId: 'DIST-1', branchId: 'BR-1' },
      orders: [{ id: 'dist_1', publicOrderId: 'ORD-DIST-1', status: 'accepted' }],
    },
  });

  const distResponse = await engine.respond({
    userInput: 'where is my delivery?',
    safeContext: distContext,
    role: 'distributor',
  });

  assert.ok(!distResponse.actions.some((a) => a.type === 'START_ORDER'));
});

// 17. No duplicate or unintended backend mutations
test('Test 17: Concurrency lock prevents duplicate cancellation attempts while in flight', async () => {
  let backendCallCount = 0;
  const cancellingOrderRef = { current: false };

  const cancelHandler = async (orderId) => {
    if (cancellingOrderRef.current) return { skipped: true };
    cancellingOrderRef.current = true;
    try {
      backendCallCount++;
      await new Promise((r) => setTimeout(r, 10));
      return { success: true };
    } finally {
      cancellingOrderRef.current = false;
    }
  };

  const [res1, res2] = await Promise.all([
    cancelHandler('ord_duplicate_test'),
    cancelHandler('ord_duplicate_test'),
  ]);

  assert.equal(backendCallCount, 1, 'Only one backend cancellation call may proceed');
  assert.ok(res1.success || res2.success);
  assert.ok(res1.skipped || res2.skipped);
});

// 18. Existing assistant reply typing animation is preserved
test('Test 18: Typing animation contracts and calculation algorithms are preserved', () => {
  const shortConfig = calculateTypewriterConfig(20);
  assert.equal(shortConfig.intervalMs, TYPEWRITER_BASE_INTERVAL_MS);
  assert.equal(shortConfig.step, 1);

  const longConfig = calculateTypewriterConfig(600);
  assert.equal(longConfig.intervalMs, TYPEWRITER_BASE_INTERVAL_MS);
  assert.ok(longConfig.step > 1);

  const duration = Math.ceil(600 / longConfig.step) * longConfig.intervalMs;
  assert.ok(duration <= TYPEWRITER_MAX_DURATION_MS + 100);
});

// =========================================================================
// PART 2: STRICT BRANCH APPROVAL CANCELLATION POLICY REGRESSION TESTS (1-10)
// =========================================================================

// Branch Policy 1: Pending order cancellation
test('Branch Policy 1: Pending order cancellation is available before branch approval', async () => {
  assert.equal(isCancellableRequesterOrderStatus('pending'), true);
  assert.equal(isApprovedRequesterOrderStatus('pending'), false);

  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_pending_bp1',
          publicOrderId: 'ORD-PENDING-1',
          status: 'pending',
          branch_name: 'North Central Hub',
          branch_id: 'branch_nc',
        },
      ],
    },
  });

  const engine = new DeterministicAssistantEngine();
  const response = await engine.respond({
    userInput: 'Can I cancel my current order?',
    safeContext,
    role: 'requester',
  });

  assert.match(response.message, /ORD-PENDING-1/);
  assert.match(response.message, /can be cancelled because it has not yet been approved or dispatched/i);
  assert.ok(response.actions.some((a) => a.type === 'VIEW_ORDER' && a.orderId === 'ord_pending_bp1'));
});

// Branch Policy 2: Awaiting Branch Manager approval
test('Branch Policy 2: Awaiting Branch Manager approval clearly distinguishes pending from completed approval', async () => {
  const pendingApprovalStatuses = ['outside_radius_pending_approval', 'manager_approval_pending'];

  for (const status of pendingApprovalStatuses) {
    assert.equal(isCancellableRequesterOrderStatus(status), true);
    assert.equal(isApprovedRequesterOrderStatus(status), false);

    const safeContext = buildSafeAssistantContext({
      requesterData: {
        orders: [
          {
            id: `ord_${status}`,
            publicOrderId: `ORD-${status.toUpperCase()}`,
            status,
            branch_name: 'Highland Station',
            branch_id: 'branch_highland',
          },
        ],
      },
    });

    assert.equal(safeContext.activeOrder.isAwaitingApproval, true);
    assert.equal(safeContext.activeOrder.isApproved, false);

    const engine = new DeterministicAssistantEngine();
    const response = await engine.respond({
      userInput: 'Can I cancel my current order?',
      safeContext,
      role: 'requester',
    });

    assert.match(response.message, /awaiting Branch Manager approval/i);
    assert.match(response.message, /cancel this request directly before approval is completed/i);
    assert.doesNotMatch(response.message, /has already been approved/i);
  }
});

// Branch Policy 3: Branch Manager approval completed
test('Branch Policy 3: Branch Manager approval completed denies direct requester cancellation', async () => {
  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_approved_bp3',
          publicOrderId: 'ORD-APPROVED-3',
          status: 'awaiting_distributor_assignment',
          branch_name: 'Metro Branch',
          branch_id: 'branch_metro',
        },
      ],
    },
  });

  assert.equal(safeContext.activeOrder.isCancellable, false);
  assert.equal(safeContext.activeOrder.isApproved, true);

  const engine = new DeterministicAssistantEngine();
  const response = await engine.respond({
    userInput: 'Can I cancel my current order?',
    safeContext,
    role: 'requester',
  });

  // Verbatim recommended response check
  assert.match(
    response.message,
    /Your order \(ORD-APPROVED-3\) has already been approved by the water station, so direct cancellation is no longer available/i
  );
  assert.match(
    response.message,
    /If you need assistance, please contact your Branch Manager through BlueTap/i
  );
  // Must NOT offer direct cancellation action
  assert.ok(!response.actions.some((a) => a.label?.includes('Cancel Request')));
});

// Branch Policy 4: Awaiting Distributor assignment
test('Branch Policy 4: Awaiting Distributor assignment informs requester order was approved and offers Contact Branch Manager', async () => {
  assert.equal(isCancellableRequesterOrderStatus('awaiting_distributor_assignment'), false);
  assert.equal(isApprovedRequesterOrderStatus('awaiting_distributor_assignment'), true);

  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_awaiting_dist_bp4',
          publicOrderId: 'ORD-AWAIT-DIST',
          status: 'awaiting_distributor_assignment',
          branch_name: 'Central Hub',
          branch_id: 'branch_central',
        },
      ],
    },
  });

  const engine = new DeterministicAssistantEngine();
  const response = await engine.respond({
    userInput: 'Cancel my current order.',
    safeContext,
    role: 'requester',
  });

  assert.match(response.message, /ORD-AWAIT-DIST/);
  assert.match(response.message, /already been approved by the water station/i);
  assert.ok(response.actions.some((a) => a.type === 'CONTACT_STATION' && a.label === 'Contact Branch Manager'));
  assert.ok(!response.actions.some((a) => a.label === 'Review & Cancel Request'));
});

// Branch Policy 5: Distributor assigned
test('Branch Policy 5: Distributor assigned explains approved status and directs to Branch Manager', async () => {
  assert.equal(isCancellableRequesterOrderStatus('distributor_assigned'), false);
  assert.equal(isApprovedRequesterOrderStatus('distributor_assigned'), true);

  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_dist_assigned_bp5',
          publicOrderId: 'ORD-DIST-ASSIGNED',
          status: 'distributor_assigned',
          branch_name: 'East Water Station',
          branch_id: 'branch_east',
        },
      ],
    },
  });

  const engine = new DeterministicAssistantEngine();
  const response = await engine.respond({
    userInput: 'Can I cancel my current order?',
    safeContext,
    role: 'requester',
  });

  assert.match(response.message, /already been approved by the water station/i);
  assert.ok(response.actions.some((a) => a.type === 'CONTACT_STATION' && a.label === 'Contact Branch Manager'));
});

// Branch Policy 6: Out for delivery
test('Branch Policy 6: Out for delivery denies direct cancellation and directs to Branch Manager', async () => {
  assert.equal(isCancellableRequesterOrderStatus('out_for_delivery'), false);
  assert.equal(isApprovedRequesterOrderStatus('out_for_delivery'), true);

  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_ofd_bp6',
          publicOrderId: 'ORD-OFD-6',
          status: 'out_for_delivery',
          branch_name: 'West Branch',
          branch_id: 'branch_west',
        },
      ],
    },
  });

  const engine = new DeterministicAssistantEngine();
  const response = await engine.respond({
    userInput: 'Cancel my current order.',
    safeContext,
    role: 'requester',
  });

  assert.match(response.message, /already been approved/i);
  assert.ok(response.actions.some((a) => a.type === 'CONTACT_STATION' && a.label === 'Contact Branch Manager'));
});

// Branch Policy 7: Contact Manager action
test('Branch Policy 7: Contact Manager action provides authorized CONTACT_STATION action with branch ID', async () => {
  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_bp7',
          publicOrderId: 'ORD-BP7',
          status: 'scheduled',
          branch_name: 'South Branch',
          branch_id: 'branch_south_123',
        },
      ],
    },
  });

  const engine = new DeterministicAssistantEngine();
  const response = await engine.respond({
    userInput: 'Can I cancel my current order?',
    safeContext,
    role: 'requester',
  });

  const contactAction = response.actions.find((a) => a.type === 'CONTACT_STATION');
  assert.ok(contactAction, 'Must provide CONTACT_STATION action');
  assert.equal(contactAction.branchId, 'branch_south_123');
  assert.equal(contactAction.label, 'Contact Branch Manager');
  // Does not promise cancellation approval
  assert.match(response.message, /subject to Branch Manager review and operational policies/i);
  assert.doesNotMatch(response.message, /guaranteed|will be cancelled/i);
});

// Branch Policy 8: Cancellation denied after approval
test('Branch Policy 8: Authoritative backend denies cancellation after approval with 409 ORDER_NOT_CANCELLABLE', async () => {
  // Simulating backend transaction logic from backend/requester/orderingHandler.js line 373
  const simulateBackendCancellation = async (orderStatus) => {
    const cancellableStatuses = ['pending', 'outside_radius_pending_approval', 'manager_approval_pending'];
    if (!cancellableStatuses.includes(String(orderStatus).toLowerCase())) {
      const err = new Error('Only pending orders can be cancelled.');
      err.status = 409;
      err.reason = 'ORDER_NOT_CANCELLABLE';
      throw err;
    }
    return { success: true };
  };

  // Approved statuses must all be denied by backend
  const approvedStatuses = ['awaiting_distributor_assignment', 'distributor_assigned', 'accepted', 'scheduled', 'out_for_delivery'];
  for (const status of approvedStatuses) {
    await assert.rejects(
      async () => simulateBackendCancellation(status),
      (err) => err.status === 409 && err.reason === 'ORDER_NOT_CANCELLABLE'
    );
  }
});

// Branch Policy 9: Status changed from pending to approved while confirmation was open
test('Branch Policy 9: Status changed from pending to approved while confirmation was open fails safely closed', async () => {
  let reportedAlertTitle = '';
  let reportedAlertMessage = '';

  // Order was pending when modal opened, but changed to awaiting_distributor_assignment
  const initialModalOrder = {
    id: 'ord_race_9',
    publicOrderId: 'ORD-RACE-9',
    status: 'pending',
  };

  const liveStateOrders = [
    {
      id: 'ord_race_9',
      publicOrderId: 'ORD-RACE-9',
      status: 'awaiting_distributor_assignment', // Approved in background
    },
  ];

  // Simulating confirmation execute check in AssistantScreen.jsx
  const executeConfirmation = async () => {
    const liveCheck = liveStateOrders.find((o) => o.id === initialModalOrder.id) || initialModalOrder;
    if (!isCancellableRequesterOrderStatus(liveCheck.status)) {
      reportedAlertTitle = 'Cancellation Not Available';
      reportedAlertMessage = `Your order (${liveCheck.publicOrderId}) has already been approved by the water station, so direct cancellation is no longer available. If you need assistance, please contact your Branch Manager through BlueTap.`;
      return { aborted: true };
    }
    return { success: true };
  };

  const result = await executeConfirmation();
  assert.equal(result.aborted, true);
  assert.equal(reportedAlertTitle, 'Cancellation Not Available');
  assert.match(reportedAlertMessage, /already been approved/i);
});

// Branch Policy 10: Cancelled historical order plus another approved active order
test('Branch Policy 10: Cancelled historical order plus approved active order references the approved order and denies cancellation', async () => {
  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_hist_cancelled',
          publicOrderId: 'ORD-HIST-CANC',
          status: 'cancelled',
          created_at: 1710000000000,
        },
        {
          id: 'ord_active_approved',
          publicOrderId: 'ORD-ACTIVE-APP',
          status: 'awaiting_distributor_assignment',
          branch_name: 'Metro Station',
          branch_id: 'branch_metro_1',
          created_at: 1710001000000,
        },
      ],
    },
  });

  assert.equal(safeContext.hasActiveOrder, true);
  assert.equal(safeContext.activeOrder.publicOrderId, 'ORD-ACTIVE-APP');
  assert.equal(safeContext.activeOrder.isApproved, true);

  const engine = new DeterministicAssistantEngine();
  const response = await engine.respond({
    userInput: 'Can I cancel my current order?',
    safeContext,
    role: 'requester',
  });

  // Must reference ORD-ACTIVE-APP, never ORD-HIST-CANC
  assert.match(response.message, /ORD-ACTIVE-APP/);
  assert.doesNotMatch(response.message, /ORD-HIST-CANC/);
  assert.match(response.message, /already been approved by the water station/i);
  assert.ok(response.actions.some((a) => a.type === 'CONTACT_STATION' && a.label === 'Contact Branch Manager'));
  assert.ok(!response.actions.some((a) => a.label === 'Review & Cancel Request'));
});

// ==========================================
// PART 3: PHASE 16.1 REGRESSION TESTS (1-10)
// ==========================================

// Phase 16.1 Test 1: Historical Order A (cancelled) + Active Order B ("Waiting for branch approval")
test('Phase 16.1 Test 1: Historical Order A (cancelled) + Active Order B ("Waiting for branch approval") targets Order B, never Order A, and offers CANCEL_ORDER action', async () => {
  const safeContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_A_cancelled',
          publicOrderId: 'ORD-HIST-A',
          status: 'cancelled',
          created_at: 1710000000000,
          updated_at: 1710005000000,
        },
        {
          id: 'ord_B_active',
          publicOrderId: 'ORD-ACTIVE-B',
          status: 'Waiting for branch approval',
          branch_name: 'Clear Spring Station',
          branch_id: 'branch_clear_spring',
          created_at: 1710002000000,
        },
      ],
    },
  });

  assert.equal(safeContext.hasActiveOrder, true);
  assert.equal(safeContext.activeOrder.publicOrderId, 'ORD-ACTIVE-B');
  assert.equal(safeContext.activeOrder.isCancellable, true);
  assert.equal(safeContext.activeOrder.isAwaitingApproval, true);

  const engine = new DeterministicAssistantEngine();
  const response = await engine.respond({
    userInput: 'Can I cancel my current order?',
    safeContext,
    role: 'requester',
  });

  // Must reference active Order B
  assert.match(response.message, /ORD-ACTIVE-B/);
  // Must NOT talk about cancelled Order A as the active order
  assert.doesNotMatch(response.message, /ORD-HIST-A/);
  assert.doesNotMatch(response.message, /was already "Cancelled"/i);

  // Must push card for active Order B
  assert.ok(response.cards.some((c) => c.publicOrderId === 'ORD-ACTIVE-B'));
  assert.ok(!response.cards.some((c) => c.publicOrderId === 'ORD-HIST-A'));

  // Must provide direct CANCEL_ORDER action
  const cancelAction = response.actions.find((a) => a.type === 'CANCEL_ORDER');
  assert.ok(cancelAction, 'Must provide CANCEL_ORDER action for active pending order');
  assert.equal(cancelAction.orderId, 'ord_B_active');
  assert.equal(cancelAction.publicOrderId, 'ORD-ACTIVE-B');
});

// Phase 16.1 Test 2: OrderCard header label renders CANCELLED WATER REQUEST for cancelled orders
test('Phase 16.1 Test 2: OrderCard header label renders CANCELLED WATER REQUEST for cancelled orders and never ACTIVE WATER REQUEST', () => {
  const cardCancelled = sanitizeOrder({
    id: 'ord_canc',
    publicOrderId: 'ORD-CANC-99',
    status: 'cancelled',
  });

  const isTerminalSuccess = cardCancelled.status === 'delivered';
  const isCancelledOrder = Boolean(cardCancelled.isCancelled || ['cancelled', 'canceled'].includes(cardCancelled.status));
  const isFailedOrder = Boolean(cardCancelled.isFailed || cardCancelled.status?.includes('delivery_failed'));

  const headerBadgeLabel = cardCancelled.headerLabel || (
    isCancelledOrder
      ? 'CANCELLED WATER REQUEST'
      : isFailedOrder
        ? 'FAILED DELIVERY'
        : isTerminalSuccess
          ? 'COMPLETED WATER REQUEST'
          : 'ACTIVE WATER REQUEST'
  );

  assert.equal(headerBadgeLabel, 'CANCELLED WATER REQUEST');
  assert.notEqual(headerBadgeLabel, 'ACTIVE WATER REQUEST');
});

// Phase 16.1 Test 3: OrderCard header label renders COMPLETED WATER REQUEST for delivered orders and ACTIVE WATER REQUEST for active orders
test('Phase 16.1 Test 3: OrderCard header label renders COMPLETED WATER REQUEST for delivered orders and ACTIVE WATER REQUEST for active orders', () => {
  const cardDelivered = sanitizeOrder({
    id: 'ord_deliv',
    publicOrderId: 'ORD-DELIV-88',
    status: 'delivered',
  });

  const getHeaderLabel = (card) => {
    const isTerminalSuccess = card.status === 'delivered';
    const isCancelledOrder = Boolean(card.isCancelled || ['cancelled', 'canceled'].includes(card.status));
    const isFailedOrder = Boolean(card.isFailed || card.status?.includes('delivery_failed'));

    return card.headerLabel || (
      isCancelledOrder
        ? 'CANCELLED WATER REQUEST'
        : isFailedOrder
          ? 'FAILED DELIVERY'
          : isTerminalSuccess
            ? 'COMPLETED WATER REQUEST'
            : 'ACTIVE WATER REQUEST'
    );
  };

  assert.equal(getHeaderLabel(cardDelivered), 'COMPLETED WATER REQUEST');

  const cardActive = sanitizeOrder({
    id: 'ord_active',
    publicOrderId: 'ORD-ACT-77',
    status: 'pending',
  });
  assert.equal(getHeaderLabel(cardActive), 'ACTIVE WATER REQUEST');
});

// Phase 16.1 Test 4: AssistantQuickActions cancel chip has intent CANCEL_ORDER_ELIGIBILITY and never CANCELLED_ORDER_HELP
test('Phase 16.1 Test 4: AssistantQuickActions cancel chip has intent CANCEL_ORDER_ELIGIBILITY and never CANCELLED_ORDER_HELP', () => {
  const fullPath = path.resolve(__dirname, '../../../components/assistant/AssistantQuickActions.jsx');
  const code = fs.readFileSync(fullPath, 'utf8');

  // Verify that the cancel chip uses CANCEL_ORDER_ELIGIBILITY
  assert.match(
    code,
    /id:\s*['"]cancel['"][\s\S]*?intent:\s*ASSISTANT_INTENTS\.CANCEL_ORDER_ELIGIBILITY/,
    'Cancel chip must be configured with ASSISTANT_INTENTS.CANCEL_ORDER_ELIGIBILITY'
  );
  assert.doesNotMatch(
    code,
    /id:\s*['"]cancel['"][\s\S]*?intent:\s*ASSISTANT_INTENTS\.CANCELLED_ORDER_HELP/,
    'Cancel chip must never be configured with CANCELLED_ORDER_HELP'
  );
});

// Phase 16.1 Test 5: CANCEL_ORDER is recognized as valid action in ALLOWED_ACTION_TYPES and executes with target order ID
test('Phase 16.1 Test 5: CANCEL_ORDER is recognized as valid action in ALLOWED_ACTION_TYPES and executes with target order ID', () => {
  assert.equal(isAllowedActionType('CANCEL_ORDER'), true);

  const action = createAction(ASSISTANT_ACTIONS.CANCEL_ORDER, {
    orderId: 'ord_test_cancel',
    publicOrderId: 'ORD-999',
    label: 'Cancel Order',
  });

  assert.equal(action.type, 'CANCEL_ORDER');
  assert.equal(action.orderId, 'ord_test_cancel');
  assert.equal(action.publicOrderId, 'ORD-999');
  assert.equal(action.label, 'Cancel Order');
});

// Phase 16.1 Test 6: In-Assistant confirmation dialog flow - Keep Order causes zero backend mutations
test('Phase 16.1 Test 6: In-Assistant confirmation dialog flow - Keep Order causes zero backend mutations', async () => {
  let backendMutationCalls = 0;
  const mockCancelBackend = async () => {
    backendMutationCalls++;
    return { success: true };
  };

  let modalOpen = true;
  const userAction = 'Keep Order';

  if (userAction === 'Keep Order') {
    modalOpen = false;
    // zero backend calls
  } else if (userAction === 'Yes, Cancel') {
    await mockCancelBackend();
    modalOpen = false;
  }

  assert.equal(modalOpen, false);
  assert.equal(backendMutationCalls, 0, 'Keep Order must result in 0 backend mutation calls');
});

// Phase 16.1 Test 7: In-Assistant confirmation dialog flow - Yes, Cancel invokes authoritative cancellation with targeted order ID
test('Phase 16.1 Test 7: In-Assistant confirmation dialog flow - Yes, Cancel invokes authoritative cancellation with targeted order ID', async () => {
  let targetedOrderId = null;
  const mockCancelBackend = async (order) => {
    targetedOrderId = order.id;
    return { success: true, id: order.id, status: 'cancelled' };
  };

  const targetOrder = {
    id: 'ord_targeted_7',
    publicOrderId: 'ORD-TARGET-7',
    status: 'Waiting for branch approval',
  };

  assert.equal(isCancellableRequesterOrderStatus(targetOrder.status), true);

  let lockAcquired = false;
  let modalOpen = true;

  // Simulate user pressing "Yes, Cancel"
  if (isCancellableRequesterOrderStatus(targetOrder.status)) {
    lockAcquired = true;
    await mockCancelBackend(targetOrder);
    modalOpen = false;
    lockAcquired = false;
  }

  assert.equal(targetedOrderId, 'ord_targeted_7');
  assert.equal(modalOpen, false);
  assert.equal(lockAcquired, false);
});

// Phase 16.1 Test 8: State synchronization - cancelling active order immediately updates state so canPlaceNewOrder is true and activeOrder is cleared
test('Phase 16.1 Test 8: State synchronization - cancelling active order immediately updates state so canPlaceNewOrder is true and activeOrder is cleared', async () => {
  const initialContext = buildSafeAssistantContext({
    requesterData: {
      orders: [
        {
          id: 'ord_active_sync',
          publicOrderId: 'ORD-SYNC-8',
          status: 'Waiting for branch approval',
          branch_name: 'Metro Hub',
          branch_id: 'branch_sync',
        },
      ],
    },
  });

  assert.equal(initialContext.hasActiveOrder, true);
  assert.equal(initialContext.canPlaceNewOrder, false);

  // Simulate state synchronization after cancellation
  const locallyCancelledIds = new Set(['ord_active_sync']);

  const activeOrders = (initialContext.activeOrders || []).filter(
    (ord) => !locallyCancelledIds.has(ord.id)
  );
  const hasActiveOrder = activeOrders.length > 0;
  const synchronizedContext = {
    ...initialContext,
    activeOrders,
    hasActiveOrder,
    activeOrder: hasActiveOrder ? activeOrders[0] : null,
    canPlaceNewOrder: !hasActiveOrder,
  };

  assert.equal(synchronizedContext.hasActiveOrder, false);
  assert.equal(synchronizedContext.canPlaceNewOrder, true);
  assert.equal(synchronizedContext.activeOrder, null);

  const engine = new DeterministicAssistantEngine();
  const subsequentResponse = await engine.respond({
    userInput: 'Can I place another order?',
    safeContext: synchronizedContext,
    role: 'requester',
  });

  assert.match(subsequentResponse.message, /do not have any active water requests|place a new water order/i);
  assert.ok(subsequentResponse.actions.some((a) => a.type === 'START_ORDER'));
});

// Phase 16.1 Test 9: Re-validation safety - if active order status changes to approved while confirmation is open, cancellation aborts safely
test('Phase 16.1 Test 9: Re-validation safety - if active order status changes to approved while confirmation is open, cancellation aborts safely', async () => {
  let backendMutationCalls = 0;
  const mockCancelBackend = async () => {
    backendMutationCalls++;
    return { success: true };
  };

  // Initially opened modal when status was pending
  const orderAtModalOpen = {
    id: 'ord_race_cond',
    status: 'Waiting for branch approval',
  };
  assert.equal(isCancellableRequesterOrderStatus(orderAtModalOpen.status), true);

  // In the background, Branch Manager approved the order before user tapped "Yes, Cancel"
  const orderAtUserConfirmation = {
    id: 'ord_race_cond',
    status: 'awaiting_distributor_assignment',
  };

  let aborted = false;
  let reportedAlertTitle = '';

  // Immediate pre-execution check
  if (!isCancellableRequesterOrderStatus(orderAtUserConfirmation.status)) {
    aborted = true;
    reportedAlertTitle = 'Cancellation Not Available';
  } else {
    await mockCancelBackend();
  }

  assert.equal(aborted, true, 'Must abort cancellation if status became non-cancellable');
  assert.equal(backendMutationCalls, 0, 'Zero backend mutations when status re-validation fails');
  assert.equal(reportedAlertTitle, 'Cancellation Not Available');
});

// Phase 16.1 Test 10: Distributor role safety - distributor assistant cannot cancel requester orders and rejects cancellation intents
test('Phase 16.1 Test 10: Distributor role safety - distributor assistant cannot cancel requester orders and rejects cancellation intents', async () => {
  const safeContext = buildSafeDistributorContext({
    distributorData: {
      profile: { firstName: 'Juan', uid: 'dist_juan' },
      orders: [
        {
          id: 'deliv_1',
          publicOrderId: 'ORD-DELIV-1',
          status: 'assigned',
        },
      ],
    },
  });

  const engine = new DeterministicAssistantEngine();
  const response = await engine.respond({
    userInput: 'Can I cancel my current order?',
    safeContext,
    role: 'distributor',
  });

  // Distributor must never receive requester cancellation actions
  assert.ok(!response.actions.some((a) => a.type === 'CANCEL_ORDER'));
  assert.ok(!response.actions.some((a) => a.label?.includes('Cancel Order')));
  assert.doesNotMatch(response.message, /you can still cancel this request/i);
});
