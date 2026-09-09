const { createRegistrationFaceHandler } = require('../../server/registrationFaceHandler');
module.exports = createRegistrationFaceHandler();
module.exports.config = { maxDuration: 60 };
