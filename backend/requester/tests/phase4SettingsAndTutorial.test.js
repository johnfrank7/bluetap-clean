const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('validatePasswordStrength enforces minimum 8 chars, uppercase, lowercase, and number', () => {
  const { validatePasswordStrength } = require('../../../services/passwordValidator');

  assert.equal(validatePasswordStrength('').valid, false);
  assert.equal(validatePasswordStrength('short1A').valid, false);
  assert.equal(validatePasswordStrength('alllowercase1').valid, false);
  assert.equal(validatePasswordStrength('ALLUPPERCASE1').valid, false);
  assert.equal(validatePasswordStrength('NoNumbersHere!').valid, false);
  assert.equal(validatePasswordStrength('ValidPassword2026').valid, true);
});

test('assistantStorage handles getAssistantVisibility and setAssistantVisibility with default true', async () => {
  const {
    ASSISTANT_VISIBILITY_KEY,
    getAssistantVisibility,
    setAssistantVisibility,
  } = await import('../../../services/assistant/assistantStorage.js');

  assert.equal(ASSISTANT_VISIBILITY_KEY, 'bluetap:assistant:visible');
  assert.equal(typeof getAssistantVisibility, 'function');
  assert.equal(typeof setAssistantVisibility, 'function');

  const setRes = await setAssistantVisibility(true);
  assert.equal(setRes, true);
  const visible = await getAssistantVisibility();
  assert.equal(visible, true);
  await setAssistantVisibility(false, 'requester');
  await setAssistantVisibility(true, 'distributor');
  assert.equal(await getAssistantVisibility('requester'), false);
  assert.equal(await getAssistantVisibility('distributor'), true);
  await setAssistantVisibility(true, 'requester');
});

test('Requester and Distributor profiles integrate ChangePasswordModal and Assistant toggle', () => {
  const rProfile = read('app', 'requester', 'r_profile.jsx');
  const dProfile = read('app', 'distributor', 'd_profile.jsx');

  for (const src of [rProfile, dProfile]) {
    assert.match(src, /ChangePasswordModal/);
    assert.match(src, /changePasswordVisible/);
    assert.match(src, /assistantVisible/);
    assert.match(src, /setAssistantVisibility/);
    assert.match(src, /<Switch/);
    assert.match(src, /Account Password/);
  }
});

test('Manager Shell and SidebarIcon include unified Settings navigation', () => {
  const shell = read('components', 'ManagerShell.jsx');
  const sidebar = read('components', 'SidebarIcon.jsx');
  const settings = read('app', 'manager', 'settings.jsx');

  assert.match(shell, /path: '\/manager\/settings'/);
  assert.match(shell, /label: 'Settings'/);
  assert.match(sidebar, /settings: 'Settings2'/);
  assert.match(settings, /ManagerShell/);
  assert.match(settings, /ChangePasswordModal/);
  assert.match(settings, /useAdminTheme/);
  assert.match(settings, /updateManagerProfile/);
});

test('RequestDetailsModal provides an itemized breakdown of products, delivery fee, and grand total', () => {
  const modal = read('components', 'RequestDetailsModal.jsx');
  const pricing = read('components', 'SavedOrderPricing.jsx');
  const projection = read('services', 'savedOrderPricing.js');

  assert.match(modal, /<SavedOrderPricing order=\{request\}/);
  assert.match(pricing, /Regular product subtotal/);
  assert.match(pricing, /Delivery fee/);
  assert.match(pricing, /Final payable total/);
  assert.match(projection, /discountAmount/);
  assert.match(pricing, /formatCurrency/);
});

test('Distributor scheduled requests decouples network errors from empty list presentation', () => {
  const scheduled = read('app', 'distributor', 'd_scheduled_requests.jsx');

  assert.match(scheduled, /error && scheduledPresentation\.length === 0/);
  assert.match(scheduled, /error && scheduledPresentation\.length > 0/);
  assert.match(scheduled, /No Scheduled Deliveries/);
  assert.match(scheduled, /minHeight: 44/);
});

test('Requester tutorial covers five real targets with Next, Back, Skip, and Finish controls', () => {
  const tutorial = read('components', 'RequesterTutorialModal.jsx');
  const { TUTORIAL_STEPS } = require('../../../services/requesterTour');
  assert.deepEqual(TUTORIAL_STEPS.map((step) => step.target), ['home', 'add', 'orders', 'notifications', 'profile']);
  for (const step of TUTORIAL_STEPS) assert.ok(require('fs').existsSync(require('path').resolve(__dirname, '../../../app', `${step.route.slice(1)}.jsx`)));
  assert.doesNotMatch(JSON.stringify(TUTORIAL_STEPS), /recurring|calendar/i);

  // Controls: Next, Back, Skip, Finish
  assert.match(tutorial, /Skip/);
  assert.match(tutorial, /Back/);
  assert.match(tutorial, /Next →/);
  assert.match(tutorial, /'Finish'/);
  assert.match(tutorial, /accessibilityLabel="Skip tutorial"/);
  assert.match(tutorial, /accessibilityLabel="Previous step"/);
  assert.match(tutorial, /accessibilityLabel=\{last \? 'Finish tutorial' : 'Next step'\}/);
});

