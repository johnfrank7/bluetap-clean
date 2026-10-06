const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertChatSendAllowed,
  assertOrderingAllowed,
  cancellationConcern,
  nextRestrictionProjection,
  recordOrderAbuseIncidentInTransaction,
  requesterAttributableFailure,
} = require('../moderationService');

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
    const result = await recordOrderAbuseIncidentInTransaction({
      tx: f.tx, db: f.db, orderId: `order-${index}`, order: { ...base, requestId: `BT-${index}` },
      incidentType: 'delivery_failure', category: 'NO_RESPONSE', stage: 'out_for_delivery',
      now: new Date(Date.parse('2026-10-01T00:00:00Z') + index * 1000),
    });
    if (index === 3) assert.equal(result.severity, 'review');
    if (index === 5) assert.equal(result.severity, 'strong_review');
  }
  const stored = [...f.records.entries()].find(([key]) => key.startsWith('orderAbuseReviews/'))[1];
  assert.equal(stored.incidentCount, 5);
  assert.equal(stored.status, 'open');
  assert.equal('accountStatus' in stored, false);
  assert.equal('automaticBan' in stored, false);

  const excluded = await recordOrderAbuseIncidentInTransaction({
    tx: f.tx, db: f.db, orderId: 'weather', order: base,
    incidentType: 'delivery_failure', category: 'WEATHER_OR_ROAD', stage: 'out_for_delivery', newStatus: 'delivery_failed',
  });
  assert.deepEqual(excluded, { recorded: false, reason: 'non-attributable' });
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
