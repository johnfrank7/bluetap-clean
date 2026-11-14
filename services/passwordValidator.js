/**
 * Validates password strength according to BlueTap security requirements:
 * - Minimum 8 characters (and recommended 12 for strong passwords)
 * - At least one lowercase letter
 * - At least one uppercase letter
 * - At least one numeric digit
 *
 * @param {string} password
 * @returns {{ valid: boolean, message: string }}
 */
function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required.' };
  }
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number.' };
  }
  return { valid: true, message: '' };
}

module.exports = {
  validatePasswordStrength,
};
