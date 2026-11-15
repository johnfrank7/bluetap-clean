const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getFirestore: getAdminFirestore } = require('firebase-admin/firestore');
const { initializeApp: initializeClientApp, deleteApp: deleteClientApp } = require('firebase/app');
const { getFirestore: getClientFirestore, connectFirestoreEmulator, doc, getDoc, terminate } = require('firebase/firestore');
const { createRequesterDeliveryReportsHandler } = require('../../requester/deliveryReportsHandler');
const { attemptIdFor } = require('../deliveryAttemptService');
const { decisionEventIdFor } = require('../deliveryReviewPolicy');

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

test('global feed advances past orphaned and conflicting-parent attempts without disclosing reports', { skip: !host }, async () => {
  const projectId = 'demo-bluetap';
  const suffix = randomUUID();
  const app = initializeAdminApp({ projectId }, `requester-report-orphans-${suffix}`);
  const db = getAdminFirestore(app);
  const uid = `r-${suffix}`;
  const otherUid = `other-${suffix}`;
  const validOrder = `valid-${suffix}`;
  const orphanOrder = `orphan-${suffix}`;
  const conflictOrder = `conflict-${suffix}`;
  const malformedOrder = `malformed-${suffix}`;
  const otherOrder = `other-${suffix}`;
  const validId = attemptIdFor(validOrder, 1);
  const orphanId = attemptIdFor(orphanOrder, 1);
  const conflictId = attemptIdFor(conflictOrder, 1);
  const malformedId = attemptIdFor(malformedOrder, 1);
  const oversizedMalformedId = 'x'.repeat(129);
  const otherId = attemptIdFor(otherOrder, 1);
  const auth = { async verifyIdToken(token, checkRevoked) {
    assert.equal(checkRevoked, true);
    if (token === 'requester-token') return { uid };
    if (token === 'other-token') return { uid: otherUid };
    throw new Error('invalid token');
  } };
  const handler = createRequesterDeliveryReportsHandler(() => ({ auth, db }));
  const record = (orderId, requesterUid, day) => ({
    orderId, requesterUid, attemptNumber: 1, outcome: 'failed', reviewState: 'reported',
    endedAt: new Date(`2026-10-${day}T01:00:00.000Z`), reportedReasonCode: 'NO_RESPONSE',
  });
  try {
    await Promise.all([
      db.collection('users').doc(uid).set({ role: 'requester', accountStatus: 'active' }),
      db.collection('users').doc(otherUid).set({ role: 'requester', accountStatus: 'active' }),
      db.collection('requests').doc(validOrder).set({ requesterUid: uid, requester_id: uid }),
      db.collection('requests').doc(conflictOrder).set({ requesterUid: uid, requester_id: otherUid }),
      db.collection('requests').doc(otherOrder).set({ requesterUid: otherUid, requester_id: otherUid }),
      db.collection('deliveryAttempts').doc(validId).set(record(validOrder, uid, 20)),
      db.collection('deliveryAttempts').doc(orphanId).set(record(orphanOrder, uid, 23)),
      db.collection('deliveryAttempts').doc(conflictId).set(record(conflictOrder, uid, 22)),
      db.collection('deliveryAttempts').doc(malformedId).set({ ...record(malformedOrder, uid, 21), orderId: validOrder }),
      db.collection('deliveryAttempts').doc(oversizedMalformedId).set(record(validOrder, uid, 20)),
      db.collection('deliveryAttempts').doc(otherId).set(record(otherOrder, otherUid, 21)),
    ]);
    const before = await Promise.all([validId, orphanId, conflictId, malformedId, oversizedMalformedId].map(async (id) =>
      (await db.collection('deliveryAttempts').doc(id).get()).updateTime.toMillis()));
    const pages = [];
    let cursor = '';
    for (let index = 0; index < 5; index += 1) {
      const response = await call(handler, `/api/requester/delivery-reports?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      assert.equal(response.statusCode, 200, JSON.stringify(response.body));
      pages.push(response.body);
      if (!response.body.nextCursor) break;
      assert.notEqual(response.body.nextCursor, cursor);
      cursor = response.body.nextCursor;
    }
    assert.equal(pages.length, 5);
    assert.deepEqual(pages.flatMap((page) => page.reports.map((report) => report.attemptId)), [validId]);
    assert.equal(pages.at(-1).nextCursor, null);
    assert.equal((await call(handler, `/api/requester/delivery-reports?attemptId=${orphanId}`)).statusCode, 404);
    assert.equal((await call(handler, `/api/requester/delivery-reports?attemptId=${conflictId}`)).statusCode, 404);
    assert.equal((await call(handler, `/api/requester/delivery-reports?attemptId=${malformedId}`)).statusCode, 404);
    assert.equal((await call(handler, `/api/requester/delivery-reports?attemptId=${oversizedMalformedId}`)).statusCode, 400);
    assert.equal((await call(handler, `/api/requester/delivery-reports?orderId=${conflictOrder}`)).statusCode, 404);
    assert.equal((await call(handler, `/api/requester/delivery-reports?cursor=${otherId}`)).statusCode, 400);
    const otherFeed = await call(handler, '/api/requester/delivery-reports', 'other-token');
    assert.deepEqual(otherFeed.body.reports.map((report) => report.attemptId), [otherId]);
    const after = await Promise.all([validId, orphanId, conflictId, malformedId, oversizedMalformedId].map(async (id) =>
      (await db.collection('deliveryAttempts').doc(id).get()).updateTime.toMillis()));
    assert.deepEqual(after, before);
  } finally {
    await deleteAdminApp(app);
  }
});

test('real completion feed paginates immutable decisions and skips invalid or cross-requester records', { skip: !host }, async () => {
  const suffix = randomUUID();
  const app = initializeAdminApp({ projectId: 'demo-bluetap' }, `requester-completions-${suffix}`);
  const db = getAdminFirestore(app);
  const uid = `r-${suffix}`;
  const otherUid = `other-${suffix}`;
  const orderId = `order-${suffix}`;
  const otherOrderId = `other-order-${suffix}`;
  const ids = [1, 2, 3].map((number) => attemptIdFor(orderId, number));
  const otherId = attemptIdFor(otherOrderId, 1);
  const reason = 'The delivery and response records were reviewed together.';
  const auth = { async verifyIdToken(token) {
    if (token === 'owner') return { uid };
    if (token === 'other') return { uid: otherUid };
    throw new Error('Invalid token.');
  } };
  const handler = createRequesterDeliveryReportsHandler(() => ({ auth, db }));
  const seed = async (id, number, owner, order, withEvent = true) => {
    const decidedAt = new Date(`2026-10-2${number}T12:00:00.000Z`);
    const decision = { managerUid: 'manager', responsibility: 'shared', decisionReason: reason,
      expectedRevision: `revision-${number}`, clientMutationId: `mutation-${number}`, decidedAt };
    await db.collection('deliveryAttempts').doc(id).set({ orderId: order, requesterUid: owner,
      branchId: 'original-branch', attemptNumber: number, outcome: 'failed', reviewState: 'resolved',
      responsibility: 'shared', managerDecision: decision,
      endedAt: new Date('2026-10-20T12:00:00.000Z'), reportReceivedAt: new Date('2026-10-20T12:00:00.000Z'),
      reportedReasonCode: 'NO_RESPONSE' });
    if (withEvent) await db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(id)).set({
      schemaVersion: 1, kind: 'MANAGER_DELIVERY_DECISION', attemptId: id, orderId: order, attemptNumber: number,
      branchId: 'original-branch', managerUid: 'manager', actorUid: 'manager', actorRole: 'manager',
      previousReviewState: 'reported', reviewState: 'resolved', responsibility: 'shared',
      decisionReason: reason, expectedRevision: decision.expectedRevision,
      clientMutationId: decision.clientMutationId, createdAt: decidedAt,
    });
  };
  try {
    await Promise.all([
      db.collection('users').doc(uid).set({ role: 'requester', accountStatus: 'active' }),
      db.collection('users').doc(otherUid).set({ role: 'requester', accountStatus: 'active' }),
      db.collection('requests').doc(orderId).set({ requesterUid: uid, requester_id: uid }),
      db.collection('requests').doc(otherOrderId).set({ requesterUid: otherUid, requester_id: otherUid }),
    ]);
    await seed(ids[0], 1, uid, orderId);
    await seed(ids[1], 2, uid, orderId, false);
    await seed(ids[2], 3, uid, orderId);
    await seed(otherId, 1, otherUid, otherOrderId);
    const before = (await db.collection('deliveryAttempts').doc(ids[2]).get()).updateTime.toMillis();
    const first = await call(handler, '/api/requester/delivery-reports?feed=review-completions&limit=1', 'owner');
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.completions.map((item) => item.attemptId), [ids[2]]);
    const skipped = await call(handler, `/api/requester/delivery-reports?feed=review-completions&limit=1&cursor=${first.body.nextCursor}`, 'owner');
    assert.deepEqual(skipped.body.completions, []);
    assert.equal(skipped.body.nextCursor, ids[1]);
    const last = await call(handler, `/api/requester/delivery-reports?feed=review-completions&limit=1&cursor=${skipped.body.nextCursor}`, 'owner');
    assert.deepEqual(last.body.completions.map((item) => item.attemptId), [ids[0]]);
    assert.equal(last.body.nextCursor, null);
    assert.equal((await call(handler, `/api/requester/delivery-reports?feed=review-completions&cursor=${otherId}`, 'owner')).statusCode, 400);
    assert.equal((await call(handler, `/api/requester/delivery-reports?attemptId=${otherId}`, 'owner')).statusCode, 404);
    assert.equal((await call(handler, `/api/requester/delivery-reports?attemptId=${ids[1]}`, 'owner')).statusCode, 404);
    assert.equal((await db.collection('deliveryAttempts').doc(ids[2]).get()).updateTime.toMillis(), before);
  } finally { await deleteAdminApp(app); }
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
  const responseTime = new Date('2026-10-21T12:00:00.000Z');
  const handler = createRequesterDeliveryReportsHandler(() => ({ auth, db }), () => responseTime);
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
        endedAt: new Date('2026-10-20T12:00:00.000Z'), reportReceivedAt: new Date('2026-10-20T12:00:00.000Z'), reportedReasonCode: 'RECIPIENT_REFUSED',
        reportFormat: 'structured-v1', reportEvidence: { interactionNote: 'private distributor description' } }),
    ]);
    const orderBefore = (await db.collection('requests').doc(orderId).get()).updateTime.toMillis();
    const userBefore = (await db.collection('users').doc(uid).get()).updateTime.toMillis();
    const started = responseTime.getTime();
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
      outcome: 'failed', reviewState: 'reported', responsibility: 'undetermined', endedAt: responseTime,
      reportReceivedAt: responseTime });
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
