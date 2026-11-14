import { getApiUrl } from './apiClientConfig';

const PRODUCTION_BACKEND_HOSTS = ['bluetap-clean.onrender.com', 'bluetap-backend.onrender.com'];
const STAGING_BACKEND_HOST = 'bluetap-staging-backend.onrender.com';

function passwordChangeUrl(user) {
  const local = process.env.EXPO_PUBLIC_LOCAL_PASSWORD_CHANGE_URL;
  const development = typeof __DEV__ !== 'undefined' && __DEV__ === true;
  const host = String(globalThis.location?.hostname || '').toLowerCase();
  const projectId = String(user?.auth?.app?.options?.projectId || '').trim();
  if (!local) {
    const url = getApiUrl('/api/auth/password-change-otp');
    let targetHost = '';
    try {
      targetHost = new URL(url).hostname.toLowerCase();
    } catch {
      throw new Error('The password change service URL is invalid.');
    }
    const isStagingSession =
      projectId === 'bluetap-staging' ||
      process.env.EXPO_PUBLIC_APP_ENV === 'staging' ||
      process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID === 'bluetap-staging' ||
      host === 'bluetap-staging-web.vercel.app';
    if (isStagingSession && PRODUCTION_BACKEND_HOSTS.includes(targetHost)) {
      throw new Error('Staging sessions cannot route password change requests to the production backend.');
    }
    if (!isStagingSession && targetHost === STAGING_BACKEND_HOST) {
      throw new Error('Production sessions cannot route password change requests to the staging backend.');
    }
    return url;
  }
  if (!development || local !== 'http://127.0.0.1:3001' ||
      !['localhost', '127.0.0.1'].includes(host) ||
      projectId !== 'bluetap-8c98d' || user?.auth?.config?.emulator) {
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
