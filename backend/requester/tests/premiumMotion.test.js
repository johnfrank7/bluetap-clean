const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const { reconcilePresenceList } = require('../../../services/animatedPresence');

test('presence reconciliation enters a stable ID once and disables removed snapshots immediately', () => {
  const seen = new Set();
  const identify = (item) => item.id;
  const first = reconcilePresenceList([], [{ id: 'order-a', status: 'pending' }], identify, seen);
  assert.equal(first[0].phase, 'entering');
  assert.equal(first[0].actionsDisabled, false);

  const settled = [{ ...first[0], phase: 'present' }];
  const updated = reconcilePresenceList(settled, [{ id: 'order-a', status: 'scheduled' }], identify, seen);
  assert.equal(updated[0].phase, 'present');

  const withNewOrder = reconcilePresenceList(updated, [updated[0].item, { id: 'order-b' }], identify, seen);
  assert.equal(withNewOrder.find((entry) => entry.id === 'order-b').phase, 'entering');

  const removed = reconcilePresenceList(withNewOrder, [{ id: 'order-b' }], identify, seen);
  const exiting = removed.find((entry) => entry.id === 'order-a');
  assert.equal(exiting.phase, 'exiting');
  assert.equal(exiting.actionsDisabled, true);
});

test('clock is integrated, local, minute-based, and cleaned up', () => {
  const clock = read('components', 'LocalTimeCard.jsx');
  const requester = read('app', 'requester', 'r_dashboard.jsx');
  const distributor = read('app', 'distributor', 'd_dashboard.jsx');
  assert.match(clock, /weekday/);
  assert.match(clock, /month: 'short'/);
  assert.match(clock, /setInterval\(update, 60000\)/);
  assert.match(clock, /clearInterval\(minuteInterval\)/);
  assert.match(requester, /compact=\{windowWidth < 430\}/);
  assert.match(distributor, /compact=\{width < 430\}/);
  assert.match(clock, /alignItems: 'flex-start'/);
  assert.match(clock, /name=\{daytime \? 'sun' : 'moon'\}/);
  assert.doesNotMatch(requester, /stacked=/);
  assert.doesNotMatch(distributor, /stacked=/);
  assert.doesNotMatch(requester, /todayText/);
  assert.doesNotMatch(distributor, /todayText/);
});

test('Assistant uses an immersive shared shell and measured nav spacing', () => {
  const requesterLayout = read('app', 'requester', '_layout.jsx');
  const assistant = read('components', 'assistant', 'AssistantScreen.jsx');
  assert.match(requesterLayout, /assistantOpen \? null : <RequesterHeader/);
  assert.match(assistant, /USER_PORTAL_LAYOUT\.navHeight/);
  assert.match(assistant, /USER_PORTAL_LAYOUT\.navBottomOffset/);
  assert.match(assistant, /axis="y"/);
  assert.match(assistant, /scaleFrom=\{0\.99\}/);
});

test('Admin secret entry remains trigger-gated and uses reduced-motion timing', () => {
  const login = read('app', 'login.jsx');
  const transition = read('components', 'AdminEntryTransition.jsx');
  assert.match(login, /createHiddenAdminEntryTracker/);
  assert.match(login, /setAdminEntryActive\(true\)/);
  assert.match(login, /playAdminEntrySound\(\)/);
  assert.match(login, /onComplete=\{\(\) => router\.push\('\/admin\/login'\)\}/);
  assert.doesNotMatch(login, /entryTheme/);
  assert.match(transition, /ADMIN_ENTRY_DURATION_MS = 780/);
  assert.match(transition, /ADMIN_ENTRY_REDUCED_DURATION_MS = 160/);
  assert.match(transition, /Administrative Access/);
});

test('theme and Admin-entry sounds are direct-action-only, bounded Web Audio enhancements', () => {
  const portalTheme = read('components', 'BlueTapTheme.jsx');
  const adminTheme = read('components', 'AdminTheme.jsx');
  const sounds = read('services', 'uiSound.js');
  assert.match(portalTheme, /if \(event\) playThemeDropSound\(\)/);
  assert.match(adminTheme, /if \(event\) playThemeDropSound\(\)/);
  assert.match(sounds, /typeof window === 'undefined'/);
  assert.match(sounds, /SOUND_COOLDOWN_MS/);
  assert.doesNotMatch(sounds, /autoplay|new Audio\(/);
  const { playAdminEntrySound, playThemeDropSound } = require('../../../services/uiSound');
  assert.equal(playThemeDropSound(), false);
  assert.equal(playAdminEntrySound(), false);
});

test('all notification pages share one-time list motion and explicit-button exit motion', () => {
  const hook = read('components', 'useNotificationPageMotion.js');
  const pages = [
    read('app', 'requester', 'r_notification.jsx'),
    read('app', 'distributor', 'd_notification.jsx'),
    read('app', 'manager', 'notifications.jsx'),
  ];
  assert.match(hook, /NOTIFICATION_EXIT_DURATION_MS = 160/);
  assert.match(hook, /useReducedMotionPreference/);
  assert.doesNotMatch(hook, /BackHandler|popstate|beforeunload/);
  for (const page of pages) {
    assert.match(page, /useNotificationPageMotion/);
    assert.match(page, /useAnimatedPresenceList\(events, \(event\) => event\.id/);
    assert.match(page, /NotificationBackButton[\s\S]*onPress=\{pageMotion\.goBack\}/);
    assert.match(page, /AnimatedPresenceItem/);
  }
});

test('Admin and Manager animate route content without wrapping their persistent sidebars', () => {
  const admin = read('components', 'AdminShell.jsx');
  const manager = read('components', 'ManagerShell.jsx');
  for (const source of [admin, manager]) {
    assert.match(source, /PageEnterTransition/);
    assert.match(source, /resetKey=\{pathname\}/);
    assert.match(source, /axis="y"/);
  }
});

test('Requester and Distributor order surfaces use stable presence and accessible tab motion', () => {
  const requester = read('app', 'requester', 'r_request.jsx');
  const dashboard = read('app', 'distributor', 'd_dashboard.jsx');
  const schedule = read('app', 'distributor', 'd_scheduled_requests.jsx');
  const history = read('app', 'distributor', 'd_history.jsx');
  for (const source of [requester, dashboard, schedule, history]) {
    assert.match(source, /useAnimatedPresenceList/);
    assert.match(source, /actionsDisabled/);
  }
  for (const source of [schedule, history]) {
    assert.match(source, /accessibilityRole="tab"/);
    assert.match(source, /hovered/);
    assert.match(source, /focused/);
    assert.match(source, /scale: 0\.985/);
  }
});
