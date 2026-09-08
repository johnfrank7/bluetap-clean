import { Platform } from 'react-native';
import { auth } from '../firebaseAuth';

const apiError = (reason, message, details = {}) => {
  const error = new Error(message);
  error.code = `otp/${reason}`;
  error.details = { ...details, reason };
  return error;
};

function apiUrl(path) {
  // A public URL, never a secret. Deployed web always uses its own origin.
  const configured = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
  const base = Platform.OS === 'web' ? (__DEV__ ? configured : '') : configured;
  if (Platform.OS !== 'web' && !base) {
    throw apiError('service-unavailable', 'The email verification service is not available in this app build.');
  }
  return `${base}${path}`;
}

async function callOtp(path, body = {}) {
  const account = auth.currentUser;
  if (!account) throw apiError('unauthenticated', 'Please log in again.');
  const token = await account.getIdToken();
  const url = apiUrl(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = data?.error;
      throw apiError(
        response.status === 401 ? 'unauthenticated' : error?.reason || 'service-unavailable',
        error?.message || 'The email verification service is currently unavailable.',
        error || {}
      );
    }
    if (!data || typeof data !== 'object' || auth.currentUser?.uid !== account.uid) {
      throw apiError('service-unavailable', 'We could not confirm your email verification request.');
    }
    return data;
  } catch (error) {
    if (error.details) throw error;
    throw apiError('network', 'We could not reach the verification service. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
  }
}

export const requestEmailOtp = async () => {
  const data = await callOtp('/api/auth/request-email-otp');
  if (data.alreadyVerified !== true && !(Number(data.expiresAt) > 0)) {
    throw apiError('service-unavailable', 'The email verification service returned an invalid response.');
  }
  return data;
};

export const verifyEmailOtp = async (code) => {
  const data = await callOtp('/api/auth/verify-email-otp', { code });
  if (data.verified !== true) {
    throw apiError('service-unavailable', 'We could not confirm your email verification.');
  }
  return data;
};
