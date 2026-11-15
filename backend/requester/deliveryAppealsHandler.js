const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireRequester } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { submitRequesterAppeal, getRequesterAppeal } = require('../delivery/requesterDeliveryAppealService');

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'DELIVERY_APPEAL_INVALID', 'The appeal payload is invalid.'); }
}

function queryOptions(req) {
  const params = new URL(req.url || '/api/requester/delivery-appeals', 'http://localhost').searchParams;
  const attemptId = params.get('attemptId') || '';
  if (!attemptId) {
    throw new OtpError(400, 'DELIVERY_APPEAL_QUERY_INVALID', 'The appeal query is invalid.');
  }
  return { attemptId };
}

function createRequesterDeliveryAppealsHandler(getAdmin = getFirebaseAdmin, now = () => new Date()) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST'].includes(req.method)) {
      return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or POST.' } });
    }
    try {
      const { auth, db } = getAdmin();
      const { decoded } = await requireRequester(req, auth, db);
      if (req.method === 'POST') {
        const result = await submitRequesterAppeal(db, decoded, bodyOf(req), now);
        return res.status(200).json(result);
      }
      const { attemptId } = queryOptions(req);
      const result = await getRequesterAppeal(db, decoded.uid, attemptId);
      return res.status(200).json(result);
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 500).json({
        error: {
          reason: known ? error.reason : 'service-unavailable',
          message: known ? error.message : 'Delivery appeal is temporarily unavailable.',
        },
      });
    }
  };
}

module.exports = { createRequesterDeliveryAppealsHandler };
