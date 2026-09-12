const test = require('node:test');
const assert = require('node:assert/strict');
const {
  browserCameraErrorMessage,
  browserCameraSupported,
  getRegistrationFaceCaptureMode,
  isTrustedRegistrationFaceVerification,
} = require('../../../services/webFaceCaptureCore');

test('web uses the browser camera flow while Android and iOS retain the native flow', () => {
  assert.equal(getRegistrationFaceCaptureMode('web'), 'browser');
  assert.equal(getRegistrationFaceCaptureMode('android'), 'native');
  assert.equal(getRegistrationFaceCaptureMode('ios'), 'native');
});

test('Step 3 is enabled only by the complete trusted verification state', () => {
  assert.equal(isTrustedRegistrationFaceVerification({ status: 'passed_pending_finalization', duplicateCheck: 'clear', livenessPassed: true }), true);
  assert.equal(isTrustedRegistrationFaceVerification({ status: 'passed_pending_finalization', duplicateCheck: 'unknown', livenessPassed: true }), false);
  assert.equal(isTrustedRegistrationFaceVerification({ status: 'passed_pending_finalization', duplicateCheck: 'clear', livenessPassed: false }), false);
  assert.equal(isTrustedRegistrationFaceVerification({ status: 'unverified', duplicateCheck: 'clear', livenessPassed: true }), false);
});

test('browser camera support and permission failures are explicit', () => {
  assert.equal(browserCameraSupported({ mediaDevices: { getUserMedia: () => {} } }), true);
  assert.equal(browserCameraSupported({}), false);
  assert.match(browserCameraErrorMessage({ name: 'NotAllowedError' }), /denied/i);
  assert.match(browserCameraErrorMessage({ name: 'NotFoundError' }), /camera/i);
  assert.match(browserCameraErrorMessage({ name: 'SecurityError' }), /secure/i);
});
