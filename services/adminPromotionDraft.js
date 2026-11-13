function promotionStatus(saved, now = Date.now()) {
  if (saved?.active !== true) {
    if (!saved?.disabledAt) return 'Draft';
    return Number.isFinite(new Date(saved.disabledAt).getTime()) ? 'Disabled' : 'Unavailable';
  }
  const end = saved.endsAt ? new Date(saved.endsAt).getTime() : Infinity;
  const start = saved.startsAt ? new Date(saved.startsAt).getTime() : -Infinity;
  if (!Number.isFinite(end) && end !== Infinity || !Number.isFinite(start) && start !== -Infinity) return 'Unavailable';
  if (end <= now) return 'Expired';
  return start > now ? 'Scheduled' : 'Active';
}

// Sample savings scale with the unit price: 20%, 40%, and 120% of one
// unit for quantities 3, 5, and 10 respectively. They are suggestions only.
function samplePromotionTiers(unitCentavos, limit = 100) {
  if (!Number.isSafeInteger(unitCentavos) || unitCentavos <= 0) return [];
  return [[3, 0.2], [5, 0.4], [10, 1.2]].filter(([quantity]) => quantity <= limit).map(([quantity, factor]) => {
    const regular = unitCentavos * quantity;
    if (!Number.isSafeInteger(regular)) return null;
    const savings = Math.min(regular - 1, Math.max(1, Math.round(unitCentavos * factor)));
    return { quantity: String(quantity), price: ((regular - savings) / 100).toFixed(2) };
  }).filter(Boolean);
}

function promotionDraftFingerprint(promotion) {
  const startMode = promotion.startMode || (promotion.startsAt ? 'scheduled' : 'activation');
  const time = (value) => { if (!value) return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : String(value); };
  return JSON.stringify({
    title: String(promotion.title || '').trim(),
    commercialEligibility: promotion.commercialEligibility || '',
    branchIds: [...(promotion.branchIds || [])].sort(),
    containerChoices: [...(promotion.containerChoices || [])].sort(),
    tiers: [...(promotion.tiers || [])].map((tier) => ({ quantity: Number(tier.quantity), bundlePriceCentavos: Number(tier.bundlePriceCentavos) })).sort((a, b) => a.quantity - b.quantity),
    startMode,
    startsAt: startMode === 'activation' ? null : time(promotion.startsAt),
    endsAt: time(promotion.endsAt),
    disabled: Boolean(promotion.disabledAt),
  });
}

module.exports = { promotionStatus, samplePromotionTiers, promotionDraftFingerprint };
