import { auth } from '../firebase';
import { getApiUrl } from './apiClient';

export async function recoverTrustedProfile() {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in is required.');
  const response = await fetch(getApiUrl('/api/auth/request-email-otp'), {
    method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken(true)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'recover-profile' }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || 'Account recovery is unavailable.');
  return data;
}
