const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { attemptIdFor } = require('../../delivery/deliveryAttemptService');
const { createRequesterDeliveryReportsHandler } = require('../deliveryReportsHandler');
const { routes } = require('../../routes');

const date = (day) => new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`);

function fixture() {
  const records = new Map([
    ['users/r1', { role: 'requester', accountStatus: 'active' }],
    ['users/r2', { role: 'requester', accountStatus: 'active' }],
    ['users/m1', { role: 'manager', accountStatus: 'active' }],
    ['users/d1', { role: 'distributor', accountStatus: 'active' }],
    ['users/a1', { role: 'admin', accountStatus: 'active' }],
    ['users/inactive', { role: 'requester', accountStatus: 'inactive' }],
    ['requests/order-one', { requesterUid: 'r1', requester_id: 'r1', status: 'scheduled', deliveryAttemptSeq: 3 }],
    ['requests/order-two', { requesterUid: 'r2', requester_id: 'r2', status: 'delivery_failed' }],
    ['requests/old-order', { requester_id: 'r1', status: 'delivery_failed', failureReasonNote: 'private legacy note' }],
  ]);
  const addAttempt = (orderId, requesterUid, number, overrides = {}) => {
    const id = attemptIdFor(orderId, number);
    records.set(`deliveryAttempts/${id}`, {
      orderId, requesterUid, attemptNumber: number, outcome: 'failed', reviewState: 'reported',
      endedAt: date(20 + number), reportReceivedAt: date(20 + number),
      reportedReasonCode: 'NO_RESPONSE', reportedReasonLabel: 'private server label',
      reportedReasonNote: 'raw private failure note', distributorUid: 'private-staff',
      assignmentVersion: 12, outcomeMutationId: 'private-mutation',
      moderationIncident: { score: 99 },
      reportFormat: 'structured-v1', reportEvidence: {
        contactAttempts: [{ method: 'PHONE_CALL', outcome: 'NO_ANSWER', claimedAt: date(20 + number).toISOString() }],
        interactionNote: 'raw refusal interaction',
      }, ...overrides,
    });
    return id;
  };
  const first = addAttempt('order-one', 'r1', 1);
  const second = addAttempt('order-one', 'r1', 2);
  const third = addAttempt('order-one', 'r1', 3, { endedAt: date(22), reportReceivedAt: date(22) });
  const other = addAttempt('order-two', 'r2', 1);
  let queryCalls = 0;
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const makeQuery = (name, filters = [], orders = [], max = null, position = null) => ({
    where(field, operator, value) { assert.equal(operator, '=='); return makeQuery(name, [...filters, [field, value]], orders, max, position); },
    orderBy(field, direction) { return makeQuery(name, filters, [...orders, [field, direction]], max, position); },
    limit(value) { assert.ok(value <= 26); return makeQuery(name, filters, orders, value, position); },
    startAfter(doc) { return makeQuery(name, filters, orders, max, doc.id); },
    async get() {
      queryCalls += 1;
      assert.equal(name, 'deliveryAttempts');
      assert.ok(filters.some(([field, value]) => field === 'outcome' && value === 'failed'));
      assert.ok(filters.some(([field]) => field === 'requesterUid' || field === 'orderId'));
      assert.equal(orders.length, 2);
      const docs = [...records.keys()].filter((path) => path.startsWith(`${name}/`))
        .filter((path) => filters.every(([field, value]) => records.get(path)[field] === value))
        .map(snapshot).sort((a, b) => {
          const time = b.data().endedAt - a.data().endedAt;
          return time || b.id.localeCompare(a.id);
        });
      const start = position ? docs.findIndex((doc) => doc.id === position) + 1 : 0;
      return { docs: docs.slice(start, start + max) };
    },
  });
  const db = { collection(name) { return {
    doc(id) { const path = `${name}/${id}`; return { id, path, get: async () => snapshot(path) }; },
    ...makeQuery(name),
  }; }, async runTransaction(run) {
    const writes = [];
    const result = await run({
      get: async (ref) => snapshot(ref.path),
      update(ref, data) { writes.push(['update', ref.path, data]); },
      create(ref, data) { writes.push(['create', ref.path, data]); },
    });
    for (const [method, path] of writes) if (method === 'create' && records.has(path)) throw new Error('already exists');
    for (const [method, path, data] of writes) records.set(path, method === 'update' ? { ...records.get(path), ...data } : data);
    return result;
  } };
  const identities = { r1: { uid: 'r1' }, r2: { uid: 'r2' }, manager: { uid: 'm1', role: 'manager' },
    distributor: { uid: 'd1', role: 'distributor' }, admin: { uid: 'a1', role: 'admin' }, inactive: { uid: 'inactive' } };
  const auth = { async verifyIdToken(token, checkRevoked) {
    assert.equal(checkRevoked, true);
    if (!identities[token]) throw new Error('invalid token');
    return identities[token];
  } };
  const handler = createRequesterDeliveryReportsHandler(() => ({ auth, db }));
  async function call(url, token = 'r1', method = 'GET', body) {
    const res = { statusCode: 200, body: null, headers: {}, setHeader(key, value) { this.headers[key] = value; }, getHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
    await handler({ url, method, body, headers: token ? { authorization: `Bearer ${token}` } : {} }, res);
    return res;
  }
  return { records, call, addAttempt, ids: { first, second, third, other }, get queryCalls() { return queryCalls; } };
}

test('route is registered and authenticated requester can list a bounded, rescheduled order feed and detail', async () => {
  assert.ok(routes.has('/api/requester/delivery-reports'));
  const f = fixture();
  const list = await f.call('/api/requester/delivery-reports?orderId=order-one');
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.body.reports.map((item) => item.attemptId), [f.ids.second, f.ids.third, f.ids.first]);
  assert.equal(list.body.nextCursor, null);
  assert.equal(list.body.reports[0].reviewState, 'awaiting_review');
  assert.equal(list.body.reports[0].reportedStatus, 'reported_by_distributor');
  assert.equal(list.headers['Cache-Control'], 'no-store');
  const before = JSON.stringify([...f.records]);
  const detail = await f.call(`/api/requester/delivery-reports?attemptId=${f.ids.second}&orderId=order-one`);
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(detail.body.report, list.body.reports[0]);
  assert.equal(JSON.stringify([...f.records]), before);
});

test('feed pagination is stable for equal timestamps, bounded, and isolated by requester and order', async () => {
  const f = fixture();
  const first = await f.call('/api/requester/delivery-reports?limit=1');
  const second = await f.call(`/api/requester/delivery-reports?limit=1&cursor=${first.body.nextCursor}`);
  const third = await f.call(`/api/requester/delivery-reports?limit=1&cursor=${second.body.nextCursor}`);
  assert.deepEqual([first, second, third].map((res) => res.statusCode), [200, 200, 200]);
  assert.equal(new Set([first, second, third].map((res) => res.body.reports[0].attemptId)).size, 3);
  assert.equal(third.body.nextCursor, null);
  const crossUser = await f.call(`/api/requester/delivery-reports?cursor=${f.ids.other}`);
  const crossOrder = await f.call(`/api/requester/delivery-reports?orderId=order-one&cursor=${f.ids.other}`);
  f.records.set('requests/another-own-order', { requesterUid: 'r1', requester_id: 'r1' });
  const anotherOwnAttempt = f.addAttempt('another-own-order', 'r1', 1);
  const wrongOwnOrder = await f.call(`/api/requester/delivery-reports?orderId=order-one&cursor=${anotherOwnAttempt}`);
  assert.deepEqual([crossUser.statusCode, crossOrder.statusCode, wrongOwnOrder.statusCode], [400, 400, 400]);
  assert.equal((await f.call('/api/requester/delivery-reports?limit=26')).statusCode, 400);
  assert.equal((await f.call('/api/requester/delivery-reports?limit=0')).statusCode, 400);
  assert.equal((await f.call('/api/requester/delivery-reports?cursor=invalid')).statusCode, 400);
  assert.equal((await f.call('/api/requester/delivery-reports?limit=1&limit=2')).statusCode, 400);
  assert.equal((await f.call('/api/requester/delivery-reports?requesterUid=r2')).statusCode, 400);
  assert.ok(f.queryCalls <= 4);
});

test('unverified, inactive, and non-requester callers cannot read reports', async () => {
  const f = fixture();
  assert.equal((await f.call('/api/requester/delivery-reports', '')).statusCode, 401);
  assert.equal((await f.call('/api/requester/delivery-reports', 'invalid-token')).statusCode, 401);
  assert.equal((await f.call('/api/requester/delivery-reports', 'manager')).statusCode, 403);
  assert.equal((await f.call('/api/requester/delivery-reports', 'inactive')).statusCode, 403);
  assert.equal((await f.call('/api/requester/delivery-reports', 'r2')).body.reports.length, 1);
  assert.equal((await f.call('/api/requester/delivery-reports', 'r2')).body.reports[0].attemptId, f.ids.other);
  assert.equal((await f.call('/api/requester/delivery-reports', 'r2', 'PUT')).statusCode, 405);
});

test('cross-user, missing parent, conflicting parent owner, and attempt/order mismatch fail closed', async () => {
  const f = fixture();
  const detail = (id, extra = '') => f.call(`/api/requester/delivery-reports?attemptId=${id}${extra}`);
  assert.equal((await detail(f.ids.other)).statusCode, 404);
  assert.equal((await f.call('/api/requester/delivery-reports?orderId=order-two')).statusCode, 404);
  assert.equal((await detail(f.ids.first, '&orderId=order-two')).statusCode, 404);
  f.records.delete('requests/order-one');
  assert.equal((await detail(f.ids.first)).statusCode, 404);
  f.records.set('requests/order-one', { requesterUid: 'r1', requester_id: 'r2' });
  assert.equal((await detail(f.ids.first)).statusCode, 404);
  f.records.set('requests/order-one', { requesterUid: 'r1' });
  f.records.get(`deliveryAttempts/${f.ids.first}`).requesterUid = 'r2';
  assert.equal((await detail(f.ids.first)).statusCode, 404);
  f.records.get(`deliveryAttempts/${f.ids.first}`).requesterUid = 'r1';
  f.records.get(`deliveryAttempts/${f.ids.first}`).orderId = 'order-two';
  assert.equal((await detail(f.ids.first)).statusCode, 404);
  f.records.get(`deliveryAttempts/${f.ids.first}`).orderId = 'order-one';
  f.records.set('requests/order-one', { status: 'delivery_failed' });
  assert.equal((await detail(f.ids.first)).statusCode, 404);
});

test('legacy attempts have safe limited DTOs; old orders without attempts yield no synthetic reports', async () => {
  const f = fixture();
  const legacy = f.records.get(`deliveryAttempts/${f.ids.first}`);
  delete legacy.reportEvidence;
  delete legacy.reportFormat;
  delete legacy.reportReceivedAt;
  legacy.reportedReasonCode = 'RECIPIENT_REFUSED';
  const detail = await f.call(`/api/requester/delivery-reports?attemptId=${f.ids.first}`);
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(detail.body.report.contactAttempts, []);
  assert.equal(detail.body.report.reportReceivedAt, date(21).toISOString());
  assert.equal(detail.body.report.reportedReasonLabel, 'Recipient refused delivery');
  const oldOrder = await f.call('/api/requester/delivery-reports?orderId=old-order');
  assert.deepEqual(oldOrder.body, { reports: [], nextCursor: null });
});

test('DTO redacts refusal interaction, raw legacy notes, private identity, mutations, and audit details', async () => {
  const f = fixture();
  const raw = f.records.get(`deliveryAttempts/${f.ids.first}`);
  raw.reportedReasonCode = 'RECIPIENT_REFUSED';
  raw.reportEvidence = { interactionNote: 'Sensitive interaction notes and phone number' };
  raw.requesterResponse = { status: 'submitted', requesterUid: 'r1', submittedAt: date(22), explanation: 'my own factual response', clientMutationId: 'private-response-mutation' };
  const detail = await f.call(`/api/requester/delivery-reports?attemptId=${f.ids.first}`);
  const encoded = JSON.stringify(detail.body);
  for (const secret of ['Sensitive interaction', 'raw private failure note', 'private-staff', 'private-mutation', 'private-response-mutation', 'moderationIncident', 'assignmentVersion']) {
    assert.ok(!encoded.includes(secret), secret);
  }
  assert.equal(detail.body.report.requesterResponseStatus, 'submitted');
  assert.deepEqual(detail.body.report.requesterResponse, { explanation: 'my own factual response', submittedAt: date(22).toISOString() });
  assert.deepEqual(detail.body.report.contactAttempts, []);
  assert.deepEqual(Object.keys(detail.body.report).sort(), [
    'attemptId', 'contactAttempts', 'orderId', 'attemptNumber', 'reportReceivedAt',
    'reportedReasonCode', 'reportedReasonLabel', 'reportedStatus', 'requesterResponse', 'requesterResponseStatus', 'reviewState',
  ].sort());
  raw.requesterResponse.requesterUid = 'r2';
  const mismatchedResponse = await f.call(`/api/requester/delivery-reports?attemptId=${f.ids.first}`);
  assert.equal(mismatchedResponse.body.report.requesterResponse, null);
  assert.equal(mismatchedResponse.body.report.requesterResponseStatus, 'not_submitted');
  assert.ok(!JSON.stringify(mismatchedResponse.body).includes('my own factual response'));
});

test('structured contact summaries use allowlisted labels and mark claimed time unverified', async () => {
  const f = fixture();
  const detail = await f.call(`/api/requester/delivery-reports?attemptId=${f.ids.first}`);
  assert.deepEqual(detail.body.report.contactAttempts, [{ method: 'Phone call', outcome: 'No answer', claimedAt: date(21).toISOString(), claimedAtUnverified: true }]);
  f.records.get(`deliveryAttempts/${f.ids.first}`).reportEvidence.contactAttempts.push({ method: 'SECRET_METHOD', outcome: 'SECRET_OUTCOME' });
  const second = await f.call(`/api/requester/delivery-reports?attemptId=${f.ids.first}`);
  assert.equal(second.body.report.contactAttempts.length, 1);
  assert.ok(!JSON.stringify(second.body).includes('SECRET_'));
});

test('rules still deny direct attempt and event access; indexes match the two scoped queries', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const rules = readFileSync(resolve(root, 'firestore.rules'), 'utf8');
  const indexes = JSON.parse(readFileSync(resolve(root, 'firestore.indexes.json'), 'utf8'));
  for (const name of ['deliveryAttempts', 'deliveryAttemptEvents']) {
    assert.match(rules, new RegExp(`match /${name}/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`));
  }
  for (const field of ['requesterUid', 'orderId']) {
    assert.ok(indexes.indexes.some((index) => index.collectionGroup === 'deliveryAttempts'
      && JSON.stringify(index.fields) === JSON.stringify([
        { fieldPath: field, order: 'ASCENDING' },
        { fieldPath: 'outcome', order: 'ASCENDING' },
        { fieldPath: 'endedAt', order: 'DESCENDING' },
      ])));
  }
});

const responseBody = (attemptId, overrides = {}) => ({
  attemptId, explanation: 'I was at the delivery address and did not receive a call.',
  clientMutationId: 'requester_response_001', ...overrides,
});
const post = (fixtureValue, body, token = 'r1') => fixtureValue.call('/api/requester/delivery-reports', token, 'POST', body);

test('Requester submits one factual response after rescheduling with one immutable event and no unrelated writes', async () => {
  const f = fixture();
  f.records.get(`deliveryAttempts/${f.ids.first}`).responsibility = 'undetermined';
  const orderBefore = JSON.stringify(f.records.get('requests/order-one'));
  const userBefore = JSON.stringify(f.records.get('users/r1'));
  const before = Date.now();
  const result = await post(f, responseBody(f.ids.first, { explanation: '  I was at the address   and received no call.  ' }));
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(result.body.report.requesterResponseStatus, 'submitted');
  assert.equal(result.body.report.requesterResponse.explanation, 'I was at the address and received no call.');
  assert.ok(Date.parse(result.body.report.requesterResponse.submittedAt) >= before);
  const attempt = f.records.get(`deliveryAttempts/${f.ids.first}`);
  assert.equal(attempt.reviewState, 'reported');
  assert.equal(attempt.responsibility, 'undetermined');
  assert.equal(attempt.requesterResponse.requesterUid, 'r1');
  const event = f.records.get(`deliveryAttemptEvents/${f.ids.first}_requester_response_v1`);
  assert.equal(event.kind, 'REQUESTER_INITIAL_RESPONSE_SUBMITTED');
  assert.equal(event.createdAt, attempt.requesterResponse.submittedAt);
  assert.equal(JSON.stringify(f.records.get('requests/order-one')), orderBefore);
  assert.equal(JSON.stringify(f.records.get('users/r1')), userBefore);
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('deliveryAttemptEvents/')).length, 1);
  assert.equal([...f.records.keys()].some((key) => /chat|moderation|restriction|warning|strike/i.test(key)), false);
  const get = await f.call(`/api/requester/delivery-reports?attemptId=${f.ids.first}`);
  assert.deepEqual(get.body, result.body);
  assert.ok(!JSON.stringify(result.body).includes('requester_response_001'));
});

test('exact replay is read-only; changed explanation, mutation ID, and second response conflict', async () => {
  const f = fixture();
  f.records.get(`deliveryAttempts/${f.ids.first}`).responsibility = 'undetermined';
  const body = responseBody(f.ids.first);
  const first = await post(f, body);
  assert.equal(first.statusCode, 200);
  const attemptBefore = f.records.get(`deliveryAttempts/${f.ids.first}`);
  const eventBefore = f.records.get(`deliveryAttemptEvents/${f.ids.first}_requester_response_v1`);
  const replay = await post(f, responseBody(f.ids.first, { explanation: `  ${body.explanation}  ` }));
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(f.records.get(`deliveryAttempts/${f.ids.first}`), attemptBefore);
  assert.equal(f.records.get(`deliveryAttemptEvents/${f.ids.first}_requester_response_v1`), eventBefore);
  assert.equal((await post(f, responseBody(f.ids.first, { explanation: 'I waited outside the address for a long time.' }))).statusCode, 409);
  assert.equal((await post(f, responseBody(f.ids.first, { clientMutationId: 'requester_response_002' }))).statusCode, 409);
  assert.equal([...f.records.keys()].filter((key) => key.startsWith('deliveryAttemptEvents/')).length, 1);
});

test('POST validates authentication, role, ownership, attempt identity, and review eligibility', async () => {
  const f = fixture();
  f.records.get(`deliveryAttempts/${f.ids.first}`).responsibility = 'undetermined';
  const body = responseBody(f.ids.first);
  for (const [token, expected] of [['', 401], ['invalid-token', 401], ['manager', 403],
    ['distributor', 403], ['admin', 403], ['inactive', 403], ['r2', 404]]) {
    assert.equal((await post(f, body, token)).statusCode, expected);
  }
  assert.equal((await post(f, responseBody(f.ids.other))).statusCode, 404);
  assert.equal((await post(f, responseBody('a'.repeat(64)))).statusCode, 404);
  const attempt = f.records.get(`deliveryAttempts/${f.ids.first}`);
  attempt.outcome = 'delivered';
  assert.equal((await post(f, body)).statusCode, 404);
  attempt.outcome = 'failed';
  attempt.reviewState = 'reviewed';
  assert.equal((await post(f, body)).statusCode, 409);
  attempt.reviewState = 'reported';
  attempt.orderId = 'order-two';
  assert.equal((await post(f, body)).statusCode, 404);
  attempt.orderId = 'order-one';
  f.records.set('requests/order-one', { requesterUid: 'r1', requester_id: 'r2' });
  assert.equal((await post(f, body)).statusCode, 404);
  f.records.delete('requests/order-one');
  assert.equal((await post(f, body)).statusCode, 404);
  assert.equal([...f.records.keys()].filter((key) => key.endsWith('_requester_response_v1')).length, 0);
});

test('POST rejects blank, short, oversized, malformed, and unexpected payloads without writes', async () => {
  const f = fixture();
  f.records.get(`deliveryAttempts/${f.ids.first}`).responsibility = 'undetermined';
  const invalid = [
    responseBody(f.ids.first, { explanation: '   ' }),
    responseBody(f.ids.first, { explanation: 'too short' }),
    responseBody(f.ids.first, { explanation: 'a'.repeat(501) }),
    responseBody(f.ids.first, { explanation: '!!!!!!!!!!!!' }),
    responseBody(f.ids.first, { clientMutationId: 'short' }),
    responseBody(f.ids.first, { attemptId: 'bad-id' }),
    responseBody(f.ids.first, { requesterUid: 'r2' }),
    responseBody(f.ids.first, { submittedAt: new Date().toISOString() }),
    { ...responseBody(f.ids.first), explanation: null },
    {},
  ];
  const before = JSON.stringify([...f.records]);
  for (const value of invalid) assert.equal((await post(f, value)).statusCode, 400);
  assert.equal(JSON.stringify([...f.records]), before);
});

test('existing response event without response state blocks a partial or duplicate submission', async () => {
  const f = fixture();
  f.records.get(`deliveryAttempts/${f.ids.first}`).responsibility = 'undetermined';
  f.records.set(`deliveryAttemptEvents/${f.ids.first}_requester_response_v1`, { kind: 'REQUESTER_INITIAL_RESPONSE_SUBMITTED' });
  const before = JSON.stringify([...f.records]);
  assert.equal((await post(f, responseBody(f.ids.first))).statusCode, 409);
  assert.equal(JSON.stringify([...f.records]), before);
});
