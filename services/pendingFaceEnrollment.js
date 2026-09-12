// Process-memory only. Never persist captures to storage, URLs, or Firestore.
const captures = new Map();

export const rememberPendingFaceEnrollment = (registrationSessionId, image) => {
  if (typeof registrationSessionId === 'string' && typeof image === 'string') captures.set(registrationSessionId, image);
};
export const getPendingFaceEnrollment = (registrationSessionId) => captures.get(registrationSessionId) || null;
export const clearPendingFaceEnrollment = (registrationSessionId) => captures.delete(registrationSessionId);
