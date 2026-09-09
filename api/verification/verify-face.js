const { createFaceVerificationHandler } = require('../../server/faceVerification');
module.exports = createFaceVerificationHandler();
module.exports.config = { maxDuration: 60 };
