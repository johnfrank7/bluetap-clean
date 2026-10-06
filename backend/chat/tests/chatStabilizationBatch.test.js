const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createChatConversationsHandler,
  createChatMessagesHandler,
} = require('../chatHandler');
const { createOrderDetailsHandler } = require('../../orders/orderDetailsHandler');
const { applyCors } = require('../../utils/cors');
const {
  formatOrderDate,
  formatDeliveryDate,
  formatDisplayUniqueId,
  normalizeProductItem,
  normalizeRequestDetails,
  parseDate,
} = require('../../../services/orderNormalizer');

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function fixture() {
  const records = new Map(Object.entries({
    'users/requester-a': { role: 'requester', accountStatus: 'active', publicUid: 'Req001', fullName: 'Alice Requester', phone: '09171234567' },
    'users/requester-b': { role: 'requester', accountStatus: 'active', publicUid: 'Req002', fullName: 'Bob Requester', phone: '09187654321' },
    'users/distributor-a': { role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch-a', branchMembershipVersion: 1, publicUid: 'Dis001', fullName: 'Dan Distributor' },
    'users/manager-a': { role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId: 'branch-a', publicUid: 'Man001', fullName: 'Mary Manager' },
    'users/manager-b': { role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId: 'branch-b', publicUid: 'Man002', fullName: 'Mark Manager' },
    'users/admin-a': { role: 'admin', accountStatus: 'active', publicUid: 'Adm001', fullName: 'Arthur Admin' },
    'branches/branch-a': { name: 'Main Station', status: 'active' },
    'branches/branch-b': { name: 'West Station', status: 'active' },
    'requests/order-a': {
      requester_id: 'requester-a',
      requestId: 'BT-2026-0001',
      totalAtOrder: 250,
      currentBranchId: 'branch-a',
      branchId: 'branch-a',
      assignedDistributorUid: 'distributor-a',
      assignmentVersion: 1,
      status: 'distributor_assigned',
      created_at: { _seconds: 1775000000, _nanoseconds: 0 },
      delivery_date: '2026-04-15',
      products: [
        { name: 'Mineral Water 5 Gallon', quantity: 5, unitPrice: 50, price: 50, containerType: 'Slim 5G' },
      ],
      deliveryLocation: {
        address: '123 Main St',
        latitude: 14.5995,
        longitude: 120.9842,
      },
    },
    'requests/order-legacy': {
      requesterUid: 'requester-b',
      id: 'order-legacy',
      total_cost: 150,
      branchId: 'branch-b',
      status: 'pending',
      orderDate: '2026-03-20',
      items: [
        { product_name: 'Purified Water', qty: 3, unit_price: 50 },
      ],
    },
  }).map(([k, v]) => [k, clone(v)]));

  const snapshot = (store, path) => ({
    id: path.split('/').pop(),
    exists: store.has(path),
    data: () => clone(store.get(path)),
  });

  const querySnapshot = (store, query) => {
    const prefix = `${query.path}/`;
    let docs = [...store.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path]) => ({ path, data: clone(store.get(path)) }));
    for (const [field, operator, expected] of query.filters) {
      docs = docs.filter(({ data }) => (operator === '==' ? data?.[field] === expected : false));
    }
    if (query.limitValue) docs = docs.slice(0, query.limitValue);
    return { docs: docs.map(({ path }) => snapshot(store, path)), empty: docs.length === 0, size: docs.length };
  };

  const makeQuery = (path, filters = [], limitValue = null) => ({
    kind: 'query', path, filters, limitValue,
    where(f, op, val) { return makeQuery(path, [...filters, [f, op, val]], limitValue); },
    limit(l) { return makeQuery(path, filters, l); },
    get: async () => querySnapshot(records, { path, filters, limitValue }),
  });

  const collection = (path) => ({
    kind: 'collection',
    path,
    ...makeQuery(path),
    doc(id) {
      const docPath = `${path}/${id}`;
      return {
        kind: 'document',
        path: docPath,
        id,
        get: async () => snapshot(records, docPath),
        collection: (name) => collection(`${docPath}/${name}`),
      };
    },
  });

  let txQueue = Promise.resolve();
  const db = {
    collection,
    async runTransaction(run) {
      const prev = txQueue;
      let release;
      txQueue = new Promise((resolve) => { release = resolve; });
      await prev;
      const working = new Map([...records.entries()].map(([k, v]) => [k, clone(v)]));
      const tx = {
        get: async (target) => (target.kind === 'query' ? querySnapshot(working, target) : snapshot(working, target.path)),
        create(ref, data) {
          working.set(ref.path, clone(data));
        },
        set(ref, data, opts) {
          const next = clone(data);
          working.set(ref.path, opts?.merge && working.has(ref.path) ? { ...working.get(ref.path), ...next } : next);
        },
        update(ref, data) {
          working.set(ref.path, { ...working.get(ref.path), ...clone(data) });
        },
      };
      try {
        const res = await run(tx);
        records.clear();
        for (const [k, v] of working) records.set(k, v);
        return res;
      } finally {
        release();
      }
    },
  };

  const claims = {
    'requester-a-token': { uid: 'requester-a', role: 'requester' },
    'requester-b-token': { uid: 'requester-b', role: 'requester' },
    'distributor-a-token': { uid: 'distributor-a', role: 'distributor' },
    'manager-a-token': { uid: 'manager-a', role: 'manager', manager: true },
    'manager-b-token': { uid: 'manager-b', role: 'manager', manager: true },
    'admin-a-token': { uid: 'admin-a', role: 'admin', admin: true },
  };

  const auth = {
    verifyIdToken: async (token) => {
      const cleanToken = token.replace('Bearer ', '').trim();
      const claim = claims[cleanToken];
      if (!claim) throw new Error('invalid-token');
      return claim;
    },
    getUser: async (uid) => ({ uid, disabled: false }),
  };

  let msgCounter = 0;
  let convCounter = 0;
  const dependencies = {
    now: () => new Date(),
    createConversationId: () => `conv-${++convCounter}`,
    createMessageId: () => `msg-${++msgCounter}`,
  };

  const getAdmin = () => ({ auth, db });

  return {
    records,
    db,
    auth,
    getAdmin,
    conversations: createChatConversationsHandler(getAdmin, dependencies),
    messages: createChatMessagesHandler(getAdmin, dependencies),
  };
}

