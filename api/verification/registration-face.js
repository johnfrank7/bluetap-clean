const { createRegistrationFaceHandler } = require('../../backend/verification/registrationFaceHandler');
module.exports = createRegistrationFaceHandler();
module.exports.config = { maxDuration: 60 };
