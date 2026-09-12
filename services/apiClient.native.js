const DEFAULT_NATIVE_API_BASE_URL = 'https://bluetap-beta.vercel.app';

function isAllowedNativeApiBaseUrl(value) {
  try {
    const url = new URL(value);
    // The face service is an upstream dependency of Vercel, never a public
    // client endpoint. Allow a future HTTPS BlueTap domain but reject Render.
    return url.protocol === 'https:' && !url.hostname.endsWith('.onrender.com');
  } catch {
    return false;
  }
}

export const getApiBaseUrl = () => {
  const configured = (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim().replace(/\/+$/, '');
  return isAllowedNativeApiBaseUrl(configured) ? configured : DEFAULT_NATIVE_API_BASE_URL;
};

export function getApiUrl(path, createUnavailableError) {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw typeof createUnavailableError === 'function'
      ? createUnavailableError()
      : new Error('The BlueTap API is unavailable in this app build.');
  }
  return `${baseUrl}${path}`;
}
