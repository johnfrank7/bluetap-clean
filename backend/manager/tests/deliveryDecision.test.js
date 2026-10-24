const assert = require('node:assert/strict');
const test = require('node:test');
const { attemptIdFor } = require('../../delivery/deliveryAttemptService');
const { createManagerDeliveryReviewsHandler } = require('../deliveryReviewsHandler');
const { decisionEventIdFor } = require('../../delivery/managerDeliveryDecisionService');

const receivedAt = new Date('2026-10-20T12:00:00.000Z');
const deadline = new Date('2026-10-23T12:00:00.000Z');
const reason = 'The delivery record and both accounts were reviewed.';

function fixture(now = () => deadline) {
  const orderId = 'historic-order';
  const attemptId = attemptIdFor(orderId, 1);
  const eventPath = `deliveryAttemptEvents/${decisionEventIdFor(attemptId)}`;
  const records = new Map([
    ['users/m1', { role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: 'b1' }],
    ['users/m2', { role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: 'b2' }],
    ['users/d1', { role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: 'b1' }],
    ['users/inactive', { role: 'manager', managerStatus: 'inactive', accountStatus: 'active', branchId: 'b1' }],
    ['users/forged', { role: 'requester', managerStatus: 'active', accountStatus: 'active', branchId: 'b1' }],
    ['branches/b1', { status: 'active' }], ['branches/b2', { status: 'active' }],
    [`requests/${orderId}`, { requesterUid: 'r1', requester_id: 'r1', requestId: 'Req-History',
      branchId: 'b2', currentBranchId: 'b2' }],
    [`deliveryAttempts/${attemptId}`, { orderId, requesterUid: 'r1', distributorUid: 'd1',
      branchId: 'b1', attemptNumber: 1, outcome: 'failed', reviewState: 'reported',
      responsibility: 'undetermined', endedAt: receivedAt, reportReceivedAt: receivedAt,
      reportedReasonCode: 'NO_RESPONSE', reportFormat: 'structured-v1',
      reportEvidence: { contactAttempts: [{ method: 'PHONE_CALL', outcome: 'NO_ANSWER' }] } }],
  ]);
  const versions = new Map([[`deliveryAttempts/${attemptId}`, 1]]);
  const writes = [];
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path),
    data: () => records.get(path), updateTime: { seconds: 1792500000 + (versions.get(path) || 0), nanoseconds: 10 } });
  const db = {
    collection(name) { return { doc(id) { const path = `${name}/${id}`; return { path, get: async () => snapshot(path) }; } }; },
    async runTransaction(run) {
      const pending = [];
      const result = await run({
        get: async (ref) => { if (pending.length) throw new Error('Transaction read after write.'); return snapshot(ref.path); },
        update: (ref, data) => pending.push(['update', ref.path, data]),
        create: (ref, data) => pending.push(['create', ref.path, data]),
      });
      for (const [method, path] of pending) if (method === 'create' && records.has(path)) throw new Error('Duplicate event.');
      for (const [method, path, data] of pending) {
        records.set(path, method === 'update' ? { ...records.get(path), ...data } : data);
        versions.set(path, (versions.get(path) || 0) + 1);
        writes.push([method, path]);
      }
      return result;
    },
  };
  const identities = { m1: { uid: 'm1', role: 'manager' }, m2: { uid: 'm2', role: 'manager' },
    d1: { uid: 'd1', role: 'manager' }, inactive: { uid: 'inactive', role: 'manager' },
    forged: { uid: 'forged', role: 'manager' } };
  const auth = { async verifyIdToken(token, checkRevoked) {
    assert.equal(checkRevoked, true);
    if (!identities[token]) throw new Error('Invalid token.');
    return identities[token];
  }, async getUser() { return { disabled: false }; } };
  const handler = createManagerDeliveryReviewsHandler(() => ({ auth, db }), now);
  async function call(method, body, token = 'm1') {
    const res = { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; }, end() { return this; } };
    const url = method === 'GET' ? `/api/manager/delivery-reviews?attemptId=${attemptId}` : '/api/manager/delivery-reviews';
    await handler({ method, url, body, headers: token ? { authorization: `Bearer ${token}` } : {} }, res);
    return res;
  }
  async function payload(overrides = {}) {
    const detail = await call('GET');
    assert.equal(detail.statusCode, 200, JSON.stringify(detail.body));
    return { attemptId, orderId, responsibility: 'undetermined', decisionReason: reason,
      expectedRevision: detail.body.review.revision, clientMutationId: 'decision_001', ...overrides };
  }
  return { records, versions, writes, attemptId, orderId, eventPath, call, payload };
}

