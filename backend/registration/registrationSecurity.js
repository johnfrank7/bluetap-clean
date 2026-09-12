const { OtpError } = require('../utils/otpError');

const CONFIG_PATH = ['systemConfig', 'registrationSecurity'];
const POLICY_VERSION = 1;
const MIN_ACCOUNT_LIMIT = 1;
const MAX_ACCOUNT_LIMIT = 20;
const SECURE_DEFAULTS = Object.freeze({
  faceVerificationEnabled: true,
  emailOtpEnabled: true,
  maxAccountsPerDevice: 3,
  maxAccountsPerIp: 3,
  version: POLICY_VERSION,
});

function validateLimit(value, reason) {
  if (!Number.isInteger(value) || value < MIN_ACCOUNT_LIMIT || value > MAX_ACCOUNT_LIMIT) {
    throw new OtpError(400, reason, `Account limits must be whole numbers from ${MIN_ACCOUNT_LIMIT} to ${MAX_ACCOUNT_LIMIT}.`);
  }
  return value;
}

function validateRegistrationSecurity(input) {
  if (typeof input?.faceVerificationEnabled !== 'boolean' || typeof input?.emailOtpEnabled !== 'boolean') {
    throw new OtpError(400, 'INVALID_REGISTRATION_SECURITY_CONFIG', 'Registration verification settings are invalid.');
  }
  if (!input.faceVerificationEnabled && !input.emailOtpEnabled) {
    throw new OtpError(400, 'VERIFICATION_METHOD_REQUIRED', 'At least one registration verification method must remain enabled.');
  }
  return {
    faceVerificationEnabled: input.faceVerificationEnabled,
    emailOtpEnabled: input.emailOtpEnabled,
    maxAccountsPerDevice: validateLimit(input.maxAccountsPerDevice, 'INVALID_DEVICE_ACCOUNT_LIMIT'),
    maxAccountsPerIp: validateLimit(input.maxAccountsPerIp, 'INVALID_IP_ACCOUNT_LIMIT'),
    version: Number.isInteger(input.version) && input.version > 0 ? input.version : POLICY_VERSION,
  };
}

function normalizeRegistrationSecurity(data) {
  try {
    return validateRegistrationSecurity(data);
  } catch {
    return { ...SECURE_DEFAULTS };
  }
}

async function loadRegistrationSecurity(db) {
  try {
    const snapshot = await db.collection(CONFIG_PATH[0]).doc(CONFIG_PATH[1]).get();
    return snapshot.exists ? normalizeRegistrationSecurity(snapshot.data()) : { ...SECURE_DEFAULTS };
  } catch {
    return { ...SECURE_DEFAULTS };
  }
}

function policySnapshot(config) {
  const safe = normalizeRegistrationSecurity(config);
  return {
    faceVerificationRequired: safe.faceVerificationEnabled,
    emailOtpRequired: safe.emailOtpEnabled,
    maxAccountsPerDevice: safe.maxAccountsPerDevice,
    maxAccountsPerIp: safe.maxAccountsPerIp,
    policyVersion: safe.version,
  };
}

module.exports = {
  CONFIG_PATH,
  MAX_ACCOUNT_LIMIT,
  MIN_ACCOUNT_LIMIT,
  POLICY_VERSION,
  SECURE_DEFAULTS,
  loadRegistrationSecurity,
  normalizeRegistrationSecurity,
  policySnapshot,
  validateRegistrationSecurity,
};
