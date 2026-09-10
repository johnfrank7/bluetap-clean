const { OtpError } = require('../utils/otpError');

const USERNAME_PATTERN = /^[a-z0-9_]{4,20}$/;

function normalizeUsername(value) {
  if (typeof value !== 'string') {
    throw new OtpError(400, 'invalid-username', 'Username must be 4–20 characters.');
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 4 || normalized.length > 20) {
    throw new OtpError(400, 'invalid-username', 'Username must be 4–20 characters.');
  }
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new OtpError(400, 'invalid-username', 'Only letters, numbers, and underscores are allowed.');
  }
  return normalized;
}

module.exports = { normalizeUsername, USERNAME_PATTERN };
