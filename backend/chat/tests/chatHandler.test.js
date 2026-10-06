const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createChatConversationsHandler,
  createChatMessagesHandler,
  createChatReadStateHandler,
} = require('../chatHandler');
const { createChatReportsHandler } = require('../reportHandler');

const clone = (value) => value === undefined ? undefined : structuredClone(value);

function fixture() {
  const records = new Map(Object.entries({
    'users/requester-a': { role: 'requester', accountStatus: 'active', publicUid: 'Req001', fullName: 'John Franz Caliguid' },
    'users/requester-b': { role: 'requester', accountStatus: 'active', publicUid: 'Req002', fullName: 'Crystal Jeanne Ortega' },
    'users/distributor-a': { role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch-a', branchMembershipVersion: 3, publicUid: 'Dis001', fullName: 'BlueTap Test Distributor' },
    'users/distributor-b': { role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch-a', branchMembershipVersion: 2, publicUid: 'Dis002' },
    'users/manager-a': { role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId: 'branch-a', publicUid: 'Man001' },
    'users/manager-b': { role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId: 'branch-b', publicUid: 'Man002' },
    'users/manager-c': { role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId: 'branch-c', publicUid: 'Man003' },
    'branches/branch-a': { name: 'A', status: 'active' },
    'branches/branch-b': { name: 'B', status: 'active' },
    'branches/branch-c': { name: 'C', status: 'active' },
    'requests/order-a': { requester_id: 'requester-a', requesterNameSnapshot: 'John Franz Caliguid', requestId: 'BT-2026-8B4B75BE', totalAtOrder: 180, currentBranchId: 'branch-a', branchId: 'branch-a', branchNameSnapshot: 'A', assignedDistributorUid: 'distributor-a', assignmentVersion: 4, status: 'distributor_assigned' },
    'requests/order-b': { requester_id: 'requester-b', currentBranchId: 'branch-b', branchId: 'branch-b', assignmentVersion: 1, status: 'pending' },
  }).map(([key, value]) => [key, clone(value)]));

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
      docs = docs.filter(({ data }) => operator === 'array-contains' ? data?.[field]?.includes(expected)
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
    if (Number.isSafeInteger(query.limitValue)) docs = docs.slice(0, query.limitValue);
    return { docs: docs.map(({ path }) => snapshot(store, path)), empty: docs.length === 0, size: docs.length };
  };

  const makeQuery = (path, filters = [], order = null, limitValue = null) => ({
    kind: 'query', path, filters, order, limitValue,
    where(field, operator, value) { return makeQuery(path, [...filters, [field, operator, value]], order, limitValue); },
    orderBy(field, direction = 'asc') { return makeQuery(path, filters, [field, direction], limitValue); },
    limit(value) { return makeQuery(path, filters, order, value); },
    get: async () => querySnapshot(records, this),
  });

  const collection = (path) => ({
    ...makeQuery(path),
    doc(id) {
      const docPath = `${path}/${id}`;
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
      transactionQueue = new Promise((resolve) => { release = resolve; });
      await previous;
      const working = new Map([...records.entries()].map(([key, value]) => [key, clone(value)]));
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
      };
      try {
        const result = await run(tx);
        records.clear();
        for (const [key, value] of working) records.set(key, value);
        return result;
      } finally {
        release();
      }
    },
  };

  const claims = {
    'requester-a-token': { uid: 'requester-a' },
    'requester-b-token': { uid: 'requester-b' },
    'distributor-a-token': { uid: 'distributor-a' },
    'distributor-b-token': { uid: 'distributor-b' },
    'manager-a-token': { uid: 'manager-a', manager: true, role: 'manager' },
    'manager-b-token': { uid: 'manager-b', manager: true, role: 'manager' },
    'manager-c-token': { uid: 'manager-c', manager: true, role: 'manager' },
    'manager-no-claim-token': { uid: 'manager-a' },
  };
  const auth = {
    verifyIdToken: async (token) => {
      if (!claims[token]) throw new Error('invalid');
      return claims[token];
    },
    getUser: async (uid) => ({ uid, disabled: false }),
  };
  let currentTime = Date.parse('2026-01-01T00:00:00Z');
  let conversationCounter = 0;
  let messageCounter = 0;
  let reportCounter = 0;
  const dependencies = {
    now: () => new Date(currentTime),
    createConversationId: () => `opaque-conversation-${++conversationCounter}`,
    createMessageId: () => `opaque-message-${++messageCounter}`,
    createReportId: () => `report-${++reportCounter}`,
  };
  const getAdmin = () => ({ auth, db });
  return {
    records, db, getAdmin, dependencies,
    conversations: createChatConversationsHandler(getAdmin, dependencies),
    messages: createChatMessagesHandler(getAdmin, dependencies),
    readState: createChatReadStateHandler(getAdmin, dependencies),
    reports: createChatReportsHandler(getAdmin, dependencies),
    setTime(value) { currentTime = Number(value); },
    advanceTime(milliseconds) { currentTime += milliseconds; },
  };
}

async function call(handler, method, token, body = {}, query = '') {
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

async function resolve(f, token, body) {
  return call(f.conversations, 'POST', token, body);
}

async function directConversation(f) {
  const response = await resolve(f, 'requester-a-token', { type: 'requester_distributor', orderId: 'order-a' });
  assert.ok([200, 201].includes(response.statusCode));
  return response.body.conversation.id;
}

test('cold summary discovery returns the same authorized conversation to both users without resolve', async () => {
  const f = fixture();
  const id = await directConversation(f);
  await call(f.messages, 'POST', 'requester-a-token', { conversationId: id, clientMutationId: 'cold-summary', body: 'hello' });
  for (const token of ['requester-a-token', 'distributor-a-token']) {
    const result = await call(f.conversations, 'GET', token);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.conversations[0].id, id);
    assert.equal(result.body.conversations[0].lastMessageSeq, 1);
  }
  assert.ok(f.records.has('chatUserActivity/distributor-a'));
  assert.equal((await call(f.conversations, 'GET', 'requester-b-token')).body.conversations.length, 0);
  const senderActivityBeforeRead = f.records.get('chatUserActivity/requester-a').revision;
  const read = await call(f.readState, 'POST', 'distributor-a-token', { conversationId: id, lastReadSeq: 1 });
  assert.equal(read.statusCode, 200);
  assert.equal(read.body.conversation.participantState.find((state) => state.principalId === 'distributor-a').unreadCount, 0);
  const { receiptFor } = require('../../../components/chat/chatModel');
  assert.equal(receiptFor({ seq: 1, senderUid: 'requester-a' }, read.body.conversation, 'requester', 'requester-a'), 'seen');
  assert.notEqual(f.records.get('chatUserActivity/requester-a').revision, senderActivityBeforeRead);
  f.records.get('requests/order-a').assignmentVersion++;
  assert.equal((await call(f.conversations, 'GET', 'distributor-a-token')).body.conversations.length, 0);
});

test('Manager cold summaries and pinned Distributor resolution enforce own active branch and membership', async () => {
  const f = fixture();
  const followup = await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'order_followup', orderId: 'order-a' });
  const managerSummary = (await call(f.conversations, 'GET', 'manager-a-token')).body.conversations[0];
  assert.equal(managerSummary.id, followup.body.conversation.id);
  assert.equal(managerSummary.requesterDisplayName, 'John Franz Caliguid');
  assert.equal(managerSummary.orderContext.requestId, 'BT-2026-8B4B75BE');
  assert.equal(managerSummary.orderContext.status, 'distributor_assigned');
  assert.equal(managerSummary.orderContext.totalAtOrder, 180);
  assert.notEqual(managerSummary.requesterDisplayName, 'requester-a');
  assert.equal((await call(f.conversations, 'GET', 'manager-b-token')).body.conversations.length, 0);
  const pinned = await resolve(f, 'manager-a-token', { type: 'distributor_branch', distributorId: 'distributor-a' });
  assert.equal(pinned.statusCode, 201);
  const own = await resolve(f, 'distributor-a-token', { type: 'distributor_branch' });
  assert.equal(own.body.conversation.id, pinned.body.conversation.id);
  assert.equal((await resolve(f, 'manager-b-token', { type: 'distributor_branch', distributorId: 'distributor-a' })).statusCode, 403);
  assert.equal((await resolve(f, 'manager-no-claim-token', { type: 'distributor_branch', distributorId: 'distributor-a' })).statusCode, 403);
  f.records.get('users/distributor-a').branchMembershipVersion++;
  assert.equal((await call(f.messages, 'POST', 'manager-a-token', { conversationId: pinned.body.conversation.id, clientMutationId: 'old-membership', body: 'no' })).statusCode, 409);
  f.records.get('users/distributor-a').distributorStatus = 'inactive';
  assert.equal((await resolve(f, 'manager-a-token', { type: 'distributor_branch', distributorId: 'distributor-a' })).statusCode, 403);
});

