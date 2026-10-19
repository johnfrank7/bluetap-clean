import { getApiBaseUrl, getApiUrl } from './apiClient';

const LOGIN_REQUEST_TIMEOUT_MS = 30_000;
const READINESS_TIMEOUT_MS = 30_000;
const READINESS_POLL_INTERVAL_MS = 2_000;
const randomAttemptPart = () => Math.random().toString(36).slice(2).padEnd(12, '0');
const createLoginAttemptId = () => `${Date.now().toString(36)}_${randomAttemptPart()}_${randomAttemptPart()}`;

const wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

async function checkBackendReadiness(timeoutMs = 5_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getApiBaseUrl()}/health`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForBackendReadiness({ timeoutMs = READINESS_TIMEOUT_MS, pollIntervalMs = READINESS_POLL_INTERVAL_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (await checkBackendReadiness(Math.min(5_000, remaining))) return true;
    const afterCheckRemaining = deadline - Date.now();
    if (afterCheckRemaining <= 0) break;
    await wait(Math.min(pollIntervalMs, afterCheckRemaining));
  }
  return false;
}

const call = async (path, body) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOGIN_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(getApiUrl(path, () => new Error('Login service is unavailable in this app build.')), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.error?.message || data?.message || 'The authentication service is unavailable.');
      error.code = data?.error?.code || data?.code || `username/${data?.error?.reason || 'service-unavailable'}`;
      error.reason = data?.error?.reason || data?.reason;
      if (data?.error?.retryAfterSeconds != null || data?.retryAfterSeconds != null) {
        error.retryAfterSeconds = Number(data?.error?.retryAfterSeconds ?? data?.retryAfterSeconds);
      }
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
    network.cause = error;
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
export const loginWithUsernameResult = async (username, password, {
  portal = 'public',
  onConnectionWait,
  readinessTimeoutMs = READINESS_TIMEOUT_MS,
  readinessPollIntervalMs = READINESS_POLL_INTERVAL_MS,
} = {}) => {
  const body = { username, password, portal, attemptId: createLoginAttemptId() };
  let result;
  try {
    result = await call('/api/auth/login-with-username', body);
  } catch (error) {
    if (error?.code !== 'username/network') throw error;
    onConnectionWait?.(true);
    try {
      await waitForBackendReadiness({
        timeoutMs: readinessTimeoutMs,
        pollIntervalMs: readinessPollIntervalMs,
      });
      // The username endpoint validates the password and account state on every
      // request. Retry once only after a transport failure and bounded readiness
      // wait. A blocked health probe is inconclusive, so the sign-in endpoint
      // gets one final chance even when /health never responds.
      result = await call('/api/auth/login-with-username', body);
    } catch (retryError) {
      if (retryError?.code === 'username/network') {
        const unavailable = new Error('Unable to connect to BlueTap. Please try again.');
        unavailable.code = 'username/connection-unavailable';
        throw unavailable;
      }
      throw retryError;
    } finally {
      onConnectionWait?.(false);
    }
  }
  if (typeof result?.customToken !== 'string' || !result.customToken) {
    const error = new Error('The login service returned an invalid response.');
    error.code = 'username/service-unavailable';
    throw error;
  }
  return result;
};
export const loginWithUsername = async (username, password, options) => (await loginWithUsernameResult(username, password, options)).customToken;

export { waitForBackendReadiness };
