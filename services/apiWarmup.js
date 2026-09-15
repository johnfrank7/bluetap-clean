import { getApiBaseUrl, getApiUrl } from './apiClient';
const { faceServiceWarmupStore } = require('./faceServiceWarmupStore');

const warmed = new Set();
const inFlight = new Map();
let facePrewarmInFlight = null;

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
export const warmFaceServiceForSignup = () => {
  if (facePrewarmInFlight) return facePrewarmInFlight;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  facePrewarmInFlight = fetch(getApiUrl('/api/verification/warm-face-service'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal,
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    const status = data?.status === 'ready' ? 'ready' : data?.status === 'not_required' ? 'not_required' : 'starting';
    faceServiceWarmupStore.publishPrewarm(status);
    console.info('[client-warmup]', { stage: `SIGNUP_FACE_PREWARM_${status === 'ready' ? 'READY' : 'ACCEPTED'}`, durationMs: Date.now() - startedAt });
    return { ready: status === 'ready', status };
  }).catch(() => {
    faceServiceWarmupStore.publishPrewarm('starting');
    return { ready: false, status: 'starting' };
  }).finally(() => {
    clearTimeout(timeout);
    facePrewarmInFlight = null;
  });
  return facePrewarmInFlight;
};
