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

async function call(handler, url, token = 'requester-token') {
  const res = {
    statusCode: 200, body: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; }, getHeader() {},
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; },
  };
  await handler({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} }, res);
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