test('Requester tutorial provides first-time display, dismissal persistence, and reopening via How to Use BlueTap', () => {
  const tutorial = read('components', 'RequesterTutorialModal.jsx');
  const layout = read('app', 'requester', '_layout.jsx');
  const profile = read('app', 'requester', 'r_profile.jsx');

  // First-time display check in Requester Dashboard
  assert.match(tutorial, /AsyncStorage\.getItem\(getTutorialSeenKey\(uid\)\)/);
  assert.match(tutorial, /seen !== 'true'/);
  assert.match(layout, /<RequesterTourProvider>/);

  // Dismissal and persistence in modal
  assert.match(tutorial, /TUTORIAL_SEEN_KEY = 'bluetap:requester:tutorial_seen'/);
  assert.match(tutorial, /AsyncStorage\.setItem\(getTutorialSeenKey\(uid\), 'true'\)/);
  assert.match(tutorial, /AsyncStorage\.removeItem\(activeKey\(uid\)\)/);
  assert.match(tutorial, /accessibilityLabel="Skip tutorial"/);

  // Reopening through "How to Use BlueTap" in Requester Profile
  assert.match(profile, /How to Use BlueTap/);
  assert.match(profile, /confirmLeave\(startTour\)/);
});

test('Requester tutorial key generation is account-scoped', () => {
  const tutorial = read('components', 'RequesterTutorialModal.jsx');
  assert.match(tutorial, /export const getTutorialSeenKey =/);
  const match = tutorial.match(/const TUTORIAL_SEEN_KEY = [^;]+;[\s\S]*?const getTutorialSeenKey = \([\s\S]*?\n\};/);
  assert.ok(match, 'getTutorialSeenKey function found in source');
  const fn = new Function(`${match[0].replace(/export\s+/g, '')}; return { TUTORIAL_SEEN_KEY, getTutorialSeenKey };`)();

  assert.equal(fn.TUTORIAL_SEEN_KEY, 'bluetap:requester:tutorial_seen');
  assert.equal(fn.getTutorialSeenKey('user_123'), 'bluetap:requester:tutorial_seen:user_123');
  assert.equal(fn.getTutorialSeenKey('  user_456  '), 'bluetap:requester:tutorial_seen:user_456');
  assert.equal(fn.getTutorialSeenKey(''), 'bluetap:requester:tutorial_seen');
  assert.equal(fn.getTutorialSeenKey(null), 'bluetap:requester:tutorial_seen');
  assert.equal(fn.getTutorialSeenKey(undefined), 'bluetap:requester:tutorial_seen');

  assert.match(tutorial, /bluetap:requester:tutorial_active:\$\{uid\}/);
});

test('ChangePasswordModal securely enforces reauthentication and sanitizes error messages', () => {
  const modal = read('components', 'ChangePasswordModal.jsx');

  assert.match(modal, /EmailAuthProvider\.credential\(currentUser\.email, currentPassword\)/);
  assert.match(modal, /reauthenticateWithCredential\(currentUser, credential\)/);
  assert.match(modal, /updatePassword\(currentUser, newPassword\)/);
  assert.match(modal, /console\.warn\('Change password error code:', err\?\.code \|\| 'unknown'\)/);
  assert.doesNotMatch(modal, /console\.warn\('Change password error:', err\)/);
  assert.match(modal, /setErrorMessage\('Failed to change password\. Please try again\.'\)/);
});

test('Requester tutorial has Requester-only visibility and is absent from Distributor, Manager, and Admin shells', () => {
  const dProfile = read('app', 'distributor', 'd_profile.jsx');
  const dScheduled = read('app', 'distributor', 'd_scheduled_requests.jsx');
  const mShell = read('components', 'ManagerShell.jsx');
  const aShell = read('components', 'AdminShell.jsx');

  assert.doesNotMatch(dProfile, /RequesterTutorialModal/);
  assert.doesNotMatch(dScheduled, /RequesterTutorialModal/);
  assert.doesNotMatch(mShell, /RequesterTutorialModal/);
  assert.doesNotMatch(aShell, /RequesterTutorialModal/);
});
