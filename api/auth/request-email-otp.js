// Migration status: active Vercel fallback; the equivalent Render route is registered in backend/routes.
const { createOtpHandler } = require('../../backend/auth/otpHandler');
module.exports = createOtpHandler('request');
