// Migration status: active Vercel fallback; the equivalent Render route is registered in backend/routes.
const { createRegistrationFaceHandler } = require('../../backend/verification/registrationFaceHandler');
module.exports = createRegistrationFaceHandler();
module.exports.config = { maxDuration: 60 };