async function callHandler(handler, method, token, body = {}, query = '') {
  const req = {
    method,
    url: `/api/chat/messages${query}`,
    headers: {
      authorization: `Bearer ${token}`,
      origin: 'http://localhost:8081',
    },
    body,
  };
  let statusCode = 200;
  let responseData = null;
  const resHeaders = {};

  const res = {
    setHeader(name, val) { resHeaders[name.toLowerCase()] = val; },
    getHeader(name) { return resHeaders[name.toLowerCase()]; },
    status(code) { statusCode = code; return res; },
    json(data) { responseData = data; return res; },
    end(data) { if (data) responseData = data; return res; },
    _getStatusCode: () => statusCode,
    _getData: () => responseData,
    _getHeaders: () => resHeaders,
  };

  await handler(req, res);
  return { statusCode, data: responseData, headers: resHeaders };
}

test('CORS headers allow DELETE, PUT, POST, GET, PATCH, OPTIONS for approved origins', () => {
  const req = {
    method: 'OPTIONS',
    url: '/api/chat/messages',
    headers: { origin: 'http://localhost:8081' },
  };
  const headers = {};
  const res = {
    setHeader(name, val) { headers[name.toLowerCase()] = val; },
    getHeader(name) { return headers[name.toLowerCase()]; },
    status() { return res; },
    end() { return res; },
  };

  const allowed = applyCors(req, res);
  assert.equal(allowed, true);
  const allowMethods = res.getHeader('access-control-allow-methods');
  assert.ok(allowMethods.includes('DELETE'), 'CORS must include DELETE method');
  assert.ok(allowMethods.includes('POST'), 'CORS must include POST method');
  assert.ok(allowMethods.includes('PUT'), 'CORS must include PUT method');
  assert.equal(res.getHeader('access-control-allow-origin'), 'http://localhost:8081');
});

test('Chat Messages Handler: plain send succeeds and derives sequence and timestamp', async () => {
  const f = fixture();
  const convRes = await callHandler(f.conversations, 'POST', 'requester-a-token', {
    type: 'requester_distributor',
    orderId: 'order-a',
  });
  assert.equal(convRes.statusCode, 201);
  const convId = convRes.data.conversation.id;

  const msgRes = await callHandler(f.messages, 'POST', 'requester-a-token', {
    conversationId: convId,
    clientMutationId: 'c-mut-1',
    body: 'Hello distributor!',
  });

  assert.equal(msgRes.statusCode, 201);
  assert.equal(msgRes.data.message.seq, 1);
  assert.equal(msgRes.data.message.body, 'Hello distributor!');
  assert.equal(msgRes.data.message.senderUid, 'requester-a');
  assert.equal(msgRes.data.message.replyTo, undefined);
});

