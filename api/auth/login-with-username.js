// Migration status: active Vercel fallback; the equivalent Render route is registered in backend/routes.
const { createUsernameHandler } = require('../../backend/username/usernameHandler');
module.exports = createUsernameHandler('login');
