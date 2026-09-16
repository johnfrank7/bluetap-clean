const assert = require('node:assert/strict');
const test = require('node:test');
const { emailFor, passwordFor } = require('../accountManagementHandler');

test('manual account input normalizes email and applies the shared password policy', () => {
  assert.equal(emailFor('  Person@Gmail.com '), 'person@gmail.com');
  assert.throws(() => emailFor('not-an-email'), (error) => error.reason === 'INVALID_EMAIL');
  assert.equal(passwordFor('SafePassword2026'), 'SafePassword2026');
  assert.throws(() => passwordFor('onlyeight'), (error) => error.reason === 'WEAK_PASSWORD');
});
