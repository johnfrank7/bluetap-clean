const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const rules = readFileSync(resolve(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8');

test('Firestore rules allow own-profile access and trusted operational role reads', () => {
  assert.match(rules, /allow get:\s*if request\.auth != null && \(request\.auth\.uid == uid \|\| isManager\(\) \|\| isAdmin\(\)\);/);
  assert.match(rules, /allow list:\s*if isManager\(\) \|\| isAdmin\(\);/);
});

test('Firestore rules keep OTP and registration state private', () => {
  for (const collection of ['registrationSessions', 'emailOtpVerifications', 'registrationOtpVerifications']) {
    assert.match(rules, new RegExp(`match \\/${collection}\\/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`));
  }
});

test('client profile updates cannot change trusted verification fields', () => {
  assert.match(rules, /allow create, delete:\s*if false;/);
  for (const protectedField of ['role', 'approvalStatus', 'emailVerified', 'registrationCompleted', 'faceVerification', 'termsAcceptance']) {
    assert.match(rules, new RegExp(`['\"]${protectedField}['\"]`));
  }
});

test('signed-in users read products while only authenticated managers write catalog', () => {
  assert.match(rules, /match \/products\/\{productId\}[\s\S]*allow read:\s*if signedIn\(\);/);
  assert.match(rules, /match \/products\/\{productId\}[\s\S]*allow write:\s*if isManager\(\);/);
});

test('registration config counters and audit logs are backend-only', () => {
  for (const collection of ['registrationLimits', 'systemConfig', 'adminAuditLogs']) {
    assert.match(rules, new RegExp(`match \/${collection}\/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`));
  }
});

test('request access stays bound to the authenticated requester', () => {
  assert.match(rules, /allow read:\s*if isRequester\(\) && resource\.data\.requester_id == request\.auth\.uid;/);
  assert.match(rules, /allow create:\s*if isRequester\(\)[\s\S]*request\.resource\.data\.requester_id == request\.auth\.uid[\s\S]*request\.resource\.data\.status == 'Pending';/);
  assert.match(rules, /allow update:\s*if isRequester\(\)[\s\S]*affectedKeys\(\)\.hasOnly\(\[[\s\S]*'status', 'updated_at', 'canceled_at'[\s\S]*\]\);/);
  assert.match(rules, /match \/requests\/\{requestId\}[\s\S]*allow delete:\s*if false;/);
});
