const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const signup = fs.readFileSync('app/signup.jsx', 'utf8');
const verification = fs.readFileSync('app/email-verification.jsx', 'utf8');

test('wrong OTP is handled inline and leaves the verification route available', () => {
  const verifyHandler = verification.slice(verification.indexOf('  const verify = async () => {'), verification.indexOf('  const retryFinalization = async () => {'));
  assert.match(verifyHandler, /catch\s*\(error\)/);
  assert.match(verifyHandler, /setMessage\(getOtpError\(error\)\)/);
  assert.match(verifyHandler, /setMessageType\('error'\)/);
  assert.match(verification, /\{messageType === 'error' \? 'error'/);
  assert.match(verification, /export function ErrorBoundary\(\{ retry \}\)/);
  assert.match(verification, /Verification could not be displayed/);
});

test('registration Back action resumes the in-memory draft at account details', () => {
  assert.match(verification, /backLabel=\{registration \? 'Edit Email Address'/);
  assert.match(verification, /pathname: '\/signup', params: \{ role: draft\?\.profile\?\.role[^}]*resumeRegistration: 'true'/);
  assert.match(signup, /getPendingRegistration\(\)/);
  assert.match(signup, /password: usernameRetryDraft\?\.profile\?\.password/);
  assert.match(signup, /clearPendingRegistration\(\{ preserveFaceEnrollment: true \}\)/);
});

test('OTP input preserves paste/autofill and uses semantic light/dark theme colors', () => {
  assert.match(verification, /autoComplete="one-time-code"/);
  assert.match(verification, /textContentType="oneTimeCode"/);
  assert.match(verification, /keyboardType="number-pad"/);
  assert.match(verification, /colors\.textPrimary/);
  assert.match(verification, /backgroundColor: colors\.surface/);
  assert.match(verification, /backgroundColor: colors\.surfaceAlt/);
  assert.match(verification, /borderColor: colors\.border/);
});
