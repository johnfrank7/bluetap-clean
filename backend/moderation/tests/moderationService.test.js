const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertChatSendAllowed,
  assertOrderingAllowed,
  cancellationConcern,
  nextRestrictionProjection,
  prepareOrderAbuseIncidentInTransaction,
  recordOrderAbuseIncidentInTransaction,
  requesterAttributableFailure,
  hashId,
} = require('../moderationService');
const { attemptIdFor } = require('../../delivery/deliveryAttemptService');

const clone = (value) => value === undefined ? undefined : structuredClone(value);

function storeFixture(initial = {}) {
  const records = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]));
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => clone(records.get(path)) });
  const db = { collection: (name) => ({ doc: (id) => ({ path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }) }) };
  const tx = {
    get: async (ref) => snapshot(ref.path),
    set(ref, data, options) {
      records.set(ref.path, options?.merge ? { ...(records.get(ref.path) || {}), ...clone(data) } : clone(data));
    },
  };
  return { db, tx, records };
}

function failedAttemptWrites(orderId, number, requesterUid, branchId, at, category = 'NO_RESPONSE', method = 'create') {
  const attemptId = attemptIdFor(orderId, number);
  return [
    { method, ref: { path: `deliveryAttempts/${attemptId}` }, data: {
      ...(method === 'create' ? { orderId, requesterUid, branchId } : {}),
      outcome: 'failed', reportedReasonCode: category, reportReceivedAt: at,
    } },
    { method: 'create', ref: { path: `deliveryAttemptEvents/${attemptId}_outcome` }, data: {
      kind: 'ATTEMPT_FAILED', attemptId, attemptNumber: number, orderId, branchId,
      outcome: 'failed', reportedReasonCode: category, createdAt: at,
    } },
  ];
}

test('delivery and cancellation abuse classification counts only requester-attributable operational incidents', () => {
  for (const code of ['CUSTOMER_UNAVAILABLE', 'NO_RESPONSE', 'RECIPIENT_REFUSED']) assert.equal(requesterAttributableFailure(code), true);
  for (const code of ['WEATHER_OR_ROAD', 'VEHICLE_ISSUE', 'PRODUCT_ISSUE']) assert.equal(requesterAttributableFailure(code), false);
  assert.equal(cancellationConcern('pending'), 'low');
  assert.equal(cancellationConcern('scheduled'), 'moderate');
  assert.equal(cancellationConcern('out_for_delivery'), 'high');
});

test('three incidents flag review, five strengthen review, and no account punishment is generated', async () => {
  const f = storeFixture();
  const base = {
    requesterUid: 'requester-a', requesterPublicUidSnapshot: 'Req001', currentBranchId: 'branch-a',
    currentBranchNameSnapshot: 'BlueTap A', requestId: 'BT-1',
  };
  for (let index = 1; index <= 5; index += 1) {
    const at = new Date(Date.parse('2026-10-01T00:00:00Z') + index * 1000);
    const orderId = `order-${index}`;
    const result = await recordOrderAbuseIncidentInTransaction({
      tx: f.tx, db: f.db, orderId, order: { ...base, requestId: `BT-${index}` },
      incidentType: 'delivery_failure', category: 'NO_RESPONSE', stage: 'out_for_delivery',
      now: at, deliveryAttemptWrites: failedAttemptWrites(orderId, 1, base.requesterUid, base.currentBranchId, at),
    });
    if (index === 3) assert.equal(result.severity, 'review');
    if (index === 5) assert.equal(result.severity, 'strong_review');
  }
  const stored = [...f.records.entries()].find(([key]) => key.startsWith('orderAbuseReviews/'))[1];
  assert.equal(stored.incidentCount, 5);
  assert.equal(stored.status, 'open');
  assert.equal('accountStatus' in stored, false);
  assert.equal('automaticBan' in stored, false);
  assert.equal(stored.incidents.every((incident) => incident.attemptId === attemptIdFor(incident.orderId, 1)
    && incident.sourceEventId === `${incident.attemptId}_outcome`
    && incident.requesterUid === base.requesterUid && incident.reportingBranchId === base.currentBranchId
    && incident.incidentId === hashId('delivery_failure', incident.attemptId)
    && !Object.hasOwn(incident, 'verified')), true);

  const excluded = await recordOrderAbuseIncidentInTransaction({
    tx: f.tx, db: f.db, orderId: 'weather', order: base,
    incidentType: 'delivery_failure', category: 'WEATHER_OR_ROAD', stage: 'out_for_delivery', newStatus: 'delivery_failed',
  });
  assert.deepEqual(excluded, { recorded: false, reason: 'non-attributable' });
});

test('exact attempt identity distinguishes repeated deliveries and preserves historical unlinked allegations', async () => {
  const orderId = 'same-order';
  const requesterUid = 'requester-a';
  const branchId = 'branch-a';
  const path = `orderAbuseReviews/${hashId(branchId, requesterUid)}`;
  const legacy = { key: 'historical-key', orderId, type: 'delivery_failure', category: 'NO_RESPONSE',
    at: new Date('2026-10-01T00:00:00Z') };
  const f = storeFixture({ [path]: { status: 'open', incidents: [legacy] } });
  const submit = async (number, at) => recordOrderAbuseIncidentInTransaction({
    tx: f.tx, db: f.db, orderId, order: { requesterUid, currentBranchId: branchId,
      ...(number > 1 ? { deliveryAttemptSeq: number, activeDeliveryAttemptId: attemptIdFor(orderId, number) } : {}) },
    incidentType: 'delivery_failure', category: 'NO_RESPONSE', stage: 'out_for_delivery', now: at,
    deliveryAttemptWrites: failedAttemptWrites(orderId, number, requesterUid, branchId, at, 'NO_RESPONSE', number > 1 ? 'update' : 'create'),
  });
  const firstAt = new Date('2026-10-02T00:00:00Z');
  await submit(1, firstAt);
  await submit(1, firstAt);
  await submit(2, new Date('2026-10-03T00:00:00Z'));
  const incidents = f.records.get(path).incidents;
  assert.equal(incidents.length, 3);
  assert.deepEqual(incidents[0], legacy);
  assert.notEqual(incidents[1].incidentId, incidents[2].incidentId);
  assert.deepEqual(incidents.slice(1).map((incident) => incident.attemptId),
    [attemptIdFor(orderId, 1), attemptIdFor(orderId, 2)]);
});

