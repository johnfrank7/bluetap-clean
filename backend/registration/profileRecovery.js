const { OtpError } = require('../utils/otpError');

const cleanEmail = (value) => (value || '').toString().trim().toLowerCase();
const validSnapshot = (snapshot, user) => {
  const face = snapshot?.faceVerification || {};
  return snapshot && snapshot.uid === user.uid && cleanEmail(snapshot.email) === cleanEmail(user.email) &&
    ['requester', 'distributor'].includes(snapshot.role) &&
    snapshot.registrationCompleted === true && snapshot.onboardingStatus === 'complete' &&
    snapshot.emailVerified === true && snapshot.emailVerificationRequired === true &&
    snapshot.termsAcceptance?.accepted === true && typeof snapshot.username === 'string' &&
    typeof snapshot.usernameNormalized === 'string' && typeof snapshot.unique_id === 'string' &&
    face.status === 'verified' && face.duplicateCheck === 'clear' && face.livenessPassed === true &&
    typeof face.verificationReference === 'string' && face.verificationReference.length > 0;
};

async function recoverProfile({ auth, db, uid }) {
  const user = await auth.getUser(uid);
  if (user.disabled || !user.email || !user.emailVerified) throw new OtpError(403, 'recovery-unavailable', 'Your account setup was not completed. Please restart registration or contact support.');
  const profileRef = db.collection('users').doc(uid);
  if ((await profileRef.get()).exists) return { recovered: false, reason: 'profile-exists' };

  const sessions = await db.collection('registrationSessions').where('userUid', '==', uid).get();
  const candidates = sessions.docs.filter((doc) => {
    const session = doc.data();
    return session.completed === true && session.emailVerified === true && validSnapshot(session.profileRecovery, user);
  });
  if (candidates.length !== 1) return { recovered: false, reason: 'no-trusted-session' };

  const sessionRef = candidates[0].ref;
  const snapshot = candidates[0].data().profileRecovery;
  const usernameRef = db.collection('usernames').doc(snapshot.usernameNormalized);
  await db.runTransaction(async (tx) => {
    const [existing, username] = await Promise.all([tx.get(profileRef), tx.get(usernameRef)]);
    if (existing.exists) return;
    if (username.data()?.uid !== uid) throw new OtpError(409, 'recovery-unavailable', 'Your account setup could not be safely restored. Please contact support.');
    tx.set(profileRef, { ...snapshot, restoredAt: new Date() });
    tx.update(sessionRef, { profileRestoredAt: new Date() });
  });
  return { recovered: true };
}

module.exports = { recoverProfile, validSnapshot };
