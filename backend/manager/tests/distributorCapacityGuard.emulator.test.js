const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { reserveDistributorSlot, readDistributorGuard, planDistributorReservation, planDistributorRelease, stageDistributorGuard } = require('../../utils/distributorCapacityGuard');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'
  && process.env.GCLOUD_PROJECT === 'demo-bluetap';
const base = Date.parse('2030-01-01T00:00:00Z');
const at = (minutes) => new Date(base + minutes * 60000);

async function fixture(callback) {
  const suffix = randomUUID();
  const app = initializeApp({ projectId: 'demo-bluetap' }, `capacity-${suffix}`);
  const db = getFirestore(app);
  const guard = db.collection('phase5ba21_test_guards').doc(`distributor-${suffix}`);
  const order = (id) => db.collection('phase5ba21_test_orders').doc(`${id}-${suffix}`);
  const ready = (reservations = []) => ({ schemaVersion: 1, initialized: true, distributorUid: guard.id, revision: 0, reservations });
  try { await callback({ db, guard, order, ready }); } finally { await deleteApp(app); }
}

function transaction(db, guard, orderRef, scheduledAt, beforeGuard = async () => {}, fail = false) {
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(orderRef);
    assert.ok(snapshot.exists);
    await beforeGuard();
    const result = await reserveDistributorSlot(tx, guard, { orderId: orderRef.id, scheduledAt });
    if (result.changed) tx.update(orderRef, { status: 'assigned', scheduledAt });
    if (fail) throw new Error('simulated failure after writes staged');
    return result;
  });
}

function simultaneousFirstAttempts() {
  let arrivals = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  return () => {
    let first = true;
    return async () => {
      if (!first) return;
      first = false;
      arrivals += 1;
      if (arrivals === 2) release();
      await barrier;
    };
  };
}

test('emulator serializes two different orders competing for the fifth slot', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const existing = Array.from({ length: 4 }, (_, index) => ({ orderId: `existing-${index}`, scheduledAt: at(index * 120) }));
  const a = order('capacity-a'); const b = order('capacity-b');
  await guard.set(ready(existing));
  await Promise.all([a.set({ status: 'pending' }), b.set({ status: 'pending' })]);
  const gate = simultaneousFirstAttempts();
  const results = await Promise.allSettled([transaction(db, guard, a, at(600), gate()), transaction(db, guard, b, at(720), gate())]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.reason, 'DISTRIBUTOR_WORKLOAD_EXCEEDED');
  const saved = (await guard.get()).data();
  assert.equal(saved.reservations.length, 5);
  assert.equal(saved.revision, 1);
  const statuses = [(await a.get()).data().status, (await b.get()).data().status].sort();
  assert.deepEqual(statuses, ['assigned', 'pending']);
}));

test('emulator serializes conflicting times for different orders', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const a = order('schedule-a'); const b = order('schedule-b');
  await guard.set(ready());
  await Promise.all([a.set({ status: 'pending' }), b.set({ status: 'pending' })]);
  const gate = simultaneousFirstAttempts();
  const results = await Promise.allSettled([transaction(db, guard, a, at(600), gate()), transaction(db, guard, b, at(615), gate())]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.reason, 'DISTRIBUTOR_SCHEDULE_CONFLICT');
  assert.equal((await guard.get()).data().reservations.length, 1);
  assert.deepEqual([(await a.get()).data().status, (await b.get()).data().status].sort(), ['assigned', 'pending']);
}));

test('emulator reschedules the same order at full capacity without adding a slot', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const target = order('reschedule');
  const entries = Array.from({ length: 4 }, (_, index) => ({ orderId: `other-${index}`, scheduledAt: at(index * 120) }));
  await guard.set(ready([...entries, { orderId: target.id, scheduledAt: at(600) }]));
  await target.set({ status: 'assigned', scheduledAt: at(600) });
  assert.equal((await transaction(db, guard, target, at(720))).count, 5);
  const saved = (await guard.get()).data();
  assert.equal(saved.reservations.length, 5);
  assert.equal(saved.reservations.filter((entry) => entry.orderId === target.id).length, 1);
  assert.equal(saved.reservations.find((entry) => entry.orderId === target.id).scheduledAt.toMillis(), at(720).getTime());
}));

