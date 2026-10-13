import { getAppEnv, isKnownProductionBackendHost, APP_ENVIRONMENTS } from './appEnv.js';

const DEFAULT_BACKEND_BASE_URL = 'https://bluetap-clean.onrender.com';

function normalizeBackendBaseUrl(value, currentEnv = getAppEnv()) {
  try {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const url = new URL(raw);
    const localDevelopment = ['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:';
    if (url.protocol !== 'https:' && !localDevelopment) return '';
    if (url.username || url.password || url.search || url.hash) return '';
    if (url.hostname.endsWith('.vercel.app')) return '';
    // Clients talk to the BlueTap Node API, never to its protected face recognition dependency.
    if (url.hostname === 'bluetap-face-api.onrender.com') return '';

    // Staging guard: Staging must never target production backend host
    if (currentEnv === APP_ENVIRONMENTS.STAGING && isKnownProductionBackendHost(url.hostname)) {
      return '';
    }

    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export const getApiBaseUrl = (env = null) => {
  const currentEnv = getAppEnv(env);

  const customApiUrl = (env && env.EXPO_PUBLIC_API_BASE_URL !== undefined)
    ? env.EXPO_PUBLIC_API_BASE_URL
    : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_API_BASE_URL : undefined);

  if (currentEnv === APP_ENVIRONMENTS.STAGING) {
    const rawUrl = String(customApiUrl || '').trim();
    if (!rawUrl) {
      throw new Error('[BlueTap] Staging backend API URL is not configured (EXPO_PUBLIC_API_BASE_URL is required).');
    }
    if (isKnownProductionBackendHost(rawUrl)) {
      throw new Error('[BlueTap] Security violation: Staging client cannot connect to production backend URL.');
    }
    const normalized = normalizeBackendBaseUrl(rawUrl, currentEnv);
    if (!normalized) {
      throw new Error('[BlueTap] Staging backend API URL is invalid.');
    }
    return normalized;
  }

  // Development / Production
  const configured = normalizeBackendBaseUrl(customApiUrl, currentEnv);
  if (configured) return configured;

  if (currentEnv === APP_ENVIRONMENTS.DEVELOPMENT) {
    return 'http://localhost:3000';
  }

  // Production backward compatibility
  return DEFAULT_BACKEND_BASE_URL;
};

export function getApiUrl(path, createUnavailableError) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    throw typeof createUnavailableError === 'function'
      ? createUnavailableError()
      : new Error('The BlueTap API route is invalid.');
  }
  return `${getApiBaseUrl()}${path}`;
}

export { DEFAULT_BACKEND_BASE_URL, normalizeBackendBaseUrl };
