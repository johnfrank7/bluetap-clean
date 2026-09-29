const { OtpError } = require('../utils/otpError');

const ACCOUNT_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
  TERMINATED: 'terminated',
});

const SUPPORTED_ACCOUNT_STATUSES = new Set(Object.values(ACCOUNT_STATUS));
const normalize = (value) => String(value || '').trim().toLowerCase();
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

/**
 * Canonical global account-state resolution.
 *
 * Legacy profiles without accountStatus remain compatible:
 * - explicit legacy inactive/disabled, suspended, or terminated values are denied;
 * - inactive legacy Manager/Distributor operational status maps to inactive;
 * - pending/rejected Distributor approval remains a separate operational state;
 * - otherwise the legacy account is globally active and its role-specific guard
 *   still decides whether it is operationally eligible.
 *
 * An explicit but unsupported accountStatus fails closed as inactive.
 */
function canonicalAccountStatus(profile = {}) {
  const explicit = normalize(profile.accountStatus);
  if (SUPPORTED_ACCOUNT_STATUSES.has(explicit)) return explicit;
  if (explicit === 'disabled') return ACCOUNT_STATUS.INACTIVE;
  if (hasOwn(profile, 'accountStatus') && explicit) return ACCOUNT_STATUS.INACTIVE;

  const legacyStatus = normalize(profile.status);
  const managerStatus = normalize(profile.managerStatus);
  const distributorStatus = normalize(profile.distributorStatus);
  const approvalStatus = normalize(profile.approvalStatus);
  const legacyValues = [legacyStatus, managerStatus, distributorStatus, approvalStatus];

  if (legacyValues.includes(ACCOUNT_STATUS.TERMINATED)) return ACCOUNT_STATUS.TERMINATED;
  if (legacyValues.includes(ACCOUNT_STATUS.SUSPENDED)) return ACCOUNT_STATUS.SUSPENDED;
  if (legacyValues.some((status) => ['inactive', 'disabled'].includes(status))) return ACCOUNT_STATUS.INACTIVE;
  return ACCOUNT_STATUS.ACTIVE;
}

function accountStatusFlags(profile = {}) {
  const status = canonicalAccountStatus(profile);
  return {
    status,
    active: status === ACCOUNT_STATUS.ACTIVE,
    inactive: status === ACCOUNT_STATUS.INACTIVE,
    suspended: status === ACCOUNT_STATUS.SUSPENDED,
    terminated: status === ACCOUNT_STATUS.TERMINATED,
  };
}

function requireActiveAccount(profile = {}, options = {}) {
  const status = canonicalAccountStatus(profile);
  if (status === ACCOUNT_STATUS.ACTIVE) return status;

  const defaults = {
    [ACCOUNT_STATUS.INACTIVE]: ['ACCOUNT_INACTIVE', 'This account is inactive.'],
    [ACCOUNT_STATUS.SUSPENDED]: ['ACCOUNT_SUSPENDED', 'This account is temporarily suspended.'],
    [ACCOUNT_STATUS.TERMINATED]: ['ACCOUNT_TERMINATED', 'This account has been terminated.'],
  };
  const [defaultReason, defaultMessage] = defaults[status] || defaults[ACCOUNT_STATUS.INACTIVE];
  const reason = options[`${status}Reason`] || defaultReason;
  const message = options[`${status}Message`] || defaultMessage;
  throw new OtpError(403, reason, message);
}

module.exports = {
  ACCOUNT_STATUS,
  SUPPORTED_ACCOUNT_STATUSES,
  accountStatusFlags,
  canonicalAccountStatus,
  requireActiveAccount,
};
