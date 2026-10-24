const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createDistributorDeliveryReviewsHandler } = require('../../distributor/deliveryReviewsHandler');
const { attemptIdFor } = require('../deliveryAttemptService');
const { decisionEventIdFor } = require('../deliveryReviewPolicy');

const host = process.env.FIRESTORE_EMULATOR_HOST;
const responsibilities = ['requester_responsible', 'provider_responsible', 'shared', 'undetermined'];
const reason = 'The delivery records and statements were reviewed together.';

async function call(handler, url, token = 'reporter', method = 'GET') {
  const res = { statusCode: 200, body: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }, end() { return this; } };
  await handler({ method, url, headers: { authorization: `Bearer ${token}` } }, res);
  return res;
}

test('real Distributor review reads use original reporter identity, immutable decisions, bounded pages and no writes',
  { skip: !host }, async () => {
    const suffix = randomUUID();
    const app = initializeApp({ projectId: 'demo-bluetap' }, `distributor-reviews-${suffix}`);
    const db = getFirestore(app);
    const ids = { reporter: `d1-${suffix}`, sameBranch: `d2-${suffix}`, requester: `r-${suffix}`,
      originalBranch: `b1-${suffix}`, transferredBranch: `b2-${suffix}`, order: `order-${suffix}` };
    const auth = { async verifyIdToken(token, revoked) {
      assert.equal(revoked, true);
      if (token === 'reporter') return { uid: ids.reporter };
      if (token === 'same-branch') return { uid: ids.sameBranch };
      if (token === 'requester') return { uid: ids.requester };
      throw new Error('Invalid token.');
    }, async getUser() { return { disabled: false }; },
    async updateUser() { throw new Error('Read API must not update Auth.'); } };
    const handler = createDistributorDeliveryReviewsHandler(() => ({ auth, db }));
    const attemptId = (number) => attemptIdFor(ids.order, number);
    const seed = async (number, responsibility = null, options = {}) => {
      const id = attemptId(number);
      const decidedAt = new Date(`2026-10-${String(20 + number).padStart(2, '0')}T12:00:00.000Z`);
      const decision = responsibility === null ? null : { managerUid: 'manager', responsibility,
        decisionReason: reason, expectedRevision: `revision-${number}`,
        clientMutationId: `mutation-${number}`, decidedAt };
      await db.collection('deliveryAttempts').doc(id).set({ orderId: ids.order,
        requesterUid: ids.requester, distributorUid: options.distributorUid || ids.reporter,
        branchId: ids.originalBranch, attemptNumber: number, outcome: 'failed',
        reviewState: decision ? 'resolved' : 'reported', responsibility: responsibility || 'undetermined',
        ...(decision ? { managerDecision: decision } : {}),
        requesterResponse: { status: 'submitted', requesterUid: ids.requester,
          explanation: 'Private requester response for manager review.',
          clientMutationId: 'private-response-id' }, privateEvidence: 'private-evidence',
        endedAt: new Date('2026-10-20T12:00:00.000Z') });
      if (decision && !options.omitEvent) await db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(id)).set({
        schemaVersion: 1, kind: 'MANAGER_DELIVERY_DECISION', attemptId: id,
        orderId: options.mismatchEvent ? 'wrong-order' : ids.order, attemptNumber: number,
        branchId: ids.originalBranch, managerUid: 'manager', actorUid: 'manager', actorRole: 'manager',
        previousReviewState: 'reported', reviewState: 'resolved', responsibility,
        decisionReason: reason, expectedRevision: decision.expectedRevision,
        clientMutationId: decision.clientMutationId, createdAt: decidedAt,
      });
      return id;
    };
    try {
      await Promise.all([
        db.collection('users').doc(ids.reporter).set({ role: 'distributor', accountStatus: 'active',
          distributorStatus: 'active', branchId: ids.originalBranch }),
        db.collection('users').doc(ids.sameBranch).set({ role: 'distributor', accountStatus: 'active',
          distributorStatus: 'active', branchId: ids.originalBranch }),
        db.collection('users').doc(ids.requester).set({ role: 'requester', accountStatus: 'active' }),
        db.collection('branches').doc(ids.originalBranch).set({ status: 'active' }),
        db.collection('branches').doc(ids.transferredBranch).set({ status: 'active' }),
        db.collection('requests').doc(ids.order).set({ requesterUid: ids.requester,
          requester_id: ids.requester, requestId: 'Transferred #1',
          branchId: ids.transferredBranch, currentBranchId: ids.transferredBranch,
          assignedDistributorUid: ids.sameBranch }),
      ]);
      await seed(1);
      for (let index = 0; index < responsibilities.length; index += 1) await seed(index + 2, responsibilities[index]);
      await seed(6, 'shared', { omitEvent: true });
      await seed(7, 'shared', { mismatchEvent: true });
      await seed(8, 'shared', { distributorUid: ids.sameBranch });
      const before = (await db.collection('deliveryAttempts').doc(attemptId(2)).get()).updateTime.toMillis();
      const pending = await call(handler, `/api/distributor/delivery-reviews?attemptId=${attemptId(1)}`);
      assert.equal(pending.statusCode, 200, JSON.stringify(pending.body));
      assert.equal(pending.body.review.reviewStatus, 'pending_review');
      assert.equal(pending.body.review.responsibility, undefined);
      for (let index = 0; index < responsibilities.length; index += 1) {
        const result = await call(handler, `/api/distributor/delivery-reviews?attemptId=${attemptId(index + 2)}`);
        assert.equal(result.statusCode, 200, JSON.stringify(result.body));
        assert.deepEqual(Object.keys(result.body.review).sort(),
          ['attemptId', 'orderId', 'orderReference', 'reviewStatus', 'summary', 'responsibility', 'decidedAt'].sort());
        assert.equal(result.body.review.responsibility, responsibilities[index]);
        assert.equal(result.body.review.reviewStatus, 'completed');
        for (const privateValue of ['Private requester', 'private-response-id', 'private-evidence',
          'mutation-', 'revision-', reason, 'manager']) {
          assert.ok(!JSON.stringify(result.body).includes(privateValue));
        }
      }
      for (const number of [6, 7, 8]) {
        assert.equal((await call(handler, `/api/distributor/delivery-reviews?attemptId=${attemptId(number)}`)).statusCode, 404);
      }
      assert.equal((await call(handler, `/api/distributor/delivery-reviews?attemptId=${attemptId(2)}`, 'same-branch')).statusCode, 404);
      assert.equal((await call(handler, `/api/distributor/delivery-reviews?attemptId=${attemptId(2)}`, 'requester')).statusCode, 403);
      assert.equal((await call(handler, '/api/distributor/delivery-reviews', 'same-branch')).body.reviews.length, 1);
      await db.collection('users').doc(ids.reporter).update({ branchId: ids.transferredBranch });
      assert.equal((await call(handler, `/api/distributor/delivery-reviews?attemptId=${attemptId(2)}`)).statusCode, 200);
      await db.collection('users').doc(ids.reporter).update({ accountStatus: 'inactive' });
      assert.equal((await call(handler, `/api/distributor/delivery-reviews?attemptId=${attemptId(2)}`)).statusCode, 403);
      await db.collection('users').doc(ids.reporter).update({ accountStatus: 'active', role: 'manager' });
      assert.equal((await call(handler, `/api/distributor/delivery-reviews?attemptId=${attemptId(2)}`)).statusCode, 403);
      await db.collection('users').doc(ids.reporter).update({ role: 'distributor' });
      const found = new Map();
      let cursor = '';
      for (let page = 0; page < 12; page += 1) {
        const result = await call(handler, `/api/distributor/delivery-reviews?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
        assert.equal(result.statusCode, 200, JSON.stringify(result.body));
        assert.ok(result.body.reviews.length <= 1);
        for (const review of result.body.reviews) found.set(review.attemptId, review);
        cursor = result.body.nextCursor;
        if (!cursor) break;
      }
      assert.equal(found.size, 5);
      assert.equal(found.has(attemptId(8)), false);
      assert.equal((await call(handler, `/api/distributor/delivery-reviews?cursor=${attemptId(8)}`)).statusCode, 400);
      assert.equal((await call(handler, `/api/distributor/delivery-reviews?attemptId=${attemptId(6)}&limit=5`)).statusCode, 400);
      assert.equal((await call(handler, '/api/distributor/delivery-reviews', 'reporter', 'POST')).statusCode, 405);
      await db.collection('deliveryAttempts').doc(attemptId(1)).delete();
      assert.equal((await call(handler, `/api/distributor/delivery-reviews?attemptId=${attemptId(1)}`)).statusCode, 404);
      assert.equal((await db.collection('deliveryAttempts').doc(attemptId(2)).get()).updateTime.toMillis(), before);
      assert.equal((await db.collection('moderationActions').where('targetUid', '==', ids.requester).get()).size, 0);
      assert.equal((await db.collection('orderingRestrictions').doc(ids.requester).get()).exists, false);
    } finally { await deleteApp(app); }
  });
