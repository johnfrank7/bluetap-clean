const { OtpError } = require('../utils/otpError');

const invalid = (message) => { throw new OtpError(409, 'INVALID_PRICING', message); };
const cents = (amount) => {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) invalid('A pricing amount is invalid.');
  const result = Math.round(amount * 100);
  if (!Number.isSafeInteger(result) || Math.abs(amount * 100 - result) > 0.000001) invalid('A pricing amount must be expressed in centavos.');
  return result;
};
const safeSum = (left, right) => {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) invalid('The order amount is invalid.');
  return value;
};
const dateMillis = (value) => {
  if (value == null) return null;
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  const millis = date.getTime();
  if (!Number.isFinite(millis)) invalid('A promotion schedule is invalid.');
  return millis;
};

/** Pure pricing calculation. All inputs must be read from trusted records. */
function calculateBundlePricing({ items, branchId, container, deliveryFee, pricedAt = new Date() }) {
  if (!Array.isArray(items) || !items.length || !branchId) invalid('Order pricing inputs are incomplete.');
  const now = dateMillis(pricedAt);
  const seen = new Set();
  let regularSubtotalCentavos = 0;
  let promotionalSavingsCentavos = 0;
  const pricedItems = items.map((item) => {
    if (!item.productId || seen.has(item.productId)) invalid('Each product may appear only once in an order.');
    seen.add(item.productId);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) invalid('The order quantity is invalid.');
    const unitCentavos = cents(item.unitPriceAtOrder);
    const regularLineCentavos = unitCentavos * item.quantity;
    if (!Number.isSafeInteger(regularLineCentavos)) invalid('The product amount is invalid.');
    const applicable = (item.promotions || []).filter((promo) => {
      if (!promo || promo.active !== true) return false;
      if (promo.productId !== item.productId || !Array.isArray(promo.branchIds) || !promo.branchIds.length || !Array.isArray(promo.containerChoices) || !promo.containerChoices.length) invalid('A promotion scope is invalid.');
      if (promo.commercialEligibility !== 'refill_verified' || !promo.branchIds.includes(branchId) || !promo.containerChoices.includes(container)) return false;
      const start = dateMillis(promo.startsAt);
      const end = dateMillis(promo.endsAt);
      if (start !== null && end !== null && start >= end) invalid('A promotion schedule is invalid.');
      return (start === null || start <= now) && (end === null || now < end);
    });
    if (applicable.length > 1) throw new OtpError(409, 'PROMOTION_CONFLICT', 'Promotional pricing is temporarily unavailable.');
    let promotion = null;
    if (applicable.length) {
      const promo = applicable[0];
      if (!promo.id || typeof promo.title !== 'string' || !promo.title.trim() || !Number.isSafeInteger(promo.version) || promo.version < 1 || !Array.isArray(promo.tiers) || !promo.tiers.length || promo.tiers.length > 100) invalid('A promotion configuration is invalid.');
      const quantities = new Set();
      for (const tier of promo.tiers) {
        if (!Number.isSafeInteger(tier?.quantity) || tier.quantity < 1 || tier.quantity > 100 || quantities.has(tier.quantity) || !Number.isSafeInteger(tier.bundlePriceCentavos) || tier.bundlePriceCentavos <= 0 || tier.bundlePriceCentavos >= unitCentavos * tier.quantity) invalid('A promotion tier is invalid.');
        quantities.add(tier.quantity);
      }
      const tiers = promo.tiers.filter((tier) => tier.quantity === item.quantity);
      if (tiers.length > 1) invalid('A promotion has duplicate tiers.');
      if (tiers.length) {
        const tier = tiers[0];
        if (!Number.isSafeInteger(tier.bundlePriceCentavos) || tier.bundlePriceCentavos <= 0 || tier.bundlePriceCentavos >= regularLineCentavos) invalid('A promotion price is invalid.');
        promotion = { id: promo.id, version: promo.version, title: promo.title, tierQuantity: tier.quantity, tierPriceCentavos: tier.bundlePriceCentavos, savingsCentavos: regularLineCentavos - tier.bundlePriceCentavos };
      }
    }
    regularSubtotalCentavos = safeSum(regularSubtotalCentavos, regularLineCentavos);
    promotionalSavingsCentavos = safeSum(promotionalSavingsCentavos, promotion?.savingsCentavos || 0);
    return { productId: item.productId, productNameSnapshot: item.productNameSnapshot, containerTypeSnapshot: item.containerTypeSnapshot || '', quantity: item.quantity, originalUnitCentavos: unitCentavos, regularLineCentavos, promotion };
  });
  const deliveryFeeCentavos = cents(deliveryFee);
  return { schemaVersion: 1, currency: 'PHP', pricedAt, commercialBranchId: branchId, container, items: pricedItems, regularSubtotalCentavos, promotionalSavingsCentavos, deliveryFeeCentavos, payableCentavos: safeSum(regularSubtotalCentavos - promotionalSavingsCentavos, deliveryFeeCentavos) };
}

module.exports = { calculateBundlePricing, cents };
