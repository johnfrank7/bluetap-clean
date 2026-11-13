const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmedDuplicateEmail, credentialFeedback, registrationSessionNotice } = require('../../../services/registrationFeedback');

test('registration limit notices distinguish network, device, and other errors', () => {
  assert.deepEqual(registrationSessionNotice({ code: 'registration/IP_ACCOUNT_LIMIT_REACHED', message: 'Network limit reached.' }), { title: 'Network registration limit reached', message: 'Network limit reached.' });
  assert.equal(registrationSessionNotice({ code: 'registration/DEVICE_ACCOUNT_LIMIT_REACHED', message: 'Device limit reached.' }).title, 'Device registration limit reached');
  assert.equal(registrationSessionNotice({ code: 'registration/network', message: 'Offline.' }).title, 'Could not start registration');
});

test('email feedback checks format without claiming address availability', () => {
  assert.deepEqual(credentialFeedback({}), { emailValid: false, emailInvalid: false, passwordValid: false, confirmationValid: false, confirmationMismatch: false });
  assert.equal(credentialFeedback({ email: 'person@' }).emailInvalid, true);
  assert.equal(credentialFeedback({ email: ' Person@example.test ' }).emailValid, true);
  assert.equal(Object.hasOwn(credentialFeedback({ email: 'person@example.test' }), 'available'), false);
});

test('duplicate-email feedback requires the backend duplicate reason and the unchanged submitted email', () => {
  assert.equal(confirmedDuplicateEmail('account-exists', ' Person@example.test ', 'person@example.test'), 'person@example.test');
  assert.equal(confirmedDuplicateEmail('network', 'person@example.test', 'person@example.test'), '');
  assert.equal(confirmedDuplicateEmail('account-exists', 'person@example.test', 'other@example.test'), '');
  assert.equal(confirmedDuplicateEmail('account-exists', '', ''), '');
});

test('password feedback follows backend length rules and exact matching without exposing values', () => {
  assert.equal(credentialFeedback({ password: '  short  ', confirmPassword: '  short  ' }).passwordValid, false);
  assert.equal(credentialFeedback({ password: 'x'.repeat(129), confirmPassword: 'x'.repeat(129) }).confirmationValid, false);
  const mismatch = credentialFeedback({ password: 'valid-password', confirmPassword: 'valid-passworD' });
  assert.equal(mismatch.passwordValid, true); assert.equal(mismatch.confirmationMismatch, true); assert.equal(mismatch.confirmationValid, false);
  const match = credentialFeedback({ password: 'valid-password', confirmPassword: 'valid-password' });
  assert.equal(match.confirmationMismatch, false); assert.equal(match.confirmationValid, true);
  assert.equal(JSON.stringify(match).includes('valid-password'), false);
});
