// Migration status: active Vercel fallback; the equivalent Render route is registered in backend/routes.
const { createRegistrationHandler } = require('../../backend/registration/registrationHandler');
module.exports = createRegistrationHandler('request');
