const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { createEmailOtpService } = require('./emailOtp');
const { sendEmailOtp } = require('../email/emailProvider');
const { OtpError } = require('../utils/otpError');
const { applyCors } = require('../utils/cors');
const { recoverProfile, restartIncompleteRegistration } = require('../registration/profileRecovery');

function createOtpHandler(action, getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // Bearer tokens only; no cookies or credentialed CORS.
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    }
    try {
      const match = /^Bearer (\S+)$/i.exec(req.headers.authorization || '');
      if (!match) throw new OtpError(401, 'unauthenticated', 'Authentication required.');
      const { auth, db } = getAdmin();
      let identity;
      try {
        identity = await auth.verifyIdToken(match[1], true);
      } catch (error) {
        if (/^auth\/(id-token|argument-error|invalid-id-token|user-disabled|user-not-found)/.test(error.code || '')) {
          throw new OtpError(401, 'unauthenticated', 'Your session has expired. Please log in again.');
        }
        throw error;
      }
      const service = createEmailOtpService({ auth, db, sendEmailOtp, hashSecret: process.env.EMAIL_OTP_HASH_SECRET });
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); }
        catch { throw new OtpError(400, 'invalid-code', 'Invalid request body.'); }
      }
      const result = action === 'request' && body?.action === 'recover-profile'
        ? await recoverProfile({ auth, db, uid: identity.uid })
        : action === 'request' && body?.action === 'restart-incomplete-registration'
          ? await restartIncompleteRegistration({ auth, db, uid: identity.uid, hashSecret: process.env.EMAIL_OTP_HASH_SECRET })
          : action === 'request'
            ? await service.request(identity.uid)
            : await service.verify(identity.uid, body?.code);
      return res.status(200).json(result);
    } catch (error) {
      const known = error instanceof OtpError;
      if (known && error.details.retryAfterSeconds) res.setHeader('Retry-After', String(error.details.retryAfterSeconds));
      return res.status(known ? error.status : 500).json({ error: {
        reason: known ? error.reason : 'service-unavailable',
        message: known ? error.message : 'Verification service is temporarily unavailable. Please try again later.',
        ...(known ? error.details : {}),
      } });
    }
  };
}
module.exports = { createOtpHandler };
