const { createHmac, randomInt, randomUUID, timingSafeEqual } = require('node:crypto');
const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { sendEmail, emailProviderConfigStatus } = require('../email/emailProvider');
const { applyCors } = require('../utils/cors');
const { getClientIp } = require('../utils/request');
const { OtpError } = require('../utils/otpError');
const { ACCOUNT_STATUS, canonicalAccountStatus } = require('./accountStatus');
const { assertStagingRelayTarget } = require('../config/stagingIsolation');

const EXPIRY_MS = 10 * 60 * 1000;
const AUTHORIZATION_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const emailFor = (value) => {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OtpError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  return email;
};
const passwordFor = (value) => {
  const password = typeof value === 'string' ? value : '';
  if (password.length < 12 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) throw new OtpError(400, 'WEAK_PASSWORD', 'Use 12-128 characters with uppercase, lowercase, and a number.');
  return password;
};
const maskEmail = (email) => { const [name, domain] = String(email || '').split('@'); return `${name.slice(0, 1)}***${name.slice(-1)}@${domain || 'email'}`; };
const bodyOf = (req) => { if (req.body && typeof req.body === 'object') return req.body; try { return JSON.parse(String(req.body || '{}')); } catch { throw new OtpError(400, 'INVALID_REQUEST', 'Invalid request.'); } };
const digest = (secret, ...values) => createHmac('sha256', secret).update(JSON.stringify(values)).digest('hex');
const millis = (value) => value?.toMillis?.() || (value instanceof Date ? value.getTime() : Number(value) || 0);
const activeAccount = (profile = {}) => {
  if (profile.accountActionHoldIntentId || canonicalAccountStatus(profile) !== ACCOUNT_STATUS.ACTIVE) return false;
  if (profile.role === 'manager') return profile.managerStatus === 'active';
  if (profile.role === 'distributor') return ['approved', 'active'].includes(String(profile.distributorStatus || profile.approvalStatus || profile.status || '').toLowerCase());
  return true;
};
const genericRequest = (email, now = Date.now) => ({ recoverySessionId: randomUUID(), maskedEmail: maskEmail(email), expiresAt: now() + EXPIRY_MS, retryAfterSeconds: Math.ceil(COOLDOWN_MS / 1000), generic: true });
const recoveryMailCode = (reason) => {
  if (reason === 'EMAIL_TRANSPORT_NOT_CONFIGURED') return 'MAIL_PROVIDER_CONFIG_MISSING';
  if (reason === 'EMAIL_TRANSPORT_AUTH_FAILED') return 'MAIL_RELAY_UNAUTHORIZED';
  if (reason === 'EMAIL_SEND_FAILED') return 'MAIL_RELAY_UNAVAILABLE';
  return reason;
};
const mailConfigurationError = () => new OtpError(503, 'MAIL_PROVIDER_CONFIG_MISSING',
  'Password recovery email is unavailable in this environment. Please contact BlueTap support.');
const assertRecoveryTransportConfigured = (env = process.env) => {
  const config = emailProviderConfigStatus(env);
  const ready = config.provider === 'resend'
    ? Boolean(String(env.RESEND_API_KEY || '').trim() && String(env.EMAIL_FROM_ADDRESS || '').trim())
    : config.provider === 'vercel-relay' && config.relayUrlConfigured && config.relaySecretConfigured;
  if (!ready) throw mailConfigurationError();
  if (config.provider === 'vercel-relay') {
    try { assertStagingRelayTarget(env); }
    catch { throw mailConfigurationError(); }
  }
};

