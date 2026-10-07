const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_DELIVERY_PRICING,
  normalizeBranchDeliveryPricing,
  validateDeliveryPricingInput,
  calculateDeliveryFee,
  calculateOrderTotal,
  getDeliveryFeeBreakdown,
} = require('../../../services/deliveryPricing');

const {
  updateBranchDeliveryPricingInTransaction,
} = require('../deliveryPricingService');

test('normalizeBranchDeliveryPricing provides safe defaults when input is empty or null', () => {
  const normalizedNull = normalizeBranchDeliveryPricing(null);
  assert.deepEqual(normalizedNull, DEFAULT_DELIVERY_PRICING);

  const normalizedEmpty = normalizeBranchDeliveryPricing({});
  assert.deepEqual(normalizedEmpty, DEFAULT_DELIVERY_PRICING);

  const normalizedBroken = normalizeBranchDeliveryPricing({
    baseDeliveryFee: -10,
    includedRadiusKm: 'invalid',
    outsideRadiusFeePerKm: NaN,
  });
  assert.deepEqual(normalizedBroken, DEFAULT_DELIVERY_PRICING);
});

test('normalizeBranchDeliveryPricing reads from nested deliveryPricing object and root fields', () => {
  const fromRoot = normalizeBranchDeliveryPricing({
    baseDeliveryFee: 15,
    includedRadiusKm: 4,
    outsideRadiusFeePerKm: 12,
  });
  assert.equal(fromRoot.baseDeliveryFee, 15);
  assert.equal(fromRoot.includedRadiusKm, 4);
  assert.equal(fromRoot.outsideRadiusFeePerKm, 12);

  const fromNested = normalizeBranchDeliveryPricing({
    deliveryPricing: {
      baseDeliveryFee: '25.50',
      includedRadiusKm: '5.2',
      outsideRadiusFeePerKm: '18.75',
    },
  });
  assert.equal(fromNested.baseDeliveryFee, 25.5);
  assert.equal(fromNested.includedRadiusKm, 5.2);
  assert.equal(fromNested.outsideRadiusFeePerKm, 18.75);
});

test('validateDeliveryPricingInput validates and sanitizes input data', () => {
  const valid = validateDeliveryPricingInput({
    baseDeliveryFee: '15',
    includedRadiusKm: '4.5',
    outsideRadiusFeePerKm: '12',
  });
  assert.equal(valid.baseDeliveryFee, 15);
  assert.equal(valid.includedRadiusKm, 4.5);
  assert.equal(valid.outsideRadiusFeePerKm, 12);
  assert.equal(valid.serviceRadiusKm, 4.5);

  assert.throws(() => {
    validateDeliveryPricingInput({ baseDeliveryFee: -5 });
  }, /Base delivery fee/);

  assert.throws(() => {
    validateDeliveryPricingInput({ baseDeliveryFee: 10, includedRadiusKm: -1 });
  }, /Included radius/);

  assert.throws(() => {
    validateDeliveryPricingInput({ baseDeliveryFee: 10, includedRadiusKm: 5, outsideRadiusFeePerKm: -10 });
  }, /Outside-radius fee/);
});

test('calculateDeliveryFee handles inside, boundary, and outside distances', () => {
  const pricing = {
    baseDeliveryFee: 10,
    includedRadiusKm: 3,
    outsideRadiusFeePerKm: 10,
  };

  // 0 km: within included radius
  assert.equal(calculateDeliveryFee(0, pricing), 10);

  // 2.5 km: within included radius
  assert.equal(calculateDeliveryFee(2.5, pricing), 10);

  // 3.0 km: exactly on boundary
  assert.equal(calculateDeliveryFee(3.0, pricing), 10);

  // 4.0 km: 1 km outside -> 10 + 1 * 10 = 20
  assert.equal(calculateDeliveryFee(4.0, pricing), 20);

  // Invalid or null distance returns base fee
  assert.equal(calculateDeliveryFee(null, pricing), 10);
});