test('Requester conversation intents derive participants and reject client-owned authority', async () => {
  const f = fixture();
  const inquiry = await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'inquiry', branchId: 'branch-a' });
  assert.equal(inquiry.statusCode, 201);
  assert.deepEqual(inquiry.body.conversation.participantUserUids, ['requester-a']);
  assert.deepEqual(inquiry.body.conversation.participantBranchIds, ['branch-a']);
  assert.equal(inquiry.body.conversation.authorityReasons.requester_inquiry.active, true);
  assert.notEqual(inquiry.body.conversation.id, inquiry.body.conversation.authorityKeyHash);

  const followup = await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'order_followup', orderId: 'order-a' });
  assert.equal(followup.statusCode, 200);
  assert.equal(followup.body.conversation.id, inquiry.body.conversation.id);
  assert.deepEqual(followup.body.conversation.authorityReasons.active_order.orderIds, ['order-a']);

  const unrelated = await resolve(f, 'requester-b-token', { type: 'requester_branch', intent: 'order_followup', orderId: 'order-a' });
  assert.equal(unrelated.statusCode, 403);
  const spoofed = await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'inquiry', branchId: 'branch-a', requesterUid: 'requester-b', participantUserUids: ['requester-b'] });
  assert.equal(spoofed.statusCode, 400);
  assert.equal(spoofed.body.error.reason, 'CHAT_AUTHORITY_SERVER_OWNED');

  f.records.set('requests/order-a', { ...f.records.get('requests/order-a'), status: 'cancelled' });
  const staleContext = await call(f.messages, 'POST', 'requester-a-token', { conversationId: inquiry.body.conversation.id, clientMutationId: 'stale-context', body: 'About the old order', orderId: 'order-a' });
  assert.equal(staleContext.body.error.reason, 'CHAT_ORDER_CONTEXT_INVALID');
  assert.equal((await call(f.messages, 'POST', 'requester-a-token', { conversationId: inquiry.body.conversation.id, clientMutationId: 'general-inquiry', body: 'General question' })).statusCode, 201);
});

test('an active-order Follow Up remains an active requester-branch conversation and accepts messages', async () => {
  const f = fixture();
  const followup = await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'order_followup', orderId: 'order-a' });
  assert.equal(followup.statusCode, 201);
  assert.equal(followup.body.conversation.type, 'requester_branch');
  assert.equal(followup.body.conversation.status, 'active');
  assert.deepEqual(followup.body.conversation.authorityReasons.active_order.orderIds, ['order-a']);
  assert.equal(followup.body.conversation.orderContext.requestId, 'BT-2026-8B4B75BE');
  assert.equal(followup.body.conversation.requesterDisplayName, 'John Franz Caliguid');

  const sent = await call(f.messages, 'POST', 'requester-a-token', {
    conversationId: followup.body.conversation.id,
    clientMutationId: 'active-followup-send',
    body: 'Please check my active request.',
    orderId: 'order-a',
  });
  assert.equal(sent.statusCode, 201);
  assert.equal(sent.body.message.body, 'Please check my active request.');
});

