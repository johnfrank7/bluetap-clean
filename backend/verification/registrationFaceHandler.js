const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { createRegistrationFaceService } = require('./registrationFace');
const { OtpError } = require('../utils/otpError');
const { applyCors } = require('../utils/cors');

function createRegistrationFaceHandler(getService = () => createRegistrationFaceService({ db: getFirebaseAdmin().db })) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new OtpError(415, 'invalid-request', 'Use application/json.');
      let body = req.body;
      if (typeof body === 'string') {
        if (Buffer.byteLength(body) > 4250000) throw new OtpError(413, 'invalid-image-size', 'Face images are too large.');
        try { body = JSON.parse(body); } catch { throw new OtpError(400, 'invalid-request', 'Invalid request.'); }
      }
      if (!['begin', 'evaluate', 'complete', 'web-complete'].includes(body?.action)) throw new OtpError(400, 'invalid-request', 'Invalid face verification action.');
      const service = getService();
      const action = body.action === 'web-complete' ? 'webComplete' : body.action;
      const result = action === 'begin' ? await service.begin(body.registrationSessionId) : await service[action](body, controller.signal);
      return res.status(200).json(result);
    } catch (error) {
      const known = error instanceof OtpError;
      // Keep upstream detail out of the response, but retain enough context in
      // Vercel logs to diagnose DeepFace outages and invalid payloads.
      console.error('Registration face verification failed', {
        status: known ? error.status : error.name === 'AbortError' ? 504 : 502,
        reason: known ? error.reason : 'face-service-unavailable',
        cause: error?.message,
      });
      return res.status(known ? error.status : error.name === 'AbortError' ? 504 : 502).json({ error: {
        reason: known ? error.reason : 'face-service-unavailable',
        message: known ? error.message : 'Face verification could not finish. Please try again later.',
      } });
    } finally { clearTimeout(timer); }
  };
}
module.exports = { createRegistrationFaceHandler };
