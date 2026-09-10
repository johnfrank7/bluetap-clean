const WEB_CAPTURE_STABILITY_MS = 1500;
const WEB_CAPTURE_MAX_DATA_URL_LENGTH = 1400000;

function getRegistrationFaceCaptureMode(platform) {
  return platform === 'web' ? 'browser' : 'native';
}

function isTrustedRegistrationFaceVerification(verification = {}) {
  return verification.status === 'verified' &&
    verification.duplicateCheck === 'clear' &&
    verification.livenessPassed === true;
}

function browserCameraSupported(navigatorValue) {
  return typeof navigatorValue?.mediaDevices?.getUserMedia === 'function';
}

function browserCameraErrorMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera access was denied. Allow camera access in your browser settings, then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'No compatible front camera was found. Connect or enable a camera, then try again.';
    case 'SecurityError':
      return 'Camera access requires a secure connection. Open BlueTap through HTTPS or localhost, then try again.';
    default:
      return 'The camera could not start. Check camera access and try again.';
  }
}

module.exports = {
  WEB_CAPTURE_MAX_DATA_URL_LENGTH,
  WEB_CAPTURE_STABILITY_MS,
  browserCameraErrorMessage,
  browserCameraSupported,
  getRegistrationFaceCaptureMode,
  isTrustedRegistrationFaceVerification,
};
