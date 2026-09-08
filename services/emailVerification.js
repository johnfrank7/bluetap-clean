import { getFunctions, httpsCallable } from 'firebase/functions';

import { app } from '../firebaseApp';

const functions = getFunctions(app);
const requestEmailOtpCallable = httpsCallable(functions, 'requestEmailOtp');
const verifyEmailOtpCallable = httpsCallable(functions, 'verifyEmailOtp');

/**
 * Requests an email OTP from the trusted Firebase Functions backend. No OTP
 * values or provider credentials are ever present in the Expo client.
 */
export const requestEmailOtp = async () => {
  const response = await requestEmailOtpCallable();
  return response.data || {};
};

/**
 * Sends the user-entered code to the trusted backend for validation.
 */
export const verifyEmailOtp = async (code) => {
  const response = await verifyEmailOtpCallable({ code });
  return response.data || {};
};