test('emulator fails closed for missing, incomplete and malformed guards', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const target = order('invalid');
  await target.set({ status: 'pending' });
  const rejected = async () => assert.rejects(transaction(db, guard, target, at(600)), (error) => error.reason === 'DISPATCH_GUARD_INVALID');
  await rejected();
  for (const state of [
    { ...ready(), initialized: false },
    { ...ready(), revision: null },
    { ...ready(), distributorUid: 'someone-else' },
    { ...ready(), reservations: [{ orderId: 'missing-schedule' }] },
    { ...ready(), reservations: [{ orderId: 'empty-schedule', scheduledAt: '' }] },
    { ...ready(), reservations: [{ orderId: 'bad', scheduledAt: 'invalid' }] },
    { ...ready(), reservations: [{ orderId: 'same', scheduledAt: at(0) }, { orderId: 'same', scheduledAt: at(120) }] },
  ]) { await guard.set(state); await rejected(); }
  assert.equal((await target.get()).data().status, 'pending');
}));

test('emulator counts an explicit unscheduled order and safely schedules it at capacity', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const target = order('legacy-unscheduled');
  const entries = Array.from({ length: 4 }, (_, index) => ({ orderId: `other-${index}`, scheduledAt: at(index * 120) }));
  await guard.set(ready([...entries, { orderId: target.id, scheduledAt: null }]));
  await target.set({ status: 'assigned', scheduledAt: null });
  const result = await transaction(db, guard, target, at(600));
  assert.equal(result.count, 5);
  const saved = (await guard.get()).data();
  assert.equal(saved.reservations.length, 5);
  assert.equal(saved.reservations.find((entry) => entry.orderId === target.id).scheduledAt.toMillis(), at(600).getTime());
  assert.equal((await target.get()).data().scheduledAt.toMillis(), at(600).getTime());
}));

test('emulator blocks schedule changes when another reservation is unscheduled', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const target = order('blocked-by-unknown');
  await guard.set(ready([{ orderId: 'unknown-other', scheduledAt: null }, { orderId: target.id, scheduledAt: at(600) }]));
  await target.set({ status: 'assigned', scheduledAt: at(600) });
  await assert.rejects(transaction(db, guard, target, at(720)), (error) => error.reason === 'DISTRIBUTOR_SCHEDULE_UNKNOWN');
  assert.equal((await guard.get()).data().revision, 0);
  assert.equal((await target.get()).data().scheduledAt.toMillis(), at(600).getTime());
  const other = order('new-scheduled'); await other.set({ status: 'pending' });
  await assert.rejects(transaction(db, guard, other, at(840)), (error) => error.reason === 'DISTRIBUTOR_SCHEDULE_UNKNOWN');
  assert.equal((await other.get()).data().status, 'pending');
}));

test('emulator releases unscheduled reservations and retains other null schedules', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const target = order('release-unknown');
  await guard.set(ready([{ orderId: target.id, scheduledAt: null }, { orderId: 'other-unknown', scheduledAt: null }]));
  await target.set({ status: 'assigned', scheduledAt: null });
  await db.runTransaction(async (tx) => {
    await tx.get(target);
    const plan = planDistributorRelease(await readDistributorGuard(tx, guard), target.id);
    stageDistributorGuard(tx, plan);
    tx.update(target, { status: 'released' });
  });
  const saved = (await guard.get()).data();
  assert.deepEqual(saved.reservations, [{ orderId: 'other-unknown', scheduledAt: null }]);
  assert.equal(saved.revision, 1);
  assert.equal((await target.get()).data().status, 'released');
}));

test('emulator retries explicit unscheduled reservations without duplicate capacity or writes', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const target = order('retry-unknown'); await guard.set(ready()); await target.set({ status: 'pending' });
  assert.equal((await transaction(db, guard, target, null)).changed, true);
  assert.equal((await transaction(db, guard, target, null)).changed, false);
  const saved = (await guard.get()).data();
  assert.deepEqual(saved.reservations, [{ orderId: target.id, scheduledAt: null }]);
  assert.equal(saved.revision, 1);
}));

test('emulator treats an unscheduled reservation as a capacity slot', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const target = order('capacity-unknown');
  const entries = Array.from({ length: 4 }, (_, index) => ({ orderId: `other-${index}`, scheduledAt: at(index * 120) }));
  await guard.set(ready([...entries, { orderId: 'unknown', scheduledAt: null }]));
  await target.set({ status: 'pending' });
  await assert.rejects(transaction(db, guard, target, at(720)), (error) => error.reason === 'DISTRIBUTOR_WORKLOAD_EXCEEDED');
  assert.equal((await guard.get()).data().reservations.length, 5);
  assert.equal((await target.get()).data().status, 'pending');
}));

test('emulator checks the 30-minute rule when scheduling a previously unscheduled order', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const target = order('unknown-conflict');
  await guard.set(ready([{ orderId: 'existing', scheduledAt: at(600) }, { orderId: target.id, scheduledAt: null }]));
  await target.set({ status: 'assigned', scheduledAt: null });
  await assert.rejects(transaction(db, guard, target, at(629)), (error) => error.reason === 'DISTRIBUTOR_SCHEDULE_CONFLICT');
  assert.equal((await target.get()).data().scheduledAt, null);
  assert.equal((await transaction(db, guard, target, at(630))).count, 2);
}));

