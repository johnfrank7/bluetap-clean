const { createHmac, randomInt, randomUUID, timingSafeEqual } = require('node:crypto');
const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { sendEmail } = require('../email/emailProvider');
const { applyCors } = require('../utils/cors');
const { getClientIp } = require('../utils/request');
const { OtpError } = require('../utils/otpError');

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
  if (profile.role === 'manager') return profile.managerStatus === 'active';
  if (profile.role === 'distributor') return ['approved', 'active'].includes(String(profile.approvalStatus || profile.status || '').toLowerCase());
  return !['inactive', 'disabled'].includes(String(profile.accountStatus || profile.status || 'active').toLowerCase());
};
const genericRequest = (email) => ({ recoverySessionId: randomUUID(), maskedEmail: maskEmail(email), expiresAt: Date.now() + EXPIRY_MS, retryAfterSeconds: Math.ceil(COOLDOWN_MS / 1000), generic: true });

function createPasswordRecoveryHandler(getAdmin = getFirebaseAdmin, { now = Date.now, send = sendEmail } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      const body = bodyOf(req); const action = String(body.action || 'request');
      const { auth, db } = getAdmin(); const secret = String(process.env.EMAIL_OTP_HASH_SECRET || '');
      if (!secret) throw new OtpError(503, 'RECOVERY_UNAVAILABLE', 'Password recovery is temporarily unavailable.');
      if (action === 'request') {
        const email = emailFor(body.email); const response = genericRequest(email); let user; let profile;
        try { user = await auth.getUserByEmail(email); profile = (await db.collection('users').doc(user.uid).get()).data(); } catch (error) { if (error?.code !== 'auth/user-not-found') throw error; }
        if (!user || user.disabled || !profile || !['requester', 'distributor', 'manager'].includes(profile.role) || !activeAccount(profile)) return res.status(200).json(response);
        const sessionId = randomUUID(); const limitRef = db.collection('passwordResetRateLimits').doc(digest(secret, 'email', email)); const ipRef = db.collection('passwordResetRateLimits').doc(digest(secret, 'ip', getClientIp(req))); const sessionRef = db.collection('passwordResetSessions').doc(sessionId);
        await db.runTransaction(async (tx) => { const [emailLimit, ipLimit] = await Promise.all([tx.get(limitRef), tx.get(ipRef)]); const previous = [emailLimit.data() || {}, ipLimit.data() || {}]; const last = Math.max(...previous.map((item) => millis(item.lastSentAt))); if (last && now() - last < COOLDOWN_MS) throw new OtpError(429, 'RESEND_TOO_SOON', 'Please wait before requesting another code.', { retryAfterSeconds: Math.ceil((last + COOLDOWN_MS - now()) / 1000) }); tx.set(limitRef, { lastSentAt: new Date(now()), sessionId, emailHash: digest(secret, 'email', email) }); tx.set(ipRef, { lastSentAt: new Date(now()), sessionId }); });
        const code = String(randomInt(100000, 1000000)); const expiresAt = now() + EXPIRY_MS;
        await sessionRef.set({ purpose: 'PASSWORD_RESET', uid: user.uid, email, otpHash: digest(secret, 'otp', sessionId, user.uid, email, code), attempts: 0, status: 'active', createdAt: new Date(now()), expiresAt: new Date(expiresAt), lastSentAt: new Date(now()) });
        try { await send({ to: email, requestId: sessionId, subject: 'BlueTap Password Reset Code', text: `BlueTap\n\nYour password reset code is: ${code}\n\nThis code expires in 10 minutes. Do not share it. If you did not request this reset, you can safely ignore this email.`, html: `<!doctype html><html><body><h1>BlueTap</h1><h2>Password reset</h2><p>Your verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. Do not share it with anyone.</p><p>If you did not request a reset, you can safely ignore this email.</p></body></html>` }); } catch (error) { await db.runTransaction(async (tx) => { const [emailLimit, ipLimit] = await Promise.all([tx.get(limitRef), tx.get(ipRef)]); if (emailLimit.data()?.sessionId === sessionId) tx.delete(limitRef); if (ipLimit.data()?.sessionId === sessionId) tx.delete(ipRef); tx.update(sessionRef, { status: 'send-failed', otpHash: null, failedAt: new Date(now()) }); }); await db.collection('securityAuditLogs').add({ action: 'PASSWORD_RESET_FAILED', uid: user.uid, source: 'public-recovery', result: 'email-send-failed', createdAt: new Date(now()) }); throw error; }
        await db.collection('securityAuditLogs').add({ action: 'PASSWORD_RESET_REQUESTED', uid: user.uid, source: 'public-recovery', result: 'sent', createdAt: new Date(now()) });
        return res.status(200).json({ recoverySessionId: sessionId, maskedEmail: maskEmail(email), expiresAt, retryAfterSeconds: Math.ceil(COOLDOWN_MS / 1000), generic: true });
      }
      if (action === 'verify') {
        const sessionId = String(body.recoverySessionId || ''); const code = String(body.code || ''); if (!/^[0-9]{6}$/.test(code)) throw new OtpError(400, 'INVALID_CODE', 'Enter the six-digit code.');
        const ref = db.collection('passwordResetSessions').doc(sessionId); let authorization = '';
        await db.runTransaction(async (tx) => { const snap = await tx.get(ref); const data = snap.data(); if (!snap.exists || data?.purpose !== 'PASSWORD_RESET' || data.status !== 'active' || millis(data.expiresAt) <= now()) throw new OtpError(400, 'INVALID_OR_EXPIRED_CODE', 'That code is invalid or expired.'); if (Number(data.attempts || 0) >= MAX_ATTEMPTS) throw new OtpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Request a new code.'); const expected = Buffer.from(String(data.otpHash || ''), 'hex'); const actual = Buffer.from(digest(secret, 'otp', sessionId, data.uid, data.email, code), 'hex'); if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) { tx.update(ref, { attempts: Number(data.attempts || 0) + 1 }); throw new OtpError(400, 'INVALID_OR_EXPIRED_CODE', 'That code is invalid or expired.'); } authorization = randomUUID(); tx.update(ref, { status: 'verified', otpHash: null, verifiedAt: new Date(now()), resetAuthorizationHash: digest(secret, 'authorization', sessionId, authorization), resetAuthorizationExpiresAt: new Date(now() + AUTHORIZATION_MS) }); });
        const session = (await ref.get()).data(); await db.collection('securityAuditLogs').add({ action: 'PASSWORD_RESET_OTP_VERIFIED', uid: session.uid, source: 'public-recovery', result: 'verified', createdAt: new Date(now()) }); return res.status(200).json({ resetAuthorization: authorization });
      }
      if (action === 'complete') {
        const sessionId = String(body.recoverySessionId || ''); const authorization = String(body.resetAuthorization || ''); const password = passwordFor(body.newPassword); const ref = db.collection('passwordResetSessions').doc(sessionId); let session;
        await db.runTransaction(async (tx) => { const snap = await tx.get(ref); const data = snap.data(); if (!snap.exists || data?.purpose !== 'PASSWORD_RESET' || data.status !== 'verified' || millis(data.resetAuthorizationExpiresAt) <= now() || data.resetAuthorizationHash !== digest(secret, 'authorization', sessionId, authorization)) throw new OtpError(403, 'RECOVERY_NOT_AUTHORIZED', 'Start password recovery again.'); tx.update(ref, { status: 'completing', resetAuthorizationHash: null }); session = data; });
        const profileRef = db.collection('users').doc(session.uid); const profile = (await profileRef.get()).data(); if (!profile || !activeAccount(profile)) throw new OtpError(403, 'ACCOUNT_NOT_AVAILABLE', 'This account is not available for password recovery.');
        await auth.updateUser(session.uid, { password }); await auth.revokeRefreshTokens(session.uid);
        await db.runTransaction(async (tx) => { tx.update(profileRef, { mustChangePassword: false, passwordChangedAt: new Date(now()), passwordResetAt: new Date(now()), sessionRevokedAt: new Date(now()), updatedAt: new Date(now()) }); tx.update(ref, { status: 'consumed', consumedAt: new Date(now()) }); tx.set(db.collection('securityAuditLogs').doc(), { action: 'PASSWORD_RESET_COMPLETED', uid: session.uid, source: 'public-recovery', result: 'success', createdAt: new Date(now()) }); tx.set(db.collection('securityAuditLogs').doc(), { action: 'USER_SESSIONS_REVOKED', uid: session.uid, source: 'public-recovery', result: 'success', createdAt: new Date(now()) }); });
        return res.status(200).json({ changed: true });
      }
      throw new OtpError(400, 'INVALID_REQUEST', 'Invalid recovery action.');
    } catch (error) { const known = error instanceof OtpError; return res.status(known ? error.status : 503).json({ error: { code: known ? error.reason : 'RECOVERY_UNAVAILABLE', message: known ? error.message : 'Password recovery is temporarily unavailable. Please try again.' } }); }
  };
}
module.exports = { createPasswordRecoveryHandler, maskEmail, passwordFor };
