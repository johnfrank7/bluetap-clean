const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { OtpError } = require('../utils/otpError');
const { applyCors } = require('../utils/cors');
const { recoverProfile } = require('./profileRecovery');

function createProfileRecoveryHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      const token = /^Bearer (\S+)$/i.exec(req.headers.authorization || '')?.[1];
      if (!token) throw new OtpError(401, 'unauthenticated', 'Authentication required.');
      const { auth, db } = getAdmin();
      const identity = await auth.verifyIdToken(token, true).catch(() => { throw new OtpError(401, 'unauthenticated', 'Your session has expired. Please log in again.'); });
      return res.status(200).json(await recoverProfile({ auth, db, uid: identity.uid }));
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 500).json({ error: { reason: known ? error.reason : 'service-unavailable', message: known ? error.message : 'Account recovery is temporarily unavailable.' } });
    }
  };
}
module.exports = { createProfileRecoveryHandler };