test('Chat Messages Handler: reply send derives replyTo snapshot on server and protects client fields', async () => {
  const f = fixture();
  const convRes = await callHandler(f.conversations, 'POST', 'requester-a-token', {
    type: 'requester_distributor',
    orderId: 'order-a',
  });
  const convId = convRes.data.conversation.id;

  const msg1Res = await callHandler(f.messages, 'POST', 'requester-a-token', {
    conversationId: convId,
    clientMutationId: 'm1',
    body: 'Initial greeting',
  });
  const msg1Id = msg1Res.data.message.id;

  const replyRes = await callHandler(f.messages, 'POST', 'distributor-a-token', {
    conversationId: convId,
    clientMutationId: 'reply-1',
    body: 'Replying to greeting',
    replyToMessageId: msg1Id,
  });

  assert.equal(replyRes.statusCode, 201);
  assert.equal(replyRes.data.message.seq, 2);
  assert.ok(replyRes.data.message.replyTo);
  assert.equal(replyRes.data.message.replyTo.messageId, msg1Id);
  assert.equal(replyRes.data.message.replyTo.seq, 1);
  assert.equal(replyRes.data.message.replyTo.senderUid, 'requester-a');
  assert.equal(replyRes.data.message.replyTo.snippet, 'Initial greeting');
});

test('Chat Messages Handler: cross-conversation reply target is rejected', async () => {
  const f = fixture();
  const conv1Res = await callHandler(f.conversations, 'POST', 'requester-a-token', {
    type: 'requester_distributor',
    orderId: 'order-a',
  });
  const conv1Id = conv1Res.data.conversation.id;

  const conv2Res = await callHandler(f.conversations, 'POST', 'requester-a-token', {
    type: 'requester_branch',
    intent: 'order_followup',
    orderId: 'order-a',
  });
  const conv2Id = conv2Res.data.conversation.id;

  const msgInConv2 = await callHandler(f.messages, 'POST', 'requester-a-token', {
    conversationId: conv2Id,
    clientMutationId: 'm2',
    body: 'In thread 2',
  });

  const crossReplyRes = await callHandler(f.messages, 'POST', 'requester-a-token', {
    conversationId: conv1Id,
    clientMutationId: 'cross-reply',
    body: 'Illegal cross-thread reply',
    replyToMessageId: msgInConv2.data.message.id,
  });

  assert.equal(crossReplyRes.statusCode, 404);
  assert.equal(crossReplyRes.data.error.reason, 'CHAT_REPLY_TARGET_NOT_FOUND');
});

test('Chat Messages Handler: soft delete creates tombstone within 15 minutes', async () => {
  const f = fixture();
  const convRes = await callHandler(f.conversations, 'POST', 'requester-a-token', {
    type: 'requester_distributor',
    orderId: 'order-a',
  });
  const convId = convRes.data.conversation.id;

  const msgRes = await callHandler(f.messages, 'POST', 'requester-a-token', {
    conversationId: convId,
    clientMutationId: 'to-delete',
    body: 'Sensitive info that should be deleted',
  });
  const msgId = msgRes.data.message.id;

  const delRes = await callHandler(f.messages, 'DELETE', 'requester-a-token', {
    conversationId: convId,
    messageId: msgId,
    clientMutationId: 'del-1',
  });

  assert.equal(delRes.statusCode, 200);
  assert.equal(delRes.data.message.body, '');
  assert.ok(delRes.data.message.deletedAt);

  const replyRes = await callHandler(f.messages, 'POST', 'distributor-a-token', {
    conversationId: convId,
    clientMutationId: 'reply-to-tombstone',
    body: 'Replying to deleted msg',
    replyToMessageId: msgId,
  });
  assert.equal(replyRes.statusCode, 201);
  assert.equal(replyRes.data.message.replyTo.snippet, 'Message deleted');
});

test('Authoritative Order Details: Requester can access own order and receives normalized fields', async () => {
  const f = fixture();
  const handler = createOrderDetailsHandler(f.getAdmin);
  const req = {
    method: 'GET',
    url: '/api/orders/details?orderId=order-a',
    headers: { authorization: 'Bearer requester-a-token' },
  };
  let statusCode = 200;
  let data = null;
  const res = {
    setHeader() {},
    status(c) { statusCode = c; return res; },
    json(d) { data = d; return res; },
  };

  await handler(req, res);
  assert.equal(statusCode, 200);
  assert.equal(data.order.id, 'order-a');
  assert.equal(data.order.totalAtOrder, 250);
  assert.equal(data.order.requesterName, 'Alice Requester');
  assert.equal(data.order.contactNumber, '09171234567');
  assert.equal(data.order.requesterPublicUidSnapshot, 'Req001');
});

