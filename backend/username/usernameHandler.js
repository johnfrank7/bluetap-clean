const { createHmac } = require('node:crypto');
const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { OtpError } = require('../utils/otpError');
const { normalizeUsername } = require('./username');

const genericLogin = () => new OtpError(401, 'invalid-credential', 'Invalid username or password.');
const parseBody = (req) => {
  if (typeof req.body !== 'string') return req.body || {};
  try { return JSON.parse(req.body); } catch { throw new OtpError(400, 'invalid-request', 'Invalid request.'); }
};
const clientIp = (req) => process.env.VERCEL
  ? String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim()
  : req.socket?.remoteAddress || 'local';

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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      const body = parseBody(req);
      const { auth, db } = getAdmin();
      if (action === 'check') return res.status(200).json(await checkUsername(db, body.username));
      let normalized;
      try { normalized = normalizeUsername(body.username); } catch { throw genericLogin(); }
      if (typeof body.password !== 'string' || !body.password || body.password.length > 128) throw genericLogin();
      await limitLogin(db, clientIp(req), process.env.EMAIL_OTP_HASH_SECRET);
      const registry = await db.collection('usernames').doc(normalized).get();
      if (!registry.exists || typeof registry.data()?.uid !== 'string') throw genericLogin();
      const expectedUid = registry.data().uid;
      const user = await auth.getUser(expectedUid).catch(() => { throw genericLogin(); });
      if (user.disabled || !user.email) throw genericLogin();
      const apiKey = process.env.FIREBASE_WEB_API_KEY;
      if (!apiKey) throw new Error('Missing Firebase Web API configuration');
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: body.password, returnSecureToken: true }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.localId !== expectedUid) throw genericLogin();
      return res.status(200).json({ customToken: await auth.createCustomToken(expectedUid) });
    } catch (error) {
      const known = error instanceof OtpError;
      if (!known) console.error('Username auth request failed', { code: 'USERNAME_AUTH_ERROR' });
      return res.status(known ? error.status : 503).json({ error: {
        reason: known ? error.reason : 'service-unavailable',
        message: known ? error.message : 'Login service is temporarily unavailable. Please try again.',
      } });
    }
  };
}

module.exports = { createUsernameHandler, checkUsername };