test('forged, mismatched, and missing failed-outcome writes cannot create a linked incident', async () => {
  const f = storeFixture();
  const now = new Date('2026-10-02T00:00:00Z');
  const base = { tx: f.tx, db: f.db, orderId: 'order-a',
    order: { requesterUid: 'requester-a', currentBranchId: 'branch-a' },
    incidentType: 'delivery_failure', category: 'NO_RESPONSE', stage: 'out_for_delivery', now };
  const good = failedAttemptWrites('order-a', 1, 'requester-a', 'branch-a', now);
  const bad = [
    [], good.slice(0, 1),
    [{ ...good[0], ref: { path: `deliveryAttempts/${attemptIdFor('other-order', 1)}` } }, good[1]],
    [good[0], { ...good[1], data: { ...good[1].data, attemptId: attemptIdFor('other-order', 1) } }],
    [good[0], { ...good[1], data: { ...good[1].data, branchId: 'other-branch' } }],
    [{ ...good[0], data: { ...good[0].data, requesterUid: 'other-requester' } }, good[1]],
    [{ ...good[0], data: { ...good[0].data, orderId: 'other-order' } }, good[1]],
    [good[0], { ...good[1], ref: { path: 'deliveryAttemptEvents/wrong_outcome' } }],
  ];
  for (const deliveryAttemptWrites of bad) {
    await assert.rejects(prepareOrderAbuseIncidentInTransaction({ ...base, deliveryAttemptWrites }),
      (error) => error.reason === 'DELIVERY_INCIDENT_SOURCE_INVALID');
  }
  assert.equal(f.records.size, 0);
});

test('restriction projection prefers platform scope and expires by server time without cleanup', async () => {
  const startsAt = new Date('2026-10-01T00:00:00Z');
  const branchEntry = { scope: 'branch_chat', branchId: 'branch-a', startsAt, endsAt: new Date('2026-10-02T00:00:00Z') };
  const branchOnly = nextRestrictionProjection({}, branchEntry, startsAt);
  const f = storeFixture({ 'chatRestrictions/requester-a': branchOnly });
  await assert.rejects(assertChatSendAllowed(f.tx, f.db, 'requester-a', 'branch-a', startsAt), (error) => error.reason === 'CHAT_BRANCH_SUSPENDED');
  await assert.doesNotReject(assertChatSendAllowed(f.tx, f.db, 'requester-a', 'branch-b', startsAt));
  await assert.doesNotReject(assertChatSendAllowed(f.tx, f.db, 'requester-a', 'branch-a', new Date('2026-10-02T00:00:00Z')));

  const ordering = nextRestrictionProjection({}, {
    scope: 'platform_ordering', startsAt, endsAt: new Date('2026-10-03T00:00:00Z'),
  }, startsAt);
  const platform = storeFixture({ 'orderingRestrictions/requester-a': ordering });
  await assert.rejects(assertOrderingAllowed(platform.tx, platform.db, 'requester-a', 'branch-any', startsAt), (error) => error.reason === 'ORDERING_SUSPENDED');
  await assert.doesNotReject(assertOrderingAllowed(platform.tx, platform.db, 'requester-a', 'branch-any', new Date('2026-10-03T00:00:00Z')));
});

test('indefinite branch suspension blocks ordering and chat for the target branch while other branches remain open', async () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const future = new Date('2030-01-01T00:00:00Z');
  const indefiniteOrdering = {
    branches: {
      'branch-north': {
        restricted: true,
        scope: 'branch_ordering',
        branchId: 'branch-north',
        branchNameSnapshot: 'North Branch',
        startsAt: now,
        endsAt: null,
      },
    },
  };
  const fOrdering = storeFixture({ 'orderingRestrictions/requester-test': indefiniteOrdering });
  await assert.rejects(
    assertOrderingAllowed(fOrdering.tx, fOrdering.db, 'requester-test', 'branch-north', future),
    (error) => error.reason === 'ORDERING_BRANCH_SUSPENDED'
  );
  await assert.doesNotReject(
    assertOrderingAllowed(fOrdering.tx, fOrdering.db, 'requester-test', 'branch-south', future)
  );

  const indefiniteChat = {
    branches: {
      'branch-north': {
        restricted: true,
        scope: 'branch_chat',
        branchId: 'branch-north',
        branchNameSnapshot: 'North Branch',
        startsAt: now,
        endsAt: null,
      },
    },
  };
  const fChat = storeFixture({ 'chatRestrictions/requester-test': indefiniteChat });
  await assert.rejects(
    assertChatSendAllowed(fChat.tx, fChat.db, 'requester-test', 'branch-north', future),
    (error) => error.reason === 'CHAT_BRANCH_SUSPENDED'
  );
  await assert.doesNotReject(
    assertChatSendAllowed(fChat.tx, fChat.db, 'requester-test', 'branch-south', future)
  );
});
