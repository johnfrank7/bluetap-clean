const { createHmac } = require('node:crypto');
const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { OtpError } = require('../utils/otpError');
const { normalizeUsername } = require('./username');
const { applyCors } = require('../utils/cors');
const { getClientIp } = require('../utils/request');
const firebaseWebConfig = require('../../firebase-web-config.json');

const genericLogin = () => new OtpError(401, 'invalid-credential', 'Invalid username or password.');
const mappingError = () => new OtpError(409, 'account-mapping-invalid', 'Your account sign-in setup needs attention. Please contact support.');
const setupError = () => new OtpError(409, 'account-setup-incomplete', 'Your account setup is incomplete. Please contact support.');
const stage = (name, details = {}) => console.info('[public-login]', {
  stage: `PUBLIC_LOGIN_${name}`,
  ...details,
});
const loginDiagnostic = (name, details = {}) => console.info('[public-login]', {
  stage: name,
  ...details,
});
const errorCodes = {
  'invalid-credential': 'INVALID_CREDENTIALS',
  'privileged-login-required': 'PRIVILEGED_LOGIN_REQUIRED',
  'account-mapping-invalid': 'ACCOUNT_MAPPING_INVALID',
  'account-setup-incomplete': 'ACCOUNT_SETUP_INCOMPLETE',
  'invalid-request': 'INVALID_REQUEST',
  'too-many-attempts': 'TOO_MANY_ATTEMPTS',
  'account-disabled': 'ACCOUNT_DISABLED',
  'portal-role-mismatch': 'PORTAL_ROLE_MISMATCH',
};
const publicProfile = (profile, uid, email) => ({
  uid,
  email: String(profile.email || email || '').trim().toLowerCase(),
  role: profile.role,
  distributorStatus: profile.distributorStatus || profile.approvalStatus || profile.status || null,
  approvalStatus: profile.distributorStatus || profile.approvalStatus || profile.status || null,
  status: profile.status || profile.distributorStatus || profile.approvalStatus || null,
  rejectionReason: profile.rejectionReason || null,
  mustChangePassword: profile.mustChangePassword === true,
  registrationCompleted: profile.registrationCompleted,
  onboardingStatus: profile.onboardingStatus || null,
  emailVerificationRequired: profile.emailVerificationRequired === true,
  faceVerification: profile.faceVerification || null,
  unique_id: profile.unique_id || null,
  managerStatus: profile.managerStatus || null,
  branchId: profile.branchId || null,
  requestedBranchId: profile.requestedBranchId || null,
});
let verifiedWebKey = null;
async function getPasswordApiKey() {
  const apiKey = process.env.FIREBASE_WEB_API_KEY || firebaseWebConfig.apiKey;
  if (!apiKey || (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== firebaseWebConfig.projectId)) {
    throw new Error('Firebase project configuration mismatch');
  }
  // An override may be a rotated key, but must still identify this project.
  // Otherwise Firebase can report valid BlueTap credentials as invalid in a
  // different project. Cache only successful configuration verification.
  if (apiKey !== firebaseWebConfig.apiKey &&
      (!verifiedWebKey || verifiedWebKey.key !== apiKey || verifiedWebKey.expiresAt <= Date.now())) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.timeout(15000),
    });
    const config = await response.json().catch(() => null);
    if (!response.ok || ![firebaseWebConfig.projectId, firebaseWebConfig.messagingSenderId].includes(String(config?.projectId || ''))) {
      stage('FIREBASE_CONFIGURATION_FAILED');
      throw new Error('Firebase Web API key project mismatch');
    }
    verifiedWebKey = { key: apiKey, expiresAt: Date.now() + 5 * 60 * 1000 };
  }
  return apiKey;
}
const parseBody = (req) => {
  if (typeof req.body !== 'string') return req.body || {};
  try { return JSON.parse(req.body); } catch { throw new OtpError(400, 'invalid-request', 'Invalid request.'); }
};

const ACCOUNT_FAILURE_THRESHOLD = 5;
const IP_ABUSE_THRESHOLD = 30;
const IP_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_RESET_MS = 15 * 60 * 1000;

function getAccountCooldownSeconds(failures) {
  if (failures <= 5) return 60;
  if (failures === 6) return 300;
  return 900;
}

function formatRetryDuration(seconds) {
  const total = Math.max(1, Math.round(Number(seconds)));
  if (total >= 60) {
    const mins = Math.ceil(total / 60);
    return `${mins} minute${mins === 1 ? '' : 's'}`;
  }
  return `${total} second${total === 1 ? '' : 's'}`;
}

