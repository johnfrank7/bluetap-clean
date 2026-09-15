const { createHash, createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const { createEmailOtpService } = require('../auth/emailOtp');
const { OtpError } = require('../utils/otpError');
const { normalizeUsername } = require('../username/username');
const { readRegistrationSession, isRegistrationFaceVerified } = require('./registrationSession');
const { decodeImage } = require('../verification/faceVerification');
const { createRenderFaceClient } = require('../verification/renderFaceClient');

const RESERVATION_TTL = 15 * 60 * 1000;

function createRegistrationService({ auth, db, sendEmailOtp, hashSecret, render = createRenderFaceClient(), now = Date.now, otpStage = () => {} }) {
  // Operational breadcrumbs only: never include credentials, codes, images,
  // face data, email addresses, or full user identifiers in these logs.
  const logFinalization = (stage, registrationSessionId, extra = {}) => console.info('[registration-finalization]', JSON.stringify({
    stage, registrationSessionId, ...extra,
  }));
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
  function challengeFor(email, usernameNormalized, registrationSessionId) {
    const payload = Buffer.from(JSON.stringify({ email, usernameNormalized, registrationSessionId, expires: now() + RESERVATION_TTL, nonce: randomUUID() })).toString('base64url');
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
    return { email: normalizeEmail(data.email), usernameNormalized: normalizeUsername(data.usernameNormalized), registrationSessionId: data.registrationSessionId };
  }
  async function findUser(email) {
    try { return await auth.getUserByEmail(email); }
    catch (error) { if (error.code === 'auth/user-not-found') return null; throw error; }
  }
  async function checkExistingAccount(user, registrationSessionId, verifiedRetry = false) {
    if (!user) return;
    const existing = (await db.collection('users').doc(user.uid).get()).data();
    const session = registrationSessionId ? (await db.collection('registrationSessions').doc(registrationSessionId).get()).data() : null;
    const retryingPendingEnrollment = existing &&
      ['requester', 'distributor'].includes(existing.role) && existing.registrationCompleted === false &&
      ['face_enrollment_pending', 'finalization_pending'].includes(existing.onboardingStatus) &&
      session?.userUid === user.uid && session?.completed !== true &&
      (requiresOtp(session) ? user.emailVerified === true : true);
    const retryingAuthOnlyRecovery = verifiedRetry && !existing &&
      session?.completed !== true && (requiresOtp(session) ? session?.emailVerified === true : true) &&
      ['pending', 'recovery_required'].includes(session?.finalization?.status) &&
      (!session.finalization.uid || session.finalization.uid === user.uid);
    if (retryingPendingEnrollment || retryingAuthOnlyRecovery) return true;
    if (user.disabled || user.emailVerified || existing?.registrationCompleted === true || (existing && !['requester', 'distributor'].includes(existing.role))) {
      throw new OtpError(409, 'account-exists', 'Email already registered.');
    }
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
    const username = text('username', 20);
    const usernameNormalized = normalizeUsername(username);
    return { firstName: text('firstName', 100), lastName: text('lastName', 100),
      barangay: text('barangay', 150), address: text('address', 250), phone, role,
      username, usernameNormalized };
  }
  const personalDigest = (profile) => digest(JSON.stringify([profile.role, profile.firstName, profile.lastName, profile.phone, profile.barangay, profile.address]));
  const captureHash = (image) => createHash('sha256').update(String(image)).digest('hex');
  const hasEligibleFaceStep = isRegistrationFaceVerified;
  const requiresFace = (session) => session?.securityPolicySnapshot?.faceVerificationRequired !== false;
  const requiresOtp = (session) => session?.securityPolicySnapshot?.emailOtpRequired !== false;
  const registrationLimitRefs = (session) => {
    const keys = session?.registrationLimitKeys;
    if (!keys?.deviceHash || !keys?.ipHash) throw new OtpError(403, 'registration-session-invalid', 'Registration security information is missing. Please restart signup.');
    return [db.collection('registrationLimits').doc(`device_${keys.deviceHash}`), db.collection('registrationLimits').doc(`ip_${keys.ipHash}`)];
  };
  async function reserveRegistrationLimits(registrationSessionId, userUid) {
    await db.runTransaction(async (tx) => {
      const sessionRef = db.collection('registrationSessions').doc(registrationSessionId);
      const session = (await tx.get(sessionRef)).data();
      if (!session || session.completed) throw new OtpError(403, 'registration-session-invalid', 'Registration session is invalid.');
      if (session.registrationLimitReservation?.uid === userUid && session.registrationLimitReservation?.status === 'reserved') return;
      const refs = registrationLimitRefs(session);
      const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
      const limits = [session.securityPolicySnapshot.maxAccountsPerDevice, session.securityPolicySnapshot.maxAccountsPerIp];
      const reasons = ['DEVICE_ACCOUNT_LIMIT_REACHED', 'IP_ACCOUNT_LIMIT_REACHED'];
      snapshots.forEach((snapshot, index) => {
        const data = snapshot.data() || {};
        if (Number(data.finalizedCount || 0) + Number(data.reservedCount || 0) >= limits[index]) {
          throw new OtpError(403, reasons[index], 'Registration limit reached. This device or network has already created the maximum number of BlueTap accounts.');
        }
      });
      refs.forEach((ref, index) => tx.set(ref, { reservedCount: Number(snapshots[index].data()?.reservedCount || 0) + 1, updatedAt: new Date(now()) }, { merge: true }));
      tx.update(sessionRef, { registrationLimitReservation: { uid: userUid, status: 'reserved', reservedAt: new Date(now()) } });
    });
  }
  async function applyRegistrationLimitReservation(tx, sessionRef, session, userUid, commit) {
    if (session?.registrationLimitReservation?.uid !== userUid || session.registrationLimitReservation.status !== 'reserved') {
      throw new OtpError(409, 'registration-session-invalid', 'Registration account limits were not reserved.');
    }
    const refs = registrationLimitRefs(session);
    const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
    refs.forEach((ref, index) => {
      const data = snapshots[index].data() || {};
      tx.set(ref, { reservedCount: Math.max(0, Number(data.reservedCount || 0) - 1),
        finalizedCount: Number(data.finalizedCount || 0) + (commit ? 1 : 0), updatedAt: new Date(now()) }, { merge: true });
    });
    tx.update(sessionRef, { registrationLimitReservation: { uid: userUid, status: commit ? 'committed' : 'released', updatedAt: new Date(now()) } });
  }
  async function releaseRegistrationLimits(registrationSessionId, userUid) {
    await db.runTransaction(async (tx) => {
      const sessionRef = db.collection('registrationSessions').doc(registrationSessionId);
      const session = (await tx.get(sessionRef)).data();
      if (session?.registrationLimitReservation?.uid !== userUid || session.registrationLimitReservation.status !== 'reserved') return;
      await applyRegistrationLimitReservation(tx, sessionRef, session, userUid, false);
    });
  }
  async function verifiedSession(registrationSessionId, profile) {
    const { data } = await readRegistrationSession(db, registrationSessionId, now);
    if (!requiresFace(data) && !requiresOtp(data)) {
      throw new OtpError(403, 'VERIFICATION_METHOD_REQUIRED', 'Registration policy requires at least one verification method.');
    }
    if (requiresFace(data) && !hasEligibleFaceStep(data.faceVerification)) {
      throw new OtpError(403, data.faceVerification?.duplicateCheck === 'flagged' ? 'face-review-required' : 'face-verification-required', data.faceVerification?.duplicateCheck === 'flagged' ? 'Verification needs review.' : 'Complete identity verification before continuing.');
    }
    if (data.termsAcceptance?.accepted !== true) throw new OtpError(403, 'terms-required', 'Please accept the Terms of Service and Privacy Policy to continue.');
    if (profile && (data.role !== profile.role || data.personalInfoDigest !== personalDigest(profile))) {
      throw new OtpError(400, 'registration-session-mismatch', 'Your registration details changed. Please restart identity verification.');
    }
    return data;
  }
  async function saveProfile(user, profile, email, registrationSessionId, emailOtpVerified) {
    const ref = db.collection('users').doc(user.uid);
    const counter = db.collection('counters').doc('unique_ids');
    const usernameRef = db.collection('usernames').doc(profile.usernameNormalized);
    const reservationRef = db.collection('usernameReservations').doc(profile.usernameNormalized);
    const registrationSessionRef = db.collection('registrationSessions').doc(registrationSessionId);
    await db.runTransaction(async (tx) => {
      const existing = (await tx.get(ref)).data();
      const counts = (await tx.get(counter)).data() || {};
      const claimed = (await tx.get(usernameRef)).data();
      const reservation = (await tx.get(reservationRef)).data();
      const session = (await tx.get(registrationSessionRef)).data();
      const ownerHash = digest('email:' + email);
      const reservationValid = reservation?.ownerHash === ownerHash && Number(reservation?.expiresAt?.toMillis?.() || reservation?.expiresAt || 0) > now();
      const retryingPendingEnrollment = existing && existing.registrationCompleted === false &&
        ['face_enrollment_pending', 'finalization_pending'].includes(existing.onboardingStatus) &&
        session?.userUid === user.uid && session?.completed !== true;
      if ((claimed?.uid && claimed.uid !== user.uid) || (!reservationValid && !retryingPendingEnrollment)) {
        throw new OtpError(409, 'username-taken', 'This username is already taken.');
      }
      if (!session || session.completed || Number(session.expiresAt?.toMillis?.() || session.expiresAt || 0) <= now() ||
        (requiresFace(session) && !hasEligibleFaceStep(session.faceVerification)) ||
        (requiresOtp(session) && emailOtpVerified !== true) || session.termsAcceptance?.accepted !== true ||
        session.role !== profile.role || session.personalInfoDigest !== personalDigest(profile)) {
        throw new OtpError(403, 'registration-session-invalid', 'Registration verification is incomplete or expired. Please restart signup.');
      }
      const face = session.faceVerification || {};
      const trustedFaceVerification = requiresFace(session) ? {
        status: 'passed_pending_finalization', verifiedAt: face.verifiedAt || new Date(now()),
        verificationId: face.verificationReference || null,
        verificationReference: face.verificationReference || null,
        livenessPassed: face.livenessPassed === true ? true : null,
        duplicateCheck: face.duplicateCheck || 'unknown',
        verificationMode: face.verificationMode || 'provider',
        providerVerified: true, failureReason: null,
        distance: Number.isFinite(face.distance) ? face.distance : null,
        threshold: Number.isFinite(face.threshold) ? face.threshold : null,
        model: typeof face.model === 'string' ? face.model : null,
        detectorBackend: typeof face.detectorBackend === 'string' ? face.detectorBackend : null,
      } : { required: false, status: 'not_required', verifiedAt: null, verificationId: null,
        verificationReference: null, livenessPassed: null, duplicateCheck: 'not_required',
        verificationMode: 'not_required', providerVerified: false, failureReason: null };
      const termsAcceptance = {
        accepted: true, acceptedAt: session.termsAcceptance.acceptedAt || new Date(now()),
        termsVersion: session.termsAcceptance.termsVersion, privacyVersion: session.termsAcceptance.privacyVersion,
      };
      const onboardingStatus = requiresFace(session) ? 'face_enrollment_pending' : 'finalization_pending';
      const recoveryProfile = {
        ...profile, uid: user.uid, email: user.email,
        unique_id: existing?.unique_id || `${profile.role === 'requester' ? 'REQ' : 'DIS'}-${String(Number(counts[profile.role] || 0) + 1).padStart(6, '0')}`,
        approvalStatus: existing?.approvalStatus || (profile.role === 'distributor' ? 'pending' : 'approved'),
        status: existing?.status || (profile.role === 'distributor' ? 'Pending' : 'Approved'),
        rejectionReason: existing?.rejectionReason || null,
        emailVerificationRequired: requiresOtp(session), emailVerified: emailOtpVerified === true,
        emailOtpVerification: { required: requiresOtp(session), status: emailOtpVerified === true ? 'verified' : 'not_required' },
        registrationCompleted: false, onboardingStatus,
        faceVerification: trustedFaceVerification, termsAcceptance,
      };
      // A reservation only protects the verification window. The permanent
      // username mapping is claimed atomically with successful finalization.
      if (existing) {
        // Recover an unfinished registration without changing permissions or approval.
        if (!['requester', 'distributor'].includes(existing.role)) {
          throw new OtpError(409, 'account-exists', 'This account already exists. Please log in.');
        }
        if (existing.usernameNormalized && existing.usernameNormalized !== profile.usernameNormalized && !retryingPendingEnrollment) {
          throw new OtpError(409, 'account-exists', 'This account already exists. Please log in.');
        }
        tx.update(ref, { uid: user.uid, email: user.email, emailVerified: emailOtpVerified === true,
          emailVerifiedAt: emailOtpVerified === true ? new Date(now()) : null,
          emailVerificationRequired: requiresOtp(session), emailOtpVerification: recoveryProfile.emailOtpVerification,
          registrationCompleted: false, onboardingStatus,
          updatedAt: new Date(now()), username: profile.username, usernameNormalized: profile.usernameNormalized,
          faceVerification: trustedFaceVerification, termsAcceptance });
        tx.update(registrationSessionRef, { userUid: user.uid, faceEnrollmentPending: requiresFace(session),
          finalization: { status: 'pending', uid: user.uid, startedAt: new Date(now()) }, profileRecovery: recoveryProfile });
        return;
      }
      const number = Number(counts[profile.role] || 0) + 1;
      const prefix = profile.role === 'requester' ? 'REQ' : 'DIS';
      const pending = profile.role === 'distributor';
      tx.set(counter, { [profile.role]: number }, { merge: true });
      tx.set(ref, {
        ...profile, uid: user.uid, email: user.email,
        unique_id: `${prefix}-${String(number).padStart(6, '0')}`,
        approvalStatus: pending ? 'pending' : 'approved', status: pending ? 'Pending' : 'Approved',
        rejectionReason: null, emailVerificationRequired: requiresOtp(session), emailVerified: emailOtpVerified === true,
        emailOtpVerification: recoveryProfile.emailOtpVerification, registrationCompleted: false, onboardingStatus,
        createdAt: new Date(now()), updatedAt: new Date(now()), emailVerifiedAt: emailOtpVerified === true ? new Date(now()) : null,
        faceVerification: trustedFaceVerification, termsAcceptance,
      });
      tx.update(registrationSessionRef, { userUid: user.uid, faceEnrollmentPending: requiresFace(session),
        finalization: { status: 'pending', uid: user.uid, startedAt: new Date(now()) }, profileRecovery: recoveryProfile });
    });
  }
  async function claimFinalUsername(tx, profile, user) {
    const usernameRef = db.collection('usernames').doc(profile.usernameNormalized);
    const reservationRef = db.collection('usernameReservations').doc(profile.usernameNormalized);
    const claimed = await tx.get(usernameRef);
    if (claimed.exists && claimed.data()?.uid !== user.uid) {
      throw new OtpError(409, 'username-taken', 'This username is already taken.');
    }
    tx.set(usernameRef, { uid: user.uid, createdAt: new Date(now()) }, { merge: true });
    // This delete is safe even after a reservation expiry or an idempotent retry.
    tx.delete(reservationRef);
  }
  async function finalizeFaceEnrollment(user, registrationSessionId) {
    const ready = await render('/ready');
    if (ready?.modelLoaded === false || ready?.ready === false || !(ready?.status === 'ready' || ready?.ready === true)) throw new OtpError(503, 'face-service-preparing', 'Face verification service is preparing. Please try again in a moment.');
    // The face service promotes the previously stored, expiring registration
    // reference. Browser and mobile clients never receive its API credential.
    const form = new FormData(); form.append('uid', user.uid); form.append('registration_session_id', registrationSessionId);
    const enrolled = await render('/enroll-face', form);
    if (enrolled?.enrolled !== true || enrolled?.duplicateDetected !== false || enrolled?.reviewRequired !== false) {
      throw new OtpError(enrolled?.duplicateDetected || enrolled?.reviewRequired ? 403 : 502, enrolled?.duplicateDetected || enrolled?.reviewRequired ? 'face-review-required' : 'invalid-face-response', enrolled?.duplicateDetected || enrolled?.reviewRequired ? 'Verification needs review.' : 'Face verification could not finish. Please try again later.');
    }
    const profileRef = db.collection('users').doc(user.uid);
    const sessionRef = db.collection('registrationSessions').doc(registrationSessionId);
    await db.runTransaction(async (tx) => {
      const profile = (await tx.get(profileRef)).data();
      const session = (await tx.get(sessionRef)).data();
      if (!profile || !session || session.userUid !== user.uid || session.completed || !isRegistrationFaceVerified(session.faceVerification)) throw new OtpError(409, 'registration-session-invalid', 'Registration finalization could not be completed.');
      await claimFinalUsername(tx, profile, user);
      await applyRegistrationLimitReservation(tx, sessionRef, session, user.uid, true);
      const face = session.faceVerification;
      const finalizedFaceVerification = {
        status: 'verified', verifiedAt: face.verifiedAt || new Date(now()), verificationId: user.uid, verificationReference: user.uid,
        livenessPassed: face.livenessPassed === true, duplicateCheck: 'clear', verificationMode: 'finalized-enrollment', providerVerified: true,
        model: face.model || 'SFace', detectorBackend: face.detectorBackend || 'yunet', failureReason: null,
      };
      tx.update(profileRef, { onboardingStatus: 'complete', registrationCompleted: true, updatedAt: new Date(now()), faceVerification: finalizedFaceVerification });
      tx.update(sessionRef, { completed: true, emailVerified: session.emailVerified === true, completedAt: new Date(now()), expiresAt: new Date(now()), faceEnrollmentPending: false,
        finalization: { status: 'completed', uid: user.uid, completedAt: new Date(now()) },
        faceVerification: { ...face, status: 'verified', verificationReference: user.uid, captureHash: null },
        profileRecovery: session.profileRecovery ? { ...session.profileRecovery, registrationCompleted: true, onboardingStatus: 'complete', faceVerification: finalizedFaceVerification } : null });
    });
  }
  async function markEnrollmentPending(user, registrationSessionId) {
    await db.runTransaction(async (tx) => {
      tx.update(db.collection('users').doc(user.uid), { onboardingStatus: 'face_enrollment_pending', registrationCompleted: false, updatedAt: new Date(now()) });
      tx.update(db.collection('registrationSessions').doc(registrationSessionId), { faceEnrollmentPending: true });
    });
  }
  async function finalizeWithoutFace(user, registrationSessionId) {
    await db.runTransaction(async (tx) => {
      const profileRef = db.collection('users').doc(user.uid);
      const sessionRef = db.collection('registrationSessions').doc(registrationSessionId);
      const profile = (await tx.get(profileRef)).data();
      const session = (await tx.get(sessionRef)).data();
      if (!profile || !session || requiresFace(session) || session.userUid !== user.uid || session.completed) {
        throw new OtpError(409, 'registration-session-invalid', 'Registration finalization could not be completed.');
      }
      await claimFinalUsername(tx, profile, user);
      await applyRegistrationLimitReservation(tx, sessionRef, session, user.uid, true);
      tx.update(profileRef, { onboardingStatus: 'complete', registrationCompleted: true, updatedAt: new Date(now()) });
      tx.update(sessionRef, { completed: true, completedAt: new Date(now()), expiresAt: new Date(now()), faceEnrollmentPending: false,
        finalization: { status: 'completed', uid: user.uid, completedAt: new Date(now()) },
        profileRecovery: session.profileRecovery ? { ...session.profileRecovery, registrationCompleted: true, onboardingStatus: 'complete' } : null });
    });
  }
  async function authorizeFinalization(email, registrationSessionId, emailOtpVerified = true) {
    const ref = db.collection('registrationSessions').doc(registrationSessionId);
    await db.runTransaction(async (tx) => {
      const session = (await tx.get(ref)).data();
      if (session?.completed === true && session?.finalization?.status === 'completed' &&
        session?.verifiedEmailHash === digest('email:' + email)) return;
      if (!session || session.completed === true || Number(session.expiresAt?.toMillis?.() || session.expiresAt || 0) <= now() ||
        (requiresFace(session) && !hasEligibleFaceStep(session.faceVerification)) ||
        (requiresOtp(session) && !emailOtpVerified) || session.termsAcceptance?.accepted !== true) {
        throw new OtpError(403, 'registration-session-invalid', 'Registration verification is incomplete or expired. Please restart signup.');
      }
      tx.update(ref, { emailVerified: emailOtpVerified, verifiedEmailHash: emailOtpVerified ? digest('email:' + email) : null,
        finalization: { status: 'pending', uid: session.finalization?.uid || null, startedAt: session.finalization?.startedAt || new Date(now()) } });
    });
  }
  async function finish(email, usernameNormalized, registrationSessionId, input, finalFaceImage, verifiedRetry = false, emailOtpVerified = true) {
    logFinalization('started', registrationSessionId);
    const profile = validateProfile(input);
    if (profile.usernameNormalized !== usernameNormalized) {
      throw new OtpError(400, 'invalid-registration', 'Username changed. Please request a new verification code.');
    }
    const completedSession = await db.collection('registrationSessions').doc(registrationSessionId).get();
    const completedData = completedSession.data();
    if (completedData?.completed === true && completedData?.finalization?.status === 'completed' && completedData.finalization.uid) {
      const completedProfile = await db.collection('users').doc(completedData.finalization.uid).get();
      const saved = completedProfile.data();
      if (completedProfile.exists && saved?.email === email && saved?.usernameNormalized === usernameNormalized &&
        saved?.registrationCompleted === true &&
        (requiresFace(completedData) ? saved?.faceVerification?.status === 'verified' : saved?.faceVerification?.status === 'not_required')) {
        logFinalization('idempotent-completed-retry', registrationSessionId);
        return { customToken: await auth.createCustomToken(completedData.finalization.uid), role: saved.role, finalized: true };
      }
      throw new OtpError(503, 'registration-finalization-failed', 'Registration could not be completed. Please try again.');
    }
    const session = await verifiedSession(registrationSessionId, profile);
    if (requiresFace(session)) {
      if (typeof finalFaceImage !== 'string' || session.faceVerification?.captureHash !== captureHash(finalFaceImage)) throw new OtpError(409, 'face-capture-required', 'Please return to signup and complete face verification again.');
      decodeImage(finalFaceImage);
    }
    let user = await findUser(email);
    const created = !user;
    if (user) {
      await checkExistingAccount(user, registrationSessionId, verifiedRetry);
    } else {
      // This is reached only after the OTP hash was successfully checked and consumed.
      user = await auth.createUser({ email, password: input.password, emailVerified: emailOtpVerified });
      logFinalization('auth-created', registrationSessionId, { created: true });
    }
    try {
      await reserveRegistrationLimits(registrationSessionId, user.uid);
      await saveProfile(user, profile, email, registrationSessionId, emailOtpVerified);
      logFinalization('profile-and-username-persisted', registrationSessionId, { created });
    } catch (error) {
      try { await releaseRegistrationLimits(registrationSessionId, user.uid); } catch { /* retain original error */ }
      // Firestore transactions are atomic: if saveProfile throws, its profile
      // and username writes did not commit. Never retain an Auth-only account.
      if (created) {
        try {
          await auth.deleteUser(user.uid);
          logFinalization('auth-rollback-complete', registrationSessionId);
        } catch (rollbackError) {
          logFinalization('auth-rollback-failed', registrationSessionId, { rollbackFailed: true });
          try {
            await db.collection('registrationSessions').doc(registrationSessionId).update({
              finalization: { status: 'recovery_required', uid: user.uid, startedAt: new Date(now()) },
            });
          } catch { /* preserve the original failure; operators have the stage log */ }
        }
      }
      logFinalization('profile-or-username-failed', registrationSessionId, { created });
      throw error;
    }
    try {
      if (requiresFace(session)) await finalizeFaceEnrollment(user, registrationSessionId);
      else await finalizeWithoutFace(user, registrationSessionId);
      logFinalization('face-finalized', registrationSessionId, { created });
    } catch (error) {
      try { await releaseRegistrationLimits(registrationSessionId, user.uid); } catch { /* retain original error */ }
      if (requiresFace(session)) await markEnrollmentPending(user, registrationSessionId);
      logFinalization('face-finalization-pending', registrationSessionId, { created });
      throw error;
    }
    if (!created) {
      // Correct email OTP establishes ownership of this old unverified signup.
      await auth.updateUser(user.uid, { emailVerified: emailOtpVerified, password: input.password });
    }
    const finalized = await db.collection('users').doc(user.uid).get();
    const saved = finalized.data();
    if (!finalized.exists || saved?.uid !== user.uid || saved?.registrationCompleted !== true || saved?.onboardingStatus !== 'complete' ||
      saved?.usernameNormalized !== profile.usernameNormalized ||
      (requiresFace(session) ? saved?.faceVerification?.status !== 'verified' : saved?.faceVerification?.status !== 'not_required') ||
      saved?.termsAcceptance?.accepted !== true) {
      logFinalization('profile-integrity-check-failed', registrationSessionId, { created });
      throw new OtpError(503, 'registration-finalization-failed', 'Registration could not be completed. Please try again.');
    }
    const customToken = await auth.createCustomToken(user.uid);
    logFinalization('completed', registrationSessionId, { created });
    return { customToken, role: saved.role, finalized: true };
  }
  function otpFor(email, usernameNormalized, registrationSessionId, input, finalFaceImage) {
    const uid = 'registration-' + digest('email:' + email);
    // Pending identity adapter: no Firebase account exists or is created on request.
    const pending = {
      getUser: async () => ({ uid, email, emailVerified: false }),
      updateUser: async () => {
        await authorizeFinalization(email, registrationSessionId);
        return { registrationResult: await finish(email, usernameNormalized, registrationSessionId, input, finalFaceImage) };
      },
    };
    return { uid, service: createEmailOtpService({ auth: pending, db, sendEmailOtp, hashSecret, now, allowConsumedRetry: true, onStage: otpStage }) };
  }
  async function reserveUsername(email, usernameNormalized) {
    const registryRef = db.collection('usernames').doc(usernameNormalized);
    const reservationRef = db.collection('usernameReservations').doc(usernameNormalized);
    const ownerHash = digest('email:' + email);
    await db.runTransaction(async (tx) => {
      const claimed = await tx.get(registryRef);
      const reservation = (await tx.get(reservationRef)).data();
      const active = Number(reservation?.expiresAt?.toMillis?.() || reservation?.expiresAt || 0) > now();
      if (claimed.exists || (active && reservation.ownerHash !== ownerHash)) {
        throw new OtpError(409, 'username-taken', 'This username is already taken.');
      }
      tx.set(reservationRef, { ownerHash, expiresAt: new Date(now() + RESERVATION_TTL), createdAt: new Date(now()) });
    });
  }
  async function limitIp(ip) {
    const ref = db.collection('emailOtpVerifications').doc('registration-ip-' + digest('ip:' + ip));
    await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data() || {};
      const time = now();
      const active = Number(data.resetAt) > time;
      if (active && data.count >= 20) throw new OtpError(429, 'resend-limit-reached', 'Too many signup requests. Please wait before trying again.', {
        retryAfterSeconds: Math.ceil((Number(data.resetAt) - time) / 1000),
      });
      tx.set(ref, { count: active ? Number(data.count || 0) + 1 : 1, resetAt: active ? data.resetAt : time + 3600000 });
    });
  }
  async function request(email, username, registrationSessionId, ip) {
    otpStage('OTP_REQUEST_STARTED');
    email = normalizeEmail(email);
    const usernameNormalized = normalizeUsername(username);
    await verifiedSession(registrationSessionId);
    otpStage('OTP_SESSION_VALIDATED');
    await checkExistingAccount(await findUser(email), registrationSessionId);
    await limitIp(ip);
    // A recovery may use a new username after a finalization race. Reserve
    // that new value temporarily; this still creates no permanent mapping.
    await reserveUsername(email, usernameNormalized);
    const session = await verifiedSession(registrationSessionId);
    if (!requiresOtp(session)) {
      return { challenge: challengeFor(email, usernameNormalized, registrationSessionId), otpRequired: false,
        expiresAt: now() + RESERVATION_TTL };
    }
    const otp = otpFor(email, usernameNormalized, registrationSessionId);
    const result = await otp.service.request(otp.uid);
    return { ...result, otpRequired: true, challenge: challengeFor(email, usernameNormalized, registrationSessionId) };
  }
  async function complete(challenge, code, input, finalFaceImage) {
    const { email, usernameNormalized, registrationSessionId } = readChallenge(challenge);
    validateProfile(input);
    const otp = otpFor(email, usernameNormalized, registrationSessionId, input, finalFaceImage);
    return otp.service.verify(otp.uid, code);
  }
  async function completeWithoutOtp(challenge, input, finalFaceImage) {
    const { email, usernameNormalized, registrationSessionId } = readChallenge(challenge);
    const profile = validateProfile(input);
    const session = await verifiedSession(registrationSessionId, profile);
    if (requiresOtp(session)) throw new OtpError(403, 'EMAIL_OTP_REQUIRED', 'Email OTP verification is required.');
    await authorizeFinalization(email, registrationSessionId, false);
    const result = await finish(email, usernameNormalized, registrationSessionId, input, finalFaceImage, false, false);
    return { verified: true, ...result };
  }
  async function retryFinalization(challenge, input, finalFaceImage) {
    const { email, usernameNormalized, registrationSessionId } = readChallenge(challenge);
    const profile = validateProfile(input);
    const snapshot = await db.collection('registrationSessions').doc(registrationSessionId).get();
    const session = snapshot.data();
    const otpRequired = requiresOtp(session);
    if (!snapshot.exists || (otpRequired && (session?.emailVerified !== true || session?.verifiedEmailHash !== digest('email:' + email))) ||
      !['pending', 'recovery_required', 'completed'].includes(session?.finalization?.status)) {
      throw new OtpError(403, 'registration-finalization-not-authorized', 'Please verify your email before finishing registration.');
    }
    if (profile.usernameNormalized !== usernameNormalized) throw new OtpError(400, 'registration-session-mismatch', 'Registration details changed. Please restart signup.');
    const result = await finish(email, usernameNormalized, registrationSessionId, input, finalFaceImage, true, otpRequired);
    return { verified: true, ...result };
  }
  return { request, complete, completeWithoutOtp, retryFinalization };
}
module.exports = { createRegistrationService };
