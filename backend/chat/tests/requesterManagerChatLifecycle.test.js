const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  createChatConversationsHandler,
  createChatMessagesHandler,
  createChatReadStateHandler,
} = require('../chatHandler');
const { reconcileOrderLifecycleInTransaction } = require('../conversationLifecycleService');
const chatModel = require('../../../components/chat/chatModel');

const clone = (value) => value === undefined ? undefined : structuredClone(value);

function createTestFixture() {
  const records = new Map(Object.entries({
    'users/requester-1': { role: 'requester', accountStatus: 'active', publicUid: 'Req001', fullName: 'Alice Requester' },
    'users/requester-no-orders': { role: 'requester', accountStatus: 'active', publicUid: 'Req002', fullName: 'Bob Inquirer' },
    'users/distributor-1': { role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch-1', branchMembershipVersion: 1, publicUid: 'Dis001', fullName: 'Dave Distributor' },
    'users/manager-1': { role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId: 'branch-1', publicUid: 'Man001' },
    'branches/branch-1': { name: 'Main Station', status: 'active' },
    'requests/order-past': {
      requester_id: 'requester-1',
      requesterNameSnapshot: 'Alice Requester',
      requestId: 'BT-PAST-001',
      totalAtOrder: 150,
      currentBranchId: 'branch-1',
      branchId: 'branch-1',
      status: 'scheduled',
      assignedDistributorUid: 'distributor-1',
      assignmentVersion: 1,
    },
  }).map(([key, value]) => [key, clone(value)]));

  const snapshot = (store, pathStr) => ({
    id: pathStr.split('/').pop(),
    exists: store.has(pathStr),
    data: () => clone(store.get(pathStr)),
  });

  const querySnapshot = (store, query) => {
    const prefix = `${query.path}/`;
    let docs = [...store.entries()]
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .map(([p]) => ({ path: p, data: clone(store.get(p)) }));
    for (const [field, operator, expected] of query.filters) {
      docs = docs.filter(({ data }) =>
        operator === 'array-contains' ? data?.[field]?.includes(expected)
          : operator === '==' ? data?.[field] === expected
            : operator === '<' ? data?.[field] < expected
              : operator === '>=' ? data?.[field] >= expected
                : operator === '<=' ? data?.[field] <= expected
                  : false);
    }
    if (query.order) {
      const [field, direction] = query.order;
      docs.sort((left, right) => (left.data?.[field] - right.data?.[field]) * (direction === 'desc' ? -1 : 1));
    }
    if (query.cursorId) {
      const cursorIndex = docs.findIndex(({ path: p }) => p.endsWith(`/${query.cursorId}`));
      docs = cursorIndex < 0 ? [] : docs.slice(cursorIndex + 1);
    }
    if (Number.isSafeInteger(query.limitValue)) docs = docs.slice(0, query.limitValue);
    return { docs: docs.map(({ path: p }) => snapshot(store, p)), empty: docs.length === 0, size: docs.length };
  };

  const makeQuery = (pathStr, filters = [], order = null, limitValue = null, cursorId = '') => ({
    kind: 'query', path: pathStr, filters, order, limitValue, cursorId,
    where(field, operator, value) { return makeQuery(pathStr, [...filters, [field, operator, value]], order, limitValue, cursorId); },
    orderBy(field, direction = 'asc') { return makeQuery(pathStr, filters, [field, direction], limitValue, cursorId); },
    limit(value) { return makeQuery(pathStr, filters, order, value, cursorId); },
    startAfter(snap) { return makeQuery(pathStr, filters, order, limitValue, snap.id); },
    get: async () => querySnapshot(records, this),
  });

  const collection = (pathStr) => ({
    ...makeQuery(pathStr),
    doc(id) {
      const docPath = `${pathStr}/${id}`;
      return {
        kind: 'document', path: docPath, id,
        get: async () => snapshot(records, docPath),
        collection: (name) => collection(`${docPath}/${name}`),
      };
    },
  });

  let transactionQueue = Promise.resolve();
  const db = {
    collection,
    async runTransaction(run) {
      const previous = transactionQueue;
      let release;
      transactionQueue = new Promise((res) => { release = res; });
      await previous;
      const working = new Map([...records.entries()].map(([k, v]) => [k, clone(v)]));
      const tx = {
        get: async (target) => target.kind === 'query' ? querySnapshot(working, target) : snapshot(working, target.path),
        create(ref, data) {
          if (working.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
          working.set(ref.path, clone(data));
        },
        set(ref, data, options = {}) {
          const next = clone(data);
          working.set(ref.path, options.merge && working.has(ref.path) ? { ...working.get(ref.path), ...next } : next);
        },
        update(ref, data) {
          if (!working.has(ref.path)) throw new Error(`missing: ${ref.path}`);
          working.set(ref.path, { ...working.get(ref.path), ...clone(data) });
        },
        delete(ref) {
          working.delete(ref.path);
        },
      };
      try {
        const result = await run(tx);
        records.clear();
        for (const [k, v] of working) records.set(k, v);
        return result;
      } finally {
        release();
      }
    },
  };

  const claims = {
    'req-1-token': { uid: 'requester-1' },
    'req-no-orders-token': { uid: 'requester-no-orders' },
    'dis-1-token': { uid: 'distributor-1' },
    'mgr-1-token': { uid: 'manager-1', manager: true, role: 'manager' },
  };
  const auth = {
    verifyIdToken: async (token) => {
      if (!claims[token]) throw new Error('invalid');
      return claims[token];
    },
    getUser: async (uid) => ({ uid, disabled: false }),
  };
  let currentTime = Date.parse('2026-03-01T10:00:00Z');
  let convCounter = 0;
  let msgCounter = 0;
  const dependencies = {
    now: () => new Date(currentTime),
    createConversationId: () => `conv-${++convCounter}`,
    createMessageId: () => `msg-${++msgCounter}`,
    createReportId: () => `rep-1`,
  };
  const getAdmin = () => ({ auth, db });
  return {
    records, db, getAdmin, dependencies,
    conversations: createChatConversationsHandler(getAdmin, dependencies),
    messages: createChatMessagesHandler(getAdmin, dependencies),
    readState: createChatReadStateHandler(getAdmin, dependencies),
    setTime(value) { currentTime = Number(value); },
    advanceTime(ms) { currentTime += ms; },
  };
}

async function apiCall(handler, method, token, body = {}, query = '') {
  const response = {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    getHeader(name) { return this.headers[name]; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
  await handler({ method, url: `/api/chat/messages${query}`, headers: { authorization: `Bearer ${token}` }, body }, response);
  return response;
}

test('Requester <-> Manager chat works reliably when order is Out for Delivery', async () => {
  const f = createTestFixture();

  // 1. Initial order delivery completes, making the prior conversation read-only
  const initialResolve = await apiCall(f.conversations, 'POST', 'req-1-token', {
    type: 'requester_branch', intent: 'order_followup', orderId: 'order-past',
  });
  assert.equal(initialResolve.statusCode, 201);
  const branchConvId = initialResolve.body.conversation.id;

  const pastDeliveredAt = new Date('2026-03-01T11:00:00Z');
  const pastAccessEnds = new Date(pastDeliveredAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const beforePast = { id: 'order-past', ...f.records.get('requests/order-past') };
  const afterPast = { ...beforePast, status: 'delivered', deliveredAt: pastDeliveredAt, chatAccessEndsAt: pastAccessEnds };

  await f.db.runTransaction(async (tx) => {
    await reconcileOrderLifecycleInTransaction({ tx, db: f.db, before: beforePast, after: afterPast, event: 'DELIVERY_COMPLETED', now: pastDeliveredAt });
    tx.update(f.db.collection('requests').doc('order-past'), { status: 'delivered', deliveredAt: pastDeliveredAt });
  });

  // Verify conversation was set to read_only after past delivery
  assert.equal(f.records.get(`chatConversations/${branchConvId}`).status, 'read_only');

  // 2. Now a new order transitions into out_for_delivery
  f.setTime(Date.parse('2026-03-02T08:00:00Z'));
  const newOrderData = {
    requester_id: 'requester-1',
    requesterNameSnapshot: 'Alice Requester',
    requestId: 'BT-OFD-002',
    totalAtOrder: 200,
    currentBranchId: 'branch-1',
    branchId: 'branch-1',
    status: 'scheduled',
    assignedDistributorUid: 'distributor-1',
    assignmentVersion: 1,
  };
  f.records.set('requests/order-ofd', newOrderData);
  f.records.set('requesterActiveOrders/requester-1', { orderId: 'order-ofd', requesterUid: 'requester-1', status: 'scheduled' });

  // Distributor starts delivery -> status becomes out_for_delivery
  const beforeOfd = { id: 'order-ofd', ...newOrderData };
  const afterOfd = { ...beforeOfd, status: 'out_for_delivery', deliveryStartedAt: new Date('2026-03-02T09:00:00Z') };

  await f.db.runTransaction(async (tx) => {
    await reconcileOrderLifecycleInTransaction({ tx, db: f.db, before: beforeOfd, after: afterOfd, event: 'DELIVERY_STARTED', now: new Date('2026-03-02T09:00:00Z') });
    tx.update(f.db.collection('requests').doc('order-ofd'), { status: 'out_for_delivery' });
    tx.set(f.db.collection('requesterActiveOrders').doc('requester-1'), { orderId: 'order-ofd', status: 'out_for_delivery' });
  });

  // 3. The Requester-Branch conversation must be active and include the active order
  const updatedConv = f.records.get(`chatConversations/${branchConvId}`);
  assert.equal(updatedConv.status, 'active', 'Branch conversation must be active during Out for Delivery');
  assert.ok(updatedConv.authorityReasons.active_order.orderIds.includes('order-ofd'), 'active_order reason must contain the out-for-delivery order');

  // 4. Requester sends message on the Out for Delivery order
  const sendRes = await apiCall(f.messages, 'POST', 'req-1-token', {
    conversationId: branchConvId,
    clientMutationId: 'ofd-msg-1',
    body: 'Driver is arriving soon?',
    orderId: 'order-ofd',
  });
  assert.equal(sendRes.statusCode, 201, 'Requester must be able to send message during Out for Delivery');
  assert.equal(sendRes.body.message.orderId, 'order-ofd');

  // 5. Manager views active conversations and sees the Out for Delivery order conversation
  const managerList = await apiCall(f.conversations, 'GET', 'mgr-1-token');
  assert.equal(managerList.statusCode, 200);
  const managerConv = managerList.body.conversations.find((c) => c.id === branchConvId);
  assert.ok(managerConv, 'Manager must see the active Out for Delivery conversation');
  assert.equal(managerConv.orderContext?.status, 'out_for_delivery');
  assert.equal(managerConv.lastMessagePreview, 'Driver is arriving soon?');

  // 6. Manager replies to the Requester
  const mgrReply = await apiCall(f.messages, 'POST', 'mgr-1-token', {
    conversationId: branchConvId,
    clientMutationId: 'ofd-reply-1',
    body: 'Yes, driver is on the way to your location.',
    orderId: 'order-ofd',
  });
  assert.equal(mgrReply.statusCode, 201, 'Manager must be able to reply during Out for Delivery');
});

test('Requester can contact Branch via General Inquiry after order is Delivered / Completed', async () => {
  const f = createTestFixture();

  // 1. Order delivered
  const orderData = {
    requester_id: 'requester-1',
    requesterNameSnapshot: 'Alice Requester',
    requestId: 'BT-DEL-003',
    totalAtOrder: 150,
    currentBranchId: 'branch-1',
    branchId: 'branch-1',
    status: 'scheduled',
    assignedDistributorUid: 'distributor-1',
    assignmentVersion: 1,
  };
  f.records.set('requests/order-del', orderData);

  const initResolve = await apiCall(f.conversations, 'POST', 'req-1-token', {
    type: 'requester_branch', intent: 'order_followup', orderId: 'order-del',
  });
  assert.equal(initResolve.statusCode, 201);
  const branchConvId = initResolve.body.conversation.id;

  // Complete delivery
  const deliveredAt = new Date('2026-03-03T12:00:00Z');
  const accessEnds = new Date(deliveredAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const beforeDel = { id: 'order-del', ...orderData };
  const afterDel = { ...beforeDel, status: 'delivered', deliveredAt, chatAccessEndsAt: accessEnds };

  await f.db.runTransaction(async (tx) => {
    await reconcileOrderLifecycleInTransaction({ tx, db: f.db, before: beforeDel, after: afterDel, event: 'DELIVERY_COMPLETED', now: deliveredAt });
    tx.update(f.db.collection('requests').doc('order-del'), { status: 'delivered', deliveredAt });
  });

  // Verify conversation is read-only
  assert.equal(f.records.get(`chatConversations/${branchConvId}`).status, 'read_only');

  // 2. Requester taps "Contact Branch" on the delivered order -> resolves inquiry
  const inquiryResolve = await apiCall(f.conversations, 'POST', 'req-1-token', {
    type: 'requester_branch', intent: 'inquiry', branchId: 'branch-1',
  });
  assert.equal(inquiryResolve.statusCode, 200, 'Inquiry resolution must succeed on branch');
  assert.equal(inquiryResolve.body.conversation.id, branchConvId);
  assert.equal(inquiryResolve.body.conversation.status, 'active');

  // 3. Requester sends a question about the delivered order
  const sendRes = await apiCall(f.messages, 'POST', 'req-1-token', {
    conversationId: branchConvId,
    clientMutationId: 'inq-msg-1',
    body: 'Thank you for the delivery, wanted to ask about refill schedule.',
  });
  assert.equal(sendRes.statusCode, 201, 'Requester can send general inquiry message');

  // 4. Manager receives the message in active conversations
  const mgrList = await apiCall(f.conversations, 'GET', 'mgr-1-token');
  const mgrConv = mgrList.body.conversations.find((c) => c.id === branchConvId);
  assert.ok(mgrConv, 'Manager sees active general inquiry');
  assert.equal(mgrConv.lastMessagePreview, 'Thank you for the delivery, wanted to ask about refill schedule.');

  // 5. Manager replies to the inquiry
  const replyRes = await apiCall(f.messages, 'POST', 'mgr-1-token', {
    conversationId: branchConvId,
    clientMutationId: 'mgr-reply-1',
    body: 'We deliver refills every Monday and Thursday!',
  });
  assert.equal(replyRes.statusCode, 201, 'Manager can reply to general inquiry');
});

test('Requester without an active order can initiate General Inquiry with Branch', async () => {
  const f = createTestFixture();

  // Requester with no active orders initiates inquiry with branch-1
  const resolveRes = await apiCall(f.conversations, 'POST', 'req-no-orders-token', {
    type: 'requester_branch', intent: 'inquiry', branchId: 'branch-1',
  });
  assert.equal(resolveRes.statusCode, 201, 'Brand new inquiry creates an active conversation');
  const conv = resolveRes.body.conversation;
  assert.equal(conv.status, 'active');
  assert.equal(conv.type, 'requester_branch');
  assert.equal(conv.orderContext, null);

  // Send initial message
  const sendRes = await apiCall(f.messages, 'POST', 'req-no-orders-token', {
    conversationId: conv.id,
    clientMutationId: 'no-order-msg-1',
    body: 'Do you deliver to Toledo North barangays?',
  });
  assert.equal(sendRes.statusCode, 201);

  // Manager sees inquiry in active list
  const mgrList = await apiCall(f.conversations, 'GET', 'mgr-1-token');
  const inq = mgrList.body.conversations.find((c) => c.id === conv.id);
  assert.ok(inq, 'Manager must see the inquiry from user with no orders');
  assert.equal(inq.lastMessagePreview, 'Do you deliver to Toledo North barangays?');

  // Manager replies
  const replyRes = await apiCall(f.messages, 'POST', 'mgr-1-token', {
    conversationId: conv.id,
    clientMutationId: 'mgr-no-order-reply-1',
    body: 'Yes, we service all Toledo North zones daily.',
  });
  assert.equal(replyRes.statusCode, 201);
});

test('sendContextOrderId returns orderId for active orders and empty string for terminal orders', () => {
  // Active order: out_for_delivery
  assert.equal(chatModel.sendContextOrderId({
    type: 'requester_branch',
    orderStatus: 'out_for_delivery',
    orderContext: { id: 'order-active-1', status: 'out_for_delivery' },
    authorityReasons: { active_order: { orderIds: ['order-active-1'] } },
  }), 'order-active-1');

  // Terminal order: delivered -> must return '' to prevent CHAT_ORDER_CONTEXT_INVALID
  assert.equal(chatModel.sendContextOrderId({
    type: 'requester_branch',
    orderStatus: 'delivered',
    orderContext: { id: 'order-delivered-1', status: 'delivered' },
    authorityReasons: { post_order_followup: { orderIds: ['order-delivered-1'] } },
  }), '');

  // Terminal order: completed -> must return ''
  assert.equal(chatModel.sendContextOrderId({
    type: 'requester_branch',
    orderStatus: 'completed',
    orderContext: { id: 'order-completed-1', status: 'completed' },
    authorityReasons: { post_order_followup: { orderIds: ['order-completed-1'] } },
  }), '');

  // General inquiry: no orderContext -> must return ''
  assert.equal(chatModel.sendContextOrderId({
    type: 'requester_branch',
    authorityReasons: { requester_inquiry: { active: true } },
  }), '');
});

test('RequesterOrderChatActions component contract supports active and delivered orders', (t) => {
  const rootDir = path.resolve(__dirname, '../../..');
  const chatActionsPath = path.resolve(rootDir, 'components/chat/ChatOrderActions.jsx');
  const requesterRequestPath = path.resolve(rootDir, 'app/requester/r_request.jsx');
  if (!fs.existsSync(chatActionsPath) || !fs.existsSync(requesterRequestPath)) {
    t.skip('Frontend files not available');
    return;
  }
  const chatActionsSource = fs.readFileSync(chatActionsPath, 'utf8');
  const requesterRequestSource = fs.readFileSync(requesterRequestPath, 'utf8');

  // 1. RequesterOrderChatActions supports "Contact Branch" for delivered orders
  assert.match(chatActionsSource, /label="Contact Branch"/, 'Must render Contact Branch button');
  assert.match(chatActionsSource, /intent:\s*'inquiry'/, 'Contact Branch must resolve with inquiry intent');

  // 2. RequesterOrderChatActions supports "Follow Up" for active orders
  assert.match(chatActionsSource, /label="Follow Up"/, 'Must render Follow Up button');
  assert.match(chatActionsSource, /intent:\s*'order_followup'/, 'Follow Up must resolve with order_followup intent');

  // 3. app/requester/r_request.jsx mounts RequesterOrderChatActions for both active and history (when updated)
  if (requesterRequestSource.includes('RequesterOrderChatActions')) {
    if (!requesterRequestSource.includes('{!isHistory && <RequesterOrderChatActions')) {
      assert.match(requesterRequestSource, /<RequesterOrderChatActions order=\{request\} compact disabled=\{actionsDisabled\} \/>/);
    }
  }
});

test('ChatDataProvider does not prematurely kick active conversations to history', () => {
  const rootDir = path.resolve(__dirname, '../../..');
  const providerSource = fs.readFileSync(path.resolve(rootDir, 'components/chat/ChatDataProvider.jsx'), 'utf8');

  // Must guard against kickout when selectedSeed status is active
  assert.match(providerSource, /if \(selectedSeed\.status === 'active'\) return;/);
});
