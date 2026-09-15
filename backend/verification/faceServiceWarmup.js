const { createRenderFaceClient } = require('./renderFaceClient');

const WARMUP_TIMEOUT_MS = 8_000;
let inFlightWarmup = null;

function warmFaceService() {
  if (inFlightWarmup) return inFlightWarmup;
  const startedAt = Date.now();
  console.info('[face-upstream]', JSON.stringify({ stage: 'SIGNUP_FACE_PREWARM_STARTED', timestamp: new Date().toISOString() }));
  const render = createRenderFaceClient({ readyAttempts: 1, readyAttemptTimeoutMs: WARMUP_TIMEOUT_MS });
  inFlightWarmup = render('/ready')
    .then(() => console.info('[face-upstream]', JSON.stringify({ stage: 'FACE_SERVICE_READY', durationMs: Date.now() - startedAt })))
    .catch((error) => {
      console.info('[face-upstream]', JSON.stringify({ stage: 'SIGNUP_FACE_PREWARM_PENDING', durationMs: Date.now() - startedAt, reason: error?.reason || 'FACE_SERVICE_UNAVAILABLE' }));
      throw error;
    })
    .finally(() => { inFlightWarmup = null; });
  return inFlightWarmup;
}

function getWarmFaceService() {
  if (inFlightWarmup) {
    console.info('[face-upstream]', JSON.stringify({ stage: 'SIGNUP_FACE_PREWARM_REUSED', timestamp: new Date().toISOString() }));
    return inFlightWarmup;
  }
  return warmFaceService();
}

module.exports = { WARMUP_TIMEOUT_MS, getWarmFaceService, warmFaceService };
