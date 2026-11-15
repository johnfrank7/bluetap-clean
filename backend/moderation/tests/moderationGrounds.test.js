const assert = require('node:assert/strict');
const test = require('node:test');
const { applyModerationAction, safeAbuseReview } = require('../moderationHandler');
const { hashId, assertOrderingAllowed } = require('../moderationService');
const { selectedIncidentIds } = require('../moderationGrounds');
const { attemptIdFor } = require('../../delivery/deliveryAttemptService');
const { decisionEventIdFor } = require('../../delivery/deliveryReviewPolicy');

const receivedAt = new Date('2026-10-01T00:00:00Z');
const decidedAt = new Date('2026-10-04T00:00:00Z');
const clone = (value) => structuredClone(value);

function fixture() {
  const branchId = 'branch-a';
  const requesterUid = 'requester-a';
  const orderId = 'order-a';
  const attemptId = attemptIdFor(orderId, 1);
  const reviewId = hashId(branchId, requesterUid);
  const incidentId = hashId('delivery_failure', attemptId);
  const incident = { key: incidentId, incidentId, type: 'delivery_failure', orderId, attemptId,
    sourceEventId: `${attemptId}_outcome`, requesterUid, reportingBranchId: branchId,
    category: 'NO_RESPONSE', stage: 'out_for_delivery', concern: 'moderate', at: receivedAt };
  const decisionReason = 'Verified requester responsibility';
  const savedDecision = { managerUid: 'manager-a', responsibility: 'requester_responsible', decisionReason,
    expectedRevision: 'revision-a', clientMutationId: 'decision-a', decidedAt };
  const records = new Map(Object.entries({
    [`orderAbuseReviews/${reviewId}`]: { requesterUid, branchId, status: 'open', severity: 'strong_review',
      incidentCount: 99, incidents: [incident] },
    [`requests/${orderId}`]: { requesterUid, branchId, currentBranchId: 'branch-b', status: 'delivery_failed' },
    [`deliveryAttempts/${attemptId}`]: { orderId, requesterUid, branchId, attemptNumber: 1,
      distributorUid: 'distributor-a', outcome: 'failed', reviewState: 'resolved',
      responsibility: 'requester_responsible', reportedReasonCode: 'NO_RESPONSE',
      reportReceivedAt: receivedAt, managerDecision: savedDecision },
    [`deliveryAttemptEvents/${attemptId}_outcome`]: { schemaVersion: 1, kind: 'ATTEMPT_FAILED',
      attemptId, attemptNumber: 1, orderId, branchId, distributorUid: 'distributor-a',
      actorUid: 'distributor-a', actorRole: 'distributor', outcome: 'failed',
      reportedReasonCode: 'NO_RESPONSE', createdAt: receivedAt, reportReceivedAt: receivedAt },
    [`deliveryAttemptEvents/${decisionEventIdFor(attemptId)}`]: { schemaVersion: 1,
      kind: 'MANAGER_DELIVERY_DECISION', attemptId, attemptNumber: 1, orderId, branchId,
      managerUid: 'manager-a', actorUid: 'manager-a', actorRole: 'manager',
      previousReviewState: 'reported', reviewState: 'resolved', responsibility: 'requester_responsible',
      decisionReason, expectedRevision: 'revision-a', clientMutationId: 'decision-a', createdAt: decidedAt },
    [`users/${requesterUid}`]: { role: 'requester', accountStatus: 'active', publicUid: 'Req001' },
    'users/manager-a': { role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId },
    'users/admin-a': { role: 'admin', accountStatus: 'active' },
    [`branches/${branchId}`]: { status: 'active' },
  }).map(([key, value]) => [key, clone(value)]));
  let auto = 0;
  const snapshot = (source, path) => ({ id: path.split('/').at(-1), exists: source.has(path), data: () => clone(source.get(path)) });
  const collection = (path) => ({ doc(id = `auto-${++auto}`) {
    const ref = { path: `${path}/${id}`, id, get: async () => snapshot(records, `${path}/${id}`),
      collection: (child) => collection(`${path}/${id}/${child}`) };
    return ref;
  } });
  const db = { collection, async runTransaction(run) {
    const work = new Map([...records].map(([path, data]) => [path, clone(data)]));
    const tx = {
      get: async (ref) => snapshot(work, ref.path),
      create(ref, data) { if (work.has(ref.path)) throw new Error(`Duplicate ${ref.path}`); work.set(ref.path, clone(data)); },
      set(ref, data, options) { work.set(ref.path, options?.merge ? { ...(work.get(ref.path) || {}), ...clone(data) } : clone(data)); },
      update(ref, data) { if (!work.has(ref.path)) throw new Error(`Missing ${ref.path}`); work.set(ref.path, { ...work.get(ref.path), ...clone(data) }); },
    };
    const result = await run(tx);
    records.clear();
    for (const entry of work) records.set(...entry);
    return result;
  } };
  const authCalls = [];
  const auth = { updateUser: async (...args) => authCalls.push(['updateUser', ...args]),
    revokeRefreshTokens: async (...args) => authCalls.push(['revokeRefreshTokens', ...args]) };
  const manager = { decoded: { uid: 'manager-a' }, profile: { publicUid: 'Man001' },
    branch: { id: branchId, name: 'BlueTap A' } };
  const admin = { uid: 'admin-a', profile: { publicUid: 'Adm001' } };
  const apply = (role, action, ids = [incidentId], extra = {}) => applyModerationAction({
    auth, db, actor: role === 'manager' ? manager : admin, actorRole: role,
    actorBranch: role === 'manager' ? manager.branch : null,
    body: { abuseReviewId: reviewId, action, reason: 'Evidence reviewed for this case',
      clientMutationId: `mutation-${action}`, incidentIds: ids,
      ...(['suspend_branch_ordering', 'suspend_platform_ordering'].includes(action) ? { durationDays: 1 } : {}), ...extra },
    now: new Date('2026-10-05T00:00:00Z'), createActionId: () => `action-${action}`,
  });
  return { records, authCalls, db, auth, manager, admin, apply, reviewId, incidentId, attemptId, orderId, branchId, requesterUid };
}

