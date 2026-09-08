const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails';

const getProviderError = (responseBody) =>
  responseBody?.message || responseBody?.name || 'Email provider request failed.';

/**
 * Server-only email provider adapter. API keys are supplied by the callable
 * function through Firebase secrets and are never available to the client.
 */
const sendEmailOtp = async ({ apiKey, fromAddress, recipient, code }) => {
  if (!apiKey || !fromAddress) {
    const error = new Error('Email provider is not configured.');
    error.code = 'provider-not-configured';
    throw error;
  }

  const response = await fetch(RESEND_EMAILS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [recipient],
      subject: 'Your BlueTap verification code',
      text: `Your BlueTap verification code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`,
      html: `<p>Your BlueTap verification code is</p><p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">${code}</p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`,
    }),
  });

  if (!response.ok) {
    let responseBody = null;

    try {
      responseBody = await response.json();
    } catch (error) {
      // The provider can return a non-JSON error body. Keep it server-side.
    }

    const providerError = new Error(getProviderError(responseBody));
    providerError.code = 'provider-request-failed';
    throw providerError;
  }
};

module.exports = { sendEmailOtp };