test('EXPLICIT FIXTURE: 8.7 km distance calculates to ₱67 with ₱10/km, and ₱95.50 with ₱15/km', () => {
  const distance = 8.7;

  // Case 1: Base ₱10, Included 3 km, ₱10/km outside
  // Excess = 8.7 - 3 = 5.7 km
  // Excess fee = 5.7 * 10 = ₱57.00
  // Delivery fee = 10 + 57 = ₱67.00
  const pricing10 = {
    baseDeliveryFee: 10,
    includedRadiusKm: 3,
    outsideRadiusFeePerKm: 10,
  };

  const fee10 = calculateDeliveryFee(distance, pricing10);
  assert.equal(fee10, 67);

  const breakdown10 = getDeliveryFeeBreakdown(distance, pricing10);
  assert.equal(breakdown10.distanceKm, 8.7);
  assert.equal(breakdown10.includedRadiusKm, 3);
  assert.equal(breakdown10.excessDistanceKm, 5.7);
  assert.equal(breakdown10.baseDeliveryFee, 10);
  assert.equal(breakdown10.outsideRadiusFeePerKm, 10);
  assert.equal(breakdown10.excessFee, 57);
  assert.equal(breakdown10.totalFee, 67);
  assert.equal(breakdown10.isWithinIncludedRadius, false);
  assert.equal(breakdown10.isOutsideIncludedRadius, true);

  const subtotal = 180;
  const orderTotal10 = calculateOrderTotal(subtotal, fee10);
  assert.equal(orderTotal10, 247);

  // Case 2: Base ₱10, Included 3 km, ₱15/km outside
  // Excess = 8.7 - 3 = 5.7 km
  // Excess fee = 5.7 * 15 = ₱85.50
  // Delivery fee = 10 + 85.50 = ₱95.50
  const pricing15 = {
    baseDeliveryFee: 10,
    includedRadiusKm: 3,
    outsideRadiusFeePerKm: 15,
  };

  const fee15 = calculateDeliveryFee(distance, pricing15);
  assert.equal(fee15, 95.5);

  const breakdown15 = getDeliveryFeeBreakdown(distance, pricing15);
  assert.equal(breakdown15.excessFee, 85.5);
  assert.equal(breakdown15.totalFee, 95.5);

  const orderTotal15 = calculateOrderTotal(subtotal, fee15);
  assert.equal(orderTotal15, 275.5);
});

test('updateBranchDeliveryPricingInTransaction updates canonical deliveryPricing and logs audit trail', async () => {
  const branchData = {
    id: 'branch-south',
    name: 'South Branch',
    deliveryPricing: {
      baseDeliveryFee: 10,
      includedRadiusKm: 3,
      outsideRadiusFeePerKm: 10,
    },
    baseDeliveryFee: 10,
    includedRadiusKm: 3,
    outsideRadiusFeePerKm: 10,
  };

  let updatedBranchPayload = null;
  let loggedAudit = null;

  const mockAuditDocRef = { id: 'audit-1' };
  const mockDb = {
    collection: (name) => {
      assert.equal(name, 'adminAuditLogs');
      return {
        doc: () => mockAuditDocRef,
      };
    },
  };

  const mockBranchRef = {
    id: 'branch-south',
    path: 'branches/branch-south',
  };

  const mockTx = {
    get: async (ref) => {
      assert.equal(ref, mockBranchRef);
      return {
        exists: true,
        data: () => branchData,
      };
    },
    update: (ref, payload) => {
      assert.equal(ref, mockBranchRef);
      updatedBranchPayload = payload;
    },
    set: (ref, payload) => {
      assert.equal(ref, mockAuditDocRef);
      loggedAudit = payload;
    },
  };

  const newPricing = {
    baseDeliveryFee: 15,
    includedRadiusKm: 4,
    outsideRadiusFeePerKm: 12,
  };

  const actor = {
    uid: 'manager-1',
    publicUid: 'MGR-001',
    email: 'manager@bluetap.ph',
    role: 'manager',
    branchId: 'branch-south',
  };

  const result = await updateBranchDeliveryPricingInTransaction({
    db: mockDb,
    tx: mockTx,
    branchRef: mockBranchRef,
    branchId: 'branch-south',
    pricingInput: newPricing,
    actor,
  });

  assert.equal(result.baseDeliveryFee, 15);
  assert.equal(result.includedRadiusKm, 4);
  assert.equal(result.outsideRadiusFeePerKm, 12);

  // Assert canonical update structure
  assert.deepEqual(updatedBranchPayload.deliveryPricing, {
    baseDeliveryFee: 15,
    includedRadiusKm: 4,
    outsideRadiusFeePerKm: 12,
    serviceRadiusKm: 4,
    updatedAt: result.updatedAt,
    updatedBy: 'manager-1',
  });
  assert.equal(updatedBranchPayload.baseDeliveryFee, 15);
  assert.equal(updatedBranchPayload.includedRadiusKm, 4);
  assert.equal(updatedBranchPayload.outsideRadiusFeePerKm, 12);
  assert.equal(updatedBranchPayload.serviceRadiusKm, 4);

  // Assert audit record
  assert.ok(loggedAudit);
  assert.equal(loggedAudit.action, 'MANAGER_BRANCH_DELIVERY_PRICING_UPDATED');
  assert.equal(loggedAudit.branchId, 'branch-south');
  assert.equal(loggedAudit.actorUid, 'manager-1');
  assert.equal(loggedAudit.actorPublicUid, 'MGR-001');
  assert.equal(loggedAudit.actorRole, 'manager');
  assert.equal(loggedAudit.before.baseDeliveryFee, 10);
  assert.equal(loggedAudit.before.includedRadiusKm, 3);
  assert.equal(loggedAudit.before.outsideRadiusFeePerKm, 10);
  assert.equal(loggedAudit.after.baseDeliveryFee, 15);
  assert.equal(loggedAudit.after.includedRadiusKm, 4);
  assert.equal(loggedAudit.after.outsideRadiusFeePerKm, 12);
});

