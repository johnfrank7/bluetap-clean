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
