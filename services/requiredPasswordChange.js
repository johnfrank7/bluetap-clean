import { auth } from '../firebase';
import { getApiUrl } from './apiClientConfig';

export async function completeRequiredPasswordChange(newPassword) {
  const token = await auth.currentUser?.getIdToken(true);
  if (!token) throw new Error('Sign in again before changing your password.');
  const response = await fetch(getApiUrl('/api/auth/complete-required-password-change'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'The password could not be changed.');
    error.code = payload?.error?.reason || 'PASSWORD_CHANGE_FAILED';
    throw error;
  }
  return payload;
}
