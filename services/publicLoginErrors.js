const messages = {
  INVALID_CREDENTIALS: 'Invalid username or password.',
  PRIVILEGED_LOGIN_REQUIRED: 'This account must use the Administrator sign-in portal.',
  NETWORK_ERROR: 'We could not reach the authentication service. Please try again.',
  SERVER_ERROR: 'Login is temporarily unavailable. Please try again.',
  ACCOUNT_SETUP_INCOMPLETE: 'Your account setup is incomplete. Please contact support.',
  ACCOUNT_MAPPING_INVALID: 'Your account sign-in setup needs attention. Please contact support.',
  ACCOUNT_DISABLED: 'This account is disabled. Please contact support.',
  TOO_MANY_ATTEMPTS: 'Too many login attempts. Please try again later.',
  LOGIN_RATE_LIMITED: 'Too many login attempts. Please try again later.',
  INVALID_REQUEST: 'Enter a valid username or email and password.',
};

const aliases = {
  'LOGIN_RATE_LIMITED': 'LOGIN_RATE_LIMITED',
  'username/LOGIN_RATE_LIMITED': 'LOGIN_RATE_LIMITED',
  'username/too-many-attempts': 'LOGIN_RATE_LIMITED',
  'auth/too-many-requests': 'LOGIN_RATE_LIMITED',
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
  'username/invalid-request': 'INVALID_REQUEST',
};

function formatRetryDuration(seconds) {
  const total = Math.max(1, Math.round(Number(seconds)));
  if (total >= 60) {
    const mins = Math.ceil(total / 60);
    return `${mins} minute${mins === 1 ? '' : 's'}`;
  }
  return `${total} second${total === 1 ? '' : 's'}`;
}

function getPublicLoginErrorMessage(error) {
  const retrySeconds = error?.retryAfterSeconds;
  if (retrySeconds != null && Number.isFinite(Number(retrySeconds)) && Number(retrySeconds) > 0) {
    return `Too many login attempts. Try again in ${formatRetryDuration(retrySeconds)}.`;
  }
  const code = aliases[error?.code] || error?.code;
  return messages[code] || messages.SERVER_ERROR;
}

module.exports = { getPublicLoginErrorMessage, formatRetryDuration };
