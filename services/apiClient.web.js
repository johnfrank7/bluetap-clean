// Web requests must remain same-origin so Vercel's API routes proxy protected
// face-verification traffic. Do not read EXPO_PUBLIC_API_BASE_URL here: it may
// be configured for native builds and must never redirect browser traffic.
export const getApiBaseUrl = () => '';

export function getApiUrl(path) {
  return path;
}
