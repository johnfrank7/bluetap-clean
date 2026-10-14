const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (...parts) => readFileSync(resolve(root, ...parts), 'utf8');

test('requesterOrdering exports synchronous cache accessors and bound cache invalidation', () => {
  const source = read('services', 'requesterOrdering.js');

  assert.match(source, /export function getCachedCatalog/);
  assert.match(source, /export function getCachedActiveProducts/);
  assert.match(source, /export function getCachedActiveBranches/);
  assert.match(source, /export function invalidateRequesterCatalog/);
  assert.match(source, /catalogCacheUid/);
  assert.match(source, /REQUEST_TIMEOUT_MS = 25_000/);
});

test('requesterOrdering deduplicates concurrent catalog requests and isolates user caches', async () => {
  const source = read('services', 'requesterOrdering.js');

  // Verify deduplication logic: returns in-flight promise if active
  assert.match(source, /if \(catalogRequest\) \{\s*recordTiming\('catalog_request_deduplicated'/);
  assert.match(source, /catalogRequest = currentRequest/);
  assert.match(source, /if \(catalogRequest === currentRequest\) \{\s*catalogRequest = null;\s*\}/);

  // Verify user isolation logic: checks currentUser against cache UID
  assert.match(source, /if \(catalogCache && catalogCacheUid && currentUid && catalogCacheUid !== currentUid\) \{\s*invalidateRequesterCatalog\(\);\s*\}/);
  assert.match(source, /catalogCacheUid = auth\?\.currentUser\?\.uid \|\| currentUid/);
});

test('requester dashboard initializes from cache and avoids forced reload on ordinary navigation', () => {
  const dashboard = read('app', 'requester', 'r_dashboard.jsx');

  // Products state initializes from getCachedActiveProducts
  assert.match(dashboard, /const \[products, setProducts\] = useState\(\(\) => getCachedActiveProducts\(\) \|\| \[\]\)/);
  assert.match(dashboard, /const \[productsLoading, setProductsLoading\] = useState\(\(\) => !\(getCachedActiveProducts\(\)\?\.length > 0\)\)/);

  // Routine auth / mount does NOT pass force: true
  assert.match(dashboard, /getActiveProducts\(\)\s*\.then/);

  // Forced refresh is only invoked when explicitly requested (e.g. Retry button)
  assert.match(dashboard, /force\s*\?\s*await getActiveProducts\(\{ force: true \}\)\s*:\s*await getActiveProducts\(\)/);

  // Background refresh failure does not destroy already displayed products
  assert.match(dashboard, /if \(!current \|\| current\.length === 0\) \{\s*setProductsError/);
});

test('requester request form initializes from getCachedCatalog to eliminate blocking spinner', () => {
  const form = read('app', 'requester', 'requestform.jsx');

  // Form state initializes synchronously from getCachedCatalog
  assert.match(form, /const \[catalog, setCatalog\] = React\.useState\(\(\) => getCachedCatalog\(\)\)/);
  assert.match(form, /const \[loading, setLoading\] = React\.useState\(\(\) => !getCachedCatalog\(\)\)/);

  // load() skips full-screen loader when cache is already present
  assert.match(form, /if \(force \|\| !getCachedCatalog\(\)\) \{\s*setLoading\(true\);\s*\}/);

  // Background load error does not clear active form if cache is present
  assert.match(form, /if \(!getCachedCatalog\(\)\) \{\s*setLoadError/);
});

test('RoleDataProviders initializes branches from cache and reuses catalog query', () => {
  const providers = read('components', 'RoleDataProviders.jsx');

  assert.match(providers, /getCachedActiveBranches/);
  assert.match(providers, /setBranches\(Array\.isArray\(items\) \? items : \[\]\)/);
});

test('performance timing logger instruments request duration safely without leaking sensitive data', () => {
  const timing = read('services', 'performanceTiming.js');
  const ordering = read('services', 'requesterOrdering.js');

  assert.match(timing, /SENSITIVE_KEY_PATTERN = \/token\|auth\|secret\|password\|email\|phone\|address\|credential\/i/);
  assert.match(timing, /export function recordTiming/);
  assert.match(timing, /export function startTiming/);

  assert.match(ordering, /recordTiming\('auth_token_retrieval'/);
  assert.match(ordering, /recordTiming\('network_roundtrip'/);
  assert.match(ordering, /recordTiming\('json_parse'/);
  assert.match(ordering, /recordTiming\('catalog_cache_hit'/);
});
