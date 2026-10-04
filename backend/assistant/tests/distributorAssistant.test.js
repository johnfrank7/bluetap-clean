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
  classifyDistributorIntentDetails,
  classifyIntent,
} = requireTranspiled('../../../services/assistant/assistantIntents.js');

const {
  buildSafeDistributorContext,
  sanitizeDistributorOrder,
  evaluateDistributorOrderChatAuthority,
  FAILED_DELIVERY_CHAT_GRACE_MS,
} = requireTranspiled('../../../services/assistant/assistantContext.js');

const {
  DeterministicAssistantEngine,
} = requireTranspiled('../../../services/assistant/assistantEngine.js');

const {
  ASSISTANT_ACTIONS,
  executeAssistantAction,
} = requireTranspiled('../../../services/assistant/assistantActions.js');

const {
  buildAssistantStorageKey,
  loadDailyAssistantChat,
  saveDailyAssistantChat,
  clearDailyAssistantChat,
  getLocalDateKey,
} = requireTranspiled('../../../services/assistant/assistantStorage.js');

test('DISTRIBUTOR_ASSISTANT_INTENTS defines all canonical distributor intent types', () => {
  assert.equal(typeof DISTRIBUTOR_ASSISTANT_INTENTS.CURRENT_DELIVERY, 'string');
  assert.equal(typeof DISTRIBUTOR_ASSISTANT_INTENTS.TODAY_SCHEDULE, 'string');
  assert.equal(typeof DISTRIBUTOR_ASSISTANT_INTENTS.NEXT_DELIVERY, 'string');
  assert.equal(typeof DISTRIBUTOR_ASSISTANT_INTENTS.DELIVERY_STATUS, 'string');
  assert.equal(typeof DISTRIBUTOR_ASSISTANT_INTENTS.DELIVERY_DETAILS, 'string');
  assert.equal(typeof DISTRIBUTOR_ASSISTANT_INTENTS.CONTACT_REQUESTER, 'string');
  assert.equal(typeof DISTRIBUTOR_ASSISTANT_INTENTS.CONTACT_STATION, 'string');
  assert.equal(typeof DISTRIBUTOR_ASSISTANT_INTENTS.CHAT_AVAILABILITY, 'string');
  assert.equal(typeof DISTRIBUTOR_ASSISTANT_INTENTS.FAILED_DELIVERY_HELP, 'string');
  assert.equal(typeof DISTRIBUTOR_ASSISTANT_INTENTS.VIEW_NOTIFICATIONS, 'string');
  assert.equal(typeof DISTRIBUTOR_ASSISTANT_INTENTS.DELIVERY_HISTORY, 'string');
  assert.equal(typeof DISTRIBUTOR_ASSISTANT_INTENTS.HOW_DISTRIBUTOR_WORKS, 'string');
});

test('evaluateDistributorOrderChatAuthority enforces exact chat lifecycle rules', () => {
  const now = 1710000000000;

  // Active delivery: allowed
  const activeOrder = { status: 'out_for_delivery' };
  const activeAuth = evaluateDistributorOrderChatAuthority(activeOrder, now);
  assert.equal(activeAuth.chatAllowed, true);
  assert.equal(activeAuth.chatState, 'active');

  // Delivered delivery: closed immediately
  const deliveredOrder = { status: 'delivered' };
  const deliveredAuth = evaluateDistributorOrderChatAuthority(deliveredOrder, now);
  assert.equal(deliveredAuth.chatAllowed, false);
  assert.equal(deliveredAuth.chatState, 'delivered');

  // Failed delivery within 1-hour grace window (e.g. 20 minutes after failure)
  const failedRecentOrder = {
    status: 'delivery_failed',
    failedAt: new Date(now - 20 * 60 * 1000).toISOString(),
  };
  const recentFailedAuth = evaluateDistributorOrderChatAuthority(failedRecentOrder, now);
  assert.equal(recentFailedAuth.chatAllowed, true);
  assert.equal(recentFailedAuth.chatGraceActive, true);
  assert.equal(recentFailedAuth.chatState, 'failed_grace_active');

  // Failed delivery beyond 1-hour grace window (e.g. 65 minutes after failure)
  const failedExpiredOrder = {
    status: 'delivery_failed',
    failedAt: new Date(now - 65 * 60 * 1000).toISOString(),
  };
  const expiredFailedAuth = evaluateDistributorOrderChatAuthority(failedExpiredOrder, now);
  assert.equal(expiredFailedAuth.chatAllowed, false);
  assert.equal(expiredFailedAuth.chatGraceActive, false);
  assert.equal(expiredFailedAuth.chatState, 'failed_grace_expired');
});

