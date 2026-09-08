const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const { createEmailOtpService } = require('./emailOtp');
const { OtpError } = require('./otpError');

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
  function challengeFor(email) {
    const payload = Buffer.from(JSON.stringify({ email, expires: now() + 3600000, nonce: randomUUID() })).toString('base64url');
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
    return normalizeEmail(data.email);
  }
  async function findUser(email) {
    try { return await auth.getUserByEmail(email); }
    catch (error) { if (error.code === 'auth/user-not-found') return null; throw error; }
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
    return { firstName: text('firstName', 100), lastName: text('lastName', 100),
      barangay: text('barangay', 150), phone, role };
  }
  async function saveProfile(user, profile) {
    const ref = db.collection('users').doc(user.uid);
    const counter = db.collection('counters').doc('unique_ids');
    await db.runTransaction(async (tx) => {
      const existing = (await tx.get(ref)).data();
      const counts = (await tx.get(counter)).data() || {};
      if (existing) {
        // Recover an unfinished registration without changing permissions or approval.
        if (!['requester', 'distributor'].includes(existing.role)) {
          throw new OtpError(409, 'account-exists', 'This account already exists. Please log in.');
        }
        tx.update(ref, { emailVerified: true, emailVerifiedAt: new Date(now()) });
        return;
      }
      const number = Number(counts[profile.role] || 0) + 1;
      const prefix = profile.role === 'requester' ? 'REQ' : 'DIS';
      const pending = profile.role === 'distributor';
      tx.set(counter, { [profile.role]: number }, { merge: true });
      tx.set(ref, {
        ...profile, uid: user.uid, email: user.email, address: profile.barangay,
        unique_id: `${prefix}-${String(number).padStart(6, '0')}`,
        approvalStatus: pending ? 'pending' : 'approved', status: pending ? 'Pending' : 'Approved',
        rejectionReason: null, emailVerificationRequired: true, emailVerified: true,
        createdAt: new Date(now()), emailVerifiedAt: new Date(now()),
        faceVerification: { status: 'unverified', verifiedAt: null, verificationId: null,
          livenessPassed: null, duplicateCheck: 'unknown', failureReason: null },
      });
    });
  }
  async function finish(email, input) {
    const profile = validateProfile(input);
    let user = await findUser(email);
    const created = !user;
    if (user) {
      const existing = (await db.collection('users').doc(user.uid).get()).data();
      if (user.disabled || user.emailVerified || (existing && !['requester', 'distributor'].includes(existing.role))) {
        throw new OtpError(409, 'account-exists', 'This account already exists. Please log in or reset your password.');
      }
    } else {
      // This is reached only after the OTP hash was successfully checked and consumed.
      user = await auth.createUser({ email, password: input.password, emailVerified: true });
    }
    try {
      await saveProfile(user, profile);
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
  function otpFor(email, input) {
    const uid = 'registration-' + digest('email:' + email);
    // Pending identity adapter: no Firebase account exists or is created on request.
    const pending = {
      getUser: async () => ({ uid, email, emailVerified: false }),
      updateUser: async () => ({ registrationResult: await finish(email, input) }),
    };
    return { uid, service: createEmailOtpService({ auth: pending, db, sendEmailOtp, hashSecret, now }) };
  }
  async function limitIp(ip) {
    const ref = db.collection('emailOtpVerifications').doc('registration-ip-' + digest('ip:' + ip));
    await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data() || {};
      const time = now();
      const active = Number(data.resetAt) > time;
      if (active && data.count >= 20) throw new OtpError(429, 'resend-limit-reached', 'Too many signup requests. Please try again later.');
      tx.set(ref, { count: active ? Number(data.count || 0) + 1 : 1, resetAt: active ? data.resetAt : time + 3600000 });
    });
  }
  async function request(email, ip) {
    email = normalizeEmail(email);
    await limitIp(ip);
    const otp = otpFor(email);
    const result = await otp.service.request(otp.uid);
    return { ...result, challenge: challengeFor(email) };
  }
  async function complete(challenge, code, input) {
    const email = readChallenge(challenge);
    validateProfile(input);
    const otp = otpFor(email, input);
    return otp.service.verify(otp.uid, code);
  }
  return { request, complete };
}
module.exports = { createRegistrationService };
