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
  classifyIntentDetails,
  classifyIntent,
} = requireTranspiled('../../../services/assistant/assistantIntents.js');

const {
  DeterministicAssistantEngine,
} = requireTranspiled('../../../services/assistant/assistantEngine.js');

const {
  buildSafeAssistantContext,
  sanitizeProduct,
} = requireTranspiled('../../../services/assistant/assistantContext.js');

const {
  getLocalDateKey,
  buildAssistantStorageKey,
  sanitizeMessagesForStorage,
  loadDailyAssistantChat,
  saveDailyAssistantChat,
  clearDailyAssistantChat,
  getRawAssistantStorageRecord,
  MAX_STORED_MESSAGES,
} = requireTranspiled('../../../services/assistant/assistantStorage.js');

test('Assistant intents include canonical constants', () => {
  assert.equal(typeof ASSISTANT_INTENTS.PAYMENT_HELP, 'string');
  assert.equal(typeof ASSISTANT_INTENTS.CONTAINER_HELP, 'string');
  assert.equal(typeof ASSISTANT_INTENTS.PRODUCT_HELP, 'string');
  assert.equal(typeof ASSISTANT_INTENTS.TRACK_ORDER, 'string');
  assert.equal(typeof ASSISTANT_INTENTS.DELIVERY_SCHEDULE, 'string');
  assert.equal(typeof ASSISTANT_INTENTS.CANCELLED_ORDER_HELP, 'string');
  assert.equal(typeof ASSISTANT_INTENTS.CONTACT_STATION, 'string');
  assert.equal(typeof ASSISTANT_INTENTS.EXPLAIN_ORDERING_RESTRICTION, 'string');
  assert.equal(typeof ASSISTANT_INTENTS.EXPLAIN_CHAT_RESTRICTION, 'string');
});

test('forcedIntent bypasses normal classifier and uses trusted explicit intent', async () => {
  const engine = new DeterministicAssistantEngine();

  // "Where is my current order?" would normally classify to TRACK_ORDER,
  // but if forcedIntent is DELIVERY_SCHEDULE, forcedIntent must win.
  const response = await engine.respond({
    userInput: 'Where is my current order?',
    forcedIntent: ASSISTANT_INTENTS.DELIVERY_SCHEDULE,
    safeContext: {
      activeOrder: {
        id: 'ord-123',
        publicOrderId: 'ORD-123',
        branchName: 'City Central Station',
        statusLabel: 'Out for delivery',
        schedule: 'Today 2:00 PM',
      },
    },
  });

  assert.equal(response.intent, ASSISTANT_INTENTS.DELIVERY_SCHEDULE);
  assert.match(response.message, /Today 2:00 PM/);
});

test('forcedIntent rejects unallowed or arbitrary intents and falls back safely', async () => {
  const engine = new DeterministicAssistantEngine();

  // Arbitrary string that is not in ASSISTANT_INTENTS allowlist
  const response = await engine.respond({
    userInput: 'asa na akong order?',
    forcedIntent: 'MALICIOUS_INJECTED_INTENT',
    safeContext: {},
  });

  // Falls back to classifyIntent which accurately detects TRACK_ORDER
  assert.equal(response.intent, ASSISTANT_INTENTS.TRACK_ORDER);
});

test('DeterministicAssistantEngine handles PAYMENT_HELP with authoritative COD details', async () => {
  // Authoritative sources:
  // 1. backend/requester/orderingHandler.js:254-255 (buildTrustedOrder sets paymentMethod: 'cash_on_delivery')
  // 2. components/RequestDetailsModal.jsx:25 ({ label: 'Payment Method', value: 'Cash on Delivery' })
  // 3. app/requester/r_request.jsx:80 (paymentMethod: request.payment_method || 'cash_on_delivery')
  const engine = new DeterministicAssistantEngine();

  const resEn = await engine.respond({
    userInput: 'What payment options are supported?',
    forcedIntent: ASSISTANT_INTENTS.PAYMENT_HELP,
    safeContext: {},
  });
  assert.equal(resEn.intent, ASSISTANT_INTENTS.PAYMENT_HELP);
  assert.match(resEn.message, /Cash on Delivery \(COD\)/i);

  const resCeb = await engine.respond({
    userInput: 'Unsaon pag bayad sa tubig?',
    forcedIntent: ASSISTANT_INTENTS.PAYMENT_HELP,
    safeContext: {},
  });
  assert.equal(resCeb.intent, ASSISTANT_INTENTS.PAYMENT_HELP);
  assert.match(resCeb.message, /Cash on Delivery \(COD\)/i);
});

