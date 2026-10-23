const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getFirestore: getAdminFirestore } = require('firebase-admin/firestore');
const { initializeApp: initializeClientApp, deleteApp: deleteClientApp } = require('firebase/app');
const { getFirestore: getClientFirestore, connectFirestoreEmulator, doc, getDoc, terminate } = require('firebase/firestore');
const { createRequesterDeliveryReportsHandler } = require('../../requester/deliveryReportsHandler');
const { attemptIdFor } = require('../deliveryAttemptService');

const host = process.env.FIRESTORE_EMULATOR_HOST;

async function call(handler, url, token = 'requester-token', method = 'GET', body) {
  const res = {
    statusCode: 200, body: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; }, getHeader() {},
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; },
  };
  await handler({ method, url, body, headers: token ? { authorization: `Bearer ${token}` } : {} }, res);
  return res;
}

test('real Firestore indexes serve bounded owned reports while client reads stay denied', { skip: !host }, async () => {
  const projectId = 'demo-bluetap';
  const suffix = randomUUID();
  const app = initializeAdminApp({ projectId }, `requester-reports-${suffix}`);
  const db = getAdminFirestore(app);
  const clientApp = initializeClientApp({ projectId }, `requester-reports-client-${suffix}`);
  const clientDb = getClientFirestore(clientApp);
  const [hostname, port] = host.split(':');
  connectFirestoreEmulator(clientDb, hostname, Number(port), { mockUserToken: { sub: `r-${suffix}`, user_id: `r-${suffix}` } });
  const uid = `r-${suffix}`;
  const otherUid = `other-${suffix}`;
  const orderId = `order-${suffix}`;
  const otherOrderId = `other-order-${suffix}`;
  const firstId = attemptIdFor(orderId, 1);
  const secondId = attemptIdFor(orderId, 2);
  const otherId = attemptIdFor(otherOrderId, 1);
  const endedAt = new Date('2026-10-23T01:00:00.000Z');
  const auth = { async verifyIdToken(token, checkRevoked) {
    assert.equal(checkRevoked, true);
    if (token === 'requester-token') return { uid };
    if (token === 'other-token') return { uid: otherUid };
    throw new Error('invalid token');
  } };
  const handler = createRequesterDeliveryReportsHandler(() => ({ auth, db }));
  try {
    await Promise.all([
      db.collection('users').doc(uid).set({ role: 'requester', accountStatus: 'active' }),
      db.collection('users').doc(otherUid).set({ role: 'requester', accountStatus: 'active' }),
      db.collection('requests').doc(orderId).set({ requesterUid: uid, requester_id: uid, status: 'scheduled', deliveryAttemptSeq: 2 }),
      db.collection('requests').doc(otherOrderId).set({ requesterUid: otherUid, requester_id: otherUid, status: 'delivery_failed' }),
      db.collection('deliveryAttempts').doc(firstId).set({ orderId, requesterUid: uid, attemptNumber: 1, outcome: 'failed', reviewState: 'reported', endedAt, reportedReasonCode: 'NO_RESPONSE', reportedReasonNote: 'private note', distributorUid: 'private staff' }),
      db.collection('deliveryAttempts').doc(secondId).set({ orderId, requesterUid: uid, attemptNumber: 2, outcome: 'failed', reviewState: 'reported', endedAt, reportReceivedAt: endedAt, reportedReasonCode: 'RECIPIENT_REFUSED', reportFormat: 'structured-v1', reportEvidence: { interactionNote: 'private refusal details' } }),
      db.collection('deliveryAttempts').doc(otherId).set({ orderId: otherOrderId, requesterUid: otherUid, attemptNumber: 1, outcome: 'failed', reviewState: 'reported', endedAt, reportedReasonCode: 'NO_RESPONSE' }),
      db.collection('deliveryAttemptEvents').doc(`${firstId}_outcome`).set({ attemptId: firstId, kind: 'ATTEMPT_FAILED', reportEvidence: { interactionNote: 'private audit' } }),
    ]);
    const before = (await db.collection('deliveryAttempts').doc(firstId).get()).updateTime.toMillis();
    const first = await call(handler, '/api/requester/delivery-reports?limit=1');
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.equal(first.body.reports.length, 1);
    assert.ok(first.body.nextCursor);
    const second = await call(handler, `/api/requester/delivery-reports?limit=1&cursor=${first.body.nextCursor}`);
    assert.equal(second.statusCode, 200, JSON.stringify(second.body));
    assert.notEqual(second.body.reports[0].attemptId, first.body.reports[0].attemptId);
    assert.equal(second.body.nextCursor, null);
    const byOrder = await call(handler, `/api/requester/delivery-reports?orderId=${orderId}`);
    assert.equal(byOrder.statusCode, 200, JSON.stringify(byOrder.body));
    assert.equal(byOrder.body.reports.length, 2);
    const detail = await call(handler, `/api/requester/delivery-reports?attemptId=${secondId}&orderId=${orderId}`);
    assert.equal(detail.statusCode, 200);
    assert.ok(!JSON.stringify(detail.body).includes('private'));
    assert.equal((await call(handler, `/api/requester/delivery-reports?attemptId=${otherId}`)).statusCode, 404);
    assert.equal((await call(handler, `/api/requester/delivery-reports?cursor=${otherId}`)).statusCode, 400);
    assert.equal((await call(handler, '/api/requester/delivery-reports', 'other-token')).body.reports.length, 1);
    assert.equal((await db.collection('deliveryAttempts').doc(firstId).get()).updateTime.toMillis(), before);
    for (const path of [`deliveryAttempts/${firstId}`, `deliveryAttemptEvents/${firstId}_outcome`]) {
      await assert.rejects(getDoc(doc(clientDb, path)), (error) => error.code === 'permission-denied');
    }
  } finally {
    await terminate(clientDb);
    await deleteClientApp(clientApp);
    await deleteAdminApp(app);
  }
});

