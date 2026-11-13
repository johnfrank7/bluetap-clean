const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createDistributorAssignedOrdersHandler } = require('../../distributor/assignedOrdersHandler');
const { CONVERSATION_TYPES } = require('../../chat/chatAuthorization');
const { authorityKeyHash, buildConversationFoundation } = require('../../chat/conversationService');
const { hashId } = require('../../moderation/moderationService');
const { attemptIdFor } = require('../deliveryAttemptService');

const host = process.env.FIRESTORE_EMULATOR_HOST;

async function call(handler, orderId, action, extra = {}) {
  const res = { statusCode: 200, body: null, setHeader() {}, getHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'PATCH', headers: { authorization: 'Bearer emulator-token' }, body: { orderId, action, ...extra } }, res);
  return res;
}

test('real Firestore transaction atomically commits attempt, moderation, chat, and order without read-after-write', { skip: !host }, async () => {
  const app = initializeApp({ projectId: 'demo-bluetap' }, `delivery-attempt-${randomUUID()}`);
  const db = getFirestore(app);
  const suffix = randomUUID();
  const orderId = `order-${suffix}`;
  const requesterUid = `requester-${suffix}`;
  const distributorUid = `distributor-${suffix}`;
  const branchId = `branch-${suffix}`;
  const conversationId = `conversation-${suffix}`;
  const auth = { verifyIdToken: async () => ({ uid: distributorUid, role: 'distributor' }), getUser: async () => ({ disabled: false }) };
  const handler = createDistributorAssignedOrdersHandler(() => ({ auth, db }));
  try {
    await db.collection('branches').doc(branchId).set({ status: 'active' });
    await db.collection('users').doc(distributorUid).set({ role: 'distributor', approvalStatus: 'active', branchId, fullName: 'Emulator Distributor', phone: '09123456789', completeAddress: 'Test Address' });
    await db.collection('requests').doc(orderId).set({ requesterUid, branchId, currentBranchId: branchId, assignedDistributorUid: distributorUid, assignmentVersion: 1, status: 'accepted' });
    await db.collection('distributorDispatchGuards').doc(distributorUid).set({ schemaVersion: 1, initialized: true, distributorUid, revision: 0, reservations: [{ orderId, scheduledAt: null }] });
    const reviewRef = db.collection('orderAbuseReviews').doc(hashId(branchId, requesterUid));
    const historical = { key: `historical-${suffix}`, orderId, type: 'delivery_failure', category: 'NO_RESPONSE',
      at: new Date() };
    await reviewRef.set({ status: 'open', incidents: [historical] });
    const authority = { type: CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR, orderId, requesterUid, distributorUid, assignmentVersion: 1 };
    const hash = authorityKeyHash(authority.type, authority);
    await db.collection('chatAuthorityRegistry').doc(hash).set({ authorityKeyHash: hash, conversationId, type: authority.type });
    await db.collection('chatConversations').doc(conversationId).set(buildConversationFoundation({ type: authority.type, authority, createdBy: { uid: distributorUid, role: 'distributor' }, now: new Date() }));

    const starts = await Promise.all([call(handler, orderId, 'start-delivery'), call(handler, orderId, 'start-delivery')]);
    assert.deepEqual(starts.map((response) => response.statusCode).sort(), [200, 409]);
    const activeOrder = (await db.collection('requests').doc(orderId).get()).data();
    const attemptId = activeOrder.activeDeliveryAttemptId;
    assert.equal(activeOrder.deliveryAttemptSeq, 1);
    assert.equal((await db.collection('deliveryAttempts').doc(attemptId).get()).data().outcome, 'in_progress');

    assert.equal((await call(handler, orderId, 'fail-delivery', { failureReasonCode: 'INVALID' })).statusCode, 400);
    assert.equal((await db.collection('requests').doc(orderId).get()).data().status, 'out_for_delivery');
    const report = { failureReasonCode: 'NO_RESPONSE', clientMutationId: `report_${suffix}`,
      reportFormat: 'structured-v1', reportEvidence: { contactAttempts: [{ method: 'PHONE_CALL', outcome: 'NO_ANSWER', claimedAt: new Date().toISOString() }] } };
    const failed = await call(handler, orderId, 'fail-delivery', report);
    assert.equal(failed.statusCode, 200, JSON.stringify(failed.body));
    const order = (await db.collection('requests').doc(orderId).get()).data();
    const attempt = (await db.collection('deliveryAttempts').doc(attemptId).get()).data();
    const review = (await reviewRef.get()).data();
    const conversation = (await db.collection('chatConversations').doc(conversationId).get()).data();
    assert.equal(order.status, 'delivery_failed');
    assert.equal(order.activeDeliveryAttemptId, null);
    assert.equal(attempt.outcome, 'failed');
    assert.equal(attempt.responsibility, 'undetermined');
    assert.deepEqual(attempt.reportEvidence, report.reportEvidence);
    assert.equal(attempt.reportReceivedAt.toMillis(), order.deliveryFailedAt.toMillis());
    assert.equal(review.incidentCount, 2);
    assert.deepEqual({ ...review.incidents[0], at: review.incidents[0].at.toDate() }, historical);
    assert.equal(review.incidents[1].incidentId, hashId('delivery_failure', attemptId));
    assert.equal(review.incidents[1].key, review.incidents[1].incidentId);
    assert.equal(review.incidents[1].attemptId, attemptId);
    assert.equal(review.incidents[1].sourceEventId, `${attemptId}_outcome`);
    assert.equal(review.incidents[1].orderId, orderId);
    assert.equal(review.incidents[1].requesterUid, requesterUid);
    assert.equal(review.incidents[1].reportingBranchId, branchId);
    assert.equal('verified' in review.incidents[1], false);
    assert.equal(conversation.lifecycleReason, 'delivery_failed_grace');
    const eventSnapshot = await db.collection('deliveryAttemptEvents').doc(`${attemptId}_outcome`).get();
    assert.equal(eventSnapshot.data().kind, 'ATTEMPT_FAILED');
    assert.deepEqual(eventSnapshot.data().reportEvidence, report.reportEvidence);
    const replay = await call(handler, orderId, 'fail-delivery', report);
    assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
    assert.deepEqual(replay.body, failed.body);
    assert.equal((await db.collection('deliveryAttemptEvents').doc(`${attemptId}_outcome`).get()).updateTime.toMillis(), eventSnapshot.updateTime.toMillis());
    assert.equal((await reviewRef.get()).data().incidentCount, 2);
    assert.equal((await call(handler, orderId, 'reschedule-delivery', { scheduledAt: new Date(Date.now() + 3600000).toISOString() })).statusCode, 200);
    assert.equal((await call(handler, orderId, 'start-delivery')).statusCode, 200);
    const secondId = attemptIdFor(orderId, 2);
    assert.notEqual(secondId, attemptId);
    const secondReport = { ...report, clientMutationId: `second_${suffix}` };
    assert.equal((await call(handler, orderId, 'fail-delivery', secondReport)).statusCode, 200);
    const secondReview = (await reviewRef.get()).data();
    assert.equal(secondReview.incidentCount, 3);
    assert.deepEqual(secondReview.incidents.slice(1).map((item) => item.attemptId), [attemptId, secondId]);
    assert.equal(secondReview.incidents[2].sourceEventId, `${secondId}_outcome`);
    assert.equal((await db.collection('deliveryAttemptEvents').doc(`${secondId}_outcome`).get()).data().kind, 'ATTEMPT_FAILED');
    assert.equal((await call(handler, orderId, 'fail-delivery', secondReport)).statusCode, 200);
    assert.equal((await reviewRef.get()).data().incidentCount, 3);

    assert.equal((await call(handler, orderId, 'reschedule-delivery', { scheduledAt: new Date(Date.now() + 3600000).toISOString() })).statusCode, 200);
    assert.equal((await call(handler, orderId, 'start-delivery')).statusCode, 200);
    const thirdId = attemptIdFor(orderId, 3);
    await db.collection('deliveryAttempts').doc(thirdId).update({ requesterUid: 'forged-requester' });
    const before = await reviewRef.get();
    assert.equal((await call(handler, orderId, 'fail-delivery', { ...report, clientMutationId: `third_${suffix}` })).statusCode, 409);
    assert.equal((await reviewRef.get()).updateTime.toMillis(), before.updateTime.toMillis());
    assert.equal((await db.collection('deliveryAttemptEvents').doc(`${thirdId}_outcome`).get()).exists, false);
    assert.equal((await db.collection('requests').doc(orderId).get()).data().status, 'out_for_delivery');

    const legacyOrderId = `legacy-order-${suffix}`;
    await db.collection('requests').doc(legacyOrderId).set({ requesterUid, branchId, currentBranchId: branchId,
      assignedDistributorUid: distributorUid, assignmentVersion: 1, status: 'out_for_delivery' });
    const legacyReport = await call(handler, legacyOrderId, 'fail-delivery', { failureReasonCode: 'NO_RESPONSE' });
    assert.equal(legacyReport.statusCode, 200, JSON.stringify(legacyReport.body));
    const legacyAttemptId = attemptIdFor(legacyOrderId, 1);
    assert.equal((await db.collection('deliveryAttempts').doc(legacyAttemptId).get()).data().outcome, 'failed');
    assert.equal((await db.collection('deliveryAttemptEvents').doc(`${legacyAttemptId}_outcome`).get()).data().kind, 'ATTEMPT_FAILED');
    const legacyIncident = (await reviewRef.get()).data().incidents.at(-1);
    assert.equal(legacyIncident.attemptId, legacyAttemptId);
    assert.equal(legacyIncident.incidentId, hashId('delivery_failure', legacyAttemptId));
  } finally {
    await deleteApp(app);
  }
});
