const { normalizeRequesterOrderStatus } = require('../constants/requesterOrderStatus');

function canBuyAgain(order, isHistory) {
  return isHistory && normalizeRequesterOrderStatus(order?.status) === 'delivered';
}

function buildBuyAgainDraft(order, catalog, rankedBranches, productAvailable) {
  const oldItems = Array.isArray(order.items) && order.items.length
    ? order.items : [{ productId: order.productId || order.product_id, quantity: order.quantity }];
  const products = Array.isArray(catalog?.products) ? catalog.products : [];
  const currentItems = oldItems.map((item) => {
    const product = products.find((candidate) => candidate.id === String(item.productId || item.product_id || '') && candidate.active !== false);
    const quantity = Number(item.quantity);
    return product && Number.isInteger(quantity) && quantity > 0 && quantity <= 100 ? { productId: product.id, quantity, product } : null;
  }).filter(Boolean);
  const branch = rankedBranches.map((candidate) => ({
    ...candidate,
    availableItems: currentItems.filter((item) => productAvailable(item.product, candidate.id)),
  })).sort((a, b) => b.availableItems.length - a.availableItems.length || a.distanceKm - b.distanceKm)[0];
  if (!branch?.availableItems.length) return null;
  return {
    branchId: branch.id,
    items: branch.availableItems.map(({ productId, quantity }) => ({ productId, quantity })),
    unavailableCount: oldItems.length - branch.availableItems.length,
    currentSubtotal: branch.availableItems.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0),
  };
}

module.exports = { buildBuyAgainDraft, canBuyAgain };
