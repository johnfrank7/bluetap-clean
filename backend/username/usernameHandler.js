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
  approvalStatus: profile.approvalStatus || profile.status || null,
  status: profile.status || profile.approvalStatus || null,
  rejectionReason: profile.rejectionReason || null,
  registrationCompleted: profile.registrationCompleted,
  onboardingStatus: profile.onboardingStatus || null,
  emailVerificationRequired: profile.emailVerificationRequired === true,
  faceVerification: profile.faceVerification || null,
  unique_id: profile.unique_id || null,
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

async function limitLogin(db, ip, hashSecret) {
  if (!hashSecret) throw new Error('Missing login rate-limit configuration');
  const id = createHmac('sha256', hashSecret).update('username-login:' + ip).digest('hex');
  const ref = db.collection('authRateLimits').doc(id);
  await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data() || {};
    const now = Date.now();
    const active = Number(data.resetAt?.toMillis?.() || data.resetAt || 0) > now;
    const count = active ? Number(data.count || 0) : 0;
    if (count >= 10) throw new OtpError(429, 'too-many-attempts', 'Too many login attempts. Please try again later.');
    tx.set(ref, { count: count + 1, resetAt: new Date(active ? Number(data.resetAt?.toMillis?.() || data.resetAt) : now + 15 * 60 * 1000) });
  });
}

function createUsernameHandler(action, getAdmin = getFirebaseAdmin) {
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
      if (!['public', 'admin', 'manager', 'unified'].includes(portal) || typeof body.username !== 'string' ||
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
      await limitLogin(db, getClientIp(req), process.env.EMAIL_OTP_HASH_SECRET);
      let expectedUid;
      let user;
      if (isEmail) {
        user = await auth.getUserByEmail(normalized).catch((error) => {
          if (error.code === 'auth/user-not-found') throw genericLogin();
          throw error;
        });
        expectedUid = user.uid;
      } else {
        const registry = await db.collection('usernames').doc(normalized).get();
        if (!registry.exists) throw genericLogin();
        expectedUid = registry.data()?.uid;
        if (typeof expectedUid !== 'string' || !expectedUid || expectedUid.includes('/')) throw mappingError();
        user = await auth.getUser(expectedUid).catch((error) => {
          if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-uid') throw mappingError();
          throw error;
        });
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
        if (['INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'EMAIL_NOT_FOUND'].includes(providerCode)) throw genericLogin();
        if (providerCode === 'USER_DISABLED') throw new OtpError(403, 'account-disabled', 'This account is disabled. Please contact support.');
        if (providerCode === 'TOO_MANY_ATTEMPTS_TRY_LATER' || response.status === 429) {
          throw new OtpError(429, 'too-many-attempts', 'Too many login attempts. Please try again later.');
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
      const privileged = ['admin', 'manager'].includes(profile.role) || user.customClaims?.admin === true ||
        user.customClaims?.manager === true || ['admin', 'manager'].includes(user.customClaims?.role);
      if (['public', 'unified'].includes(portal) && privileged) {
        stage('PRIVILEGED_ACCOUNT');
        throw new OtpError(403, 'privileged-login-required', 'This account must use its authorized sign-in portal.');
      }
      if (!['public', 'unified'].includes(portal) && profile.role !== portal) throw new OtpError(403, 'portal-role-mismatch', 'This account cannot use this sign-in portal.');
      // Onboarding/approval is a routing decision after authentication.
      const customToken = await auth.createCustomToken(expectedUid);
      stage('SUCCESS');
      return res.status(200).json({ customToken, profile: publicProfile(profile, expectedUid, user.email) });
    } catch (error) {
      const known = error instanceof OtpError;
      if (error.reason === 'invalid-credential') stage('INVALID_CREDENTIALS');
      if (error.reason === 'account-mapping-invalid') stage('MAPPING_INVALID');
      if (!known) console.error('Username auth request failed', { code: 'USERNAME_AUTH_ERROR' });
      return res.status(known ? error.status : 503).json({ error: {
        code: known ? errorCodes[error.reason] || 'INVALID_REQUEST' : 'SERVER_ERROR',
        reason: known ? error.reason : 'service-unavailable',
        message: known ? error.message : 'Login is temporarily unavailable. Please try again.',
      } });
    }
  };
}

module.exports = { createUsernameHandler, checkUsername };
