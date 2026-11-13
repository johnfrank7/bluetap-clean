// Display-only projection. Never calculate a payable amount or consult a catalog.
const amount = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const centavos = (value) => Number.isSafeInteger(value) && value >= 0 ? value / 100 : null;

function savedOrderPricing(input = {}) {
  const order = input?.pricingDetailsSource || input || {};
  const snapshot = order.pricingSnapshot?.schemaVersion === 1 ? order.pricingSnapshot : null;
  const savedItems = Array.isArray(order.items) ? order.items : [];
  const items = snapshot && Array.isArray(snapshot.items) ? snapshot.items.map((item, index) => ({
    name: item.productNameSnapshot || savedItems[index]?.productNameSnapshot || 'Product',
    quantity: item.quantity ?? null,
    container: item.containerTypeSnapshot || '',
    unitPrice: centavos(item.originalUnitCentavos),
    regularAmount: centavos(item.regularLineCentavos),
    promotion: item.promotion?.id ? { title: item.promotion.title || 'Bundle promotion', quantity: item.promotion.tierQuantity, savings: centavos(item.promotion.savingsCentavos) } : null,
  })) : (savedItems.length ? savedItems : (order.productNameSnapshot || order.product_name || order.productName ? [order] : [])).map((item) => ({
    name: item.productNameSnapshot || item.product_name || item.productName || item.name || 'Product',
    quantity: item.quantity ?? item.qty ?? null,
    container: item.containerTypeSnapshot || item.containerType || '',
    unitPrice: amount(item === order ? (item.unitPriceAtOrder ?? item.product_price) : (item.unitPriceAtOrder ?? item.unitPrice ?? item.product_price ?? item.price)),
    regularAmount: amount(item === order ? (order.subtotalAtOrder ?? order.subtotal) : (item.regularLineAmount ?? item.line_total ?? item.subtotal ?? item.totalAtOrder)),
    promotion: null,
  }));
  const promotions = items.filter((item) => item.promotion);
  return {
    items,
    container: snapshot?.container || order.container || order.containerType || '',
    subtotal: snapshot ? centavos(snapshot.regularSubtotalCentavos) : amount(order.subtotalAtOrder ?? order.subtotal),
    savings: promotions.length ? centavos(snapshot.promotionalSavingsCentavos) : null,
    discount: !snapshot && amount(order.discountAmount ?? order.discount) > 0 ? amount(order.discountAmount ?? order.discount) : null,
    fee: snapshot ? centavos(snapshot.deliveryFeeCentavos) : amount(order.deliveryFeeAtOrder ?? order.deliveryFee ?? order.delivery_fee),
    total: snapshot ? centavos(snapshot.payableCentavos) : amount(order.totalAtOrder ?? order.total_cost ?? order.grandTotalAmount ?? order.totalAmount ?? order.total),
  };
}

module.exports = { savedOrderPricing };
