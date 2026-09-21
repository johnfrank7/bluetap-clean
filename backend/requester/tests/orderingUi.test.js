const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const form = read('app/requester/requestform.jsx');
const map = read('components/LocationMap.jsx');
const productCard = read('components/ProductCard.jsx');
const layout = read('app/requester/_layout.jsx');
const nav = read('components/AppBottomNav.jsx');
const notifications = read('app/requester/r_notification.jsx');
const profile = read('app/requester/r_profile.jsx');
const dashboard = read('app/requester/r_dashboard.jsx');
const adminProducts = read('app/admin/products.jsx');
const adminBranches = read('app/admin/branches.jsx');
const location = read('services/location.js');
const ordering = read('services/requesterOrdering.js');

test('new request is structured into delivery, provider, product, details, and review sections', () => {
  for (const label of ['Delivery location', 'Select provider branch', 'Select products', 'Order details', 'Review request']) assert.match(form, new RegExp(label));
});
test('incomplete Requester profile has a clear remediation action', () => {
  assert.match(form, /Complete your profile before placing an order/); assert.match(form, /Complete profile/);
});
test('location is requested only from an explicit order action', () => {
  assert.match(form, /Use my current location/); assert.doesNotMatch(location, /watchPosition|watchPositionAsync|startLocationUpdates/);
});
test('web and native location paths are separated', () => {
  assert.match(location, /Platform\.OS === 'web'/); assert.match(location, /navigator\.geolocation/); assert.match(location, /expo-location/);
});
test('denied location explains why access is needed and manual pin remains available', () => {
  assert.match(location, /Location access is needed/); assert.match(form, /tap the map to place the delivery pin manually/);
});
test('branches are ranked using Haversine distance and labeled approximate', () => {
  assert.match(location, /haversineDistanceKm/); assert.match(location, /sort\(\(left, right\) => left\.distanceKm - right\.distanceKm\)/); assert.match(form, /Approx\./);
});
test('map renders requester and provider markers with fit view', () => {
  assert.match(map, /requesterMarker/); assert.match(map, /branchMarker/); assert.match(map, /Fit view/);
});
test('map uses OpenStreetMap without a paid routing dependency', () => assert.match(map, /tile\.openstreetmap\.org/));
test('product card uses a prominent contain image and a placeholder', () => {
  assert.match(productCard, /resizeMode="contain"/); assert.match(productCard, /placeholder/i); assert.match(productCard, /height:158/);
});
test('Requester bottom navigation participates in layout flow instead of overlaying content', () => {
  assert.match(layout, /SafeAreaView/); assert.match(layout, /navArea/); assert.doesNotMatch(layout, /navOverlay/); assert.match(nav, /floating=\{false\}/);
});
test('Requester form uses keyboard avoidance and safe bottom content space', () => {
  assert.match(form, /KeyboardAvoidingView/); assert.match(form, /paddingBottom:36/);
});
test('Admin Products supports add, edit, archive, image preview, and branch availability', () => {
  for (const label of ['Add product', 'Edit product', 'Deactivate', 'Choose image', 'Branch availability']) assert.match(adminProducts, new RegExp(label));
  assert.doesNotMatch(adminProducts, /Delete product/);
});
test('Admin Branches requires coordinates and includes a shared map picker', () => {
  assert.match(adminBranches, /latitude/); assert.match(adminBranches, /longitude/); assert.match(adminBranches, /LocationMap/); assert.match(adminBranches, /Coordinates are required/);
});
test('Requester catalog is short-cached, deduplicated, and exposes shared queries', () => {
  assert.match(ordering, /CACHE_MS = 30_000/); assert.match(ordering, /catalogRequest/);
  for (const method of ['getActiveBranches', 'getActiveProducts', 'getProductsForBranch', 'getRequesterOrders']) assert.match(ordering, new RegExp(method));
});
test('notifications are order-derived and contain no demo request numbers', () => {
  assert.match(notifications, /subscribeRequesterRequests/); assert.doesNotMatch(notifications, /BT-01245|BT-01212|Toledo Pure Water Station/);
});
test('profile renders missing values as Not provided', () => assert.match(profile, /Not provided/));
test('dashboard supports both a current order card and a no-current-request state', () => {
  assert.match(dashboard, /Current Request/); assert.match(dashboard, /No current request/i);
});
test('new ordering surfaces use shared BlueTap theme tokens', () => {
  assert.match(form, /BLUETAP_COLORS/); assert.match(productCard, /BLUETAP_COLORS/); assert.match(notifications, /BLUETAP_COLORS/);
});
