import { auth } from '../firebase';
import { getApiUrl } from './apiClient';

const CACHE_MS = 30_000;
let catalogCache = null;
let catalogCachedAt = 0;
let catalogRequest = null;

async function requesterRequest(path, { method = 'GET', body } = {}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Requester authentication is required.');
  const response = await fetch(getApiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Requester data is temporarily unavailable.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  return result || {};
}

export function invalidateRequesterCatalog() {
  catalogCache = null;
  catalogCachedAt = 0;
}

export async function getRequesterCatalog({ force = false } = {}) {
  if (!force && catalogCache && Date.now() - catalogCachedAt < CACHE_MS) return catalogCache;
  if (!force && catalogRequest) return catalogRequest;
  catalogRequest = requesterRequest('/api/requester/catalog').then((catalog) => {
    catalogCache = catalog;
    catalogCachedAt = Date.now();
    return catalog;
  }).finally(() => { catalogRequest = null; });
  return catalogRequest;
}

export const getActiveBranches = async (options) => (await getRequesterCatalog(options)).branches || [];
export const getActiveProducts = async (options) => (await getRequesterCatalog(options)).products || [];
export const getProductsForBranch = async (branchId, options) => {
  const products = await getActiveProducts(options);
  return products.filter((product) => !product.branchIds?.length || product.branchIds.includes(branchId));
};
export const createRequesterOrder = async (payload) => (await requesterRequest('/api/requester/orders', { method: 'POST', body: payload })).order;
export const cancelRequesterOrder = async (orderId) => (await requesterRequest('/api/requester/orders', { method: 'PATCH', body: { orderId } })).order;
export const getRequesterOrders = async () => (await requesterRequest('/api/requester/orders')).orders || [];

