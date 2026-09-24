import { auth } from '../firebase';
import { getApiUrl } from './apiClient';

export async function getAdminOverrideDetails(orderId) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Administrator authentication is required.');
  const response = await fetch(getApiUrl(`/api/admin/dispatch-override?orderId=${encodeURIComponent(orderId)}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Override details are unavailable.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  return result;
}

export async function submitAdminOverrideAssignment(orderId, distributorUid, scheduledAt) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Administrator authentication is required.');
  const response = await fetch(getApiUrl('/api/admin/dispatch-override'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, distributorUid, scheduledAt }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Admin override failed.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  return result;
}

