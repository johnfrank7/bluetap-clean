// Cache only a server's explicit missing-route response, never a missing record.
const retryAfterMs = 5 * 60 * 1000;
const memory = new Map();
const keyFor = (url) => `bluetap:missing-endpoint:${url.split('?')[0]}`;

export function missingEndpointError(url) {
  const key = keyFor(url);
  let until = memory.get(key) || 0;
  try { until = Math.max(until, Number(globalThis.sessionStorage?.getItem(key)) || 0); } catch {}
  if (until <= Date.now()) return null;
  const error = new Error('Delivery updates are unavailable on the current server. Please try again later.');
  error.code = 'ENDPOINT_UNAVAILABLE';
  error.status = 404;
  return error;
}

export function rememberMissingEndpoint(url, status, result) {
  if (status !== 404 || result?.error?.reason !== 'not-found') return;
  const key = keyFor(url);
  const until = Date.now() + retryAfterMs;
  memory.set(key, until);
  try { globalThis.sessionStorage?.setItem(key, String(until)); } catch {}
}