test('DeterministicAssistantEngine derives CONTAINER_HELP dynamically from catalog and authorized options', async () => {
  const engine = new DeterministicAssistantEngine();

  // 1. Dynamic catalog products present
  const dynamicContext = {
    products: [
      {
        id: 'prod-1',
        name: 'Purified Drinking Water',
        containerType: 'Gallon Container',
        size: '5 Gallons',
        price: 35.0,
      },
    ],
  };

  const dynamicRes = await engine.respond({
    userInput: 'What container types and sizes do you deliver?',
    forcedIntent: ASSISTANT_INTENTS.CONTAINER_HELP,
    safeContext: dynamicContext,
  });
  assert.equal(dynamicRes.intent, ASSISTANT_INTENTS.CONTAINER_HELP);
  assert.match(dynamicRes.message, /Purified Drinking Water/);
  assert.match(dynamicRes.message, /Gallon Container/);
  assert.match(dynamicRes.message, /5 Gallons/);
  assert.match(dynamicRes.message, /₱35\.00/);
  assert.match(dynamicRes.message, /New Container/);
  assert.match(dynamicRes.message, /Exchange/);

  // 2. Default context (no dynamic products loaded yet)
  const defaultRes = await engine.respond({
    userInput: 'What container types and sizes do you deliver?',
    forcedIntent: ASSISTANT_INTENTS.CONTAINER_HELP,
    safeContext: {},
  });
  assert.equal(defaultRes.intent, ASSISTANT_INTENTS.CONTAINER_HELP);
  assert.match(defaultRes.message, /New Container/);
  assert.match(defaultRes.message, /Exchange/);
  assert.doesNotMatch(defaultRes.message, /dispenser/i);
});

test('classifyIntentDetails correctly classifies free-typed queries with collision priorities', () => {
  const testMatrix = [
    { text: 'asa na akong order?', expected: ASSISTANT_INTENTS.TRACK_ORDER },
    { text: 'when ma deliver akong order?', expected: ASSISTANT_INTENTS.DELIVERY_SCHEDULE },
    { text: 'kanus-a maabot akong tubig?', expected: ASSISTANT_INTENTS.DELIVERY_SCHEDULE },
    { text: 'When is my delivery schedule?', expected: ASSISTANT_INTENTS.DELIVERY_SCHEDULE },
    { text: 'why dili ko ka order?', expected: ASSISTANT_INTENTS.EXPLAIN_ORDERING_RESTRICTION },
    { text: 'nganong dili ko ka order?', expected: ASSISTANT_INTENTS.EXPLAIN_ORDERING_RESTRICTION },
    { text: "Why can't I order?", expected: ASSISTANT_INTENTS.EXPLAIN_ORDERING_RESTRICTION },
    { text: "Why can't I chat?", expected: ASSISTANT_INTENTS.EXPLAIN_CHAT_RESTRICTION },
    { text: 'pwede ko mo contact sa station?', expected: ASSISTANT_INTENTS.CONTACT_STATION },
    { text: 'unsaon nako pag message sa station?', expected: ASSISTANT_INTENTS.CONTACT_STATION },
    { text: 'where is the nearest provider?', expected: ASSISTANT_INTENTS.FIND_PROVIDER },
    { text: 'Can I cancel?', expected: ASSISTANT_INTENTS.CANCELLED_ORDER_HELP },
    { text: 'What are the delivery hours?', expected: ASSISTANT_INTENTS.DELIVERY_SCHEDULE },
    { text: 'What payment methods are supported?', expected: ASSISTANT_INTENTS.PAYMENT_HELP },
    { text: 'What container types and sizes do you deliver?', expected: ASSISTANT_INTENTS.CONTAINER_HELP },
    { text: 'Where can I see my past orders?', expected: ASSISTANT_INTENTS.TRACK_ORDER },
    { text: 'Find nearby water stations', expected: ASSISTANT_INTENTS.FIND_PROVIDER },
    { text: 'How do I order water on BlueTap?', expected: ASSISTANT_INTENTS.HOW_BLUETAP_WORKS },
    { text: 'Why was my delivery failed?', expected: ASSISTANT_INTENTS.FAILED_DELIVERY_HELP },
    { text: 'Why is my account restricted?', expected: ASSISTANT_INTENTS.EXPLAIN_ORDERING_RESTRICTION },
    { text: 'Can I still order water with this restriction?', expected: ASSISTANT_INTENTS.EXPLAIN_ORDERING_RESTRICTION },
    { text: 'How do I resolve this restriction?', expected: ASSISTANT_INTENTS.EXPLAIN_ORDERING_RESTRICTION },
  ];

  for (const { text, expected } of testMatrix) {
    const details = classifyIntentDetails(text);
    assert.equal(
      details.intent,
      expected,
      `Expected "${text}" to resolve to ${expected}, but got ${details.intent}`
    );
    assert.equal(details.confidence, 'high');
  }
});

