const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { applyModerationAction } = require('../moderationHandler');
const { hashId } = require('../moderationService');
const { attemptIdFor } = require('../../delivery/deliveryAttemptService');
const { decisionEventIdFor } = require('../../delivery/deliveryReviewPolicy');
const { submitRequesterAppeal } = require('../../delivery/requesterDeliveryAppealService');
const { resolveAdminAppeal } = require('../../delivery/adminDeliveryAppealService');

const host = process.env.FIRESTORE_EMULATOR_HOST;

async function seed(db, suffix, responsibility = 'requester_responsible') {
  const branchId = `branch-${suffix}`;
  const requesterUid = `requester-${suffix}`;
  const orderId = `order-${suffix}`;
  const attemptId = attemptIdFor(orderId, 1);
  const reviewId = hashId(branchId, requesterUid);
  const incidentId = hashId('delivery_failure', attemptId);
  const reportAt = new Date('2026-10-01T00:00:00Z');
  const decidedAt = new Date('2026-10-04T00:00:00Z');
  const managerUid = `manager-${suffix}`;
  const distributorUid = `distributor-${suffix}`;
  const decisionReason = 'Factual responsibility review';
  const managerDecision = { managerUid, responsibility, decisionReason,
    expectedRevision: 'revision-a', clientMutationId: 'decision-a', decidedAt };
  await Promise.all([
    db.collection('users').doc(requesterUid).set({ role: 'requester', accountStatus: 'active', publicUid: 'Req001' }),
    db.collection('users').doc(managerUid).set({ role: 'manager', accountStatus: 'active',
      managerStatus: 'active', branchId }),
    db.collection('branches').doc(branchId).set({ status: 'active' }),
    db.collection('requests').doc(orderId).set({ requesterUid, branchId, currentBranchId: `transferred-${suffix}`, status: 'delivery_failed' }),
    db.collection('orderAbuseReviews').doc(reviewId).set({ requesterUid, branchId, status: 'open',
      incidentCount: 99, severity: 'strong_review', incidents: [{ key: incidentId, incidentId,
        type: 'delivery_failure', orderId, attemptId, requesterUid, reportingBranchId: branchId,
        sourceEventId: `${attemptId}_outcome`, category: 'NO_RESPONSE', stage: 'out_for_delivery',
        concern: 'moderate', at: reportAt }] }),
    db.collection('deliveryAttempts').doc(attemptId).set({ orderId, requesterUid, branchId,
      distributorUid, attemptNumber: 1, outcome: 'failed', reviewState: 'resolved',
      responsibility, reportedReasonCode: 'NO_RESPONSE', reportReceivedAt: reportAt, managerDecision }),
    db.collection('deliveryAttemptEvents').doc(`${attemptId}_outcome`).set({ schemaVersion: 1,
      kind: 'ATTEMPT_FAILED', attemptId, attemptNumber: 1, orderId, branchId, distributorUid,
      actorUid: distributorUid, actorRole: 'distributor', outcome: 'failed',
      reportedReasonCode: 'NO_RESPONSE', createdAt: reportAt, reportReceivedAt: reportAt }),
    db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(attemptId)).set({ schemaVersion: 1,
      kind: 'MANAGER_DELIVERY_DECISION', attemptId, attemptNumber: 1, orderId, branchId,
      managerUid, actorUid: managerUid, actorRole: 'manager', previousReviewState: 'reported',
      reviewState: 'resolved', responsibility, decisionReason, expectedRevision: 'revision-a',
      clientMutationId: 'decision-a', createdAt: decidedAt }),
  ]);
  return { branchId, requesterUid, orderId, attemptId, reviewId, incidentId, managerUid,
    managerDecision, decidedAt, decisionReason };
}

