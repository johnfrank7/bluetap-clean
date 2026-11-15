const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createManagerDeliveryReviewsHandler } = require('../../manager/deliveryReviewsHandler');
const { createRequesterDeliveryReportsHandler } = require('../../requester/deliveryReportsHandler');
const { attemptIdFor } = require('../deliveryAttemptService');
const { decisionEventIdFor } = require('../managerDeliveryDecisionService');
const { hashId } = require('../../moderation/moderationService');

const reportTime = new Date('2026-10-20T12:00:00.000Z');
const deadline = new Date('2026-10-23T12:00:00.000Z');
const reason = 'The delivery evidence and requester account were reviewed.';
const host = process.env.FIRESTORE_EMULATOR_HOST;

async function fixtureSafetySnapshot(db, ids) {
  const document = async (collection, id) => {
    const snapshot = await db.collection(collection).doc(id).get();
    return snapshot.exists ? { data: snapshot.data(), updated: snapshot.updateTime.toMillis() } : null;
  };
  const query = async (collection, field, value) => {
    const snapshot = await db.collection(collection).where(field, '==', value).get();
    return snapshot.docs.map((item) => ({ id: item.id, data: item.data(), updated: item.updateTime.toMillis() }))
      .sort((a, b) => a.id.localeCompare(b.id));
  };
  return {
    requester: await document('users', ids.requester),
    reporter: await document('users', ids.reporter),
    reviewingManager: await document('users', ids.m1),
    abuseByOriginalBranch: await document('orderAbuseReviews', hashId(ids.branch, ids.requester)),
    abuseByCurrentBranch: await document('orderAbuseReviews', hashId(ids.otherBranch, ids.requester)),
    requesterAbuseReviews: await query('orderAbuseReviews', 'requesterUid', ids.requester),
    requesterActions: await query('moderationActions', 'targetUid', ids.requester),
    reporterActions: await query('moderationActions', 'targetUid', ids.reporter),
    managerMutations: await query('moderationMutationIds', 'actorUid', ids.m1),
    requesterAudit: await query('adminAuditLogs', 'targetUid', ids.requester),
    requesterChatRestriction: await document('chatRestrictions', ids.requester),
    requesterOrderingRestriction: await document('orderingRestrictions', ids.requester),
    reporterChatRestriction: await document('chatRestrictions', ids.reporter),
    reporterOrderingRestriction: await document('orderingRestrictions', ids.reporter),
    requesterNoticeDocuments: await db.collection('moderationNotices').doc(ids.requester).collection('items').get()
      .then((snapshot) => snapshot.docs.map((item) => item.id).sort()),
    reporterNoticeDocuments: await db.collection('moderationNotices').doc(ids.reporter).collection('items').get()
      .then((snapshot) => snapshot.docs.map((item) => item.id).sort()),
    requesterActivity: await document('moderationActivity', `user_${ids.requester}`),
    originalBranchActivity: await document('moderationActivity', `branch_${ids.branch}`),
    currentBranchActivity: await document('moderationActivity', `branch_${ids.otherBranch}`),
    adminActivity: await document('moderationActivity', 'admin'),
  };
}

async function call(handler, method, url, token, body) {
  const res = { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }, end() { return this; } };
  await handler({ method, url, body, headers: { authorization: `Bearer ${token}` } }, res);
  return res;
}