test('verified delivery ground supports scoped Manager and Admin actions with exact replay', async () => {
  for (const [role, action] of [['manager', 'warn'], ['manager', 'suspend_branch_ordering'],
    ['admin', 'warn'], ['admin', 'suspend_platform_ordering']]) {
    const f = fixture();
    const first = await f.apply(role, action);
    assert.equal(first.created, true);
    assert.deepEqual(f.records.get(`moderationActions/action-${action}`).selectedIncidentIds, [f.incidentId]);
    assert.equal(f.records.get(`moderationActions/action-${action}`).validatedGrounds[0].attemptId, f.attemptId);
    assert.equal((await f.apply(role, action)).created, false);
    await assert.rejects(f.apply(role, action, [f.incidentId], { reason: 'Changed explanation' }),
      (error) => error.reason === 'MODERATION_MUTATION_CONFLICT');
    assert.deepEqual(f.authCalls, []);
  }
});

test('held abuse account actions reject before Auth, including old exact replay, without any writes', async () => {
  for (const action of ['suspend_account', 'terminate_account']) {
    const f = fixture();
    f.records.set('moderationActions/historical', { action, orderAbuseReviewId: f.reviewId });
    f.records.set(`moderationMutationIds/${hashId('admin-a', `mutation-${action}`)}`,
      { actionId: 'historical', payloadHash: 'historical-payload' });
    const before = clone([...f.records]);
    await assert.rejects(f.apply('admin', action),
      (error) => error.reason === 'ABUSE_ACCOUNT_ACTION_TEMPORARILY_UNAVAILABLE');
    assert.deepEqual([...f.records], before);
    assert.deepEqual(f.authCalls, []);
    await assertOrderingAllowed({ get: async () => ({ exists: false }) }, f.db, f.requesterUid, f.branchId);
  }
});

