const DEFAULT_BACKEND_BASE_URL = 'https://bluetap-clean.onrender.com';

function normalizeBackendBaseUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const localDevelopment = ['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:';
    if (url.protocol !== 'https:' && !localDevelopment) return '';
    if (url.username || url.password || url.search || url.hash) return '';
    if (url.hostname.endsWith('.vercel.app')) return '';
    // Clients talk to the BlueTap Node API, never to its protected face
    // recognition dependency.
    if (url.hostname === 'bluetap-face-api.onrender.com') return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export const getApiBaseUrl = () => normalizeBackendBaseUrl(
  process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_BACKEND_BASE_URL
) || DEFAULT_BACKEND_BASE_URL;

export function getApiUrl(path, createUnavailableError) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    throw typeof createUnavailableError === 'function'
      ? createUnavailableError()
      : new Error('The BlueTap API route is invalid.');
  }
  return `${getApiBaseUrl()}${path}`;
}

export { DEFAULT_BACKEND_BASE_URL, normalizeBackendBaseUrl };
