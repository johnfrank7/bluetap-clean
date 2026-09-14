const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { verifiedIdentity } = require('./authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');

const RECENT_LOGIN_SECONDS = 10 * 60;

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); }
}

function validateNewPassword(value) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < 12 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new OtpError(400, 'WEAK_PASSWORD', 'Use 12-128 characters with uppercase, lowercase, and a number.');
  }
  return password;
}

function createRequiredPasswordChangeHandler(getAdmin = getFirebaseAdmin, now = () => Date.now()) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      const { auth, db } = getAdmin();
      const decoded = await verifiedIdentity(req, auth);
      const profileRef = db.collection('users').doc(decoded.uid);
      const profileSnapshot = await profileRef.get();
      const profile = profileSnapshot.data() || {};
      if (!profileSnapshot.exists || profile.role !== 'admin' || !(decoded.admin === true || decoded.role === 'admin')) {
        throw new OtpError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
      }
      if (profile.mustChangePassword !== true) {
        throw new OtpError(409, 'PASSWORD_CHANGE_NOT_REQUIRED', 'This account does not require a temporary-password change.');
      }
      const authTime = Number(decoded.auth_time || 0);
      if (!authTime || Math.floor(now() / 1000) - authTime > RECENT_LOGIN_SECONDS) {
        throw new OtpError(401, 'REAUTHENTICATION_REQUIRED', 'Sign in again before changing your password.');
      }
      const newPassword = validateNewPassword(bodyOf(req).newPassword);
      const changedAt = new Date(now());
      await auth.updateUser(decoded.uid, { password: newPassword });
      await profileRef.update({ mustChangePassword: false, passwordChangedAt: changedAt, updatedAt: changedAt });
      await auth.revokeRefreshTokens(decoded.uid);
      return res.status(200).json({ changed: true });
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 500).json({ error: {
        reason: known ? error.reason : 'PASSWORD_CHANGE_FAILED',
        message: known ? error.message : 'The password could not be changed. Please try again.',
      } });
    }
  };
}

module.exports = { createRequiredPasswordChangeHandler, validateNewPassword };
