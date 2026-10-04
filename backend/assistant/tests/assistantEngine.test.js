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
  buildSafeAssistantContext,
  sanitizeOrder,
  sanitizeRestriction,
  sanitizeNotification,
} = requireTranspiled('../../../services/assistant/assistantContext.js');

const {
  ASSISTANT_INTENTS,
  classifyIntent,
  detectLanguage,
} = requireTranspiled('../../../services/assistant/assistantIntents.js');

const {
  DeterministicAssistantEngine,
} = requireTranspiled('../../../services/assistant/assistantEngine.js');

test('buildSafeAssistantContext provides module contract and default safe shapes', () => {
  assert.equal(typeof buildSafeAssistantContext, 'function');

  const emptyContext = buildSafeAssistantContext({});
  assert.equal(typeof emptyContext, 'object');
  assert.equal(emptyContext.hasActiveOrder, false);
  assert.equal(emptyContext.hasPendingOrder, false);
  assert.equal(emptyContext.hasActiveRestriction, false);
  assert.deepEqual(emptyContext.recentOrders, []);
  assert.deepEqual(emptyContext.branches, []);
  assert.deepEqual(emptyContext.notifications, []);
  assert.equal(emptyContext.activeOrder, null);
  assert.equal(emptyContext.activeRestriction, null);
});

test('buildSafeAssistantContext extracts active order and public IDs correctly', () => {
  const mockRequesterData = {
    profile: {
      firstName: 'Maria',
      publicUid: 'Req042',
      email: 'maria@example.com',
    },
    orders: [
      {
        id: 'ord_123',
        publicOrderId: 'ORD-9876',
        status: 'out_for_delivery',
        branch_name: 'Downtown BlueTap Hub',
        branch_id: 'branch_dt',
        quantity: 2,
        total_amount: 100,
        container: 'Slim 5-Gal',
        created_at: 1710000000000,
      },
    ],
    branches: [
      {
        id: 'branch_dt',
        name: 'Downtown BlueTap Hub',
        address: '123 Main St, Toledo City',
        coverageRadiusKm: 5,
      },
    ],
  };

  const context = buildSafeAssistantContext({ requesterData: mockRequesterData });
  assert.equal(context.requester.firstName, 'Maria');
  assert.equal(context.hasActiveOrder, true);
  assert.equal(context.activeOrder.publicOrderId, 'ORD-9876');
  assert.equal(context.activeOrder.status, 'out_for_delivery');
  assert.equal(context.activeOrder.branchName, 'Downtown BlueTap Hub');
  assert.equal(context.branches.length, 1);
});

test('classifyIntent accurately identifies order tracking and delivery queries', () => {
  assert.equal(classifyIntent('Where is my order?'), ASSISTANT_INTENTS.TRACK_ORDER);
  assert.equal(classifyIntent('Track my delivery please'), ASSISTANT_INTENTS.TRACK_ORDER);
  assert.equal(classifyIntent('asa na akong tubig'), ASSISTANT_INTENTS.TRACK_ORDER);
  assert.equal(classifyIntent('asa ang akong delivery karon?'), ASSISTANT_INTENTS.TRACK_ORDER);

  assert.equal(classifyIntent('When will the water arrive?'), ASSISTANT_INTENTS.DELIVERY_SCHEDULE);
  assert.equal(classifyIntent('What is your delivery schedule?'), ASSISTANT_INTENTS.DELIVERY_SCHEDULE);
  assert.equal(classifyIntent('kanus-a moabot ang order?'), ASSISTANT_INTENTS.DELIVERY_SCHEDULE);
});

test('classifyIntent accurately identifies cancellations, station contacts, and how-it-works', () => {
  assert.equal(classifyIntent('Can I cancel my request?'), ASSISTANT_INTENTS.CANCELLED_ORDER_HELP);
  assert.equal(classifyIntent('pwede ba nako ma-cancel akong order'), ASSISTANT_INTENTS.CANCELLED_ORDER_HELP);

  assert.equal(classifyIntent('How do I contact the station?'), ASSISTANT_INTENTS.CONTACT_STATION);
  assert.equal(classifyIntent('unsaon pag-message sa branch station'), ASSISTANT_INTENTS.CONTACT_STATION);

  assert.equal(classifyIntent('How does BlueTap work?'), ASSISTANT_INTENTS.HOW_BLUETAP_WORKS);
});

test('detectLanguage distinguishes English and Cebuano inputs', () => {
  assert.equal(detectLanguage('Where is my delivery?'), 'en');
  assert.equal(detectLanguage('What are the payment options?'), 'en');

  assert.equal(detectLanguage('Asa na akong tubig?'), 'ceb');
  assert.equal(detectLanguage('Kanus-a moabot ang delivery?'), 'ceb');
  assert.equal(detectLanguage('Pwede ba nako ma-cancel kini?'), 'ceb');
});

test('DeterministicAssistantEngine responds contextually to active orders', async () => {
  const engine = new DeterministicAssistantEngine();

  const safeContext = {
    requester: { firstName: 'Juan' },
    hasActiveOrder: true,
    activeOrder: {
      id: 'ord_1',
      publicOrderId: 'ORD-1001',
      status: 'pending',
      statusLabel: 'Pending Branch Confirmation',
      branchName: 'Uptown Station',
      branchId: 'branch_up',
      canCancel: true,
      productSummary: '1x Round 5-Gal',
    },
    branches: [],
  };

  const response = await engine.respond({
    userInput: 'Where is my order?',
    safeContext,
  });

  assert.equal(response.intent, ASSISTANT_INTENTS.TRACK_ORDER);
  assert.ok(response.message.includes('ORD-1001'));
  assert.ok(response.message.includes('Pending Branch Confirmation'));
  assert.equal(response.cards.length, 1);
  assert.equal(response.cards[0].type, 'order');
  assert.ok(response.actions.some((a) => a.type === 'VIEW_ORDER'));
});

test('DeterministicAssistantEngine responds in Cebuano when query is Cebuano', async () => {
  const engine = new DeterministicAssistantEngine();

  const safeContext = {
    requester: { firstName: 'Juan' },
    hasActiveOrder: true,
    activeOrder: {
      id: 'ord_1',
      publicOrderId: 'ORD-1001',
      status: 'out_for_delivery',
      statusLabel: 'Out for Delivery',
      branchName: 'Uptown Station',
      branchId: 'branch_up',
      canCancel: false,
    },
    branches: [],
  };

  const response = await engine.respond({
    userInput: 'Asa na akong tubig karon?',
    safeContext,
  });

  assert.equal(response.intent, ASSISTANT_INTENTS.TRACK_ORDER);
  assert.ok(response.message.includes('ORD-1001'));
  assert.ok(response.message.includes('Out for Delivery') || response.message.includes('padulong na'));
});
