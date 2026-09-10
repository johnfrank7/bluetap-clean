// Migration status: active Vercel fallback; the equivalent Render route is registered in backend/routes.
const { createFaceVerificationHandler } = require('../../backend/verification/faceVerification');
module.exports = createFaceVerificationHandler();
module.exports.config = { maxDuration: 60 };
