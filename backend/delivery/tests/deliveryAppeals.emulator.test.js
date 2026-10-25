const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createRequesterDeliveryAppealsHandler } = require('../../requester/deliveryAppealsHandler');
const { createAdminDeliveryAppealsHandler } = require('../../admin/deliveryAppealsHandler');
const { reportDetail } = require('../requesterDeliveryReportService');
const { attemptIdFor } = require('../deliveryAttemptService');
const { decisionEventIdFor } = require('../deliveryReviewPolicy');
const { appealSubmissionEventIdFor, appealResolutionEventIdFor } = require('../deliveryAppealPolicy');

const host = process.env.FIRESTORE_EMULATOR_HOST;
const submittedAt = new Date('2026-10-24T12:00:00Z');
const decidedAt = new Date('2026-10-24T10:00:00Z');
const reportedAt = new Date('2026-10-20T10:00:00Z');

async function call(handler, method, url, token, body) {
  const res = { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }, end() { return this; } };
  await handler({ method, url, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

async function fixture() {
  const suffix = randomUUID();
  const app = initializeApp({ projectId: 'demo-bluetap' }, `appeals-${suffix}`);
  const db = getFirestore(app);
  const ids = { requester: `requester-${suffix}`, other: `other-${suffix}`, admin: `admin-${suffix}`,
    admin2: `admin2-${suffix}`,
    manager: `manager-${suffix}`, order: `order-${suffix}`, branch: `branch-${suffix}` };
  ids.attempt = attemptIdFor(ids.order, 1);
  const managerDecision = { managerUid: ids.manager, responsibility: 'requester_responsible',
    decisionReason: 'The factual record supports requester responsibility.',
    expectedRevision: 'initial-revision', clientMutationId: 'manager-decision-1', decidedAt };
  const auth = { async verifyIdToken(token, revoked) {
    assert.equal(revoked, true);
    if (token === 'admin') return { uid: ids.admin, admin: true };
    if (token === 'admin2') return { uid: ids.admin2, admin: true };
    if (token === 'other') return { uid: ids.other, role: 'requester' };
    if (token === 'requester') return { uid: ids.requester, role: 'requester' };
    if (token === 'manager') return { uid: ids.manager, role: 'manager' };
    throw new Error('Bad token');
  } };
  await Promise.all([
    db.collection('users').doc(ids.requester).set({ role: 'requester', accountStatus: 'active' }),
    db.collection('users').doc(ids.other).set({ role: 'requester', accountStatus: 'active' }),
    db.collection('users').doc(ids.admin).set({ role: 'admin', accountStatus: 'active' }),
    db.collection('users').doc(ids.admin2).set({ role: 'admin', accountStatus: 'active' }),
    db.collection('users').doc(ids.manager).set({ role: 'manager', accountStatus: 'active' }),
    db.collection('requests').doc(ids.order).set({ requesterUid: ids.requester, requester_id: ids.requester,
      branchId: `transferred-${suffix}`, status: 'delivery_failed' }),
    db.collection('deliveryAttempts').doc(ids.attempt).set({ orderId: ids.order, requesterUid: ids.requester,
      branchId: ids.branch, distributorUid: `distributor-${suffix}`, attemptNumber: 1, outcome: 'failed',
      reviewState: 'resolved', responsibility: 'requester_responsible', managerDecision,
      reportReceivedAt: reportedAt, endedAt: reportedAt, reportedReasonCode: 'NO_RESPONSE' }),
    db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(ids.attempt)).set({ schemaVersion: 1,
      kind: 'MANAGER_DELIVERY_DECISION', attemptId: ids.attempt, attemptNumber: 1, orderId: ids.order,
      branchId: ids.branch, managerUid: ids.manager, actorUid: ids.manager, actorRole: 'manager',
      previousReviewState: 'reported', reviewState: 'resolved', responsibility: 'requester_responsible',
      decisionReason: managerDecision.decisionReason, expectedRevision: 'initial-revision',
      clientMutationId: 'manager-decision-1', createdAt: decidedAt }),
  ]);
  const requester = createRequesterDeliveryAppealsHandler(() => ({ auth, db }), () => submittedAt);
  const admin = createAdminDeliveryAppealsHandler(() => ({ auth, db }), () => new Date(submittedAt.getTime() + 1000));
  const submitBody = { attemptId: ids.attempt, orderId: ids.order,
    appealReason: 'I dispute the finding because I was available at the delivery address.',
    clientMutationId: `appeal_${suffix}` };
  const requesterCall = (method, token = 'requester', body = submitBody) => call(requester, method,
    method === 'GET' ? `/api/requester/delivery-appeals?attemptId=${ids.attempt}` : '/api/requester/delivery-appeals', token, body);
  const adminCall = (method, token = 'admin', body, query = '') => call(admin, method,
    `/api/admin/delivery-appeals${query}`, token, body);
  return { app, db, ids, submitBody, requesterCall, adminCall };
}

test('real Firestore appeal submission, immutable Admin decision and exact replay preserve authorization', { skip: !host }, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.requesterCall('POST', 'other')).statusCode, 404);
    assert.equal((await f.requesterCall('POST', 'manager')).statusCode, 403);
    assert.equal((await f.adminCall('GET', 'requester', null, '?status=pending')).statusCode, 403);
    assert.equal((await f.requesterCall('GET', 'other')).statusCode, 404);
    const first = await f.requesterCall('POST');
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.equal(first.body.created, true);
    const attemptRef = f.db.collection('deliveryAttempts').doc(f.ids.attempt);
    const submissionRef = f.db.collection('deliveryAttemptEvents').doc(appealSubmissionEventIdFor(f.ids.attempt));
    const attemptAfterSubmit = await attemptRef.get();
    const submission = await submissionRef.get();
    const requesterSignal = await f.db.collection('moderationActivity').doc(`user_${f.ids.requester}`).get();
    assert.equal(requesterSignal.exists, true);
    assert.equal(submission.data().kind, 'REQUESTER_DELIVERY_APPEAL');
    assert.equal((await f.requesterCall('POST')).body.created, false);
    assert.equal((await attemptRef.get()).updateTime.toMillis(), attemptAfterSubmit.updateTime.toMillis());
    assert.equal((await submissionRef.get()).updateTime.toMillis(), submission.updateTime.toMillis());
    assert.equal((await f.db.collection('moderationActivity').doc(`user_${f.ids.requester}`).get()).updateTime.toMillis(),
      requesterSignal.updateTime.toMillis());
    assert.equal((await f.requesterCall('POST', 'requester', { ...f.submitBody,
      appealReason: 'A changed factual explanation conflicts with the first appeal.' })).statusCode, 409);
    assert.equal((await f.requesterCall('POST', 'requester', { ...f.submitBody,
      clientMutationId: 'another-mutation-id' })).statusCode, 409);
    const list = await f.adminCall('GET', 'admin', null, '?status=pending&limit=1');
    assert.equal(list.statusCode, 200, JSON.stringify(list.body));
    assert.equal(list.body.appeals.length, 1);
    assert.equal(list.body.appeals[0].attemptId, f.ids.attempt);
    assert.ok(!JSON.stringify(list.body).includes(f.submitBody.clientMutationId));
    const detail = await f.adminCall('GET', 'admin', null, `?attemptId=${f.ids.attempt}`);
    assert.equal(detail.statusCode, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.appeal.appeal.appealReason, f.submitBody.appealReason);
    const decision = { attemptId: f.ids.attempt, resolution: 'overturned',
      overturnedResponsibility: 'provider_responsible',
      resolutionReason: 'The requester evidence changes the responsibility finding.',
      clientMutationId: 'admin-appeal-mutation-1' };
    const [a, b] = await Promise.all([f.adminCall('POST', 'admin', decision), f.adminCall('POST', 'admin', decision)]);
    assert.equal(a.statusCode, 200, JSON.stringify(a.body));
    assert.equal(b.statusCode, 200, JSON.stringify(b.body));
    assert.equal([a.body.created, b.body.created].filter(Boolean).length, 1);
    const attemptAfterResolve = await attemptRef.get();
    assert.equal(attemptAfterResolve.data().responsibility, 'requester_responsible');
    assert.equal(attemptAfterResolve.data().effectiveResponsibility, 'provider_responsible');
    assert.equal((await f.adminCall('POST', 'admin', decision)).body.created, false);
    assert.equal((await attemptRef.get()).updateTime.toMillis(), attemptAfterResolve.updateTime.toMillis());
    assert.equal((await f.adminCall('POST', 'admin', { ...decision, resolutionReason: 'A conflicting factual decision reason.' })).statusCode, 409);
    assert.equal((await f.adminCall('POST', 'admin', { ...decision, clientMutationId: 'different-admin-mutation' })).statusCode, 409);
    const resolution = await f.db.collection('deliveryAttemptEvents').doc(appealResolutionEventIdFor(f.ids.attempt)).get();
    assert.equal(resolution.data().kind, 'ADMIN_APPEAL_RESOLUTION');
    assert.equal((await f.db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(f.ids.attempt)).get()).data().responsibility,
      'requester_responsible');
    const report = await reportDetail(f.db, f.ids.attempt, f.ids.requester, f.ids.order);
    assert.equal(report.report.appeal.state, 'overturned');
    assert.equal(report.report.effectiveResponsibility, 'provider_responsible');
    assert.equal((await f.requesterCall('GET')).body.appeal.state, 'overturned');
    const resolvedPage = await f.adminCall('GET', 'admin', null, '?status=resolved&limit=1');
    assert.equal(resolvedPage.statusCode, 200, JSON.stringify(resolvedPage.body));
    assert.equal(resolvedPage.body.appeals.some((item) => item.attemptId === f.ids.attempt), true);
    const noticeIds = (await f.db.collection('moderationNotices').doc(f.ids.requester).collection('items').get()).docs.map((x) => x.id).sort();
    assert.deepEqual(noticeIds, [`appeal_res_${f.ids.attempt}`, `appeal_sub_${f.ids.attempt}`]);
    assert.equal((await f.db.collection('adminAuditLogs').doc(appealResolutionEventIdFor(f.ids.attempt)).get()).exists, true);
    assert.equal((await f.db.collection('moderationActions').where('targetUid', '==', f.ids.requester).get()).empty, true);
    assert.equal((await f.db.collection('orderingRestrictions').doc(f.ids.requester).get()).exists, false);
  } finally { await deleteApp(f.app); }
});

