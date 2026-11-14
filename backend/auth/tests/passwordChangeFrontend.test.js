const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('role screens expose the shared OTP modal', () => {
  for (const file of ['app/requester/r_profile.jsx', 'app/distributor/d_profile.jsx', 'app/manager/profile.jsx']) {
    const source = read(file);
    assert.match(source, /accessibilityLabel="Change Password"/);
    assert.match(source, /<ChangePasswordModal/);
    assert.match(source, /confirmLeave/);
  }
});

test('password UI reauthenticates and uses the backend OTP route, never Firebase direct update', () => {
  const modal = read('components/ChangePasswordModal.jsx');
  const service = read('services/passwordChangeOtp.js');
  assert.match(modal, /reauthenticateWithCredential/);
  assert.doesNotMatch(modal, /updatePassword\(/);
  assert.match(service, /getApiUrl\('\/api\/auth\/password-change-otp'\)/);
  assert.match(service, /Authorization: `Bearer/);
});
