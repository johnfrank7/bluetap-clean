const sessionSeen = new Set();

function eligiblePromotionPreviews(catalog, branchId, container, now = Date.now()) {
  if ((catalog?.promotionPreviewOnly !== true && catalog?.promotionCheckoutEnabled !== true) || !branchId || !Array.isArray(catalog.promotionPreviews)) return [];
  return catalog.promotionPreviews.filter((offer) => {
    const expires = offer?.endsAt == null ? Infinity : new Date(offer.endsAt).getTime();
    return offer?.branchId === branchId && (!container || offer.container === container) && typeof offer.id === 'string' && Number.isSafeInteger(offer.version) && offer.version > 0 && (expires === Infinity || Number.isFinite(expires)) && expires > now && Array.isArray(offer.tiers) && offer.tiers.length > 0 && offer.tiers.every((tier) => Number.isSafeInteger(tier.quantity) && tier.quantity > 0 && [tier.regularCentavos, tier.priceCentavos, tier.savingsCentavos].every(Number.isSafeInteger) && tier.priceCentavos > 0 && tier.savingsCentavos > 0 && tier.regularCentavos === tier.priceCentavos + tier.savingsCentavos);
  });
}

// Display estimate only. The server quote and transaction remain authoritative.
function estimatedPromotionSavings(items, offers, checkoutEnabled = false) {
  if (checkoutEnabled !== true) return 0;
  if (!Array.isArray(items) || !Array.isArray(offers)) return null;
  let savings = 0;
  const seen = new Set();
  for (const item of items) {
    const price = item?.product?.price;
    const unit = Math.round(price * 100);
    if (!item?.productId || seen.has(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100 ||
        typeof price !== 'number' || !Number.isFinite(price) || price < 0 || !Number.isSafeInteger(unit) ||
        Math.abs(price * 100 - unit) > 0.000001 || !Number.isSafeInteger(unit * item.quantity)) return null;
    seen.add(item.productId);
    const applicable = offers.filter((offer) => offer?.productId === item.productId);
    if (applicable.length > 1) return null;
    if (!applicable.length) continue;
    if (!Array.isArray(applicable[0].tiers)) return null;
    const tiers = applicable[0].tiers.filter((tier) => tier?.quantity === item.quantity);
    if (tiers.length > 1) return null;
    if (!tiers.length) continue;
    const tier = tiers[0];
    if (tier.regularCentavos !== unit * item.quantity || !Number.isSafeInteger(tier.priceCentavos) ||
        tier.priceCentavos <= 0 || !Number.isSafeInteger(tier.savingsCentavos) || tier.savingsCentavos <= 0 ||
        tier.priceCentavos + tier.savingsCentavos !== tier.regularCentavos) return null;
    savings += tier.savingsCentavos;
    if (!Number.isSafeInteger(savings)) return null;
  }
  return savings;
}

// Session storage is tab-scoped; native keeps the same key only for this app
// process. A new Firebase login gets a new last-sign-in timestamp.
function promotionSessionKey(user, offer) {
  const uid = user?.uid; const signedIn = user?.metadata?.lastSignInTime;
  return uid && signedIn && offer?.id && offer?.version ? `bluetap:promo:${uid}:${signedIn}:${offer.id}:${offer.version}` : '';
}
function wasPromotionSeen(key) {
  if (!key) return true;
  try { return sessionSeen.has(key) || globalThis.sessionStorage?.getItem(key) === '1'; } catch { return sessionSeen.has(key); }
}
function markPromotionSeen(key) {
  if (!key) return;
  sessionSeen.add(key);
  try { globalThis.sessionStorage?.setItem(key, '1'); } catch { /* The in-memory marker remains available. */ }
}

module.exports = { eligiblePromotionPreviews, estimatedPromotionSavings, promotionSessionKey, wasPromotionSeen, markPromotionSeen };
