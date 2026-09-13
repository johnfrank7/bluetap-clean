// Transport-only Vercel function. OTP/session/account state remains on Render.
const { createInternalMailRelayHandler } = require('../../backend/email/vercelMailRelay');

module.exports = createInternalMailRelayHandler();
