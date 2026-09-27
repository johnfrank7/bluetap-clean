const REGISTRATION_STEP = Object.freeze({ account: 1, personal: 2, identity: 3, credentials: 4, verifyEmail: 5 });
const REGISTRATION_STEP_NUMBERS = Object.freeze(Object.values(REGISTRATION_STEP));
const REGISTRATION_STEP_LABELS = Object.freeze({ 1: 'Account', 2: 'Personal', 3: 'Identity', 4: 'Credentials', 5: 'Verify' });

function buildRegistrationSteps(policy) {
  if (typeof policy?.faceVerificationRequired !== 'boolean' || typeof policy?.emailOtpRequired !== 'boolean') return [];
  return [REGISTRATION_STEP.account, REGISTRATION_STEP.personal,
    ...(policy.faceVerificationRequired ? [REGISTRATION_STEP.identity] : []),
    REGISTRATION_STEP.credentials,
    ...(policy.emailOtpRequired ? [REGISTRATION_STEP.verifyEmail] : [])];
}

function adjacentRegistrationStep(steps, currentStep, direction) {
  const index = steps.indexOf(currentStep);
  return index < 0 ? null : steps[index + direction] ?? null;
}

function registrationEntryStep(steps, requestedStep) {
  if (!steps.length) return null;
  if (steps.includes(requestedStep)) return requestedStep;
  return steps.find((step) => step > requestedStep) ?? steps[steps.length - 1];
}

function unavailableRegistrationRoute(policy, requestedStep, hasDraft) {
  const steps = buildRegistrationSteps(policy);
  if (!steps.length || steps.includes(requestedStep)) return null;
  if (requestedStep === REGISTRATION_STEP.identity && hasDraft && steps.includes(REGISTRATION_STEP.verifyEmail)) {
    return '/email-verification?registration=true';
  }
  return hasDraft ? '/signup?resumeRegistration=true' : '/signup';
}

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
  REGISTRATION_STEP,
  REGISTRATION_STEP_LABELS,
  buildRegistrationSteps,
  adjacentRegistrationStep,
  registrationEntryStep,
  unavailableRegistrationRoute,
  getRegistrationConnectorStates,
  getRegistrationStepStates,
};
