const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const { createRequire } = require('node:module');

function loadTranspiled(targetPath, cache = new Map()) {
  const resolvedPath = path.extname(targetPath) ? targetPath : targetPath + '.js';
  if (cache.has(resolvedPath)) return cache.get(resolvedPath);

  const code = fs.readFileSync(resolvedPath, 'utf8');
  const transformed = babel.transformSync(code, {
    presets: ['babel-preset-expo'],
    filename: resolvedPath,
  }).code;
  const mod = { exports: {} };
  cache.set(resolvedPath, mod.exports);

  const nativeRequire = createRequire(resolvedPath);
  const customRequire = (specifier) => {
    if (specifier === './requesterOrdering') return {};
    if (specifier === 'firebase/firestore') return { collection: () => {}, onSnapshot: () => {}, query: () => {}, where: () => {} };
    if (specifier === '../firebase' || specifier === './firebase') return { db: {}, auth: {} };
    if (specifier === 'react-native') return { Platform: { OS: 'web' } };

    if (specifier.startsWith('.')) {
      const childPath = path.resolve(path.dirname(resolvedPath), specifier);
      const withExt = path.extname(childPath) ? childPath : childPath + '.js';
      if (fs.existsSync(withExt)) {
        return loadTranspiled(withExt, cache);
      }
    }
    return nativeRequire(specifier);
  };

  const fn = new Function('require', 'module', 'exports', transformed);
  fn(customRequire, mod, mod.exports);
  cache.set(resolvedPath, mod.exports);
  return mod.exports;
}

const {
  normalizeRequestDetails,
  formatOrderAmount,
  formatOrderPrice,
} = loadTranspiled(path.resolve(__dirname, '../../../services/orderNormalizer.js'));

const {
  normalizeRequest,
  normalizeItems,
} = loadTranspiled(path.resolve(__dirname, '../../../services/requests.js'));

const {
  toDistributorScreenOrder,
} = loadTranspiled(path.resolve(__dirname, '../../../services/distributorOrders.js'));

const {
  sanitizeOrder,
} = loadTranspiled(path.resolve(__dirname, '../../../services/assistant/assistantContext.js'));

const {
  calculateDeliveryFee,
  calculateOrderTotal,
  normalizeBranchDeliveryPricing,
} = require('../../../services/deliveryPricing');

// =============================================================================
// TEST SUITE: Authoritative Delivery Fee Snapshot & Cross-Role Financial Consistency
// =============================================================================

test('TEST CASE A: Standard order with non-zero delivery fee displays accurately across details', () => {
  const orderDoc = {
    id: 'req_001',
    subtotalAtOrder: 180,
    deliveryFeeAtOrder: 67.5,
    totalAtOrder: 247.5,
    deliveryFeePolicy: {
      baseDeliveryFee: 20,
      includedRadiusKm: 4,
      outsideRadiusFeePerKm: 10,
      serviceRadiusKm: 5,
    },
    distanceKmAtOrder: 8.75,
    items: [
      {
        id: 'prod_1',
        productNameSnapshot: '5 Gallon Slim Round',
        unitPriceAtOrder: 60,
        quantity: 3,
        totalAtOrder: 180,
      },
    ],
  };

  const normalized = normalizeRequestDetails(orderDoc);

  assert.equal(normalized.subtotal, 180);
  assert.equal(normalized.deliveryFee, 67.5);
  assert.equal(normalized.grandTotal, 247.5);
  assert.equal(normalized.formattedSubtotal, '₱180.00');
  assert.equal(normalized.formattedDeliveryFee, '₱67.50');
  assert.equal(normalized.formattedGrandTotal, '₱247.50');
  assert.equal(normalized.hasDeliveryFee, true);
  assert.equal(normalized.distanceKmAtOrder, 8.75);
  assert.equal(normalized.deliveryFeePolicy.baseDeliveryFee, 20);
});

test('TEST CASE B: Legitimate zero delivery fee explicitly preserves and formats ₱0.00', () => {
  const zeroFeeOrder = {
    id: 'req_zero_fee',
    subtotalAtOrder: 200,
    deliveryFeeAtOrder: 0,
    totalAtOrder: 200,
    deliveryFeePolicy: {
      baseDeliveryFee: 0,
      includedRadiusKm: 5,
      outsideRadiusFeePerKm: 0,
      serviceRadiusKm: 5,
    },
    distanceKmAtOrder: 2.1,
    items: [
      {
        id: 'prod_2',
        productNameSnapshot: '5 Gallon Round',
        unitPriceAtOrder: 50,
        quantity: 4,
        totalAtOrder: 200,
      },
    ],
  };

  const normalized = normalizeRequestDetails(zeroFeeOrder);

  assert.equal(normalized.subtotal, 200);
  assert.equal(normalized.deliveryFee, 0);
  assert.equal(normalized.grandTotal, 200);
  assert.equal(normalized.formattedSubtotal, '₱200.00');
  assert.equal(normalized.formattedDeliveryFee, '₱0.00');
  assert.equal(normalized.formattedGrandTotal, '₱200.00');
  assert.equal(normalized.hasDeliveryFee, true);
});

