const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyProduct, summarizeOrder, tripInterval, tripIntervalsConflict } = require('../../utils/deliveryTripFoundation');
const { createOrderLoadSnapshot, verifiedOrderSnapshot, preserveOrderLoadSnapshots } = require('../../utils/orderLoadSnapshot');
const epoch = 'a'.repeat(64);

test('trip intervals enforce overlap and the thirty-minute turnaround boundary', () => {
  const at = (minutes) => new Date(Date.UTC(2026, 0, 1) + minutes * 60000);
  const first = tripInterval(at(0), at(60));
  assert.equal(tripIntervalsConflict(first, tripInterval(at(89), at(120))), true);
  assert.equal(tripIntervalsConflict(first, tripInterval(at(90), at(120))), false);
  assert.equal(tripIntervalsConflict(tripInterval(at(-60), at(-30)), first), false);
  assert.equal(tripIntervalsConflict(first, tripInterval(at(30), at(45))), true);
  assert.equal(tripInterval(null, null), null);
  assert.throws(() => tripInterval(at(0), null), (error) => error.reason === 'TRIP_SCHEDULE_INVALID');
  assert.throws(() => tripInterval(at(60), at(60)), (error) => error.reason === 'TRIP_SCHEDULE_INVALID');
  assert.throws(() => tripIntervalsConflict(first, null), (error) => error.reason === 'TRIP_SCHEDULE_UNKNOWN');
});

test('explicit verified classification counts standard units and preserves other cargo', () => {
  const items = [{ productId: 'water', quantity: 3, productNameSnapshot: 'Refill', containerTypeSnapshot: '', sizeSnapshot: '', loadClassificationSnapshot: 'STANDARD_5_GALLON' }, { productId: 'bottles', quantity: 2, productNameSnapshot: '24 pack', containerTypeSnapshot: '', sizeSnapshot: '', loadClassificationSnapshot: 'OTHER_CARGO' }];
  const result = summarizeOrder('order', { items }, createOrderLoadSnapshot('order', items, epoch), epoch);
  assert.equal(result.containers, 3);
  assert.deepEqual(result.cargo[1], { productId: 'bottles', description: '24 pack', quantity: 2, classification: 'other' });
});

test('unverified, missing and malformed classification requires review', () => {
  for (const product of [null, {}, { size: '5 gallons' }, { deliveryLoad: { classification: 'standard_5_gallon' } }, { deliveryLoad: { classification: 'invalid', verified: true } }]) {
    assert.equal(classifyProduct(product), 'unknown');
    assert.throws(() => summarizeOrder('order', { items: [{ productId: 'water', quantity: 1 }] }, null, epoch), (error) => error.reason === 'TRIP_LOAD_UNKNOWN');
  }
});

test('missing, forged, stale, or unknown snapshots fail closed', () => {
  const items = [{ productId: 'water', quantity: 2, productNameSnapshot: 'Water', containerTypeSnapshot: '', sizeSnapshot: '', loadClassificationSnapshot: 'STANDARD_5_GALLON' }];
  const proof = createOrderLoadSnapshot('order', items, epoch);
  for (const [current, saved, activeEpoch] of [
    [items, null, epoch], [items, proof, null], [items, { ...proof, epoch: 'b'.repeat(64) }, epoch],
    [[{ ...items[0], quantity: 3 }], proof, epoch], [[{ ...items[0], loadClassificationSnapshot: 'OTHER_CARGO' }], proof, epoch],
    [items, { ...proof, items: [{ ...proof.items[0], quantity: 3 }] }, epoch],
    [[{ ...items[0], loadClassificationSnapshot: 'UNKNOWN' }], createOrderLoadSnapshot('order', [{ ...items[0], loadClassificationSnapshot: 'UNKNOWN' }], epoch), epoch],
  ]) assert.throws(() => summarizeOrder('order', { items: current }, saved, activeEpoch), (error) => error.reason === 'TRIP_LOAD_UNKNOWN');
});

test('Manager edit preserves proven order-time classification and keeps legacy or ambiguous lines unknown', () => {
  const old = [{ productId: 'water', quantity: 2, productNameSnapshot: 'Old water', containerTypeSnapshot: 'Gallon', sizeSnapshot: '5 gal', loadClassificationSnapshot: 'STANDARD_5_GALLON' }];
  const proof = createOrderLoadSnapshot('order', old, epoch);
  const entries = verifiedOrderSnapshot('order', old, proof, epoch);
  const next = [{ ...old[0], quantity: 3, productNameSnapshot: 'Changed catalog' }, { productId: 'new', loadClassificationSnapshot: 'OTHER_CARGO' }];
  const preserved = preserveOrderLoadSnapshots(old, entries, next);
  assert.equal(preserved[0].loadClassificationSnapshot, 'STANDARD_5_GALLON'); assert.equal(preserved[0].productNameSnapshot, 'Old water'); assert.equal(preserved[0].quantity, 3);
  assert.equal(preserved[1].loadClassificationSnapshot, 'OTHER_CARGO');
  assert.equal(preserveOrderLoadSnapshots(old, null, next)[0].loadClassificationSnapshot, 'UNKNOWN');
  const conflicting = [...entries, { ...entries[0], classification: 'OTHER_CARGO' }];
  assert.equal(preserveOrderLoadSnapshots(old, conflicting, next)[0].loadClassificationSnapshot, 'UNKNOWN');
  const changedCargo = [{ ...next[0], sizeSnapshot: '24 pack', loadClassificationSnapshot: 'OTHER_CARGO' }];
  assert.equal(preserveOrderLoadSnapshots(old, entries, changedCargo)[0].loadClassificationSnapshot, 'UNKNOWN');
  assert.equal(preserveOrderLoadSnapshots(old, entries, [{ ...changedCargo[0], quantity: 2 }])[0].loadClassificationSnapshot, 'STANDARD_5_GALLON');
});
