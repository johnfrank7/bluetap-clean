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