test('authorized Manager, Requester, and Distributor sends pass while stale presentation context and cross-branch authority fail closed', async () => {
  const f = fixture();
  const branchConversation = await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'order_followup', orderId: 'order-a' });
  const conversationId = branchConversation.body.conversation.id;

  const priorManagerFailure = await call(f.messages, 'POST', 'manager-a-token', {
    conversationId,
    clientMutationId: 'manager-stale-presentation',
    body: 'test',
    orderId: 'order-b',
  });
  assert.equal(priorManagerFailure.statusCode, 400);
  assert.equal(priorManagerFailure.body.error.reason, 'CHAT_ORDER_CONTEXT_INVALID');

  const managerSend = await call(f.messages, 'POST', 'manager-a-token', {
    conversationId,
    clientMutationId: 'manager-authorized-send',
    body: 'test',
  });
  assert.equal(managerSend.statusCode, 201);
  assert.equal(managerSend.body.message.senderPrincipalType, 'branch');
  assert.equal(managerSend.body.message.senderBranchId, 'branch-a');
  assert.equal(managerSend.body.conversation.participantState.find((item) => item.principalId === 'branch-a').unreadCount, 0);
  assert.equal(managerSend.body.conversation.participantState.find((item) => item.principalId === 'requester-a').unreadCount, 1);

  const requesterBranchSend = await call(f.messages, 'POST', 'requester-a-token', {
    conversationId,
    clientMutationId: 'requester-branch-send',
    body: 'Branch reply',
    orderId: 'order-a',
  });
  assert.equal(requesterBranchSend.statusCode, 201);

  const directId = await directConversation(f);
  assert.equal((await call(f.messages, 'POST', 'requester-a-token', {
    conversationId: directId, clientMutationId: 'requester-direct-send', body: 'Requester direct', orderId: 'order-a',
  })).statusCode, 201);
  assert.equal((await call(f.messages, 'POST', 'distributor-a-token', {
    conversationId: directId, clientMutationId: 'distributor-direct-send', body: 'Distributor direct', orderId: 'order-a',
  })).statusCode, 201);

  const stationConversation = await resolve(f, 'distributor-a-token', { type: 'distributor_branch' });
  assert.equal((await call(f.messages, 'POST', 'distributor-a-token', {
    conversationId: stationConversation.body.conversation.id, clientMutationId: 'distributor-branch-send', body: 'Station update',
  })).statusCode, 201);

  const crossBranch = await call(f.messages, 'POST', 'manager-b-token', {
    conversationId, clientMutationId: 'cross-branch-manager', body: 'Denied',
  });
  assert.equal(crossBranch.statusCode, 403);
  assert.equal(crossBranch.body.error.reason, 'CHAT_NOT_AUTHORIZED');

  const managerPersonalDm = await resolve(f, 'manager-a-token', { type: 'requester_manager' });
  assert.equal(managerPersonalDm.statusCode, 400);
  assert.equal(managerPersonalDm.body.error.reason, 'CHAT_TYPE_UNSUPPORTED');
});

test('a delivered assignment cannot resolve a writable direct conversation', async () => {
  const f = fixture();
  const accessEndsAt = new Date('2026-01-08T00:00:00Z');
  f.records.set('requests/order-a', { ...f.records.get('requests/order-a'), status: 'delivered', deliveredAt: new Date('2026-01-01T00:00:00Z'), chatAccessEndsAt: accessEndsAt });
  const denied = await resolve(f, 'requester-a-token', { type: 'requester_distributor', orderId: 'order-a' });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.error.reason, 'CHAT_ASSIGNMENT_NOT_WRITABLE');
});

test('concurrent resolve is registry-backed and returns exactly one conversation', async () => {
  const f = fixture();
  const body = { type: 'requester_branch', intent: 'inquiry', branchId: 'branch-a' };
  const [first, second] = await Promise.all([resolve(f, 'requester-a-token', body), resolve(f, 'requester-a-token', body)]);
  assert.equal(first.body.conversation.id, second.body.conversation.id);
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('chatConversations/')).length, 1);
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('chatAuthorityRegistry/')).length, 1);
});

test('assignment and membership epochs create distinct conversations and stale sends fail closed', async () => {
  const f = fixture();
  const directV4 = await directConversation(f);
  const legacyProjection = { ...f.records.get(`chatConversations/${directV4}`) };
  delete legacyProjection.participantUserAccess;
  delete legacyProjection.participantBranchAccess;
  f.records.set(`chatConversations/${directV4}`, legacyProjection);
  assert.equal((await resolve(f, 'distributor-a-token', { type: 'requester_distributor', orderId: 'order-a' })).body.conversation.id, directV4);
  assert.equal(f.records.get(`chatConversations/${directV4}`).participantUserAccess['distributor-a'], 'active');
  f.records.set('requests/order-a', { ...f.records.get('requests/order-a'), assignedDistributorUid: 'distributor-b', assignmentVersion: 5 });
  const stale = await call(f.messages, 'POST', 'distributor-a-token', { conversationId: directV4, clientMutationId: 'stale-1', body: 'old assignment' });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.error.reason, 'CHAT_STALE_ASSIGNMENT');
  const directV5 = await resolve(f, 'requester-a-token', { type: 'requester_distributor', orderId: 'order-a' });
  assert.equal(directV5.statusCode, 201);
  assert.notEqual(directV5.body.conversation.id, directV4);
  f.records.set('requests/order-a', { ...f.records.get('requests/order-a'), assignmentVersion: 0 });
  assert.equal((await call(f.messages, 'POST', 'requester-a-token', { conversationId: directV5.body.conversation.id, clientMutationId: 'invalid-epoch', body: 'blocked' })).body.error.reason, 'CHAT_STALE_ASSIGNMENT');
  f.records.set('requests/order-a', { ...f.records.get('requests/order-a'), assignmentVersion: 5 });

  const membershipV3 = await resolve(f, 'distributor-a-token', { type: 'distributor_branch' });
  f.records.set('users/distributor-a', { ...f.records.get('users/distributor-a'), branchId: 'branch-b', branchMembershipVersion: 4 });
  const staleMembership = await call(f.messages, 'POST', 'distributor-a-token', { conversationId: membershipV3.body.conversation.id, clientMutationId: 'stale-membership', body: 'old branch' });
  assert.equal(staleMembership.statusCode, 409);
  assert.equal(staleMembership.body.error.reason, 'CHAT_STALE_BRANCH_MEMBERSHIP');
  const membershipV4 = await resolve(f, 'distributor-a-token', { type: 'distributor_branch' });
  assert.notEqual(membershipV4.body.conversation.id, membershipV3.body.conversation.id);
  f.records.set('users/distributor-a', { ...f.records.get('users/distributor-a'), branchMembershipVersion: 0 });
  assert.equal((await call(f.messages, 'POST', 'distributor-a-token', { conversationId: membershipV4.body.conversation.id, clientMutationId: 'invalid-membership', body: 'blocked' })).body.error.reason, 'CHAT_STALE_BRANCH_MEMBERSHIP');
});

