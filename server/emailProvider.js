const { OtpError } = require('./otpError');

async function sendEmailOtp({ recipient, code, requestId }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_ADDRESS;
  if (!apiKey || !from) throw new OtpError(503, 'provider-unavailable', 'Verification email could not be sent. Please try again.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': requestId,
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: 'BlueTap Email Verification Code',
      text: `BlueTap\nWater Within Reach\n\nVerify your email\n\nYour BlueTap verification code is:\n\n${code}\n\nThis code expires in 10 minutes.\n\nIf you did not request this code, you can safely ignore this email.`,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.id) {
    // Do not return/log the provider's raw response (it can contain recipient data).
    if (response.status === 403 && /only send testing emails|own email address/i.test(data?.message || '')) {
      throw new OtpError(403, 'provider-test-recipient', 'Email delivery is in test mode and can only send to the Resend account owner. Please contact BlueTap support.');
    }
    throw new OtpError(503, 'provider-unavailable', 'Verification email could not be sent. Please try again.');
  }
}
module.exports = { sendEmailOtp };