test('real Admin queue advances a bounded cursor past malformed candidates without leaking them', { skip: !host }, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.requesterCall('POST')).statusCode, 200);
    const invalidId = 'f'.repeat(64);
    await f.db.collection('deliveryAttempts').doc(invalidId).set({ appealState: 'submitted',
      appeal: { submittedAt: new Date('2026-10-25T12:00:00Z') }, orderId: `orphan-${randomUUID()}` });
    const first = await f.adminCall('GET', 'admin', null, '?status=pending&limit=1');
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.appeals, []);
    assert.equal(first.body.nextCursor, invalidId);
    const second = await f.adminCall('GET', 'admin', null, `?status=pending&limit=1&cursor=${invalidId}`);
    assert.equal(second.statusCode, 200, JSON.stringify(second.body));
    assert.equal(second.body.appeals[0].attemptId, f.ids.attempt);
    assert.equal(second.body.nextCursor, null);
    assert.equal((await f.adminCall('GET', 'admin', null, `?attemptId=${invalidId}`)).statusCode, 404);
  } finally { await deleteApp(f.app); }
});

test('two Admins racing with conflicting appeal decisions create exactly one resolution', { skip: !host }, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.requesterCall('POST')).statusCode, 200);
    const uphold = { attemptId: f.ids.attempt, resolution: 'upheld',
      resolutionReason: 'The original Manager finding remains supported by the evidence.',
      clientMutationId: 'first-admin-decision' };
    const overturn = { attemptId: f.ids.attempt, resolution: 'overturned',
      overturnedResponsibility: 'provider_responsible',
      resolutionReason: 'The record supports provider responsibility instead.',
      clientMutationId: 'second-admin-decision' };
    const results = await Promise.all([f.adminCall('POST', 'admin', uphold),
      f.adminCall('POST', 'admin2', overturn)]);
    assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
    const winner = results.find((result) => result.statusCode === 200);
    const event = await f.db.collection('deliveryAttemptEvents').doc(appealResolutionEventIdFor(f.ids.attempt)).get();
    assert.equal(event.exists, true);
    assert.equal(event.data().resolution, winner.body.appeal.appeal.state);
    assert.equal((await f.db.collection('adminAuditLogs').doc(appealResolutionEventIdFor(f.ids.attempt)).get()).exists, true);
    assert.equal((await f.adminCall('POST', 'admin', uphold)).statusCode,
      winner.body.appeal.appeal.state === 'upheld' ? 200 : 409);
    assert.equal((await f.adminCall('POST', 'admin2', overturn)).statusCode,
      winner.body.appeal.appeal.state === 'overturned' ? 200 : 409);
  } finally { await deleteApp(f.app); }
});

test('real Firestore rejects an unfinalized or noncanonical Manager decision', { skip: !host }, async () => {
  const f = await fixture();
  try {
    const eventRef = f.db.collection('deliveryAttemptEvents').doc(decisionEventIdFor(f.ids.attempt));
    await eventRef.update({ responsibility: 'provider_responsible' });
    assert.equal((await f.requesterCall('POST')).statusCode, 404);
    assert.equal((await f.db.collection('deliveryAttemptEvents').doc(appealSubmissionEventIdFor(f.ids.attempt)).get()).exists, false);
    assert.equal((await f.adminCall('GET', 'admin', null, `?attemptId=${f.ids.attempt}`)).statusCode, 404);
  } finally { await deleteApp(f.app); }
});
