import { getApiBaseUrl, getApiUrl } from './apiClient';
import { logDevelopmentTiming } from './performanceLog';
const { faceServiceWarmupStore } = require('./faceServiceWarmupStore');

const warmed = new Set();
const inFlight = new Map();
const failureState = new Map();
let facePrewarmInFlight = null;

function warm(path, stage, requestUrl = () => getApiUrl(path)) {
  if (warmed.has(path)) return Promise.resolve({ reused: true, ready: true });
  if (inFlight.has(path)) return inFlight.get(path);

  if (typeof document !== 'undefined' && document.hidden) {
    return Promise.resolve({ ready: false, tabHidden: true });
  }

  const fail = failureState.get(path);
  const now = Date.now();
  if (fail && now < fail.nextRetryAt) {
    return Promise.resolve({ ready: false, backoff: true });
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let targetUrl;
  try {
    targetUrl = typeof requestUrl === 'function' ? requestUrl() : requestUrl;
  } catch {
    clearTimeout(timeout);
    return Promise.resolve({ ready: false });
  }
  const request = fetch(targetUrl, {
    method: path === '/health' ? 'GET' : 'POST',
    ...(path === '/health' ? {} : { headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    signal: controller.signal,
  }).then((response) => {
    if (response.ok) {
      warmed.add(path);
      failureState.delete(path);
    } else {
      const prevCount = fail?.count || 0;
      const count = prevCount + 1;
      const delay = Math.min(120_000, 10_000 * Math.pow(2, prevCount));
      failureState.set(path, { count, nextRetryAt: Date.now() + delay });
    }
    logDevelopmentTiming('[client-warmup]', { stage: `${stage}_${response.ok ? 'READY' : 'PENDING'}`, durationMs: Date.now() - startedAt });
    return { ready: response.ok };
  }).catch(() => {
    const prevCount = fail?.count || 0;
    const count = prevCount + 1;
    const delay = Math.min(120_000, 10_000 * Math.pow(2, prevCount));
    failureState.set(path, { count, nextRetryAt: Date.now() + delay });
    return { ready: false };
  }).finally(() => {
    clearTimeout(timeout);
    inFlight.delete(path);
  });
  inFlight.set(path, request);
  return request;
}

export const warmLoginBackend = () => warm('/health', 'LOGIN_PAGE_BACKEND_WARMUP', () => `${getApiBaseUrl()}/health`);
export const warmAdminBackend = () => warm('/health', 'ADMIN_SHELL_BACKEND_WARMUP', () => `${getApiBaseUrl()}/health`);
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
    logDevelopmentTiming('[client-warmup]', { stage: `SIGNUP_FACE_PREWARM_${status === 'ready' ? 'READY' : 'ACCEPTED'}`, durationMs: Date.now() - startedAt });
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
