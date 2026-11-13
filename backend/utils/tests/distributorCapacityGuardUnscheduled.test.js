const assert = require('node:assert/strict');
const test = require('node:test');
const { readDistributorGuard, planDistributorReservation, planDistributorRelease } = require('../distributorCapacityGuard');

const guardRef = { id: 'distributor-1' };
const at = (minutes) => new Date(Date.UTC(2030, 0, 1, 0, minutes));
const state = (reservations) => ({ schemaVersion: 1, initialized: true, distributorUid: guardRef.id, revision: 0, reservations });
const read = (data) => readDistributorGuard({ get: async () => ({ exists: true, data: () => data }) }, guardRef);

test('only explicit null represents a known unscheduled reservation', async () => {
  const guard = await read(state([{ orderId: 'legacy', scheduledAt: null }]));
  assert.equal(guard.reservations[0].time, null);
  for (const entry of [
    { orderId: 'missing' }, { orderId: 'undefined', scheduledAt: undefined },
    { orderId: 'empty', scheduledAt: '' }, { orderId: 'bad', scheduledAt: 'bad-date' },
    { orderId: 'boolean', scheduledAt: false }, { orderId: 'object', scheduledAt: {} },
  ]) await assert.rejects(read(state([entry])), (error) => error.reason === 'DISPATCH_GUARD_INVALID');
});

test('scheduling the same unscheduled order keeps its capacity slot and checks other times', async () => {
  const guard = await read(state([{ orderId: 'legacy', scheduledAt: null }, ...[0, 120, 240, 360].map((minute, index) => ({ orderId: `other-${index}`, scheduledAt: at(minute) }))]));
  assert.throws(() => planDistributorReservation(guard, { orderId: 'new', scheduledAt: at(600) }), (error) => error.reason === 'DISTRIBUTOR_WORKLOAD_EXCEEDED');
  assert.throws(() => planDistributorReservation(guard, { orderId: 'legacy', scheduledAt: at(389), mustExist: true }), (error) => error.reason === 'DISTRIBUTOR_SCHEDULE_CONFLICT');
  const plan = planDistributorReservation(guard, { orderId: 'legacy', scheduledAt: at(390), mustExist: true });
  assert.equal(plan.count, 5); assert.equal(plan.update.reservations.length, 5);
  assert.equal(plan.update.reservations.find((entry) => entry.orderId === 'legacy').scheduledAt.getTime(), at(390).getTime());
});

test('unknown schedules block new conflict checks but allow idempotence and release', async () => {
  const guard = await read(state([{ orderId: 'unknown-a', scheduledAt: null }, { orderId: 'unknown-b', scheduledAt: null }]));
  assert.equal(planDistributorReservation(guard, { orderId: 'unknown-a', scheduledAt: null, mustExist: true }).changed, false);
  assert.throws(() => planDistributorReservation(guard, { orderId: 'unknown-a', scheduledAt: at(600), mustExist: true }), (error) => error.reason === 'DISTRIBUTOR_SCHEDULE_UNKNOWN');
  assert.throws(() => planDistributorReservation(guard, { orderId: 'new', scheduledAt: at(720), mustBeAbsent: true }), (error) => error.reason === 'DISTRIBUTOR_SCHEDULE_UNKNOWN');
  assert.deepEqual(planDistributorRelease(guard, 'unknown-a').update.reservations, [{ orderId: 'unknown-b', scheduledAt: null }]);
  assert.throws(() => planDistributorRelease(guard, 'missing'), (error) => error.reason === 'DISPATCH_GUARD_INVALID');
});
