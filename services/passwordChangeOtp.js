import { getApiUrl } from './apiClientConfig';

function passwordChangeUrl(user) {
  const local = process.env.EXPO_PUBLIC_LOCAL_PASSWORD_CHANGE_URL;
  if (!local) return getApiUrl('/api/auth/password-change-otp');
  const development = typeof __DEV__ !== 'undefined' && __DEV__ === true;
  const host = String(globalThis.location?.hostname || '').toLowerCase();
  if (!development || local !== 'http://127.0.0.1:3001' ||
      !['localhost', '127.0.0.1'].includes(host) ||
      user?.auth?.app?.options?.projectId !== 'bluetap-8c98d' || user?.auth?.config?.emulator) {
    throw new Error('The local password change service is not safely configured.');
  }
  return `${local}/api/auth/password-change-otp`;
}

export async function passwordChangeOtp(user, action, payload = {}) {
  if (!user) throw new Error('Sign in again before changing your password.');
  const url = passwordChangeUrl(user);
  const token = await user.getIdToken(action === 'request');
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new Error(action === 'confirm'
      ? 'Password change could not be confirmed. Sign in with your new password or contact support.'
      : 'Could not reach the password change service. Check the backend connection and try again.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 404
      ? 'Password change service was not found. Check the backend URL and restart an up-to-date backend.'
      : result?.error?.reason === 'MAIL_PROVIDER_CONFIG_MISSING'
        ? 'Password change email is unavailable. Ask your administrator to configure the mail service.'
        : result?.error?.message || 'Password change could not be confirmed.';
    const error = new Error(message);
    error.code = result?.error?.reason || 'PASSWORD_CHANGE_FAILED';
    throw error;
  }
  return result;
}
