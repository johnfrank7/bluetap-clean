const test = require('node:test');
const assert = require('node:assert/strict');
const { manilaDateTimeFields, manilaDateTimeToIso } = require('../../../services/promotionSchedule');
const { validateBundlePromotion } = require('../bundlePromotionConfig');

test('Philippine date and time round trips with explicit UTC conversion and preserved precision', () => {
  assert.equal(manilaDateTimeToIso('2028-01-01', '07:30'), '2027-12-31T23:30:00.000Z');
  assert.deepEqual(manilaDateTimeFields('2027-12-31T23:30:00Z'), { date: '2028-01-01', time: '07:30' });
  assert.deepEqual(manilaDateTimeFields('2028-02-29T15:59:12.345Z'), { date: '2028-02-29', time: '23:59:12.345' });
  assert.equal(manilaDateTimeToIso('2028-02-29', '23:59:12.345'), '2028-02-29T15:59:12.345Z');
  for (const [date, time] of [['2027-02-29', '10:00'], ['2028-13-01', '10:00'], ['2028-01-01', '24:00'], ['', '10:00'], ['2028-01-01', '']]) assert.equal(manilaDateTimeToIso(date, time), null);
});

test('scheduled and indefinite drafts retain schedules and reject invalid eligibility and ordering', () => {
  const context = { productId: 'p', productPrice: 20, allowedBranches: ['b'], actorUid: 'admin', now: new Date('2026-01-01T00:00:00Z') };
  const draft = { expectedVersion: 0, title: 'Refill', commercialEligibility: 'refill_verified', active: false, branchIds: ['b'], containerChoices: ['Exchange'], tiers: [{ quantity: 3, bundlePriceCentavos: 5500 }] };
  const indefinite = validateBundlePromotion({ ...draft, startsAt: null, endsAt: null }, context);
  assert.equal(indefinite.startsAt, null); assert.equal(indefinite.endsAt, null); assert.equal(indefinite.active, false);
  const scheduled = validateBundlePromotion({ ...draft, startsAt: '2027-12-31T08:00:00+08:00', endsAt: '2028-01-01T17:00:00+08:00' }, context);
  assert.equal(scheduled.startsAt, '2027-12-31T00:00:00.000Z'); assert.equal(scheduled.endsAt, '2028-01-01T09:00:00.000Z');
  assert.throws(() => validateBundlePromotion({ ...draft, startsAt: scheduled.endsAt, endsAt: scheduled.startsAt }, context), { reason: 'INVALID_BUNDLE_PROMOTION' });
  assert.throws(() => validateBundlePromotion({ ...draft, startsAt: '2027-02-29T08:00:00+08:00' }, context), { reason: 'INVALID_BUNDLE_PROMOTION' });
  assert.throws(() => validateBundlePromotion({ ...draft, commercialEligibility: 'container' }, context), { reason: 'INVALID_BUNDLE_PROMOTION' });
  assert.throws(() => validateBundlePromotion({ ...draft, branchIds: ['other'] }, context), { reason: 'INVALID_BUNDLE_PROMOTION' });
  assert.throws(() => validateBundlePromotion({ ...draft, containerChoices: ['unknown'] }, context), { reason: 'INVALID_BUNDLE_PROMOTION' });
  assert.throws(() => validateBundlePromotion({ ...draft, tiers: [...draft.tiers, ...draft.tiers] }, context), { reason: 'INVALID_BUNDLE_PROMOTION' });
  assert.throws(() => validateBundlePromotion({ ...draft, tiers: [{ quantity: 3, bundlePriceCentavos: 6000 }] }, context), { reason: 'INVALID_BUNDLE_PROMOTION' });
  assert.throws(() => validateBundlePromotion({ ...draft, tiers: [{ quantity: 3, bundlePriceCentavos: 0 }] }, context), { reason: 'INVALID_BUNDLE_PROMOTION' });
});
