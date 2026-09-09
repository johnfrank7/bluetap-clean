const { getFirebaseAdmin } = require('./firebaseAdmin');
const { createRegistrationService } = require('./registration');
const { sendEmailOtp } = require('./emailProvider');
const { OtpError } = require('./otpError');

function createRegistrationHandler(action) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { throw new OtpError(400, 'invalid-registration', 'Invalid request.'); }
      }
      const service = createRegistrationService({ ...getFirebaseAdmin(), sendEmailOtp, hashSecret: process.env.EMAIL_OTP_HASH_SECRET });
      const ip = process.env.VERCEL
        ? String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim()
        : req.socket?.remoteAddress || 'local';
      const result = action === 'request'
        ? await service.request(body?.email, body?.username, ip)
        : await service.complete(body?.challenge, body?.code, body?.profile);
      return res.status(200).json(result);
    } catch (error) {
      const known = error instanceof OtpError;
      if (known && error.details.retryAfterSeconds) res.setHeader('Retry-After', String(error.details.retryAfterSeconds));
      const duplicate = error.code === 'auth/email-already-exists';
      return res.status(known ? error.status : duplicate ? 409 : 500).json({ error: {
        reason: known ? error.reason : duplicate ? 'account-exists' : 'service-unavailable',
        message: known ? error.message : duplicate ? 'This account already exists. Please log in.' : 'Registration could not be completed. Please try again.',
        ...(known ? error.details : {}),
      } });
    }
  };
}
module.exports = { createRegistrationHandler };
