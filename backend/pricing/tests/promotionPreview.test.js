const test = require('node:test');
const assert = require('node:assert/strict');
const { promotionPreviews } = require('../promotionPreview');

const promo = { id: 'promo', version: 2, title: 'Bundle', productId: 'p', active: true, commercialEligibility: 'refill_verified', branchIds: ['b'], containerChoices: ['Exchange'], tiers: [{ quantity: 3, bundlePriceCentavos: 5500 }, { quantity: 5, bundlePriceCentavos: 9000 }] };
const doc = (value) => ({ id: 'p', data: () => ({ product_name: 'Refill', price: 20, active: true, branchIds: ['b'], bundlePromotion: value, privateMetadata: 'must not leak' }) });
const catalog = { products: [{ id: 'p', product_name: 'Refill', price: 20, branchIds: ['b'] }], branches: [{ id: 'b', name: 'Branch' }, { id: 'other', name: 'Other' }] };
test('isolated preview uses calculator values and exposes only eligible public fields', () => {
  const [offer] = promotionPreviews([doc(promo)], catalog);
  assert.equal(offer.branchId, 'b'); assert.equal(offer.container, 'Exchange'); assert.equal(offer.version, 2);
  assert.deepEqual(offer.tiers.map((tier) => [tier.quantity, tier.regularCentavos, tier.priceCentavos, tier.savingsCentavos]), [[3, 6000, 5500, 500], [5, 10000, 9000, 1000]]);
  assert.equal(JSON.stringify(offer).includes('privateMetadata'), false);
  assert.equal(promotionPreviews([doc(null)], catalog).length, 0);
  assert.equal(promotionPreviews([doc({ ...promo, active: false })], catalog).length, 0);
  assert.equal(promotionPreviews([doc({ ...promo, endsAt: '2000-01-01T00:00:00Z' })], catalog).length, 0);
  assert.equal(promotionPreviews([doc({ ...promo, startsAt: '2999-01-01T00:00:00Z' })], catalog).length, 0);
  assert.equal(promotionPreviews([doc([promo, { ...promo, id: 'conflict' }])], catalog).length, 0);
  assert.equal(promotionPreviews([doc({ ...promo, tiers: [{ quantity: 3, bundlePriceCentavos: 6000 }] })], catalog).length, 0);
  assert.equal(promotionPreviews([doc({ ...promo, tiers: [{ quantity: 3, bundlePriceCentavos: 0 }] })], catalog).length, 0);
  assert.equal(promotionPreviews([doc(promo)], { ...catalog, branches: [{ id: 'other' }] }).length, 0);
  assert.equal(promotionPreviews([doc(promo)], { ...catalog, products: [{ ...catalog.products[0], price: 21 }] }).length, 0);
});
