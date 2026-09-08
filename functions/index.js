const { createHmac, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const { sendEmailOtp } = require('./emailProvider');

if (!getApps().length) {
  initializeApp();
}

const EMAIL_PROVIDER_API_KEY = defineSecret('EMAIL_PROVIDER_API_KEY');
const EMAIL_FROM_ADDRESS = defineSecret('EMAIL_FROM_ADDRESS');
const EMAIL_OTP_HASH_SECRET = defineSecret('EMAIL_OTP_HASH_SECRET');

const OTP_COLLECTION = 'emailOtpVerifications';
const USERS_COLLECTION = 'users';
const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_RESENDS_PER_WINDOW = 5;
const MAX_INCORRECT_ATTEMPTS = 5;

const getTimestampMillis = (value) =>
  typeof value?.toMillis === 'function' ? value.toMillis() : 0;

const createOtp = () => randomInt(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH).toString();

const createOtpHash = (uid, code) => {
  const hashSecret = EMAIL_OTP_HASH_SECRET.value();

  if (!hashSecret) {
    throw new HttpsError(
      'failed-precondition',
      'Verification email could not be sent. Please try again.',
      { reason: 'provider-unavailable' }
    );
  }

  return createHmac('sha256', hashSecret)
    .update(`${uid}:${code}`)
    .digest('hex');
};

const hasMatchingHash = (expectedHash, receivedHash) => {
  const expected = Buffer.from(expectedHash || '', 'hex');
  const received = Buffer.from(receivedHash || '', 'hex');

  return (
    expected.length > 0 &&
    expected.length === received.length &&
    timingSafeEqual(expected, received)
  );
};

const requireAuthenticatedUser = (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Please sign in again before verifying your email.');
  }

  return request.auth.uid;
};

const getRetryAfterSeconds = (timestamp, now) =>
  Math.max(1, Math.ceil((timestamp + RESEND_COOLDOWN_MS - now) / 1000));

exports.requestEmailOtp = onCall(
  {
    secrets: [EMAIL_PROVIDER_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_OTP_HASH_SECRET],
  },
  async (request) => {
    const uid = requireAuthenticatedUser(request);
    const auth = getAuth();
    const firestore = getFirestore();
    const userRecord = await auth.getUser(uid);

    if (userRecord.emailVerified) {
      return { alreadyVerified: true };
    }

    if (!userRecord.email) {
      throw new HttpsError('failed-precondition', 'This account does not have an email address.');
    }

    const now = Date.now();
    const verificationRef = firestore.collection(OTP_COLLECTION).doc(uid);
    const requestId = randomBytes(16).toString('hex');
    const otp = createOtp();
    const otpHash = createOtpHash(uid, otp);
    let resendMetadata = null;

    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(verificationRef);
      const existing = snapshot.exists ? snapshot.data() : {};
      const lastSentAt = getTimestampMillis(existing.lastSentAt);
      const pendingRequestAt = getTimestampMillis(existing.pendingRequestAt);

      if (pendingRequestAt && now - pendingRequestAt < RESEND_COOLDOWN_MS) {
        throw new HttpsError(
          'failed-precondition',
          'Please wait before requesting another code.',
          {
            reason: 'resend-too-soon',
            retryAfterSeconds: getRetryAfterSeconds(pendingRequestAt, now),
            expiresAt: getTimestampMillis(existing.expiresAt) || null,
          }
        );
      }

      if (lastSentAt && now - lastSentAt < RESEND_COOLDOWN_MS) {
        throw new HttpsError(
          'failed-precondition',
          'Please wait before requesting another code.',
          {
            reason: 'resend-too-soon',
            retryAfterSeconds: getRetryAfterSeconds(lastSentAt, now),
            expiresAt: getTimestampMillis(existing.expiresAt) || null,
          }
        );
      }

      const sendWindowStartedAt = getTimestampMillis(existing.sendWindowStartedAt);
      const inActiveWindow = sendWindowStartedAt && now - sendWindowStartedAt < SEND_WINDOW_MS;
      const previousResendCount = inActiveWindow ? Number(existing.resendCount || 0) : 0;
      const hasExistingCode = Boolean(existing.otpHash);

      if (hasExistingCode && previousResendCount >= MAX_RESENDS_PER_WINDOW) {
        throw new HttpsError(
          'resource-exhausted',
          'Too many verification codes have been requested. Please try again later.',
          { reason: 'resend-limit-reached' }
        );
      }

      resendMetadata = {
        resendCount: hasExistingCode ? previousResendCount + 1 : 0,
        sendWindowStartedAt: inActiveWindow
          ? existing.sendWindowStartedAt
          : Timestamp.fromMillis(now),
      };

      transaction.set(
        verificationRef,
        {
          pendingRequestId: requestId,
          pendingRequestAt: Timestamp.fromMillis(now),
        },
        { merge: true }
      );
    });

    try {
      await sendEmailOtp({
        apiKey: EMAIL_PROVIDER_API_KEY.value(),
        fromAddress: EMAIL_FROM_ADDRESS.value(),
        recipient: userRecord.email,
        code: otp,
      });
    } catch (error) {
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(verificationRef);

        if (snapshot.data()?.pendingRequestId !== requestId) return;

        if (snapshot.data()?.otpHash) {
          transaction.update(verificationRef, {
            pendingRequestId: FieldValue.delete(),
            pendingRequestAt: FieldValue.delete(),
          });
        } else {
          transaction.delete(verificationRef);
        }
      });

      console.error('Email OTP provider error:', error.message);
      throw new HttpsError(
        'unavailable',
        'Verification email could not be sent. Please try again.',
        { reason: 'provider-unavailable' }
      );
    }

    const expiresAt = now + OTP_EXPIRY_MS;

    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(verificationRef);

      if (snapshot.data()?.pendingRequestId !== requestId) {
        throw new HttpsError('aborted', 'Please request a new verification code.');
      }

      transaction.set(
        verificationRef,
        {
          otpHash,
          expiresAt: Timestamp.fromMillis(expiresAt),
          createdAt: Timestamp.fromMillis(now),
          lastSentAt: Timestamp.fromMillis(now),
          attempts: 0,
          resendCount: resendMetadata.resendCount,
          sendWindowStartedAt: resendMetadata.sendWindowStartedAt,
          pendingRequestId: FieldValue.delete(),
          pendingRequestAt: FieldValue.delete(),
        },
        { merge: true }
      );
    });

    return {
      expiresAt,
      resendAfterSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000),
    };
  }
);