test('classifyIntentDetails safely falls back to UNKNOWN with low confidence for ambiguous queries', () => {
  const ambiguousQueries = [
    'random question unrelated to water or delivery',
    'what is the weather today in cebu',
    'tell me a joke about dogs',
    'xyz123abc',
  ];

  for (const q of ambiguousQueries) {
    const details = classifyIntentDetails(q);
    assert.equal(details.intent, ASSISTANT_INTENTS.UNKNOWN);
    assert.equal(details.confidence, 'low');
  }
});

test('Storage key and date helper produces stable per-user key and bounds', () => {
  const fixedDate = new Date(2026, 9, 4); // October 4, 2026
  const dateKey = getLocalDateKey(fixedDate);
  assert.equal(dateKey, '2026-10-04');

  const key = buildAssistantStorageKey('req_usr_888');
  assert.equal(key, 'bluetap-assistant:requester:req_usr_888');
  assert.equal(buildAssistantStorageKey('dis_usr_999', 'distributor'), 'bluetap-assistant:distributor:dis_usr_999');

  // Anonymous and empty user IDs are rejected
  assert.equal(buildAssistantStorageKey('anonymous'), '');
  assert.equal(buildAssistantStorageKey(''), '');
});

test('sanitizeMessagesForStorage strips sensitive fields and bounds count', () => {
  const largeList = Array.from({ length: 60 }, (_, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    text: `Message text ${i}`,
    cards: [
      {
        type: 'order',
        orderId: `ord-${i}`,
        reporterId: 'private-mod-user',
        internalNotes: 'SECRET_NOTE',
        authToken: 'SECRET_TOKEN_DO_NOT_PERSIST',
      },
    ],
    actions: [
      {
        type: 'START_ORDER',
        secret: 'DO_NOT_STORE',
      },
    ],
  }));

  const sanitized = sanitizeMessagesForStorage(largeList, MAX_STORED_MESSAGES);
  assert.equal(sanitized.length, 40);

  // Check last message
  const last = sanitized[39];
  assert.equal(last.id, 'msg-59');
  assert.equal(last.cards[0].orderId, 'ord-59');
  assert.equal(last.cards[0].reporterId, undefined);
  assert.equal(last.cards[0].internalNotes, undefined);
  assert.equal(last.cards[0].authToken, undefined);
  assert.equal(last.actions[0].secret, undefined);
});

test('Daily chat persistence saves, loads on same day, and removes previous-day transcript on date change', async () => {
  const userId = 'requester_cleanup_test_101';
  const day1 = new Date(2026, 9, 4); // 2026-10-04
  const day2 = new Date(2026, 9, 5); // 2026-10-05

  const initialMsgs = [
    { id: '1', role: 'user', text: 'asa na akong order?' },
    { id: '2', role: 'assistant', text: 'Ang imong order kay Out for Delivery.' },
  ];

  // 1. Save on Day 1
  const saved = await saveDailyAssistantChat({
    userId,
    messages: initialMsgs,
    date: day1,
  });
  assert.equal(saved, true);

  // Direct check: record exists for Day 1
  const recordDay1 = await getRawAssistantStorageRecord({ userId });
  assert.notEqual(recordDay1, null);
  assert.equal(recordDay1.dateKey, '2026-10-04');
  assert.equal(recordDay1.messages.length, 2);

  // 2. Load on same day (Day 1) => restores transcript
  const loadedSameDay = await loadDailyAssistantChat({
    userId,
    date: day1,
  });
  assert.equal(loadedSameDay.length, 2);
  assert.equal(loadedSameDay[0].text, 'asa na akong order?');
  assert.equal(loadedSameDay[1].text, 'Ang imong order kay Out for Delivery.');

  // 3. Load on next day (Day 2) => detects date transition, removes previous-day transcript, returns fresh empty array
  const loadedNextDay = await loadDailyAssistantChat({
    userId,
    date: day2,
  });
  assert.equal(loadedNextDay.length, 0);

  // 4. Verify previous-day Assistant transcript was explicitly deleted from storage (preventing accumulation)
  const recordAfterNextDay = await getRawAssistantStorageRecord({ userId });
  assert.equal(recordAfterNextDay, null);
});

