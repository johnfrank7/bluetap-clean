const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const babel = require('@babel/core');

const root = resolve(__dirname, '../../..');
const read = (relPath) => readFileSync(resolve(root, relPath), 'utf8');

// Load location service using Babel so ESM and React Native dependencies resolve safely in Node CJS
function loadLocationService() {
  const rnPath = require.resolve('react-native');
  require.cache[rnPath] = { id: rnPath, filename: rnPath, loaded: true, exports: { Platform: { OS: 'web' } } };
  const rawCode = read('services/location.js');
  const transformed = babel.transformSync(rawCode, {
    presets: ['babel-preset-expo'],
    filename: resolve(root, 'services/location.js'),
  }).code;
  const customRequire = (specifier) => {
    if (specifier.startsWith('.')) return require(resolve(root, 'services', specifier));
    return require(specifier);
  };
  const moduleObj = { exports: {} };
  const runner = new Function('require', 'exports', 'module', transformed);
  runner(customRequire, moduleObj.exports, moduleObj);
  return moduleObj.exports;
}

const {
  normalizeLocation,
  haversineDistanceKm,
} = loadLocationService();

const {
  PIN_GEOMETRY,
  connectorCoordinates,
  pinBodyPosition,
  projectedOverlayGeometry,
  stationColorFor,
} = require('../../../components/locationMapModel');

const {
  clampCarouselIndex,
  getCarouselIndexFromOffset,
  resolveCarouselStepIndex,
  resolveSettledCarouselIndex,
} = require('../../../services/carouselSnap');

// ============================================================================
// 1. MAP POLYLINE & COORDINATE PAIR GENERATION (BUG A)
// ============================================================================

test('connectorCoordinates generates exact [delivery, station] pair for valid Requester and provider coordinates', () => {
  const delivery = { latitude: 10.3157, longitude: 123.8854 };
  const provider = { latitude: 10.3200, longitude: 123.8900 };

  const endpoints = connectorCoordinates(delivery, provider);
  assert.equal(endpoints.length, 2);
  assert.equal(endpoints[0], delivery);
  assert.equal(endpoints[1], provider);
  assert.deepEqual(endpoints, [
    { latitude: 10.3157, longitude: 123.8854 },
    { latitude: 10.3200, longitude: 123.8900 },
  ]);
});

test('connectorCoordinates safely handles nested location structures from branch map objects', () => {
  const delivery = { latitude: 10.3157, longitude: 123.8854 };
  const nestedProvider = { location: { latitude: 10.3250, longitude: 123.8950 } };

  const endpoints = connectorCoordinates(delivery, nestedProvider);
  assert.equal(endpoints.length, 2);
  assert.equal(endpoints[0], delivery);
  assert.equal(endpoints[1], nestedProvider);
});

test('connectorCoordinates returns empty array when delivery or provider coordinates are missing or invalid', () => {
  const validDelivery = { latitude: 10.3157, longitude: 123.8854 };
  const validStation = { latitude: 10.3200, longitude: 123.8900 };

  // Null/undefined endpoints
  assert.deepEqual(connectorCoordinates(null, validStation), []);
  assert.deepEqual(connectorCoordinates(validDelivery, null), []);
  assert.deepEqual(connectorCoordinates(undefined, undefined), []);

  // Incomplete coordinate objects (null or non-numeric lat/lng)
  assert.deepEqual(connectorCoordinates({ latitude: null, longitude: 123.8 }, validStation), []);
  assert.deepEqual(connectorCoordinates(validDelivery, { latitude: 10.3, longitude: null }), []);
  assert.deepEqual(connectorCoordinates({ latitude: 'invalid', longitude: 123.8 }, validStation), []);
  assert.deepEqual(connectorCoordinates(validDelivery, {}), []);
});

test('switching selected provider station changes the second connector coordinate endpoint', () => {
  const delivery = { latitude: 10.3157, longitude: 123.8854 };
  const stationA = { latitude: 10.3200, longitude: 123.8900 };
  const stationB = { latitude: 10.3350, longitude: 123.9100 };

  const endpointsA = connectorCoordinates(delivery, stationA);
  const endpointsB = connectorCoordinates(delivery, stationB);

  // First coordinate (Requester delivery) stays identical
  assert.equal(endpointsA[0], delivery);
  assert.equal(endpointsB[0], delivery);

  // Second coordinate shifts to the newly selected provider
  assert.equal(endpointsA[1], stationA);
  assert.equal(endpointsB[1], stationB);
  assert.notDeepEqual(endpointsA[1], endpointsB[1]);
});

