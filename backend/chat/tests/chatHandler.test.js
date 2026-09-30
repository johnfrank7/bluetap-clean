const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createChatConversationsHandler,
  createChatMessagesHandler,
  createChatReadStateHandler,
} = require('../chatHandler');

const clone = (value) => value === undefined ? undefined : structuredClone(value);

function fixture() {
  const records = new Map(Object.entries({
    'users/requester-a': { role: 'requester', accountStatus: 'active', publicUid: 'Req001' },
    'users/requester-b': { role: 'requester', accountStatus: 'active', publicUid: 'Req002' },
    'users/distributor-a': { role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch-a', branchMembershipVersion: 3, publicUid: 'Dis001' },
    'users/distributor-b': { role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch-a', branchMembershipVersion: 2, publicUid: 'Dis002' },
    'users/manager-a': { role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId: 'branch-a', publicUid: 'Man001' },
    'users/manager-b': { role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId: 'branch-b', publicUid: 'Man002' },
    'users/manager-c': { role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId: 'branch-c', publicUid: 'Man003' },
    'branches/branch-a': { name: 'A', status: 'active' },
    'branches/branch-b': { name: 'B', status: 'active' },
    'branches/branch-c': { name: 'C', status: 'active' },
    'requests/order-a': { requester_id: 'requester-a', currentBranchId: 'branch-a', branchId: 'branch-a', assignedDistributorUid: 'distributor-a', assignmentVersion: 4, status: 'distributor_assigned' },
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
      docs = docs.filter(({ data }) => operator === 'array-contains' ? data?.[field]?.includes(expected) : operator === '==' ? data?.[field] === expected : operator === '<' ? data?.[field] < expected : false);
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
        set(ref, data) { working.set(ref.path, clone(data)); },
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
  const dependencies = {
    now: () => new Date(currentTime),
    createConversationId: () => `opaque-conversation-${++conversationCounter}`,
    createMessageId: () => `opaque-message-${++messageCounter}`,
  };
  const getAdmin = () => ({ auth, db });
  return {
    records, db, getAdmin, dependencies,
    conversations: createChatConversationsHandler(getAdmin, dependencies),
    messages: createChatMessagesHandler(getAdmin, dependencies),
    readState: createChatReadStateHandler(getAdmin, dependencies),
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
  const read = await call(f.readState, 'POST', 'distributor-a-token', { conversationId: id, lastReadSeq: 1 });
  assert.equal(read.statusCode, 200);
  assert.equal(read.body.conversation.participantState.find((state) => state.principalId === 'distributor-a').unreadCount, 0);
  const { receiptFor } = require('../../../components/chat/chatModel');
  assert.equal(receiptFor({ seq: 1, senderUid: 'requester-a' }, read.body.conversation, 'requester', 'requester-a'), 'seen');
  f.records.get('requests/order-a').assignmentVersion++;
  assert.equal((await call(f.conversations, 'GET', 'distributor-a-token')).body.conversations.length, 0);
});

test('Manager cold summaries and pinned Distributor resolution enforce own active branch and membership', async () => {
  const f = fixture();
  const followup = await resolve(f, 'requester-a-token', { type: 'requester_branch', intent: 'order_followup', orderId: 'order-a' });
  assert.equal((await call(f.conversations, 'GET', 'manager-a-token')).body.conversations[0].id, followup.body.conversation.id);
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

  const sent = await call(f.messages, 'POST', 'requester-a-token', {
    conversationId: followup.body.conversation.id,
    clientMutationId: 'active-followup-send',
    body: 'Please check my active request.',
    orderId: 'order-a',
  });
  assert.equal(sent.statusCode, 201);
  assert.equal(sent.body.message.body, 'Please check my active request.');
});

test('a delivered assignment can resolve on demand only during its trusted follow-up window', async () => {
  const f = fixture();
  const accessEndsAt = new Date('2026-01-08T00:00:00Z');
  f.records.set('requests/order-a', { ...f.records.get('requests/order-a'), status: 'delivered', deliveredAt: new Date('2026-01-01T00:00:00Z'), chatAccessEndsAt: accessEndsAt });
  const active = await resolve(f, 'requester-a-token', { type: 'requester_distributor', orderId: 'order-a' });
  assert.equal(active.statusCode, 201);
  assert.equal(active.body.conversation.accessEndsAt.getTime(), accessEndsAt.getTime());
  f.setTime(accessEndsAt.getTime());
  const expired = await resolve(f, 'requester-a-token', { type: 'requester_distributor', orderId: 'order-a' });
  assert.equal(expired.statusCode, 403);
  assert.equal(expired.body.error.reason, 'CHAT_ASSIGNMENT_NOT_WRITABLE');
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

test('delivered assignment remains writable only until the trusted seven-day deadline', async () => {
  const f = fixture();
  const conversationId = await directConversation(f);
  const accessEndsAt = new Date(Date.parse('2026-01-08T00:00:00Z'));
  f.records.set('requests/order-a', { ...f.records.get('requests/order-a'), status: 'delivered', deliveredAt: new Date('2026-01-01T00:00:00Z'), chatAccessEndsAt: accessEndsAt });
  f.records.set(`chatConversations/${conversationId}`, {
    ...f.records.get(`chatConversations/${conversationId}`),
    status: 'active',
    accessEndsAt,
    readAccessEndsAt: accessEndsAt,
  });
  const beforeExpiry = await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'followup-1', body: 'Delivery follow-up' });
  assert.equal(beforeExpiry.statusCode, 201);
  f.setTime(accessEndsAt.getTime());
  const expired = await call(f.messages, 'POST', 'requester-a-token', { conversationId, clientMutationId: 'followup-2', body: 'Too late' });
  assert.equal(expired.statusCode, 409);
  assert.equal(expired.body.error.reason, 'CHAT_READ_ONLY');
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