async function fixture({ managerNow = deadline, requesterNow = new Date(deadline.getTime() - 1) } = {}) {
  const suffix = randomUUID();
  const app = initializeApp({ projectId: 'demo-bluetap' }, `manager-decision-${suffix}`);
  const db = getFirestore(app);
  const ids = { m1: `m1-${suffix}`, m2: `m2-${suffix}`, cross: `cross-${suffix}`,
    reporter: `reporter-${suffix}`, requester: `requester-${suffix}`,
    branch: `original-${suffix}`, otherBranch: `transfer-${suffix}`, order: `order-${suffix}` };
  ids.attempt = attemptIdFor(ids.order, 1);
  ids.event = decisionEventIdFor(ids.attempt);
  const authMutations = [];
  const auth = { async verifyIdToken(token, checkRevoked) {
    assert.equal(checkRevoked, true);
    if (['m1', 'm2', 'cross', 'reporter'].includes(token)) return { uid: ids[token], role: 'manager' };
    if (token === 'requester') return { uid: ids.requester, role: 'requester' };
    throw new Error('Invalid token.');
  }, async getUser() { return { disabled: false }; },
  async updateUser(...args) { authMutations.push(['updateUser', ...args]); throw new Error('Unexpected Auth mutation.'); },
  async revokeRefreshTokens(...args) { authMutations.push(['revokeRefreshTokens', ...args]); throw new Error('Unexpected token revocation.'); } };
  const manager = createManagerDeliveryReviewsHandler(() => ({ auth, db }), () => managerNow);
  const requester = createRequesterDeliveryReportsHandler(() => ({ auth, db }), () => requesterNow);
  await Promise.all([
    ...['m1', 'm2', 'reporter'].map((key) => db.collection('users').doc(ids[key]).set({ role: 'manager',
      managerStatus: 'active', accountStatus: 'active', branchId: ids.branch })),
    db.collection('users').doc(ids.cross).set({ role: 'manager', managerStatus: 'active',
      accountStatus: 'active', branchId: ids.otherBranch }),
    db.collection('users').doc(ids.requester).set({ role: 'requester', accountStatus: 'active' }),
    db.collection('branches').doc(ids.branch).set({ status: 'active' }),
    db.collection('branches').doc(ids.otherBranch).set({ status: 'active' }),
    db.collection('requests').doc(ids.order).set({ requesterUid: ids.requester, requester_id: ids.requester,
      requestId: 'Transferred order', branchId: ids.otherBranch, currentBranchId: ids.otherBranch }),
    db.collection('deliveryAttempts').doc(ids.attempt).set({ orderId: ids.order, requesterUid: ids.requester,
      distributorUid: ids.reporter, branchId: ids.branch, attemptNumber: 1, outcome: 'failed',
      reviewState: 'reported', responsibility: 'undetermined', endedAt: reportTime,
      reportReceivedAt: reportTime, reportedReasonCode: 'NO_RESPONSE', reportFormat: 'structured-v1',
      reportEvidence: { contactAttempts: [{ method: 'PHONE_CALL', outcome: 'NO_ANSWER' }] },
      outcomeMutationId: 'private_report_mutation' }),
  ]);
  const managerCall = (method, token = 'm1', body) => call(manager, method,
    method === 'GET' ? `/api/manager/delivery-reviews?attemptId=${ids.attempt}` : '/api/manager/delivery-reviews', token, body);
  const requesterCall = (method, body) => call(requester, method,
    method === 'GET' ? `/api/requester/delivery-reports?attemptId=${ids.attempt}` : '/api/requester/delivery-reports', 'requester', body);
  const completionCall = (url = '/api/requester/delivery-reports?feed=review-completions', token = 'requester') =>
    call(requester, 'GET', url, token);
  const decisionBody = async (overrides = {}) => {
    const detail = await managerCall('GET');
    assert.equal(detail.statusCode, 200, JSON.stringify(detail.body));
    return { attemptId: ids.attempt, orderId: ids.order, responsibility: 'shared',
      decisionReason: reason, expectedRevision: detail.body.review.revision,
      clientMutationId: `manager_${suffix}`, ...overrides };
  };
  const responseBody = { attemptId: ids.attempt,
    explanation: 'I was at the delivery address and did not receive a call.',
    clientMutationId: `requester_${suffix}` };
  return { app, db, ids, managerCall, requesterCall, completionCall, decisionBody, responseBody, authMutations };
}

