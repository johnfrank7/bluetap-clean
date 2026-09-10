const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { createRegistrationFaceService } = require('./registrationFace');
const { OtpError } = require('../utils/otpError');

function createRegistrationFaceHandler(getService = () => createRegistrationFaceService({ db: getFirebaseAdmin().db })) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
      if (!['begin', 'evaluate', 'complete'].includes(body?.action)) throw new OtpError(400, 'invalid-request', 'Invalid face verification action.');
      const service = getService();
      const result = body.action === 'begin' ? await service.begin(body.registrationSessionId) : await service[body.action](body, controller.signal);
      return res.status(200).json(result);
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : error.name === 'AbortError' ? 504 : 502).json({ error: {
        reason: known ? error.reason : 'face-service-unavailable',
        message: known ? error.message : 'Face verification could not finish. Please try again later.',
      } });
    } finally { clearTimeout(timer); }
  };
}
module.exports = { createRegistrationFaceHandler };
