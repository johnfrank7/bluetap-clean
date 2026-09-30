import { auth } from '../firebase';
import { getApiUrl } from './apiClient';

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
  return result;
}
