const { createHash, timingSafeEqual } = require('node:crypto');
const nodemailer = require('nodemailer');

const EXPECTED_SUBJECT = 'BlueTap Email Verification Code';
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const responseError = (res, status, reason, message) =>
  res.status(status).json({ error: { reason, message } });

const secretsMatch = (received, expected) => {
  if (!received || !expected) return false;
  const left = createHash('sha256').update(received).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
};

const parseBearer = (header) => {
  const match = /^Bearer ([^\s]+)$/i.exec(String(header || ''));
  return match?.[1] || '';
};

const validateMessage = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const allowed = new Set(['to', 'subject', 'text', 'html', 'requestId']);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject : '';
  const text = typeof body.text === 'string' ? body.text : '';
  const html = typeof body.html === 'string' ? body.html : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  if (!EMAIL_PATTERN.test(to) || to.length > 254 || subject !== EXPECTED_SUBJECT ||
      !text || text.length > 3000 || !html || html.length > 6000 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return null;
  return { to, subject, text, html };
};

function createInternalMailRelayHandler({
  env = process.env,
  createTransport = nodemailer.createTransport,
  logger = console,
} = {}) {
  return async function internalMailRelay(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return responseError(res, 405, 'METHOD_NOT_ALLOWED', 'Use POST.');
    }

    const expectedSecret = String(env.INTERNAL_MAIL_RELAY_SECRET || '');
    if (!expectedSecret) {
      logger.error('[internal-mail-relay]', JSON.stringify({ stage: 'RELAY_FAILED', reason: 'EMAIL_TRANSPORT_NOT_CONFIGURED' }));
      return responseError(res, 503, 'EMAIL_TRANSPORT_NOT_CONFIGURED', 'Email delivery is not configured.');
    }
    const receivedSecret = parseBearer(req.headers?.authorization);
    if (!receivedSecret) return responseError(res, 401, 'UNAUTHENTICATED', 'Authentication required.');
    if (!secretsMatch(receivedSecret, expectedSecret)) return responseError(res, 403, 'INVALID_RELAY_SECRET', 'Authentication failed.');

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    const message = validateMessage(body);
    if (!message) return responseError(res, 400, 'INVALID_EMAIL_PAYLOAD', 'Invalid email request.');

    const gmailUser = String(env.GMAIL_USER || '').trim();
    const gmailAppPassword = String(env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
    if (!gmailUser || !gmailAppPassword) {
      logger.error('[internal-mail-relay]', JSON.stringify({ stage: 'RELAY_FAILED', reason: 'EMAIL_TRANSPORT_NOT_CONFIGURED' }));
      return responseError(res, 503, 'EMAIL_TRANSPORT_NOT_CONFIGURED', 'Email delivery is not configured.');
    }

    try {
      const transport = createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: gmailUser, pass: gmailAppPassword },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const result = await transport.sendMail({
        from: `BlueTap <${gmailUser}>`,
        ...message,
      });
      if (!result?.accepted?.length || result.rejected?.length) throw Object.assign(new Error(), { code: 'RECIPIENT_REJECTED' });
      logger.info('[internal-mail-relay]', JSON.stringify({ stage: 'EMAIL_SEND_SUCCEEDED' }));
      return res.status(200).json({ success: true });
    } catch (error) {
      const responseCode = Number.isInteger(error?.responseCode) ? error.responseCode : undefined;
      const authenticationFailure = error?.code === 'EAUTH' || [534, 535].includes(responseCode);
      const reason = authenticationFailure ? 'EMAIL_TRANSPORT_AUTH_FAILED' : 'EMAIL_SEND_FAILED';
      logger.error('[internal-mail-relay]', JSON.stringify({
        stage: 'RELAY_FAILED',
        reason,
        ...(responseCode ? { smtpStatus: responseCode } : {}),
      }));
      return responseError(
        res,
        503,
        reason,
        authenticationFailure ? 'Email delivery authentication failed.' : 'Unable to send verification email.',
      );
    }
  };
}

module.exports = { EXPECTED_SUBJECT, createInternalMailRelayHandler, secretsMatch, validateMessage };
