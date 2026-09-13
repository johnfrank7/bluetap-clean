const { OtpError } = require('../utils/otpError');

const READY_ATTEMPTS = 2;
const READY_ATTEMPT_TIMEOUT_MS = 10_000;
const READY_RETRY_DELAY_MS = 2_000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function faceUpstreamConfigStatus(env = process.env) {
  const configuredUrl = String(env.DEEPFACE_API_URL || '').replace(/\/+$/, '');
  let validHttpsUrl = false;
  try { validHttpsUrl = new URL(configuredUrl).protocol === 'https:'; } catch { /* invalid configuration */ }
  return {
    urlConfigured: validHttpsUrl,
    configuredUrl: validHttpsUrl ? configuredUrl : null,
    apiKeyConfigured: Boolean(env.DEEPFACE_API_KEY),
  };
}

function createRenderFaceClient({
  env = process.env,
  fetchImpl = fetch,
  logger = console,
  readyAttempts = READY_ATTEMPTS,
  readyAttemptTimeoutMs = READY_ATTEMPT_TIMEOUT_MS,
  readyRetryDelayMs = READY_RETRY_DELAY_MS,
} = {}) {
  const log = (stage, details = {}) => logger.info('[face-upstream]', JSON.stringify({ stage, ...details }));
  const failLog = (stage, details = {}) => logger.error('[face-upstream]', JSON.stringify({ stage, ...details }));

  async function fetchUpstream(base, path, form, parentSignal, attempt) {
    const controller = new AbortController();
    const parentAbort = () => controller.abort();
    if (parentSignal?.aborted) controller.abort();
    else parentSignal?.addEventListener?.('abort', parentAbort, { once: true });
    const timer = path === '/ready'
      ? setTimeout(() => controller.abort(), readyAttemptTimeoutMs)
      : null;
    log('FACE_UPSTREAM_REQUEST_STARTED', { path, method: form ? 'POST' : 'GET', attempt });
    if (path === '/ready') log('FACE_UPSTREAM_READY_CHECK', { path, attempt });
    try {
      return await fetchImpl(`${base}${path}`, {
        method: form ? 'POST' : 'GET', body: form, signal: controller.signal, redirect: 'error',
        headers: { Authorization: `Bearer ${env.DEEPFACE_API_KEY}` },
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        failLog('FACE_UPSTREAM_TIMEOUT', { path, attempt });
        throw new OtpError(504, 'FACE_SERVICE_TIMEOUT', 'Face verification service took too long to respond. Please try again.', { upstreamPath: path });
      }
      failLog('FACE_UPSTREAM_FAILED', { path, attempt, category: 'network' });
      throw new OtpError(503, 'FACE_SERVICE_UNAVAILABLE', 'Face verification service is temporarily unavailable. Please try again later.', { upstreamPath: path });
    } finally {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener?.('abort', parentAbort);
    }
  }

  function mapStatus(response, path, attempt) {
    const details = { upstreamPath: path, upstreamStatus: response.status };
    log('FACE_UPSTREAM_STATUS', { path, status: response.status, attempt });
    if ([401, 403].includes(response.status)) {
      failLog('FACE_UPSTREAM_UNAUTHORIZED', { path, status: response.status, attempt });
      throw new OtpError(502, 'FACE_SERVICE_AUTH_FAILED', 'Face verification service authentication failed. Please contact support.', details);
    }
    if (response.status === 404) {
      failLog('FACE_UPSTREAM_ROUTE_NOT_FOUND', { path, status: response.status, attempt });
      throw new OtpError(502, 'FACE_SERVICE_ROUTE_MISMATCH', 'Face verification service requires an update. Please contact support.', details);
    }
    if ([400, 413, 422].includes(response.status)) {
      throw new OtpError(400, 'INVALID_FACE_IMAGE', 'Use a clear image with exactly one visible face.', details);
    }
    if ([408, 504].includes(response.status)) {
      failLog('FACE_UPSTREAM_TIMEOUT', { path, status: response.status, attempt });
      throw new OtpError(504, 'FACE_SERVICE_TIMEOUT', 'Face verification service took too long to respond. Please try again.', details);
    }
    if ([502, 503].includes(response.status)) {
      const preparing = path === '/ready';
      failLog('FACE_UPSTREAM_FAILED', { path, status: response.status, attempt, category: preparing ? 'preparing' : 'unavailable' });
      throw new OtpError(
        503,
        preparing ? 'FACE_SERVICE_PREPARING' : 'FACE_SERVICE_UNAVAILABLE',
        preparing ? 'Face verification service is starting. Please try again in a moment.' : 'Face verification service is temporarily unavailable. Please try again later.',
        details,
      );
    }
    if (!response.ok) {
      failLog('FACE_UPSTREAM_FAILED', { path, status: response.status, attempt, category: 'provider' });
      throw new OtpError(503, 'FACE_SERVICE_UNAVAILABLE', 'Face verification service is temporarily unavailable. Please try again later.', details);
    }
  }

  return async function request(path, form, signal) {
    const base = (env.DEEPFACE_API_URL || '').replace(/\/+$/, '');
    if (!base.startsWith('https://') || !env.DEEPFACE_API_KEY) {
      failLog('FACE_UPSTREAM_FAILED', { path, category: 'configuration' });
      throw new OtpError(503, 'FACE_SERVICE_UNAVAILABLE', 'Face verification is temporarily unavailable.');
    }

    const attempts = path === '/ready' ? readyAttempts : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let response;
      try {
        response = await fetchUpstream(base, path, form, signal, attempt);
        mapStatus(response, path, attempt);
      } catch (error) {
        const retryReady = path === '/ready' && attempt < attempts &&
          ['FACE_SERVICE_PREPARING', 'FACE_SERVICE_TIMEOUT', 'FACE_SERVICE_UNAVAILABLE'].includes(error?.reason);
        if (!retryReady) throw error;
        await wait(readyRetryDelayMs);
        continue;
      }
      let data;
      try {
        data = await response.json();
      } catch {
        if (path === '/ready' && attempt < attempts) {
          await wait(readyRetryDelayMs);
          continue;
        }
        failLog('FACE_UPSTREAM_FAILED', { path, status: response.status, attempt, category: 'invalid-response' });
        throw new OtpError(502, 'INVALID_FACE_RESPONSE', 'Face verification returned an invalid response.', { upstreamPath: path, upstreamStatus: response.status });
      }
      const ready = path !== '/ready' ||
        (data?.modelLoaded !== false && data?.ready !== false && (data?.status === 'ready' || data?.ready === true));
      if (!ready) {
        failLog('FACE_UPSTREAM_FAILED', { path, status: response.status, attempt, category: 'preparing' });
        if (attempt < attempts) {
          await wait(readyRetryDelayMs);
          continue;
        }
        throw new OtpError(503, 'FACE_SERVICE_PREPARING', 'Face verification service is starting. Please try again in a moment.', { upstreamPath: path, upstreamStatus: response.status });
      }
      return data;
    }
    throw new OtpError(503, 'FACE_SERVICE_PREPARING', 'Face verification service is starting. Please try again in a moment.', { upstreamPath: path });
  };
}

module.exports = { READY_ATTEMPTS, READY_ATTEMPT_TIMEOUT_MS, createRenderFaceClient, faceUpstreamConfigStatus };
