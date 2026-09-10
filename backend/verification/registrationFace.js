const { randomInt, randomUUID, createHash } = require('node:crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { readRegistrationSession, isRegistrationFaceVerified } = require('../registration/registrationSession');
const { decodeImage } = require('./faceVerification');
const { createRenderFaceClient } = require('./renderFaceClient');
const defaultDetector = require('./livenessDetector');
const { OtpError } = require('../utils/otpError');

const TTL = 120000;
const instructions = { turn_left: 'Turn your head left', turn_right: 'Turn your head right' };
const ms = (v) => Number(v?.toMillis?.() || v || 0);
const hash = (v) => createHash('sha256').update(v).digest('hex');
const invalid = () => new OtpError(409, 'face-challenge-expired', 'Please start a new face challenge.');
const unavailable = () => new OtpError(503, 'liveness-unavailable', 'The face challenge check is not available yet. Please try again later.');
const contractError = () => new OtpError(502, 'invalid-face-response', 'Face verification could not confirm the result. Please contact support.');
const publicFace = (face) => ({ status: face.status, duplicateCheck: face.duplicateCheck, livenessPassed: face.livenessPassed === true });

function createRegistrationFaceService({ db, detector = defaultDetector, render = createRenderFaceClient(), now = Date.now, timestamp = () => FieldValue.serverTimestamp() }) {
  async function update(id, mutate) {
    const { ref } = await readRegistrationSession(db, id, now);
    return db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data();
      if (!data || data.completed || ms(data.expiresAt) <= now()) throw invalid();
      return mutate(data, (value) => tx.update(ref, value));
    });
  }
  function check(data, challengeId, state) {
    const challenge = data.faceChallenge;
    if (!challenge || challenge.id !== challengeId || challenge.state !== state || ms(challenge.expiresAt) <= now()) throw invalid();
    if (data.faceVerification?.duplicateCheck === 'flagged') throw new OtpError(403, 'face-review-required', 'Verification needs review.');
    return challenge;
  }
  async function begin(id) {
    return update(id, (data, save) => {
      if (isRegistrationFaceVerified(data.faceVerification)) return { faceVerification: publicFace(data.faceVerification) };
      if (data.faceVerification?.duplicateCheck === 'flagged' || data.faceEnrollmentPending) throw new OtpError(409, 'face-review-required', 'Verification needs review. Please contact support.');
      if (['evaluating', 'processing'].includes(data.faceChallenge?.state) && ms(data.faceChallenge.expiresAt) > now()) throw invalid();
      if ((data.faceChallengeAttempts || 0) >= 10 || now() - (data.faceChallengeStartedAt || 0) < 10000) throw new OtpError(429, 'too-many-attempts', 'Please wait before starting another face challenge.');
      const type = Object.keys(instructions)[randomInt(2)];
      const challenge = { id: randomUUID(), type, state: 'issued', expiresAt: new Date(now() + TTL) };
      save({ faceChallenge: challenge, faceChallengeAttempts: (data.faceChallengeAttempts || 0) + 1, faceChallengeStartedAt: now(), faceVerification: { status: 'unverified', duplicateCheck: 'unknown', livenessPassed: null, verifiedAt: null } });
      return { challengeId: challenge.id, challengeType: type, instruction: instructions[type], expiresAt: now() + TTL, detectorAvailable: detector.available === true };
    });
  }
  async function evaluate({ registrationSessionId: id, challengeId, frames }, signal) {
    const { data } = await readRegistrationSession(db, id, now);
    check(data, challengeId, 'issued');
    if (!detector.available) throw unavailable();
    if (!Array.isArray(frames) || frames.length !== 3) throw new OtpError(400, 'invalid-challenge-evidence', 'Capture all three challenge frames.');
    const images = frames.map(decodeImage);
    const challenge = await update(id, (current, save) => {
      const c = check(current, challengeId, 'issued');
      save({ faceChallenge: { ...c, state: 'evaluating' } });
      return c;
    });
    try {
      // Detector sees actual ordered image bytes, never client observations.
      const result = await detector.evaluate({ challenge, images, signal });
      const passed = result?.passed === true && result?.faceCount === 1 && result?.continuousIdentity === true;
      await update(id, (current, save) => {
        const c = check(current, challengeId, 'evaluating');
        save({ faceChallenge: { ...c, state: passed ? 'passed' : 'failed', referenceHash: passed ? hash(frames[2]) : null },
          faceVerification: { status: passed ? 'unverified' : 'failed', verifiedAt: null, duplicateCheck: 'unknown', livenessPassed: passed, failureReason: passed ? null : 'liveness_failed' } });
      });
      return { challengePassed: passed, faceVerification: { status: passed ? 'unverified' : 'failed', duplicateCheck: 'unknown', livenessPassed: passed } };
    } catch (error) {
      await update(id, (current, save) => {
        if (current.faceChallenge?.id === challengeId) save({ faceChallenge: { ...current.faceChallenge, state: 'failed' } });
      });
      throw error;
    }
  }
  async function complete({ registrationSessionId: id, challengeId, referenceImage, image }, signal, webCapture = false) {
    const { data } = await readRegistrationSession(db, id, now);
    const expectedChallengeState = webCapture ? 'issued' : 'passed';
    const c = check(data, challengeId, expectedChallengeState);
    if (!webCapture && (data.faceVerification?.livenessPassed !== true || hash(String(referenceImage)) !== c.referenceHash)) throw invalid();
    const reference = decodeImage(referenceImage);
    const probe = decodeImage(image);
    await update(id, (current, save) => {
      const challenge = check(current, challengeId, expectedChallengeState);
      save({ faceChallenge: { ...challenge, state: 'processing' } });
    });
    let leaseHeld = false;
    let enrollmentAttempted = false;
    const lock = db.collection('faceServiceLocks').doc('enrollment');
    try {
      const ready = await render('/ready', undefined, signal);
      if (ready?.modelLoaded === false || ready?.ready === false || !(ready?.status === 'ready' || ready?.ready === true)) throw new OtpError(503, 'face-service-preparing', 'Face verification service is preparing. Please try again in a moment.');
      const pair = new FormData(); pair.append('image1', reference, 'challenge.jpg'); pair.append('image2', probe, 'final.jpg');
      const match = await render('/verify-face', pair, signal);
      if (typeof match?.verified !== 'boolean') throw contractError();
      if (!match.verified) {
        const face = { status: 'failed', verifiedAt: null, duplicateCheck: 'unknown', livenessPassed: false,
          failureReason: webCapture ? 'face_match_failed' : 'liveness_failed' };
        await update(id, (current, save) => { check(current, challengeId, 'processing'); save({ faceVerification: face, faceChallenge: { ...current.faceChallenge, state: 'failed' } }); });
        return { faceVerification: publicFace(face) };
      }
      // Serialize this application's search/enroll pairs. Render must still
      // provide atomic uniqueness and idempotent enrollment for other callers.
      await db.runTransaction(async (tx) => {
        const held = (await tx.get(lock)).data();
        if (held && ms(held.expiresAt) > now()) throw new OtpError(503, 'face-service-busy', 'Face verification is busy. Please try again in a moment.');
        tx.set(lock, { owner: challengeId, expiresAt: new Date(now() + 60000) });
      });
      leaseHeld = true;
      const search = new FormData(); search.append('image', probe, 'face.jpg');
      const duplicate = await render('/check-duplicate', search, signal);
      // Contract inspected in bluetap-face-api/app.py and face_service.py.
      // An empty database reports distance:null; threshold remains numeric.
      if (typeof duplicate?.duplicateDetected !== 'boolean' || typeof duplicate?.reviewRequired !== 'boolean' ||
          !Number.isFinite(duplicate?.threshold) || !(duplicate.distance === null || Number.isFinite(duplicate.distance))) throw contractError();
      if (duplicate.duplicateDetected || duplicate.reviewRequired) {
        const face = { status: 'review_required', verifiedAt: null, duplicateCheck: 'flagged', livenessPassed: true };
        await update(id, (current, save) => { check(current, challengeId, 'processing'); save({ faceVerification: face, faceChallenge: { ...current.faceChallenge, state: 'used' } }); });
        return { faceVerification: publicFace(face) };
      }
      // Mark an uncertain mutation before sending. A timeout must not silently
      // enroll again or let the next attempt match its own orphaned enrollment.
      await update(id, (current, save) => { check(current, challengeId, 'processing'); save({ faceEnrollmentPending: true }); });
      enrollmentAttempted = true;
      const enrollment = new FormData(); enrollment.append('subject_id', id); enrollment.append('image', probe, 'face.jpg');
      const enrolled = await render('/enroll-face', enrollment, signal);
      if (enrolled?.enrolled === false && (enrolled.duplicateDetected === true || enrolled.reviewRequired === true)) {
        const face = { status: 'review_required', verifiedAt: null, duplicateCheck: 'flagged', livenessPassed: true };
        await update(id, (current, save) => { check(current, challengeId, 'processing'); save({ faceVerification: face, faceEnrollmentPending: false, faceChallenge: { ...current.faceChallenge, state: 'used' } }); });
        return { faceVerification: publicFace(face) };
      }
      if (enrolled?.enrolled !== true || enrolled?.duplicateDetected !== false || enrolled?.reviewRequired !== false) throw contractError();
      const face = { status: 'verified', verifiedAt: timestamp(), duplicateCheck: 'clear', livenessPassed: true,
        verificationReference: id, verificationMode: webCapture ? 'web-camera-capture' : 'registration-enrollment', providerVerified: true,
        model: 'SFace', detectorBackend: 'yunet', failureReason: null };
      await update(id, (current, save) => { check(current, challengeId, 'processing'); save({ faceVerification: face, faceEnrollmentPending: false, faceChallenge: { ...current.faceChallenge, state: 'used' } }); });
      return { faceVerification: publicFace(face) };
    } catch (error) {
      await update(id, (current, save) => {
        if (current.faceChallenge?.id === challengeId) save({ faceChallenge: { ...current.faceChallenge, state: 'failed' }, faceVerification: { status: 'unverified', verifiedAt: null, duplicateCheck: 'unknown', livenessPassed: null }, faceEnrollmentPending: enrollmentAttempted });
      });
      throw error;
    } finally {
      if (leaseHeld) await db.runTransaction(async (tx) => {
        if ((await tx.get(lock)).data()?.owner === challengeId) tx.delete(lock);
      });
    }
  }
  // Web capture still reaches this trusted server path. It cannot set a
  // verification field itself; the backend matches the captures, checks for a
  // duplicate, enrolls the clear result, and then updates the session.
  const webComplete = (body, signal) => complete(body, signal, true);
  return { begin, evaluate, complete, webComplete };
}
module.exports = { createRegistrationFaceService };