function getRateLimitDocId(hashSecret, prefix, value) {
  if (!hashSecret) throw new Error('Missing login rate-limit configuration');
  return createHmac('sha256', hashSecret).update(`${prefix}:${value}`).digest('hex');
}

const millis = (val) => Number(val?.toMillis?.() || val?.getTime?.() || val || 0);

async function checkIpRateLimit({ db, ip, hashSecret, now = Date.now }) {
  if (!hashSecret) throw new Error('Missing login rate-limit configuration');
  const currentTime = now();
  const ipId = getRateLimitDocId(hashSecret, 'ip-login', ip);
  const ipRef = db.collection('authRateLimits').doc(ipId);

  await db.runTransaction(async (tx) => {
    const ipSnap = await tx.get(ipRef);
    const ipData = ipSnap.data() || {};
    const ipResetAt = millis(ipData.resetAt);
    const ipActive = ipResetAt > currentTime;
    const ipCount = ipActive ? Number(ipData.count || 0) : 0;
    if (ipCount >= IP_ABUSE_THRESHOLD) {
      const retryAfterSeconds = Math.max(1, Math.ceil((ipResetAt - currentTime) / 1000));
      throw new OtpError(
        429,
        'too-many-attempts',
        'Too many login attempts from this network. Please try again later.',
        { retryAfterSeconds, code: 'LOGIN_RATE_LIMITED' }
      );
    }
    tx.set(ipRef, {
      count: ipCount + 1,
      resetAt: new Date(ipActive ? ipResetAt : currentTime + IP_WINDOW_MS),
      type: 'ip',
    });
  });
}

async function checkAccountRateLimit({ db, targetId, hashSecret, now = Date.now }) {
  if (!hashSecret) throw new Error('Missing login rate-limit configuration');
  const currentTime = now();
  const accountId = getRateLimitDocId(hashSecret, 'account-login', targetId);
  const accountRef = db.collection('authRateLimits').doc(accountId);

  await db.runTransaction(async (tx) => {
    const accountSnap = await tx.get(accountRef);
    const accountData = accountSnap.data() || {};
    const blockedUntil = millis(accountData.blockedUntil);
    if (blockedUntil > currentTime) {
      const retryAfterSeconds = Math.max(1, Math.ceil((blockedUntil - currentTime) / 1000));
      throw new OtpError(
        429,
        'too-many-attempts',
        `Too many login attempts. Please try again in ${formatRetryDuration(retryAfterSeconds)}.`,
        { retryAfterSeconds, code: 'LOGIN_RATE_LIMITED' }
      );
    }
  });
}

async function checkLoginRateLimits({ db, ip, normalized, hashSecret, now = Date.now }) {
  await checkIpRateLimit({ db, ip, hashSecret, now });
  await checkAccountRateLimit({ db, targetId: normalized, hashSecret, now });
}

async function recordLoginFailure({ db, targetId, hashSecret, now = Date.now }) {
  if (!hashSecret || !targetId) return null;
  const currentTime = now();
  const accountId = getRateLimitDocId(hashSecret, 'account-login', targetId);
  const accountRef = db.collection('authRateLimits').doc(accountId);

  return await db.runTransaction(async (tx) => {
    const accountSnap = await tx.get(accountRef);
    const accountData = accountSnap.data() || {};

    const resetAt = millis(accountData.resetAt);
    const active = resetAt > currentTime;
    const previousFailures = active ? Number(accountData.count || 0) : 0;
    const newFailures = previousFailures + 1;

    let blockedUntil = null;
    let retryAfterSeconds = 0;
    if (newFailures >= ACCOUNT_FAILURE_THRESHOLD) {
      retryAfterSeconds = getAccountCooldownSeconds(newFailures);
      blockedUntil = new Date(currentTime + retryAfterSeconds * 1000);
    }

    tx.set(accountRef, {
      count: newFailures,
      blockedUntil,
      resetAt: new Date(active ? resetAt : currentTime + ACCOUNT_RESET_MS),
      type: 'account',
    });

    return {
      rateLimited: newFailures >= ACCOUNT_FAILURE_THRESHOLD,
      retryAfterSeconds,
    };
  });
}

async function recordLoginSuccess({ db, targetId, hashSecret }) {
  if (!hashSecret || !targetId) return;
  const accountId = getRateLimitDocId(hashSecret, 'account-login', targetId);
  const accountRef = db.collection('authRateLimits').doc(accountId);
  try {
    await db.runTransaction(async (tx) => {
      tx.set(accountRef, { count: 0, blockedUntil: null, resetAt: new Date(0), type: 'account' });
    });
  } catch (err) {
    console.warn('[public-login]', { stage: 'LOGIN_RATE_LIMIT_RESET_FAILED', error: err.message });
  }
}

