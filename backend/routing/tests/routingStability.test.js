const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { createSingleFlightLock, createSingleFlightNavigation } = require('../../../services/navigationLock');

test('verified Distributor navigation destinations exist as Expo Router files', () => {
  const routes = {
    '/distributor/d_dashboard': 'app/distributor/d_dashboard.jsx',
    '/distributor/d_requests': 'app/distributor/d_requests.jsx',
    '/distributor/d_scheduled_requests': 'app/distributor/d_scheduled_requests.jsx',
    '/distributor/d_profile': 'app/distributor/d_profile.jsx',
  };
  Object.values(routes).forEach((file) => assert.equal(fs.existsSync(path.join(root, file)), true, `${file} must exist`));

  const nav = read('components/AppBottomNav.jsx');
  Object.keys(routes).forEach((route) => assert.match(nav, new RegExp(route.replaceAll('/', '\\/'))));
});

test('Review Assignment and Requests use the verified existing Distributor request route', () => {
  const dashboard = read('app/distributor/d_dashboard.jsx');
  const requests = read('app/distributor/d_requests.jsx');
  assert.match(dashboard, /\['pending', 'distributor assigned'\][\s\S]*replaceOnce\('\/distributor\/d_requests'\)/);
  assert.doesNotMatch(dashboard, /\/distributor\/(?:assignment|review|ballot)(?:['"/?]|$)/);
  assert.match(requests, /export default function DistributorRequests\(\) \{\s*const \{ colors \} = useBlueTapTheme\(\);/);
  assert.match(requests, /placeholderTextColor=\{colors\.textSecondary\}/);
});

test('floating chat and station chat remain overlay actions without route navigation', () => {
  const launcher = read('components/chat/ChatFloatingLauncher.jsx');
  const list = read('components/chat/ChatConversationList.jsx');
  assert.doesNotMatch(launcher, /useRouter|router\.(?:push|replace)/);
  assert.match(launcher, /onPress=\{openChat\}/);
  assert.match(list, /resolveIntent: \{ type: 'distributor_branch' \}/);
  assert.match(list, /resolveAndOpen\(row\.resolveIntent\)/);
  assert.doesNotMatch(list, /router\.(?:push|replace)/);
});

test('Distributor refresh waits for auth and authoritative branch profile before order listeners', () => {
  const orders = read('services/distributorOrders.js');
  const profile = read('services/distributorProfile.js');
  assert.match(orders, /useProtectedReadSession\('distributor'\)/);
  assert.match(orders, /session.readiness !== 'READY'/);
  assert.match(profile, /let unsubscribeProfile = null;[\s\S]*onAuthStateChanged/);
  assert.match(orders, /readiness !== 'READY'[\s\S]*profile\?\.branchId[\s\S]*listenForDistributorOrders[\s\S]*hydrateDistributorOrders/);
  assert.doesNotMatch(orders, /profile\?\.branchId \|\| profile\?\.assignedBranchId/);
});

test('critical order-card action rows wrap and the Distributor carousel is viewport bounded', () => {
  const distributorDashboard = read('app/distributor/d_dashboard.jsx');
  const distributorRequests = read('app/distributor/d_requests.jsx');
  const requesterDashboard = read('app/requester/r_dashboard.jsx');
  const requesterRequests = read('app/requester/r_request.jsx');
  const chatActions = read('components/chat/ChatOrderActions.jsx');
  assert.match(distributorDashboard, /currentRequestViewportWidth = Math\.max/);
  assert.match(distributorDashboard, /currentRequestPeek = activeRequestEntries\.length > 1/);
  assert.match(distributorDashboard, /resolveDragTargetIndex/);
  assert.match(distributorDashboard, /cardActionsRow:[\s\S]{0,100}flexWrap: 'wrap'/);
  assert.match(distributorRequests, /cardActionsRow:[\s\S]{0,100}flexWrap: 'wrap'/);
  assert.match(requesterDashboard, /cardActionsRow:[\s\S]{0,100}flexWrap: 'wrap'/);
  assert.match(requesterRequests, /cardActionsRow:[\s\S]{0,100}flexWrap: 'wrap'/);
  assert.match(chatActions, /flexBasis: 124/);
});

test('single-flight navigation suppresses rapid repeats, ignores current route, and unlocks on settle', () => {
  const timers = [];
  const navigation = createSingleFlightNavigation({
    schedule: (callback) => { timers.push(callback); return callback; },
    cancel: () => {},
  });
  const calls = [];
  for (let index = 0; index < 10; index += 1) {
    navigation.navigate({ currentPath: '/requester/r_dashboard', target: '/requester/r_notification', action: (target) => calls.push(target) });
  }
  assert.deepEqual(calls, ['/requester/r_notification']);
  assert.equal(navigation.settle('/requester/r_notification'), true);
  assert.equal(navigation.navigate({ currentPath: '/requester/r_notification', target: '/requester/r_notification', action: () => calls.push('same') }), false);
  assert.equal(navigation.navigate({ currentPath: '/requester/r_notification', target: '/requester/r_profile', action: (target) => calls.push(target) }), true);
  assert.deepEqual(calls, ['/requester/r_notification', '/requester/r_profile']);
  navigation.dispose();
});

test('navigation guard is shared by bells, bottom navigation, Assistant entries, shells, and animated Back', () => {
  const sources = [
    read('components/BlueTapHeader.jsx'),
    read('components/AppBottomNav.jsx'),
    read('components/AdminShell.jsx'),
    read('components/ManagerShell.jsx'),
    read('app/requester/r_profile.jsx'),
    read('app/distributor/d_profile.jsx'),
    read('components/assistant/AssistantScreen.jsx'),
  ];
  sources.forEach((source) => assert.match(source, /useSingleFlightNavigation/));
  const notificationMotion = read('components/useNotificationPageMotion.js');
  assert.match(notificationMotion, /createSingleFlightLock/);
  assert.match(notificationMotion, /notification-back/);
});

test('rapid Assistant entry executes once and current bottom-nav tab executes zero times', () => {
  const assistant = createSingleFlightNavigation({ schedule: () => 1, cancel: () => {} });
  let assistantCalls = 0;
  for (let index = 0; index < 10; index += 1) {
    assistant.navigate({
      currentPath: '/requester/r_profile',
      target: '/requester/bluetap_AI',
      action: () => { assistantCalls += 1; },
    });
  }
  assert.equal(assistantCalls, 1);

  const bottomNav = createSingleFlightNavigation();
  let bottomNavCalls = 0;
  assert.equal(bottomNav.navigate({
    currentPath: '/requester/r_dashboard',
    target: '/requester/r_dashboard',
    action: () => { bottomNavCalls += 1; },
  }), false);
  assert.equal(bottomNavCalls, 0);
  assistant.dispose();
  bottomNav.dispose();
});

test('rapid animated Back input permits exactly one router back action', () => {
  const lock = createSingleFlightLock({ schedule: () => 1, cancel: () => {} });
  let backCalls = 0;
  for (let index = 0; index < 10; index += 1) {
    if (lock.acquire('notification-back')) backCalls += 1;
  }
  assert.equal(backCalls, 1);
  lock.dispose();
});
