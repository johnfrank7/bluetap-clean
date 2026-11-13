// Price-affecting changes must be distinguished from notes-only edits without
// using names, order totals, or client-provided prices as identity.
const { OtpError } = require('../utils/otpError');
const { calculateBundlePricing, cents } = require('./bundlePricing');
const { isDeepStrictEqual } = require('node:util');
const normalizeItems = (items) => {
  if (!Array.isArray(items) || !items.length) return null;
  const values = items.map((item) => ({
    productId: typeof (item?.productId || item?.product_id) === 'string' ? (item.productId || item.product_id).trim() : '',
    quantity: Number(item?.quantity),
  }));
  if (values.some((item) => !item.productId || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100)) return null;
  if (new Set(values.map((item) => item.productId)).size !== values.length) return null;
  return values.sort((a, b) => a.productId.localeCompare(b.productId));
};

function isMaterialEdit(order, proposedItems, proposedContainer) {
  const before = normalizeItems(order?.items);
  const after = normalizeItems(proposedItems);
  if (!before || !after) return true;
  const container = typeof proposedContainer === 'string' ? proposedContainer.trim() : String(order?.container || '').trim();
  return container !== String(order?.container || '').trim() || JSON.stringify(before) !== JSON.stringify(after);
}

function savedPricingSnapshot(order = {}) {
  return {
    pricingSnapshot: order.pricingSnapshot ?? null,
    items: Array.isArray(order.items) ? order.items : [],
    subtotalAtOrder: order.subtotalAtOrder ?? order.subtotal ?? null,
    discountAmount: order.discountAmount ?? order.discount ?? null,
    deliveryFeeAtOrder: order.deliveryFeeAtOrder ?? order.deliveryFee ?? null,
    totalAtOrder: order.totalAtOrder ?? order.total_cost ?? null,
  };
}

function validateLegacyEditPricing(order) {
  const fail = () => { throw new OtpError(409, 'EDIT_PRICING_UNAVAILABLE', 'Saved order pricing requires branch review before changing this order.'); };
  try {
    if (!Array.isArray(order.items) || !order.items.length) fail();
    let subtotal = 0;
    for (const item of order.items) {
      if (!item.productId || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100 || cents(item.totalAtOrder) !== cents(item.unitPriceAtOrder) * item.quantity) fail();
      subtotal += cents(item.totalAtOrder);
    }
    if (!Number.isSafeInteger(subtotal) || cents(order.subtotalAtOrder ?? order.subtotal) !== subtotal || cents(order.totalAtOrder ?? order.total_cost) !== subtotal + cents(order.deliveryFeeAtOrder ?? order.deliveryFee)) fail();
  } catch (error) { if (error?.reason === 'EDIT_PRICING_UNAVAILABLE') throw error; fail(); }
}

