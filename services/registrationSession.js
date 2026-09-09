import { Platform } from 'react-native';

const apiUrl = (path) => {
  const configured = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
  const base = Platform.OS === 'web' ? (__DEV__ ? configured : '') : configured;
  if (Platform.OS !== 'web' && !base) throw new Error('Registration verification is unavailable in this app build.');
  return `${base}${path}`;
};

export const callRegistrationApi = async (path, body, timeoutMs = 30000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : null;
    if (!response.ok) {
      const error = new Error(data?.error?.message || 'Registration verification is temporarily unavailable.');
      error.code = `registration/${data?.error?.reason || 'service-unavailable'}`;
      throw error;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      const error = new Error('The registration service update is not available yet. Please deploy the latest BlueTap version and try again.');
      error.code = 'registration/invalid-response';
      throw error;
    }
    return data;
  } catch (error) {
    if (String(error.code || '').startsWith('registration/')) throw error;
    const network = new Error('We could not reach the registration verification service.');
    network.code = 'registration/network';
    throw network;
  } finally { clearTimeout(timeout); }
};

export const createRegistrationSession = async (personalInfo) => {
  const result = await callRegistrationApi('/api/auth/create-registration-session', personalInfo);
  if (typeof result.registrationSessionId !== 'string' || !result.registrationSessionId) {
    const error = new Error('The registration service returned an incomplete response. Please try again.');
    error.code = 'registration/invalid-response';
    throw error;
  }
  return result;
};
export const getRegistrationSessionStatus = (registrationSessionId) => callRegistrationApi('/api/auth/registration-session-status', { registrationSessionId });
export const acceptRegistrationTerms = (registrationSessionId) => callRegistrationApi('/api/auth/accept-registration-terms', { registrationSessionId });