exports.verifyEmailOtp = onCall(
  {
    secrets: [EMAIL_OTP_HASH_SECRET],
  },
  async (request) => {
    const uid = requireAuthenticatedUser(request);
    const code = String(request.data?.code || '').replace(/\D/g, '');

    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) {
      throw new HttpsError('invalid-argument', 'Enter the complete 6-digit verification code.');
    }

    const auth = getAuth();
    const firestore = getFirestore();
    const userRecord = await auth.getUser(uid);

    if (userRecord.emailVerified) {
      return { verified: true, alreadyVerified: true };
    }

    const verificationRef = firestore.collection(OTP_COLLECTION).doc(uid);
    const otpHash = createOtpHash(uid, code);
    const now = Date.now();
    const verificationResult = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(verificationRef);
      const verification = snapshot.exists ? snapshot.data() : null;

      if (!verification?.otpHash) return { status: 'missing' };

      const expiresAt = getTimestampMillis(verification.expiresAt);

      if (!expiresAt || now >= expiresAt) {
        transaction.delete(verificationRef);
        return { status: 'expired' };
      }

      const attempts = Number(verification.attempts || 0);

      if (attempts >= MAX_INCORRECT_ATTEMPTS) {
        transaction.delete(verificationRef);
        return { status: 'attempt-limit' };
      }

      if (!hasMatchingHash(verification.otpHash, otpHash)) {
        const nextAttempts = attempts + 1;

        if (nextAttempts >= MAX_INCORRECT_ATTEMPTS) {
          transaction.delete(verificationRef);
          return { status: 'attempt-limit' };
        }

        transaction.update(verificationRef, { attempts: nextAttempts });
        return { status: 'incorrect' };
      }

      transaction.delete(verificationRef);
      return { status: 'verified' };
    });

    if (verificationResult.status === 'missing') {
      throw new HttpsError(
        'failed-precondition',
        'Please request a new verification code.',
        { reason: 'no-active-code' }
      );
    }

    if (verificationResult.status === 'expired') {
      throw new HttpsError(
        'deadline-exceeded',
        'This verification code has expired. Please request a new code.',
        { reason: 'code-expired' }
      );
    }

    if (verificationResult.status === 'attempt-limit') {
      throw new HttpsError(
        'resource-exhausted',
        'Too many incorrect attempts. Please request a new verification code.',
        { reason: 'attempt-limit-reached' }
      );
    }

    if (verificationResult.status === 'incorrect') {
      throw new HttpsError(
        'permission-denied',
        'The verification code you entered is incorrect.',
        { reason: 'incorrect-code' }
      );
    }

    await auth.updateUser(uid, { emailVerified: true });

    try {
      await firestore.collection(USERS_COLLECTION).doc(uid).set(
        {
          emailVerified: true,
          emailVerifiedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      // Authentication is already the source of truth. A profile sync failure must
      // not make a successfully verified account appear unverified again.
      console.error('Verified-email profile sync error:', error.message);
    }

    return { verified: true };
  }
);
