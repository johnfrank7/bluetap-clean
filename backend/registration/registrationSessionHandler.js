const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { OtpError } = require('../utils/otpError');
const { createRegistrationSessionService } = require('./registrationSession');
const { applyCors } = require('../utils/cors');
const { getClientIp } = require('../utils/request');
const { getWarmFaceService } = require('../verification/faceServiceWarmup');

function createRegistrationSessionHandler(action, getAdmin = getFirebaseAdmin, warmFaceService = getWarmFaceService) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new OtpError(400, 'invalid-request', 'Invalid request.'); } }
      const { db } = getAdmin();
      const service = createRegistrationSessionService({
        db,
        hashSecret: process.env.EMAIL_OTP_HASH_SECRET,
        deviceHashSecret: process.env.REGISTRATION_DEVICE_HASH_SECRET,
        ipHashSecret: process.env.REGISTRATION_IP_HASH_SECRET,
      });
      const ip = getClientIp(req);
      const result = action === 'create' ? await service.create(body, ip)
        : action === 'start' ? await service.start(body?.registrationSessionId)
          : action === 'terms' ? await service.acceptTerms(body?.registrationSessionId)
            : await service.status(body?.registrationSessionId);
      if (action === 'create' && result.securityPolicy?.faceVerificationRequired === true) {
        // Start the Render Free wake-up without delaying registration-session
        // creation. Failures remain retryable and never alter session state.
        console.info('[face-upstream]', JSON.stringify({
          stage: 'FACE_PREWARM_TRIGGERED',
          timestamp: new Date().toISOString(),
        }));
        Promise.resolve().then(warmFaceService).catch((error) => console.info('[face-upstream]', JSON.stringify({
          stage: 'FACE_UPSTREAM_PREWARM_PENDING',
          timestamp: new Date().toISOString(),
          reason: error?.reason || 'FACE_SERVICE_UNAVAILABLE',
        })));
      }
      return res.status(200).json(result);
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 503).json({ error: {
        reason: known ? error.reason : 'service-unavailable',
        message: known ? error.message : 'Registration verification is temporarily unavailable.',
      } });
    }
  };
}
module.exports = { createRegistrationSessionHandler };
