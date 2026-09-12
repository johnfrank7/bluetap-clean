// Platform-specific modules supply the URL policy. This generic fallback keeps
// server-side tooling on same-origin routes without reading public API config.
export const getApiBaseUrl = () => '';

export function getApiUrl(path) {
  return path;
}
