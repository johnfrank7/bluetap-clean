const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { loadRegistrationSecurity } = require('../registration/registrationSecurity');
const { applyCors } = require('../utils/cors');
const { getWarmFaceService } = require('./faceServiceWarmup');

function createFaceServiceWarmupHandler({ getAdmin = getFirebaseAdmin, warmFaceService = getWarmFaceService } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use POST.' } });
    try {
      const security = await loadRegistrationSecurity(getAdmin().db);
      if (!security.faceVerificationEnabled) return res.status(200).json({ status: 'not_required' });
      // Python startup is intentionally detached from signup navigation.
      Promise.resolve().then(warmFaceService).catch(() => {});
      return res.status(202).json({ status: 'starting' });
    } catch {
      return res.status(202).json({ status: 'starting' });
    }
  };
}

module.exports = { createFaceServiceWarmupHandler };
