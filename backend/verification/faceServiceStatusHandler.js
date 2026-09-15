const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { readRegistrationSession } = require('../registration/registrationSession');
const { OtpError } = require('../utils/otpError');
const { applyCors } = require('../utils/cors');
const { getWarmFaceService } = require('./faceServiceWarmup');

const STATUS_READY_TIMEOUT_MS = 8_000;

async function safeFaceServiceStatus(render, signal) {
  try {
    await render('/ready', undefined, signal);
    return { status: 'ready', code: 'FACE_SERVICE_READY' };
  } catch (error) {
    if (['FACE_SERVICE_PREPARING', 'FACE_SERVICE_TIMEOUT', 'FACE_SERVICE_UNAVAILABLE', 'FACE_SERVICE_UPSTREAM_ERROR', 'INVALID_FACE_RESPONSE'].includes(error?.reason)) {
      return { status: 'starting', code: 'FACE_SERVICE_PREPARING' };
    }
    const safeReason = ['FACE_SERVICE_AUTH_FAILED', 'FACE_SERVICE_ROUTE_MISMATCH', 'FACE_SERVICE_UPSTREAM_ERROR', 'INVALID_FACE_RESPONSE'].includes(error?.reason)
      ? error.reason
      : 'FACE_SERVICE_UNAVAILABLE';
    return { status: 'unavailable', code: safeReason };
  }
}

function createFaceServiceStatusHandler({
  getAdmin = getFirebaseAdmin,
  // The status request joins a signup-triggered warm-up instead of creating a
  // second upstream readiness call while Render is starting.
  render = getWarmFaceService,
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STATUS_READY_TIMEOUT_MS + 500);
    try {
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
        throw new OtpError(415, 'invalid-request', 'Use application/json.');
      }
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { throw new OtpError(400, 'invalid-request', 'Invalid request.'); }
      }
      const { data } = await readRegistrationSession(getAdmin().db, body?.registrationSessionId);
      if (data.securityPolicySnapshot?.faceVerificationRequired === false) {
        return res.status(200).json({ status: 'not_required', code: 'FACE_SERVICE_NOT_REQUIRED' });
      }
      return res.status(200).json(await safeFaceServiceStatus(render, controller.signal));
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 503).json({ error: {
        reason: known ? error.reason : 'service-unavailable',
        message: known ? error.message : 'Face verification status is temporarily unavailable.',
      } });
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { STATUS_READY_TIMEOUT_MS, createFaceServiceStatusHandler, safeFaceServiceStatus };