test('historical warning mutation replays read-only but cannot create a new action without grounds', async () => {
  const f = fixture();
  const payloadHash = hashId(JSON.stringify({ action: 'warn', reportId: '', abuseReviewId: f.reviewId,
    reason: 'Evidence reviewed for this case', privateNote: '', duration: null }));
  f.records.set('moderationActions/historical-warn', { action: 'warn', orderAbuseReviewId: f.reviewId,
    reason: 'Evidence reviewed for this case' });
  f.records.set(`moderationMutationIds/${hashId('manager-a', 'mutation-warn')}`,
    { actionId: 'historical-warn', payloadHash });
  const before = clone([...f.records]);
  const replay = await f.apply('manager', 'warn', [], { incidentIds: undefined });
  assert.equal(replay.created, false);
  assert.deepEqual([...f.records], before);
  await assert.rejects(f.apply('manager', 'warn', [],
    { incidentIds: undefined, clientMutationId: 'new-warning-mutation' }),
  (error) => error.reason === 'MODERATION_GROUNDS_REQUIRED');
  assert.deepEqual(f.authCalls, []);
});

test('selection bounds, membership, and branch scope reject without writes', async () => {
  const f = fixture();
  assert.deepEqual(selectedIncidentIds(undefined), []);
  for (const ids of [[f.incidentId, f.incidentId], Array(6).fill(f.incidentId), ['forged']]) {
    await assert.rejects(f.apply('manager', 'warn', ids), (error) => error.reason === 'MODERATION_GROUNDS_INVALID');
  }
  await assert.rejects(f.apply('manager', 'warn', []), (error) => error.reason === 'MODERATION_GROUNDS_REQUIRED');
  await assert.rejects(f.apply('manager', 'warn', ['a'.repeat(64)]),
    (error) => error.reason === 'MODERATION_GROUND_INELIGIBLE');
  f.manager.branch.id = 'other-branch';
  await assert.rejects(f.apply('manager', 'warn'), (error) => error.reason === 'BRANCH_ACCESS_DENIED');
  assert.equal([...f.records.keys()].some((key) => key.startsWith('moderationActions/')), false);

  const changedManager = fixture();
  changedManager.records.get('users/manager-a').branchId = 'other-branch';
  await assert.rejects(changedManager.apply('manager', 'warn'),
    (error) => error.reason === 'BRANCH_ACCESS_DENIED');
  const changedAdmin = fixture();
  changedAdmin.records.get('users/admin-a').role = 'requester';
  await assert.rejects(changedAdmin.apply('admin', 'warn'),
    (error) => error.reason === 'MODERATION_ACTOR_CHANGED');
});

test('invalid delivery evidence fails closed regardless of aggregate severity', async () => {
  const variants = [
    (f) => { f.records.get(`deliveryAttempts/${f.attemptId}`).reviewState = 'reported'; },
    (f) => { f.records.get(`deliveryAttempts/${f.attemptId}`).responsibility = 'provider_responsible'; },
    (f) => { f.records.get(`deliveryAttempts/${f.attemptId}`).responsibility = 'shared'; },
    (f) => { f.records.get(`deliveryAttempts/${f.attemptId}`).responsibility = 'undetermined'; },
    (f) => { f.records.delete(`deliveryAttemptEvents/${decisionEventIdFor(f.attemptId)}`); },
    (f) => { f.records.get(`deliveryAttemptEvents/${decisionEventIdFor(f.attemptId)}`).managerUid = 'other-manager'; },
    (f) => { f.records.get(`deliveryAttempts/${f.attemptId}`).orderId = 'another-order'; },
    (f) => { f.records.get(`deliveryAttempts/${f.attemptId}`).requesterUid = 'another-requester'; },
    (f) => { f.records.get(`orderAbuseReviews/${f.reviewId}`).incidents[0].attemptId = 'b'.repeat(64); },
    (f) => { f.records.get(`orderAbuseReviews/${f.reviewId}`).incidents[0].sourceEventId = 'wrong'; },
    (f) => { f.records.delete(`deliveryAttemptEvents/${f.attemptId}_outcome`); },
    (f) => { f.records.get(`orderAbuseReviews/${f.reviewId}`).incidents[0].attemptId = undefined; },
  ];
  for (const corrupt of variants) {
    const f = fixture();
    corrupt(f);
    const before = clone([...f.records]);
    await assert.rejects(f.apply('manager', 'warn'),
      (error) => error.reason === 'MODERATION_GROUND_INELIGIBLE');
    assert.deepEqual([...f.records], before);
    assert.deepEqual(f.authCalls, []);
  }
});

