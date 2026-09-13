// Server-only: imported by HTTP OTP handlers, never by Expo screens.
const nodemailer = require('nodemailer');
const { OtpError } = require('../utils/otpError');

const logStage = (stage, details = {}) => console.info('[email-otp]', JSON.stringify({ stage, ...details }));

async function sendEmailOtp({ recipient, code }) {
  try {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      throw new OtpError(503, 'EMAIL_TRANSPORT_NOT_CONFIGURED', 'Email delivery is not configured. Please contact support.');
    }
    const gmailUser = process.env.GMAIL_USER.trim();
    // Google displays App Passwords in groups. Ignore copied whitespace
    // without changing any other credential characters.
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD.replace(/\s/g, '');
    if (!gmailUser || !gmailAppPassword) {
      throw new OtpError(503, 'EMAIL_TRANSPORT_NOT_CONFIGURED', 'Email delivery is not configured. Please contact support.');
    }
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: gmailUser,
        pass: gmailAppPassword,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    logStage('EMAIL_TRANSPORT_READY');
    const result = await transport.sendMail({
      from: `BlueTap <${gmailUser}>`,
      to: recipient,
      subject: 'BlueTap Email Verification Code',
      text: `BlueTap\nWater Within Reach\n\nVerify your email\n\nYour BlueTap verification code is:\n\n${code}\n\nThis code expires in 10 minutes.\n\nIf you did not request this code, you can safely ignore this email.`,
    });
    if (!result?.accepted?.length || result.rejected?.length) {
      throw Object.assign(new Error(), { code: 'RECIPIENT_REJECTED' });
    }
    logStage('EMAIL_SEND_SUCCEEDED');
  } catch (error) {
    const responseCode = Number.isInteger(error?.responseCode) && error.responseCode >= 400 && error.responseCode <= 599
      ? error.responseCode : undefined;
    const authenticationFailure = error?.code === 'EAUTH' || [534, 535].includes(responseCode);
    const reason = error instanceof OtpError
      ? error.reason
      : authenticationFailure
        ? 'EMAIL_TRANSPORT_AUTH_FAILED'
        : 'EMAIL_SEND_FAILED';
    // SMTP messages can contain addresses or credentials. Emit only the safe
    // failure category and numeric SMTP status.
    console.error('[email-otp]', JSON.stringify({
      stage: 'EMAIL_SEND_FAILED',
      reason,
      ...(responseCode ? { responseCode } : {}),
    }));
    if (error instanceof OtpError) throw error;
    if (authenticationFailure) {
      throw new OtpError(503, reason, 'Email delivery authentication failed. Please contact support.');
    }
    throw new OtpError(503, reason, 'Unable to send verification email. Please try again.');
  }
}
module.exports = { sendEmailOtp };
