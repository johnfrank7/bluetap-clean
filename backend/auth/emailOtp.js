const { createHmac, randomInt, randomUUID, timingSafeEqual } = require('node:crypto');
const { OtpError } = require('../utils/otpError');
const { ACCOUNT_STATUS, canonicalAccountStatus } = require('./accountStatus');

const EXPIRY = 10 * 60 * 1000;
const COOLDOWN = 60 * 1000;
const WINDOW = 60 * 60 * 1000;
const MAX_SENDS = 6; // Initial code plus five resends per hour, including failed sends.
const millis = (value) => value?.toMillis?.() || (value instanceof Date ? value.getTime() : 0);
const unavailable = () => new OtpError(503, 'EMAIL_SEND_FAILED', 'Verification email could not be sent. Please try again.');
const missingSecret = () => new OtpError(503, 'OTP_SECRET_MISSING', 'Email verification is not configured. Please contact support.');
const cleanEmail = (value) => (value || '').toString().trim().toLowerCase();

function assertEligibleProfileData(profile, authEmail) {
  if (!profile) {
    throw new OtpError(403, 'PROFILE_MISSING', 'Account profile is not available.');
  }
  if (profile.accountActionHoldIntentId) {
    throw new OtpError(403, 'ACCOUNT_ACTION_PENDING', 'An account access change is pending.');
  }
  if (canonicalAccountStatus(profile) !== ACCOUNT_STATUS.ACTIVE) {
    throw new OtpError(403, 'ACCOUNT_NOT_ACTIVE', 'This account is not active.');
  }
  if (profile.role === 'manager' && String(profile.managerStatus || 'active').trim().toLowerCase() !== 'active') {
    throw new OtpError(403, 'MANAGER_INACTIVE', 'This Manager account is inactive.');
  }
  if (profile.role === 'distributor') {
    const distStatus = String(profile.distributorStatus || profile.approvalStatus || profile.status || 'active').trim().toLowerCase();
    if (['rejected', 'suspended', 'inactive', 'terminated'].includes(distStatus)) {
      throw new OtpError(403, 'DISTRIBUTOR_NOT_ACTIVE', 'This Distributor account is not active.');
    }
  }
  if (profile.mustChangePassword === true) {
    throw new OtpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password before verifying your email.');
  }
  if (profile.email && cleanEmail(profile.email) !== cleanEmail(authEmail)) {
    throw new OtpError(409, 'EMAIL_MISMATCH', 'Your account email changed. Please sign in again.');
  }
}

