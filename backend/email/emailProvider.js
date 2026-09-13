// Server-only provider boundary. Imported by backend HTTP handlers only.
const { OtpError } = require('../utils/otpError');

const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails';
const USER_AGENT = 'BlueTap-Backend/1.0';

const providerError = (reason, message, details = {}) =>
  new OtpError(503, reason, message, details);

const notConfigured = () => providerError(
  'EMAIL_TRANSPORT_NOT_CONFIGURED',
  'Email delivery is not configured. Please contact support.',
);

const safeRetryAfter = (response) => {
  const value = Number.parseInt(response?.headers?.get?.('retry-after') || '', 10);
  return Number.isInteger(value) && value > 0 && value <= 3600
    ? { retryAfterSeconds: value }
    : {};
};

const readSafeProviderType = async (response) => {
  try {
    const body = await response.json();
    const value = body?.name || body?.type;
    return typeof value === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value) ? value : '';
  } catch {
    return '';
  }
};

const mapResendFailure = async (response) => {
  const status = Number(response?.status) || 0;
  const type = await readSafeProviderType(response);
  const authenticationTypes = new Set(['missing_api_key', 'invalid_api_key', 'restricted_api_key']);
  const senderTypes = new Set(['invalid_from_address']);

  if (status === 401 || authenticationTypes.has(type) || (status === 403 && type === 'invalid_api_key')) {
    return providerError(
      'EMAIL_TRANSPORT_AUTH_FAILED',
      'Email delivery authentication failed. Please contact support.',
    );
  }
  if (senderTypes.has(type) || (status === 403 && type === 'validation_error')) {
    return providerError(
      'EMAIL_SENDER_NOT_VERIFIED',
      'The verification email sender is not configured correctly. Please contact support.',
    );
  }
  if (status === 429 || ['rate_limit_exceeded', 'daily_quota_exceeded', 'monthly_quota_exceeded'].includes(type)) {
    return providerError(
      'EMAIL_SEND_RATE_LIMITED',
      'Verification email delivery is busy. Please try again shortly.',
      safeRetryAfter(response),
    );
  }
  return providerError(
    'EMAIL_SEND_FAILED',
    'Unable to send verification email. Please try again.',
  );
};

const relayUrl = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/api/internal/send-otp-email') return '';
    return url.toString();
  } catch {
    return '';
  }
};

const readSafeRelayReason = async (response) => {
  try {
    const body = await response.json();
    const reason = body?.error?.reason;
    return typeof reason === 'string' && /^[A-Z0-9_]{1,64}$/.test(reason) ? reason : '';
  } catch {
    return '';
  }
};

function createEmailProvider({ env = process.env, fetchImpl = globalThis.fetch, logger = console } = {}) {
  async function sendEmail({ to, subject, text, html, requestId }) {
    const provider = String(env.EMAIL_PROVIDER || '').trim().toLowerCase();
    if (!provider || typeof fetchImpl !== 'function') {
      const error = notConfigured();
      logger.error('[email-otp]', JSON.stringify({ stage: 'EMAIL_SEND_FAILED', reason: error.reason }));
      throw error;
    }

    let url;
    let headers;
    let body;
    if (provider === 'vercel-relay') {
      url = relayUrl(env.VERCEL_MAIL_RELAY_URL);
      const secret = String(env.INTERNAL_MAIL_RELAY_SECRET || '');
      if (!url || !secret || !requestId) {
        const error = notConfigured();
        logger.error('[email-otp]', JSON.stringify({ stage: 'EMAIL_SEND_FAILED', reason: error.reason }));
        throw error;
      }
      headers = {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      };
      body = JSON.stringify({ to, subject, text, html, requestId });
    } else if (provider === 'resend') {
      const apiKey = String(env.RESEND_API_KEY || '').trim();
      const fromAddress = String(env.EMAIL_FROM_ADDRESS || '').trim();
      if (!apiKey || !fromAddress) {
        const error = notConfigured();
        logger.error('[email-otp]', JSON.stringify({ stage: 'EMAIL_SEND_FAILED', reason: error.reason }));
        throw error;
      }
      url = RESEND_EMAILS_ENDPOINT;
      headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        ...(requestId ? { 'Idempotency-Key': `bluetap-otp/${requestId}` } : {}),
      };
      body = JSON.stringify({ from: fromAddress, to: [to], subject, text, html });
    } else {
      const error = notConfigured();
      logger.error('[email-otp]', JSON.stringify({ stage: 'EMAIL_SEND_FAILED', reason: error.reason }));
      throw error;
    }

    logger.info('[email-otp]', JSON.stringify({ stage: 'EMAIL_TRANSPORT_READY', provider }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
    } catch {
      const error = providerError(
        'EMAIL_SEND_FAILED',
        'Unable to send verification email. Please try again.',
      );
      logger.error('[email-otp]', JSON.stringify({ stage: 'EMAIL_SEND_FAILED', reason: error.reason }));
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      let error;
      if (provider === 'resend') {
        error = await mapResendFailure(response);
      } else {
        const relayReason = await readSafeRelayReason(response);
        error = [401, 403].includes(response.status) || relayReason === 'EMAIL_TRANSPORT_AUTH_FAILED'
          ? providerError('EMAIL_TRANSPORT_AUTH_FAILED', 'Email delivery authentication failed. Please contact support.')
          : relayReason === 'EMAIL_TRANSPORT_NOT_CONFIGURED'
            ? notConfigured()
            : providerError('EMAIL_SEND_FAILED', 'Unable to send verification email. Please try again.');
      }
      logger.error('[email-otp]', JSON.stringify({
        stage: 'EMAIL_SEND_FAILED',
        reason: error.reason,
        providerStatus: Number(response.status) || 0,
      }));
      throw error;
    }
    if (provider === 'vercel-relay') {
      let result;
      try { result = await response.json(); } catch { result = null; }
      if (result?.success !== true) {
        const error = providerError('EMAIL_SEND_FAILED', 'Unable to send verification email. Please try again.');
        logger.error('[email-otp]', JSON.stringify({ stage: 'EMAIL_SEND_FAILED', reason: error.reason, providerStatus: response.status }));
        throw error;
      }
    }
    logger.info('[email-otp]', JSON.stringify({ stage: 'EMAIL_SEND_SUCCEEDED', provider }));
  }

  async function sendEmailOtp({ recipient, code, requestId }) {
    const subject = 'BlueTap Email Verification Code';
    const text = `BlueTap\nWater Within Reach\n\nVerify your email\n\nYour BlueTap verification code is:\n\n${code}\n\nThis code expires in 10 minutes. Do not share this code with anyone.\n\nIf you did not request this code, you can safely ignore this email.`;
    const html = `<!doctype html><html><body><h1>BlueTap</h1><p>Water Within Reach</p><h2>Verify your email</h2><p>Your BlueTap verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. Do not share this code with anyone.</p><p>If you did not request this code, you can safely ignore this email.</p></body></html>`;
    return sendEmail({ to: recipient, subject, text, html, requestId });
  }

  return { sendEmail, sendEmailOtp };
}

const defaultProvider = createEmailProvider();

module.exports = {
  RESEND_EMAILS_ENDPOINT,
  createEmailProvider,
  sendEmail: defaultProvider.sendEmail,
  sendEmailOtp: defaultProvider.sendEmailOtp,
};