test('branch coordination is sorted, branch-authored, claim-protected, and requires active branches', async () => {
  const f = fixture();
  const first = await resolve(f, 'manager-a-token', { type: 'branch_coordination', targetBranchId: 'branch-b' });
  const reverse = await resolve(f, 'manager-b-token', { type: 'branch_coordination', targetBranchId: 'branch-a' });
  assert.equal(first.statusCode, 201);
  assert.equal(reverse.body.conversation.id, first.body.conversation.id);
  assert.deepEqual(first.body.conversation.participantBranchIds, ['branch-a', 'branch-b']);
  assert.deepEqual(first.body.conversation.participantUserUids, undefined);
  assert.equal((await resolve(f, 'manager-no-claim-token', { type: 'branch_coordination', targetBranchId: 'branch-b' })).statusCode, 403);
  const summaries = await call(f.conversations, 'GET', 'manager-a-token');
  assert.equal(summaries.body.conversations[0].branchNameSnapshots['branch-b'], 'B');
  f.records.set('branches/branch-c', { ...f.records.get('branches/branch-c'), status: 'inactive' });
  assert.equal((await resolve(f, 'manager-a-token', { type: 'branch_coordination', targetBranchId: 'branch-c' })).statusCode, 403);
});

test('terminated callers and unsupported conversation graphs are denied', async () => {
  const f = fixture();
  f.records.set('users/requester-a', { ...f.records.get('users/requester-a'), accountStatus: 'terminated' });
  const terminated = await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'inquiry', branchId: 'branch-a' });
  assert.equal(terminated.statusCode, 403);
  assert.equal(terminated.body.error.reason, 'CHAT_ACCOUNT_TERMINATED');
  const unsupported = await resolve(f, 'requester-b-token', { type: 'requester_requester' });
  assert.equal(unsupported.statusCode, 400);
  assert.equal(unsupported.body.error.reason, 'CHAT_TYPE_UNSUPPORTED');
});

test('Requester-to-Requester resolution is denied with no order and even when both accounts share a branch context', async () => {
  const f = fixture();
  const noOrder = await resolve(f, 'requester-a-token', { type: 'requester_requester', targetUid: 'requester-b' });
  assert.equal(noOrder.statusCode, 400);
  assert.equal(noOrder.body.error.reason, 'CHAT_TYPE_UNSUPPORTED');

  const forgedInquiry = await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'inquiry', branchId: 'branch-a', targetUid: 'requester-b' });
  assert.equal(forgedInquiry.statusCode, 400);
  assert.equal(forgedInquiry.body.error.reason, 'CHAT_REQUEST_FIELDS_INVALID');

  f.records.set('requests/order-a', {
    ...f.records.get('requests/order-a'),
    assignedDistributorUid: 'requester-b',
    currentBranchId: 'branch-a',
    branchId: 'branch-a',
  });
  const sameBranch = await resolve(f, 'requester-a-token', { type: 'requester_distributor', orderId: 'order-a' });
  assert.equal(sameBranch.statusCode, 403);
  assert.equal(sameBranch.body.error.reason, 'CHAT_NOT_AUTHORIZED');
});

test('Requester chat resolution allows an eligible Branch and assigned Distributor but denies an unrelated Distributor', async () => {
  const f = fixture();
  assert.equal((await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'inquiry', branchId: 'branch-a' })).statusCode, 201);
  assert.equal((await resolve(f, 'requester-a-token', { type: 'requester_distributor', orderId: 'order-a' })).statusCode, 201);
  const unrelatedDistributor = await resolve(f, 'distributor-b-token', { type: 'requester_distributor', orderId: 'order-a' });
  assert.equal(unrelatedDistributor.statusCode, 403);
  assert.equal(unrelatedDistributor.body.error.reason, 'CHAT_NOT_AUTHORIZED');
  f.records.set('requests/order-a', { ...f.records.get('requests/order-a'), assignedDistributorUid: null, distributor_id: '' });
  const noAssignment = await resolve(f, 'requester-a-token', { type: 'requester_distributor', orderId: 'order-a' });
  assert.equal(noAssignment.statusCode, 403);
  assert.equal(noAssignment.body.error.reason, 'CHAT_NOT_AUTHORIZED');
});

test('Distributor and Requester open canonical conversation by orderId or public requestId', async () => {
  const f = fixture();
  // 1. Requester opens requester_distributor conversation
  const requesterRes = await resolve(f, 'requester-a-token', { type: 'requester_distributor', orderId: 'order-a' });
  assert.equal(requesterRes.statusCode, 201);
  assert.equal(requesterRes.body.created, true);
  const conversationId = requesterRes.body.conversation.id;

  // 2. Distributor opens same conversation using public requestId
  const distributorRes = await resolve(f, 'distributor-a-token', { type: 'requester_distributor', orderId: 'BT-2026-8B4B75BE' });
  assert.equal(distributorRes.statusCode, 200);

  // 3. Both resolve SAME conversation ID
  assert.equal(distributorRes.body.conversation.id, conversationId);

  // 4. Existing conversation reused
  assert.equal(distributorRes.body.created, false);

  // 5. Repeated open is idempotent
  const repeatDistributor = await resolve(f, 'distributor-a-token', { type: 'requester_distributor', orderId: 'BT-2026-8B4B75BE' });
  assert.equal(repeatDistributor.statusCode, 200);
  assert.equal(repeatDistributor.body.conversation.id, conversationId);

  // 6. Distributor cannot open arbitrary Requester order (not assigned to them)
  const unassigned = await resolve(f, 'distributor-a-token', { type: 'requester_distributor', orderId: 'order-b' });
  assert.equal(unassigned.statusCode, 403);
  assert.equal(unassigned.body.error.reason, 'CHAT_NOT_AUTHORIZED');

  // 7. Former/replaced assignment cannot open or write
  f.records.set('requests/order-a', { ...f.records.get('requests/order-a'), assignedDistributorUid: 'distributor-b', assignmentVersion: 5 });
  const replaced = await resolve(f, 'distributor-a-token', { type: 'requester_distributor', orderId: 'BT-2026-8B4B75BE' });
  assert.equal(replaced.statusCode, 403);
  assert.equal(replaced.body.error.reason, 'CHAT_NOT_AUTHORIZED');

  // 8. Cross-branch invalid relationship denied
  f.records.set('users/distributor-b', { ...f.records.get('users/distributor-b'), branchId: 'branch-b' });
  const crossBranch = await resolve(f, 'distributor-b-token', { type: 'requester_distributor', orderId: 'BT-2026-8B4B75BE' });
  assert.equal(crossBranch.statusCode, 403);

  // 9. distributor_branch still works
  const branchConv = await resolve(f, 'distributor-a-token', { type: 'distributor_branch' });
  assert.equal(branchConv.statusCode, 201);
  assert.equal(branchConv.body.conversation.type, 'distributor_branch');

  // 10. Route does not return 404 for valid current assignment
  assert.notEqual(distributorRes.statusCode, 404);
});

