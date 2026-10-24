const assert = require('node:assert/strict');
const test = require('node:test');
const { attemptIdFor } = require('../../delivery/deliveryAttemptService');
const { createManagerDeliveryReviewsHandler } = require('../deliveryReviewsHandler');
const { routes } = require('../../routes');

const receivedAt = new Date('2026-10-20T12:00:00.000Z');
const beforeDeadline = () => new Date('2026-10-21T12:00:00.000Z');
const afterDeadline = () => new Date('2026-10-23T12:00:01.000Z');

function fixture(now = beforeDeadline) {
  const records = new Map([
    ['users/m1', { role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: 'b1' }],
    ['users/m2', { role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: 'b2' }],
    ['users/inactive', { role: 'manager', managerStatus: 'inactive', accountStatus: 'active', branchId: 'b1' }],
    ['users/forged', { role: 'requester', managerStatus: 'active', accountStatus: 'active', branchId: 'b1' }],
    ['users/d1', { role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: 'b1' }],
    ['branches/b1', { status: 'active', name: 'Original branch' }],
    ['branches/b2', { status: 'active', name: 'New branch' }],
    ['requests/old-order', { requesterUid: 'r1', requester_id: 'r1', requestId: 'Req-101',
      branchId: 'b2', currentBranchId: 'b2', status: 'delivered' }],
    ['requests/other-order', { requesterUid: 'r2', requester_id: 'r2', requestId: 'Req-202', branchId: 'b2' }],
  ]);
  const updateTimes = new Map();
  const readPaths = [];
  const queryShapes = [];
  const ids = {};
  function addAttempt(orderId, number, overrides = {}) {
    const id = attemptIdFor(orderId, number);
    records.set(`deliveryAttempts/${id}`, {
      orderId, attemptNumber: number, requesterUid: orderId === 'other-order' ? 'r2' : 'r1',
      distributorUid: 'd1', branchId: orderId === 'other-order' ? 'b2' : 'b1',
      outcome: 'failed', reviewState: 'reported', responsibility: 'undetermined',
      endedAt: receivedAt, reportReceivedAt: receivedAt, reportedReasonCode: 'NO_RESPONSE',
      reportedReasonNote: null, reportFormat: 'structured-v1',
      reportEvidence: { contactAttempts: [{ method: 'PHONE_CALL', outcome: 'NO_ANSWER', claimedAt: receivedAt.toISOString() }] },
      outcomeMutationId: 'private_muation_id', privateModeration: { score: 100 },
      ...overrides,
    });
    updateTimes.set(`deliveryAttempts/${id}`, { seconds: 1792500000 + number, nanoseconds: 100 });
    return id;
  }
  ids.first = addAttempt('old-order', 1);
  ids.second = addAttempt('old-order', 2, {
    requesterResponse: { status: 'submitted', requesterUid: 'r1',
      explanation: 'I was present at the address and received no phone call.',
      submittedAt: new Date('2026-10-21T01:00:00.000Z'), clientMutationId: 'private_response_id' },
  });
  ids.other = addAttempt('other-order', 1);

  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path),
    data: () => records.get(path), updateTime: updateTimes.get(path) });
  const makeQuery = (name, filters = [], orders = [], max = 0, position = '') => ({
    where(field, op, value) { assert.equal(op, '=='); return makeQuery(name, [...filters, [field, value]], orders, max, position); },
    orderBy(field, direction) { return makeQuery(name, filters, [...orders, [field, direction]], max, position); },
    limit(value) { assert.ok(value >= 2 && value <= 26); return makeQuery(name, filters, orders, value, position); },
    startAfter(doc) { return makeQuery(name, filters, orders, max, doc.id); },
    async get() {
      assert.equal(name, 'deliveryAttempts');
      assert.equal(orders.length, 2);
      assert.equal(orders[0][0], 'endedAt');
      assert.equal(orders[0][1], 'desc');
      assert.equal(orders[1][1], 'desc');
      queryShapes.push({ filters, max, position });
      const docs = [...records.keys()].filter((path) => path.startsWith(`${name}/`))
        .filter((path) => filters.every(([field, value]) => records.get(path)[field] === value))
        .map(snapshot).sort((a, b) => b.data().endedAt - a.data().endedAt || b.id.localeCompare(a.id));
      const start = position ? docs.findIndex((doc) => doc.id === position) + 1 : 0;
      return { docs: docs.slice(start, start + max) };
    },
  });
  const db = { collection(name) { return {
    doc(id) { const path = `${name}/${id}`; return { id, get: async () => { readPaths.push(path); return snapshot(path); } }; },
    ...makeQuery(name),
  }; }, runTransaction() { throw new Error('Read API must not start a transaction.'); } };
  const identities = {
    m1: { uid: 'm1', role: 'manager' }, m2: { uid: 'm2', role: 'manager' },
    inactive: { uid: 'inactive', role: 'manager' }, forged: { uid: 'forged', role: 'manager' },
    d1: { uid: 'd1', role: 'manager' }, requester: { uid: 'r1', role: 'requester' },
  };
  const auth = { async verifyIdToken(token, checkRevoked) {
    assert.equal(checkRevoked, true);
    if (!identities[token]) throw new Error('invalid token');
    return identities[token];
  }, async getUser() { return { disabled: false }; } };
  const handler = createManagerDeliveryReviewsHandler(() => ({ auth, db }), now);
  async function call(url = '/api/manager/delivery-reviews', token = 'm1', method = 'GET') {
    const res = { statusCode: 200, body: null, headers: {}, setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
    await handler({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {} }, res);
    return res;
  }
  return { records, updateTimes, readPaths, queryShapes, ids, addAttempt, call };
}