function createPasswordRecoveryHandler(getAdmin = getFirebaseAdmin, { now = Date.now, send = sendEmail, logger = console,
  checkTransport = assertRecoveryTransportConfigured, transportEnv = process.env } = {}) {
  const logStage = (stage, details = {}, level = 'info') => {
    const write = typeof logger?.[level] === 'function' ? logger[level].bind(logger) : logger.info.bind(logger);
    write('[password-recovery]', JSON.stringify({ stage, ...details }));
  };
  const recordAudit = async (db, entry) => {
    try { await db.collection('securityAuditLogs').add(entry); }
    catch { logStage('PASSWORD_RECOVERY_AUDIT_WRITE_FAILED', {}, 'error'); }
  };
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      const body = bodyOf(req); const action = String(body.action || 'request');
      if (action === 'request') logStage('PASSWORD_RECOVERY_REQUEST_RECEIVED');
      const { auth, db } = getAdmin(); const secret = String(process.env.EMAIL_OTP_HASH_SECRET || '');
      if (!secret) throw new OtpError(503, 'RECOVERY_UNAVAILABLE', 'Password recovery is temporarily unavailable.');
      if (action === 'request') {
        const email = emailFor(body.email);
        // Configuration failure is identical for every address and happens before account lookup.
        checkTransport(transportEnv);
        const response = genericRequest(email, now); let user; let profile;
        try { user = await auth.getUserByEmail(email); profile = (await db.collection('users').doc(user.uid).get()).data(); } catch (error) { if (error?.code !== 'auth/user-not-found') throw error; }
        const accountEligible = Boolean(user && !user.disabled && profile &&
          String(profile.email || '').trim().toLowerCase() === email &&
          ['requester', 'distributor', 'manager'].includes(profile.role) && activeAccount(profile));
        logStage('PASSWORD_RECOVERY_ACCOUNT_RESOLVED', { accountEligible });
        // Unknown and ineligible addresses share the same cooldown and public response.
        const sessionId = randomUUID(); const limitRef = db.collection('passwordResetRateLimits').doc(digest(secret, 'email', email)); const ipRef = db.collection('passwordResetRateLimits').doc(digest(secret, 'ip', getClientIp(req)));
        await db.runTransaction(async (tx) => { const [emailLimit, ipLimit] = await Promise.all([tx.get(limitRef), tx.get(ipRef)]); const previous = [emailLimit.data() || {}, ipLimit.data() || {}]; const last = Math.max(...previous.map((item) => millis(item.lastSentAt))); if (last && now() - last < COOLDOWN_MS) throw new OtpError(429, 'PASSWORD_RECOVERY_RATE_LIMITED', 'Please wait before requesting another code.', { retryAfterSeconds: Math.ceil((last + COOLDOWN_MS - now()) / 1000) }); tx.set(limitRef, { lastSentAt: new Date(now()), sessionId, emailHash: digest(secret, 'email', email) }); tx.set(ipRef, { lastSentAt: new Date(now()), sessionId }); });
        if (!accountEligible) return res.status(200).json(response);
        const sessionRef = db.collection('passwordResetSessions').doc(sessionId);
        const code = String(randomInt(100000, 1000000)); const expiresAt = now() + EXPIRY_MS;
        await sessionRef.set({ purpose: 'PASSWORD_RESET', uid: user.uid, role: profile.role, email, otpHash: digest(secret, 'otp', sessionId, user.uid, email, code), attempts: 0, status: 'sending', createdAt: new Date(now()), expiresAt: new Date(expiresAt), lastSentAt: new Date(now()) });
        logStage('PASSWORD_RECOVERY_OTP_CREATED', { purpose: 'PASSWORD_RESET' });
        try {
          logStage('PASSWORD_RECOVERY_MAIL_SEND_STARTED', { provider: String(process.env.EMAIL_PROVIDER || 'missing').toLowerCase() });
          const delivery = await send({ to: email, requestId: sessionId, subject: 'BlueTap Password Reset Code', text: `BlueTap\n\nYour password reset code is: ${code}\n\nThis code expires in 10 minutes. Do not share it. If you did not request this reset, you can safely ignore this email.`, html: `<!doctype html><html><body><h1>BlueTap</h1><h2>Password reset</h2><p>Your verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. Do not share it with anyone.</p><p>If you did not request a reset, you can safely ignore this email.</p></body></html>` });
          await sessionRef.update({ status: 'active' });
          logStage('PASSWORD_RECOVERY_MAIL_RELAY_RESPONSE', {
            provider: delivery?.provider || String(process.env.EMAIL_PROVIDER || 'unknown').toLowerCase(),
            relayStatus: Number(delivery?.providerStatus) || 0,
          });
        } catch (error) {
          if (Number.isInteger(error?.details?.providerStatus)) {
            logStage('PASSWORD_RECOVERY_MAIL_RELAY_RESPONSE', {
              provider: error.details.provider || String(process.env.EMAIL_PROVIDER || 'unknown').toLowerCase(),
              relayStatus: error.details.providerStatus,
            });
          }
          logStage('PASSWORD_RECOVERY_MAIL_SEND_FAILED', { reason: recoveryMailCode(error?.reason || 'EMAIL_SEND_FAILED') }, 'error');
          try { await sessionRef.update({ status: 'send-failed', otpHash: null, failedAt: new Date(now()) }); }
          catch { logStage('PASSWORD_RECOVERY_SESSION_INVALIDATION_FAILED', {}, 'error'); }
          await recordAudit(db, { action: 'PASSWORD_RESET_FAILED', uid: user.uid, source: 'public-recovery', result: 'email-send-failed', createdAt: new Date(now()) });
          // The provider result must not reveal whether the submitted address is eligible.
          return res.status(200).json(response);
        }
        await recordAudit(db, { action: 'PASSWORD_RESET_REQUESTED', uid: user.uid, source: 'public-recovery', result: 'sent', createdAt: new Date(now()) });
        logStage('PASSWORD_RECOVERY_SENT');
        return res.status(200).json({ recoverySessionId: sessionId, maskedEmail: maskEmail(email), expiresAt, retryAfterSeconds: Math.ceil(COOLDOWN_MS / 1000), generic: true });
      }
      if (action === 'verify') {
        const sessionId = String(body.recoverySessionId || ''); const code = String(body.code || ''); if (!/^[0-9]{6}$/.test(code)) throw new OtpError(400, 'INVALID_CODE', 'Enter the six-digit code.');
        const ref = db.collection('passwordResetSessions').doc(sessionId); let authorization = '';
        const outcome = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const data = snap.data();
          if (!snap.exists || data?.purpose !== 'PASSWORD_RESET' ||
              !['active', 'locked'].includes(data.status) || millis(data.expiresAt) <= now()) return 'invalid';
          if (data.status === 'locked' || Number(data.attempts || 0) >= MAX_ATTEMPTS) return 'limited';
          const expected = Buffer.from(String(data.otpHash || ''), 'hex');
          const actual = Buffer.from(digest(secret, 'otp', sessionId, data.uid, data.email, code), 'hex');
          if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
            const attempts = Number(data.attempts || 0) + 1;
            tx.update(ref, attempts >= MAX_ATTEMPTS
              ? { attempts, status: 'locked', otpHash: null }
              : { attempts });
            return attempts >= MAX_ATTEMPTS ? 'limited' : 'invalid';
          }
          authorization = randomUUID();
          tx.update(ref, { status: 'verified', otpHash: null, verifiedAt: new Date(now()),
            resetAuthorizationHash: digest(secret, 'authorization', sessionId, authorization),
            resetAuthorizationExpiresAt: new Date(now() + AUTHORIZATION_MS) });
          return 'verified';
        });
        if (outcome === 'limited') throw new OtpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Request a new code.');
        if (outcome !== 'verified') throw new OtpError(400, 'INVALID_OR_EXPIRED_CODE', 'That code is invalid or expired.');
        const session = (await ref.get()).data(); await db.collection('securityAuditLogs').add({ action: 'PASSWORD_RESET_OTP_VERIFIED', uid: session.uid, source: 'public-recovery', result: 'verified', createdAt: new Date(now()) }); return res.status(200).json({ resetAuthorization: authorization });
      }
      if (action === 'complete') {
        const sessionId = String(body.recoverySessionId || ''); const authorization = String(body.resetAuthorization || ''); const password = passwordFor(body.newPassword); const ref = db.collection('passwordResetSessions').doc(sessionId); let session;
        await db.runTransaction(async (tx) => { const snap = await tx.get(ref); const data = snap.data(); if (!snap.exists || data?.purpose !== 'PASSWORD_RESET' || data.status !== 'verified' || millis(data.resetAuthorizationExpiresAt) <= now() || data.resetAuthorizationHash !== digest(secret, 'authorization', sessionId, authorization)) throw new OtpError(403, 'RECOVERY_NOT_AUTHORIZED', 'Start password recovery again.'); tx.update(ref, { status: 'completing', resetAuthorizationHash: null }); session = data; });
        const profileRef = db.collection('users').doc(session.uid);
        const profile = (await profileRef.get()).data();
        const authUser = await auth.getUser(session.uid).catch(() => null);
        if (!profile || !['requester', 'distributor', 'manager'].includes(profile.role) ||
            (session.role && profile.role !== session.role) || !activeAccount(profile) || !authUser || authUser.disabled ||
            String(profile.email || '').trim().toLowerCase() !== session.email ||
            String(authUser.email || '').trim().toLowerCase() !== session.email) {
          throw new OtpError(403, 'ACCOUNT_NOT_AVAILABLE', 'This account is not available for password recovery.');
        }
        await auth.updateUser(session.uid, { password }); await auth.revokeRefreshTokens(session.uid);
        await db.runTransaction(async (tx) => { tx.update(profileRef, { mustChangePassword: false, passwordChangedAt: new Date(now()), passwordResetAt: new Date(now()), sessionRevokedAt: new Date(now()), updatedAt: new Date(now()) }); tx.update(ref, { status: 'consumed', consumedAt: new Date(now()) }); tx.set(db.collection('securityAuditLogs').doc(), { action: 'PASSWORD_RESET_COMPLETED', uid: session.uid, source: 'public-recovery', result: 'success', createdAt: new Date(now()) }); tx.set(db.collection('securityAuditLogs').doc(), { action: 'USER_SESSIONS_REVOKED', uid: session.uid, source: 'public-recovery', result: 'success', createdAt: new Date(now()) }); });
        return res.status(200).json({ changed: true });
      }
      throw new OtpError(400, 'INVALID_REQUEST', 'Invalid recovery action.');
    } catch (error) {
      const known = error instanceof OtpError;
      const retryAfterSeconds = known ? Number(error.details?.retryAfterSeconds) : 0;
      if (retryAfterSeconds > 0) res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(known ? error.status : 503).json({
        error: {
          code: known ? error.reason : 'RECOVERY_UNAVAILABLE',
          message: known ? error.message : 'Password recovery is temporarily unavailable. Please try again.',
          ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
        },
      });
    }
  };
}
module.exports = { assertRecoveryTransportConfigured, createPasswordRecoveryHandler, maskEmail, passwordFor };
