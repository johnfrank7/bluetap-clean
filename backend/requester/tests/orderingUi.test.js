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
const distributorLayout = read('app/distributor/_layout.jsx');
const portalShell = read('components/UserPortalShell.jsx');
const portalLayout = read('constants/userPortalLayout.js');
const nav = read('components/AppBottomNav.jsx');
const notifications = read('app/requester/r_notification.jsx');
const profile = read('app/requester/r_profile.jsx');
const dashboard = read('app/requester/r_dashboard.jsx');
const adminProducts = read('app/admin/products.jsx');
const adminBranches = read('app/admin/branches.jsx');
const location = read('services/location.js');
const ordering = read('services/requesterOrdering.js');
const theme = read('components/BlueTapTheme.jsx');
const themeButton = read('components/ThemeIconButton.jsx');
const header = read('components/BlueTapHeader.jsx');
const rootLayout = read('app/_layout.jsx');
const landing = read('app/index.jsx');

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
test('map renders a clear initial location prompt plus requester and provider markers with fit view', () => {
  assert.match(map, /Select your delivery location/); assert.match(map, /Your delivery location/); assert.match(map, /requesterMarker/); assert.match(map, /branchMarker/); assert.match(map, /Fit view/);
});
test('map uses OpenStreetMap without a paid routing dependency', () => assert.match(map, /tile\.openstreetmap\.org/));
test('product card uses a prominent contain image and a placeholder', () => {
  assert.match(productCard, /resizeMode="contain"/); assert.match(productCard, /placeholder/i); assert.match(productCard, /height:158/);
});
test('Requester floating navigation reserves shared content space instead of covering controls', () => {
  assert.match(layout, /UserPortalShell/); assert.match(distributorLayout, /UserPortalShell/); assert.match(portalShell, /backgroundColor: 'transparent'/); assert.match(portalShell, /navOverlay/); assert.match(portalLayout, /maxWidth: 480/); assert.match(portalLayout, /USER_PORTAL_BOTTOM_CONTENT_INSET/); assert.match(nav, /useSafeAreaInsets/); assert.match(nav, /primaryNavButton/); assert.match(nav, /label: 'Add Request'/); assert.doesNotMatch(nav, /floating=\{false\}/);
});
test('Requester form uses keyboard avoidance and safe bottom content space', () => {
  assert.match(form, /KeyboardAvoidingView/); assert.match(form, /USER_PORTAL_LAYOUT\.maxWidth/); assert.match(form, /USER_PORTAL_BOTTOM_CONTENT_INSET/); assert.match(form, /minWidth:0/); assert.match(form, /maxWidth:'100%'/);
});
test('location selection unlocks providers and supports GPS retry or a manual map pin', () => {
  assert.match(form, /rankBranchesByDistance/); assert.match(form, /Choose a delivery location to see nearby BlueTap providers/); assert.match(form, /Delivery location selected/); assert.match(form, /Retry/); assert.match(map, /onLocationChange/);
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
test('Requester dashboard reads the authoritative catalog instead of a client Firestore product listener', () => {
  assert.match(dashboard, /getActiveProducts/);
  assert.match(dashboard, /getActiveProducts\(\{ force: true \}\)/);
  assert.doesNotMatch(dashboard, /subscribeProducts/);
  assert.match(dashboard, /Unable to load products right now/);
  assert.match(dashboard, /Retry/);
});
test('new ordering surfaces use shared BlueTap theme tokens', () => {
  assert.match(form, /BLUETAP_COLORS/); assert.match(productCard, /BLUETAP_COLORS/); assert.match(notifications, /BLUETAP_COLORS/);
});
test('new request uses the same light-default gradient treatment as the Requester dashboard', () => {
  assert.match(form, /LinearGradient/);
  assert.match(form, /colors\.primaryLight/);
  assert.match(form, /backgroundColor:'transparent'/);
});
test('landing, Requester, and Distributor share one persisted light-default theme', () => {
  assert.match(rootLayout, /BlueTapThemeProvider/);
  assert.match(theme, /BLUETAP_THEME_STORAGE_KEY = 'bluetap-theme'/);
  assert.match(theme, /storedTheme === 'dark' \? 'dark' : 'light'/);
  assert.match(theme, /AsyncStorage\.setItem\(BLUETAP_THEME_STORAGE_KEY/);
  assert.match(landing, /useBlueTapTheme/);
  assert.match(header, /ThemeIconButton/);
});
test('shared theme toggle is accessible and follows the landing moon and sun pattern', () => {
  assert.match(themeButton, /Switch to light theme/);
  assert.match(themeButton, /Switch to dark theme/);
  assert.match(themeButton, /accessibilityRole="button"/);
  assert.match(themeButton, /isDark \? '☀' : '☾'/);
});
test('floating portal navigation uses theme tokens while its positioning wrapper stays transparent', () => {
  assert.match(nav, /colors\.navSurface/);
  assert.match(nav, /colors\.navIcon/);
  assert.match(portalShell, /backgroundColor: 'transparent'/);
  assert.doesNotMatch(nav, /useColorScheme/);
});
test('Requester Add Request control remains visibly rendered before and after its route is active', () => {
  assert.match(nav, /primaryAction=\{isPrimaryAction\}/);
  assert.match(nav, /primaryActionIcon/);
  assert.match(nav, /return <Text style=\{styles\.primaryActionIcon\}>\+<\/Text>/);
});
