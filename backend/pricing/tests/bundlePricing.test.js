const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateBundlePricing } = require('../bundlePricing');

const promotion = { id: 'p1', version: 1, title: 'Bundle', productId: 'refill', commercialEligibility: 'refill_verified', active: true, branchIds: ['central'], containerChoices: ['Exchange'], startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z', tiers: [{ quantity: 3, bundlePriceCentavos: 5500 }, { quantity: 5, bundlePriceCentavos: 9000 }, { quantity: 10, bundlePriceCentavos: 18000 }] };
const price = (quantity, overrides = {}) => calculateBundlePricing({ branchId: 'central', container: 'Exchange', deliveryFee: 12.5, pricedAt: new Date('2026-06-01T00:00:00Z'), items: [{ productId: 'refill', productNameSnapshot: 'Refill', unitPriceAtOrder: 20, quantity, promotions: [promotion] }], ...overrides });

test('exact tiers use integer centavos and leave the delivery fee untouched', () => {
  for (const [quantity, savings] of [[1, 0], [2, 0], [3, 500], [4, 0], [5, 1000], [6, 0], [7, 0], [10, 2000], [11, 0]]) {
    const result = price(quantity);
    assert.equal(result.regularSubtotalCentavos, quantity * 2000);
    assert.equal(result.promotionalSavingsCentavos, savings);
    assert.equal(result.payableCentavos, quantity * 2000 - savings + 1250);
  }
});

test('scope, status and inclusive-start exclusive-end schedules control eligibility', () => {
  assert.equal(price(3, { branchId: 'other' }).promotionalSavingsCentavos, 0);
  assert.equal(price(3, { container: 'New Container' }).promotionalSavingsCentavos, 0);
  assert.equal(price(3, { pricedAt: new Date('2025-12-31T23:59:59Z') }).promotionalSavingsCentavos, 0);
  assert.equal(price(3, { pricedAt: new Date('2026-01-01T00:00:00Z') }).promotionalSavingsCentavos, 500);
  assert.equal(price(3, { pricedAt: new Date('2027-01-01T00:00:00Z') }).promotionalSavingsCentavos, 0);
  const item = { productId: 'refill', unitPriceAtOrder: 20, quantity: 3, promotions: [{ ...promotion, active: false }] };
  assert.equal(price(3, { items: [item] }).promotionalSavingsCentavos, 0);
});

test('ambiguous promotions, duplicate lines and invalid prices fail closed', () => {
  const item = { productId: 'refill', unitPriceAtOrder: 20, quantity: 3, promotions: [promotion, { ...promotion, id: 'p2' }] };
  assert.throws(() => price(3, { items: [item] }), { reason: 'PROMOTION_CONFLICT' });
  const regularItem = { ...item, promotions: [] };
  assert.throws(() => price(3, { items: [regularItem, regularItem] }), { reason: 'INVALID_PRICING' });
  assert.throws(() => price(3, { deliveryFee: -1 }));
  assert.throws(() => price(3, { items: [{ ...item, promotions: [], unitPriceAtOrder: 1.001 }] }));
  assert.throws(() => price(3, { items: [{ ...item, promotions: [{ ...promotion, tiers: [{ quantity: 3, bundlePriceCentavos: 6000 }] }] }] }));
  assert.throws(() => price(3, { items: [{ ...item, promotions: [{ ...promotion, tiers: [{ quantity: 3, bundlePriceCentavos: 0 }] }] }] }), { reason: 'INVALID_PRICING' });
});
