const { createFaceVerificationHandler } = require('../../backend/verification/faceVerification');
module.exports = createFaceVerificationHandler();
module.exports.config = { maxDuration: 60 };
