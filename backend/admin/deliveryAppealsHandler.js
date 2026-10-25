const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const {
  getAdminAppealDetail,
  listAdminAppeals,
  resolveAdminAppeal,
} = require('../delivery/adminDeliveryAppealService');

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'DELIVERY_APPEAL_INVALID', 'The appeal decision payload is invalid.'); }
}

function queryOptions(req) {
  const params = new URL(req.url || '/api/admin/delivery-appeals', 'http://localhost').searchParams;
  const attemptId = params.get('attemptId') || '';
  const status = params.get('status') || 'pending';
  const cursor = params.get('cursor') || '';
  const limit = params.get('limit') ? Number(params.get('limit')) : 20;

  return { attemptId, status, cursor, limit };
}

function createAdminDeliveryAppealsHandler(getAdmin = getFirebaseAdmin, now = () => new Date()) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST'].includes(req.method)) {
      return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or POST.' } });
    }
    try {
      const { auth, db } = getAdmin();
      const admin = await requireAdmin(req, auth, db);
      if (req.method === 'POST') {
        const result = await resolveAdminAppeal(db, admin, bodyOf(req), now);
        return res.status(200).json(result);
      }
      const { attemptId, status, cursor, limit } = queryOptions(req);
      if (attemptId) {
        const result = await getAdminAppealDetail(db, admin, attemptId);
        return res.status(200).json(result);
      }
      const result = await listAdminAppeals(db, admin, { status, limit, cursor });
      return res.status(200).json(result);
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 500).json({
        error: {
          reason: known ? error.reason : 'service-unavailable',
          message: known ? error.message : 'Admin delivery appeals are temporarily unavailable.',
        },
      });
    }
  };
}

module.exports = { createAdminDeliveryAppealsHandler };
