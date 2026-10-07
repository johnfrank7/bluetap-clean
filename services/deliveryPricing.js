const { DEFAULT_SERVICE_RADIUS_KM } = require('../constants/toledoBarangays.json');

const DEFAULT_BASE_DELIVERY_FEE = 0;
const DEFAULT_INCLUDED_RADIUS_KM = DEFAULT_SERVICE_RADIUS_KM || 5;
const DEFAULT_OUTSIDE_RADIUS_FEE_PER_KM = 10;

const cleanString = (value, max = 240) => String(value || '').trim().slice(0, max);

const safeFiniteNumber = (value, fallback = null) => {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

/**
 * Normalizes branch delivery pricing into a single canonical record.
 * Supports nested `deliveryPricing` objects as well as legacy top-level branch fields.
 */
function normalizeBranchDeliveryPricing(branchOrPricing = {}) {
  const data = branchOrPricing || {};
  const nested = data.deliveryPricing && typeof data.deliveryPricing === 'object'
    ? data.deliveryPricing
    : null;

  // Resolve service radius (km)
  const rawServiceRadius = nested?.serviceRadiusKm ?? data.serviceRadiusKm;
  const serviceRadiusKm = safeFiniteNumber(rawServiceRadius, DEFAULT_SERVICE_RADIUS_KM);
  const validatedServiceRadius = serviceRadiusKm > 0 && serviceRadiusKm <= 500 ? serviceRadiusKm : DEFAULT_SERVICE_RADIUS_KM;

  // Resolve base delivery fee (PHP)
  const rawBaseFee = nested?.baseDeliveryFee ?? data.baseDeliveryFee;
  const baseDeliveryFee = safeFiniteNumber(rawBaseFee, DEFAULT_BASE_DELIVERY_FEE);
  const validatedBaseFee = baseDeliveryFee >= 0 && baseDeliveryFee <= 10000 ? baseDeliveryFee : DEFAULT_BASE_DELIVERY_FEE;

  // Resolve included radius (km) - defaults to branch service radius if not explicitly configured
  const rawIncludedRadius = nested?.includedRadiusKm ?? data.includedRadiusKm;
  const includedRadiusKm = safeFiniteNumber(rawIncludedRadius, validatedServiceRadius);
  const validatedIncludedRadius = includedRadiusKm >= 0 && includedRadiusKm <= 500 ? includedRadiusKm : validatedServiceRadius;

  // Resolve outside-radius fee per km (PHP/km)
  const rawOutsideRate = nested?.outsideRadiusFeePerKm ?? data.outsideRadiusFeePerKm;
  const outsideRadiusFeePerKm = safeFiniteNumber(rawOutsideRate, DEFAULT_OUTSIDE_RADIUS_FEE_PER_KM);
  const validatedOutsideRate = outsideRadiusFeePerKm >= 0 && outsideRadiusFeePerKm <= 10000 ? outsideRadiusFeePerKm : DEFAULT_OUTSIDE_RADIUS_FEE_PER_KM;

  const updatedAt = nested?.updatedAt || data.updatedAt || null;
  const updatedBy = cleanString(nested?.updatedBy || data.updatedBy, 128);

  return {
    baseDeliveryFee: Math.round(validatedBaseFee * 100) / 100,
    includedRadiusKm: Math.round(validatedIncludedRadius * 10) / 10,
    outsideRadiusFeePerKm: Math.round(validatedOutsideRate * 100) / 100,
    serviceRadiusKm: Math.round(validatedServiceRadius * 10) / 10,
    updatedAt,
    updatedBy,
  };
}

/**
 * Authoritative distance-based delivery fee calculator.
 *
 * Inside / at included radius:
 *   fee = baseDeliveryFee
 *
 * Beyond included radius:
 *   fee = baseDeliveryFee + ((distanceKm - includedRadiusKm) * outsideRadiusFeePerKm)
 */
function calculateDeliveryFee(distanceKm, branchOrPricing = {}) {
  const pricing = normalizeBranchDeliveryPricing(branchOrPricing);
  const dist = safeFiniteNumber(distanceKm, 0);

  if (dist <= 0 || dist <= pricing.includedRadiusKm) {
    return Math.round(pricing.baseDeliveryFee * 100) / 100;
  }

  const excessKm = dist - pricing.includedRadiusKm;
  const extraFee = excessKm * pricing.outsideRadiusFeePerKm;
  return Math.round((pricing.baseDeliveryFee + extraFee) * 100) / 100;
}

/**
 * Order grand total calculator combining subtotal and delivery fee.
 */
function calculateOrderTotal(subtotal, deliveryFee) {
  const safeSubtotal = safeFiniteNumber(subtotal, 0);
  const safeFee = safeFiniteNumber(deliveryFee, 0);
  return Math.round((Math.max(0, safeSubtotal) + Math.max(0, safeFee)) * 100) / 100;
}

const DEFAULT_DELIVERY_PRICING = Object.freeze({
  baseDeliveryFee: DEFAULT_BASE_DELIVERY_FEE,
  includedRadiusKm: DEFAULT_INCLUDED_RADIUS_KM,
  outsideRadiusFeePerKm: DEFAULT_OUTSIDE_RADIUS_FEE_PER_KM,
  serviceRadiusKm: DEFAULT_SERVICE_RADIUS_KM || 5,
  updatedAt: null,
  updatedBy: '',
});

/**
 * Provides a clear breakdown of how the delivery fee was calculated.
 */
function getDeliveryFeeBreakdown(distanceKm, branchOrPricing = {}) {
  const pricing = normalizeBranchDeliveryPricing(branchOrPricing);
  const dist = safeFiniteNumber(distanceKm, 0);
  const baseFee = Math.round(pricing.baseDeliveryFee * 100) / 100;

  if (dist <= 0 || dist <= pricing.includedRadiusKm) {
    return {
      distanceKm: dist,
      baseFee,
      baseDeliveryFee: baseFee,
      excessKm: 0,
      excessDistanceKm: 0,
      outsideRate: pricing.outsideRadiusFeePerKm,
      outsideRadiusFeePerKm: pricing.outsideRadiusFeePerKm,
      extraFee: 0,
      excessFee: 0,
      totalFee: baseFee,
      isOutsideIncludedRadius: false,
      isWithinIncludedRadius: true,
      includedRadiusKm: pricing.includedRadiusKm,
      serviceRadiusKm: pricing.serviceRadiusKm,
    };
  }

  const excessKm = Math.round((dist - pricing.includedRadiusKm) * 10) / 10;
  const extraFee = Math.round(excessKm * pricing.outsideRadiusFeePerKm * 100) / 100;
  const totalFee = Math.round((baseFee + extraFee) * 100) / 100;

  return {
    distanceKm: dist,
    baseFee,
    baseDeliveryFee: baseFee,
    excessKm,
    excessDistanceKm: excessKm,
    outsideRate: pricing.outsideRadiusFeePerKm,
    outsideRadiusFeePerKm: pricing.outsideRadiusFeePerKm,
    extraFee,
    excessFee: extraFee,
    totalFee,
    isOutsideIncludedRadius: true,
    isWithinIncludedRadius: false,
    includedRadiusKm: pricing.includedRadiusKm,
    serviceRadiusKm: pricing.serviceRadiusKm,
  };
}

/**
 * Validates delivery pricing input fields submitted by Admin or Manager.
 */
function validateDeliveryPricingInput(input = {}, existing = {}) {
  const baseDeliveryFee = safeFiniteNumber(input.baseDeliveryFee);
  const includedRadiusKm = safeFiniteNumber(input.includedRadiusKm);
  const outsideRadiusFeePerKm = safeFiniteNumber(input.outsideRadiusFeePerKm);
  const rawServiceRadius = input.serviceRadiusKm ?? existing.serviceRadiusKm;
  const serviceRadiusKm = safeFiniteNumber(rawServiceRadius, includedRadiusKm != null ? includedRadiusKm : DEFAULT_SERVICE_RADIUS_KM);

  if (baseDeliveryFee === null || baseDeliveryFee < 0 || baseDeliveryFee > 10000) {
    throw new Error('Base delivery fee must be between ₱0 and ₱10,000.');
  }
  if (includedRadiusKm === null || includedRadiusKm < 0 || includedRadiusKm > 500) {
    throw new Error('Included radius must be between 0 and 500 km.');
  }
  if (outsideRadiusFeePerKm === null || outsideRadiusFeePerKm < 0 || outsideRadiusFeePerKm > 10000) {
    throw new Error('Outside-radius fee must be between ₱0 and ₱10,000 / km.');
  }
  if (serviceRadiusKm === null || serviceRadiusKm <= 0 || serviceRadiusKm > 500) {
    throw new Error('Service radius must be between 0 and 500 km.');
  }

  return {
    baseDeliveryFee: Math.round(baseDeliveryFee * 100) / 100,
    includedRadiusKm: Math.round(includedRadiusKm * 10) / 10,
    outsideRadiusFeePerKm: Math.round(outsideRadiusFeePerKm * 100) / 100,
    serviceRadiusKm: Math.round(serviceRadiusKm * 10) / 10,
  };
}

module.exports = {
  DEFAULT_BASE_DELIVERY_FEE,
  DEFAULT_INCLUDED_RADIUS_KM,
  DEFAULT_OUTSIDE_RADIUS_FEE_PER_KM,
  DEFAULT_DELIVERY_PRICING,
  normalizeBranchDeliveryPricing,
  calculateDeliveryFee,
  calculateOrderTotal,
  getDeliveryFeeBreakdown,
  validateDeliveryPricingInput,
};