test('mixed cases validate each selected ground and canonical cancellation independently', async () => {
  const f = fixture();
  const cancellationOrder = 'cancelled-order';
  const cancelledAt = new Date('2026-10-02T00:00:00Z');
  const cancellationId = hashId(cancellationOrder, 'cancellation', 'REQUESTER_CANCELLED', 'scheduled', cancelledAt.getTime());
  f.records.set(`requests/${cancellationOrder}`, { requesterUid: f.requesterUid, branchId: f.branchId,
    status: 'Cancelled', cancellationActorRole: 'requester', cancellationStageSnapshot: 'scheduled', cancelledAt });
  f.records.get(`orderAbuseReviews/${f.reviewId}`).incidents.push({ key: cancellationId,
    type: 'cancellation', orderId: cancellationOrder, category: 'REQUESTER_CANCELLED',
    stage: 'scheduled', concern: 'moderate', at: cancelledAt });
  f.records.get(`deliveryAttempts/${f.attemptId}`).responsibility = 'provider_responsible';
  await assert.rejects(f.apply('manager', 'warn', [cancellationId, f.incidentId]),
    (error) => error.reason === 'MODERATION_GROUND_INELIGIBLE');
  assert.equal([...f.records.keys()].some((key) => key.startsWith('moderationActions/')), false);
  const cancellation = f.records.get(`orderAbuseReviews/${f.reviewId}`).incidents[1];
  cancellation.incidentId = 'd'.repeat(64);
  await assert.rejects(f.apply('manager', 'warn', [cancellation.incidentId]),
    (error) => error.reason === 'MODERATION_GROUND_INELIGIBLE');
  delete cancellation.incidentId;
  const result = await f.apply('manager', 'warn', [cancellationId]);
  assert.equal(result.created, true);
  assert.equal(f.records.get('moderationActions/action-warn').validatedGrounds[0].type, 'cancellation');
});

test('non-punitive escalation remains available without grounds', async () => {
  const f = fixture();
  const result = await f.apply('manager', 'escalate', undefined, { incidentIds: undefined });
  assert.equal(result.created, true);
  assert.equal(f.records.get(`orderAbuseReviews/${f.reviewId}`).status, 'escalated');
  assert.deepEqual(f.authCalls, []);
});

test('moderation case DTO exposes selectable identity without private attempt details or a verified claim', () => {
  const f = fixture();
  const review = f.records.get(`orderAbuseReviews/${f.reviewId}`);
  review.incidents.push({ key: 'c'.repeat(64), type: 'delivery_failure', orderId: 'old-order',
    category: 'NO_RESPONSE', at: receivedAt });
  const dto = safeAbuseReview({ id: f.reviewId, ...review });
  assert.equal(dto.incidents[0].incidentId, f.incidentId);
  assert.equal(dto.incidents[0].linkedAttempt, true);
  assert.equal(dto.incidents[1].linkedAttempt, false);
  assert.equal('attemptId' in dto.incidents[0], false);
  assert.equal('requesterUid' in dto.incidents[0], false);
  assert.equal('verified' in dto.incidents[0], false);
});
