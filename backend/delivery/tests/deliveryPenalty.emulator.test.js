const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { attemptIdFor } = require('../deliveryAttemptService');
const { decisionEventIdFor } = require('../deliveryReviewPolicy');
const { appealSubmissionEventIdFor, appealResolutionEventIdFor } = require('../deliveryAppealPolicy');
const { revisionFor } = require('../managerDeliveryReviewService');
const { submitManagerDecision } = require('../managerDeliveryDecisionService');
const { submitRequesterAppeal } = require('../requesterDeliveryAppealService');
const { resolveAdminAppeal } = require('../adminDeliveryAppealService');
const { getAdminDeliveryPenaltyDetail, listAdminDeliveryPenaltyReviews } = require('../adminDeliveryAppealService');
const { currentVerifiedStreak, penaltyEventIdFor, secondReviewIdFor, PENALTY_MS } = require('../deliveryPenaltyService');
const { assertOrderingAllowed } = require('../../moderation/moderationService');
const { createAdminDeliveryAppealsHandler } = require('../../admin/deliveryAppealsHandler');
const { createModerationNoticesHandler } = require('../../moderation/moderationHandler');
const { createRequesterOrdersHandler } = require('../../requester/orderingHandler');

const host = process.env.FIRESTORE_EMULATOR_HOST;
const reason = 'The verified delivery evidence supports this responsibility decision.';
const at = (day) => new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`);
async function call(handler, token, url, method = 'GET', body = undefined) {
  const res = { statusCode: 200, body: null, setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }, end() { return this; } };
  await handler({ method, url, body, headers: { authorization: `Bearer ${token}` } }, res);
  return res;
}

async function fixture(outcomes = ['requester_responsible', 'requester_responsible', 'reported']) {
  const suffix = randomUUID();
  const app = initializeApp({ projectId: 'demo-bluetap' }, `delivery-penalty-${suffix}`);
  const db = getFirestore(app);
  const ids = { requester: `requester-${suffix}`, manager: `manager-${suffix}`,
    admin: `admin-${suffix}`, distributor: `distributor-${suffix}`, branch: `branch-${suffix}` };
  await Promise.all([
    db.collection('users').doc(ids.requester).set({ role: 'requester', accountStatus: 'active' }),
    db.collection('users').doc(ids.manager).set({ role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: ids.branch }),
    db.collection('users').doc(ids.admin).set({ role: 'admin', accountStatus: 'active' }),
    db.collection('branches').doc(ids.branch).set({ status: 'active' }),
  ]);
  const attempts = [];
  for (let index = 0; index < outcomes.length; index += 1) {
    const orderId = `order-${index}-${suffix}`;
    const attemptId = attemptIdFor(orderId, 1);
    const reportAt = at(index + 1);
    const responsibility = outcomes[index];
    const decidedAt = at(index + 5);
    const managerDecision = responsibility === 'reported' ? null : {
      managerUid: ids.manager, responsibility, decisionReason: reason,
      expectedRevision: `revision-${index}`, clientMutationId: `decision-${index}`, decidedAt,
    };
    await Promise.all([
      db.collection('requests').doc(orderId).set({ requesterUid: ids.requester, requester_id: ids.requester,
        branchId: ids.branch, status: 'delivery_failed' }),
      db.collection('deliveryAttempts').doc(attemptId).set({ schemaVersion: 1, orderId,
        requesterUid: ids.requester, distributorUid: ids.distributor, branchId: ids.branch,
        attemptNumber: 1, outcome: 'failed', endedAt: reportAt, reportReceivedAt: reportAt,
        reportedReasonCode: 'NO_RESPONSE', reviewState: managerDecision ? 'resolved' : 'reported',
        responsibility: managerDecision ? responsibility : 'undetermined', managerDecision }),
      db.collection('deliveryAttemptEvents').doc(`${attemptId}_outcome`).set({ schemaVersion: 1,
        kind: 'ATTEMPT_FAILED', attemptId, attemptNumber: 1, orderId, branchId: ids.branch,
        distributorUid: ids.distributor, actorUid: ids.distributor, actorRole: 'distributor',
        outcome: 'failed', reportedReasonCode: 'NO_RESPONSE', reportReceivedAt: reportAt, createdAt: reportAt }),
      ...(managerDecision ? [db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(attemptId)).set({
        schemaVersion: 1, kind: 'MANAGER_DELIVERY_DECISION', attemptId, attemptNumber: 1, orderId,
        branchId: ids.branch, managerUid: ids.manager, actorUid: ids.manager, actorRole: 'manager',
        previousReviewState: 'reported', reviewState: 'resolved', responsibility,
        decisionReason: reason, expectedRevision: managerDecision.expectedRevision,
        clientMutationId: managerDecision.clientMutationId, createdAt: decidedAt,
      })] : []),
    ]);
    attempts.push({ orderId, attemptId, reportAt });
  }
  const manager = { decoded: { uid: ids.manager }, branch: { id: ids.branch } };
  async function decide(index, responsibility = 'requester_responsible', now = at(10)) {
    const target = attempts[index];
    const snapshot = await db.collection('deliveryAttempts').doc(target.attemptId).get();
    const payload = { attemptId: target.attemptId, orderId: target.orderId, responsibility,
      decisionReason: reason, expectedRevision: revisionFor(snapshot), clientMutationId: `manager-final-${index}` };
    return { payload, result: await submitManagerDecision(db, manager, payload, () => now) };
  }
  return { app, db, ids, attempts, decide };
}

test('three canonical distinct orders create one 72-hour restriction; exact replay never extends it', { skip: !host }, async () => {
  const f = await fixture();
  try {
    const before = await currentVerifiedStreak({ get: (ref) => ref.get() }, f.db, f.ids.requester);
    assert.equal(before.count, 0); // An unresolved newer failure blocks a consecutive verified streak.
    assert.equal((await f.db.collection('orderingRestrictions').doc(f.ids.requester).get()).exists, false);
    const decisionAt = new Date();
    const duringRestriction = new Date(decisionAt.getTime() + 24 * 60 * 60 * 1000);
    const decision = await f.decide(2, 'requester_responsible', decisionAt);
    assert.equal(decision.result.decision.responsibility, 'requester_responsible');
    const after = await currentVerifiedStreak({ get: (ref) => ref.get() }, f.db, f.ids.requester);
    assert.equal(after.count, 3, JSON.stringify(after));
    const stateRef = f.db.collection('orderingRestrictions').doc(f.ids.requester);
    const state = await stateRef.get();
    const penalty = state.data().deliveryPenalty;
    assert.equal(penalty.state, 'active');
    assert.equal(penalty.endsAt.toMillis() - penalty.startsAt.toMillis(), PENALTY_MS);
    assert.deepEqual(penalty.supportingAttemptIds, f.attempts.map((item) => item.attemptId));
    const eventRef = f.db.collection('deliveryPenaltyEvents').doc(penaltyEventIdFor(f.ids.requester));
    const event = await eventRef.get();
    assert.equal(event.exists, true);
    assert.deepEqual(event.data().incidents.map((item) => item.orderId), f.attempts.map((item) => item.orderId));
    assert.equal((await f.db.collection('users').doc(f.ids.requester).get()).data().accountStatus, 'active');
    const adminView = await getAdminDeliveryPenaltyDetail(f.db, { uid: f.ids.admin }, f.ids.requester, duringRestriction);
    assert.equal(adminView.verifiedStreak, 3);
    assert.equal(adminView.restriction.state, 'active');
    assert.equal(adminView.supportingIncidents.length, 3);
    await assert.rejects(getAdminDeliveryPenaltyDetail(f.db, { uid: f.ids.requester }, f.ids.requester),
      (error) => error.status === 403);
    const auth = { verifyIdToken: async (token) => token === 'admin'
      ? { uid: f.ids.admin, admin: true } : { uid: f.ids.requester, role: 'requester' } };
    const adminHandler = createAdminDeliveryAppealsHandler(() => ({ auth, db: f.db }));
    const adminApi = await call(adminHandler, 'admin',
      `/api/admin/delivery-appeals?penaltyRequesterUid=${f.ids.requester}`);
    assert.equal(adminApi.statusCode, 200, JSON.stringify(adminApi.body));
    assert.equal(adminApi.body.deliveryPenalty.restriction.state,
      Date.now() >= penalty.endsAt.toMillis() ? 'expired' : 'active');
    assert.equal((await call(adminHandler, 'requester',
      `/api/admin/delivery-appeals?penaltyRequesterUid=${f.ids.requester}`)).statusCode, 403);
    const requesterHandler = createModerationNoticesHandler(() => ({ auth, db: f.db }), { now: () => duringRestriction });
    const requesterApi = await call(requesterHandler, 'requester', '/api/moderation/notices');
    assert.equal(requesterApi.statusCode, 200, JSON.stringify(requesterApi.body));
    assert.equal(requesterApi.body.deliveryStatus.restriction.active, true);
    assert.equal(JSON.stringify(requesterApi.body).includes(f.attempts[0].attemptId), false);
    const orderHandler = createRequesterOrdersHandler(() => ({ auth, db: f.db }));
    const blockedOrder = await call(orderHandler, 'requester', '/api/requester/orders', 'POST',
      { branchId: f.ids.branch });
    assert.equal(blockedOrder.statusCode, 403, JSON.stringify(blockedOrder.body));
    assert.equal(blockedOrder.body.error.reason, 'VERIFIED_DELIVERY_ORDERING_RESTRICTED');
    await assert.rejects(assertOrderingAllowed({ get: (ref) => ref.get() }, f.db, f.ids.requester, 'other-branch', duringRestriction),
      (error) => error.reason === 'VERIFIED_DELIVERY_ORDERING_RESTRICTED');
    await assert.doesNotReject(assertOrderingAllowed({ get: (ref) => ref.get() }, f.db,
      f.ids.requester, 'other-branch', penalty.endsAt));
    const replay = await submitManagerDecision(f.db, { decoded: { uid: f.ids.manager }, branch: { id: f.ids.branch } },
      decision.payload, () => duringRestriction);
    assert.deepEqual(replay, decision.result);
    assert.equal((await stateRef.get()).updateTime.toMillis(), state.updateTime.toMillis());
    assert.equal((await eventRef.get()).updateTime.toMillis(), event.updateTime.toMillis());
    assert.equal((await f.db.collection('deliveryPenaltyEvents').where('requesterUid', '==', f.ids.requester).get()).size, 1);
  } finally { await deleteApp(f.app); }
});

test('a non-qualifying later failure breaks the verified streak without a penalty', { skip: !host }, async () => {
  for (const outcome of ['provider_responsible', 'shared', 'undetermined']) {
    const f = await fixture(['requester_responsible', 'requester_responsible', outcome]);
    try {
      const streak = await currentVerifiedStreak({ get: (ref) => ref.get() }, f.db, f.ids.requester);
      assert.equal(streak.count, 0, outcome);
      assert.equal((await f.db.collection('deliveryPenaltyEvents').doc(penaltyEventIdFor(f.ids.requester)).get()).exists, false);
    } finally { await deleteApp(f.app); }
  }
});

test('one or two verified failures warn without restricting; a later delivery resets the streak', { skip: !host }, async () => {
  for (const outcomes of [['reported'], ['requester_responsible', 'reported']]) {
    const f = await fixture(outcomes);
    try {
      await f.decide(outcomes.length - 1);
      const streak = await currentVerifiedStreak({ get: (ref) => ref.get() }, f.db, f.ids.requester);
      assert.equal(streak.count, outcomes.length);
      assert.equal((await f.db.collection('orderingRestrictions').doc(f.ids.requester).get()).exists, false);
      assert.equal((await f.db.collection('deliveryPenaltyEvents').doc(penaltyEventIdFor(f.ids.requester)).get()).exists, false);
    } finally { await deleteApp(f.app); }
  }
  const f = await fixture();
  try {
    const orderId = `successful-${randomUUID()}`;
    const attemptId = attemptIdFor(orderId, 1);
    const endedAt = at(4);
    await Promise.all([
      f.db.collection('requests').doc(orderId).set({ requesterUid: f.ids.requester,
        requester_id: f.ids.requester, branchId: f.ids.branch, status: 'delivered' }),
      f.db.collection('deliveryAttempts').doc(attemptId).set({ schemaVersion: 1, orderId,
        requesterUid: f.ids.requester, distributorUid: f.ids.distributor, branchId: f.ids.branch,
        attemptNumber: 1, outcome: 'delivered', endedAt }),
      f.db.collection('deliveryAttemptEvents').doc(`${attemptId}_outcome`).set({ schemaVersion: 1,
        kind: 'ATTEMPT_DELIVERED', attemptId, attemptNumber: 1, orderId, branchId: f.ids.branch,
        distributorUid: f.ids.distributor, actorUid: f.ids.distributor, actorRole: 'distributor',
        outcome: 'delivered', createdAt: endedAt }),
    ]);
    await f.decide(2);
    assert.equal((await currentVerifiedStreak({ get: (ref) => ref.get() }, f.db, f.ids.requester)).count, 0);
    assert.equal((await f.db.collection('orderingRestrictions').doc(f.ids.requester).get()).exists, false);
  } finally { await deleteApp(f.app); }
});

test('repeated failed attempts for one order count as one incident', { skip: !host }, async () => {
  const f = await fixture(['requester_responsible', 'requester_responsible']);
  try {
    const orderId = f.attempts[0].orderId;
    const attemptId = attemptIdFor(orderId, 2);
    const reportAt = at(3);
    const decidedAt = at(8);
    const managerDecision = { managerUid: f.ids.manager, responsibility: 'requester_responsible',
      decisionReason: reason, expectedRevision: 'repeat-revision',
      clientMutationId: 'repeat-decision', decidedAt };
    await Promise.all([
      f.db.collection('deliveryAttempts').doc(attemptId).set({ schemaVersion: 1, orderId,
        requesterUid: f.ids.requester, distributorUid: f.ids.distributor, branchId: f.ids.branch,
        attemptNumber: 2, outcome: 'failed', endedAt: reportAt, reportReceivedAt: reportAt,
        reportedReasonCode: 'NO_RESPONSE', reviewState: 'resolved',
        responsibility: 'requester_responsible', managerDecision }),
      f.db.collection('deliveryAttemptEvents').doc(`${attemptId}_outcome`).set({ schemaVersion: 1,
        kind: 'ATTEMPT_FAILED', attemptId, attemptNumber: 2, orderId, branchId: f.ids.branch,
        distributorUid: f.ids.distributor, actorUid: f.ids.distributor, actorRole: 'distributor',
        outcome: 'failed', reportedReasonCode: 'NO_RESPONSE', reportReceivedAt: reportAt, createdAt: reportAt }),
      f.db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(attemptId)).set({ schemaVersion: 1,
        kind: 'MANAGER_DELIVERY_DECISION', attemptId, attemptNumber: 2, orderId,
        branchId: f.ids.branch, managerUid: f.ids.manager, actorUid: f.ids.manager,
        actorRole: 'manager', previousReviewState: 'reported', reviewState: 'resolved',
        responsibility: 'requester_responsible', decisionReason: reason,
        expectedRevision: managerDecision.expectedRevision,
        clientMutationId: managerDecision.clientMutationId, createdAt: decidedAt }),
    ]);
    const streak = await currentVerifiedStreak({ get: (ref) => ref.get() }, f.db, f.ids.requester);
    assert.equal(streak.count, 2);
    assert.equal(new Set(streak.incidents.map((item) => item.orderId)).size, 2);
  } finally { await deleteApp(f.app); }
});

test('concurrent exact decision replays create one penalty and forged outcome evidence cannot qualify', { skip: !host }, async () => {
  const f = await fixture();
  try {
    const target = f.attempts[2];
    const snapshot = await f.db.collection('deliveryAttempts').doc(target.attemptId).get();
    const payload = { attemptId: target.attemptId, orderId: target.orderId,
      responsibility: 'requester_responsible', decisionReason: reason,
      expectedRevision: revisionFor(snapshot), clientMutationId: 'concurrent-decision-001' };
    const manager = { decoded: { uid: f.ids.manager }, branch: { id: f.ids.branch } };
    const results = await Promise.all([submitManagerDecision(f.db, manager, payload, () => at(10)),
      submitManagerDecision(f.db, manager, payload, () => at(10))]);
    assert.deepEqual(results[0], results[1]);
    assert.equal((await f.db.collection('deliveryPenaltyEvents').where('requesterUid', '==', f.ids.requester).get()).size, 1);
    const event = await f.db.collection('deliveryPenaltyEvents').doc(penaltyEventIdFor(f.ids.requester)).get();
    assert.equal(event.data().incidents.length, 3);
  } finally { await deleteApp(f.app); }

  const forged = await fixture(['requester_responsible']);
  try {
    const eventRef = forged.db.collection('deliveryAttemptEvents').doc(`${forged.attempts[0].attemptId}_outcome`);
    await eventRef.update({ actorUid: 'another-distributor' });
    const streak = await currentVerifiedStreak({ get: (ref) => ref.get() }, forged.db, forged.ids.requester);
    assert.equal(streak.count, 0);
    assert.equal((await forged.db.collection('deliveryPenaltyEvents').doc(penaltyEventIdFor(forged.ids.requester)).get()).exists, false);
  } finally { await deleteApp(forged.app); }
});

test('concurrent decisions on different failed orders converge on one restriction event', { skip: !host }, async () => {
  const f = await fixture(['requester_responsible', 'requester_responsible', 'reported', 'reported']);
  try {
    await Promise.all([f.decide(2), f.decide(3)]);
    const eventRef = f.db.collection('deliveryPenaltyEvents').doc(penaltyEventIdFor(f.ids.requester));
    const event = await eventRef.get();
    assert.equal(event.exists, true);
    assert.equal(event.data().supportingAttemptIds.length, 3);
    assert.equal(new Set(event.data().incidents.map((item) => item.orderId)).size, 3);
    assert.equal((await f.db.collection('deliveryPenaltyEvents').where('requesterUid', '==', f.ids.requester).get()).size, 1);
  } finally { await deleteApp(f.app); }
});

test('a second distinct post-expiry streak creates only one immutable Admin review flag', { skip: !host }, async () => {
  const f = await fixture();
  try {
    await f.decide(2, 'requester_responsible', at(10));
    const restrictionRef = f.db.collection('orderingRestrictions').doc(f.ids.requester);
    const first = (await restrictionRef.get()).data().deliveryPenalty;
    for (let index = 0; index < 3; index += 1) {
      const orderId = `later-${index}-${randomUUID()}`;
      const attemptId = attemptIdFor(orderId, 1);
      const reportAt = at(14 + index);
      const decidedAt = at(18 + index);
      const managerDecision = index === 2 ? null : { managerUid: f.ids.manager,
        responsibility: 'requester_responsible', decisionReason: reason,
        expectedRevision: `later-revision-${index}`, clientMutationId: `later-decision-${index}`, decidedAt };
      await Promise.all([
        f.db.collection('requests').doc(orderId).set({ requesterUid: f.ids.requester,
          requester_id: f.ids.requester, branchId: f.ids.branch, status: 'delivery_failed' }),
        f.db.collection('deliveryAttempts').doc(attemptId).set({ schemaVersion: 1, orderId,
          requesterUid: f.ids.requester, distributorUid: f.ids.distributor, branchId: f.ids.branch,
          attemptNumber: 1, outcome: 'failed', endedAt: reportAt, reportReceivedAt: reportAt,
          reportedReasonCode: 'NO_RESPONSE', reviewState: managerDecision ? 'resolved' : 'reported',
          responsibility: managerDecision ? 'requester_responsible' : 'undetermined', managerDecision }),
        f.db.collection('deliveryAttemptEvents').doc(`${attemptId}_outcome`).set({ schemaVersion: 1,
          kind: 'ATTEMPT_FAILED', attemptId, attemptNumber: 1, orderId, branchId: f.ids.branch,
          distributorUid: f.ids.distributor, actorUid: f.ids.distributor, actorRole: 'distributor',
          outcome: 'failed', reportedReasonCode: 'NO_RESPONSE', reportReceivedAt: reportAt, createdAt: reportAt }),
        ...(managerDecision ? [f.db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(attemptId)).set({
          schemaVersion: 1, kind: 'MANAGER_DELIVERY_DECISION', attemptId, attemptNumber: 1, orderId,
          branchId: f.ids.branch, managerUid: f.ids.manager, actorUid: f.ids.manager, actorRole: 'manager',
          previousReviewState: 'reported', reviewState: 'resolved', responsibility: 'requester_responsible',
          decisionReason: reason, expectedRevision: managerDecision.expectedRevision,
          clientMutationId: managerDecision.clientMutationId, createdAt: decidedAt,
        })] : []),
      ]);
      if (index === 2) {
        const snapshot = await f.db.collection('deliveryAttempts').doc(attemptId).get();
        const payload = { attemptId, orderId, responsibility: 'requester_responsible',
          decisionReason: reason, expectedRevision: revisionFor(snapshot), clientMutationId: 'second-streak-final' };
        const manager = { decoded: { uid: f.ids.manager }, branch: { id: f.ids.branch } };
        const result = await submitManagerDecision(f.db, manager, payload, () => at(20));
        assert.deepEqual(await submitManagerDecision(f.db, manager, payload, () => at(21)), result);
      }
    }
    const review = await f.db.collection('deliveryPenaltyEvents').doc(secondReviewIdFor(f.ids.requester)).get();
    assert.equal(review.exists, true);
    assert.equal(review.data().kind, 'SECOND_VERIFIED_DELIVERY_STREAK_FOR_ADMIN_REVIEW');
    assert.equal(review.data().supportingAttemptIds.length, 3);
    const adminView = await getAdminDeliveryPenaltyDetail(f.db, { uid: f.ids.admin }, f.ids.requester);
    assert.equal(adminView.adminReviewFlag, true);
    assert.deepEqual(adminView.secondReviewAttemptIds, review.data().supportingAttemptIds);
    const flags = await listAdminDeliveryPenaltyReviews(f.db, { uid: f.ids.admin });
    assert.ok(flags.reviews.some((item) => item.requesterUid === f.ids.requester));
    await assert.rejects(listAdminDeliveryPenaltyReviews(f.db, { uid: f.ids.requester }),
      (error) => error.status === 403);
    assert.equal((await restrictionRef.get()).data().deliveryPenalty.eventId, first.eventId);
    assert.equal((await restrictionRef.get()).data().deliveryPenalty.endsAt.toMillis(), first.endsAt.toMillis());
    await assert.doesNotReject(assertOrderingAllowed({ get: (ref) => ref.get() }, f.db,
      f.ids.requester, f.ids.branch, at(20)));
  } finally { await deleteApp(f.app); }
});

test('appeal pauses a supporting penalty and an Admin overturn invalidates it without changing Manager evidence', { skip: !host }, async () => {
  const f = await fixture();
  try {
    await f.decide(2);
    const target = f.attempts[2];
    const submitted = await submitRequesterAppeal(f.db, { uid: f.ids.requester }, {
      attemptId: target.attemptId, orderId: target.orderId,
      appealReason: 'I was available and dispute the recorded responsibility finding.',
      clientMutationId: 'penalty-appeal-001',
    }, () => at(11));
    assert.equal(submitted.created, true);
    assert.equal((await currentVerifiedStreak({ get: (ref) => ref.get() }, f.db, f.ids.requester)).count, 0);
    const stateRef = f.db.collection('orderingRestrictions').doc(f.ids.requester);
    assert.equal((await stateRef.get()).data().deliveryPenalty.state, 'paused');
    await assert.doesNotReject(assertOrderingAllowed({ get: (ref) => ref.get() }, f.db,
      f.ids.requester, f.ids.branch, at(11)));
    const resolved = await resolveAdminAppeal(f.db, { uid: f.ids.admin }, {
      attemptId: target.attemptId, resolution: 'overturned',
      overturnedResponsibility: 'provider_responsible',
      resolutionReason: 'The appeal evidence supports provider responsibility.',
      clientMutationId: 'penalty-resolution-001',
    }, () => at(12));
    assert.equal(resolved.created, true);
    assert.equal((await currentVerifiedStreak({ get: (ref) => ref.get() }, f.db, f.ids.requester)).count, 0);
    assert.equal((await stateRef.get()).data().deliveryPenalty.state, 'invalidated');
    assert.equal((await f.db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(target.attemptId)).get()).data().responsibility,
      'requester_responsible');
    assert.equal((await f.db.collection('deliveryAttemptEvents').doc(appealSubmissionEventIdFor(target.attemptId)).get()).exists, true);
    assert.equal((await f.db.collection('deliveryAttemptEvents').doc(appealResolutionEventIdFor(target.attemptId)).get()).exists, true);
    assert.equal((await f.db.collection('deliveryPenaltyEvents').where('requesterUid', '==', f.ids.requester).get()).size, 3);
  } finally { await deleteApp(f.app); }
});
