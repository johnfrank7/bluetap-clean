const { randomUUID } = require('node:crypto');
const { OtpError } = require('../utils/otpError');
const { cents } = require('./bundlePricing');

const fail = (message) => { throw new OtpError(400, 'INVALID_BUNDLE_PROMOTION', message); };
const timestamp = (value) => {
  if (value == null || value === '') return null;
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) fail('Use a timestamp with an explicit timezone.');
  const [, year, month, day, hour, minute, second = '0'] = match;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) fail('Enter a valid promotion schedule.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail('Enter a valid promotion schedule.');
  return date.toISOString();
};

// One configuration per product removes overlapping promotion ambiguity.
function validateBundlePromotion(input, { productId, productPrice, allowedBranches = [], previous = null, actorUid, now = new Date(), allowActivation = false }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Provide a promotion configuration.');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== (previous?.version || 0)) throw new OtpError(409, 'BUNDLE_PROMOTION_STALE', 'This promotion changed. Refresh before saving.');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 120) fail('Enter a promotion title of at most 120 characters.');
  if (input.commercialEligibility !== 'refill_verified') fail('Verify that this product is an eligible refill.');
  if (typeof input.active !== 'boolean') fail('Choose an enabled or disabled status.');
  if (input.active && !allowActivation) throw new OtpError(409, 'BUNDLE_PROMOTIONS_UNAVAILABLE', 'Promotion activation is unavailable.');
  const branchIds = input.branchIds;
  if (!Array.isArray(branchIds) || !branchIds.length || branchIds.length > 100 || branchIds.some((id) => typeof id !== 'string' || !id || id.length > 80 || id.includes('/')) || new Set(branchIds).size !== branchIds.length) fail('Select distinct eligible branches.');
  if (allowedBranches.length && branchIds.some((id) => !allowedBranches.includes(id))) fail('Promotion branches must offer this product.');
  const containerChoices = input.containerChoices;
  if (!Array.isArray(containerChoices) || !containerChoices.length || containerChoices.some((value) => !['Exchange', 'New Container'].includes(value)) || new Set(containerChoices).size !== containerChoices.length) fail('Select eligible container choices.');
  if (!Array.isArray(input.tiers) || !input.tiers.length || input.tiers.length > 100) fail('Add at least one quantity tier.');
  const unit = cents(productPrice);
  const quantities = new Set();
  const tiers = input.tiers.map((tier) => {
    if (!Number.isSafeInteger(tier?.quantity) || tier.quantity < 1 || tier.quantity > 100 || quantities.has(tier.quantity)) fail('Tier quantities must be distinct whole numbers from 1 to 100.');
    quantities.add(tier.quantity);
    if (!Number.isSafeInteger(unit * tier.quantity) || !Number.isSafeInteger(tier.bundlePriceCentavos) || tier.bundlePriceCentavos <= 0 || tier.bundlePriceCentavos >= unit * tier.quantity) fail('Every bundle price must be positive and save money against the current product price.');
    return { quantity: tier.quantity, bundlePriceCentavos: tier.bundlePriceCentavos };
  }).sort((a, b) => a.quantity - b.quantity);
  const startsAt = timestamp(input.startsAt);
  const endsAt = timestamp(input.endsAt);
  const startMode = input.startMode == null ? (startsAt ? 'scheduled' : 'activation') : input.startMode;
  if (!['activation', 'scheduled'].includes(startMode) || (startMode === 'scheduled' && !startsAt) || (startMode === 'activation' && !input.active && startsAt)) fail('Choose a valid promotion start setting.');
  if (startsAt && endsAt && startsAt >= endsAt) fail('The end must be later than the start.');
  return { id: previous?.id || randomUUID(), version: (previous?.version || 0) + 1, title, productId, commercialEligibility: 'refill_verified', branchIds: [...branchIds], containerChoices: [...containerChoices], tiers, startMode, startsAt, endsAt, active: input.active, createdAt: previous?.createdAt || now, createdBy: previous?.createdBy || actorUid, updatedAt: now, updatedBy: actorUid };
}

module.exports = { validateBundlePromotion };
