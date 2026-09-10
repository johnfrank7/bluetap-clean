// Migration status: active Vercel fallback; the equivalent Render route is registered in backend/routes.
const { createRegistrationSessionHandler } = require('../../backend/registration/registrationSessionHandler');
module.exports = createRegistrationSessionHandler('terms');
