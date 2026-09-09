const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const { createEmailOtpService } = require('./emailOtp');
const { OtpError } = require('./otpError');
const { normalizeUsername } = require('./username');

const RESERVATION_TTL = 15 * 60 * 1000;

function createRegistrationService({ auth, db, sendEmailOtp, hashSecret, now = Date.now }) {
  const digest = (value) => {
    if (!hashSecret) throw new Error('Missing registration signing configuration');
    return createHmac('sha256', hashSecret).update(value).digest('hex');
  };
  const normalizeEmail = (value) => {
    if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      throw new OtpError(400, 'invalid-registration', 'Please enter a valid email address.');
    }
    return value.trim().toLowerCase();
  };
  function challengeFor(email, usernameNormalized) {
    const payload = Buffer.from(JSON.stringify({ email, usernameNormalized, expires: now() + RESERVATION_TTL, nonce: randomUUID() })).toString('base64url');
    return `${payload}.${digest('registration:' + payload)}`;
  }
  function readChallenge(challenge) {
    const invalid = () => new OtpError(400, 'registration-expired', 'Please return to signup and request a new code.');
    if (typeof challenge !== 'string' || challenge.length > 2048) throw invalid();
    const [payload, signature, extra] = challenge.split('.');
    if (extra || !payload || !/^[a-f0-9]{64}$/.test(signature || '')) throw invalid();
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(digest('registration:' + payload), 'hex'))) throw invalid();
    let data;
    try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw invalid(); }
    if (!Number.isFinite(data.expires) || now() >= data.expires) throw invalid();
    return { email: normalizeEmail(data.email), usernameNormalized: normalizeUsername(data.usernameNormalized) };
  }
  async function findUser(email) {
    try { return await auth.getUserByEmail(email); }
    catch (error) { if (error.code === 'auth/user-not-found') return null; throw error; }
  }
  async function checkExistingAccount(user) {
    if (!user) return;
    const existing = (await db.collection('users').doc(user.uid).get()).data();
    if (user.disabled || user.emailVerified || (existing && !['requester', 'distributor'].includes(existing.role))) {
      throw new OtpError(409, 'account-exists', 'This email is already registered. Please log in or reset your password.');
    }
  }
  function validateProfile(input) {
    const text = (key, limit) => {
      if (typeof input?.[key] !== 'string' || !input[key].trim() || input[key].length > limit) {
        throw new OtpError(400, 'invalid-registration', 'Please return to signup and check your details.');
      }
      return input[key].trim();
    };
    const role = input?.role;
    if (!['requester', 'distributor'].includes(role)) throw new OtpError(400, 'invalid-registration', 'Choose a valid account type.');
    const phone = text('phone', 13);
    if (!/^\+639\d{9}$/.test(phone)) throw new OtpError(400, 'invalid-registration', 'Enter a valid Philippine mobile number.');
    if (typeof input.password !== 'string' || input.password.trim().length < 8 || input.password.length > 128) {
      throw new OtpError(400, 'invalid-registration', 'Password must be between 8 and 128 characters.');
    }
    const username = text('username', 20);
    const usernameNormalized = normalizeUsername(username);
    return { firstName: text('firstName', 100), lastName: text('lastName', 100),
      barangay: text('barangay', 150), address: text('address', 250), phone, role,
      username, usernameNormalized };
  }
  async function saveProfile(user, profile, email) {
    const ref = db.collection('users').doc(user.uid);
    const counter = db.collection('counters').doc('unique_ids');
    const usernameRef = db.collection('usernames').doc(profile.usernameNormalized);
    const reservationRef = db.collection('usernameReservations').doc(profile.usernameNormalized);
    await db.runTransaction(async (tx) => {
      const existing = (await tx.get(ref)).data();
      const counts = (await tx.get(counter)).data() || {};
      const claimed = (await tx.get(usernameRef)).data();
      const reservation = (await tx.get(reservationRef)).data();
      const ownerHash = digest('email:' + email);
      if ((claimed?.uid && claimed.uid !== user.uid) || reservation?.ownerHash !== ownerHash || Number(reservation?.expiresAt?.toMillis?.() || reservation?.expiresAt || 0) <= now()) {
        throw new OtpError(409, 'username-taken', 'This username is already taken.');
      }
      tx.set(usernameRef, { uid: user.uid, createdAt: new Date(now()) });
      tx.delete(reservationRef);
      if (existing) {
        // Recover an unfinished registration without changing permissions or approval.
        if (!['requester', 'distributor'].includes(existing.role)) {
          throw new OtpError(409, 'account-exists', 'This account already exists. Please log in.');
        }
        if (existing.usernameNormalized && existing.usernameNormalized !== profile.usernameNormalized) {
          throw new OtpError(409, 'account-exists', 'This account already exists. Please log in.');
        }
        tx.update(ref, { emailVerified: true, emailVerifiedAt: new Date(now()),
          updatedAt: new Date(now()), username: profile.username, usernameNormalized: profile.usernameNormalized });
        return;
      }
      const number = Number(counts[profile.role] || 0) + 1;
      const prefix = profile.role === 'requester' ? 'REQ' : 'DIS';
      const pending = profile.role === 'distributor';
      tx.set(counter, { [profile.role]: number }, { merge: true });
      tx.set(ref, {
        ...profile, uid: user.uid, email: user.email,
        unique_id: `${prefix}-${String(number).padStart(6, '0')}`,
        approvalStatus: pending ? 'pending' : 'approved', status: pending ? 'Pending' : 'Approved',
        rejectionReason: null, emailVerificationRequired: true, emailVerified: true,
        createdAt: new Date(now()), updatedAt: new Date(now()), emailVerifiedAt: new Date(now()),
        faceVerification: { status: 'unverified', verifiedAt: null, verificationId: null,
          livenessPassed: null, duplicateCheck: 'unknown', failureReason: null },
      });
    });
  }
  async function finish(email, usernameNormalized, input) {
    const profile = validateProfile(input);
    if (profile.usernameNormalized !== usernameNormalized) {
      throw new OtpError(400, 'invalid-registration', 'Username changed. Please request a new verification code.');
    }
    let user = await findUser(email);
    const created = !user;
    if (user) {
      await checkExistingAccount(user);
    } else {
      // This is reached only after the OTP hash was successfully checked and consumed.
      user = await auth.createUser({ email, password: input.password, emailVerified: true });
    }
    try {
      await saveProfile(user, profile, email);
    } catch (error) {
      // Only roll back a new account if its profile definitely does not exist.
      if (created) {
        const saved = await db.collection('users').doc(user.uid).get();
        if (!saved.exists) await auth.deleteUser(user.uid);
      }
      throw error;
    }
    if (!created) {
      // Correct email OTP establishes ownership of this old unverified signup.
      await auth.updateUser(user.uid, { emailVerified: true, password: input.password });
    }
    return { customToken: await auth.createCustomToken(user.uid) };
  }
  function otpFor(email, usernameNormalized, input) {
    const uid = 'registration-' + digest('email:' + email);
    // Pending identity adapter: no Firebase account exists or is created on request.
    const pending = {
      getUser: async () => ({ uid, email, emailVerified: false }),
      updateUser: async () => ({ registrationResult: await finish(email, usernameNormalized, input) }),
    };
    return { uid, service: createEmailOtpService({ auth: pending, db, sendEmailOtp, hashSecret, now }) };
  }
  async function reserveUsername(email, usernameNormalized) {
    const registryRef = db.collection('usernames').doc(usernameNormalized);
    const reservationRef = db.collection('usernameReservations').doc(usernameNormalized);
    const ownerHash = digest('email:' + email);
    await db.runTransaction(async (tx) => {
      const claimed = await tx.get(registryRef);
      const reservation = (await tx.get(reservationRef)).data();
      const active = Number(reservation?.expiresAt?.toMillis?.() || reservation?.expiresAt || 0) > now();
      if (claimed.exists || (active && reservation.ownerHash !== ownerHash)) {
        throw new OtpError(409, 'username-taken', 'This username is already taken.');
      }
      tx.set(reservationRef, { ownerHash, expiresAt: new Date(now() + RESERVATION_TTL), createdAt: new Date(now()) });
    });
  }
  async function limitIp(ip) {
    const ref = db.collection('emailOtpVerifications').doc('registration-ip-' + digest('ip:' + ip));
    await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data() || {};
      const time = now();
      const active = Number(data.resetAt) > time;
      if (active && data.count >= 20) throw new OtpError(429, 'resend-limit-reached', 'Too many signup requests. Please wait before trying again.', {
        retryAfterSeconds: Math.ceil((Number(data.resetAt) - time) / 1000),
      });
      tx.set(ref, { count: active ? Number(data.count || 0) + 1 : 1, resetAt: active ? data.resetAt : time + 3600000 });
    });
  }
  async function request(email, username, ip) {
    email = normalizeEmail(email);
    await checkExistingAccount(await findUser(email));
    const usernameNormalized = normalizeUsername(username);
    await limitIp(ip);
    await reserveUsername(email, usernameNormalized);
    const otp = otpFor(email, usernameNormalized);
    const result = await otp.service.request(otp.uid);
    return { ...result, challenge: challengeFor(email, usernameNormalized) };
  }
  async function complete(challenge, code, input) {
    const { email, usernameNormalized } = readChallenge(challenge);
    validateProfile(input);
    const otp = otpFor(email, usernameNormalized, input);
    return otp.service.verify(otp.uid, code);
  }
  return { request, complete };
}
module.exports = { createRegistrationService };