test('all four outcomes resolve atomically, preserve source records, and never create penalties', async () => {
  for (const responsibility of ['requester_responsible', 'provider_responsible', 'shared', 'undetermined']) {
    const f = fixture();
    const body = await f.payload({ responsibility });
    const orderBefore = f.records.get(`requests/${f.orderId}`);
    const managerBefore = f.records.get('users/m1');
    const result = await f.call('POST', body);
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body.decision, { attemptId: f.attemptId, orderId: f.orderId,
      reportingBranchId: 'b1', reviewState: 'resolved', responsibility, decisionReason: reason,
      decidedAt: deadline.toISOString() });
    const attempt = f.records.get(`deliveryAttempts/${f.attemptId}`);
    const event = f.records.get(f.eventPath);
    assert.equal(attempt.reviewState, 'resolved');
    assert.equal(attempt.responsibility, responsibility);
    assert.equal(attempt.reportedReasonCode, 'NO_RESPONSE');
    assert.equal(event.kind, 'MANAGER_DELIVERY_DECISION');
    assert.equal(event.previousReviewState, 'reported');
    assert.equal(event.branchId, 'b1');
    assert.equal(event.managerUid, 'm1');
    assert.equal(event.clientMutationId, body.clientMutationId);
    assert.equal(f.records.get(`requests/${f.orderId}`), orderBefore);
    assert.equal(f.records.get('users/m1'), managerBefore);
    assert.equal(f.writes.length, 2);
    assert.deepEqual(f.writes.map((entry) => entry[1]), [`deliveryAttempts/${f.attemptId}`, f.eventPath]);
    assert.ok(!JSON.stringify(result.body).includes(body.clientMutationId));
    const detail = await f.call('GET');
    assert.equal(detail.body.review.reviewState, 'resolved');
    assert.equal(detail.body.review.canFinalizeNow, false);
  }
});

test('exact replay is read-only; changed payload, mutation, and revision conflict', async () => {
  const f = fixture();
  const body = await f.payload({ decisionReason: `  ${reason}  ` });
  const first = await f.call('POST', body);
  assert.equal(first.statusCode, 200);
  const version = f.versions.get(`deliveryAttempts/${f.attemptId}`);
  const replay = await f.call('POST', body);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(f.versions.get(`deliveryAttempts/${f.attemptId}`), version);
  assert.equal(f.writes.length, 2);
  for (const changed of [
    { responsibility: 'shared' }, { decisionReason: 'A different factual explanation was supplied.' },
    { clientMutationId: 'decision_002' }, { expectedRevision: 'a'.repeat(43) },
  ]) assert.equal((await f.call('POST', { ...body, ...changed })).statusCode, 409);
  assert.equal(f.writes.length, 2);
});

test('response timing is enforced, including the exact 72-hour boundary', async () => {
  const early = fixture(() => new Date(deadline.getTime() - 1));
  const body = await early.payload();
  assert.equal((await early.call('POST', body)).statusCode, 409);
  assert.equal(early.writes.length, 0);
  early.records.get(`deliveryAttempts/${early.attemptId}`).requesterResponse = { status: 'submitted',
    requesterUid: 'r1', explanation: 'I was at home and did not receive a call.',
    submittedAt: new Date('2026-10-21T12:00:00.000Z') };
  const updated = await early.payload();
  assert.equal((await early.call('POST', updated)).statusCode, 200);
  const boundary = fixture();
  assert.equal((await boundary.call('POST', await boundary.payload())).statusCode, 200);
  const late = fixture(() => new Date(deadline.getTime() + 1));
  assert.equal((await late.call('POST', await late.payload())).statusCode, 200);
  const invalid = fixture();
  invalid.records.get(`deliveryAttempts/${invalid.attemptId}`).reportReceivedAt = null;
  assert.equal((await invalid.call('POST', { attemptId: invalid.attemptId, orderId: invalid.orderId,
    responsibility: 'shared', decisionReason: reason, expectedRevision: 'a'.repeat(43),
    clientMutationId: 'decision_001' })).statusCode, 404);
});

test('authentication, current branch, canonical parent, self-review, and event conflicts fail closed', async () => {
  const f = fixture();
  const body = await f.payload();
  for (const [token, code] of [['', 401], ['forged', 403], ['inactive', 403], ['m2', 404], ['d1', 404]]) {
    assert.equal((await f.call('POST', body, token)).statusCode, code);
  }
  assert.equal((await f.call('POST', { ...body, branchId: 'b2' })).statusCode, 400);
  f.records.get('users/m1').accountStatus = 'inactive';
  assert.equal((await f.call('POST', body)).statusCode, 403);
  f.records.get('users/m1').accountStatus = 'active';
  f.records.delete(`requests/${f.orderId}`);
  assert.equal((await f.call('POST', body)).statusCode, 404);
  f.records.set(`requests/${f.orderId}`, { requesterUid: 'r2' });
  assert.equal((await f.call('POST', body)).statusCode, 404);
  f.records.set(`requests/${f.orderId}`, { requesterUid: 'r1' });
  f.records.get(`deliveryAttempts/${f.attemptId}`).attemptNumber = 3;
  assert.equal((await f.call('POST', body)).statusCode, 404);
  f.records.get(`deliveryAttempts/${f.attemptId}`).attemptNumber = 1;
  f.records.set(f.eventPath, { kind: 'FOREIGN_EVENT' });
  assert.equal((await f.call('POST', body)).statusCode, 409);
  assert.equal(f.writes.length, 0);
});

test('validation and stale revision reject without writing', async () => {
  const f = fixture();
  const body = await f.payload();
  for (const changed of [
    { attemptId: 'bad' }, { orderId: 'other-order' }, { responsibility: 'penalty' },
    { decisionReason: ' ' }, { decisionReason: 'a'.repeat(501) }, { expectedRevision: 'bad' },
    { clientMutationId: 'short' }, { extra: true },
  ]) assert.equal((await f.call('POST', { ...body, ...changed })).statusCode,
    Object.hasOwn(changed, 'orderId') ? 404 : 400);
  f.versions.set(`deliveryAttempts/${f.attemptId}`, 2);
  assert.equal((await f.call('POST', body)).statusCode, 409);
  assert.equal(f.writes.length, 0);
});
