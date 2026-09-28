const { WEEKDAYS, productDeliveryDays, productLimit, scheduledWeekday } = require('../../services/productOrderPolicy');

function branchOverrideFor(branch = {}, productId) {
  const overrides = branch.productPolicyOverrides;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return null;
  const override = overrides[String(productId || '')];
  return override && typeof override === 'object' && !Array.isArray(override) ? override : null;
}

function resolveEffectiveProductPolicy(product = {}, branch = {}) {
  const override = branchOverrideFor(branch, product.id);
  const hasDaysOverride = !!override && Object.prototype.hasOwnProperty.call(override, 'deliveryDays');
  const hasLimitOverride = !!override && Object.prototype.hasOwnProperty.call(override, 'maxQuantityPerRequester');
  const overrideDays = productDeliveryDays(override?.deliveryDays);
  const validDaysOverride = hasDaysOverride && Array.isArray(override.deliveryDays) && overrideDays.length === override.deliveryDays.length;
  const overrideLimit = productLimit(override?.maxQuantityPerRequester);
  const validLimitOverride = hasLimitOverride && (
    override.maxQuantityPerRequester === null
    || override.maxQuantityPerRequester === ''
    || overrideLimit !== null
  );
  const configuredDays = validDaysOverride ? overrideDays : productDeliveryDays(product.deliveryDays);
  return {
    deliveryDays: configuredDays.length ? configuredDays : [...WEEKDAYS],
    configuredDeliveryDays: configuredDays,
    maxQuantityPerRequester: validLimitOverride
      ? overrideLimit
      : productLimit(product.maxQuantityPerRequester),
    source: validDaysOverride || validLimitOverride ? 'branch_override' : 'admin_default',
  };
}

function requestedDateNeedsApproval(value, deliveryDays) {
  if (!value) return false;
  const weekday = scheduledWeekday(value);
  return !!weekday && !productDeliveryDays(deliveryDays).includes(weekday);
}

module.exports = { branchOverrideFor, requestedDateNeedsApproval, resolveEffectiveProductPolicy };