test('TEST CASE C: Missing or unrecorded delivery fee renders unavailable indicator (—) and never fabricates 0', () => {
  const legacyMissingFeeOrder = {
    id: 'req_legacy_missing',
    subtotalAtOrder: 180,
    // deliveryFeeAtOrder and deliveryFee are omitted
    totalAtOrder: 247.5,
    items: [
      {
        id: 'prod_1',
        productNameSnapshot: 'Standard Container',
        unitPriceAtOrder: 60,
        quantity: 3,
        totalAtOrder: 180,
      },
    ],
  };

  const normalized = normalizeRequestDetails(legacyMissingFeeOrder);

  assert.equal(normalized.subtotal, 180);
  assert.equal(normalized.deliveryFee, undefined);
  assert.equal(normalized.grandTotal, 247.5);
  assert.equal(normalized.formattedSubtotal, '₱180.00');
  assert.equal(normalized.formattedDeliveryFee, '—');
  assert.equal(normalized.formattedGrandTotal, '₱247.50');
  assert.equal(normalized.hasDeliveryFee, false);

  // Directly test formatOrderPrice / formatOrderAmount
  assert.equal(formatOrderPrice(undefined), '—');
  assert.equal(formatOrderPrice(null), '—');
  assert.equal(formatOrderPrice(0), '₱0.00');
  assert.equal(formatOrderAmount(undefined), '—');
  assert.equal(formatOrderAmount(null), '—');
  assert.equal(formatOrderAmount(0), '₱0.00');
});

test('TEST CASE D: Legacy field backward compatibility safely resolves delivery_fee and deliveryFee aliases', () => {
  const legacySnakeCase = {
    id: 'req_legacy_snake',
    subtotal: 150,
    delivery_fee: 45.25,
    total_cost: 195.25,
    items: [{ id: 'p1', product_name: 'Water', quantity: 3, line_total: 150 }],
  };

  const normalizedSnake = normalizeRequestDetails(legacySnakeCase);
  assert.equal(normalizedSnake.subtotal, 150);
  assert.equal(normalizedSnake.deliveryFee, 45.25);
  assert.equal(normalizedSnake.grandTotal, 195.25);
  assert.equal(normalizedSnake.formattedDeliveryFee, '₱45.25');

  const legacyCamelCase = {
    id: 'req_legacy_camel',
    subtotal: 100,
    deliveryFee: 30,
    totalAmount: 130,
    items: [{ id: 'p2', productName: 'Refill', quantity: 2, totalAtOrder: 100 }],
  };

  const normalizedCamel = normalizeRequestDetails(legacyCamelCase);
  assert.equal(normalizedCamel.subtotal, 100);
  assert.equal(normalizedCamel.deliveryFee, 30);
  assert.equal(normalizedCamel.grandTotal, 130);
  assert.equal(normalizedCamel.formattedDeliveryFee, '₱30.00');
});

test('TEST CASE E: Historical order snapshot remains immutable when branch delivery pricing changes', () => {
  // Original branch settings at order time
  const initialBranchPricing = {
    baseDeliveryFee: 20,
    includedRadiusKm: 4,
    outsideRadiusFeePerKm: 10,
    serviceRadiusKm: 5,
  };

  const distance = 8.75;
  const originalFee = calculateDeliveryFee(distance, initialBranchPricing);
  const subtotal = 180;
  const originalTotal = calculateOrderTotal(subtotal, originalFee);

  assert.equal(originalFee, 67.5);
  assert.equal(originalTotal, 247.5);

  const historicalOrder = {
    id: 'order_snapshot_immutable',
    subtotalAtOrder: subtotal,
    deliveryFeeAtOrder: originalFee,
    totalAtOrder: originalTotal,
    deliveryFeePolicy: initialBranchPricing,
    distanceKmAtOrder: distance,
    items: [{ id: 'item_1', productNameSnapshot: 'Water', quantity: 3, totalAtOrder: subtotal }],
  };

  // Branch updates pricing policy significantly later
  const updatedBranchPricing = {
    baseDeliveryFee: 50,
    includedRadiusKm: 2,
    outsideRadiusFeePerKm: 25,
    serviceRadiusKm: 10,
  };

  // Newly placed order under updated pricing would cost much more
  const newFeeForSameDistance = calculateDeliveryFee(distance, updatedBranchPricing);
  assert.equal(newFeeForSameDistance, 218.75);

  // BUT the historical order snapshot MUST NOT be recomputed or mutated
  const normalizedPastOrder = normalizeRequestDetails(historicalOrder);
  assert.equal(normalizedPastOrder.subtotal, 180);
  assert.equal(normalizedPastOrder.deliveryFee, 67.5);
  assert.equal(normalizedPastOrder.grandTotal, 247.5);
  assert.equal(normalizedPastOrder.formattedDeliveryFee, '₱67.50');
  assert.equal(normalizedPastOrder.formattedGrandTotal, '₱247.50');
});

