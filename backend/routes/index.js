const { createOtpHandler } = require('../auth/otpHandler');
const { createRegistrationHandler } = require('../registration/registrationHandler');
const { createRegistrationSessionHandler } = require('../registration/registrationSessionHandler');
const { createUsernameHandler } = require('../username/usernameHandler');
const { createFaceVerificationHandler } = require('../verification/faceVerification');
const { createRegistrationFaceHandler } = require('../verification/registrationFaceHandler');

const routes = new Map([
  ['/api/auth/check-username', createUsernameHandler('check')],
  ['/api/auth/login-with-username', createUsernameHandler('login')],
  ['/api/auth/create-registration-session', createRegistrationSessionHandler('create')],
  ['/api/auth/registration-session-status', createRegistrationSessionHandler('status')],
  ['/api/auth/start-registration-face-verification', createRegistrationSessionHandler('start')],
  ['/api/auth/accept-registration-terms', createRegistrationSessionHandler('terms')],
  ['/api/auth/request-email-otp', createOtpHandler('request')],
  ['/api/auth/verify-email-otp', createOtpHandler('verify')],
  ['/api/auth/request-registration-otp', createRegistrationHandler('request')],
  ['/api/auth/complete-registration', createRegistrationHandler('complete')],
  ['/api/verification/verify-face', createFaceVerificationHandler()],
  ['/api/verification/registration-face', createRegistrationFaceHandler()],
]);

module.exports = { routes };
