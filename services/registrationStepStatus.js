const REGISTRATION_STEP_NUMBERS = Object.freeze([1, 2, 3, 4, 5]);

const toStepSet = (steps) => new Set(
  Array.isArray(steps)
    ? steps.filter((step) => REGISTRATION_STEP_NUMBERS.includes(step))
    : []
);

function getRegistrationStepStates({
  currentStep,
  completedSteps = [],
  requiredSteps = REGISTRATION_STEP_NUMBERS,
  incompleteSteps = [],
} = {}) {
  const completed = toStepSet(completedSteps);
  const required = toStepSet(requiredSteps);
  const explicitlyIncomplete = toStepSet(incompleteSteps);

  return REGISTRATION_STEP_NUMBERS.map((step) => {
    if (step === currentStep) return 'current';
    if (completed.has(step)) return 'completed';
    if (required.has(step) && (step < currentStep || explicitlyIncomplete.has(step))) {
      return 'incomplete';
    }
    return 'future';
  });
}

function getRegistrationConnectorStates(stepStates = []) {
  return stepStates.slice(0, -1).map((_, index) => {
    const left = stepStates[index];
    const right = stepStates[index + 1];
    if (left === 'completed' && (right === 'completed' || right === 'current')) {
      return 'completed';
    }
    if (left === 'incomplete' || right === 'incomplete') return 'incomplete';
    return 'future';
  });
}

module.exports = {
  REGISTRATION_STEP_NUMBERS,
  getRegistrationConnectorStates,
  getRegistrationStepStates,
};
