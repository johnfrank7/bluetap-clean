import { auth } from '../firebaseAuth';
import { getApiUrl } from './apiClient';
import { clearPendingFaceEnrollment, getPendingFaceEnrollment } from './pendingFaceEnrollment';

const apiError = (reason, message, details = {}) => {
  const error = new Error(message);
  error.code = `otp/${reason}`;
  error.details = { ...details, reason };
  return error;
};

async function callOtp(path, body = {}, requireAuth = true) {
  const account = auth.currentUser;
  if (requireAuth && !account) throw apiError('unauthenticated', 'Please log in again.');
  const token = requireAuth ? await account.getIdToken() : null;
  const url = getApiUrl(path, () => apiError(
    'service-unavailable',
    'The email verification service is not available in this app build.'
  ));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = data?.error;
      throw apiError(
        response.status === 401 ? 'unauthenticated' : error?.reason || 'service-unavailable',
        error?.message || 'The email verification service is currently unavailable.',
        error || {}
      );
    }
    if (!data || typeof data !== 'object' || (requireAuth && auth.currentUser?.uid !== account.uid)) {
      throw apiError('service-unavailable', 'We could not confirm your email verification request.');
    }
    return data;
  } catch (error) {
    if (error.details) throw error;
    throw apiError('network', 'We could not reach the verification service. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
  }
}

export const requestEmailOtp = async () => {
  const data = await callOtp('/api/auth/request-email-otp');
  if (data.alreadyVerified !== true && !(Number(data.expiresAt) > 0)) {
    throw apiError('service-unavailable', 'The email verification service returned an invalid response.');
  }
  return data;
};

export const verifyEmailOtp = async (code) => {
  const data = await callOtp('/api/auth/verify-email-otp', { code });
  if (data.verified !== true) {
    throw apiError('service-unavailable', 'We could not confirm your email verification.');
  }
  return data;
};

// Transient form data only. Never store passwords or challenge tokens in URLs,
// localStorage, AsyncStorage, or Firestore. A refresh safely restarts signup.
let pendingRegistration = null;
export const setPendingRegistration = (profile, result) => {
  pendingRegistration = { profile, ...result, draftExpiresAt: Date.now() + 30 * 60 * 1000 };
};
export const clearPendingRegistration = () => {
  clearPendingFaceEnrollment(pendingRegistration?.profile?.registrationSessionId);
  pendingRegistration = null;
};
export const getPendingRegistration = () => {
  if (pendingRegistration?.draftExpiresAt <= Date.now()) clearPendingRegistration();
  return pendingRegistration;
};
export const requestRegistrationOtp = async (email, username, registrationSessionId) => {
  const data = await callOtp('/api/auth/request-registration-otp', { email, username, registrationSessionId }, false);
  if (typeof data.challenge !== 'string' || !(data.expiresAt > 0)) {
    throw apiError('service-unavailable', 'We could not send a verification code.');
  }
  return data;
};
export const completeRegistration = async (code) => {
  const draft = getPendingRegistration();
  if (!draft) throw apiError('registration-expired', 'Please return to signup and request a new code.');
  const finalFaceImage = getPendingFaceEnrollment(draft.profile.registrationSessionId);
  if (!finalFaceImage) throw apiError('face-capture-required', 'Please return to signup and complete face verification again.');
  const data = await callOtp('/api/auth/complete-registration', {
    challenge: draft.challenge, code, profile: draft.profile, finalFaceImage,
  }, false);
  if (data.verified !== true || typeof data.customToken !== 'string') {
    throw apiError('service-unavailable', 'We could not complete your registration.');
  }
  clearPendingFaceEnrollment(draft.profile.registrationSessionId);
  return data;
};

export const retryRegistrationFinalization = async () => {
  const draft = getPendingRegistration();
  if (!draft) throw apiError('registration-expired', 'Please return to signup and restart registration.');
  const finalFaceImage = getPendingFaceEnrollment(draft.profile.registrationSessionId);
  if (!finalFaceImage) throw apiError('face-capture-required', 'Please return to signup and complete face verification again.');
  const data = await callOtp('/api/auth/complete-registration', {
    action: 'retry-finalization', challenge: draft.challenge, profile: draft.profile, finalFaceImage,
  }, false);
  if (data.verified !== true || data.finalized !== true || typeof data.customToken !== 'string') {
    throw apiError('service-unavailable', 'BlueTap could not finish creating your account.');
  }
  clearPendingFaceEnrollment(draft.profile.registrationSessionId);
  return data;
};