test('malformed legacy conversations with an extra Requester are denied and omitted from normal discovery', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  const malformed = f.records.get(`chatConversations/${conversationId}`);
  f.records.set(`chatConversations/${conversationId}`, {
    ...malformed,
    participantUserUids: [...malformed.participantUserUids, 'requester-b'],
    participantState: [...malformed.participantState, {
      principalType: 'user', principalId: 'requester-b', accessState: 'active', unreadCount: 0,
    }],
  });

  assert.equal((await call(f.conversations, 'GET', 'requester-a-token')).body.conversations.length, 0);
  assert.equal((await call(f.conversations, 'GET', 'requester-b-token')).body.conversations.length, 0);
  assert.equal((await resolve(f, 'requester-a-token', { type: 'requester_distributor', orderId: 'order-a' })).body.error.reason, 'CHAT_STATE_INVALID');
  const deniedSend = await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'malformed-send', body: 'blocked' });
  assert.equal(deniedSend.statusCode, 403);
  assert.equal(deniedSend.body.error.reason, 'CHAT_STATE_INVALID');
});

test('authorized sends allocate immutable sequences and update summary and unread state atomically', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  const first = await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'send-1', body: 'Hello\r\nDistributor' });
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.message.seq, 1);
  assert.equal(first.body.message.body, 'Hello\nDistributor');
  assert.equal(first.body.message.type, 'text');
  assert.equal(first.body.message.retentionHold, false);
  const conversation = f.records.get(`chatConversations/${conversationId}`);
  assert.equal(conversation.nextSequence, 2);
  assert.equal(conversation.lastMessageSeq, 1);
  assert.equal(conversation.lastMessagePreview, 'Hello Distributor');
  assert.equal(conversation.participantState.find((item) => item.principalId === 'requester-a').unreadCount, 0);
  assert.equal(conversation.participantState.find((item) => item.principalId === 'distributor-a').unreadCount, 1);

  const second = await call(f.messages, 'POST', 'distributor-a-token', { conversationId, clientMutationId: 'send-2', body: 'On the way' });
  assert.equal(second.body.message.seq, 2);
  assert.equal(second.body.message.senderUid, 'distributor-a');
  assert.equal(second.body.message.senderBranchId, 'branch-a');
  assert.equal(f.records.get(`chatConversations/${conversationId}`).lastMessageSeq, 2);
});

test('message validation rejects empty, oversized, spoofed, read-only, and closed sends', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  assert.equal((await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'empty', body: '  ' })).body.error.reason, 'CHAT_MESSAGE_REQUIRED');
  assert.equal((await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'long', body: 'x'.repeat(2001) })).body.error.reason, 'CHAT_MESSAGE_TOO_LONG');
  assert.equal((await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'spoof', body: 'hello', senderUid: 'distributor-a' })).body.error.reason, 'CHAT_SENDER_SERVER_OWNED');
  f.records.set(`chatConversations/${conversationId}`, { ...f.records.get(`chatConversations/${conversationId}`), status: 'read_only' });
  assert.equal((await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'readonly', body: 'hello' })).body.error.reason, 'CHAT_READ_ONLY');
  f.records.set(`chatConversations/${conversationId}`, { ...f.records.get(`chatConversations/${conversationId}`), status: 'closed' });
  assert.equal((await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'closed', body: 'hello' })).body.error.reason, 'CHAT_CLOSED');
});

test('idempotent retry returns the committed message and conflicting reuse is rejected', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  const payload = { conversationId, clientMutationId: 'same-retry', body: 'Exactly once' };
  const first = await call(f.messages, 'POST', 'requester-a-token', payload);
  const retry = await call(f.messages, 'POST', 'requester-a-token', payload);
  assert.equal(first.statusCode, 201);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.message.id, first.body.message.id);
  assert.equal([...f.records.keys()].filter((key) => key.startsWith(`chatConversations/${conversationId}/messages/`)).length, 1);
  assert.equal(f.records.get(`chatConversations/${conversationId}`).lastMessageSeq, 1);
  const conflict = await call(f.messages, 'POST', 'requester-a-token', { ...payload, body: 'Changed' });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.error.reason, 'CHAT_MUTATION_CONFLICT');
  const branchConversation = await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'inquiry', branchId: 'branch-a' });
  const crossConversation = await call(f.messages, 'POST', 'requester-a-token', {
    conversationId: branchConversation.body.conversation.id,
    clientMutationId: payload.clientMutationId,
    body: payload.body,
  });
  assert.equal(crossConversation.statusCode, 409);
  assert.equal(crossConversation.body.error.reason, 'CHAT_MUTATION_CONFLICT');
});

test('message edit and delete are sender-only, idempotent, time-bounded, and preserve revisions', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  const sent = await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'mutation-source', body: 'Original text' });
  const messageId = sent.body.message.id;
  const denied = await call(f.messages, 'PATCH', 'distributor-a-token', { conversationId, messageId, clientMutationId: 'foreign-edit', body: 'Spoofed edit' });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.error.reason, 'CHAT_MESSAGE_MUTATION_DENIED');

  const editBody = { conversationId, messageId, clientMutationId: 'edit-1', body: 'Corrected text' };
  const edited = await call(f.messages, 'PATCH', 'requester-a-token', editBody);
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.body.message.body, 'Corrected text');
  assert.ok(edited.body.message.editedAt);
  assert.equal((await call(f.messages, 'PATCH', 'requester-a-token', editBody)).body.created, false);
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('chatMessageRevisions/')).length, 1);

  f.records.set('chatRestrictions/requester-a', { platform: { scope: 'platform_chat', endsAt: new Date('2026-01-02T00:00:00Z') } });
  assert.equal((await call(f.messages, 'PATCH', 'requester-a-token', { conversationId, messageId, clientMutationId: 'edit-restricted', body: 'Blocked' })).body.error.reason, 'CHAT_PLATFORM_SUSPENDED');
  const deleted = await call(f.messages, 'DELETE', 'requester-a-token', { conversationId, messageId, clientMutationId: 'delete-1' });
  assert.equal(deleted.statusCode, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.message.body, '');
  assert.ok(deleted.body.message.deletedAt);
  assert.equal(deleted.body.message.seq, 1);
  assert.equal(deleted.body.message.senderUid, 'requester-a');
  assert.equal(f.records.get(`chatConversations/${conversationId}`).lastMessagePreview, 'Message deleted');
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('chatMessageRevisions/')).length, 2);
});