test('changing Requester delivery location changes the first connector coordinate endpoint', () => {
  const deliveryA = { latitude: 10.3157, longitude: 123.8854 };
  const deliveryB = { latitude: 10.3000, longitude: 123.8700 };
  const station = { latitude: 10.3200, longitude: 123.8900 };

  const endpointsA = connectorCoordinates(deliveryA, station);
  const endpointsB = connectorCoordinates(deliveryB, station);

  assert.equal(endpointsA[0], deliveryA);
  assert.equal(endpointsB[0], deliveryB);
  assert.notDeepEqual(endpointsA[0], endpointsB[0]);

  // Provider endpoint remains the same
  assert.equal(endpointsA[1], station);
  assert.equal(endpointsB[1], station);
});

test('normalizeLocation supports flat, nested coords, and nested location objects', () => {
  assert.deepEqual(normalizeLocation({ latitude: 10.1, longitude: 123.1 }), { latitude: 10.1, longitude: 123.1 });
  assert.deepEqual(normalizeLocation({ coords: { latitude: 10.2, longitude: 123.2 } }), { latitude: 10.2, longitude: 123.2 });
  assert.deepEqual(normalizeLocation({ location: { latitude: 10.3, longitude: 123.3 } }), { latitude: 10.3, longitude: 123.3 });
  assert.equal(normalizeLocation(null), null);
  assert.equal(normalizeLocation({}), null);
});

test('existing markers, station selection, and geodesic distance calculations are preserved', () => {
  const delivery = { latitude: 10.3157, longitude: 123.8854 };
  const station = { latitude: 10.3200, longitude: 123.8900 };

  const distanceKm = haversineDistanceKm(delivery, station);
  assert.ok(typeof distanceKm === 'number');
  assert.ok(distanceKm > 0 && distanceKm < 2, `Distance should be ~0.67 km, got ${distanceKm}`);

  // Distinct markers
  assert.notEqual(stationColorFor('station-1'), '#187BCD');
  assert.deepEqual(PIN_GEOMETRY.delivery.iconAnchor, [15, 37]);
  assert.deepEqual(PIN_GEOMETRY.stationSelected.iconAnchor, [17, 41]);
});

