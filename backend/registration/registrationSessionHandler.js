const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { OtpError } = require('../utils/otpError');
const { createRegistrationSessionService } = require('./registrationSession');
const { applyCors } = require('../utils/cors');
const { getClientIp } = require('../utils/request');

function createRegistrationSessionHandler(action, getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new OtpError(400, 'invalid-request', 'Invalid request.'); } }
      const { db } = getAdmin();
      const service = createRegistrationSessionService({ db, hashSecret: process.env.EMAIL_OTP_HASH_SECRET });
      const ip = getClientIp(req);
      const result = action === 'create' ? await service.create(body, ip)
        : action === 'start' ? await service.start(body?.registrationSessionId)
          : action === 'terms' ? await service.acceptTerms(body?.registrationSessionId)
            : await service.status(body?.registrationSessionId);
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
