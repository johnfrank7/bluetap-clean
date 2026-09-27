const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REGISTRATION_STEP: STEP,
  buildRegistrationSteps,
  adjacentRegistrationStep,
  registrationEntryStep,
  unavailableRegistrationRoute,
  getRegistrationConnectorStates,
  getRegistrationStepStates,
} = require('../../../services/registrationStepStatus');

test('all four security policies derive only their required registration steps', () => {
  const cases = [
    [{ faceVerificationRequired: false, emailOtpRequired: true }, [1, 2, 4, 5]],
    [{ faceVerificationRequired: true, emailOtpRequired: true }, [1, 2, 3, 4, 5]],
    [{ faceVerificationRequired: true, emailOtpRequired: false }, [1, 2, 3, 4]],
    [{ faceVerificationRequired: false, emailOtpRequired: false }, [1, 2, 4]],
  ];
  for (const [policy, expected] of cases) {
    const steps = buildRegistrationSteps(policy);
    assert.deepEqual(steps, expected);
    assert.equal(adjacentRegistrationStep(steps, STEP.personal, 1), policy.faceVerificationRequired ? STEP.identity : STEP.credentials);
    assert.equal(adjacentRegistrationStep(steps, STEP.credentials, -1), policy.faceVerificationRequired ? STEP.identity : STEP.personal);
    assert.equal(adjacentRegistrationStep(steps, STEP.credentials, 1), policy.emailOtpRequired ? STEP.verifyEmail : null);
  }
});

test('unresolved policy exposes no optional steps or navigation', () => {
  assert.deepEqual(buildRegistrationSteps(null), []);
  assert.deepEqual(buildRegistrationSteps({ faceVerificationRequired: true }), []);
  assert.equal(registrationEntryStep(buildRegistrationSteps(null), STEP.identity), null);
  assert.equal(unavailableRegistrationRoute(null, STEP.identity, true), null);
});

test('disabled steps are skipped on direct entry and route refresh', () => {
  const otpOnly = { faceVerificationRequired: false, emailOtpRequired: true };
  const faceOnly = { faceVerificationRequired: true, emailOtpRequired: false };
  assert.equal(registrationEntryStep(buildRegistrationSteps(otpOnly), STEP.identity), STEP.credentials);
  assert.equal(unavailableRegistrationRoute(otpOnly, STEP.identity, true), '/email-verification?registration=true');
  assert.equal(unavailableRegistrationRoute(otpOnly, STEP.identity, false), '/signup');
  assert.equal(unavailableRegistrationRoute(faceOnly, STEP.verifyEmail, true), '/signup?resumeRegistration=true');
  assert.deepEqual(buildRegistrationSteps({ ...otpOnly }), buildRegistrationSteps(otpOnly));
});

test('stepper distinguishes completed, current, missing prior, and future steps', () => {
  const states = getRegistrationStepStates({ currentStep: 4, completedSteps: [1, 3] });

  assert.deepEqual(states, ['completed', 'incomplete', 'completed', 'current', 'future']);
  assert.deepEqual(
    getRegistrationConnectorStates(states),
    ['incomplete', 'incomplete', 'completed', 'future']
  );
});

test('ordinary future steps remain neutral', () => {
  assert.deepEqual(
    getRegistrationStepStates({ currentStep: 3, completedSteps: [1, 2] }),
    ['completed', 'completed', 'current', 'future', 'future']
  );
});

test('compact steppers create connectors only between visible steps', () => {
  assert.deepEqual(
    getRegistrationConnectorStates(['completed', 'current', 'future', 'future']),
    ['completed', 'future', 'future']
  );
});

test('policy-disabled face and OTP steps are never marked incomplete', () => {
  assert.deepEqual(
    getRegistrationStepStates({
      currentStep: 5,
      completedSteps: [1, 2, 4],
      requiredSteps: [1, 2, 4],
    }),
    ['completed', 'completed', 'future', 'completed', 'current']
  );
});

test('explicit incomplete state marks only required steps red', () => {
  assert.deepEqual(
    getRegistrationStepStates({
      currentStep: 2,
      completedSteps: [1],
      requiredSteps: [1, 2, 4, 5],
      incompleteSteps: [3, 4],
    }),
    ['completed', 'current', 'future', 'incomplete', 'future']
  );
});
