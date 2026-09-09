import { Platform } from 'react-native';

const apiUrl = (path) => {
  const configured = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
  const base = Platform.OS === 'web' ? (__DEV__ ? configured : '') : configured;
  if (Platform.OS !== 'web' && !base) throw new Error('Login service is unavailable in this app build.');
  return `${base}${path}`;
};

const call = async (path, body) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.error?.message || 'The authentication service is unavailable.');
      error.code = `username/${data?.error?.reason || 'service-unavailable'}`;
      throw error;
    }
    return data;
  } catch (error) {
    if (String(error.code || '').startsWith('username/')) throw error;
    const network = new Error('We could not reach the authentication service. Check your connection and try again.');
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
export const loginWithUsername = async (username, password) => {
  const result = await call('/api/auth/login-with-username', { username, password });
  if (typeof result.customToken !== 'string') throw new Error('The login service returned an invalid response.');
  return result.customToken;
};
