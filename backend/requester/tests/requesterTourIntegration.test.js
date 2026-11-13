const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Requester tutorial covers five real targets with Next, Back, Skip, and Finish controls', () => {
  const tutorial = read('components', 'RequesterTutorialModal.jsx');
  const { TUTORIAL_STEPS } = require('../../../services/requesterTour');
  assert.deepEqual(TUTORIAL_STEPS.map((step) => step.target), ['home', 'add', 'orders', 'notifications', 'profile']);
  for (const step of TUTORIAL_STEPS) {
    assert.ok(fs.existsSync(path.resolve(root, 'app', `${step.route.slice(1)}.jsx`)));
  }
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

  // First-time display check in Requester Layout
  assert.match(layout, /<RequesterTourProvider>/);
  assert.match(tutorial, /AsyncStorage\.getItem\(getTutorialSeenKey\(uid\)\)/);
  assert.match(tutorial, /seen !== 'true'/);

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

test('Requester tutorial has Requester-only visibility and is absent from Distributor, Manager, and Admin shells', () => {
  const dProfile = read('app', 'distributor', 'd_profile.jsx');
  const mShell = read('components', 'ManagerShell.jsx');
  const aShell = read('components', 'AdminShell.jsx');

  assert.doesNotMatch(dProfile, /RequesterTutorialModal/);
  assert.doesNotMatch(mShell, /RequesterTutorialModal/);
  assert.doesNotMatch(aShell, /RequesterTutorialModal/);
});
