const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '..', '..', '..');
const read = (...parts) => readFileSync(resolve(root, ...parts), 'utf8');

test('Admin data requests reuse the SDK token and a deduplicated 45-second cache', () => {
  const api = read('services', 'adminApi.js');
  const cache = read('services', 'adminDataCache.js');
  const branchService = read('services', 'branchManagement.js');
  assert.match(api, /getIdToken\(\)/);
  assert.doesNotMatch(api + branchService, /getIdToken\(true\)/);
  assert.match(api, /getRequests\.has/);
  assert.match(cache, /ADMIN_CACHE_STALE_MS = 45_000/);
  assert.match(cache, /ADMIN_DATA_REQUEST_DEDUPED/);
  assert.match(cache, /requestId\.current/);
  assert.match(cache, /generation/);
});

test('Admin pages keep their shell and local skeletons visible while data loads', () => {
  const dashboard = read('app', 'admin', 'dashboard.jsx');
  assert.doesNotMatch(dashboard, /Loading administration overview/);
  assert.match(dashboard, /getAdminDashboardOverview/);
  assert.match(dashboard, /CardSkeleton/);
  for (const page of ['branches.jsx', 'managers.jsx', 'distributors.jsx', 'registration-security.jsx']) {
    const source = read('app', 'admin', page);
    assert.match(source, /useAdminData/);
    assert.match(source, /Skeleton/);
  }
  const layout = read('app', 'admin', '_layout.jsx');
  assert.match(layout, /loadingFallback/);
  assert.match(layout, /AdminRouteSkeleton/);
});

test('Admin auth, prefetch, and warmup paths are deduplicated and non-blocking', () => {
  const session = read('services', 'authSession.js');
  const prefetch = read('services', 'adminPrefetch.js');
  const shell = read('components', 'AdminShell.jsx');
  assert.match(session, /ADMIN_AUTH_VALIDATION_DEDUPED/);
  assert.match(session, /ADMIN_AUTH_CACHE_HIT/);
  assert.match(prefetch, /requestIdleCallback/);
  assert.match(shell, /prefetchAdminDestination/);
  assert.match(shell, /warmAdminBackend/);
});

test('Admin route consumers share one persistent bounded requests listener', () => {
  const provider = read('components', 'AdminDataProvider.jsx');
  const layout = read('app', 'admin', '_layout.jsx');
  const shell = read('components', 'AdminShell.jsx');
  const requests = read('app', 'admin', 'requests.jsx');
  const analytics = read('app', 'admin', 'analytics.jsx');
  assert.match(layout, /<AdminDataProvider>/);
  assert.match(provider, /onAuthStateChanged/);
  assert.match(provider, /onSnapshot/);
  assert.match(provider, /orderBy\('createdAt', 'desc'\)/);
  assert.match(provider, /limit\(ADMIN_REQUEST_REALTIME_LIMIT\)/);
  assert.match(provider, /ADMIN_REQUEST_REALTIME_LIMIT = 500/);
  assert.match(provider, /unsubscribeRequests\(\)/);
  assert.match(shell, /useAdminRealtimeData/);
  assert.match(requests, /useAdminRealtimeData/);
  assert.match(analytics, /useAdminRealtimeData/);
  assert.doesNotMatch(shell + requests + analytics, /\bonSnapshot\s*\(/);
});

test('Admin refresh preserves resolved data and account changes clear realtime state', () => {
  const cache = read('services', 'adminDataCache.js');
  const provider = read('components', 'AdminDataProvider.jsx');
  const auth = read('services', 'authSession.js');
  assert.match(cache, /loading: current\.data === undefined/);
  assert.match(cache, /refreshing: current\.data !== undefined/);
  assert.match(provider, /uid === current\.uid[\s\S]*requests: \[\]/);
  assert.match(auth, /clearAdminDataCache\(\)/);
});

test('Admin analytics uses the bounded shared snapshot and renders sections progressively', () => {
  const analytics = read('app', 'admin', 'analytics.jsx');
  assert.match(analytics, /Recent 500/);
  assert.match(analytics, /loadingRequests && requests\.length === 0/);
  assert.match(analytics, /stationLoading && stationBreakdown\.length === 0/);
  assert.doesNotMatch(analytics, /collection\(db, 'requests'\)/);
});

test('Admin product metadata renders independently from cached image loading', () => {
  const products = read('app', 'admin', 'products.jsx');
  assert.match(products, /from 'expo-image'/);
  assert.match(products, /cachePolicy="memory-disk"/);
  assert.match(products, /contentFit="contain"/);
  assert.match(products, /product\.product_name/);
});

test('performance timing instrumentation is development-only', () => {
  const logger = read('services', 'performanceLog.js');
  const backendLogger = read('backend', 'utils', 'performanceLog.js');
  const api = read('services', 'adminApi.js');
  assert.match(logger, /NODE_ENV === 'development'/);
  assert.match(backendLogger, /NODE_ENV === 'development'/);
  assert.match(api, /logDevelopmentTiming/);
  assert.doesNotMatch(api, /console\.info/);
});