test('real transaction resolves a transferred report once and exact replay is read-only', { skip: !host }, async () => {
  const f = await fixture();
  try {
    const beforeSafety = await fixtureSafetySnapshot(f.db, f.ids);
    assert.equal(beforeSafety.requester.data.accountStatus, 'active');
    assert.equal(beforeSafety.requesterAbuseReviews.length, 0);
    assert.equal(beforeSafety.requesterActions.length, 0);
    assert.equal(beforeSafety.requesterNoticeDocuments.length, 0);
    assert.deepEqual((await f.completionCall()).body, { completions: [], nextCursor: null });
    const body = await f.decisionBody();
    assert.equal((await f.managerCall('POST', 'cross', body)).statusCode, 404);
    assert.equal((await f.managerCall('POST', 'reporter', body)).statusCode, 404);
    const beforeOrder = (await f.db.collection('requests').doc(f.ids.order).get()).updateTime.toMillis();
    const first = await f.managerCall('POST', 'm1', body);
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    const attemptRef = f.db.collection('deliveryAttempts').doc(f.ids.attempt);
    const eventRef = f.db.collection('deliveryAttemptEvents').doc(f.ids.event);
    const attempt = await attemptRef.get();
    const event = await eventRef.get();
    assert.equal(attempt.data().reviewState, 'resolved');
    assert.equal(attempt.data().responsibility, 'shared');
    assert.equal(event.data().kind, 'MANAGER_DELIVERY_DECISION');
    assert.equal(event.data().previousReviewState, 'reported');
    assert.equal(event.data().branchId, f.ids.branch);
    assert.equal(event.data().clientMutationId, body.clientMutationId);
    assert.ok(!JSON.stringify(first.body).includes(body.clientMutationId));
    assert.equal((await f.managerCall('POST', 'm1', body)).statusCode, 200);
    assert.deepEqual((await f.managerCall('POST', 'm1', body)).body, first.body);
    assert.equal((await attemptRef.get()).updateTime.toMillis(), attempt.updateTime.toMillis());
    assert.equal((await eventRef.get()).updateTime.toMillis(), event.updateTime.toMillis());
    for (const change of [{ responsibility: 'provider_responsible' }, { clientMutationId: `changed_${f.ids.m1}` },
      { decisionReason: 'A different factual conclusion was reached.' }]) {
      assert.equal((await f.managerCall('POST', 'm1', { ...body, ...change })).statusCode, 409);
    }
    assert.equal((await f.requesterCall('POST', f.responseBody)).statusCode, 409);
    const requesterDetail = await f.requesterCall('GET');
    assert.equal(requesterDetail.statusCode, 200, JSON.stringify(requesterDetail.body));
    assert.equal(requesterDetail.body.report.reviewState, 'resolved');
    assert.equal(requesterDetail.body.report.responsibility, 'shared');
    assert.equal(requesterDetail.body.report.decisionReason, reason);
    assert.equal(requesterDetail.body.report.decidedAt, deadline.toISOString());
    const completion = await f.completionCall();
    assert.equal(completion.statusCode, 200, JSON.stringify(completion.body));
    assert.deepEqual(completion.body, { completions: [{ eventId: f.ids.event,
      attemptId: f.ids.attempt, orderId: f.ids.order,
      decidedAt: deadline.toISOString(), reviewState: 'resolved' }], nextCursor: null });
    assert.equal((await f.completionCall(`/api/requester/delivery-reports?feed=review-completions&cursor=${f.ids.attempt}`)).body.completions.length, 0);
    assert.equal((await f.completionCall('/api/requester/delivery-reports?feed=review-completions', 'm1')).statusCode, 403);
    assert.equal((await f.db.collection('requests').doc(f.ids.order).get()).updateTime.toMillis(), beforeOrder);
    assert.equal((await f.db.collection('deliveryAttemptEvents').where('attemptId', '==', f.ids.attempt).get()).size, 1);
    const afterSafety = await fixtureSafetySnapshot(f.db, f.ids);
    assert.equal(afterSafety.requesterActivity.data.updatedAt.toMillis(), deadline.getTime());
    assert.deepEqual({ ...afterSafety, requesterActivity: beforeSafety.requesterActivity }, beforeSafety);
    assert.deepEqual(f.authMutations, []);
  } finally { await deleteApp(f.app); }
});

test('real concurrent decisions and response race produce one immutable decision', { skip: !host }, async () => {
  const f = await fixture();
  try {
    const body = await f.decisionBody();
    const concurrent = await Promise.all([
      f.managerCall('POST', 'm1', body),
      f.managerCall('POST', 'm2', { ...body, clientMutationId: `other_${f.ids.m2}` }),
    ]);
    assert.deepEqual(concurrent.map((item) => item.statusCode).sort(), [200, 409], JSON.stringify(concurrent));
    assert.equal((await f.db.collection('deliveryAttemptEvents').doc(f.ids.event).get()).exists, true);
    assert.equal((await f.db.collection('deliveryAttemptEvents').where('attemptId', '==', f.ids.attempt).get()).size, 1);
    assert.equal((await f.requesterCall('POST', f.responseBody)).statusCode, 409);
  } finally { await deleteApp(f.app); }

  const race = await fixture({ managerNow: new Date(deadline.getTime() - 1) });
  try {
    const body = await race.decisionBody();
    const concurrent = await Promise.all([
      race.requesterCall('POST', race.responseBody), race.managerCall('POST', 'm1', body),
    ]);
    assert.equal(concurrent[0].statusCode, 200, JSON.stringify(concurrent));
    assert.equal(concurrent[1].statusCode, 409, JSON.stringify(concurrent));
    assert.equal((await race.db.collection('deliveryAttemptEvents').doc(race.ids.event).get()).exists, false);
    const updated = await race.decisionBody();
    assert.equal((await race.managerCall('POST', 'm1', updated)).statusCode, 200);
    const replay = await race.requesterCall('POST', race.responseBody);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.report.reviewState, 'resolved');
    assert.equal(replay.body.report.decisionReason, reason);
    assert.equal((await race.db.collection('deliveryAttemptEvents').where('attemptId', '==', race.ids.attempt).get()).size, 2);
  } finally { await deleteApp(race.app); }
});

test('real deadline cutoff rejects a new response and allows a Manager decision', { skip: !host }, async () => {
  const f = await fixture({ requesterNow: deadline });
  try {
    const body = await f.decisionBody();
    assert.equal((await f.requesterCall('POST', f.responseBody)).statusCode, 409);
    assert.equal((await f.managerCall('POST', 'm1', body)).statusCode, 200);
    assert.equal((await f.db.collection('deliveryAttemptEvents').where('attemptId', '==', f.ids.attempt).get()).size, 1);
  } finally { await deleteApp(f.app); }
});