async function checkUsername(db, username) {
  const normalized = normalizeUsername(username);
  const [claimed, reservation] = await Promise.all([
    db.collection('usernames').doc(normalized).get(),
    db.collection('usernameReservations').doc(normalized).get(),
  ]);
  const reservationData = reservation.data();
  const reserved = reservation.exists && Number(reservationData?.expiresAt?.toMillis?.() || reservationData?.expiresAt || 0) > Date.now();
  return { available: !claimed.exists && !reserved, normalizedUsername: normalized };
}

function createUsernameHandler(action, getAdmin = getFirebaseAdmin, { now = Date.now } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      const body = parseBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OtpError(400, 'invalid-request', 'Invalid request.');
      const { auth, db } = getAdmin();
      if (action === 'check') return res.status(200).json(await checkUsername(db, body.username));
      stage('REQUEST_RECEIVED');
      const portal = body.portal || 'public';
      if (!['public', 'admin', 'unified'].includes(portal) || typeof body.username !== 'string' ||
          typeof body.password !== 'string' || !body.password || body.password.length > 128) {
        throw new OtpError(400, 'invalid-request', 'Enter your username or email and password.');
      }
      let normalized;
      const isEmail = body.username.includes('@');
      if (isEmail) {
        normalized = body.username.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new OtpError(400, 'invalid-request', 'Enter a valid email address.');
      } else {
        try { normalized = normalizeUsername(body.username); } catch { throw genericLogin(); }
      }
      // 1. Check IP Abuse
      await checkIpRateLimit({
        db,
        ip: getClientIp(req),
        hashSecret: process.env.EMAIL_OTP_HASH_SECRET,
        now,
      });

      // 2. Safe server-side identifier resolution to determine canonical account identity
      let expectedUid;
      let user;
      if (isEmail) {
        user = await auth.getUserByEmail(normalized).catch((error) => {
          if (error.code === 'auth/user-not-found') return null;
          throw error;
        });
        if (user) expectedUid = user.uid;
      } else {
        const registry = await db.collection('usernames').doc(normalized).get();
        if (registry.exists) {
          expectedUid = registry.data()?.uid;
          if (typeof expectedUid !== 'string' || !expectedUid || expectedUid.includes('/')) throw mappingError();
          user = await auth.getUser(expectedUid).catch((error) => {
            if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-uid') throw mappingError();
            throw error;
          });
        }
      }

      // Canonical account identifier: Firebase UID for existing accounts, normalized identifier fallback for unknown accounts
      const canonicalAccountId = expectedUid || normalized;

      // 3. Primary Account Cooldown Check (shared across username & email for the same real account)
      await checkAccountRateLimit({
        db,
        targetId: canonicalAccountId,
        hashSecret: process.env.EMAIL_OTP_HASH_SECRET,
        now,
      });

      // 4. Handle non-existent account with generic response and failure recording
      if (!user || !expectedUid) {
        const failResult = await recordLoginFailure({
          db,
          targetId: canonicalAccountId,
          hashSecret: process.env.EMAIL_OTP_HASH_SECRET,
          now,
        });
        if (failResult?.rateLimited) {
          throw new OtpError(
            429,
            'too-many-attempts',
            `Too many login attempts. Please try again in ${formatRetryDuration(failResult.retryAfterSeconds)}.`,
            { retryAfterSeconds: failResult.retryAfterSeconds, code: 'LOGIN_RATE_LIMITED' }
          );
        }
        throw genericLogin();
      }

      if (user.uid !== expectedUid) throw mappingError();
      if (!user.email) throw setupError();
      stage('USERNAME_RESOLVED', { expectedUid });
      // Firebase Web API keys identify the public Firebase project and are
      // already shipped in every Firebase client. Prefer an environment
      // override, but keep the server and client on the same checked-in public
      // project config so username login cannot fail solely from a missing env.
      const apiKey = await getPasswordApiKey();
      stage('FIREBASE_AUTH_STARTED');
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: body.password, returnSecureToken: true }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const providerCode = String(result?.error?.message || '').split(/[ :]/)[0];
        if (['INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'EMAIL_NOT_FOUND'].includes(providerCode)) {
          const failResult = await recordLoginFailure({
            db,
            targetId: canonicalAccountId,
            hashSecret: process.env.EMAIL_OTP_HASH_SECRET,
            now,
          });
          if (failResult?.rateLimited) {
            throw new OtpError(
              429,
              'too-many-attempts',
              `Too many login attempts. Please try again in ${formatRetryDuration(failResult.retryAfterSeconds)}.`,
              { retryAfterSeconds: failResult.retryAfterSeconds, code: 'LOGIN_RATE_LIMITED' }
            );
          }
          throw genericLogin();
        }
        if (providerCode === 'USER_DISABLED') throw new OtpError(403, 'account-disabled', 'This account is disabled. Please contact support.');
        if (providerCode === 'TOO_MANY_ATTEMPTS_TRY_LATER' || response.status === 429) {
          throw new OtpError(429, 'too-many-attempts', 'Too many login attempts. Please try again later.', { code: 'LOGIN_RATE_LIMITED', retryAfterSeconds: 300 });
        }
        throw new Error('Firebase password provider unavailable');
      }
      if (!result?.localId || !result?.idToken) throw new Error('Invalid Firebase response');
      if (result.localId !== expectedUid) {
        loginDiagnostic('USERNAME_UID_MISMATCH', { expectedUid, authenticatedUid: result.localId });
        throw mappingError();
      }
      // Verify project/audience as well as UID before minting a custom token.
      const verified = await auth.verifyIdToken(result.idToken);
      if (verified.uid !== expectedUid) {
        loginDiagnostic('USERNAME_UID_MISMATCH', { expectedUid, authenticatedUid: verified.uid });
        throw mappingError();
      }
      if (user.disabled) throw new OtpError(403, 'account-disabled', 'This account is disabled. Please contact support.');
      stage('FIREBASE_AUTH_SUCCESS');
      loginDiagnostic('LOGIN_AUTH_UID', { uid: verified.uid });
      stage('PROFILE_CHECK_STARTED');
      const profile = (await db.collection('users').doc(expectedUid).get()).data();
      if (!profile || !['requester', 'distributor', 'admin', 'manager'].includes(profile.role)) throw setupError();
      if ((profile.uid && profile.uid !== expectedUid) ||
          (!isEmail && profile.usernameNormalized && profile.usernameNormalized !== normalized)) throw mappingError();
      loginDiagnostic('LOGIN_PROFILE_UID', { uid: expectedUid });
      loginDiagnostic('LOGIN_PROFILE_ROLE', { uid: expectedUid, role: profile.role });
      stage('ROLE_IDENTIFIED');
      const administrator = profile.role === 'admin' || user.customClaims?.admin === true || user.customClaims?.role === 'admin';
      if (['public', 'unified'].includes(portal) && administrator) {
        stage('PRIVILEGED_ACCOUNT');
        throw new OtpError(403, 'privileged-login-required', 'This account must use the Administrator sign-in portal.');
      }
      if (!['public', 'unified'].includes(portal) && profile.role !== portal) throw new OtpError(403, 'portal-role-mismatch', 'This account cannot use this sign-in portal.');
      // Reset account failed attempts upon successful authentication.
      await recordLoginSuccess({ db, targetId: expectedUid, hashSecret: process.env.EMAIL_OTP_HASH_SECRET });
      // Onboarding/approval is a routing decision after authentication.
      const customToken = await auth.createCustomToken(expectedUid);
      stage('SUCCESS');
      return res.status(200).json({ customToken, profile: publicProfile(profile, expectedUid, user.email) });
    } catch (error) {
      const known = error instanceof OtpError;
      if (error.reason === 'invalid-credential') stage('INVALID_CREDENTIALS');
      if (error.reason === 'account-mapping-invalid') stage('MAPPING_INVALID');
      if (!known) console.error('Username auth request failed', { code: 'USERNAME_AUTH_ERROR' });
      const status = known ? error.status : 503;
      const reason = known ? error.reason : 'service-unavailable';
      const message = known ? error.message : 'Login is temporarily unavailable. Please try again.';
      const retryAfterSeconds = error.details?.retryAfterSeconds;
      const code = status === 429
        ? 'LOGIN_RATE_LIMITED'
        : (known ? errorCodes[reason] || 'INVALID_REQUEST' : 'SERVER_ERROR');

      if (status === 429) {
        return res.status(429).json({
          code: 'LOGIN_RATE_LIMITED',
          ...(retryAfterSeconds != null ? { retryAfterSeconds } : {}),
          error: {
            code: 'LOGIN_RATE_LIMITED',
            reason,
            message,
            ...(retryAfterSeconds != null ? { retryAfterSeconds } : {}),
          },
        });
      }

      return res.status(status).json({ error: {
        code,
        reason,
        message,
      } });
    }
  };
}

module.exports = {
  createUsernameHandler,
  checkUsername,
  checkIpRateLimit,
  checkAccountRateLimit,
  checkLoginRateLimits,
  recordLoginFailure,
  recordLoginSuccess,
  getAccountCooldownSeconds,
  formatRetryDuration,
  ACCOUNT_FAILURE_THRESHOLD,
  IP_ABUSE_THRESHOLD,
};
