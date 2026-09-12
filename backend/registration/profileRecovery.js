const { createHmac } = require('node:crypto');
const { OtpError } = require('../utils/otpError');
const { createRenderFaceClient } = require('../verification/renderFaceClient');

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

const restartUnavailable = () => new OtpError(403, 'restart-unavailable', 'This account cannot be automatically restarted. Please contact support.');
const ownerHashFor = (email, hashSecret) => {
  if (!hashSecret) throw new OtpError(503, 'service-unavailable', 'Account recovery is temporarily unavailable. Please try again later.');
  return createHmac('sha256', hashSecret).update(`email:${cleanEmail(email)}`).digest('hex');
};

const activityChecks = [
  ['requests', 'requester_id'], ['requests', 'distributor_id'],
  ['orders', 'requester_id'], ['orders', 'distributor_id'],
  ['history', 'uid'], ['history', 'userUid'],
  ['distributorApprovals', 'uid'], ['distributorApplications', 'uid'],
];

async function hasAccountActivity(db, uid) {
  const records = await Promise.all(activityChecks.map(([collection, field]) =>
    db.collection(collection).where(field, '==', uid).limit(1).get()
  ));
  return records.some((snapshot) => !snapshot.empty);
}

function hasProtectedRegistrationState(session, uid) {
  const face = session?.faceVerification || {};
  return session?.completed === true || session?.emailVerified === true ||
    session?.profileRecovery?.registrationCompleted === true ||
    session?.faceEnrollmentPending === true || face.status === 'verified' ||
    face.verificationReference === uid;
}

function temporaryFaceReference(session, id) {
  const face = session?.faceVerification || {};
  return session?.completed !== true && session?.faceEnrollmentPending !== true &&
    face.status === 'passed_pending_finalization' && face.verificationReference === id;
}

async function discardTemporaryFaces(sessions, render) {
  for (const session of sessions) {
    if (!temporaryFaceReference(session.data(), session.id)) continue;
    const form = new FormData();
    form.append('registration_session_id', session.id);
    const result = await render('/discard-registration-face', form);
    if (result?.discarded !== true && result?.notFound !== true) {
      throw new OtpError(503, 'face-cleanup-unavailable', 'We could not safely prepare a fresh registration. Please try again later.');
    }
  }
}

async function restartIncompleteRegistration({ auth, db, uid, hashSecret, render = createRenderFaceClient() }) {
  const user = await auth.getUser(uid);
  if (!user.email) throw restartUnavailable();
  const profile = await db.collection('users').doc(uid).get();
  if (profile.exists || user.disabled || user.customClaims?.admin === true || user.customClaims?.role === 'admin') throw restartUnavailable();

  const [uidSessions, recoverySessions] = await Promise.all([
    db.collection('registrationSessions').where('userUid', '==', uid).get(),
    db.collection('registrationSessions').where('profileRecovery.uid', '==', uid).get(),
  ]);
  const sessions = [...uidSessions.docs, ...recoverySessions.docs]
    .filter((snapshot, index, all) => all.findIndex((other) => other.ref.path === snapshot.ref.path) === index);
  if (sessions.some((snapshot) => hasProtectedRegistrationState(snapshot.data(), uid)) || await hasAccountActivity(db, uid)) {
    throw restartUnavailable();
  }

  // The email is from Firebase Admin, never the browser. These are the only
  // private registration records keyed from that trusted identity.
  const ownerHash = ownerHashFor(user.email, hashSecret);
  const reservations = await db.collection('usernameReservations').where('ownerHash', '==', ownerHash).get();
  await discardTemporaryFaces(sessions, render);

  const batch = db.batch();
  sessions.forEach((snapshot) => batch.delete(snapshot.ref));
  reservations.docs.forEach((snapshot) => batch.delete(snapshot.ref));
  batch.delete(db.collection('emailOtpVerifications').doc(uid));
  batch.delete(db.collection('emailOtpVerifications').doc(`registration-${ownerHash}`));
  await batch.commit();

  // Delete Auth last. If cleanup fails, the account remains signed in and no
  // partially-cleaned identity is silently removed.
  await auth.deleteUser(uid);
  return { restarted: true };
}

module.exports = { recoverProfile, validSnapshot, restartIncompleteRegistration, hasProtectedRegistrationState, temporaryFaceReference };