test('message mutation expires after 15 minutes and suspended accounts cannot mutate history', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  const sent = await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'expiry-source', body: 'Original' });
  f.advanceTime((15 * 60 * 1000) + 1);
  const expired = await call(f.messages, 'DELETE', 'requester-a-token', { conversationId, messageId: sent.body.message.id, clientMutationId: 'expired-delete' });
  assert.equal(expired.statusCode, 409);
  assert.equal(expired.body.error.reason, 'CHAT_MESSAGE_MUTATION_WINDOW_EXPIRED');
  f.records.get('users/requester-a').accountStatus = 'suspended';
  const suspended = await call(f.messages, 'DELETE', 'requester-a-token', { conversationId, messageId: sent.body.message.id, clientMutationId: 'suspended-delete' });
  assert.equal(suspended.statusCode, 403);
  assert.equal(suspended.body.error.reason, 'CHAT_ACCOUNT_SUSPENDED');
});

test('read cursors advance monotonically with exact unread counts and cannot be spoofed', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'read-1', body: 'one' });
  await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'read-2', body: 'two' });
  const firstRead = await call(f.readState, 'POST', 'distributor-a-token', { conversationId, lastReadSeq: 1 });
  assert.equal(firstRead.statusCode, 200);
  let state = firstRead.body.conversation.participantState.find((item) => item.principalId === 'distributor-a');
  assert.equal(state.lastReadSeq, 1);
  assert.equal(state.unreadCount, 1);
  assert.equal((await call(f.readState, 'POST', 'distributor-a-token', { conversationId, lastReadSeq: 1 })).body.advanced, false);
  assert.equal((await call(f.readState, 'POST', 'distributor-a-token', { conversationId, lastReadSeq: 3 })).body.error.reason, 'CHAT_INVALID_READ_CURSOR');
  assert.equal((await call(f.readState, 'POST', 'distributor-a-token', { conversationId, lastReadSeq: 2, principalId: 'requester-a' })).body.error.reason, 'CHAT_READ_PRINCIPAL_SERVER_OWNED');
  const finalRead = await call(f.readState, 'POST', 'distributor-a-token', { conversationId, lastReadSeq: 2 });
  state = finalRead.body.conversation.participantState.find((item) => item.principalId === 'distributor-a');
  assert.equal(state.unreadCount, 0);
  assert.ok(state.lastReadSeq >= finalRead.body.conversation.lastMessageSeq);
});

test('a current Manager advances the shared branch cursor and another branch cannot', async () => {
  const f = fixture();
  const conversation = await resolve(f, 'distributor-a-token', { type: 'distributor_branch' });
  const conversationId = conversation.body.conversation.id;
  await call(f.messages, 'POST', 'distributor-a-token', { conversationId, clientMutationId: 'branch-read-1', body: 'Branch update' });
  const managerRead = await call(f.readState, 'POST', 'manager-a-token', { conversationId, lastReadSeq: 1 });
  assert.equal(managerRead.statusCode, 200);
  const branchState = managerRead.body.conversation.participantState.find((item) => item.principalType === 'branch');
  assert.equal(branchState.principalId, 'branch-a');
  assert.equal(branchState.lastReadSeq, 1);
  assert.equal((await call(f.readState, 'POST', 'manager-b-token', { conversationId, lastReadSeq: 1 })).statusCode, 403);
});

test('recipient reads publish receipt activity in both direct directions without a reply', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  await call(f.messages, 'POST', 'distributor-a-token', {
    conversationId, clientMutationId: 'reverse-receipt-1', body: 'On the way',
  });
  const before = f.records.get('chatUserActivity/distributor-a').revision;
  const read = await call(f.readState, 'POST', 'requester-a-token', { conversationId, lastReadSeq: 1 });
  assert.equal(read.statusCode, 200);
  const { receiptFor } = require('../../../components/chat/chatModel');
  assert.equal(receiptFor({ seq: 1, senderUid: 'distributor-a' }, read.body.conversation, 'distributor', 'distributor-a'), 'seen');
  assert.notEqual(f.records.get('chatUserActivity/distributor-a').revision, before);
  assert.equal(read.body.conversation.lastMessageSeq, 1);
});

test('Manager opening a Requester-Branch thread publishes a branch read receipt without replying', async () => {
  const f = fixture();
  const resolved = await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'order_followup', orderId: 'order-a' });
  const conversationId = resolved.body.conversation.id;
  await call(f.messages, 'POST', 'requester-a-token', {
    conversationId, clientMutationId: 'branch-receipt-1', body: 'Can I get an update?',
  });
  const before = f.records.get('chatUserActivity/requester-a').revision;
  const read = await call(f.readState, 'POST', 'manager-a-token', { conversationId, lastReadSeq: 1 });
  assert.equal(read.statusCode, 200);
  const { receiptFor } = require('../../../components/chat/chatModel');
  assert.equal(receiptFor({ seq: 1, senderUid: 'requester-a' }, read.body.conversation, 'requester', 'requester-a'), 'seen');
  assert.notEqual(f.records.get('chatUserActivity/requester-a').revision, before);
  assert.equal(read.body.conversation.lastMessageSeq, 1);
});

test('terminal direct-order history requires an explicit bounded read deadline', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'history-1', body: 'before delivery' });
  f.records.set('requests/order-a', { ...f.records.get('requests/order-a'), status: 'delivered' });
  f.records.set(`chatConversations/${conversationId}`, {
    ...f.records.get(`chatConversations/${conversationId}`),
    status: 'read_only',
    readAccessEndsAt: new Date(Date.parse('2026-01-01T00:01:00Z')),
  });
  assert.equal((await call(f.messages, 'GET', 'requester-a-token', {}, `?conversationId=${conversationId}`)).statusCode, 200);
  f.advanceTime(61_000);
  const expired = await call(f.messages, 'GET', 'requester-a-token', {}, `?conversationId=${conversationId}`);
  assert.equal(expired.statusCode, 403);
  assert.equal(expired.body.error.reason, 'CHAT_NOT_AUTHORIZED');
});

