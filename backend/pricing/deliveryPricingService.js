const { OtpError } = require('../utils/otpError');
const {
  DEFAULT_BASE_DELIVERY_FEE,
  DEFAULT_INCLUDED_RADIUS_KM,
  DEFAULT_OUTSIDE_RADIUS_FEE_PER_KM,
  DEFAULT_DELIVERY_PRICING,
  normalizeBranchDeliveryPricing,
  calculateDeliveryFee,
  calculateOrderTotal,
  getDeliveryFeeBreakdown,
  validateDeliveryPricingInput,
} = require('../../services/deliveryPricing');

const cleanString = (value, max = 160) => String(value || '').trim().slice(0, max);

/**
 * Atomically updates branch delivery pricing within a Firestore transaction,
 * persisting both canonical `deliveryPricing` and backward-compatible root fields,
 * and writing a structured audit log entry to `adminAuditLogs`.
 */
async function updateBranchDeliveryPricingInTransaction({
  db,
  tx,
  branchRef,
  branchId,
  pricingInput,
  actor,
  now = new Date(),
}) {
  if (!db || !tx || !branchRef || !branchId) {
    throw new OtpError(500, 'PRICING_TRANSACTION_FAILED', 'Invalid transaction parameters for branch pricing.');
  }

  const validated = validateDeliveryPricingInput(pricingInput);

  const snapshot = await tx.get(branchRef);
  if (!snapshot.exists) {
    throw new OtpError(404, 'BRANCH_NOT_FOUND', 'The branch does not exist.');
  }

  const currentData = snapshot.data() || {};
  const before = normalizeBranchDeliveryPricing(currentData);

  const canonicalPricing = {
    baseDeliveryFee: validated.baseDeliveryFee,
    includedRadiusKm: validated.includedRadiusKm,
    outsideRadiusFeePerKm: validated.outsideRadiusFeePerKm,
    serviceRadiusKm: validated.serviceRadiusKm,
    updatedAt: now,
    updatedBy: actor?.uid || '',
  };

  tx.update(branchRef, {
    deliveryPricing: canonicalPricing,
    baseDeliveryFee: validated.baseDeliveryFee,
    includedRadiusKm: validated.includedRadiusKm,
    outsideRadiusFeePerKm: validated.outsideRadiusFeePerKm,
    serviceRadiusKm: validated.serviceRadiusKm,
    updatedAt: now,
    updatedBy: actor?.uid || '',
  });

  const actorRole = actor?.role === 'admin' ? 'admin' : 'manager';
  const auditAction = actorRole === 'admin'
    ? 'ADMIN_BRANCH_DELIVERY_PRICING_UPDATED'
    : 'MANAGER_BRANCH_DELIVERY_PRICING_UPDATED';

  const actorPublicUid = cleanString(actor?.publicUid || actor?.displayUid || actor?.uniqueId || actor?.uid, 80);

  tx.set(db.collection('adminAuditLogs').doc(), {
    action: auditAction,
    actorUid: actor?.uid || '',
    actorPublicUid,
    actorRole,
    branchId,
    before,
    after: canonicalPricing,
    createdAt: now,
  });

  return canonicalPricing;
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
  updateBranchDeliveryPricingInTransaction,
};
