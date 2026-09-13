const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { createRegistrationService } = require('./registration');
const { sendEmailOtp } = require('../email/emailProvider');
const { OtpError } = require('../utils/otpError');
const { applyCors } = require('../utils/cors');
const { getClientIp } = require('../utils/request');
const { randomUUID } = require('node:crypto');

function createRegistrationHandler(action) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    const requestId = randomUUID();
    const otpStage = (stage) => console.info('[registration-otp]', JSON.stringify({ requestId, stage }));
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { throw new OtpError(400, 'invalid-registration', 'Invalid request.'); }
      }
      const service = createRegistrationService({ ...getFirebaseAdmin(), sendEmailOtp, hashSecret: process.env.EMAIL_OTP_HASH_SECRET, otpStage });
      const ip = getClientIp(req);
      const result = action === 'request'
        ? await service.request(body?.email, body?.username, body?.registrationSessionId, ip)
        : body?.action === 'complete-without-otp'
          ? await service.completeWithoutOtp(body?.challenge, body?.profile, body?.finalFaceImage)
        : body?.action === 'retry-finalization'
          ? await service.retryFinalization(body?.challenge, body?.profile, body?.finalFaceImage)
          : await service.complete(body?.challenge, body?.code, body?.profile, body?.finalFaceImage);
      return res.status(200).json(result);
    } catch (error) {
      const known = error instanceof OtpError;
      if (action === 'request') console.error('[registration-otp]', JSON.stringify({
        requestId,
        stage: 'OTP_REQUEST_FAILED',
        reason: known ? error.reason : 'SERVICE_UNAVAILABLE',
      }));
      if (known && error.details.retryAfterSeconds) res.setHeader('Retry-After', String(error.details.retryAfterSeconds));
      const duplicate = error.code === 'auth/email-already-exists';
      return res.status(known ? error.status : duplicate ? 409 : 500).json({ error: {
        reason: known ? error.reason : duplicate ? 'account-exists' : 'service-unavailable',
        message: known ? error.message : duplicate ? 'Email already registered.' : 'Registration could not be completed. Please try again.',
        ...(known ? error.details : {}),
      } });
    }
  };
}
module.exports = { createRegistrationHandler };