test('LocationMap.jsx applies dashed stroke styling with flexShrink:0 and trimmed ID matching', () => {
  const fileContent = read('components/LocationMap.jsx');

  // Verify dashed polyline styling
  assert.match(fileContent, /distanceLine:\s*\{/);
  assert.match(fileContent, /borderStyle:\s*['"]dashed['"]/);
  assert.match(fileContent, /borderTopWidth:\s*2/);
  assert.match(fileContent, /borderTopColor:\s*['"]#EF4444['"]/);
  assert.match(fileContent, /zIndex:\s*3/);

  // Verify dashes don't shrink and collapse
  assert.match(fileContent, /distanceDash:\s*\{/);
  assert.match(fileContent, /flexShrink:\s*0/);

  // Verify trimmed branch id matching for station selection
  assert.match(fileContent, /String\(bId \|\| ''\)\.trim\(\) === String\(selectedBranchId \|\| ''\)\.trim\(\)/);

  // Verify distance notice text remains present
  assert.match(fileContent, /Dashed line shows straight-line distance estimate, not driving distance\./);
});

// ============================================================================
// 2. DESKTOP PRODUCT CAROUSEL BROWSING & BOUNDARIES (BUG B)
// ============================================================================

test('resolveCarouselStepIndex reaches first, intermediate, and final product cards', () => {
  const count = 4; // 4 products

  // Step forward from card 0 -> card 1
  assert.equal(resolveCarouselStepIndex({ count, direction: 1, index: 0 }), 1);

  // Step forward from card 1 -> card 2 (intermediate)
  assert.equal(resolveCarouselStepIndex({ count, direction: 1, index: 1 }), 2);

  // Step forward from card 2 -> card 3 (final card)
  assert.equal(resolveCarouselStepIndex({ count, direction: 1, index: 2 }), 3);

  // Step backward from card 3 -> card 2
  assert.equal(resolveCarouselStepIndex({ count, direction: -1, index: 3 }), 2);

  // Step backward from card 1 -> card 0 (first card)
  assert.equal(resolveCarouselStepIndex({ count, direction: -1, index: 1 }), 0);
});

test('resolveCarouselStepIndex respects bounds and prevents out-of-range navigation', () => {
  const count = 3;

  // Cannot go before first card (index 0)
  assert.equal(resolveCarouselStepIndex({ count, direction: -1, index: 0 }), 0);

  // Cannot go past last card (index 2)
  assert.equal(resolveCarouselStepIndex({ count, direction: 1, index: 2 }), 2);

  // Clamping utility safeguards
  assert.equal(clampCarouselIndex(-5, count), 0);
  assert.equal(clampCarouselIndex(10, count), 2);
});

test('getCarouselIndexFromOffset correctly resolves scroll offset to product index', () => {
  const stride = 220; // 204px card + 16px gap
  const count = 5;

  assert.equal(getCarouselIndexFromOffset(0, stride, count), 0);
  assert.equal(getCarouselIndexFromOffset(220, stride, count), 1);
  assert.equal(getCarouselIndexFromOffset(440, stride, count), 2);
  assert.equal(getCarouselIndexFromOffset(660, stride, count), 3);
  assert.equal(getCarouselIndexFromOffset(880, stride, count), 4);
});

test('RequestForm product carousel maintains independent scroll state without mutating selection or quantities', () => {
  const fileContent = read('app/requester/requestform.jsx');

  // Uses separate state for scroll tracking
  assert.match(fileContent, /const \[productScrollX,\s*setProductScrollX\]\s*=\s*React\.useState\(0\)/);
  assert.match(fileContent, /const \[productContainerWidth,\s*setProductContainerWidth\]\s*=\s*React\.useState\(0\)/);
  assert.match(fileContent, /const \[productContentWidth,\s*setProductContentWidth\]\s*=\s*React\.useState\(0\)/);
  assert.match(fileContent, /const productScrollRef\s*=\s*React\.useRef\(null\)/);

  // Selected product items and cart quantities remain authoritative and separate
  assert.match(fileContent, /const \[items,\s*setItems\]\s*=\s*React\.useState\(\[\]\)/);

  // scrollProducts function only moves productScrollRef and sets position
  assert.match(fileContent, /const scrollProducts\s*=\s*React\.useCallback\(\(direction\)\s*=>/);
  assert.match(fileContent, /resolveCarouselStepIndex\(\{/);
  assert.match(fileContent, /productScrollRef\.current\?\.scrollTo\(\{/);
});

test('RequestForm renders desktop navigation controls with accessible labels and bounds disabling', () => {
  const fileContent = read('app/requester/requestform.jsx');

  // Navigation header with indicator and controls
  assert.match(fileContent, /styles\.productNavHeader/);
  assert.match(fileContent, /accessibilityLabel=['"]Previous product['"]/);
  assert.match(fileContent, /accessibilityLabel=['"]Next product['"]/);
  assert.match(fileContent, /accessibilityRole=['"]button['"]/);

  // Disabled states at bounds
  assert.match(fileContent, /disabled=\{!canScrollProductsLeft\}/);
  assert.match(fileContent, /disabled=\{!canScrollProductsRight\}/);

  // Position indicator
  assert.match(fileContent, /currentProductIndex\s*\+\s*1/);
  assert.match(fileContent, /\{products\.length\}/);
});

test('RequestForm preserves mobile swipe and prevents page-wide horizontal overflow', () => {
  const fileContent = read('app/requester/requestform.jsx');

  // ScrollView keeps horizontal, scrollEnabled, and touch event tracking
  assert.match(fileContent, /<ScrollView[^>]*\bhorizontal\b/);
  assert.match(fileContent, /onScroll=\{[^}]*setProductScrollX/);
  assert.match(fileContent, /scrollEventThrottle=\{16\}/);

  // Carousel wrapper contains overflow
  assert.match(fileContent, /productCarouselWrapper:\s*\{[^}]*overflow:\s*['"]hidden['"]/);

  // Product nav buttons use accessible buttons and high-contrast tokens
  assert.match(fileContent, /productNavButton:\s*\{/);
  assert.match(fileContent, /productNavButtonDisabled:\s*\{/);
});