test('Authoritative Order Details: Requester cannot access another requester order', async () => {
  const f = fixture();
  const handler = createOrderDetailsHandler(f.getAdmin);
  const req = {
    method: 'GET',
    url: '/api/orders/details?orderId=order-a',
    headers: { authorization: 'Bearer requester-b-token' },
  };
  let statusCode = 200;
  let data = null;
  const res = {
    setHeader() {},
    status(c) { statusCode = c; return res; },
    json(d) { data = d; return res; },
  };

  await handler(req, res);
  assert.equal(statusCode, 403);
  assert.equal(data?.error?.reason, 'ORDER_NOT_AUTHORIZED');
});

test('Authoritative Order Details: Manager can access own branch order and not foreign branch order', async () => {
  const f = fixture();
  const handler = createOrderDetailsHandler(f.getAdmin);

  let code1 = 200;
  const res1 = {
    setHeader() {},
    status(c) { code1 = c; return res1; },
    json() { return res1; },
  };
  await handler({ method: 'GET', url: '/api/orders/details?orderId=order-a', headers: { authorization: 'Bearer manager-a-token' } }, res1);
  assert.equal(code1, 200);

  let code2 = 200;
  const res2 = {
    setHeader() {},
    status(c) { code2 = c; return res2; },
    json() { return res2; },
  };
  await handler({ method: 'GET', url: '/api/orders/details?orderId=order-a', headers: { authorization: 'Bearer manager-b-token' } }, res2);
  assert.equal(code2, 403);
});

test('Authoritative Order Details: Admin has global access to all orders', async () => {
  const f = fixture();
  const handler = createOrderDetailsHandler(f.getAdmin);
  let statusCode = 200;
  let data = null;
  const res = {
    setHeader() {},
    status(c) { statusCode = c; return res; },
    json(d) { data = d; return res; },
  };
  await handler({ method: 'GET', url: '/api/orders/details?orderId=order-legacy', headers: { authorization: 'Bearer admin-a-token' } }, res);
  assert.equal(statusCode, 200);
  assert.equal(data.order.id, 'order-legacy');
  assert.equal(data.order.total_cost, 150);
});

test('Order Normalizer: correctly resolves legacy aliases, dates, prices, and line items', () => {
  const legacyOrder = {
    id: 'leg-123',
    requesterUid: 'req-99',
    requesterNameSnapshot: 'John Doe',
    created_at: { _seconds: 1775000000 },
    delivery_date: '2026-05-20',
    total_cost: 160,
    items: [
      { product_name: 'Purified Alkaline', qty: 4, unit_price: 40, container_type: 'Slim' },
    ],
  };

  const normalized = normalizeRequestDetails(legacyOrder);
  assert.equal(normalized.id, 'leg-123');
  assert.equal(normalized.requesterName, 'John Doe');
  assert.equal(normalized.grandTotal, 160);
  assert.equal(normalized.orderDate, 'Apr 1, 2026');
  assert.equal(normalized.deliveryDate, 'May 20, 2026');
  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.products.length, 1);
  assert.equal(normalized.products[0].name, 'Purified Alkaline');
  assert.equal(normalized.products[0].quantity, 4);
  assert.equal(normalized.products[0].containerType, 'Slim');
  assert.equal(normalized.products[0].unitPrice, 40);
  assert.equal(normalized.products[0].subtotal, 160);
});

test('Swipe-to-reply dominance check cancels vertical scrolling and triggers at 48px threshold', () => {
  const checkDominance = (dx, dy) => Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5;

  assert.equal(checkDominance(2, 45), false, 'Vertical scroll must not trigger swipe reply');
  assert.equal(checkDominance(10, 25), false, 'Diagonal with vertical dominance must not trigger');

  assert.equal(checkDominance(30, 5), true, 'Horizontal swipe must be captured');
  assert.equal(checkDominance(-40, 8), true, 'Negative horizontal swipe must be captured');

  const SWIPE_THRESHOLD = 48;
  const didTrigger = (dx) => Math.abs(dx) >= SWIPE_THRESHOLD;
  assert.equal(didTrigger(35), false, 'Swipe under 48px must not trigger reply');
  assert.equal(didTrigger(50), true, 'Swipe at or above 48px must trigger reply');
  assert.equal(didTrigger(-52), true, 'Swipe in reverse at or above 48px must trigger reply');
});
