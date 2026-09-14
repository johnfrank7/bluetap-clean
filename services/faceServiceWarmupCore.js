const FACE_SERVICE_WARMUP_WINDOW_MS = 75_000;
const FACE_SERVICE_POLL_INTERVAL_MS = 4_000;

function shouldContinueFaceWarmup({ required, status, startedAt, now }) {
  return required === true && status !== 'ready' && now - startedAt < FACE_SERVICE_WARMUP_WINDOW_MS;
}

function isFaceServicePreparationError(error) {
  const code = String(error?.code || error?.reason || '').toUpperCase();
  return code.includes('FACE_SERVICE_PREPARING') ||
    code.includes('FACE_SERVICE_TIMEOUT') ||
    code.includes('FACE_SERVICE_UNAVAILABLE') ||
    code.includes('FACE_SERVICE_UPSTREAM_ERROR');
}

module.exports = {
  FACE_SERVICE_POLL_INTERVAL_MS,
  FACE_SERVICE_WARMUP_WINDOW_MS,
  isFaceServicePreparationError,
  shouldContinueFaceWarmup,
};