test('real Firestore verifies exact moderation grounds atomically and holds abuse account actions', { skip: !host }, async () => {
  const app = initializeApp({ projectId: 'demo-bluetap' }, `moderation-grounds-${randomUUID()}`);
  const db = getFirestore(app);
  const authCalls = [];
  const auth = { updateUser: async (...args) => authCalls.push(['updateUser', ...args]),
    revokeRefreshTokens: async (...args) => authCalls.push(['revokeRefreshTokens', ...args]) };
  const admin = { uid: `admin-${randomUUID()}`, profile: { publicUid: 'Adm001' } };
  const apply = (review, action, incidentIds, mutation, actionId, role = 'admin') => applyModerationAction({
    auth, db, actor: role === 'admin' ? admin : { decoded: { uid: `manager-${review.requesterUid.slice(10)}` },
      profile: { publicUid: 'Man001' }, branch: { id: review.branchId, name: 'BlueTap A' } },
    actorRole: role, actorBranch: role === 'admin' ? null : { id: review.branchId, name: 'BlueTap A' },
    body: { abuseReviewId: review.reviewId, action, reason: 'Verified case-specific evidence',
      clientMutationId: mutation, ...(incidentIds === undefined ? {} : { incidentIds }),
      ...(action.includes('ordering') ? { durationDays: 1 } : {}) },
    now: new Date('2026-10-05T00:00:00Z'), createActionId: () => actionId,
  });
  try {
    await db.collection('users').doc(admin.uid).set({ role: 'admin', accountStatus: 'active' });
    const valid = await seed(db, randomUUID());
    const accepted = await apply(valid, 'warn', [valid.incidentId], 'valid-mutation', 'valid-action', 'manager');
    assert.equal(accepted.created, true);
    assert.deepEqual((await db.collection('moderationActions').doc('valid-action').get()).data().selectedIncidentIds, [valid.incidentId]);
    assert.equal((await apply(valid, 'warn', [valid.incidentId], 'valid-mutation', 'valid-action', 'manager')).created, false);
    await assert.rejects(apply(valid, 'warn', ['a'.repeat(64)], 'valid-mutation', 'valid-action', 'manager'),
      (error) => error.reason === 'MODERATION_MUTATION_CONFLICT');

    const rejected = await seed(db, randomUUID(), 'provider_responsible');
    const beforeReview = await db.collection('orderAbuseReviews').doc(rejected.reviewId).get();
    for (const action of ['suspend_account', 'terminate_account']) {
      await assert.rejects(apply(rejected, action, [rejected.incidentId], `held-${action}`, `held-${action}`),
        (error) => error.reason === 'ABUSE_ACCOUNT_ACTION_TEMPORARILY_UNAVAILABLE');
      assert.equal((await db.collection('moderationActions').doc(`held-${action}`).get()).exists, false);
    }
    await assert.rejects(apply(rejected, 'suspend_platform_ordering', [rejected.incidentId], 'rejected-mutation', 'rejected-action'),
      (error) => error.reason === 'MODERATION_GROUND_INELIGIBLE');
    assert.equal((await db.collection('moderationActions').doc('rejected-action').get()).exists, false);
    assert.equal((await db.collection('moderationMutationIds').doc(hashId(admin.uid, 'rejected-mutation')).get()).exists, false);
    assert.equal((await db.collection('orderingRestrictions').doc(rejected.requesterUid).get()).exists, false);
    assert.equal((await db.collection('moderationNotices').doc(rejected.requesterUid).collection('items').doc('rejected-action').get()).exists, false);
    assert.equal((await db.collection('moderationActivity').doc(`user_${rejected.requesterUid}`).get()).exists, false);
    assert.equal((await db.collection('orderAbuseReviews').doc(rejected.reviewId).get()).updateTime.toMillis(), beforeReview.updateTime.toMillis());
    assert.deepEqual(authCalls, []);
  } finally { await deleteApp(app); }
});

