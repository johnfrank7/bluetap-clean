const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireActiveManager, requireActiveDistributor, requireAdmin } = require('../auth/authorization');
const { requireTripEmulator } = require('../utils/deliveryTripFoundation');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');

function createTripCapabilityHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET.' } });
    try {
      const { auth, db } = getAdmin();
      const token = /^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization || ''))?.[1];
      if (!token) throw new OtpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
      const decoded = await auth.verifyIdToken(token, true).catch(() => { throw new OtpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.'); });
      const profile = await db.collection('users').doc(decoded.uid).get();
      const role = profile.exists ? profile.data()?.role : '';
      if (role === 'manager') await requireActiveManager(req, auth, db);
      else if (role === 'distributor') await requireActiveDistributor(req, auth, db);
      else if (role === 'admin') await requireAdmin(req, auth, db);
      else throw new OtpError(403, 'TRIP_FORBIDDEN', 'Operational access is required.');
      if (process.env.BLUETAP_TRIP_EMULATOR_MODE !== '1') return res.status(200).json({ tripApprovalAvailable: false });
      requireTripEmulator(db, auth);
      return res.status(200).json({ tripApprovalAvailable: true, emulatorProjectId: db._settings.projectId });
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 503).json({ error: { reason: known ? error.reason : 'service-unavailable', message: known ? error.message : 'Trip availability could not be verified.' } });
    }
  };
}

module.exports = { createTripCapabilityHandler };
