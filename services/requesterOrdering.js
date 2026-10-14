import { auth } from '../firebase';
import { getApiUrl } from './apiClient';
import { recordTiming, startTiming } from './performanceTiming';

const CACHE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 25_000;

let catalogCache = null;
let catalogCachedAt = 0;
let catalogCacheUid = null;
let catalogRequest = null;

async function requesterRequest(path, { method = 'GET', body, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const reqTiming = startTiming('requester_request', { path, method });
  const tokenStart = Date.now();
  const token = await auth.currentUser?.getIdToken();
  recordTiming('auth_token_retrieval', Date.now() - tokenStart, { path });

  if (!token) throw new Error('Requester authentication is required.');

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const fetchStart = Date.now();
    const response = await fetch(getApiUrl(path), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(controller ? { signal: controller.signal } : {}),
    });
    const networkMs = Date.now() - fetchStart;
    recordTiming('network_roundtrip', networkMs, { status: response.status, path });

    const parseStart = Date.now();
    const result = await response.json().catch(() => null);
    recordTiming('json_parse', Date.now() - parseStart, { path });

    reqTiming.end({
      status: response.status,
      coldStartSuspected: networkMs > 5000,
    });

    if (!response.ok) {
      const error = new Error(result?.error?.message || 'Requester data is temporarily unavailable.');
      error.code = result?.error?.reason || (response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status === 429 ? 'too-many-requests' : 'service-unavailable');
      error.status = response.status;
      throw error;
    }
    return result || {};
  } catch (error) {
    if (error.name === 'AbortError') {
      reqTiming.end({ timedOut: true });
      const timeoutError = new Error('The server is taking longer than expected to respond. Please tap Retry.');
      timeoutError.code = 'timeout';
      throw timeoutError;
    }
    reqTiming.end({ failed: true });
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function invalidateRequesterCatalog() {
  catalogCache = null;
  catalogCachedAt = 0;
  catalogCacheUid = null;
  catalogRequest = null;
}

export function getCachedCatalog() {
  const currentUid = auth?.currentUser?.uid || null;
  if (!catalogCache) return null;
  if (catalogCacheUid && currentUid && catalogCacheUid !== currentUid) {
    invalidateRequesterCatalog();
    return null;
  }
  return catalogCache;
}

export function getCachedActiveProducts() {
  return getCachedCatalog()?.products || null;
}

export function getCachedActiveBranches() {
  return getCachedCatalog()?.branches || null;
}

export async function getRequesterCatalog({ force = false } = {}) {
  const currentUid = auth?.currentUser?.uid || null;

  // Invalidate cache if user identity changed
  if (catalogCache && catalogCacheUid && currentUid && catalogCacheUid !== currentUid) {
    invalidateRequesterCatalog();
  }

  // 1. Fresh cache hit: reuse immediately
  if (!force && catalogCache && Date.now() - catalogCachedAt < CACHE_MS) {
    recordTiming('catalog_cache_hit', 0, { ageMs: Date.now() - catalogCachedAt });
    return catalogCache;
  }

  // 2. In-flight request deduplication: join existing request
  if (catalogRequest) {
    recordTiming('catalog_request_deduplicated', 0);
    return catalogRequest;
  }

  // 3. Launch network fetch
  const currentRequest = (async () => {
    try {
      const catalog = await requesterRequest('/api/requester/catalog');
      catalogCache = catalog;
      catalogCachedAt = Date.now();
      catalogCacheUid = auth?.currentUser?.uid || currentUid;
      return catalog;
    } finally {
      if (catalogRequest === currentRequest) {
        catalogRequest = null;
      }
    }
  })();

  catalogRequest = currentRequest;
  return catalogRequest;
}

export const getActiveBranches = async (options) => (await getRequesterCatalog(options)).branches || [];
export const getActiveProducts = async (options) => (await getRequesterCatalog(options)).products || [];
export const getProductsForBranch = async (branchId, options) => {
  const products = await getActiveProducts(options);
  return products.filter((product) => !product.branchIds?.length || product.branchIds.includes(branchId));
};
export const createRequesterOrder = async (payload) => (await requesterRequest('/api/requester/orders', { method: 'POST', body: payload })).order;
export const updateRequesterOrder = async (orderId, updates = {}) => (await requesterRequest('/api/requester/orders', { method: 'PATCH', body: { orderId, action: 'edit-order', ...updates } })).order;
export const cancelRequesterOrder = async (orderId) => (await requesterRequest('/api/requester/orders', { method: 'PATCH', body: { orderId } })).order;
export const getRequesterOrders = async () => (await requesterRequest('/api/requester/orders')).orders || [];
