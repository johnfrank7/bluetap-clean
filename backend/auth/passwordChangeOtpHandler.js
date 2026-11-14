const { createHmac, randomInt, randomUUID, timingSafeEqual } = require('node:crypto');
const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { sendEmail, emailProviderConfigStatus } = require('../email/emailProvider');
const { verifiedIdentity, requireRequester, requireActiveDistributor, requireActiveManager, requireAdmin } = require('./authorization');
const { requireActiveAccount } = require('./accountStatus');
const { validateNewPassword } = require('./requiredPasswordChangeHandler');
const { loadRegistrationSecurity } = require('../registration/registrationSecurity');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { getAppEnv, APP_ENVIRONMENTS } = require('../config/appEnv');

const assertRecoveryTransportConfigured = (env = process.env) => {
  const config = emailProviderConfigStatus(env);
  const ready = config.provider === 'resend'
    ? Boolean(String(env.RESEND_API_KEY || '').trim() && String(env.EMAIL_FROM_ADDRESS || '').trim())
    : config.provider === 'vercel-relay' && config.relayUrlConfigured && config.relaySecretConfigured;
  const staging = getAppEnv(env) === APP_ENVIRONMENTS.STAGING ||
    String(env.RENDER_EXTERNAL_HOSTNAME || '').trim().toLowerCase() === 'bluetap-staging-backend.onrender.com' ||
    String(env.RENDER_SERVICE_NAME || '').trim().toLowerCase() === 'bluetap-staging-backend';
  const approvedRelay = !staging || config.provider !== 'vercel-relay' ||
    (config.relayUrlConfigured && new URL(env.VERCEL_MAIL_RELAY_URL).hostname.toLowerCase() === 'bluetap-staging-web.vercel.app');
  if (!ready || !approvedRelay) throw new OtpError(503, 'MAIL_PROVIDER_CONFIG_MISSING', 'Password change email is unavailable in this environment. Please contact BlueTap support.');
};

const EXPIRY_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS = 6;
const MAX_ATTEMPTS = 5;
const RECENT_AUTH_MS = 10 * 60 * 1000;
const millis = (value) => value?.toMillis?.() || (value instanceof Date ? value.getTime() : 0);
const emailOf = (value) => String(value || '').trim().toLowerCase();
const digest = (secret, uid, email, id, code) => createHmac('sha256', secret).update(JSON.stringify(['PASSWORD_CHANGE', uid, email, id, code])).digest('hex');
const bodyOf = (req) => {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(String(req.body || '{}'));
  } catch {
    throw new OtpError(400, 'INVALID_REQUEST', 'Invalid request body.');
  }
};

