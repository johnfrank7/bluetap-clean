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
  for (const protectedField of ['role', 'distributorStatus', 'approvalStatus', 'approvedBy', 'requestedBranchId', 'emailVerified', 'registrationCompleted', 'faceVerification', 'termsAcceptance', 'branchId', 'managerStatus']) {
    assert.match(rules, new RegExp(`['\"]${protectedField}['\"]`));
  }
});

test('product catalog is readable when signed in but all client mutations are server-only', () => {
  assert.match(rules, /function isManagerBranch\(branchId\)[\s\S]*branchId == currentUser\(\)\.branchId/);
  assert.match(rules, /match \/products\/\{productId\}[\s\S]*allow read:\s*if signedIn\(\);/);
  assert.match(rules, /match \/products\/\{productId\}[\s\S]*allow create, update, delete:\s*if false;/);
});

test('registration config counters and audit logs are backend-only', () => {
  for (const collection of ['registrationLimits', 'systemConfig', 'adminAuditLogs']) {
    assert.match(rules, new RegExp(`match \/${collection}\/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`));
  }
});

test('Manager operational events are backend-only rather than client-readable inbox documents', () => {
  assert.match(rules, /match \/managerOperationalEvents\/\{eventId\} \{ allow read, write: if false; \}/);
});

test('request access stays bound to the authenticated requester', () => {
  assert.match(rules, /allow read:\s*if isRequester\(\) && resource\.data\.requester_id == request\.auth\.uid;/);
  assert.match(rules, /match \/requests\/\{requestId\}[\s\S]*allow create, update, delete:\s*if false;/);
});

test('dispatch reads stay scoped to current Branch ownership and assigned Distributors', () => {
  assert.match(rules, /isManagerBranch\(resource\.data\.branchId\)/);
  assert.match(rules, /isManagerBranch\(resource\.data\.transferToBranchId\)[\s\S]*branch_transfer_pending/);
  assert.match(rules, /function isDistributor\(\)[\s\S]*currentUser\(\)\.role == 'distributor'/);
  assert.match(rules, /resource\.data\.assignedDistributorUid == request\.auth\.uid[\s\S]*resource\.data\.branchId == currentUser\(\)\.branchId/);
});

test('branch definitions and Admin audit logs are backend-write-only', () => {
  assert.match(rules, /match \/branches\/\{branchId\}[\s\S]*allow list, create, update, delete:\s*if false;/);
  assert.match(rules, /request\.auth\.token\.manager == true/);
  assert.match(rules, /request\.auth\.token\.admin == true/);
});

test('approved Distributor may get only their own authoritative assigned branch', () => {
  // The rule must include isDistributor() gating the branch get.
  assert.match(rules, /isDistributor\(\) && branchId == currentUser\(\)\.branchId/);
  // Both Manager and Distributor paths must appear in the branches block.
  assert.match(rules, /match \/branches\/\{branchId\}[\s\S]*isManager\(\) && branchId == currentUser\(\)\.branchId[\s\S]*isDistributor\(\) && branchId == currentUser\(\)\.branchId/);
});

test('Distributor branch rule never references requestedBranchId for access', () => {
  // requestedBranchId must not appear in the branches match block.
  const branchBlock = rules.match(/match \/branches\/\{branchId\}\s*\{[\s\S]*?\}/)?.[0] || '';
  assert.ok(branchBlock.length > 0, 'branches block must be present');
  assert.ok(!branchBlock.includes('requestedBranchId'), 'requestedBranchId must not appear in branch access rule');
});

test('isDistributor() requires approval status — branchless and pending Distributors are blocked', () => {
  // isDistributor() checks distributorStatus/approvalStatus/status and branchId is string.
  assert.match(rules, /function isDistributor\(\)[\s\S]*distributorStatus == 'active' \|\| currentUser\(\)\.distributorStatus == 'approved'/);
  assert.match(rules, /function isDistributor\(\)[\s\S]*currentUser\(\)\.branchId is string/);
});

test('branch list create update delete remain blocked for all clients', () => {
  assert.match(rules, /match \/branches\/\{branchId\}[\s\S]*allow list, create, update, delete:\s*if false;/);
  // Confirm no allow list rule exists for branches.
  const branchBlock = rules.match(/match \/branches\/\{branchId\}\s*\{[\s\S]*?\}/)?.[0] || '';
  assert.ok(!branchBlock.includes('allow list: if'), 'branch listing must remain blocked');
});

test('requesterActiveOrders guard documents are strictly backend-only', () => {
  assert.match(rules, /match \/requesterActiveOrders\/\{document=\*\*\} \{ allow read, write: if false; \}/);
});

test('Admin has read-only oversight on requests collection while client mutations remain blocked', () => {
  assert.match(rules, /match \/requests\/\{requestId\}[\s\S]*allow read:\s*if isAdmin\(\);/);
  assert.match(rules, /match \/requests\/\{requestId\}[\s\S]*allow create, update, delete:\s*if false;/);
});
