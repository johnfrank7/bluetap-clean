const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createDistributorAssignedOrdersHandler } = require('../../distributor/assignedOrdersHandler');
const { CONVERSATION_TYPES } = require('../../chat/chatAuthorization');
const { authorityKeyHash, buildConversationFoundation } = require('../../chat/conversationService');
const { hashId } = require('../../moderation/moderationService');

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
    const failed = await call(handler, orderId, 'fail-delivery', { failureReasonCode: 'NO_RESPONSE' });
    assert.equal(failed.statusCode, 200, JSON.stringify(failed.body));
    const order = (await db.collection('requests').doc(orderId).get()).data();
    const attempt = (await db.collection('deliveryAttempts').doc(attemptId).get()).data();
    const review = (await db.collection('orderAbuseReviews').doc(hashId(branchId, requesterUid)).get()).data();
    const conversation = (await db.collection('chatConversations').doc(conversationId).get()).data();
    assert.equal(order.status, 'delivery_failed');
    assert.equal(order.activeDeliveryAttemptId, null);
    assert.equal(attempt.outcome, 'failed');
    assert.equal(attempt.responsibility, 'undetermined');
    assert.equal(review.incidentCount, 1);
    assert.equal(conversation.lifecycleReason, 'delivery_failed_grace');
    assert.equal((await db.collection('deliveryAttemptEvents').doc(`${attemptId}_outcome`).get()).data().kind, 'ATTEMPT_FAILED');
  } finally {
    await deleteApp(app);
  }
});
