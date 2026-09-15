import { getApiUrl } from './apiClient';

const call = async (path, body) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(getApiUrl(path, () => new Error('Login service is unavailable in this app build.')), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.error?.message || 'The authentication service is unavailable.');
      error.code = data?.error?.code || `username/${data?.error?.reason || 'service-unavailable'}`;
      error.authenticationServiceError = true;
      throw error;
    }
    if (!data || typeof data !== 'object') {
      const error = new Error('The authentication service returned an invalid response.');
      error.code = 'username/service-unavailable';
      throw error;
    }
    return data;
  } catch (error) {
    if (error.authenticationServiceError || String(error.code || '').startsWith('username/')) throw error;
    const network = new Error('We could not reach the authentication service. Please try again.');
    network.code = 'username/network';
    throw network;
  } finally {
    clearTimeout(timeout);
  }
};

export const normalizeUsername = (value) => value.trim().toLowerCase();
export const validateUsername = (value) => {
  const trimmed = value.trim();
  if (trimmed.length < 4 || trimmed.length > 20) return 'Username must be 4–20 characters.';
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) return 'Only letters, numbers, and underscores are allowed.';
  return '';
};
export const checkUsername = async (username) => call('/api/auth/check-username', { username });
export const loginWithUsername = async (username, password, { portal = 'public' } = {}) => {
  const result = await call('/api/auth/login-with-username', { username, password, portal });
  if (typeof result?.customToken !== 'string' || !result.customToken) {
    const error = new Error('The login service returned an invalid response.');
    error.code = 'username/service-unavailable';
    throw error;
  }
  return result.customToken;
};