test('sanitizeDistributorOrder strips raw coordinates and internal secrets', () => {
  const unsafeOrder = {
    id: 'ord-12345',
    orderId: 'BT-9988',
    requesterName: 'Juan Dela Cruz',
    status: 'out_for_delivery',
    latitude: 10.3157,
    longitude: 123.8854,
    coords: { lat: 10.3157, lng: 123.8854 },
    serverSecretKey: 'secret_jwt_xyz',
    internalReporterNotes: 'do not show',
    address: '10.3157, 123.8854',
    barangay: 'Guadalupe',
    city: 'Cebu City',
    paymentMethod: 'cash_on_delivery',
  };

  const sanitized = sanitizeDistributorOrder(unsafeOrder);

  // Raw coordinates must not exist in sanitized order
  assert.equal(sanitized.latitude, undefined);
  assert.equal(sanitized.longitude, undefined);
  assert.equal(sanitized.coords, undefined);
  assert.equal(sanitized.serverSecretKey, undefined);
  assert.equal(sanitized.internalReporterNotes, undefined);

  // Safe labels must be present
  assert.equal(sanitized.publicOrderId, 'BT-9988');
  assert.equal(sanitized.requesterName, 'Juan Dela Cruz');
  assert.equal(sanitized.safeAddressLabel, 'Guadalupe, Cebu City');
});

test('buildSafeDistributorContext partitions active assignment, today schedule, and history', () => {
  const now = 1710000000000;
  const todayKey = getLocalDateKey(now);

  const rawOrders = [
    {
      id: 'ord-1',
      orderId: 'BT-101',
      status: 'out_for_delivery',
      scheduledDate: todayKey,
      requesterName: 'Maria Santos',
    },
    {
      id: 'ord-2',
      orderId: 'BT-102',
      status: 'scheduled',
      scheduledDate: todayKey,
      requesterName: 'Pedro Penduko',
    },
    {
      id: 'ord-3',
      orderId: 'BT-103',
      status: 'delivered',
      requesterName: 'Ana Reyes',
    },
  ];

  const distributorData = {
    uid: 'dist-user-1',
    profile: {
      firstName: 'Cardo',
      lastName: 'Dalisay',
      distributorId: 'DIST-007',
      branchName: 'Cebu Water Hub',
      branchId: 'branch-cebu',
    },
    orders: rawOrders,
  };

  const context = buildSafeDistributorContext({ distributorData, now });

  assert.equal(context.role, 'distributor');
  assert.equal(context.distributor.firstName, 'Cardo');
  assert.equal(context.distributor.publicId, 'DIST-007');
  assert.equal(context.distributor.branchName, 'Cebu Water Hub');

  // Primary active assignment
  assert.ok(context.hasActiveAssignment);
  assert.equal(context.currentAssignment.publicOrderId, 'BT-101');

  // Today's schedule
  assert.ok(context.hasSchedule);
  assert.equal(context.todaySchedule.length, 2);

  // Recent history
  assert.ok(context.hasHistory);
  assert.equal(context.recentHistory.length, 1);
  assert.equal(context.recentHistory[0].publicOrderId, 'BT-103');
});

