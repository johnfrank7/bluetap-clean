const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireActiveManager } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { pageSize, reviewDetail, reviewList } = require('../delivery/managerDeliveryReviewService');

function queryOptions(req) {
  const params = new URL(req.url || '/api/manager/delivery-reviews', 'http://localhost').searchParams;
  if ([...params.keys()].some((key) => !['attemptId', 'state', 'limit', 'cursor'].includes(key))
    || ['attemptId', 'state', 'limit', 'cursor'].some((key) => params.getAll(key).length > 1)) {
    throw new OtpError(400, 'DELIVERY_REVIEW_QUERY_INVALID', 'The review query is invalid.');
  }
  if (params.has('attemptId')) {
    if (!params.get('attemptId') || params.has('state') || params.has('limit') || params.has('cursor')) {
      throw new OtpError(400, 'DELIVERY_REVIEW_QUERY_INVALID', 'The review query is invalid.');
    }
    return { attemptId: params.get('attemptId') };
  }
  if (params.has('cursor') && !params.get('cursor')) {
    throw new OtpError(400, 'DELIVERY_REVIEW_QUERY_INVALID', 'The review query is invalid.');
  }
  if (params.has('state') && params.get('state') !== 'reported') {
    throw new OtpError(400, 'DELIVERY_REVIEW_STATE_INVALID', 'Only reported reviews can be listed.');
  }
  return { limit: pageSize(params.get('limit')), cursor: params.get('cursor') || '' };
}

function createManagerDeliveryReviewsHandler(getAdmin = getFirebaseAdmin, now = () => new Date()) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET.' } });
    try {
      const { auth, db } = getAdmin();
      const manager = await requireActiveManager(req, auth, db);
      const options = queryOptions(req);
      const result = options.attemptId
        ? await reviewDetail(db, options.attemptId, manager, now())
        : await reviewList(db, { manager, ...options });
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

module.exports = { createManagerDeliveryReviewsHandler, queryOptions };