test('delivered assignment denies sends immediately while bounded history remains readable', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  const accessEndsAt = new Date(Date.parse('2026-01-08T00:00:00Z'));
  f.records.set('requests/order-a', { ...f.records.get('requests/order-a'), status: 'delivered', deliveredAt: new Date('2026-01-01T00:00:00Z'), chatAccessEndsAt: accessEndsAt });
  f.records.set(`chatConversations/${conversationId}`, {
    ...f.records.get(`chatConversations/${conversationId}`),
    status: 'read_only',
    accessEndsAt,
    readAccessEndsAt: accessEndsAt,
  });
  const denied = await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'followup-1', body: 'Delivery follow-up' });
  assert.equal(denied.statusCode, 409);
  assert.equal(denied.body.error.reason, 'CHAT_READ_ONLY');
  assert.equal((await call(f.messages, 'GET', 'requester-a-token', {}, `?conversationId=${conversationId}`)).statusCode, 200);
  f.setTime(accessEndsAt.getTime());
  const expired = await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'followup-2', body: 'Too late' });
  assert.equal(expired.statusCode, 409);
  assert.equal(expired.body.error.reason, 'CHAT_READ_ONLY');
});

test('failed delivery send authority uses exact trusted server-time grace semantics', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  const failedAt = new Date(Date.parse('2026-01-01T00:00:00Z'));
  const graceUntil = new Date(failedAt.getTime() + (60 * 60 * 1000));
  f.records.set('requests/order-a', {
    ...f.records.get('requests/order-a'),
    status: 'delivery_failed',
    deliveryFailedAt: failedAt,
    distributorChatGraceUntil: graceUntil,
  });
  f.records.set(`chatConversations/${conversationId}`, {
    ...f.records.get(`chatConversations/${conversationId}`),
    status: 'active',
    accessEndsAt: graceUntil,
    readAccessEndsAt: graceUntil,
  });

  f.setTime(failedAt.getTime() + (30 * 60 * 1000));
  assert.equal((await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'failed-30', body: 'Address clarification' })).statusCode, 201);
  f.setTime(graceUntil.getTime() - 1000);
  assert.equal((await call(f.messages, 'POST', 'distributor-a-token', { conversationId, clientMutationId: 'failed-59', body: 'I am nearby' })).statusCode, 201);
  f.setTime(graceUntil.getTime());
  const atDeadline = await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'failed-60', body: 'Too late' });
  assert.equal(atDeadline.statusCode, 409);
  assert.equal(atDeadline.body.error.reason, 'CHAT_READ_ONLY');
  f.setTime(graceUntil.getTime() + 1);
  assert.equal((await call(f.messages, 'POST', 'distributor-a-token', { conversationId, clientMutationId: 'failed-after', body: 'Still too late' })).body.error.reason, 'CHAT_READ_ONLY');

  const forged = await resolve(f, 'requester-a-token', { type: 'requester_distributor', orderId: 'order-a', distributorChatGraceUntil: new Date('2099-01-01T00:00:00Z') });
  assert.equal(forged.statusCode, 400);
  assert.equal(forged.body.error.reason, 'CHAT_REQUEST_FIELDS_INVALID');
});

test('message history is newest-first and bounded by sequence pagination', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'page-1', body: 'one' });
  await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'page-2', body: 'two' });
  await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'page-3', body: 'three' });
  const newest = await call(f.messages, 'GET', 'distributor-a-token', {}, `?conversationId=${conversationId}&limit=2`);
  assert.deepEqual(newest.body.messages.map((message) => message.seq), [3, 2]);
  assert.equal(newest.body.nextBeforeSeq, 2);
  const older = await call(f.messages, 'GET', 'distributor-a-token', {}, `?conversationId=${conversationId}&limit=2&beforeSeq=2`);
  assert.deepEqual(older.body.messages.map((message) => message.seq), [1]);
  assert.equal((await call(f.messages, 'GET', 'distributor-a-token', {}, `?conversationId=${conversationId}&limit=51`)).body.error.reason, 'CHAT_PAGE_SIZE_INVALID');
});

test('persistent rate limits are isolated by user and idempotent retries do not consume quota', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  let firstPayload;
  for (let index = 0; index < 5; index += 1) {
    const payload = { conversationId, clientMutationId: `burst-${index}`, body: `message ${index}` };
    if (index === 0) firstPayload = payload;
    assert.equal((await call(f.messages, 'POST', 'requester-a-token', payload)).statusCode, 201);
  }
  const limited = await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'burst-6', body: 'blocked' });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.body.error.reason, 'CHAT_RATE_LIMITED');
  assert.equal(typeof limited.body.error.retryAfterSeconds, 'number');
  assert.equal((await call(f.messages, 'POST', 'requester-a-token', firstPayload)).statusCode, 200);
  assert.equal((await call(f.messages, 'POST', 'distributor-a-token', { conversationId, clientMutationId: 'other-user', body: 'isolated' })).statusCode, 201);
});

test('authorized Requester and Distributor reports derive the opposite epoch-bound participant server-side', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  const incoming = await call(f.messages, 'POST', 'distributor-a-token', {
    conversationId, clientMutationId: 'reportable-message', body: 'Reportable delivery message',
  });
  const submitted = await call(f.reports, 'POST', 'requester-a-token', {
    conversationId,
    messageId: incoming.body.message.id,
    category: 'DELIVERY_MISCONDUCT',
    details: 'Unsafe delivery conduct',
  });
  assert.equal(submitted.statusCode, 201);
  assert.equal(submitted.body.status, 'Submitted');
  const stored = f.records.get(`chatReports/${submitted.body.reportId}`);
  assert.equal(stored.reporterUid, 'requester-a');
  assert.equal(stored.reportedUid, 'distributor-a');
  assert.equal(stored.jurisdictionBranchId, 'branch-a');
  assert.equal(stored.categoryLabel, 'Delivery misconduct');
  assert.equal(stored.evidenceSnapshot.length, 1);
  assert.equal(stored.evidenceSnapshot[0].body, 'Reportable delivery message');
  assert.equal('deliveryLocation' in stored.evidenceSnapshot[0], false);

  const forged = await call(f.reports, 'POST', 'requester-a-token', {
    conversationId, category: 'SPAM', reportedUid: 'distributor-b',
  });
  assert.equal(forged.statusCode, 400);
  assert.equal(forged.body.error.reason, 'REPORT_AUTHORITY_SERVER_OWNED');
  assert.equal((await call(f.reports, 'POST', 'requester-b-token', { conversationId, category: 'SPAM' })).statusCode, 403);
});