test('classifyDistributorIntent identifies English and Cebuano distributor queries accurately', () => {
  // Current delivery
  assert.equal(classifyDistributorIntent('What is my current delivery?'), DISTRIBUTOR_ASSISTANT_INTENTS.CURRENT_DELIVERY);
  assert.equal(classifyDistributorIntent('Unsa akong delivery karon?'), DISTRIBUTOR_ASSISTANT_INTENTS.CURRENT_DELIVERY);

  // Today schedule
  assert.equal(classifyDistributorIntent('What are my deliveries today?'), DISTRIBUTOR_ASSISTANT_INTENTS.TODAY_SCHEDULE);
  assert.equal(classifyDistributorIntent('Unsa akong schedule karon?'), DISTRIBUTOR_ASSISTANT_INTENTS.TODAY_SCHEDULE);

  // Next delivery
  assert.equal(classifyDistributorIntent('What is my next delivery?'), DISTRIBUTOR_ASSISTANT_INTENTS.NEXT_DELIVERY);
  assert.equal(classifyDistributorIntent('Unsa akong sunod i-deliver?'), DISTRIBUTOR_ASSISTANT_INTENTS.NEXT_DELIVERY);

  // Contact requester
  assert.equal(classifyDistributorIntent('How do I contact the customer?'), DISTRIBUTOR_ASSISTANT_INTENTS.CONTACT_REQUESTER);
  assert.equal(classifyDistributorIntent('Unsaon pag-contact sa requester?'), DISTRIBUTOR_ASSISTANT_INTENTS.CONTACT_REQUESTER);

  // Contact station
  assert.equal(classifyDistributorIntent('How do I contact the station manager?'), DISTRIBUTOR_ASSISTANT_INTENTS.CONTACT_STATION);
  assert.equal(classifyDistributorIntent('Unsaon pag-contact sa water station?'), DISTRIBUTOR_ASSISTANT_INTENTS.CONTACT_STATION);

  // Failed delivery help
  assert.equal(classifyDistributorIntent('What should I do if the customer cannot be reached?'), DISTRIBUTOR_ASSISTANT_INTENTS.FAILED_DELIVERY_HELP);
  assert.equal(classifyDistributorIntent('Unsa buhaton kung dili ma-contact ang customer?'), DISTRIBUTOR_ASSISTANT_INTENTS.FAILED_DELIVERY_HELP);

  // Chat availability
  assert.equal(classifyDistributorIntent('Why can\'t I message the customer anymore?'), DISTRIBUTOR_ASSISTANT_INTENTS.CHAT_AVAILABILITY);
  assert.equal(classifyDistributorIntent('Nganong dili na ko ka-chat sa customer?'), DISTRIBUTOR_ASSISTANT_INTENTS.CHAT_AVAILABILITY);

  // Delivery details
  assert.equal(classifyDistributorIntent('Show delivery details'), DISTRIBUTOR_ASSISTANT_INTENTS.DELIVERY_DETAILS);

  // Delivery history
  assert.equal(classifyDistributorIntent('Where can I see my past deliveries?'), DISTRIBUTOR_ASSISTANT_INTENTS.DELIVERY_HISTORY);

  // How distributor works
  assert.equal(classifyDistributorIntent('How does distributor delivery work?'), DISTRIBUTOR_ASSISTANT_INTENTS.HOW_DISTRIBUTOR_WORKS);
});

test('DeterministicAssistantEngine handles distributor role queries with cards and actions', async () => {
  const engine = new DeterministicAssistantEngine();

  const safeContext = {
    role: 'distributor',
    distributor: {
      firstName: 'Cardo',
      distributorId: 'DIST-007',
      branchName: 'Cebu Water Hub',
      branchId: 'branch-1',
    },
    currentAssignment: {
      id: 'ord-101',
      publicOrderId: 'BT-101',
      requesterName: 'Juan Dela Cruz',
      status: 'out_for_delivery',
      statusLabel: 'Out for Delivery',
      safeAddressLabel: 'Guadalupe, Cebu City',
      productSummary: '5x 5-Gallon Round Container',
      total: 175,
      chatAllowed: true,
    },
    hasActiveAssignment: true,
    todaySchedule: [],
    recentHistory: [],
    restrictions: { ordering: [], chat: [] },
  };

  // Free-typed current delivery query
  const res1 = await engine.respond({
    userInput: 'What is my current delivery?',
    safeContext,
    role: 'distributor',
  });
  assert.equal(res1.intent, DISTRIBUTOR_ASSISTANT_INTENTS.CURRENT_DELIVERY);
  assert.ok(res1.message.includes('BT-101'));
  assert.ok(res1.message.includes('Juan Dela Cruz'));
  assert.equal(res1.cards.length, 1);
  assert.equal(res1.cards[0].type, 'delivery');

  // Cebuano current delivery query
  const resCeb = await engine.respond({
    userInput: 'Unsa akong delivery karon?',
    safeContext,
    role: 'distributor',
  });
  assert.equal(resCeb.intent, DISTRIBUTOR_ASSISTANT_INTENTS.CURRENT_DELIVERY);
  assert.ok(resCeb.message.includes('Imong kasamtangang assignment'));

  // Forced intent from quick action chip (bypasses classifier)
  const resForced = await engine.respond({
    userInput: 'arbitrary label',
    forcedIntent: DISTRIBUTOR_ASSISTANT_INTENTS.FAILED_DELIVERY_HELP,
    safeContext,
    role: 'distributor',
  });
  assert.equal(resForced.intent, DISTRIBUTOR_ASSISTANT_INTENTS.FAILED_DELIVERY_HELP);
  assert.ok(resForced.message.includes('1-hour grace window') || resForced.message.includes('1 oras'));
});

