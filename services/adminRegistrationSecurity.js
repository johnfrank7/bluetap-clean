import { auth } from '../firebase';
import { getApiUrl } from './apiClient';

async function request(method, body) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Administrator authentication is required.');
  const response = await fetch(getApiUrl('/api/admin/registration-security'), {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Registration security settings are unavailable.');
    error.code = result?.error?.reason;
    throw error;
  }
  return result;
}
export const getRegistrationSecurity = () => request('GET');
export const updateRegistrationSecurity = (settings) => request('PATCH', settings);
