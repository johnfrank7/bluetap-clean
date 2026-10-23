const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getFirestore: getAdminFirestore } = require('firebase-admin/firestore');
const { initializeApp: initializeClientApp, deleteApp: deleteClientApp } = require('firebase/app');
const { getFirestore: getClientFirestore, connectFirestoreEmulator, doc, getDoc, terminate } = require('firebase/firestore');
const { createManagerDeliveryReviewsHandler } = require('../../manager/deliveryReviewsHandler');
const { attemptIdFor } = require('../deliveryAttemptService');

const host = process.env.FIRESTORE_EMULATOR_HOST;

async function call(handler, url, token = 'manager-one') {
  const res = { statusCode: 200, body: null, headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
  await handler({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }, res);
  return res;
}

test('real Firestore branch query, transferred order authority, privacy, and client-deny rules', { skip: !host }, async () => {
  const suffix = randomUUID();
  const projectId = 'demo-bluetap';
  const app = initializeAdminApp({ projectId }, `manager-review-${suffix}`);
  const db = getAdminFirestore(app);
  const clientApp = initializeClientApp({ projectId }, `manager-review-client-${suffix}`);
  const clientDb = getClientFirestore(clientApp);
  const [hostname, port] = host.split(':');
  const managerUid = `m-${suffix}`;
  const otherManagerUid = `other-m-${suffix}`;
  const reporterUid = `d-${suffix}`;
  const requesterUid = `r-${suffix}`;
  const originalBranch = `original-${suffix}`;
  const newBranch = `new-${suffix}`;
  const orderId = `old-${suffix}`;
  const validId = attemptIdFor(orderId, 1);
  const orphanId = attemptIdFor(`missing-${suffix}`, 1);
  const receivedAt = new Date('2026-10-20T12:00:00.000Z');
  const now = () => new Date('2026-10-21T12:00:00.000Z');
  connectFirestoreEmulator(clientDb, hostname, Number(port), { mockUserToken: { sub: managerUid, user_id: managerUid, manager: true } });
  const auth = { async verifyIdToken(token, checkRevoked) {
    assert.equal(checkRevoked, true);
    if (token === 'manager-one') return { uid: managerUid, role: 'manager' };
    if (token === 'manager-two') return { uid: otherManagerUid, role: 'manager' };
    if (token === 'reporter-now-manager') return { uid: reporterUid, role: 'manager' };
    throw new Error('invalid token');
  }, async getUser() { return { disabled: false }; } };
  const handler = createManagerDeliveryReviewsHandler(() => ({ auth, db }), now);
  try {
    await Promise.all([
      db.collection('users').doc(managerUid).set({ role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: originalBranch }),
      db.collection('users').doc(otherManagerUid).set({ role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: newBranch }),
      db.collection('users').doc(reporterUid).set({ role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: originalBranch }),
      db.collection('branches').doc(originalBranch).set({ status: 'active' }),
      db.collection('branches').doc(newBranch).set({ status: 'active' }),
      db.collection('requests').doc(orderId).set({ requesterUid, requester_id: requesterUid, requestId: 'Req-History',
        branchId: newBranch, currentBranchId: newBranch, status: 'delivered' }),
      db.collection('deliveryAttempts').doc(validId).set({ orderId, requesterUid, distributorUid: reporterUid,
        branchId: originalBranch, attemptNumber: 1, outcome: 'failed', reviewState: 'reported',
        responsibility: 'undetermined', endedAt: receivedAt, reportReceivedAt: receivedAt,
        reportedReasonCode: 'NO_RESPONSE', reportFormat: 'structured-v1',
        reportEvidence: { contactAttempts: [{ method: 'PHONE_CALL', outcome: 'NO_ANSWER', claimedAt: receivedAt.toISOString() }] },
        outcomeMutationId: 'private_report_mutation' }),
      db.collection('deliveryAttempts').doc(orphanId).set({ orderId: `missing-${suffix}`, requesterUid,
        distributorUid: reporterUid, branchId: originalBranch, attemptNumber: 1, outcome: 'failed',
        reviewState: 'reported', responsibility: 'undetermined', endedAt: new Date('2026-10-21T12:00:00.000Z'),
        reportReceivedAt: receivedAt, reportedReasonCode: 'NO_RESPONSE' }),
      db.collection('deliveryAttemptEvents').doc(`${validId}_outcome`).set({ attemptId: validId, kind: 'ATTEMPT_FAILED',
        branchId: originalBranch, orderId, distributorUid: reporterUid, privateEvidence: 'not for clients' }),
    ]);
    const attemptRef = db.collection('deliveryAttempts').doc(validId);
    const before = (await attemptRef.get()).updateTime.toMillis();
    const empty = await call(handler, '/api/manager/delivery-reviews?limit=1');
    assert.equal(empty.statusCode, 200, JSON.stringify(empty.body));
    assert.deepEqual(empty.body.reviews, []);
    assert.equal(empty.body.nextCursor, orphanId);
    const second = await call(handler, `/api/manager/delivery-reviews?limit=1&cursor=${empty.body.nextCursor}`);
    assert.equal(second.statusCode, 200, JSON.stringify(second.body));
    assert.equal(second.body.reviews[0].attemptId, validId);
    assert.equal(second.body.nextCursor, null);
    const detail = await call(handler, `/api/manager/delivery-reviews?attemptId=${validId}`);
    assert.equal(detail.statusCode, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.review.orderReference, 'Req-History');
    assert.equal(detail.body.review.reportingBranchId, originalBranch);
    assert.equal(detail.body.review.responseDeadlineAt, '2026-10-23T12:00:00.000Z');
    assert.equal(detail.body.review.canFinalizeNow, false);
    assert.equal(detail.body.review.contactAttempts[0].claimedAtUnverified, true);
    assert.ok(!JSON.stringify(detail.body).includes('private_report_mutation'));
    assert.equal((await call(handler, `/api/manager/delivery-reviews?attemptId=${validId}`, 'manager-two')).statusCode, 404);
    assert.equal((await call(handler, `/api/manager/delivery-reviews?attemptId=${validId}`, 'reporter-now-manager')).statusCode, 404);
    assert.deepEqual((await call(handler, '/api/manager/delivery-reviews', 'reporter-now-manager')).body.reviews, []);
    assert.equal((await attemptRef.get()).updateTime.toMillis(), before);
    for (const path of [`deliveryAttempts/${validId}`, `deliveryAttemptEvents/${validId}_outcome`]) {
      await assert.rejects(getDoc(doc(clientDb, path)), (error) => error.code === 'permission-denied');
    }
  } finally {
    await terminate(clientDb);
    await deleteClientApp(clientApp);
    await deleteAdminApp(app);
  }
});
