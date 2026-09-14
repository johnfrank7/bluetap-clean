const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const rules = readFileSync(resolve(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8');

test('Firestore rules allow own-profile access while scoping Manager reads to their Branch', () => {
  assert.match(rules, /request\.auth\.uid == uid \|\| isAdmin\(\)/);
  assert.match(rules, /isManager\(\) && resource\.data\.branchId == currentUser\(\)\.branchId/);
  assert.match(rules, /allow list:\s*if isAdmin\(\) \|\| \(isManager\(\)/);
});

test('Firestore rules keep OTP and registration state private', () => {
  for (const collection of ['registrationSessions', 'emailOtpVerifications', 'registrationOtpVerifications']) {
    assert.match(rules, new RegExp(`match \\/${collection}\\/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`));
  }
});

test('client profile updates cannot change trusted verification fields', () => {
  assert.match(rules, /allow create, delete:\s*if false;/);
  for (const protectedField of ['role', 'approvalStatus', 'emailVerified', 'registrationCompleted', 'faceVerification', 'termsAcceptance', 'branchId', 'managerStatus']) {
    assert.match(rules, new RegExp(`['\"]${protectedField}['\"]`));
  }
});

test('Manager catalog access is restricted to its active Branch', () => {
  assert.match(rules, /function isManagerBranch\(branchId\)[\s\S]*branchId == currentUser\(\)\.branchId/);
  assert.match(rules, /match \/products\/\{productId\}[\s\S]*allow read:[\s\S]*isManagerBranch\(resource\.data\.branchId\)/);
  assert.match(rules, /allow create:\s*if isManagerBranch\(request\.resource\.data\.branchId\);/);
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

test('branch definitions and Admin audit logs are backend-write-only', () => {
  assert.match(rules, /match \/branches\/\{branchId\}[\s\S]*allow list, create, update, delete:\s*if false;/);
  assert.match(rules, /request\.auth\.token\.manager == true/);
  assert.match(rules, /request\.auth\.token\.admin == true/);
});