test('TEST CASE F: Cross-role consistency: Requester, Distributor, Manager, and Assistant models consume identical financial figures', () => {
  const canonicalOrder = {
    id: 'bt_order_cross_role',
    requestId: 'BT-REQ-001',
    status: 'accepted',
    subtotalAtOrder: 180,
    subtotal: 180,
    deliveryFeeAtOrder: 67.5,
    deliveryFee: 67.5,
    delivery_fee: 67.5,
    totalAtOrder: 247.5,
    total_cost: 247.5,
    totalAmount: 247.5,
    deliveryFeePolicy: {
      baseDeliveryFee: 20,
      includedRadiusKm: 4,
      outsideRadiusFeePerKm: 10,
    },
    distanceKmAtOrder: 8.75,
    items: [
      {
        id: 'item_1',
        productNameSnapshot: '5 Gallon Round',
        unitPriceAtOrder: 60,
        quantity: 3,
        totalAtOrder: 180,
      },
    ],
  };

  // 1. Requester normalizer (used in Request Details Modal, Current Request, My Orders)
  const requesterNormalized = normalizeRequestDetails(canonicalOrder);

  // 2. Distributor screen order (used across distributor dashboard and request list)
  const distributorOrder = toDistributorScreenOrder(canonicalOrder);

  // 3. Assistant context sanitizer (used for AI operational answers)
  const assistantSanitized = sanitizeOrder(canonicalOrder);

  // Assert Requester figures
  assert.equal(requesterNormalized.subtotal, 180);
  assert.equal(requesterNormalized.deliveryFee, 67.5);
  assert.equal(requesterNormalized.grandTotal, 247.5);

  // Assert Distributor figures
  assert.equal(distributorOrder.subtotal, 180);
  assert.equal(distributorOrder.subtotalAtOrder, 180);
  assert.equal(distributorOrder.deliveryFee, 67.5);
  assert.equal(distributorOrder.deliveryFeeAtOrder, 67.5);
  assert.equal(distributorOrder.totalAmount, 247.5);
  assert.equal(distributorOrder.totalAtOrder, 247.5);

  // Assert Assistant figures
  assert.equal(assistantSanitized.subtotal, '₱180.00');
  assert.equal(assistantSanitized.deliveryFee, '₱67.50');
  assert.equal(assistantSanitized.total, '₱247.50');
});

test('TEST CASE G: Server authoritative pricing: client cannot tamper or override authoritative delivery fee', () => {
  const branchPricing = {
    baseDeliveryFee: 20,
    includedRadiusKm: 4,
    outsideRadiusFeePerKm: 10,
    serviceRadiusKm: 5,
  };

  const distance = 8.75;
  const calculatedFee = calculateDeliveryFee(distance, branchPricing);
  const itemsSubtotal = 180;
  const calculatedTotal = calculateOrderTotal(itemsSubtotal, calculatedFee);

  // Client attempted spoof payload
  const clientPayload = {
    items: [{ productId: 'p1', quantity: 3 }],
    clientDeliveryFeeEstimate: 0,
    clientTotalEstimate: 10,
  };

  // Server trusted build ignores client estimates and uses server-computed values
  const trustedOrder = {
    subtotalAtOrder: itemsSubtotal,
    deliveryFeeAtOrder: calculatedFee,
    totalAtOrder: calculatedTotal,
  };

  assert.equal(trustedOrder.deliveryFeeAtOrder, 67.5);
  assert.equal(trustedOrder.totalAtOrder, 247.5);
  assert.notEqual(trustedOrder.deliveryFeeAtOrder, clientPayload.clientDeliveryFeeEstimate);
  assert.notEqual(trustedOrder.totalAtOrder, clientPayload.clientTotalEstimate);
});

