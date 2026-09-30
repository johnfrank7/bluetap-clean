const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

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
  assert.match(dashboard, /\['pending', 'distributor assigned'\][\s\S]*router\.replace\('\/distributor\/d_requests'\)/);
  assert.doesNotMatch(dashboard, /\/distributor\/(?:assignment|review|ballot)(?:['"/?]|$)/);
  assert.match(requests, /export default function DistributorRequests\(\) \{\s*const \{ colors \} = useBlueTapTheme\(\);/);
  assert.match(requests, /placeholderTextColor=\{colors\.textSecondary\}/);
});

test('floating chat and station chat remain overlay actions without route navigation', () => {
  const launcher = read('components/chat/ChatFloatingLauncher.jsx');
  const list = read('components/chat/ChatConversationList.jsx');
  assert.doesNotMatch(launcher, /useRouter|router\.(?:push|replace)/);
  assert.match(launcher, /onPress=\{openChat\}/);
  assert.match(list, /resolveAndOpen\(\{ type: 'distributor_branch' \}\)/);
  assert.doesNotMatch(list, /router\.(?:push|replace)/);
});

test('Distributor refresh waits for auth and authoritative branch profile before order listeners', () => {
  const orders = read('services/distributorOrders.js');
  const profile = read('services/distributorProfile.js');
  assert.match(orders, /let unsubscribeOrders = null;[\s\S]*onAuthStateChanged/);
  assert.match(profile, /let unsubscribeProfile = null;[\s\S]*onAuthStateChanged/);
  assert.match(orders, /if \(loading\) return;[\s\S]*profile\?\.branchId[\s\S]*listenForDistributorOrders[\s\S]*hydrateDistributorOrders/);
  assert.doesNotMatch(orders, /profile\?\.branchId \|\| profile\?\.assignedBranchId/);
});

test('critical order-card action rows wrap and the Distributor carousel is viewport bounded', () => {
  const distributorDashboard = read('app/distributor/d_dashboard.jsx');
  const distributorRequests = read('app/distributor/d_requests.jsx');
  const requesterDashboard = read('app/requester/r_dashboard.jsx');
  const requesterRequests = read('app/requester/r_request.jsx');
  const chatActions = read('components/chat/ChatOrderActions.jsx');
  assert.match(distributorDashboard, /currentRequestCardWidth = Math\.min\(300/);
  assert.match(distributorDashboard, /cardActionsRow:[\s\S]{0,100}flexWrap: 'wrap'/);
  assert.match(distributorRequests, /cardActionsRow:[\s\S]{0,100}flexWrap: 'wrap'/);
  assert.match(requesterDashboard, /cardActionsRow:[\s\S]{0,100}flexWrap: 'wrap'/);
  assert.match(requesterRequests, /cardActionsRow:[\s\S]{0,100}flexWrap: 'wrap'/);
  assert.match(chatActions, /flexBasis: 124/);
});