test('concurrent decision and moderation cannot commit an unverified ground', { skip: !host }, async () => {
  const app = initializeApp({ projectId: 'demo-bluetap' }, `moderation-race-${randomUUID()}`);
  const db = getFirestore(app);
  try {
    const record = await seed(db, randomUUID());
    const attemptRef = db.collection('deliveryAttempts').doc(record.attemptId);
    const decisionRef = db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(record.attemptId));
    await attemptRef.update({ reviewState: 'reported', responsibility: 'undetermined', managerDecision: null });
    await decisionRef.delete();
    const manager = { decoded: { uid: record.managerUid }, profile: { publicUid: 'Man001' },
      branch: { id: record.branchId, name: 'BlueTap A' } };
    const decide = db.runTransaction(async (tx) => {
      const current = await tx.get(attemptRef);
      assert.equal(current.data().reviewState, 'reported');
      tx.update(attemptRef, { reviewState: 'resolved', responsibility: 'requester_responsible',
        managerDecision: record.managerDecision });
      tx.create(decisionRef, { schemaVersion: 1, kind: 'MANAGER_DELIVERY_DECISION',
        attemptId: record.attemptId, attemptNumber: 1, orderId: record.orderId,
        branchId: record.branchId, managerUid: record.managerUid, actorUid: record.managerUid,
        actorRole: 'manager', previousReviewState: 'reported', reviewState: 'resolved',
        responsibility: 'requester_responsible', decisionReason: record.decisionReason,
        expectedRevision: 'revision-a', clientMutationId: 'decision-a', createdAt: record.decidedAt });
    });
    const moderate = applyModerationAction({ auth: { updateUser: async () => { throw new Error('Auth must not run'); } }, db,
      actor: manager, actorRole: 'manager', actorBranch: manager.branch,
      body: { abuseReviewId: record.reviewId, action: 'warn', incidentIds: [record.incidentId],
        reason: 'Verified case-specific evidence', clientMutationId: 'race-mutation' },
      now: new Date('2026-10-05T00:00:00Z'), createActionId: () => 'race-action' });
    const [decisionResult, moderationResult] = await Promise.allSettled([decide, moderate]);
    assert.equal(decisionResult.status, 'fulfilled');
    if (moderationResult.status === 'rejected') {
      assert.equal(moderationResult.reason.reason, 'MODERATION_GROUND_INELIGIBLE');
      assert.equal((await db.collection('moderationActions').doc('race-action').get()).exists, false);
    } else {
      assert.equal(moderationResult.value.created, true);
      assert.equal((await decisionRef.get()).exists, true);
      assert.equal((await attemptRef.get()).data().responsibility, 'requester_responsible');
    }
  } finally { await deleteApp(app); }
});

test('pending and overturned appeals cannot become future punitive delivery grounds', { skip: !host }, async () => {
  const app = initializeApp({ projectId: 'demo-bluetap' }, `appeal-ground-${randomUUID()}`);
  const db = getFirestore(app);
  try {
    const record = await seed(db, randomUUID());
    const adminUid = `appeal-admin-${randomUUID()}`;
    await db.collection('users').doc(adminUid).set({ role: 'admin', accountStatus: 'active' });
    const appeal = await submitRequesterAppeal(db, { uid: record.requesterUid }, {
      attemptId: record.attemptId, orderId: record.orderId,
      appealReason: 'I dispute this responsibility finding based on the delivery evidence.',
      clientMutationId: 'appeal-ground-submission-1',
    }, () => new Date('2026-10-04T01:00:00Z'));
    assert.equal(appeal.created, true);
    const manager = { decoded: { uid: record.managerUid }, profile: { publicUid: 'Man001' },
      branch: { id: record.branchId, name: 'BlueTap A' } };
    const tryWarning = (mutationId, actionId) => applyModerationAction({ db,
      auth: { updateUser: async () => { throw new Error('Auth must not run'); } },
      actor: manager, actorRole: 'manager', actorBranch: manager.branch,
      body: { abuseReviewId: record.reviewId, action: 'warn', incidentIds: [record.incidentId],
        reason: 'Verified case-specific evidence', clientMutationId: mutationId },
      now: new Date('2026-10-05T00:00:00Z'), createActionId: () => actionId,
    });
    await assert.rejects(tryWarning('pending-appeal-warning', 'pending-appeal-action'),
      (error) => error.reason === 'MODERATION_GROUND_INELIGIBLE');
    assert.equal((await db.collection('moderationActions').doc('pending-appeal-action').get()).exists, false);
    const resolved = await resolveAdminAppeal(db, { uid: adminUid }, {
      attemptId: record.attemptId, resolution: 'overturned',
      overturnedResponsibility: 'provider_responsible',
      resolutionReason: 'The factual evidence does not establish requester responsibility.',
      clientMutationId: 'appeal-ground-resolution-1',
    }, () => new Date('2026-10-04T02:00:00Z'));
    assert.equal(resolved.created, true);
    assert.equal((await db.collection('deliveryAttempts').doc(record.attemptId).get()).data().responsibility,
      'requester_responsible');
    assert.equal((await db.collection('deliveryAttempts').doc(record.attemptId).get()).data().effectiveResponsibility,
      'provider_responsible');
    await assert.rejects(tryWarning('overturned-appeal-warning', 'overturned-appeal-action'),
      (error) => error.reason === 'MODERATION_GROUND_INELIGIBLE');
    assert.equal((await db.collection('moderationActions').doc('overturned-appeal-action').get()).exists, false);
    assert.equal((await db.collection('orderingRestrictions').doc(record.requesterUid).get()).exists, false);
  } finally { await deleteApp(app); }
});