test('report evidence is immutable, centered on the selected incoming message, and never exceeds five messages', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  const sent = [];
  for (let index = 1; index <= 7; index += 1) {
    const token = index % 2 === 0 ? 'distributor-a-token' : 'requester-a-token';
    const result = await call(f.messages, 'POST', token, {
      conversationId, clientMutationId: `evidence-${index}`, body: `message ${index}`,
    });
    sent.push(result.body.message);
  }
  const submitted = await call(f.reports, 'POST', 'requester-a-token', {
    conversationId, messageId: sent[3].id, category: 'HARASSMENT_INAPPROPRIATE',
  });
  assert.equal(submitted.statusCode, 201);
  const stored = f.records.get(`chatReports/${submitted.body.reportId}`);
  assert.deepEqual(stored.evidenceSnapshot.map((message) => message.seq), [2, 3, 4, 5, 6]);
  assert.equal(stored.evidenceSnapshot.length, 5);
  const evidenceBody = stored.evidenceSnapshot.find((message) => message.messageId === sent[3].id).body;
  const deleted = await call(f.messages, 'DELETE', 'distributor-a-token', { conversationId, messageId: sent[3].id, clientMutationId: 'delete-after-report' });
  assert.equal(deleted.statusCode, 200, JSON.stringify(deleted.body));
  assert.equal(f.records.get(`chatReports/${submitted.body.reportId}`).evidenceSnapshot.find((message) => message.messageId === sent[3].id).body, evidenceBody);
  for (const evidence of stored.evidenceSnapshot) {
    const source = f.records.get(`chatConversations/${conversationId}/messages/${evidence.messageId}`);
    assert.equal(source.retentionHold, true);
    assert.deepEqual(source.retentionHoldReportIds, [submitted.body.reportId]);
  }
  f.records.get(`chatConversations/${conversationId}/messages/${sent[3].id}`).body = 'source changed later';
  assert.equal(stored.evidenceSnapshot[2].body, 'message 4');
});

test('report validation, duplicate protection, and persistent hourly rate limiting fail closed', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  assert.equal((await call(f.reports, 'POST', 'requester-a-token', { conversationId, category: 'NOT_REAL' })).body.error.reason, 'REPORT_CATEGORY_INVALID');
  assert.equal((await call(f.reports, 'POST', 'requester-a-token', { conversationId, category: 'OTHER' })).body.error.reason, 'DETAILS_REQUIRED');
  assert.equal((await call(f.reports, 'POST', 'requester-a-token', { conversationId, category: 'OTHER', details: 'x'.repeat(1001) })).body.error.reason, 'REPORT_DETAILS_TOO_LONG');

  const first = await call(f.reports, 'POST', 'requester-a-token', { conversationId, category: 'SPAM' });
  const duplicate = await call(f.reports, 'POST', 'requester-a-token', { conversationId, category: 'SPAM' });
  assert.equal(first.statusCode, 201);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.body.reportId, first.body.reportId);
  assert.equal(duplicate.body.duplicate, true);

  for (const category of ['FRAUD_SCAM', 'DELIVERY_MISCONDUCT', 'ORDER_ABUSE', 'THREAT_SAFETY']) {
    assert.equal((await call(f.reports, 'POST', 'requester-a-token', { conversationId, category })).statusCode, 201);
  }
  const limited = await call(f.reports, 'POST', 'requester-a-token', {
    conversationId, category: 'HARASSMENT_INAPPROPRIATE',
  });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.body.error.reason, 'REPORT_RATE_LIMITED');
});

test('Manager can report Requester or Distributor within own branch conversations, but cross-branch and privileged reports fail closed', async () => {
  const f = fixture();
  const reqBranchConv = await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'order_followup', orderId: 'order-a' });
  const reqBranchId = reqBranchConv.body.conversation.id;

  const msg = await call(f.messages, 'POST', 'requester-a-token', {
    conversationId: reqBranchId, clientMutationId: 'req-msg-1', body: 'Message from requester to branch',
  });
  assert.equal(msg.statusCode, 201);

  const managerReportReq = await call(f.reports, 'POST', 'manager-a-token', {
    conversationId: reqBranchId,
    messageId: msg.body.message.id,
    category: 'SPAM',
  });
  assert.equal(managerReportReq.statusCode, 201);
  assert.equal(f.records.get(`chatReports/${managerReportReq.body.reportId}`).reportedUid, 'requester-a');
  assert.equal(f.records.get(`chatReports/${managerReportReq.body.reportId}`).reporterUid, 'manager-a');
  assert.equal(f.records.get(`chatReports/${managerReportReq.body.reportId}`).jurisdictionBranchId, 'branch-a');

  const crossBranchReport = await call(f.reports, 'POST', 'manager-b-token', {
    conversationId: reqBranchId,
    category: 'SPAM',
  });
  assert.equal(crossBranchReport.statusCode, 403);
});

test('Manager can resolve and open requester_branch order followup for their branch order, but not for another branch order', async () => {
  const f = fixture();
  // Manager A resolving order-a (which belongs to branch-a)
  const managerAOrderA = await resolve(f, 'manager-a-token', { type: 'requester_branch', intent: 'order_followup', orderId: 'order-a' });
  assert.equal(managerAOrderA.statusCode, 201);
  assert.equal(managerAOrderA.body.conversation.type, 'requester_branch');
  assert.equal(managerAOrderA.body.conversation.requesterUid, 'requester-a');
  assert.deepEqual(managerAOrderA.body.conversation.branchIds, ['branch-a']);

  // Requester A resolving same order gets the exact same canonical conversation (200 OK)
  const reqAOrderA = await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'order_followup', orderId: 'order-a' });
  assert.equal(reqAOrderA.statusCode, 200);
  assert.equal(reqAOrderA.body.conversation.id, managerAOrderA.body.conversation.id);

  // Manager B (branch-b) trying to resolve order-a (branch-a) fails closed
  const managerBOrderA = await resolve(f, 'manager-b-token', { type: 'requester_branch', intent: 'order_followup', orderId: 'order-a' });
  assert.equal(managerBOrderA.statusCode, 403);
  assert.equal(managerBOrderA.body.error.reason, 'CHAT_NOT_AUTHORIZED');
});
