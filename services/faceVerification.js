import { callRegistrationApi } from './registrationSession';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';

import { db } from '../firebase';

// Keep this false in production. A real verification provider/backend must own
// the transition to `verified` and any temporary selfie/video handling.
export const DEV_FACE_VERIFICATION = false;

const FACE_VERIFICATION_STATUSES = new Set([
  'unverified',
  'pending',
  'temporary',
  'verified',
  'review_required',
  'failed',
]);

const DUPLICATE_CHECK_STATUSES = new Set(['unknown', 'clear', 'flagged']);

export const createUnverifiedFaceVerification = () => ({
  status: 'unverified',
  verifiedAt: null,
  verificationId: null,
  livenessPassed: null,
  duplicateCheck: 'unknown',
  failureReason: null,
});

/**
 * Normalizes profile data from Firestore without storing or deriving biometric data.
 * A flagged duplicate check always requires review, regardless of another status.
 */
export const normalizeFaceVerification = (profile = {}) => {
  const value = profile?.faceVerification || profile || {};
  const requestedStatus = (value.status || 'unverified').toString().trim().toLowerCase();
  const duplicateCheck = (value.duplicateCheck || 'unknown').toString().trim().toLowerCase();
  const safeDuplicateCheck = DUPLICATE_CHECK_STATUSES.has(duplicateCheck)
    ? duplicateCheck
    : 'unknown';
  const safeStatus = FACE_VERIFICATION_STATUSES.has(requestedStatus)
    ? requestedStatus
    : 'unverified';

  return {
    status: safeDuplicateCheck === 'flagged' ? 'review_required' : safeStatus,
    verifiedAt: value.verifiedAt || null,
    verificationId: value.verificationId || null,
    livenessPassed:
      typeof value.livenessPassed === 'boolean' ? value.livenessPassed : null,
    duplicateCheck: safeDuplicateCheck,
    failureReason: value.failureReason || null,
  };
};

/** Pairwise comparison only: referenceImage and probeImage are JPEG/PNG data URLs.
 * Neither a successful comparison nor two client photos establish liveness or uniqueness.
 */
export const startFaceVerification = async ({ registrationSessionId, referenceImage, probeImage } = {}) => {
  if (!registrationSessionId) return { started: false, reason: 'not-configured' };
  return callRegistrationApi('/api/verification/verify-face', {
    registrationSessionId, referenceImage, probeImage,
  }, 55000);
};

export const beginRegistrationFace = (registrationSessionId) => callRegistrationApi(
  '/api/verification/registration-face', { action: 'begin', registrationSessionId }
);
export const evaluateRegistrationChallenge = (registrationSessionId, challengeId, frames) => callRegistrationApi(
  '/api/verification/registration-face', { action: 'evaluate', registrationSessionId, challengeId, frames }, 55000
);
export const completeRegistrationFace = (registrationSessionId, challengeId, referenceImage, image) => callRegistrationApi(
  '/api/verification/registration-face', { action: 'complete', registrationSessionId, challengeId, referenceImage, image }, 55000
);

export const getFaceVerificationStatus = async (uid) => {
  if (!uid) return createUnverifiedFaceVerification();

  const snapshot = await getDoc(doc(db, 'users', uid));
  return snapshot.exists()
    ? normalizeFaceVerification(snapshot.data())
    : createUnverifiedFaceVerification();
};

export const subscribeFaceVerification = (uid, listener, onError) => {
  if (!uid) {
    listener?.(createUnverifiedFaceVerification());
    return () => {};
  }

  return onSnapshot(
    doc(db, 'users', uid),
    (snapshot) => {
      listener?.(
        snapshot.exists()
          ? normalizeFaceVerification(snapshot.data())
          : createUnverifiedFaceVerification()
      );
    },
    (error) => {
      console.log('Face verification status subscription error:', error.message);
      onError?.(error);
    }
  );
};

/**
 * Reserved for a trusted backend/provider handoff. This client deliberately does
 * not write `pending`, `verified`, liveness, duplicate-check, or timestamp fields.
 * Production Firestore rules should allow those faceVerification fields to be
 * written only by trusted server-side code.
 */
export const markVerificationPending = async (uid) => getFaceVerificationStatus(uid);
