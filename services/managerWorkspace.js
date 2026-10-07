import { auth } from '../firebase';
import { getApiUrl } from './apiClient';
import { ADMIN_CACHE_KEYS, invalidateAdminData } from './adminDataCache';
import { invalidateRequesterCatalog } from './requesterOrdering';

export async function getManagerWorkspace() {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Manager authentication is required.');
  const response = await fetch(getApiUrl('/api/manager/workspace'), { headers: { Authorization: `Bearer ${token}` } });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Manager workspace data is temporarily unavailable.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  return result || {};
}

export async function updateManagerProductPolicy(productId, policy) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Manager authentication is required.');
  const response = await fetch(getApiUrl('/api/manager/workspace'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'updateProductPolicy', productId, ...policy }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message || 'Unable to save branch delivery rules.');
  return result;
}

export async function approveManagerDistributor(distributorUid) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Manager authentication is required.');
  const response = await fetch(getApiUrl('/api/manager/workspace'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approveDistributor', distributorUid }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Unable to approve this Distributor application.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  invalidateAdminData(ADMIN_CACHE_KEYS.distributors, ADMIN_CACHE_KEYS.dashboard);
  return result;
}

export async function rejectManagerDistributor(distributorUid, rejectionReason = '') {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Manager authentication is required.');
  const response = await fetch(getApiUrl('/api/manager/workspace'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'rejectDistributor', distributorUid, reason: rejectionReason }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Unable to reject this Distributor application.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  invalidateAdminData(ADMIN_CACHE_KEYS.distributors, ADMIN_CACHE_KEYS.dashboard);
  return result;
}

export async function updateManagerDeliveryPricing(pricing) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Manager authentication is required.');
  const response = await fetch(getApiUrl('/api/manager/workspace'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'updateDeliveryPricing', ...pricing }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Unable to update branch delivery pricing.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  invalidateAdminData(ADMIN_CACHE_KEYS.branches, ADMIN_CACHE_KEYS.dashboard);
  invalidateRequesterCatalog();
  return result;
}

export async function suspendManagerBranchUser(targetUid, reasonOrOptions) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Manager authentication is required.');
  const payload = typeof reasonOrOptions === 'object' && reasonOrOptions !== null
    ? { action: 'suspendBranchUser', targetUid, ...reasonOrOptions }
    : { action: 'suspendBranchUser', targetUid, reason: reasonOrOptions };
  const response = await fetch(getApiUrl('/api/manager/workspace'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Unable to suspend user from branch.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  return result;
}

export async function restoreManagerBranchUser(targetUid, reason) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Manager authentication is required.');
  const response = await fetch(getApiUrl('/api/manager/workspace'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'restoreBranchUser', targetUid, reason }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Unable to restore branch access.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  return result;
}