test('emulator rejects missing schedule inputs and ambiguous new unscheduled reservations', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const target = order('invalid-input');
  await guard.set(ready([{ orderId: 'existing', scheduledAt: at(600) }])); await target.set({ status: 'pending' });
  for (const value of [undefined, '', 'invalid']) {
    await assert.rejects(transaction(db, guard, target, value), (error) => error.reason === 'DISPATCH_GUARD_INVALID');
  }
  await assert.rejects(transaction(db, guard, target, null), (error) => error.reason === 'DISTRIBUTOR_SCHEDULE_UNKNOWN');
  assert.equal((await guard.get()).data().revision, 0);
}));

test('emulator serializes resolving an unknown schedule against a conflicting different order', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const unknown = order('unknown-race'); const other = order('competing-race');
  await guard.set(ready([{ orderId: unknown.id, scheduledAt: null }]));
  await Promise.all([unknown.set({ status: 'assigned', scheduledAt: null }), other.set({ status: 'pending' })]);
  const gate = simultaneousFirstAttempts();
  const results = await Promise.allSettled([transaction(db, guard, unknown, at(600), gate()), transaction(db, guard, other, at(615), gate())]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.ok(['DISTRIBUTOR_SCHEDULE_UNKNOWN', 'DISTRIBUTOR_SCHEDULE_CONFLICT'].includes(results[1].reason.reason));
  const saved = (await guard.get()).data(); assert.equal(saved.reservations.length, 1);
  assert.equal(saved.reservations[0].orderId, unknown.id);
  assert.equal((await other.get()).data().status, 'pending');
}));

test('emulator identical retries do not duplicate reservations or advance revision', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const target = order('retry');
  await guard.set(ready());
  await target.set({ status: 'pending' });
  assert.equal((await transaction(db, guard, target, at(600))).changed, true);
  assert.equal((await transaction(db, guard, target, at(600))).changed, false);
  const saved = (await guard.get()).data();
  assert.equal(saved.revision, 1);
  assert.equal(saved.reservations.length, 1);
}));

test('emulator permits exactly 30 minutes and rejects a shorter interval', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const allowed = order('boundary-allowed'); const blocked = order('boundary-blocked');
  await guard.set(ready([{ orderId: 'existing', scheduledAt: at(600) }]));
  await Promise.all([allowed.set({ status: 'pending' }), blocked.set({ status: 'pending' })]);
  await assert.rejects(transaction(db, guard, blocked, at(629)), (error) => error.reason === 'DISTRIBUTOR_SCHEDULE_CONFLICT');
  assert.equal((await transaction(db, guard, allowed, at(630))).changed, true);
  assert.equal((await guard.get()).data().reservations.length, 2);
  assert.equal((await blocked.get()).data().status, 'pending');
}));

test('emulator transaction failure commits neither order nor reservation', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const target = order('failure');
  await guard.set(ready());
  await target.set({ status: 'pending' });
  await assert.rejects(transaction(db, guard, target, at(600), async () => {}, true), /simulated failure/);
  assert.equal((await target.get()).data().status, 'pending');
  const saved = (await guard.get()).data();
  assert.equal(saved.revision, 0);
  assert.equal(saved.reservations.length, 0);
}));

test('emulator stages an isolated move between guards after all reads', { skip: !enabled }, async () => fixture(async ({ db, guard, order, ready }) => {
  const target = order('move');
  const nextGuard = guard.parent.doc(`${guard.id}-next`);
  await guard.set(ready([{ orderId: target.id, scheduledAt: at(600) }]));
  await nextGuard.set({ ...ready(), distributorUid: nextGuard.id });
  await target.set({ status: 'assigned', distributorUid: guard.id, scheduledAt: at(600) });
  await db.runTransaction(async (tx) => {
    await tx.get(target);
    const before = await readDistributorGuard(tx, guard);
    const after = await readDistributorGuard(tx, nextGuard);
    const release = planDistributorRelease(before, target.id);
    const reserve = planDistributorReservation(after, { orderId: target.id, scheduledAt: at(720), mustBeAbsent: true });
    stageDistributorGuard(tx, release);
    stageDistributorGuard(tx, reserve);
    tx.update(target, { distributorUid: nextGuard.id, scheduledAt: at(720) });
  });
  assert.equal((await guard.get()).data().reservations.length, 0);
  assert.equal((await nextGuard.get()).data().reservations[0].orderId, target.id);
  assert.equal((await target.get()).data().distributorUid, nextGuard.id);
}));
