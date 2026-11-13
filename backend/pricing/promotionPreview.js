const { calculateBundlePricing, cents } = require('./bundlePricing');
const { safeProduct } = require('../admin/productManagementHandler');

// The caller must supply only active catalog products and branches. This is
// used exclusively by the isolated test capability, never the public route.
function promotionPreviews(documents, catalog, now = new Date()) {
  const products = new Map((catalog.products || []).map((product) => [product.id, product]));
  const offers = [];
  for (const doc of documents) {
    const listed = products.get(doc.id);
    const data = doc.data() || {};
    const product = safeProduct(doc.id, data);
    const configured = data.bundlePromotion;
    if (!listed || !product.active || !product.product_name || product.price === null || configured == null || product.price !== listed.price || product.product_name !== listed.product_name || JSON.stringify(product.branchIds) !== JSON.stringify(listed.branchIds)) continue;
    try { cents(data.price); } catch { continue; }
    const promotions = Array.isArray(configured) ? configured : [configured];
    const quantities = [...new Set(promotions.flatMap((promotion) => Array.isArray(promotion?.tiers) ? promotion.tiers.map((tier) => tier.quantity) : []))];
    for (const branch of catalog.branches || []) {
      if (product.branchIds?.length && !product.branchIds.includes(branch.id)) continue;
      for (const container of ['Exchange', 'New Container']) {
        try {
          const tiers = quantities.map((quantity) => {
            const result = calculateBundlePricing({ branchId: branch.id, container, deliveryFee: 0, pricedAt: now, items: [{ productId: product.id, productNameSnapshot: product.product_name, quantity, unitPriceAtOrder: product.price, promotions }] });
            const line = result.items[0];
            if (!line.promotion) return null;
            return { quantity, regularCentavos: line.regularLineCentavos, priceCentavos: line.promotion.tierPriceCentavos, savingsCentavos: line.promotion.savingsCentavos, id: line.promotion.id, version: line.promotion.version };
          }).filter(Boolean);
          if (!tiers.length) continue;
          const chosen = promotions.find((promotion) => promotion?.id === tiers[0].id && promotion?.version === tiers[0].version);
          if (!chosen || tiers.some((tier) => tier.id !== chosen.id || tier.version !== chosen.version)) continue;
          offers.push({ id: chosen.id, version: chosen.version, title: chosen.title, productId: product.id, productName: product.product_name, branchId: branch.id, branchName: branch.name, container, endsAt: chosen.endsAt || null, tiers: tiers.map(({ id, version, ...tier }) => tier).sort((a, b) => a.quantity - b.quantity) });
        } catch { /* Invalid or conflicting configurations are never advertised. */ }
      }
    }
  }
  return offers;
}

module.exports = { promotionPreviews };