function createEmailOtpService({ auth, db, sendEmailOtp, hashSecret, now = Date.now, allowConsumedRetry = false, onStage = () => {} }) {
  function hash(uid, email, code) {
    if (!hashSecret) throw missingSecret();
    return createHmac('sha256', hashSecret).update(JSON.stringify([uid, email, code])).digest('hex');
  }
  async function userFor(uid) {
    const user = await auth.getUser(uid);
    if (user.disabled || !user.email) throw new OtpError(401, 'unauthenticated', 'Please log in again.');
    return user;
  }
  function hasFirestoreProfileSupport(uid, otpRef) {
    if (allowConsumedRetry || typeof db?.collection !== 'function' || typeof db?.runTransaction !== 'function') return false;
    const resolvedOtpRef = otpRef || db.collection('emailOtpVerifications')?.doc?.(uid);
    return typeof resolvedOtpRef?.get === 'function';
  }
  async function assertEligibleUserProfile(uid, email, otpRef) {
    if (!hasFirestoreProfileSupport(uid, otpRef)) return;
    const snapshot = await db.collection('users').doc(uid).get();
    assertEligibleProfileData(snapshot?.exists ? snapshot.data() : null, email);
  }
  async function repairUnreconciledAuthIfNeeded(uid, otpRef) {
    if (!hasFirestoreProfileSupport(uid, otpRef)) return false;
    const resolvedOtpRef = otpRef || db.collection('emailOtpVerifications').doc(uid);
    const otpSnap = await resolvedOtpRef.get();
    const otpData = otpSnap?.data?.() || {};
    const isUnreconciled = otpData.status === 'reconciliation-failed'
      || (otpData.status === 'consumed' && otpData.profileSynced === false);
    if (!isUnreconciled) return false;
    await auth.updateUser(uid, { emailVerified: false });
    await resolvedOtpRef.set({
      status: 'rolled-back',
      otpHash: null,
      profileSynced: false,
      updatedAt: new Date(now()),
    }, { merge: true }).catch(() => {});
    return true;
  }
  async function syncVerifiedProfile(uid, email, otpRef) {
    if (!hasFirestoreProfileSupport(uid, otpRef)) return;
    const profileRef = db.collection('users').doc(uid);
    const resolvedOtpRef = otpRef || db.collection('emailOtpVerifications').doc(uid);
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(profileRef);
      const profile = snapshot?.exists ? snapshot.data() : null;
      assertEligibleProfileData(profile, email);
      const verifiedAt = new Date(now());
      tx.update(profileRef, {
        emailVerified: true,
        emailVerifiedAt: profile.emailVerifiedAt || verifiedAt,
        emailOtpVerification: {
          ...(profile.emailOtpVerification || {}),
          required: profile.emailVerificationRequired === true || profile.accountSource === 'admin_created' || profile.emailOtpVerification?.required === true,
          status: 'verified',
          profileSynced: true,
        },
        updatedAt: verifiedAt,
      });
      if (resolvedOtpRef && typeof tx.set === 'function') {
        tx.set(resolvedOtpRef, { profileSynced: true, profileSyncedAt: verifiedAt }, { merge: true });
      }
    });
  }

  async function request(uid) {
    const user = await userFor(uid);
    if (user.emailVerified) {
      const repaired = await repairUnreconciledAuthIfNeeded(uid);
      if (!repaired) {
        await syncVerifiedProfile(uid, user.email);
        return { alreadyVerified: true };
      }
    }
    let code = String(randomInt(100000, 1000000));
    let otpHash = hash(uid, user.email, code);
    const requestId = randomUUID();
    const ref = db.collection('emailOtpVerifications').doc(uid);
    await assertEligibleUserProfile(uid, user.email, ref);
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const previous = snapshot.data() || {};
      while (previous.otpHash === otpHash) {
        code = String(randomInt(100000, 1000000));
        otpHash = hash(uid, user.email, code);
      }
      const time = now();
      const lastSent = millis(previous.lastSentAt);
      if (lastSent && time - lastSent < COOLDOWN) {
        throw new OtpError(429, 'resend-too-soon', 'Please wait before requesting another code.', {
          retryAfterSeconds: Math.ceil((lastSent + COOLDOWN - time) / 1000),
          expiresAt: previous.status === 'active' ? millis(previous.expiresAt) : null,
        });
      }
      const windowStart = millis(previous.sendWindowStartedAt);
      const inWindow = windowStart && time - windowStart < WINDOW;
      const count = inWindow ? Number(previous.sendCount || 0) : 0;
      if (count >= MAX_SENDS) {
        throw new OtpError(429, 'resend-limit-reached', 'Too many verification codes have been requested. Please try again later.', {
          retryAfterSeconds: Math.ceil((windowStart + WINDOW - time) / 1000),
        });
      }
      // Reserve before the network call. Replaces the old hash immediately and
      // retains rate-limit metadata even if delivery or later verification fails.
      tx.set(ref, {
        otpHash, email: user.email, requestId, status: 'sending', attempts: 0,
        createdAt: new Date(time), lastSentAt: new Date(time),
        expiresAt: new Date(time + EXPIRY),
        sendWindowStartedAt: new Date(inWindow ? windowStart : time),
        sendCount: count + 1, resendCount: count,
      });
    });
    onStage('OTP_CREATED');
    try {
      onStage('EMAIL_SEND_STARTED');
      await sendEmailOtp({ recipient: user.email, code, requestId });
    } catch (error) {
      await db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data();
        if (data?.requestId === requestId) tx.update(ref, { otpHash: null, status: 'send-failed' });
      });
      throw error instanceof OtpError ? error : unavailable();
    }
    const expiresAt = await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data();
      if (data?.requestId !== requestId || data.status !== 'sending') {
        throw new OtpError(409, 'no-active-code', 'Please request a new verification code.');
      }
      tx.update(ref, { status: 'active' });
      return millis(data.expiresAt);
    });
    onStage('OTP_REQUEST_COMPLETED');
    return { expiresAt, resendAfterSeconds: 60 };
  }

  async function verify(uid, code) {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      throw new OtpError(400, 'invalid-code', 'Enter the complete 6-digit verification code.');
    }
    const user = await userFor(uid);
    if (user.emailVerified) {
      const repaired = await repairUnreconciledAuthIfNeeded(uid);
      if (repaired) {
        throw new OtpError(400, 'no-active-code', 'Please request a new verification code.');
      }
      await syncVerifiedProfile(uid, user.email);
      return { verified: true, alreadyVerified: true };
    }
    const received = Buffer.from(hash(uid, user.email, code), 'hex');
    const ref = db.collection('emailOtpVerifications').doc(uid);
    await assertEligibleUserProfile(uid, user.email, ref);
    const trackProfileSync = hasFirestoreProfileSupport(uid, ref);
    const result = await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data();
      if (data?.status === 'locked') return 'attempt-limit-reached';
      if (data?.status === 'expired') return 'code-expired';
      if (data?.status === 'consumed') {
        if (!allowConsumedRetry || now() >= millis(data.expiresAt) || data.email !== user.email || !data.otpHash) return 'no-active-code';
        const expected = Buffer.from(data.otpHash, 'hex');
        return expected.length === received.length && timingSafeEqual(expected, received) ? 'retry-completed' : 'no-active-code';
      }
      if (!data?.otpHash || data.status !== 'active' || data.email !== user.email) return 'no-active-code';
      if (now() >= millis(data.expiresAt)) {
        tx.update(ref, { otpHash: null, status: 'expired' });
        return 'code-expired';
      }
      const attempts = Number(data.attempts || 0);
      if (attempts >= 5) {
        tx.update(ref, { otpHash: null, status: 'locked' });
        return 'attempt-limit-reached';
      }
      const expected = Buffer.from(data.otpHash, 'hex');
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        const next = attempts + 1;
        tx.update(ref, next >= 5
          ? { attempts: next, otpHash: null, status: 'locked' }
          : { attempts: next });
        return next >= 5 ? 'attempt-limit-reached' : 'incorrect-code';
      }
      // Registration finalization can safely re-authorize this same code until
      // expiry if its success response was lost. Ordinary email OTP flows still
      // clear the hash and reject every retry.
      tx.update(ref, allowConsumedRetry
        ? { status: 'consumed' }
        : trackProfileSync
          ? { otpHash: null, status: 'consumed', profileSynced: false }
          : { otpHash: null, status: 'consumed' });
      return 'verified';
    });
    const errors = {
      'code-expired': [410, 'This verification code has expired. Please request a new code.'],
      'attempt-limit-reached': [429, 'Too many incorrect attempts. Please request a new verification code.'],
      'no-active-code': [400, 'Please request a new verification code.'],
      'incorrect-code': [400, 'The verification code you entered is incorrect.'],
    };
    if (result !== 'verified' && result !== 'retry-completed') throw new OtpError(errors[result][0], result, errors[result][1]);
    // Refuse a code issued for a different email if the account changed mid-request.
    const current = await userFor(uid);
    if (current.email !== user.email) throw new OtpError(409, 'no-active-code', 'Please request a new verification code.');
    const completion = await auth.updateUser(uid, { emailVerified: true });
    try {
      await syncVerifiedProfile(uid, current.email, ref);
    } catch (error) {
      if (!allowConsumedRetry) {
        let rollbackFailed = false;
        try {
          await auth.updateUser(uid, { emailVerified: false });
        } catch {
          rollbackFailed = true;
        }
        if (rollbackFailed) {
          await ref.set({
            status: 'reconciliation-failed',
            otpHash: null,
            profileSynced: false,
            updatedAt: new Date(now()),
          }, { merge: true }).catch(() => {});
          throw new OtpError(
            503,
            'EMAIL_VERIFICATION_RECONCILIATION_FAILED',
            'Email verification could not be finalized. Please request a new code and try again.',
            {
              reconciled: false,
              rollbackFailed: true,
              cause: error instanceof OtpError ? error.reason : 'PROFILE_SYNC_FAILED',
            }
          );
        }
        await ref.set({
          status: 'rolled-back',
          otpHash: null,
          profileSynced: false,
          updatedAt: new Date(now()),
        }, { merge: true }).catch(() => {});
      }
      throw error instanceof OtpError
        ? error
        : new OtpError(
          503,
          'EMAIL_VERIFICATION_SYNC_FAILED',
          'Email verification could not be completed. Please try again.',
          { reconciled: false, rollbackFailed: false }
        );
    }
    return { verified: true, ...(completion?.registrationResult || {}) };
  }
  return { request, verify };
}
module.exports = { createEmailOtpService };
