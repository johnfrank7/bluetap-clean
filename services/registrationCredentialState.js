const getRegistrationCredentialState = (password, confirmation) => {
  const passwordPolicyPassed = typeof password === 'string' && password.trim().length >= 8 && password.length <= 128;
  const hasConfirmation = typeof confirmation === 'string' && confirmation.length > 0;
  const passwordsMatch = hasConfirmation && password === confirmation;
  return {
    passwordPolicyPassed,
    passwordsMatch,
    mismatch: hasConfirmation && !passwordsMatch,
    success: passwordPolicyPassed && passwordsMatch,
  };
};

module.exports = { getRegistrationCredentialState };