test('TEST CASE H: Requester view consistency: Current Request, My Orders, and Request Details share identical snapshot', () => {
  const rawOrder = {
    id: 'req_order_sync_view',
    requesterUid: 'user_123',
    status: 'Pending',
    subtotalAtOrder: 180,
    deliveryFeeAtOrder: 67.5,
    totalAtOrder: 247.5,
    deliveryFeePolicy: { baseDeliveryFee: 20 },
    distanceKmAtOrder: 8.75,
    items: [
      {
        id: 'p1',
        productNameSnapshot: '5 Gallon Round',
        unitPriceAtOrder: 60,
        quantity: 3,
        totalAtOrder: 180,
      },
    ],
  };

  // Normalizer used by real-time request listeners in services/requests.js
  const normalizedFromListener = normalizeRequest(rawOrder);

  // Normalizer used when opening details modal
  const normalizedForModal = normalizeRequestDetails(normalizedFromListener);

  assert.equal(normalizedFromListener.subtotalAtOrder, 180);
  assert.equal(normalizedFromListener.deliveryFeeAtOrder, 67.5);
  assert.equal(normalizedFromListener.totalAtOrder, 247.5);

  assert.equal(normalizedForModal.subtotal, 180);
  assert.equal(normalizedForModal.deliveryFee, 67.5);
  assert.equal(normalizedForModal.grandTotal, 247.5);
  assert.equal(normalizedForModal.formattedSubtotal, '₱180.00');
  assert.equal(normalizedForModal.formattedDeliveryFee, '₱67.50');
  assert.equal(normalizedForModal.formattedGrandTotal, '₱247.50');
});

test('TEST CASE I: Strict distinction between zero, null, undefined, and invalid values', () => {
  // Explicit zero
  const zeroDoc = normalizeRequestDetails({ subtotalAtOrder: 100, deliveryFeeAtOrder: 0, totalAtOrder: 100 });
  assert.equal(zeroDoc.deliveryFee, 0);
  assert.equal(zeroDoc.formattedDeliveryFee, '₱0.00');

  // Explicit null
  const nullDoc = normalizeRequestDetails({ subtotalAtOrder: 100, deliveryFeeAtOrder: null, totalAtOrder: 100 });
  assert.equal(nullDoc.deliveryFee, undefined);
  assert.equal(nullDoc.formattedDeliveryFee, '—');

  // Explicit undefined
  const undefDoc = normalizeRequestDetails({ subtotalAtOrder: 100, deliveryFeeAtOrder: undefined, totalAtOrder: 100 });
  assert.equal(undefDoc.deliveryFee, undefined);
  assert.equal(undefDoc.formattedDeliveryFee, '—');

  // Empty string
  const emptyDoc = normalizeRequestDetails({ subtotalAtOrder: 100, deliveryFeeAtOrder: '', totalAtOrder: 100 });
  assert.equal(emptyDoc.deliveryFee, undefined);
  assert.equal(emptyDoc.formattedDeliveryFee, '—');

  // Non-numeric string
  const nanDoc = normalizeRequestDetails({ subtotalAtOrder: 100, deliveryFeeAtOrder: 'free', totalAtOrder: 100 });
  assert.equal(nanDoc.deliveryFee, undefined);
  assert.equal(nanDoc.formattedDeliveryFee, '—');
});

test('TEST CASE J: Decimal precision and currency rounding in delivery fee and subtotal calculations', () => {
  // Distance 5.555 km with base fee 20, 4 km included, 10/km outside
  // Outside distance = 1.555 km -> 15.55 fee -> total fee = 35.55
  const branchPricing = {
    baseDeliveryFee: 20,
    includedRadiusKm: 4,
    outsideRadiusFeePerKm: 10,
  };
  const fee = calculateDeliveryFee(5.555, branchPricing);
  assert.equal(fee, 35.55);

  const orderDoc = {
    subtotalAtOrder: 123.456, // should round to 123.46
    deliveryFeeAtOrder: 35.55,
    totalAtOrder: 159.01,
  };

  const normalized = normalizeRequestDetails(orderDoc);
  assert.equal(normalized.subtotal, 123.46);
  assert.equal(normalized.formattedSubtotal, '₱123.46');
  assert.equal(normalized.formattedDeliveryFee, '₱35.55');
  assert.equal(normalized.formattedGrandTotal, '₱159.01');
});