function validateSavedPromotion(order, branchId) {
  const fail = () => { throw new OtpError(409, 'EDIT_PRICING_UNAVAILABLE', 'Saved order pricing requires branch review before changing this order.'); };
  try {
    const s = order.pricingSnapshot;
    if (!s || s.schemaVersion !== 1 || s.currency !== 'PHP' || s.commercialBranchId !== branchId || s.container !== order.container || !Array.isArray(s.items) || !Array.isArray(order.items) || s.items.length !== order.items.length || !s.items.length) fail();
    const when = typeof s.pricedAt?.toDate === 'function' ? s.pricedAt.toDate() : new Date(s.pricedAt);
    if (s.pricedAt == null || !Number.isFinite(when.getTime()) || new Set(s.items.map((item) => item.productId)).size !== s.items.length) fail();
    let regular = 0; let savings = 0;
    for (let i = 0; i < s.items.length; i += 1) {
      const line = s.items[i]; const item = order.items[i]; const promo = line.promotion;
      if (!line.productId || line.productId !== item.productId || line.quantity !== item.quantity || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 100 || !Number.isSafeInteger(line.originalUnitCentavos) || line.originalUnitCentavos < 0 || cents(item.unitPriceAtOrder) !== line.originalUnitCentavos || line.regularLineCentavos !== line.originalUnitCentavos * line.quantity) fail();
      let discount = 0;
      if (promo) {
        if (!promo.id || !Number.isSafeInteger(promo.version) || promo.version < 1 || promo.tierQuantity !== line.quantity || !Number.isSafeInteger(promo.tierPriceCentavos) || promo.tierPriceCentavos < 0 || !Number.isSafeInteger(promo.savingsCentavos) || promo.savingsCentavos <= 0 || promo.tierPriceCentavos + promo.savingsCentavos !== line.regularLineCentavos) fail();
        discount = promo.savingsCentavos;
      }
      if (cents(item.totalAtOrder) !== line.regularLineCentavos - discount) fail();
      regular += line.regularLineCentavos; savings += discount;
    }
    if (!Number.isSafeInteger(regular) || !Number.isSafeInteger(savings) || s.regularSubtotalCentavos !== regular || s.promotionalSavingsCentavos !== savings || cents(order.subtotalAtOrder) !== regular || cents(order.discountAmount) !== savings || cents(order.deliveryFeeAtOrder) !== s.deliveryFeeCentavos || cents(order.totalAtOrder) !== s.payableCentavos || s.payableCentavos !== regular - savings + s.deliveryFeeCentavos || (order.total_cost != null && cents(order.total_cost) !== s.payableCentavos) || (order.subtotal != null && cents(order.subtotal) !== regular) || (order.discount != null && cents(order.discount) !== savings)) fail();
    return s;
  } catch (error) { if (error?.reason === 'EDIT_PRICING_UNAVAILABLE') throw error; fail(); }
}

function pricePromotionalEdit(items, productSnapshots, branchId, container, fee, { promotionPricing = true } = {}) {
  const products = new Map(productSnapshots.map((snapshot) => [snapshot.id, snapshot.data()]));
  const pricingSnapshot = calculateBundlePricing({ branchId, container, deliveryFee: fee, items: items.map((item) => {
    const product = products.get(item.productId);
    if (!product || cents(product.price) !== cents(item.unitPriceAtOrder)) throw new OtpError(409, 'EDIT_QUOTE_STALE', 'Product pricing changed. Request a new quote.');
    const promotion = product.bundlePromotion;
    return { ...item, promotions: !promotionPricing || promotion == null ? [] : (Array.isArray(promotion) ? promotion : [promotion]) };
  }) });
  const updatedItems = items.map((item, i) => ({ ...item, totalAtOrder: (pricingSnapshot.items[i].regularLineCentavos - (pricingSnapshot.items[i].promotion?.savingsCentavos || 0)) / 100 }));
  return { items: updatedItems, pricingSnapshot, subtotalAtOrder: pricingSnapshot.regularSubtotalCentavos / 100, discountAmount: pricingSnapshot.promotionalSavingsCentavos / 100, totalAtOrder: pricingSnapshot.payableCentavos / 100, total_cost: pricingSnapshot.payableCentavos / 100 };
}

function assertPromotionalQuote(quote, snapshots, branchId, container, fee, options) {
  const recomputed = pricePromotionalEdit(quote.items, snapshots, branchId, container, fee, options);
  const clean = (snapshot) => { const { pricedAt, ...values } = snapshot; return values; };
  if (!isDeepStrictEqual(clean(recomputed.pricingSnapshot), clean(quote.pricingSnapshot)) || quote.subtotalAtOrder !== recomputed.subtotalAtOrder || quote.discountAmount !== recomputed.discountAmount || quote.totalAtOrder !== recomputed.totalAtOrder || (quote.total_cost != null && quote.total_cost !== recomputed.total_cost) || quote.items.some((item, index) => item.totalAtOrder !== recomputed.items[index].totalAtOrder)) throw new OtpError(409, 'EDIT_QUOTE_STALE', 'Promotional pricing changed. Request a new quote.');
}

module.exports = { isMaterialEdit, savedPricingSnapshot, validateLegacyEditPricing, validateSavedPromotion, pricePromotionalEdit, assertPromotionalQuote };