function createPasswordChangeOtpHandler(getAdmin = getFirebaseAdmin, { now = Date.now, send = sendEmail, checkTransport = assertRecoveryTransportConfigured, secret = () => process.env.EMAIL_OTP_HASH_SECRET } = {}) {
  async function eligible(req, auth, db) {
    const identity = await verifiedIdentity(req, auth);
    const authTime = Number(identity.auth_time) * 1000;
    if (!authTime || authTime > now() + 30000 || now() - authTime > RECENT_AUTH_MS) throw new OtpError(401, 'REAUTHENTICATION_REQUIRED', 'Enter your current password again.');
    const snapshot = await db.collection('users').doc(identity.uid).get();
    const profile = snapshot.exists ? snapshot.data() : null;
    const guards = { requester: requireRequester, distributor: requireActiveDistributor, manager: requireActiveManager, admin: requireAdmin };
    if (!profile || !guards[profile.role] || profile.mustChangePassword === true) throw new OtpError(403, 'ACCOUNT_NOT_AVAILABLE', 'This account cannot use this password change flow.');
    await guards[profile.role](req, auth, db);
    requireActiveAccount(profile);
    const user = await auth.getUser(identity.uid);
    const email = emailOf(user.email);
    if (user.disabled || user.emailVerified !== true || identity.email_verified !== true || !email || email !== emailOf(identity.email) || email !== emailOf(profile.email)) {
      throw new OtpError(403, 'VERIFIED_EMAIL_REQUIRED', 'Verify your current account email before changing your password.');
    }
    return { uid: identity.uid, email, authTime, role: profile.role };
  }

  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      const body = bodyOf(req);
      const { auth, db } = getAdmin();
      const key = String(secret() || '');
      const isLiveDeployment = ['production', 'staging'].includes(String(process.env.APP_ENV || process.env.NODE_ENV || '').trim().toLowerCase());
      if (!key || (isLiveDeployment && key.length < 32)) throw new OtpError(503, 'PASSWORD_CHANGE_UNAVAILABLE', 'Password change is temporarily unavailable.');
      const identity = await eligible(req, auth, db);
      const ref = db.collection('passwordChangeOtpSessions').doc(identity.uid);
      if (body.action === 'request') {
        checkTransport();
        const id = randomUUID();
        const code = String(randomInt(100000, 1000000));
        const time = now();
        await db.runTransaction(async (tx) => {
          const previous = (await tx.get(ref)).data() || {};
          if (['completing', 'outcome-unknown'].includes(previous.status)) throw new OtpError(409, 'CHANGE_IN_PROGRESS', 'The previous change could not be confirmed. Sign in with your new password or contact support.');
          const last = millis(previous.lastSentAt);
          if (last && time - last < COOLDOWN_MS) throw new OtpError(429, 'RESEND_TOO_SOON', 'Please wait before requesting another code.', { retryAfterSeconds: Math.ceil((last + COOLDOWN_MS - time) / 1000) });
          const start = millis(previous.sendWindowStartedAt);
          const inWindow = start && time - start < WINDOW_MS;
          const count = inWindow ? Number(previous.sendCount || 0) : 0;
          if (count >= MAX_SENDS) throw new OtpError(429, 'SEND_LIMIT', 'Too many codes requested. Try again later.');
          tx.set(ref, { purpose: 'PASSWORD_CHANGE', requestId: id, uid: identity.uid, email: identity.email, role: identity.role, authTime: identity.authTime, otpHash: digest(key, identity.uid, identity.email, id, code), status: 'sending', attempts: 0, expiresAt: new Date(time + EXPIRY_MS), lastSentAt: new Date(time), sendWindowStartedAt: new Date(inWindow ? start : time), sendCount: count + 1 });
        });
        try {
          await send({ to: identity.email, requestId: id, subject: 'BlueTap Password Change Code', text: `Your BlueTap password change code is ${code}. It expires in 10 minutes. Do not share this code.`, html: `<p>Your BlueTap password change code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. Do not share this code.</p>` });
        } catch {
          await db.runTransaction(async (tx) => { const data = (await tx.get(ref)).data(); if (data?.requestId === id && data.status === 'sending') tx.update(ref, { status: 'send-failed', otpHash: null }); });
          throw new OtpError(503, 'EMAIL_SEND_FAILED', 'The code could not be sent. Please try again later.');
        }
        await db.runTransaction(async (tx) => { const data = (await tx.get(ref)).data(); if (data?.requestId !== id || data.status !== 'sending') throw new OtpError(409, 'NO_ACTIVE_CODE', 'Request a new code.'); tx.update(ref, { status: 'active' }); });
        return res.status(200).json({ expiresAt: time + EXPIRY_MS, retryAfterSeconds: 60 });
      }
      if (body.action !== 'confirm') throw new OtpError(400, 'INVALID_REQUEST', 'Invalid request.');
      const password = validateNewPassword(body.newPassword);
      const code = String(body.code || '');
      if (!/^\d{6}$/.test(code)) throw new OtpError(400, 'INVALID_CODE', 'Enter the six-digit code.');
      const outcome = await db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data();
        if (!data || data.purpose !== 'PASSWORD_CHANGE' || data.uid !== identity.uid || data.email !== identity.email || data.role !== identity.role || data.authTime !== identity.authTime || data.status !== 'active' || millis(data.expiresAt) <= now()) return 'invalid';
        const expected = Buffer.from(String(data.otpHash || ''), 'hex');
        const received = Buffer.from(digest(key, identity.uid, identity.email, data.requestId, code), 'hex');
        if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
          const attempts = Number(data.attempts || 0) + 1;
          tx.update(ref, { attempts, ...(attempts >= MAX_ATTEMPTS ? { status: 'locked', otpHash: null } : {}) });
          return attempts >= MAX_ATTEMPTS ? 'limited' : 'invalid';
        }
        tx.update(ref, { status: 'completing', otpHash: null, consumedAt: new Date(now()) });
        return 'accepted';
      });
      if (outcome !== 'accepted') throw new OtpError(outcome === 'limited' ? 429 : 400, outcome === 'limited' ? 'TOO_MANY_ATTEMPTS' : 'INVALID_OR_EXPIRED_CODE', outcome === 'limited' ? 'Too many attempts. Request a new code.' : 'The code is invalid or expired.');
      try {
        const refreshed = await eligible(req, auth, db);
        if (refreshed.uid !== identity.uid || refreshed.email !== identity.email || refreshed.role !== identity.role || refreshed.authTime !== identity.authTime) {
          throw new OtpError(403, 'ACCOUNT_NOT_AVAILABLE', 'This account can no longer complete the password change.');
        }
        const policy = await loadRegistrationSecurity(db);
        const signOutRequired = identity.role === 'admin' || policy.sessionSecurity[identity.role]?.forceLogoutAfterPasswordChange !== false;
        await auth.updateUser(identity.uid, { password });
        if (signOutRequired) await auth.revokeRefreshTokens(identity.uid);
        await db.runTransaction(async (tx) => {
          const session = (await tx.get(ref)).data();
          if (session?.status !== 'completing') throw new OtpError(409, 'CHANGE_IN_PROGRESS', 'Password change could not be confirmed.');
          const completedAt = new Date(now());
          tx.update(ref, { status: 'consumed', completedAt });
          tx.update(db.collection('users').doc(identity.uid), { passwordChangedAt: completedAt, ...(signOutRequired ? { sessionRevokedAt: completedAt } : {}), updatedAt: completedAt });
          tx.set(db.collection('securityAuditLogs').doc(randomUUID()), { action: 'PASSWORD_CHANGE_COMPLETED', uid: identity.uid, role: identity.role, result: 'success', createdAt: completedAt });
        });
        return res.status(200).json({ changed: true, signOutRequired });
      } catch (error) {
        await ref.update({ status: 'outcome-unknown', otpHash: null }).catch(() => {});
        throw error;
      }
    } catch (error) {
      const known = error instanceof OtpError || (Boolean(error?.status) && Boolean(error?.reason));
      if (known && error.details?.retryAfterSeconds) res.setHeader('Retry-After', String(error.details.retryAfterSeconds));
      return res.status(known ? error.status : 503).json({ error: { reason: known ? error.reason : 'PASSWORD_CHANGE_UNAVAILABLE', message: known ? error.message : 'Password change could not be confirmed. Sign in with your new password or contact support.' } });
    }
  };
}

module.exports = { createPasswordChangeOtpHandler };
