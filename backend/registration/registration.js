const { createHash, createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const { createEmailOtpService } = require('../auth/emailOtp');
const { OtpError } = require('../utils/otpError');
const { normalizeUsername } = require('../username/username');
const { getPasswordApiKey } = require('../username/usernameHandler');
const { readRegistrationSession, isRegistrationFaceVerified } = require('./registrationSession');
const { decodeImage } = require('../verification/faceVerification');
const { createRenderFaceClient } = require('../verification/renderFaceClient');
const { createRegistrationLimitService } = require('./registrationLimits');
const { normalizePhilippinePhone } = require('../utils/phoneUtils');
const { generateNextPublicUid } = require('../utils/publicUidGenerator');
const { canonicalAccountStatus } = require('../auth/accountStatus');

const RESERVATION_TTL = 15 * 60 * 1000;

function createRegistrationService({ auth, db, sendEmailOtp, hashSecret, render = createRenderFaceClient(), now = Date.now, otpStage = () => {}, newUid = randomUUID }) {
  const registrationLimits = createRegistrationLimitService({ db, now });
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
  async function emailAttachedToAnother(email, allowedUid = '') {
    const snapshot = await db.collection('users').where('email', '==', email).limit(2).get();
    return (snapshot.docs || []).some((doc) => doc.id !== allowedUid);
  }
  const millis = (value) => value?.toMillis?.() || (value instanceof Date ? value.getTime() : Number(value) || 0);
  async function recoverableAuthOrphan(user, email) {
    if (!user || user.disabled || user.customClaims?.admin || user.customClaims?.manager) return false;
    const matches = await db.collection('registrationSessions').where('finalization.uid', '==', user.uid).limit(3).get();
    return (matches.docs || []).some((doc) => {
      const old = doc.data();
      return old?.completed !== true && ['requester', 'distributor'].includes(old?.role) &&
        old?.registrationOtpEmailHash === digest('email:' + email) &&
        (old?.finalization?.status === 'recovery_required' ||
          (['processing', 'compensating'].includes(old?.finalization?.status) && millis(old.finalization.leaseUntil) <= now()));
    });
  }
  async function recoverablePendingProfile(user, profile, email, role) {
    if (!user || !profile || profile.registrationCompleted !== false || profile.role !== role ||
      !['requester', 'distributor'].includes(role) ||
      !['face_enrollment_pending', 'finalization_pending'].includes(profile.onboardingStatus) ||
      user.disabled || user.customClaims?.admin || user.customClaims?.manager) return false;
    const matches = await db.collection('registrationSessions').where('userUid', '==', user.uid).limit(3).get();
    return (matches.docs || []).some((doc) => {
      const old = doc.data();
      return old?.completed !== true && old?.role === role &&
        old?.registrationOtpEmailHash === digest('email:' + email) &&
        (old?.finalization?.status === 'recovery_required' ||
          (['processing', 'compensating'].includes(old?.finalization?.status) && millis(old.finalization.leaseUntil) <= now()));
    });
  }
  const canReclaimDraft = (old, current, usernameNormalized, emailHash) => Boolean(old && current &&
    old.completed !== true && old.userUid == null && !old.finalization?.uid && old.emailVerified !== true &&
    old.registrationUsernameNormalized === usernameNormalized && old.registrationOtpEmailHash === emailHash &&
    old.role === current.role && old.personalInfoDigest === current.personalInfoDigest &&
    old.registrationLimitKeys?.deviceHash && old.registrationLimitKeys.deviceHash === current.registrationLimitKeys?.deviceHash);
  async function verifyOrphanPassword(user, password, registrationSessionId) {
    const ref = db.collection('authRateLimits').doc('registration-orphan-password-' + digest('session:' + registrationSessionId));
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() || {};
      const active = millis(current.resetAt) > now();
      const attempts = active ? Number(current.count || 0) : 0;
      if (attempts >= 5) throw new OtpError(429, 'too-many-attempts', 'Too many recovery attempts. Please try again later.');
      tx.set(ref, { count: attempts + 1, resetAt: new Date(active ? millis(current.resetAt) : now() + 3600000) });
    });
    const apiKey = await getPasswordApiKey();
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.localId !== user.uid || !result?.idToken) {
      throw new OtpError(403, 'registration-recovery-unavailable', 'We could not verify this unfinished account. Use the original password or recover it first.');
    }
    const verified = await auth.verifyIdToken(result.idToken);
    if (verified.uid !== user.uid) throw new OtpError(403, 'registration-recovery-unavailable', 'We could not verify this unfinished account.');
  }
  async function availability(username, email, registrationSessionId, ip = 'unknown') {
    const normalizedUsername = normalizeUsername(username);
    const normalizedEmail = normalizeEmail(email);
    const { data: session } = await readRegistrationSession(db, registrationSessionId, now);
    const limitRef = db.collection('authRateLimits').doc('registration-availability-' + digest('ip:' + ip));
    await db.runTransaction(async (tx) => {
      const previous = (await tx.get(limitRef)).data() || {};
      const active = millis(previous.resetAt) > now();
      const count = active ? Number(previous.count || 0) : 0;
      if (count >= 30) throw new OtpError(429, 'too-many-attempts', 'Too many availability checks. Please try again shortly.',
        { retryAfterSeconds: Math.ceil((millis(previous.resetAt) - now()) / 1000) });
      tx.set(limitRef, { count: count + 1, resetAt: new Date(active ? millis(previous.resetAt) : now() + 60000) });
    });
    const emailHash = digest('email:' + normalizedEmail);
    const [claimed, usernameReservation, emailReservation, user, attached] = await Promise.all([
      db.collection('usernames').doc(normalizedUsername).get(),
      db.collection('usernameReservations').doc(normalizedUsername).get(),
      db.collection('registrationEmailReservations').doc(emailHash).get(),
      findUser(normalizedEmail),
      db.collection('users').where('email', '==', normalizedEmail).limit(2).get(),
    ]);
    const linkedProfile = user ? (await db.collection('users').doc(user.uid).get()).data() : null;
    const ownUsername = usernameReservation.data()?.registrationSessionId === registrationSessionId;
    const ownEmail = emailReservation.data()?.registrationSessionId === registrationSessionId;
    const foreignUsernameSession = millis(usernameReservation.data()?.expiresAt) > now() && !ownUsername
      ? usernameReservation.data()?.registrationSessionId : null;
    const foreignEmailSession = millis(emailReservation.data()?.expiresAt) > now() && !ownEmail
      ? emailReservation.data()?.registrationSessionId : null;
    const reclaimSessionId = foreignUsernameSession || foreignEmailSession;
    const matchingOwner = !foreignUsernameSession || !foreignEmailSession || foreignUsernameSession === foreignEmailSession;
    const oldDraft = reclaimSessionId && matchingOwner
      ? (await db.collection('registrationSessions').doc(reclaimSessionId).get()).data() : null;
    const reclaimable = matchingOwner && canReclaimDraft(oldDraft, session, normalizedUsername, emailHash);
    const pendingUser = user && (session?.userUid === user.uid || session?.finalization?.uid === user.uid) && session?.completed !== true &&
      ['pending', 'processing', 'compensating', 'recovery_required'].includes(session?.finalization?.status);
    const recoverableLegacyUser = user && requiresOtp(session) && !user.disabled && !user.emailVerified &&
      !user.customClaims?.admin && !user.customClaims?.manager &&
      (!linkedProfile || (['requester', 'distributor'].includes(linkedProfile.role) && linkedProfile.registrationCompleted !== true));
    const recoverableOrphan = user && !linkedProfile && await recoverableAuthOrphan(user, normalizedEmail);
    const recoverableProfile = user && linkedProfile && await recoverablePendingProfile(user, linkedProfile, normalizedEmail, session.role);
    return {
      usernameAvailable: !claimed.exists && (!usernameReservation.exists || millis(usernameReservation.data()?.expiresAt) <= now() || ownUsername || reclaimable),
      emailAvailable: (!user || pendingUser || recoverableLegacyUser || recoverableOrphan || recoverableProfile) && !(attached.docs || []).some((doc) => doc.id !== user?.uid) &&
        (!emailReservation.exists || millis(emailReservation.data()?.expiresAt) <= now() || ownEmail || reclaimable),
      normalizedUsername,
      finalizationPending: ['processing', 'compensating'].includes(session?.finalization?.status) && millis(session.finalization.leaseUntil) > now(),
    };
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
      session?.completed !== true && (requiresOtp(session) ? (session?.emailVerified === true && session?.verifiedEmailHash === digest('email:' + normalizeEmail(user.email))) : true) &&
      ['pending', 'processing', 'compensating', 'recovery_required'].includes(session?.finalization?.status) &&
      (requiresOtp(session) ? (!session.finalization.uid || session.finalization.uid === user.uid) : session.finalization.uid === user.uid);
    const reclaimingOrphan = !existing && await recoverableAuthOrphan(user, normalizeEmail(user.email));
    const reclaimingPendingProfile = existing && await recoverablePendingProfile(user, existing, normalizeEmail(user.email), session?.role);
    if (retryingPendingEnrollment || retryingAuthOnlyRecovery || reclaimingOrphan || reclaimingPendingProfile) return true;
    if (user.disabled || user.emailVerified || user.customClaims?.admin || user.customClaims?.manager ||
      existing?.registrationCompleted === true || (existing && !['requester', 'distributor'].includes(existing.role)) ||
      (!requiresOtp(session) && !retryingPendingEnrollment && !retryingAuthOnlyRecovery)) {
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
    const phoneInput = text('phone', 25);
    const phone = normalizePhilippinePhone(phoneInput);
    if (!phone) throw new OtpError(400, 'invalid-registration', 'Enter a valid Philippine mobile number.');
    if (typeof input.password !== 'string' || input.password.trim().length < 8 || input.password.length > 128) {
      throw new OtpError(400, 'invalid-registration', 'Password must be between 8 and 128 characters.');
    }
    const username = text('username', 20);
    const usernameNormalized = normalizeUsername(username);
    const requestedBranchId = role === 'distributor'
      ? text('requestedBranchId', 80)
      : '';
    return { firstName: text('firstName', 100), lastName: text('lastName', 100),
      barangay: text('barangay', 150), address: text('address', 250), phone, role,
      username, usernameNormalized, requestedBranchId };
  }
  const personalDigest = (profile) => digest(JSON.stringify([profile.role, profile.firstName, profile.lastName, profile.phone, profile.barangay, profile.address, ...(profile.role === 'distributor' ? [profile.requestedBranchId || ''] : [])]));
  const captureHash = (image) => createHash('sha256').update(String(image)).digest('hex');
  const hasEligibleFaceStep = isRegistrationFaceVerified;
  const requiresFace = (session) => session?.securityPolicySnapshot?.faceVerificationRequired !== false;
  const requiresOtp = (session) => session?.securityPolicySnapshot?.emailOtpRequired !== false;
  async function verifiedSession(registrationSessionId, profile) {
    const { data } = await readRegistrationSession(db, registrationSessionId, now);
    if (requiresFace(data) && !hasEligibleFaceStep(data.faceVerification)) {
      throw new OtpError(403, data.faceVerification?.duplicateCheck === 'flagged' ? 'face-review-required' : 'face-verification-required', data.faceVerification?.duplicateCheck === 'flagged' ? 'Verification needs review.' : 'Complete identity verification before continuing.');
    }
    if (data.termsAcceptance?.accepted !== true) throw new OtpError(403, 'terms-required', 'Please accept the Terms of Service and Privacy Policy to continue.');
    if (profile && (data.role !== profile.role || data.personalInfoDigest !== personalDigest(profile) || (profile.role === 'distributor' && data.requestedBranchId !== profile.requestedBranchId))) {
      throw new OtpError(400, 'registration-session-mismatch', 'Your registration details changed. Please restart identity verification.');
    }
    return data;
  }
  async function saveProfile(user, profile, email, registrationSessionId, emailOtpVerified, finalizationOwner) {
    const ref = db.collection('users').doc(user.uid);
    const counter = db.collection('counters').doc('unique_ids');
    const usernameRef = db.collection('usernames').doc(profile.usernameNormalized);
    const reservationRef = db.collection('usernameReservations').doc(profile.usernameNormalized);
    const registrationSessionRef = db.collection('registrationSessions').doc(registrationSessionId);
    const emailReservationRef = db.collection('registrationEmailReservations').doc(digest('email:' + email));
    await db.runTransaction(async (tx) => {
      const existing = (await tx.get(ref)).data();
      const counts = (await tx.get(counter)).data() || {};
      const claimed = (await tx.get(usernameRef)).data();
      const reservation = (await tx.get(reservationRef)).data();
      const emailReservation = (await tx.get(emailReservationRef)).data();
      const session = (await tx.get(registrationSessionRef)).data();
      const emailOwnerHash = digest('email:' + email);
      const reservationValid = reservation?.ownerHash === emailOwnerHash && reservation.registrationSessionId === registrationSessionId &&
        millis(reservation.expiresAt) > now();
      const emailReservationValid = emailReservation?.registrationSessionId === registrationSessionId && millis(emailReservation.expiresAt) > now();
      const retryingPendingEnrollment = existing && existing.registrationCompleted === false &&
        ['face_enrollment_pending', 'finalization_pending'].includes(existing.onboardingStatus) &&
        session?.userUid === user.uid && session?.completed !== true;
      if ((claimed?.uid && claimed.uid !== user.uid) || (!reservationValid && !retryingPendingEnrollment)) {
        throw new OtpError(409, 'username-taken', 'This username is already taken.');
      }
      if (!emailReservationValid || session?.registrationOtpEmailHash !== emailOwnerHash ||
        session?.registrationUsernameNormalized !== profile.usernameNormalized) {
        throw new OtpError(409, 'registration-session-mismatch', 'Registration details changed. Please request a new verification code.');
      }
      if (!session || session.completed || session.finalization?.owner !== finalizationOwner || Number(session.expiresAt?.toMillis?.() || session.expiresAt || 0) <= now() ||
        (requiresFace(session) && !hasEligibleFaceStep(session.faceVerification)) ||
        (requiresOtp(session) && emailOtpVerified !== true) || session.termsAcceptance?.accepted !== true ||
        session.role !== profile.role || session.personalInfoDigest !== personalDigest(profile) ||
        (profile.role === 'distributor' && session.requestedBranchId !== profile.requestedBranchId)) {
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
      const distributorApplication = profile.role === 'distributor' ? {
        distributorStatus: existing?.distributorStatus || 'pending',
        approvalStatus: existing?.approvalStatus || 'pending', status: existing?.status || 'Pending',
        requestedBranchId: session.requestedBranchId, requestedBranchNameSnapshot: session.requestedBranchNameSnapshot || null,
        branchId: existing?.branchId || null, branchNameSnapshot: existing?.branchNameSnapshot || null,
      } : {};
      const publicPrefix = profile.role === 'requester' ? 'Req' : 'Dis';
      const recoveredPublicUid = !existing && typeof session?.profileRecovery?.publicUid === 'string' &&
        new RegExp(`^${publicPrefix}\\d+$`, 'i').test(session.profileRecovery.publicUid)
        ? session.profileRecovery.publicUid : '';
      const recoveredNumber = recoveredPublicUid ? Number(recoveredPublicUid.slice(publicPrefix.length)) : 0;
      const number = recoveredNumber || Number(counts[profile.role] || 0) + 1;
      const publicUid = existing?.publicUid || existing?.displayUid || recoveredPublicUid || `${publicPrefix}${String(number).padStart(3, '0')}`;
      const recoveryProfile = {
        ...profile, uid: user.uid, email: user.email,
        accountStatus: existing ? canonicalAccountStatus(existing) : 'active',
        publicUid,
        displayUid: publicUid,
        unique_id: existing?.unique_id || `${profile.role === 'requester' ? 'REQ' : 'DIS'}-${String(number).padStart(6, '0')}`,
        approvalStatus: existing?.approvalStatus || (profile.role === 'distributor' ? 'pending' : 'approved'),
        status: existing?.status || (profile.role === 'distributor' ? 'Pending' : 'Approved'),
        ...distributorApplication,
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
          accountStatus: canonicalAccountStatus(existing),
          emailVerifiedAt: emailOtpVerified === true ? new Date(now()) : null,
          emailVerificationRequired: requiresOtp(session), emailOtpVerification: recoveryProfile.emailOtpVerification,
          registrationCompleted: false, onboardingStatus,
          updatedAt: new Date(now()), username: profile.username, usernameNormalized: profile.usernameNormalized,
          faceVerification: trustedFaceVerification, termsAcceptance });
        tx.update(registrationSessionRef, { userUid: user.uid, faceEnrollmentPending: requiresFace(session),
          finalization: { ...session.finalization, uid: user.uid, leaseUntil: new Date(now() + 3 * 60 * 1000) }, profileRecovery: recoveryProfile });
        return;
      }
      const prefix = profile.role === 'requester' ? 'REQ' : 'DIS';
      const pending = profile.role === 'distributor';
      if (!recoveredPublicUid) {
        tx.set(counter, { [profile.role]: number }, { merge: true });
        tx.set(db.collection('accountCounters').doc(profile.role), {
          role: profile.role,
          lastNumber: number,
          count: number,
          updatedAt: new Date(now()),
        }, { merge: true });
      }
      tx.set(ref, {
        ...profile, uid: user.uid, email: user.email,
        accountStatus: 'active',
        publicUid,
        displayUid: publicUid,
        unique_id: `${prefix}-${String(number).padStart(6, '0')}`,
        approvalStatus: pending ? 'pending' : 'approved', status: pending ? 'Pending' : 'Approved',
        ...(pending ? { distributorStatus: 'pending', requestedBranchId: session.requestedBranchId, requestedBranchNameSnapshot: session.requestedBranchNameSnapshot || null, branchId: null, branchNameSnapshot: null } : {}),
        rejectionReason: null, emailVerificationRequired: requiresOtp(session), emailVerified: emailOtpVerified === true,
        emailOtpVerification: recoveryProfile.emailOtpVerification, registrationCompleted: false, onboardingStatus,
        createdAt: new Date(now()), updatedAt: new Date(now()), emailVerifiedAt: emailOtpVerified === true ? new Date(now()) : null,
        faceVerification: trustedFaceVerification, termsAcceptance,
      });
      tx.update(registrationSessionRef, { userUid: user.uid, faceEnrollmentPending: requiresFace(session),
        finalization: { ...session.finalization, uid: user.uid, leaseUntil: new Date(now() + 3 * 60 * 1000) }, profileRecovery: recoveryProfile });
    });
  }
  async function prepareFinalUsernameClaim(tx, profile, user, registrationSessionId) {
    const usernameRef = db.collection('usernames').doc(profile.usernameNormalized);
    const reservationRef = db.collection('usernameReservations').doc(profile.usernameNormalized);
    const claimed = await tx.get(usernameRef);
    const reservation = (await tx.get(reservationRef)).data();
    if (claimed.exists && claimed.data()?.uid !== user.uid) {
      throw new OtpError(409, 'username-taken', 'This username is already taken.');
    }
    if (millis(reservation?.expiresAt) > now() && reservation.registrationSessionId !== registrationSessionId) {
      throw new OtpError(409, 'username-taken', 'This username is already taken.');
    }
    return () => {
      tx.set(usernameRef, { uid: user.uid, createdAt: new Date(now()) }, { merge: true });
      // This delete is safe even after a reservation expiry or an idempotent retry.
      tx.delete(reservationRef);
    };
  }
  async function finalizeFaceEnrollment(user, registrationSessionId, finalizationOwner) {
    const ready = await render('/ready');
    if (ready?.modelLoaded === false || ready?.ready === false || !(ready?.status === 'ready' || ready?.ready === true)) throw new OtpError(503, 'face-service-preparing', 'Face verification service is preparing. Please try again in a moment.');
    // The face service promotes the previously stored, expiring registration
    // reference. Browser and mobile clients never receive its API credential.
    const form = new FormData(); form.append('uid', user.uid); form.append('registration_session_id', registrationSessionId);
    const enrolled = await render('/enroll-face', form, AbortSignal.timeout(120000));
    if (enrolled?.enrolled !== true || enrolled?.duplicateDetected !== false || enrolled?.reviewRequired !== false) {
      throw new OtpError(enrolled?.duplicateDetected || enrolled?.reviewRequired ? 403 : 502, enrolled?.duplicateDetected || enrolled?.reviewRequired ? 'face-review-required' : 'invalid-face-response', enrolled?.duplicateDetected || enrolled?.reviewRequired ? 'Verification needs review.' : 'Face verification could not finish. Please try again later.');
    }
    const profileRef = db.collection('users').doc(user.uid);
    const sessionRef = db.collection('registrationSessions').doc(registrationSessionId);
    await db.runTransaction(async (tx) => {
      const profile = (await tx.get(profileRef)).data();
      const session = (await tx.get(sessionRef)).data();
      if (!profile || !session || session.userUid !== user.uid || session.completed || session.finalization?.owner !== finalizationOwner || !isRegistrationFaceVerified(session.faceVerification)) throw new OtpError(409, 'registration-session-invalid', 'Registration finalization could not be completed.');
      const claimUsername = await prepareFinalUsernameClaim(tx, profile, user, registrationSessionId);
      const commitLimits = await registrationLimits.prepareApply(tx, sessionRef, session, user.uid, true);
      claimUsername();
      commitLimits();
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
  async function discardCreatedIncompleteRegistration(user, registrationSessionId) {
    const profileRef = db.collection('users').doc(user.uid);
    const sessionRef = db.collection('registrationSessions').doc(registrationSessionId);
    await db.runTransaction(async (tx) => {
      const profile = await tx.get(profileRef);
      const session = await tx.get(sessionRef);
      if (profile.exists && profile.data()?.registrationCompleted === false && session.data()?.userUid === user.uid) tx.delete(profileRef);
      if (session.exists && session.data()?.userUid === user.uid && session.data()?.completed !== true) {
        tx.update(sessionRef, { userUid: null, faceEnrollmentPending: false,
          profileRecovery: { ...(session.data()?.profileRecovery || {}), uid: null, registrationCompleted: false, onboardingStatus: 'finalization_pending' },
          finalization: { status: 'recovery_required', uid: null, startedAt: new Date(now()) } });
      }
    });
  }
  async function finalizeWithoutFace(user, registrationSessionId, finalizationOwner) {
    await db.runTransaction(async (tx) => {
      const profileRef = db.collection('users').doc(user.uid);
      const sessionRef = db.collection('registrationSessions').doc(registrationSessionId);
      const profile = (await tx.get(profileRef)).data();
      const session = (await tx.get(sessionRef)).data();
      if (!profile || !session || requiresFace(session) || session.userUid !== user.uid || session.completed || session.finalization?.owner !== finalizationOwner) {
        throw new OtpError(409, 'registration-session-invalid', 'Registration finalization could not be completed.');
      }
      const claimUsername = await prepareFinalUsernameClaim(tx, profile, user, registrationSessionId);
      const commitLimits = await registrationLimits.prepareApply(tx, sessionRef, session, user.uid, true);
      claimUsername();
      commitLimits();
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
        (requiresOtp(session) && session.registrationOtpEmailHash !== digest('email:' + email)) ||
        (requiresFace(session) && !hasEligibleFaceStep(session.faceVerification)) ||
        (requiresOtp(session) && !emailOtpVerified) || session.termsAcceptance?.accepted !== true) {
        throw new OtpError(403, 'registration-session-invalid', 'Registration verification is incomplete or expired. Please restart signup.');
      }
      tx.update(ref, { emailVerified: emailOtpVerified, verifiedEmailHash: emailOtpVerified ? digest('email:' + email) : null,
        finalization: ['processing', 'compensating'].includes(session.finalization?.status) ? session.finalization :
          { status: 'pending', uid: session.finalization?.uid || null, startedAt: session.finalization?.startedAt || new Date(now()) } });
    });
  }
  async function claimFinalization(registrationSessionId, email, usernameNormalized, existingUid) {
    const ref = db.collection('registrationSessions').doc(registrationSessionId);
    const owner = randomUUID();
    let provisionalUid;
    await db.runTransaction(async (tx) => {
      const session = (await tx.get(ref)).data();
      if (!session || session.completed || millis(session.expiresAt) <= now() ||
        session.registrationOtpEmailHash !== digest('email:' + email) ||
        session.registrationUsernameNormalized !== usernameNormalized) {
        throw new OtpError(409, 'registration-session-invalid', 'Registration verification is incomplete or expired. Please restart signup.');
      }
      if (['processing', 'compensating'].includes(session.finalization?.status) && millis(session.finalization.leaseUntil) > now()) {
        throw new OtpError(409, 'registration-finalization-pending', 'Account finalization is in progress. Please retry in a moment.');
      }
      provisionalUid = session.finalization?.uid || existingUid || newUid();
      tx.update(ref, { finalization: { status: 'processing', uid: provisionalUid,
        owner, startedAt: new Date(now()), leaseUntil: new Date(now() + 3 * 60 * 1000) } });
    });
    return { owner, provisionalUid };
  }
  async function beginCompensation(registrationSessionId, owner) {
    const ref = db.collection('registrationSessions').doc(registrationSessionId);
    return db.runTransaction(async (tx) => {
      const session = (await tx.get(ref)).data();
      if (!session || session.completed || session.finalization?.owner !== owner) return false;
      tx.update(ref, { finalization: { ...session.finalization, status: 'compensating', leaseUntil: new Date(now() + 3 * 60 * 1000) } });
      return true;
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
    if (user && session.finalization?.uid && session.finalization.uid !== user.uid) {
      throw new OtpError(409, 'account-exists', 'Email already registered.');
    }
    if (user) await checkExistingAccount(user, registrationSessionId, verifiedRetry);
    if (user && !requiresOtp(session) && session.finalization?.uid !== user.uid && session.userUid !== user.uid) {
      await verifyOrphanPassword(user, input.password, registrationSessionId);
    }
    const { owner: finalizationOwner, provisionalUid } = await claimFinalization(registrationSessionId, email, usernameNormalized, user?.uid);
    try {
    let created = false;
    if (await emailAttachedToAnother(email, user?.uid)) {
      throw new OtpError(409, 'email-in-use', 'This email is already in use. Please log in or recover your account.');
    }
    if (user) {
      await checkExistingAccount(user, registrationSessionId, verifiedRetry);
    } else {
      // This is reached only after the OTP hash was successfully checked and consumed.
      try {
        user = await auth.createUser({ uid: provisionalUid, email, password: input.password, emailVerified: emailOtpVerified });
        created = true;
        logFinalization('auth-created', registrationSessionId, { created: true });
      } catch (error) {
        if (error.code !== 'auth/email-already-exists') throw error;
        user = await findUser(email);
        if (!user) throw error;
        await checkExistingAccount(user, registrationSessionId, true);
      }
    }
    try {
      await registrationLimits.reserve(registrationSessionId, user.uid);
      await saveProfile(user, profile, email, registrationSessionId, emailOtpVerified, finalizationOwner);
      logFinalization('profile-and-username-persisted', registrationSessionId, { created });
    } catch (error) {
      if (!await beginCompensation(registrationSessionId, finalizationOwner)) {
        throw new OtpError(409, 'registration-finalization-pending', 'Another request is finishing this account. Please retry in a moment.');
      }
      try { await registrationLimits.release(registrationSessionId, user.uid); } catch { /* retain original error */ }
      // Firestore transactions are atomic: if saveProfile throws, its profile
      // and username writes did not commit. Never retain an Auth-only account.
      let rollbackUid = user.uid;
      if (created) {
        try {
          await auth.deleteUser(user.uid);
          rollbackUid = null;
          logFinalization('auth-rollback-complete', registrationSessionId);
        } catch (rollbackError) {
          logFinalization('auth-rollback-failed', registrationSessionId, { rollbackFailed: true });
        }
      }
      try {
        await db.collection('registrationSessions').doc(registrationSessionId).update({
          finalization: { status: 'recovery_required', uid: rollbackUid, startedAt: new Date(now()) },
        });
      } catch { /* preserve the original failure; operators have the stage log */ }
      logFinalization('profile-or-username-failed', registrationSessionId, { created });
      throw error;
    }
    try {
      if (!created) {
        // Email ownership was proved by the current OTP. Keep Auth and profile
        // consistent before the profile can be marked operational.
        await auth.updateUser(user.uid, { emailVerified: emailOtpVerified, password: input.password });
      }
      if (requiresFace(session)) await finalizeFaceEnrollment(user, registrationSessionId, finalizationOwner);
      else await finalizeWithoutFace(user, registrationSessionId, finalizationOwner);
      logFinalization('face-finalized', registrationSessionId, { created });
    } catch (error) {
      if (!await beginCompensation(registrationSessionId, finalizationOwner)) {
        throw new OtpError(409, 'registration-finalization-pending', 'Another request is finishing this account. Please retry in a moment.');
      }
      try { await registrationLimits.release(registrationSessionId, user.uid); } catch { /* retain original error */ }
      if (created) {
        let deleted = false;
        try { await auth.deleteUser(user.uid); deleted = true; } catch { logFinalization('auth-rollback-failed', registrationSessionId, { rollbackFailed: true }); }
        try {
          if (deleted) await discardCreatedIncompleteRegistration(user, registrationSessionId);
          else await markEnrollmentPending(user, registrationSessionId);
        } catch { logFinalization('profile-rollback-failed', registrationSessionId, { rollbackFailed: true }); }
      } else if (requiresFace(session)) await markEnrollmentPending(user, registrationSessionId);
      logFinalization('face-finalization-pending', registrationSessionId, { created });
      throw error;
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
    } catch (error) {
      try {
        const ref = db.collection('registrationSessions').doc(registrationSessionId);
        await db.runTransaction(async (tx) => {
          const current = (await tx.get(ref)).data();
          if (current?.completed !== true && current?.finalization?.owner === finalizationOwner) {
            tx.update(ref, { finalization: { status: 'recovery_required', uid: current.finalization.uid || null, startedAt: current.finalization.startedAt || new Date(now()) } });
          }
        });
      } catch { /* Keep the original error; the lease remains bounded. */ }
      throw error;
    }
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
  async function reserveIdentifiers(email, usernameNormalized, registrationSessionId) {
    const registryRef = db.collection('usernames').doc(usernameNormalized);
    const reservationRef = db.collection('usernameReservations').doc(usernameNormalized);
    const emailHash = digest('email:' + email);
    const emailReservationRef = db.collection('registrationEmailReservations').doc(emailHash);
    const sessionRef = db.collection('registrationSessions').doc(registrationSessionId);
    await db.runTransaction(async (tx) => {
      const claimed = await tx.get(registryRef);
      const reservation = (await tx.get(reservationRef)).data();
      const emailReservation = (await tx.get(emailReservationRef)).data();
      const session = (await tx.get(sessionRef)).data();
      if (!session || session.completed || millis(session.expiresAt) <= now() ||
        (['processing', 'compensating'].includes(session.finalization?.status) && millis(session.finalization.leaseUntil) > now())) {
        throw new OtpError(403, 'registration-session-invalid', 'Registration verification is incomplete or expired. Please restart signup.');
      }
      const oldUsername = session.registrationUsernameNormalized;
      const oldEmailHash = session.registrationOtpEmailHash;
      const oldUsernameRef = oldUsername && oldUsername !== usernameNormalized ? db.collection('usernameReservations').doc(oldUsername) : null;
      const oldEmailRef = oldEmailHash && oldEmailHash !== emailHash ? db.collection('registrationEmailReservations').doc(oldEmailHash) : null;
      const oldOtpRef = oldEmailHash && oldEmailHash !== emailHash ? db.collection('emailOtpVerifications').doc('registration-' + oldEmailHash) : null;
      const oldUsernameReservation = oldUsernameRef ? (await tx.get(oldUsernameRef)).data() : null;
      const oldEmailReservation = oldEmailRef ? (await tx.get(oldEmailRef)).data() : null;
      const oldOtp = oldOtpRef ? (await tx.get(oldOtpRef)).data() : null;
      const foreignUsernameSession = millis(reservation?.expiresAt) > now() && reservation.registrationSessionId !== registrationSessionId
        ? reservation.registrationSessionId : null;
      const foreignEmailSession = millis(emailReservation?.expiresAt) > now() && emailReservation.registrationSessionId !== registrationSessionId
        ? emailReservation.registrationSessionId : null;
      const reclaimSessionId = foreignUsernameSession || foreignEmailSession;
      const matchingOwner = !foreignUsernameSession || !foreignEmailSession || foreignUsernameSession === foreignEmailSession;
      const reclaimRef = reclaimSessionId && matchingOwner ? db.collection('registrationSessions').doc(reclaimSessionId) : null;
      const reclaimSession = reclaimRef ? (await tx.get(reclaimRef)).data() : null;
      const reclaimable = matchingOwner && canReclaimDraft(reclaimSession, session, usernameNormalized, emailHash);
      const reclaimOtpRef = reclaimable ? db.collection('emailOtpVerifications').doc('registration-' + emailHash) : null;
      const reclaimOtp = reclaimOtpRef ? (await tx.get(reclaimOtpRef)).data() : null;
      if (claimed.exists || (foreignUsernameSession && !reclaimable)) {
        throw new OtpError(409, 'username-taken', 'This username is already taken.');
      }
      if (foreignEmailSession && !reclaimable) {
        throw new OtpError(409, 'email-in-use', 'This email is currently in use. Please retry later.');
      }
      if (reclaimable) {
        tx.update(reclaimRef, { supersededBy: registrationSessionId, expiresAt: new Date(now()) });
        if (reclaimOtp) tx.update(reclaimOtpRef, { otpHash: null, status: 'invalidated' });
      }
      if (oldUsernameReservation?.registrationSessionId === registrationSessionId) tx.delete(oldUsernameRef);
      if (oldEmailReservation?.registrationSessionId === registrationSessionId) tx.delete(oldEmailRef);
      if (oldOtp && (!oldEmailReservation || oldEmailReservation.registrationSessionId === registrationSessionId)) {
        tx.update(oldOtpRef, { otpHash: null, status: 'invalidated' });
      }
      tx.set(reservationRef, { ownerHash: emailHash, registrationSessionId, expiresAt: new Date(now() + RESERVATION_TTL), createdAt: new Date(now()) });
      tx.set(emailReservationRef, { registrationSessionId, expiresAt: new Date(now() + RESERVATION_TTL), createdAt: new Date(now()) });
      tx.update(sessionRef, { registrationOtpEmailHash: emailHash, registrationUsernameNormalized: usernameNormalized });
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
    const existingUser = await findUser(email);
    await checkExistingAccount(existingUser, registrationSessionId);
    if (await emailAttachedToAnother(email, existingUser?.uid)) {
      throw new OtpError(409, 'email-in-use', 'This email is already in use. Please log in or recover your account.');
    }
    await limitIp(ip);
    // A recovery may use a new username after a finalization race. Reserve
    // that new value temporarily; this still creates no permanent mapping.
    await reserveIdentifiers(email, usernameNormalized, registrationSessionId);
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
    const snapshot = await db.collection('registrationSessions').doc(registrationSessionId).get();
    const session = snapshot.data();
    if (session?.completed === true && session?.finalization?.status === 'completed') {
      return retryFinalization(challenge, input, finalFaceImage);
    }
    await verifiedSession(registrationSessionId, profile);
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
      !['pending', 'processing', 'compensating', 'recovery_required', 'completed'].includes(session?.finalization?.status)) {
      throw new OtpError(403, 'registration-finalization-not-authorized', 'Please verify your email before finishing registration.');
    }
    if (profile.usernameNormalized !== usernameNormalized) throw new OtpError(400, 'registration-session-mismatch', 'Registration details changed. Please restart signup.');
    const result = await finish(email, usernameNormalized, registrationSessionId, input, finalFaceImage, true, otpRequired);
    return { verified: true, ...result };
  }
  return { availability, request, complete, completeWithoutOtp, retryFinalization };
}
module.exports = { createRegistrationService };
