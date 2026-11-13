// Manager profile accepts local or international Philippine mobile numbers.
// Spaces are allowed for readability; other pasted characters are rejected.
function isValidManagerPhone(value) {
  if (typeof value !== 'string' || !/^[+\d ]+$/.test(value.trim())) return false;
  return /^(?:09\d{9}|\+639\d{9})$/.test(value.trim().replace(/ /g, ''));
}

module.exports = { isValidManagerPhone };