test('executeAssistantAction routes distributor actions accurately', async () => {
  const pushedRoutes = [];
  const mockRouter = {
    push: (route) => pushedRoutes.push(route),
  };

  let openedChat = null;
  const mockChat = {
    resolveAndOpen: async (payload) => {
      openedChat = payload;
    },
  };

  // VIEW_DELIVERY
  const viewDeliveryRes = await executeAssistantAction(
    { type: ASSISTANT_ACTIONS.VIEW_DELIVERY, orderId: 'ord-101' },
    { router: mockRouter, role: 'distributor' }
  );
  assert.equal(viewDeliveryRes.target, '/distributor/d_scheduled_requests');
  assert.deepEqual(pushedRoutes[0], {
    pathname: '/distributor/d_scheduled_requests',
    params: { orderId: 'ord-101' },
  });

  // OPEN_SCHEDULE
  const scheduleRes = await executeAssistantAction(
    { type: ASSISTANT_ACTIONS.OPEN_SCHEDULE },
    { router: mockRouter, role: 'distributor' }
  );
  assert.equal(scheduleRes.target, '/distributor/d_scheduled_requests');

  // OPEN_HISTORY
  const historyRes = await executeAssistantAction(
    { type: ASSISTANT_ACTIONS.OPEN_HISTORY },
    { router: mockRouter, role: 'distributor' }
  );
  assert.equal(historyRes.target, '/distributor/d_history');

  // OPEN_REQUESTS for distributor
  const requestsRes = await executeAssistantAction(
    { type: ASSISTANT_ACTIONS.OPEN_REQUESTS },
    { router: mockRouter, role: 'distributor' }
  );
  assert.equal(requestsRes.target, '/distributor/d_requests');

  // CONTACT_REQUESTER
  const contactReqRes = await executeAssistantAction(
    { type: ASSISTANT_ACTIONS.CONTACT_REQUESTER, orderId: 'ord-101' },
    { chat: mockChat, role: 'distributor' }
  );
  assert.equal(contactReqRes.target, 'chat:requester_distributor');
  assert.deepEqual(openedChat, {
    type: 'requester_distributor',
    orderId: 'ord-101',
  });

  // CONTACT_STATION for distributor
  const contactStationRes = await executeAssistantAction(
    { type: ASSISTANT_ACTIONS.CONTACT_STATION, branchId: 'branch-99' },
    { chat: mockChat, role: 'distributor' }
  );
  assert.equal(contactStationRes.target, 'chat:distributor_branch');
  assert.deepEqual(openedChat, {
    type: 'distributor_branch',
  });
});

test('Role-scoped storage keys prevent crosstalk between Requester and Distributor', async () => {
  const reqKey = buildAssistantStorageKey('user-123', 'requester');
  const distKey = buildAssistantStorageKey('user-123', 'distributor');

  assert.equal(reqKey, 'bluetap-assistant:requester:user-123');
  assert.equal(distKey, 'bluetap-assistant:distributor:user-123');
  assert.notEqual(reqKey, distKey);

  // Save for Requester
  await saveDailyAssistantChat({
    userId: 'user-shared',
    role: 'requester',
    messages: [{ id: 'req-msg', text: 'Hello requester', role: 'user' }],
  });

  // Save for Distributor
  await saveDailyAssistantChat({
    userId: 'user-shared',
    role: 'distributor',
    messages: [{ id: 'dist-msg', text: 'Hello distributor', role: 'user' }],
  });

  const loadedReq = await loadDailyAssistantChat({ userId: 'user-shared', role: 'requester' });
  const loadedDist = await loadDailyAssistantChat({ userId: 'user-shared', role: 'distributor' });

  assert.equal(loadedReq.length, 1);
  assert.equal(loadedReq[0].id, 'req-msg');

  assert.equal(loadedDist.length, 1);
  assert.equal(loadedDist[0].id, 'dist-msg');

  // Clear distributor only
  await clearDailyAssistantChat({ userId: 'user-shared', role: 'distributor' });
  const clearedDist = await loadDailyAssistantChat({ userId: 'user-shared', role: 'distributor' });
  const preservedReq = await loadDailyAssistantChat({ userId: 'user-shared', role: 'requester' });

  assert.deepEqual(clearedDist, []);
  assert.equal(preservedReq.length, 1);
  assert.equal(preservedReq[0].id, 'req-msg');
});
