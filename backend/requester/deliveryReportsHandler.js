const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireRequester } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { pageSize, reportDetail, reportList } = require('../delivery/requesterDeliveryReportService');
const { submitInitialResponse } = require('../delivery/requesterDeliveryResponseService');

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'DELIVERY_RESPONSE_INVALID', 'The response payload is invalid.'); }
}

function queryOptions(req) {
  const params = new URL(req.url || '/api/requester/delivery-reports', 'http://localhost').searchParams;
  if ([...params.keys()].some((key) => !['attemptId', 'orderId', 'cursor', 'limit'].includes(key))
    || ['attemptId', 'orderId', 'cursor', 'limit'].some((key) => params.getAll(key).length > 1)) {
    throw new OtpError(400, 'DELIVERY_REPORT_QUERY_INVALID', 'The report query is invalid.');
  }
  const attemptId = params.get('attemptId') || '';
  const orderId = params.get('orderId') || '';
  const cursor = params.get('cursor') || '';
  if (attemptId && (cursor || params.has('limit'))) {
    throw new OtpError(400, 'DELIVERY_REPORT_QUERY_INVALID', 'The report query is invalid.');
  }
  if (params.has('attemptId') && !attemptId || params.has('orderId') && !orderId || params.has('cursor') && !cursor) {
    throw new OtpError(400, 'DELIVERY_REPORT_QUERY_INVALID', 'The report query is invalid.');
  }
  if (orderId && (orderId.length > 128 || orderId === '.' || orderId === '..' || orderId.includes('/'))) {
    throw new OtpError(400, 'DELIVERY_REPORT_ORDER_ID_INVALID', 'The order ID is invalid.');
  }
  return { attemptId, orderId, cursor, limit: attemptId ? null : pageSize(params.get('limit')) };
}

function createRequesterDeliveryReportsHandler(getAdmin = getFirebaseAdmin, now = () => new Date()) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or POST.' } });
    try {
      const { auth, db } = getAdmin();
      const { decoded } = await requireRequester(req, auth, db);
      if (req.method === 'POST') return res.status(200).json(await submitInitialResponse(db, decoded.uid, bodyOf(req), now));
      const { attemptId, orderId, cursor, limit } = queryOptions(req);
      const result = attemptId
        ? await reportDetail(db, attemptId, decoded.uid, orderId)
        : await reportList(db, { requesterUid: decoded.uid, orderId, cursor, limit });
      return res.status(200).json(result);
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 500).json({ error: {
        reason: known ? error.reason : 'service-unavailable',
        message: known ? error.message : 'Delivery reports are temporarily unavailable.',
      } });
    }
  };
}

module.exports = { createRequesterDeliveryReportsHandler };
