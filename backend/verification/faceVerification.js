// Server-only Render adapter. Images exist only in request memory.
const { FieldValue } = require('firebase-admin/firestore');
const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { readRegistrationSession } = require('../registration/registrationSession');
const { OtpError } = require('../utils/otpError');
const { applyCors } = require('../utils/cors');

const MAX_IMAGE_BYTES = 1024 * 1024;
const preparing = () => new OtpError(503, 'face-service-preparing', 'Face verification service is preparing. Please try again in a moment.');
function decodeImage(value) {
  if (typeof value !== 'string' || value.length > 1400000) throw new OtpError(413, 'invalid-image-size', 'Each face image must be at most 1 MB.');
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new OtpError(400, 'invalid-image', 'Use a JPEG or PNG face image.');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid || !bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) throw new OtpError(400, 'invalid-image', 'Use a valid JPEG or PNG face image.');
  return new Blob([bytes], { type: `image/${match[1]}` });
}

function createFaceVerificationHandler({ getAdmin = getFirebaseAdmin, fetchImpl = fetch, env = process.env, now = Date.now, timestamp = () => FieldValue.serverTimestamp() } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res, env)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    let timer;
    try {
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new OtpError(415, 'invalid-request', 'Use application/json.');
      let body = req.body;
      if (typeof body === 'string') {
        if (Buffer.byteLength(body) > 2900000) throw new OtpError(413, 'invalid-image-size', 'Face images are too large.');
        try { body = JSON.parse(body); } catch { throw new OtpError(400, 'invalid-request', 'Invalid request.'); }
      }
      const { db } = getAdmin();
      const { ref, data } = await readRegistrationSession(db, body?.registrationSessionId, now);
      if (data.faceVerification?.duplicateCheck === 'flagged') throw new OtpError(403, 'face-review-required', 'Verification needs review.');
      if (data.faceVerification?.status === 'verified') return res.status(200).json({ faceVerification: { status: 'verified', duplicateCheck: data.faceVerification.duplicateCheck || 'unknown' } });
      if (!body.referenceImage || !body.probeImage) throw new OtpError(409, 'face-reference-required', 'Face verification needs a reference photo and a current photo. BlueTap image capture and enrollment are not available yet. Please contact support.');
      const reference = decodeImage(body.referenceImage);
      const probe = decodeImage(body.probeImage);
      const base = (env.DEEPFACE_API_URL || '').replace(/\/+$/, '');
      if (!base.startsWith('https://') || !env.DEEPFACE_API_KEY) throw new OtpError(503, 'face-service-unavailable', 'Face verification is temporarily unavailable.');
      // Bound upstream costs per session; reserve the attempt transactionally.
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        if (!current || current.completed || Number(current.expiresAt?.toMillis?.() || current.expiresAt) <= now()) throw new OtpError(400, 'registration-session-expired', 'Please restart signup.');
        if (current.faceVerification?.duplicateCheck === 'flagged') throw new OtpError(403, 'face-review-required', 'Verification needs review.');
        if (current.faceAttempts >= 10 || now() - (current.faceAttemptAt || 0) < 45000) throw new OtpError(429, 'too-many-attempts', 'Please wait a moment before retrying face verification.');
        tx.update(ref, { faceAttempts: (current.faceAttempts || 0) + 1, faceAttemptAt: now() });
      });
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 40000);
      const headers = { Authorization: `Bearer ${env.DEEPFACE_API_KEY}` };
      async function upstream(path, options = {}) {
        const response = await fetchImpl(`${base}${path}`, { ...options, headers, signal: controller.signal, redirect: 'error' });
        if (response.status === 503) throw preparing();
        if ([401, 403].includes(response.status)) throw new OtpError(502, 'face-service-auth', 'Face verification service is unavailable. Please contact support.');
        if ([400, 413, 422].includes(response.status)) throw new OtpError(400, 'invalid-face-image', 'Use clear images with exactly one visible face in each photo.');
        if (!response.ok) throw new OtpError(502, 'face-upstream-error', 'Face verification could not finish. Please try again.');
        try { return await response.json(); } catch { throw new OtpError(502, 'invalid-face-response', 'Face verification returned an invalid response. Please try again.'); }
      }
      const ready = await upstream('/ready');
      if (ready?.ready === false || ready?.modelLoaded === false || !(ready?.ready === true || ready?.status === 'ready')) throw preparing();
      const form = new FormData();
      // image1: reference photo; image2: current probe. This is only pairwise comparison.
      form.append('image1', reference, 'reference');
      form.append('image2', probe, 'probe');
      const result = await upstream('/verify-face', { method: 'POST', body: form });
      if (typeof result?.verified !== 'boolean') throw new OtpError(502, 'invalid-face-response', 'Face verification returned an invalid response. Please try again.');
      const face = {
        status: result.verified ? 'verified' : 'failed', verifiedAt: result.verified ? timestamp() : null,
        distance: Number.isFinite(result.distance) ? result.distance : null,
        threshold: Number.isFinite(result.threshold) ? result.threshold : null,
        model: typeof result.model === 'string' ? result.model.slice(0, 80) : null,
        detectorBackend: typeof result.detector_backend === 'string' ? result.detector_backend.slice(0, 80) : null,
        verificationMode: 'pairwise', providerVerified: result.verified,
        duplicateCheck: 'unknown', livenessPassed: null,
      };
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        if (!current || current.completed || Number(current.expiresAt?.toMillis?.() || current.expiresAt) <= now()) throw new OtpError(400, 'registration-session-expired', 'Please restart signup.');
        if (current.faceVerification?.duplicateCheck === 'flagged') throw new OtpError(403, 'face-review-required', 'Verification needs review.');
        tx.update(ref, { faceVerification: face });
      });
      return res.status(200).json({ faceVerification: { status: face.status, duplicateCheck: 'unknown' } });
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : error.name === 'AbortError' ? 504 : 502).json({ error: {
        reason: known ? error.reason : 'face-service-unavailable',
        message: known ? error.message : 'Face verification could not finish. Please try again in a moment.',
      } });
    } finally { clearTimeout(timer); }
  };
}
module.exports = { createFaceVerificationHandler, decodeImage };