test('route is registered, original branch can read transferred historical attempts, and detail is sanitized', async () => {
  assert.ok(routes.has('/api/manager/delivery-reviews'));
  const f = fixture();
  const list = await f.call();
  assert.equal(list.statusCode, 200, JSON.stringify(list.body));
  assert.equal(list.body.reviews.length, 2);
  assert.equal(list.body.reviews[0].orderReference, 'Req-101');
  assert.ok(f.queryShapes[0].filters.some(([field, value]) => field === 'branchId' && value === 'b1'));
  assert.ok(f.queryShapes[0].filters.some(([field, value]) => field === 'reviewState' && value === 'reported'));
  const detail = await f.call(`/api/manager/delivery-reviews?attemptId=${f.ids.first}`);
  assert.equal(detail.statusCode, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.review.attemptId, f.ids.first);
  assert.equal(detail.body.review.reportingBranchId, 'b1');
  assert.equal(detail.body.review.orderId, 'old-order');
  assert.equal(detail.body.review.contactAttempts[0].claimedAtUnverified, true);
  assert.equal(detail.body.review.contactAttempts[0].method, 'Phone call');
  assert.equal(detail.body.review.responseDeadlineAt, '2026-10-23T12:00:00.000Z');
  assert.equal(detail.body.review.canFinalizeNow, false);
  assert.match(detail.body.review.revision, /^[A-Za-z0-9_-]{43}$/);
  for (const secret of ['private_muation_id', 'private_response_id', 'privateModeration']) {
    assert.ok(!JSON.stringify(detail.body).includes(secret), `Unexpected private value: ${secret}`);
  }
  assert.equal(Object.hasOwn(detail.body.review, 'distributorUid'), false);
  assert.equal(Object.hasOwn(detail.body.review, 'requesterUid'), false);
  assert.equal((await f.call(`/api/manager/delivery-reviews?attemptId=${f.ids.second}`)).body.review.canFinalizeNow, true);
  assert.equal((await f.call(`/api/manager/delivery-reviews?attemptId=${f.ids.first}`, 'm2')).statusCode, 404);
  assert.equal((await f.call(`/api/manager/delivery-reviews?attemptId=${f.ids.other}`)).statusCode, 404);
  assert.equal((await f.call(`/api/manager/delivery-reviews?attemptId=${f.ids.first}`, 'd1')).statusCode, 404);
});

