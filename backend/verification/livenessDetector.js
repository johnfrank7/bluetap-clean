const { OtpError } = require('../utils/otpError');

// Integration boundary, deliberately unavailable. A real implementation must
// evaluate ordered frames for one face, the randomized motion, continuity and
// replay/spoof resistance. Never replace this with client booleans or a timer.
module.exports = {
  available: false,
  async evaluate() {
    throw new OtpError(503, 'liveness-unavailable', 'The face challenge check is not available yet. Please try again later.');
  },
};
