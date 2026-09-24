const PHILIPPINE_PHONE_REGEX = /^(?:\+?63|0)?(9\d{9})$/;

function normalizePhilippinePhone(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const digits = String(input).replace(/[^\d+]/g, '');
  const match = digits.match(PHILIPPINE_PHONE_REGEX);
  if (!match) return null;
  return `+63${match[1]}`;
}

function isValidPhilippinePhone(input) {
  return normalizePhilippinePhone(input) !== null;
}

function formatPhilippinePhone(input) {
  const normalized = normalizePhilippinePhone(input);
  if (!normalized) return String(input || '');
  // Format as 09XX XXX XXXX
  const tenDigits = normalized.slice(3); // 9XXXXXXXXX
  return `0${tenDigits.slice(0, 3)} ${tenDigits.slice(3, 6)} ${tenDigits.slice(6)}`;
}

module.exports = {
  PHILIPPINE_PHONE_REGEX,
  normalizePhilippinePhone,
  isValidPhilippinePhone,
  formatPhilippinePhone,
};