test('real Firestore transaction stores one Requester response and immutable event with exact replay', { skip: !host }, async () => {
  const projectId = 'demo-bluetap';
  const suffix = randomUUID();
  const app = initializeAdminApp({ projectId }, `requester-response-${suffix}`);
  const db = getAdminFirestore(app);
  const uid = `r-${suffix}`;
  const otherUid = `other-${suffix}`;
  const orderId = `order-${suffix}`;
  const attemptId = attemptIdFor(orderId, 1);
  const eventId = `${attemptId}_requester_response_v1`;
  const auth = { async verifyIdToken(token, checkRevoked) {
    assert.equal(checkRevoked, true);
    if (token === 'requester-token') return { uid };
    if (token === 'other-token') return { uid: otherUid };
    if (token === 'manager-token') return { uid: `manager-${suffix}`, role: 'manager' };
    throw new Error('invalid token');
  } };
  const handler = createRequesterDeliveryReportsHandler(() => ({ auth, db }));
  const body = { attemptId, explanation: 'I was at the delivery address and received no call.', clientMutationId: `response_${suffix}` };
  const post = (payload = body, token = 'requester-token') => call(handler, '/api/requester/delivery-reports', token, 'POST', payload);
  try {
    await Promise.all([
      db.collection('users').doc(uid).set({ role: 'requester', accountStatus: 'active' }),
      db.collection('users').doc(otherUid).set({ role: 'requester', accountStatus: 'active' }),
      db.collection('users').doc(`manager-${suffix}`).set({ role: 'manager', accountStatus: 'active' }),
      db.collection('requests').doc(orderId).set({ requesterUid: uid, requester_id: uid, status: 'scheduled', deliveryAttemptSeq: 1 }),
      db.collection('deliveryAttempts').doc(attemptId).set({ orderId, requesterUid: uid, attemptNumber: 1,
        outcome: 'failed', reviewState: 'reported', responsibility: 'undetermined',
        endedAt: new Date('2026-10-20T12:00:00.000Z'), reportedReasonCode: 'RECIPIENT_REFUSED',
        reportFormat: 'structured-v1', reportEvidence: { interactionNote: 'private distributor description' } }),
    ]);
    const orderBefore = (await db.collection('requests').doc(orderId).get()).updateTime.toMillis();
    const userBefore = (await db.collection('users').doc(uid).get()).updateTime.toMillis();
    const started = Date.now();
    assert.equal((await post(body, 'other-token')).statusCode, 404);
    assert.equal((await post(body, 'manager-token')).statusCode, 403);
    assert.equal((await post(body, '')).statusCode, 401);
    assert.equal((await db.collection('deliveryAttemptEvents').doc(eventId).get()).exists, false);
    const concurrent = await Promise.all([post(), post()]);
    assert.deepEqual(concurrent.map((result) => result.statusCode).sort(), [200, 200]);
    assert.deepEqual(concurrent[0].body, concurrent[1].body);
    const attemptRef = db.collection('deliveryAttempts').doc(attemptId);
    const eventRef = db.collection('deliveryAttemptEvents').doc(eventId);
    const attemptSnapshot = await attemptRef.get();
    const eventSnapshot = await eventRef.get();
    const attempt = attemptSnapshot.data();
    const event = eventSnapshot.data();
    assert.equal(attempt.reviewState, 'reported');
    assert.equal(attempt.responsibility, 'undetermined');
    assert.equal(attempt.requesterResponse.status, 'submitted');
    assert.equal(event.kind, 'REQUESTER_INITIAL_RESPONSE_SUBMITTED');
    assert.equal(event.requesterUid, uid);
    assert.equal(event.explanation, body.explanation);
    assert.equal(event.createdAt.toMillis(), attempt.requesterResponse.submittedAt.toMillis());
    assert.ok(event.createdAt.toMillis() >= started);
    assert.equal((await db.collection('deliveryAttemptEvents').where('attemptId', '==', attemptId).get()).size, 1);
    assert.equal((await db.collection('requests').doc(orderId).get()).updateTime.toMillis(), orderBefore);
    assert.equal((await db.collection('users').doc(uid).get()).updateTime.toMillis(), userBefore);
    const replay = await post();
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.body, concurrent[0].body);
    assert.equal((await attemptRef.get()).updateTime.toMillis(), attemptSnapshot.updateTime.toMillis());
    assert.equal((await eventRef.get()).updateTime.toMillis(), eventSnapshot.updateTime.toMillis());
    assert.equal((await post({ ...body, explanation: 'I waited at the address for the distributor.' })).statusCode, 409);
    assert.equal((await post({ ...body, clientMutationId: `different_${suffix}` })).statusCode, 409);
    const read = await call(handler, `/api/requester/delivery-reports?attemptId=${attemptId}`);
    assert.deepEqual(read.body, replay.body);
    assert.equal(read.body.report.requesterResponse.explanation, body.explanation);
    for (const secret of ['private distributor', body.clientMutationId]) assert.ok(!JSON.stringify(read.body).includes(secret));
    assert.equal((await db.collection('orderAbuseReviews').where('requesterUid', '==', uid).get()).empty, true);
    assert.equal((await db.collection('moderationNotices').doc(uid).get()).exists, false);
    assert.equal((await db.collection('orderingRestrictions').doc(uid).get()).exists, false);

    const nextAttemptId = attemptIdFor(orderId, 2);
    await db.collection('deliveryAttempts').doc(nextAttemptId).set({ orderId, requesterUid: uid, attemptNumber: 2,
      outcome: 'failed', reviewState: 'reported', responsibility: 'undetermined', endedAt: new Date() });
    const nextBody = { ...body, attemptId: nextAttemptId };
    const different = await Promise.all([
      post(nextBody),
      post({ ...nextBody, clientMutationId: `other_${suffix}` }),
    ]);
    assert.deepEqual(different.map((result) => result.statusCode).sort(), [200, 409]);
    assert.equal((await db.collection('deliveryAttemptEvents').where('attemptId', '==', nextAttemptId).get()).size, 1);
  } finally {
    await deleteAdminApp(app);
  }
});