test('Historical order snapshots remain immutable when branch pricing changes', () => {
  // Scheme A order placed
  const schemeA = {
    baseDeliveryFee: 10,
    includedRadiusKm: 3,
    outsideRadiusFeePerKm: 10,
  };
  const orderA = {
    id: 'order-1',
    items: [{ productId: 'refill', quantity: 2 }],
    itemPricesAtOrder: { refill: 35 },
    subtotalAtOrder: 70,
    distanceKm: 8.7,
    deliveryPricingSnapshot: { ...schemeA },
    deliveryFeeAtOrder: calculateDeliveryFee(8.7, schemeA),
    totalAtOrder: calculateOrderTotal(70, calculateDeliveryFee(8.7, schemeA)),
  };

  assert.equal(orderA.deliveryFeeAtOrder, 67);
  assert.equal(orderA.totalAtOrder, 137);

  // Later, branch updates to Scheme B
  const schemeB = {
    baseDeliveryFee: 20,
    includedRadiusKm: 2,
    outsideRadiusFeePerKm: 15,
  };

  // Existing order retains snapshot and original delivery fee
  assert.equal(orderA.deliveryPricingSnapshot.baseDeliveryFee, 10);
  assert.equal(orderA.deliveryPricingSnapshot.includedRadiusKm, 3);
  assert.equal(orderA.deliveryFeeAtOrder, 67);
  assert.equal(orderA.totalAtOrder, 137);

  // New order placed under Scheme B gets updated pricing
  const orderB = {
    id: 'order-2',
    items: [{ productId: 'refill', quantity: 2 }],
    itemPricesAtOrder: { refill: 35 },
    subtotalAtOrder: 70,
    distanceKm: 8.7,
    deliveryPricingSnapshot: { ...schemeB },
    // 8.7 - 2 = 6.7 km excess * 15 = 100.5 + 20 = 120.5
    deliveryFeeAtOrder: calculateDeliveryFee(8.7, schemeB),
    totalAtOrder: calculateOrderTotal(70, calculateDeliveryFee(8.7, schemeB)),
  };

  assert.equal(orderB.deliveryFeeAtOrder, 120.5);
  assert.equal(orderB.totalAtOrder, 190.5);

  // Order A is completely unaffected
  assert.equal(orderA.deliveryFeeAtOrder, 67);
  assert.equal(orderA.totalAtOrder, 137);
});
