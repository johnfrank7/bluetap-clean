const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireActiveDistributor } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { pageSize, reviewDetail, reviewList } = require('../delivery/distributorDeliveryReviewService');

function queryOptions(req) {
  const params = new URL(req.url || '/api/distributor/delivery-reviews', 'http://localhost').searchParams;
  if ([...params.keys()].some((key) => !['attemptId', 'cursor', 'limit'].includes(key))
    || ['attemptId', 'cursor', 'limit'].some((key) => params.getAll(key).length > 1)) {
    throw new OtpError(400, 'DELIVERY_REVIEW_QUERY_INVALID', 'The review query is invalid.');
  }
  const attemptId = params.get('attemptId') || '';
  const cursor = params.get('cursor') || '';
  if (attemptId && (cursor || params.has('limit'))
    || params.has('attemptId') && !attemptId || params.has('cursor') && !cursor) {
    throw new OtpError(400, 'DELIVERY_REVIEW_QUERY_INVALID', 'The review query is invalid.');
  }
  return { attemptId, cursor, limit: attemptId ? null : pageSize(params.get('limit')) };
}

function createDistributorDeliveryReviewsHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: {
      reason: 'method-not-allowed', message: 'Use GET.',
    } });
    try {
      const { auth, db } = getAdmin();
      const distributor = await requireActiveDistributor(req, auth, db);
      const { attemptId, cursor, limit } = queryOptions(req);
      const result = attemptId
        ? await reviewDetail(db, attemptId, distributor.decoded.uid)
        : await reviewList(db, { distributorUid: distributor.decoded.uid, cursor, limit });
      return res.status(200).json(result);
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 500).json({ error: {
        reason: known ? error.reason : 'service-unavailable',
        message: known ? error.message : 'Delivery reviews are temporarily unavailable.',
      } });
    }
  };
}

module.exports = { createDistributorDeliveryReviewsHandler };
