const test = require('node:test');
const assert = require('node:assert/strict');
const { savedOrderPricing } = require('../../../services/savedOrderPricing');

test('saved snapshot supplies unchanged product, promotion and payable values', () => {
  const order = { totalAtOrder: 999, pricingSnapshot: { schemaVersion: 1, container: 'Exchange', regularSubtotalCentavos: 12000, promotionalSavingsCentavos: 500, deliveryFeeCentavos: 700, payableCentavos: 12200, items: [
    { productNameSnapshot: 'Refill', quantity: 3, originalUnitCentavos: 2000, regularLineCentavos: 6000, promotion: { id: 'promo', title: 'Bundle', tierQuantity: 3, savingsCentavos: 500 } },
    { productNameSnapshot: 'Bottle', quantity: 1, originalUnitCentavos: 6000, regularLineCentavos: 6000, promotion: null },
  ] } };
  const result = savedOrderPricing({ pricingDetailsSource: order });
  assert.deepEqual([result.subtotal, result.savings, result.fee, result.total], [120, 5, 7, 122]);
  assert.equal(result.items[0].unitPrice, 20); assert.equal(result.items[0].promotion.title, 'Bundle'); assert.equal(result.items[1].promotion, null);
});

test('legacy unavailable values remain unavailable and payable totals are never product subtotals', () => {
  const result = savedOrderPricing({ product_name: 'Water', quantity: 2, totalAtOrder: 99 });
  assert.equal(result.items[0].unitPrice, null); assert.equal(result.items[0].regularAmount, null); assert.equal(result.subtotal, null); assert.equal(result.fee, null); assert.equal(result.total, 99); assert.equal(result.savings, null);
  const regular = savedOrderPricing({ items: [{ productId: 'p', productNameSnapshot: 'Water', quantity: 1, unitPriceAtOrder: 20, totalAtOrder: 20 }], subtotalAtOrder: 20, deliveryFeeAtOrder: 7, totalAtOrder: 27 });
  assert.deepEqual([regular.subtotal, regular.fee, regular.total, regular.savings], [20, 7, 27, null]);
});
