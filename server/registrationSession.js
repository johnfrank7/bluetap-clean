const { createHmac, randomUUID } = require('node:crypto');
const { OtpError } = require('./otpError');

const SESSION_TTL = 60 * 60 * 1000;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMS_VERSION = '1.0';
const PRIVACY_VERSION = '1.0';
const isRegistrationFaceVerified = (face = {}) => face.status === 'verified' &&
  face.providerVerified === true && face.livenessPassed === true &&
  face.duplicateCheck === 'clear' && typeof face.verificationReference === 'string' &&
  face.verificationReference.length > 0;
const millis = (value) => value?.toMillis?.() || (value instanceof Date ? value.getTime() : Number(value) || 0);

const sessionError = () => new OtpError(400, 'registration-session-expired', 'This registration session has expired. Please restart signup.');
const sessionRef = (db, id) => {
  if (typeof id !== 'string' || !SESSION_ID.test(id)) throw sessionError();
  return db.collection('registrationSessions').doc(id);
};

async function readRegistrationSession(db, id, now = Date.now) {
  const ref = sessionRef(db, id);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!snapshot.exists || data?.completed === true || millis(data?.expiresAt) <= now()) throw sessionError();
  return { ref, data };
}

function validatePersonalInfo(input) {
  const required = ['firstName', 'lastName', 'barangay', 'address'];
  if (!['requester', 'distributor'].includes(input?.role) || required.some((key) => typeof input?.[key] !== 'string' || !input[key].trim())) {
    throw new OtpError(400, 'invalid-registration', 'Complete your personal information before identity verification.');
  }
  if (!/^\+639\d{9}$/.test(input.phone || '')) throw new OtpError(400, 'invalid-registration', 'Enter a valid Philippine mobile number.');
}

function createRegistrationSessionService({ db, hashSecret, now = Date.now }) {
  const digest = (value) => {
    if (!hashSecret) throw new Error('Missing registration session configuration');
    return createHmac('sha256', hashSecret).update(value).digest('hex');
  };
  async function limit(ip) {
    const ref = db.collection('authRateLimits').doc(digest('registration-session:' + ip));
    await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data() || {};
      const time = now();
      const active = millis(data.resetAt) > time;
      const count = active ? Number(data.count || 0) : 0;
      if (count >= 20) throw new OtpError(429, 'too-many-attempts', 'Too many registration attempts. Please try again later.');
      tx.set(ref, { count: count + 1, resetAt: new Date(active ? millis(data.resetAt) : time + 60 * 60 * 1000) });
    });
  }
  async function create(input, ip) {
    validatePersonalInfo(input);
    await limit(ip);
    const id = randomUUID();
    const time = now();
    await db.collection('registrationSessions').doc(id).set({
      role: input.role,
      personalInfoCompleted: true,
      personalInfoDigest: digest(JSON.stringify([input.role, input.firstName.trim(), input.lastName.trim(), input.phone, input.barangay.trim(), input.address.trim()])),
      faceVerification: { status: 'unverified', verifiedAt: null, duplicateCheck: 'unknown', verificationReference: null, livenessPassed: null },
      emailVerified: false,
      termsAcceptance: null,
      completed: false,
      createdAt: new Date(time),
      expiresAt: new Date(time + SESSION_TTL),
    });
    return { registrationSessionId: id, expiresAt: time + SESSION_TTL };
  }
  async function status(id) {
    const { data } = await readRegistrationSession(db, id, now);
    const face = data.faceVerification || {};
    return { faceVerification: {
      status: ['unverified', 'pending', 'temporary', 'verified', 'review_required', 'failed'].includes(face.status) ? face.status : 'unverified',
      duplicateCheck: ['unknown', 'clear', 'flagged'].includes(face.duplicateCheck) ? face.duplicateCheck : 'unknown',
      livenessPassed: face.livenessPassed === true,
    }, expiresAt: millis(data.expiresAt) };
  }
  async function start(id) {
    await readRegistrationSession(db, id, now);
    throw new OtpError(409, 'face-reference-required', 'Use face verification with a reference photo and a current photo.');
  }

  async function acceptTerms(id) {
    const ref = sessionRef(db, id);
    await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data();
      if (!data || data.completed || millis(data.expiresAt) <= now()) throw sessionError();
      if (!isRegistrationFaceVerified(data.faceVerification)) {
        throw new OtpError(403, 'face-verification-required', 'Complete identity verification before accepting the registration terms.');
      }
      tx.update(ref, { termsAcceptance: { accepted: true, acceptedAt: new Date(now()), termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION } });
    });
    return { accepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION };
  }
  return { create, status, start, acceptTerms };
}

// Trusted provider/backend integration only. Never expose this directly as a
// public endpoint and never accept these values from the registration browser.
async function setTrustedFaceVerification(db, id, result, now = Date.now) {
  const ref = sessionRef(db, id);
  const allowed = result?.livenessPassed === true && result?.duplicateCheck === 'clear';
  const status = result?.duplicateCheck === 'flagged' ? 'review_required' : allowed ? 'verified' : 'failed';
  await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.completed || millis(data.expiresAt) <= now()) throw sessionError();
    tx.update(ref, { faceVerification: {
      status,
      verifiedAt: allowed ? new Date(now()) : null,
      duplicateCheck: result?.duplicateCheck === 'flagged' ? 'flagged' : result?.duplicateCheck === 'clear' ? 'clear' : 'unknown',
      verificationReference: typeof result?.verificationReference === 'string' ? result.verificationReference.slice(0, 200) : null,
      livenessPassed: result?.livenessPassed === true,
      verificationMode: 'provider',
      providerVerified: allowed,
    } });
  });
}

module.exports = { createRegistrationSessionService, readRegistrationSession, setTrustedFaceVerification, isRegistrationFaceVerified, TERMS_VERSION, PRIVACY_VERSION };
