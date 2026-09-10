// Server-only: imported by HTTP OTP handlers, never by Expo screens.
const nodemailer = require('nodemailer');
const { OtpError } = require('../utils/otpError');

async function sendEmailOtp({ recipient, code }) {
  try {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      throw Object.assign(new Error(), { code: 'MISSING_CONFIG' });
    }
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const result = await transport.sendMail({
      from: `BlueTap <${process.env.GMAIL_USER}>`,
      to: recipient,
      subject: 'BlueTap Email Verification Code',
      text: `BlueTap\nWater Within Reach\n\nVerify your email\n\nYour BlueTap verification code is:\n\n${code}\n\nThis code expires in 10 minutes.\n\nIf you did not request this code, you can safely ignore this email.`,
    });
    if (!result?.accepted?.length || result.rejected?.length) {
      throw Object.assign(new Error(), { code: 'RECIPIENT_REJECTED' });
    }
  } catch (error) {
    // Never log raw SMTP errors: they can contain credentials or addresses.
    const categories = ['MISSING_CONFIG', 'RECIPIENT_REJECTED', 'EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'EENVELOPE', 'EMESSAGE'];
    console.error('OTP Gmail SMTP delivery failed', {
      code: categories.includes(error?.code) ? error.code : 'SMTP_ERROR',
      responseCode: Number.isInteger(error?.responseCode) && error.responseCode >= 400 && error.responseCode <= 599
        ? error.responseCode : undefined,
    });
    throw new OtpError(503, 'provider-unavailable', 'Unable to send verification email. Please try again.');
  }
}
module.exports = { sendEmailOtp };
