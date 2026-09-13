// Migration status: active Vercel fallback; the equivalent Render route is registered in backend/routes.
const { createRegistrationSessionHandler } = require('../../backend/registration/registrationSessionHandler');
const { createAdminRegistrationSecurityHandler } = require('../../backend/admin/registrationSecurityHandler');

const registrationStatus = createRegistrationSessionHandler('status');
const adminRegistrationSecurity = createAdminRegistrationSecurityHandler();

// Vercel Hobby deployments have a bounded function count. The public Admin
// path is rewritten here so it can share one function bundle with registration
// status without weakening either handler's independent authentication rules.
module.exports = (req, res) => req.query?.bluetapHandler === 'admin-registration-security'
  ? adminRegistrationSecurity(req, res)
  : registrationStatus(req, res);
