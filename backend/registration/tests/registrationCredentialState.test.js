const test = require('node:test');
const assert = require('node:assert/strict');
const { getRegistrationCredentialState } = require('../../../services/registrationCredentialState');

test('registration passwords show success only when policy passes and values match exactly', () => {
  assert.deepEqual(getRegistrationCredentialState('short', 'short'), {
    passwordPolicyPassed: false, passwordsMatch: true, mismatch: false, success: false,
  });
  assert.deepEqual(getRegistrationCredentialState('password-1', 'password-2'), {
    passwordPolicyPassed: true, passwordsMatch: false, mismatch: true, success: false,
  });
  assert.deepEqual(getRegistrationCredentialState('password-1', 'password-1'), {
    passwordPolicyPassed: true, passwordsMatch: true, mismatch: false, success: true,
  });
});
