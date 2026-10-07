const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (relPath) => readFileSync(resolve(root, relPath), 'utf8');

test('Requester request form removes internal technical reload message', () => {
  const fileContent = read('app/requester/requestform.jsx');

  // Must NOT contain the internal technical message
  assert.equal(
    fileContent.includes('The backend reloads branch coverage, distance, product prices, delivery fees, and the final total when you submit.'),
    false,
    'Technical backend reload sentence must not be present in JSX'
  );
  assert.doesNotMatch(fileContent, /The backend reloads branch coverage/);
});

test('Requester request form active order banner uses human status labels and public order references', () => {
  const fileContent = read('app/requester/requestform.jsx');

  // Verify formatActiveOrderStatusLabel function exists and handles raw enums
  assert.match(fileContent, /function formatActiveOrderStatusLabel/);
  assert.match(fileContent, /outside_radius_pending_approval:\s*['"]Awaiting Branch Approval['"]/);
  assert.match(fileContent, /manager_approval_pending:\s*['"]Awaiting Branch Approval['"]/);
  assert.match(fileContent, /awaiting_distributor_assignment:\s*['"]Awaiting Dispatch['"]/);
  assert.match(fileContent, /pending:\s*['"]Pending Review['"]/);

  // Verify resolvePublicOrderReference filters raw Firestore auto IDs
  assert.match(fileContent, /function resolvePublicOrderReference/);
  assert.match(fileContent, /\[a-zA-Z0-9\]\{20,\}/);
  assert.match(fileContent, /\.test\(candidate\)/);

  // Verify banner rendering
  assert.match(fileContent, /styles\.activeOrderBanner/);
  assert.match(fileContent, /Active Order in Progress/);
  assert.match(fileContent, /styles\.activeOrderButton/);
  assert.match(fileContent, /View Active Order/);
});

test('Requester request form header contains boxed 44px back button aligned with NEW REQUEST', () => {
  const fileContent = read('app/requester/requestform.jsx');

  // Header top row alignment
  assert.match(fileContent, /styles\.headerTopRow/);
  assert.match(fileContent, /styles\.eyebrow/);
  assert.match(fileContent, /NEW REQUEST/);
  assert.match(fileContent, /styles\.backButton/);
  assert.match(fileContent, /styles\.backButtonText/);
  assert.match(fileContent, /← Back/);

  // confirmLeave guard on back button
  assert.match(fileContent, /confirmLeave\(\(\)\s*=>/);

  // Styles definition
  assert.match(fileContent, /headerTopRow:\s*\{[^}]*flexDirection:\s*['"]row['"][^}]*justifyContent:\s*['"]space-between['"]/);
  assert.match(fileContent, /backButton:\s*\{[^}]*minHeight:\s*44/);
});

test('Requester request form displays centralized delivery fee and breakdown', () => {
  const fileContent = read('app/requester/requestform.jsx');

  // Centralized pricing imports
  assert.match(fileContent, /normalizeBranchDeliveryPricing/);
  assert.match(fileContent, /calculateDeliveryFee/);
  assert.match(fileContent, /calculateOrderTotal/);
  assert.match(fileContent, /getDeliveryFeeBreakdown/);

  // Breakdown rendering in Section 5
  assert.match(fileContent, /styles\.feeBreakdownText/);
  assert.match(fileContent, /deliveryBreakdown\.isWithinIncludedRadius/);
  assert.match(fileContent, /Within base/);
});

test('Requester request form active order button has solid 44px primary styling and high contrast', () => {
  const fileContent = read('app/requester/requestform.jsx');

  // Verify button styles definition
  assert.match(fileContent, /activeOrderButton:\s*\{[^}]*minHeight:\s*44/);
  assert.match(fileContent, /activeOrderButton:\s*\{[^}]*backgroundColor:\s*BLUETAP_COLORS\.primaryAction/);
  assert.match(fileContent, /activeOrderButtonText:\s*\{[^}]*color:\s*['"]#FFFFFF['"]/);

  // Verify button JSX has theme primaryAction and onPrimary
  assert.match(fileContent, /colors\.primaryAction/);
  assert.match(fileContent, /colors\.onPrimary/);
});