test('Account switch isolation ensures Requester A cannot read Requester B transcript and data is isolated', async () => {
  const userA = 'requester_alice';
  const userB = 'requester_bob';
  const testDate = new Date(2026, 9, 4);

  const aliceMsgs = [
    { id: 'a1', role: 'user', text: "Alice's private question" },
    { id: 'a2', role: 'assistant', text: "Alice's answer" },
  ];

  await saveDailyAssistantChat({
    userId: userA,
    messages: aliceMsgs,
    date: testDate,
  });

  // Bob loads on the same device and same date
  const bobLoaded = await loadDailyAssistantChat({
    userId: userB,
    date: testDate,
  });
  assert.equal(bobLoaded.length, 0);

  // Bob saves his own messages
  const bobMsgs = [
    { id: 'b1', role: 'user', text: "Bob's private question" },
  ];
  await saveDailyAssistantChat({
    userId: userB,
    messages: bobMsgs,
    date: testDate,
  });

  // Alice loads again and still gets Alice's messages (not overwritten by Bob)
  const aliceReloaded = await loadDailyAssistantChat({
    userId: userA,
    date: testDate,
  });
  assert.equal(aliceReloaded.length, 2);
  assert.equal(aliceReloaded[0].text, "Alice's private question");

  // Bob loads again and gets Bob's messages
  const bobReloaded = await loadDailyAssistantChat({
    userId: userB,
    date: testDate,
  });
  assert.equal(bobReloaded.length, 1);
  assert.equal(bobReloaded[0].text, "Bob's private question");
});

test('clearDailyAssistantChat explicitly clears transcript for current user', async () => {
  const userId = 'requester_clear_test';
  const testDate = new Date(2026, 9, 4);

  const msgs = [
    { id: 'm1', role: 'user', text: 'Hello' },
    { id: 'm2', role: 'assistant', text: 'Hi!' },
  ];

  await saveDailyAssistantChat({ userId, messages: msgs, date: testDate });

  let loaded = await loadDailyAssistantChat({ userId, date: testDate });
  assert.equal(loaded.length, 2);

  await clearDailyAssistantChat({ userId });

  loaded = await loadDailyAssistantChat({ userId, date: testDate });
  assert.equal(loaded.length, 0);

  const raw = await getRawAssistantStorageRecord({ userId });
  assert.equal(raw, null);
});

test('assistantStorage module contract exports all required functions and default export object', () => {
  const storageModule = requireTranspiled('../../../services/assistant/assistantStorage.js');

  // Verify named exports
  assert.equal(typeof storageModule.saveDailyAssistantChat, 'function');
  assert.equal(typeof storageModule.loadDailyAssistantChat, 'function');
  assert.equal(typeof storageModule.clearDailyAssistantChat, 'function');
  assert.equal(typeof storageModule.getLocalDateKey, 'function');
  assert.equal(typeof storageModule.buildAssistantStorageKey, 'function');
  assert.equal(typeof storageModule.sanitizeMessagesForStorage, 'function');
  assert.equal(typeof storageModule.getRawAssistantStorageRecord, 'function');
  assert.equal(typeof storageModule.ASSISTANT_STORAGE_VERSION, 'number');
  assert.equal(typeof storageModule.MAX_STORED_MESSAGES, 'number');

  // Verify default export object exists and satisfies ESM / bundler interop
  assert.ok(storageModule.default, 'Default export must exist');
  assert.equal(typeof storageModule.default.saveDailyAssistantChat, 'function');
  assert.equal(typeof storageModule.default.loadDailyAssistantChat, 'function');
  assert.equal(typeof storageModule.default.clearDailyAssistantChat, 'function');
});
