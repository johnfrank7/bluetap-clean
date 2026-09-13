const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getRegistrationConnectorStates,
  getRegistrationStepStates,
} = require('../../../services/registrationStepStatus');

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
