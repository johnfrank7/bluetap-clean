const messages = {
  INVALID_CREDENTIALS: 'Invalid username or password.',
  PRIVILEGED_LOGIN_REQUIRED: 'This account must use its authorized sign-in portal.',
  NETWORK_ERROR: 'We could not reach the authentication service. Please try again.',
  SERVER_ERROR: 'Login is temporarily unavailable. Please try again.',
  ACCOUNT_SETUP_INCOMPLETE: 'Your account setup is incomplete. Please contact support.',
  ACCOUNT_MAPPING_INVALID: 'Your account sign-in setup needs attention. Please contact support.',
  ACCOUNT_DISABLED: 'This account is disabled. Please contact support.',
  TOO_MANY_ATTEMPTS: 'Too many login attempts. Please try again later.',
  INVALID_REQUEST: 'Enter a valid username or email and password.',
};

const aliases = {
  'username/invalid-credential': 'INVALID_CREDENTIALS',
  'auth/invalid-credential': 'INVALID_CREDENTIALS',
  'auth/user-not-found': 'INVALID_CREDENTIALS',
  'auth/wrong-password': 'INVALID_CREDENTIALS',
  'username/privileged-login-required': 'PRIVILEGED_LOGIN_REQUIRED',
  'username/network': 'NETWORK_ERROR',
  'auth/network-request-failed': 'NETWORK_ERROR',
  'username/service-unavailable': 'SERVER_ERROR',
  'username/account-setup-incomplete': 'ACCOUNT_SETUP_INCOMPLETE',
  'username/account-mapping-invalid': 'ACCOUNT_MAPPING_INVALID',
  'username/account-disabled': 'ACCOUNT_DISABLED',
  'auth/user-disabled': 'ACCOUNT_DISABLED',
  'username/too-many-attempts': 'TOO_MANY_ATTEMPTS',
  'auth/too-many-requests': 'TOO_MANY_ATTEMPTS',
  'username/invalid-request': 'INVALID_REQUEST',
};

function getPublicLoginErrorMessage(error) {
  const code = aliases[error?.code] || error?.code;
  return messages[code] || messages.SERVER_ERROR;
}

module.exports = { getPublicLoginErrorMessage };
