const test = require('node:test');
const assert = require('node:assert/strict');
const { eligiblePromotionPreviews, estimatedPromotionSavings, promotionSessionKey, wasPromotionSeen, markPromotionSeen } = require('../../../services/promotionPresentation');
const offer = { id: 'p', version: 2, branchId: 'b', container: 'Exchange', tiers: [{ quantity: 3, regularCentavos: 6000, priceCentavos: 5500, savingsCentavos: 500 }] };
test('previews require explicit isolated data and exact branch and container', () => {
  assert.deepEqual(eligiblePromotionPreviews({ promotionPreviews: [offer] }, 'b', 'Exchange'), []);
  const catalog = { promotionPreviewOnly: true, promotionPreviews: [offer] };
  assert.equal(eligiblePromotionPreviews(catalog, 'b', 'Exchange').length, 1);
  assert.equal(eligiblePromotionPreviews({ promotionCheckoutEnabled: true, promotionPreviews: [offer] }, 'b', 'Exchange').length, 1);
  assert.equal(eligiblePromotionPreviews(catalog, 'other', 'Exchange').length, 0);
  assert.equal(eligiblePromotionPreviews(catalog, 'b', 'New Container').length, 0);
  assert.equal(eligiblePromotionPreviews({ ...catalog, promotionPreviews: [{ ...offer, endsAt: '2000-01-01T00:00:00Z' }] }, 'b').length, 0);
  assert.equal(eligiblePromotionPreviews({ ...catalog, promotionPreviews: [{ ...offer, tiers: [{ ...offer.tiers[0], savingsCentavos: 999 }] }] }, 'b').length, 0);
  assert.equal(eligiblePromotionPreviews({ ...catalog, promotionPreviews: [{ ...offer, tiers: [{ quantity: 3, regularCentavos: 6000, priceCentavos: 0, savingsCentavos: 6000 }] }] }, 'b').length, 0);
});

test('promotion estimate uses only exact selected tiers and refuses ambiguous or stale prices', () => {
  const refill = { productId: 'p1', quantity: 3, product: { price: 20 } };
  const bottle = { productId: 'p2', quantity: 1, product: { price: 12 } };
  const selected = { ...offer, productId: 'p1' };
  assert.equal(estimatedPromotionSavings([refill, bottle], [selected], true), 500);
  assert.equal(estimatedPromotionSavings([refill], [selected], false), 0);
  assert.equal(estimatedPromotionSavings([refill], [selected]), 0);
  assert.equal(estimatedPromotionSavings([{ ...refill, quantity: 4 }, bottle], [selected], true), 0);
  assert.equal(estimatedPromotionSavings([refill], [], true), 0);
  assert.equal(estimatedPromotionSavings([refill], [selected, { ...selected, id: 'other' }], true), null);
  assert.equal(estimatedPromotionSavings([{ ...refill, product: { price: 21 } }], [selected], true), null);
  assert.equal(estimatedPromotionSavings([refill, refill], [selected], true), null);
  assert.equal(estimatedPromotionSavings([refill], [{ ...selected, tiers: null }], true), null);
});
test('once per login and promotion version without persisting across login identities', () => {
  const user = { uid: 'u', metadata: { lastSignInTime: 'first' } }; const key = promotionSessionKey(user, offer);
  assert.equal(wasPromotionSeen(key), false); markPromotionSeen(key); assert.equal(wasPromotionSeen(key), true);
  assert.equal(wasPromotionSeen(promotionSessionKey({ ...user, metadata: { lastSignInTime: 'second' } }, offer)), false);
  assert.equal(wasPromotionSeen(promotionSessionKey(user, { ...offer, version: 3 })), false);
  assert.equal(wasPromotionSeen(promotionSessionKey({ uid: 'u' }, offer)), true);
});