test('real Firestore transaction rejects event conflict without a partial response write', { skip: !host }, async () => {
  const suffix = randomUUID();
  const app = initializeAdminApp({ projectId: 'demo-bluetap' }, `requester-response-conflict-${suffix}`);
  const db = getAdminFirestore(app);
  const uid = `r-${suffix}`;
  const orderId = `order-${suffix}`;
  const attemptId = attemptIdFor(orderId, 1);
  const eventId = `${attemptId}_requester_response_v1`;
  const handler = createRequesterDeliveryReportsHandler(() => ({
    auth: { verifyIdToken: async () => ({ uid }) }, db,
  }));
  try {
    await Promise.all([
      db.collection('users').doc(uid).set({ role: 'requester', accountStatus: 'active' }),
      db.collection('requests').doc(orderId).set({ requesterUid: uid, requester_id: uid, status: 'delivery_failed' }),
      db.collection('deliveryAttempts').doc(attemptId).set({ orderId, requesterUid: uid, attemptNumber: 1,
        outcome: 'failed', reviewState: 'reported', responsibility: 'undetermined', endedAt: new Date() }),
      db.collection('deliveryAttemptEvents').doc(eventId).set({ kind: 'REQUESTER_INITIAL_RESPONSE_SUBMITTED' }),
    ]);
    const before = await db.collection('deliveryAttempts').doc(attemptId).get();
    const result = await call(handler, '/api/requester/delivery-reports', 'requester-token', 'POST', {
      attemptId, explanation: 'I was present at the address during delivery.', clientMutationId: `response_${suffix}`,
    });
    assert.equal(result.statusCode, 409);
    const after = await db.collection('deliveryAttempts').doc(attemptId).get();
    assert.equal(after.updateTime.toMillis(), before.updateTime.toMillis());
    assert.equal(after.data().requesterResponse, undefined);
    assert.equal((await db.collection('deliveryAttemptEvents').doc(eventId).get()).data().requesterUid, undefined);
  } finally {
    await deleteAdminApp(app);
  }
});
