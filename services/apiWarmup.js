import { getApiBaseUrl, getApiUrl } from './apiClient';

const warmed = new Set();
const inFlight = new Map();

function warm(path, stage, requestUrl = () => getApiUrl(path)) {
  if (warmed.has(path)) return Promise.resolve({ reused: true });
  if (inFlight.has(path)) return inFlight.get(path);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const request = fetch(requestUrl(), {
    method: path === '/health' ? 'GET' : 'POST',
    ...(path === '/health' ? {} : { headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    signal: controller.signal,
  }).then((response) => {
    if (response.ok) warmed.add(path);
    console.info('[client-warmup]', { stage: `${stage}_${response.ok ? 'READY' : 'PENDING'}`, durationMs: Date.now() - startedAt });
    return { ready: response.ok };
  }).catch(() => ({ ready: false })).finally(() => {
    clearTimeout(timeout);
    inFlight.delete(path);
  });
  inFlight.set(path, request);
  return request;
}

export const warmLoginBackend = () => warm('/health', 'LOGIN_PAGE_BACKEND_WARMUP', () => `${getApiBaseUrl()}/health`);
export const warmFaceServiceForSignup = () => warm('/api/verification/warm-face-service', 'SIGNUP_FACE_PREWARM');
