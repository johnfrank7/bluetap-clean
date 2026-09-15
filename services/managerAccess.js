import { auth } from '../firebase';
import { getApiUrl } from './apiClient';

export async function getManagerContext() {
  // PrivilegedLogin already performed the one forced refresh needed for
  // newly assigned claims. Manager context only needs the current token.
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    const error = new Error('Manager authentication is required.');
    error.code = 'AUTHENTICATION_REQUIRED';
    throw error;
  }
  const response = await fetch(getApiUrl('/api/manager/context'), { headers: { Authorization: `Bearer ${token}` } });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Manager access is unavailable.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  return result;
}
