const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireActiveManager } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');

function createManagerContextHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET.' } });
    try {
      const { auth, db } = getAdmin();
      const { decoded, branch } = await requireActiveManager(req, auth, db);
      return res.status(200).json({
        manager: { uid: decoded.uid, role: 'manager', managerStatus: 'active', branchId: branch.id },
        branch: { id: branch.id, name: branch.name || '', code: branch.code || '', status: 'active', barangay: branch.barangay || '', city: branch.city || '' },
      });
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 500).json({ error: {
        reason: known ? error.reason : 'service-unavailable',
        message: known ? error.message : 'Manager access is temporarily unavailable.',
      } });
    }
  };
}

module.exports = { createManagerContextHandler };