test('active Manager authorization precedes query parsing and rejects forged roles, inactive accounts, and branch parameters', async () => {
  const f = fixture();
  assert.equal((await f.call('/api/manager/delivery-reviews', '')).statusCode, 401);
  assert.equal((await f.call('/api/manager/delivery-reviews', 'requester')).statusCode, 403);
  assert.equal((await f.call('/api/manager/delivery-reviews', 'forged')).statusCode, 403);
  assert.equal((await f.call('/api/manager/delivery-reviews', 'inactive')).statusCode, 403);
  assert.equal((await f.call('/api/manager/delivery-reviews?branchId=b2')).statusCode, 400);
  assert.equal((await f.call(`/api/manager/delivery-reviews?attemptId=${f.ids.first}&branchId=b1`)).statusCode, 400);
  assert.equal((await f.call('/api/manager/delivery-reviews?state=resolved')).statusCode, 400);
  assert.equal((await f.call('/api/manager/delivery-reviews', 'm1', 'PATCH')).statusCode, 405);
  assert.equal((await f.call('/api/manager/delivery-reviews', 'm1', 'POST')).statusCode, 400);
  assert.equal(f.queryShapes.length, 0);
});

test('historical records with missing or conflicting canonical ownership and malformed attempts fail closed', async () => {
  const f = fixture();
  assert.equal((await f.call('/api/manager/delivery-reviews?attemptId=short')).statusCode, 400);
  f.records.delete('requests/old-order');
  assert.equal((await f.call(`/api/manager/delivery-reviews?attemptId=${f.ids.first}`)).statusCode, 404);
  assert.deepEqual((await f.call()).body.reviews, []);
  f.records.set('requests/old-order', { requesterUid: 'r1', requester_id: 'other', requestId: 'Req-101' });
  assert.equal((await f.call(`/api/manager/delivery-reviews?attemptId=${f.ids.first}`)).statusCode, 404);
  f.records.set('requests/old-order', { requesterUid: 'r1', requester_id: 'r1', requestId: 'Req-101' });
  f.records.get(`deliveryAttempts/${f.ids.first}`).attemptNumber = 8;
  assert.equal((await f.call(`/api/manager/delivery-reviews?attemptId=${f.ids.first}`)).statusCode, 404);
  f.records.get(`deliveryAttempts/${f.ids.second}`).reportEvidence = { contactAttempts: [{ method: 'SECRET', outcome: 'NO_ANSWER' }] };
  assert.equal((await f.call(`/api/manager/delivery-reviews?attemptId=${f.ids.second}`)).statusCode, 404);
  assert.deepEqual((await f.call()).body.reviews, []);
});

test('bounded pagination advances past invalid candidates and never repeats an incoming cursor', async () => {
  const f = fixture();
  const malformedId = f.addAttempt('old-order', 3, { requesterUid: 'wrong', endedAt: new Date('2026-10-22T12:00:00.000Z') });
  const first = await f.call('/api/manager/delivery-reviews?limit=1');
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body.reviews, []);
  assert.equal(first.body.nextCursor, malformedId);
  const second = await f.call(`/api/manager/delivery-reviews?limit=1&cursor=${first.body.nextCursor}`);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.reviews.length, 1);
  assert.notEqual(second.body.nextCursor, first.body.nextCursor);
  const third = await f.call(`/api/manager/delivery-reviews?limit=1&cursor=${second.body.nextCursor}`);
  assert.equal(third.body.reviews.length, 1);
  assert.equal(third.body.nextCursor, null);
  assert.equal((await f.call(`/api/manager/delivery-reviews?cursor=${f.ids.other}`)).statusCode, 400);
  assert.equal((await f.call('/api/manager/delivery-reviews?cursor=bad')).statusCode, 400);
  for (const limit of ['0', '26', '2.5', '-1']) {
    assert.equal((await f.call(`/api/manager/delivery-reviews?limit=${limit}`)).statusCode, 400);
  }
  assert.equal((await f.call('/api/manager/delivery-reviews?limit=25')).statusCode, 200);
  assert.ok(f.queryShapes.every(({ max }) => max <= 26));
});

test('the response deadline is projected only from server receipt and reads leave records unchanged', async () => {
  const f = fixture(afterDeadline);
  const before = JSON.stringify([...f.records]);
  const detail = await f.call(`/api/manager/delivery-reviews?attemptId=${f.ids.first}`);
  assert.equal(detail.body.review.canFinalizeNow, true);
  f.records.get(`deliveryAttempts/${f.ids.first}`).reportReceivedAt = null;
  assert.equal((await f.call(`/api/manager/delivery-reviews?attemptId=${f.ids.first}`)).statusCode, 404);
  f.records.get(`deliveryAttempts/${f.ids.first}`).reportReceivedAt = receivedAt;
  assert.equal(JSON.stringify([...f.records]), before);
  assert.ok(f.readPaths.includes('requests/old-order'));
});
