const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { loadRegistrationSecurity, SESSION_ROLES } = require('../registration/registrationSecurity');
const { verifiedIdentity } = require('./authorization');

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); }
}

function createSessionPolicyHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      const role = String(bodyOf(req).role || '').trim().toLowerCase();
      if (!SESSION_ROLES.includes(role)) throw new OtpError(400, 'INVALID_SESSION_ROLE', 'Choose a valid session role.');
      const { auth, db } = getAdmin();
      const config = await loadRegistrationSecurity(db);
      let override = null;
      if (req.headers?.authorization) {
        const decoded = await verifiedIdentity(req, auth);
        const profile = await db.collection('users').doc(decoded.uid).get();
        if (!profile.exists || profile.data()?.role !== role) {
          throw new OtpError(403, 'SESSION_POLICY_ACCESS_DENIED', 'This session policy is not available for the current account.');
        }
        const candidate = profile.data()?.sessionIdleTimeoutOverrideMinutes;
        if (Number.isInteger(candidate) && [5, 10, 15, 30, 60, 120].includes(candidate)) override = candidate;
      }
      const rolePolicy = config.sessionSecurity[role];
      return res.status(200).json({ role, policy: { ...rolePolicy, idleTimeoutMinutes: override || rolePolicy.idleTimeoutMinutes }, rolePolicy, overrideIdleTimeoutMinutes: override, policyVersion: config.version });
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 500).json({ error: {
        reason: known ? error.reason : 'SESSION_POLICY_UNAVAILABLE',
        message: known ? error.message : 'Session security settings are temporarily unavailable.',
      } });
    }
  };
}

module.exports = { createSessionPolicyHandler };
