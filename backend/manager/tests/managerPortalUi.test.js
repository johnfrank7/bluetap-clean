const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const requests = read('app/manager/request.jsx');
const managerDashboard = read('app/manager/dashboard.jsx');
const distributors = read('app/manager/distributors.jsx');
const notifications = read('app/manager/notifications.jsx');
const notificationModal = read('components/ManagerNotificationDetailsModal.jsx');
const managerShell = read('components/ManagerShell.jsx');
const managerRealtime = read('components/ManagerRealtimeData.jsx');
const managerProfile = read('app/manager/profile.jsx');
const managerProducts = read('app/manager/products.jsx');
const managerAnalytics = read('app/manager/analytics.jsx');
const emptyState = read('components/BlueTapEmptyState.jsx');
const notificationHook = read('components/ManagerNotifications.jsx');
const managerLayout = read('app/manager/_layout.jsx');
const notificationCard = read('components/NotificationCard.jsx');
const rules = read('firestore.rules');
const {
  clearManagerNotificationOrigin,
  consumeManagerNotificationOrigin,
  recordManagerNotificationOrigin,
  resolveManagerNotificationBack,
  sanitizeManagerOrigin,
} = require('../../../services/managerNotificationNavigation');

test('Manager operational queues use shared BlueTap visual empty states with contextual copy', () => {
  assert.match(requests, /BlueTapEmptyState/);
  for (const title of ['No Orders Awaiting Review', 'No Delivery Exceptions', 'No Active Branch Orders', 'No Transfer Requests', 'No Transfer Updates']) {
    assert.match(requests, new RegExp(title));
  }
  assert.match(distributors, /BlueTapEmptyState/);
  for (const title of ['No Orders Awaiting Assignment', 'No Registered Distributors', 'No Pending Applications']) {
    assert.match(distributors, new RegExp(title));
  }
  for (const variant of ['orders', 'exceptions', 'management', 'coordination']) {
    assert.match(requests, new RegExp(`variant="${variant}"`));
  }
  for (const variant of ['dispatch', 'people', 'applications']) {
    assert.match(distributors, new RegExp(`variant="${variant}"`));
  }
  assert.match(emptyState, /variant = 'default'/);
  assert.match(emptyState, /ASSET_VARIANTS/);
  assert.match(emptyState, /BlueTapIcon/);
});

test('Manager Profile uses the persistent shared profile and branch cache with scoped retry errors', () => {
  assert.match(managerRealtime, /useProtectedReadSession\('manager'\)/);
  assert.match(managerRealtime, /profile: session.profile/);
  assert.match(managerRealtime, /const cached = stateRef\.current/);
  assert.match(managerRealtime, /primeProfile/);
  assert.match(managerProfile, /const manager = realtime\.profile/);
  assert.match(managerProfile, /realtime\.errors\?\.branch \|\| realtime\.errors\?\.profile/);
  assert.doesNotMatch(managerProfile, /users\.find/);
  assert.doesNotMatch(managerProfile, /workspaceManager/);
  assert.doesNotMatch(managerProfile, /session\?\.uid[^\n]*UID|managerUid = session\?\.uid/);
});

test('Manager Profile exposes only personal edits and canonical public UID display', () => {
  assert.match(managerProfile, /getProfileUniqueId\(manager \|\| \{\}\)/);
  assert.match(managerProfile, /updateManagerProfile\(\{ fullName, phone, address \}, selectedImage\)/);
  assert.match(managerProfile, /normalizePhilippinePhone/);
  assert.match(managerProfile, /TopToastFeedback/);
  for (const label of ['UID', 'Full Name', 'Contact Number', 'Email Address', 'Complete Address / Location', 'Branch', 'Access Level']) {
    assert.match(managerProfile, new RegExp(label));
  }
});

test('Manager notification control reuses the canonical BlueTap bell contract and keeps its live badge', () => {
  assert.match(managerShell, /BlueTapIcon name="notifications"/);
  assert.match(managerShell, /colors\.iconInteractive/);
  assert.match(managerShell, /unreadCount/);
  assert.match(managerShell, /notificationCount/);
  assert.doesNotMatch(managerShell, /AdminIcon name="bell"/);
  assert.match(managerLayout, /ManagerNotificationsProvider/);
  assert.match(notificationHook, /ManagerNotificationsContext\.Provider/);
  assert.match(managerShell, /navigateOnce\('\/manager\/notifications'\)/);
  assert.match(managerShell, /recordManagerNotificationOrigin\(pathname\)/);
});

test('Manager notification Back returns to a recorded Manager origin and safely falls back to dashboard', () => {
  recordManagerNotificationOrigin('/manager/distributors');
  const origin = consumeManagerNotificationOrigin();
  assert.equal(origin, '/manager/distributors');
  assert.deepEqual(resolveManagerNotificationBack({ canGoBack: true, origin }), {
    method: 'back',
    target: '/manager/distributors',
  });
  assert.deepEqual(resolveManagerNotificationBack({ canGoBack: true, origin: '/login' }), {
    method: 'replace',
    target: '/manager/dashboard',
  });
  assert.equal(sanitizeManagerOrigin('/manager/notifications'), '');
  recordManagerNotificationOrigin('/manager/request');
  clearManagerNotificationOrigin();
  assert.equal(consumeManagerNotificationOrigin(), '');
  assert.match(notifications, /consumeManagerNotificationOrigin/);
  assert.match(notifications, /router\.canGoBack/);
  assert.match(notifications, /replaceOnce\(destination\.target\)/);
});

test('notification cards navigate to authorized order context with a read-only fallback for non-order events', () => {
  assert.match(notifications, /NotificationCard/);
  assert.match(notifications, /dark=\{resolvedTheme === 'dark'\}/);
  assert.match(notifications, /time=\{formatNotificationTime\(event\.at\)\}/);
  assert.match(notifications, /metadata=\{`Order #\$\{event\.requestId\}/);
  assert.match(notifications, /maxWidth: 760/);
  assert.match(notificationCard, /backgroundColor: colors\.surface/);
  assert.match(notificationCard, /borderColor: colors\.border/);
  assert.match(notificationCard, /color: colors\.textPrimary \|\| colors\.text/);
  assert.match(notificationCard, /marginLeft: 'auto'/);
  assert.match(notifications, /navigateOnce\(\{ pathname: '\/manager\/request', params: \{ orderId: event\.orderId \} \}\)/);
  assert.match(notifications, /setSelectedEventId\(event\.id\)/);
  assert.match(notifications, /events\.find/);
  assert.match(notifications, /ManagerNotificationDetailsModal/);
  assert.match(notifications, /style=\{styles\.backRow\}/);
  assert.doesNotMatch(notifications, /headerAction=/);
  for (const label of ['Order ID', 'Requester UID', 'Delivery address', 'Distributor UID', 'Delivery fee', 'Event time', 'Products']) {
    assert.match(notificationModal, new RegExp(label));
  }
  assert.doesNotMatch(notificationModal, /dispatchManagerOrder|onEdit|onCancel|Accept Transfer|Reject Order|Assign Distributor|Schedule Delivery/);
});

test('Requests and Exceptions expose responsive branch-authorized detail maps without raw Firebase UIDs', () => {
  for (const label of ['View Details', 'Request Information', 'Requester public ID', 'Container type', 'Distance / radius', 'Schedule', 'Approval reason', 'Delivery Location Map']) {
    assert.match(requests, new RegExp(label));
  }
  assert.match(requests, /<LocationMap/);
  assert.match(requests, /Location unavailable/);
  assert.match(requests, /useLocalSearchParams/);
  assert.match(requests, /authorizedSource/);
  assert.match(requests, /branchId === String\(realtime\.branchId\)/);
  assert.doesNotMatch(requests, /Firebase UID|requesterUid/);
  assert.match(requests, /notificationTargetCard/);
  assert.match(requests, /contentScrollRef\.current\?\.scrollTo/);
  assert.match(requests, /setTargetHighlighted\(false\), 6000/);
  assert.match(requests, /width < 430 \? '100%' : 118/);
});

test('Manager responsive surfaces stack actions and preserve wide tables with horizontal scrolling', () => {
  assert.match(requests, /actionButton/);
  assert.match(requests, /flexDirection: width < 430 \? 'column' : 'row'/);
  assert.match(managerDashboard, /<ScrollView horizontal/);
  assert.match(managerDashboard, /table: \{ minWidth: 900/);
  assert.match(managerProducts, /const compact = useWindowDimensions\(\)\.width < 760/);
  assert.match(distributors, /<ScrollView horizontal/);
  assert.match(distributors, /flexDirection: width < 600 \? 'column' : 'row'/);
  assert.match(distributors, /width: width < 550 \? '100%' : undefined/);
  assert.match(distributors, /tableViewport: \{ width: '100%', maxWidth: '100%', minWidth: 0 \}/);
});

test('notification errors are sanitized and raw Firestore permission text is never rendered', () => {
  assert.match(notificationHook, /Notifications could not be loaded\./);
  assert.match(notifications, /Notifications could not be loaded\./);
  assert.doesNotMatch(notifications, /Missing or insufficient permissions|error\.message/);
  assert.doesNotMatch(managerRealtime, /listenerErrors\[key\] = error\.message/);
});

test('Manager notification listeners and rules remain strictly branch scoped', () => {
  assert.match(managerRealtime, /where\('branchId', '==', branchId\)/);
  assert.match(managerRealtime, /where\('transferToBranchId', '==', branchId\)/);
  assert.match(managerRealtime, /where\('sourceBranchId', '==', branchId\)/);
  assert.match(rules, /allow get, list: if isManagerBranch\(resource\.data\.sourceBranchId\);/);
  assert.doesNotMatch(rules, /match \/managerOperationalEvents\/\{eventId\}[\s\S]*allow read: if isManager\(\);/);
});

test('Manager Products separates read-only catalog data, pricing, and branch-scoped delivery rules', () => {
  for (const label of ['DELIVERY PRICING', 'BRANCH DELIVERY RULES', 'Base delivery fee', 'Outside-radius fee', 'Order limit']) {
    assert.match(managerProducts, new RegExp(label, 'i'));
  }
  assert.match(managerProducts, /updateManagerProductPolicy/);
  assert.doesNotMatch(managerProducts, /createAdminProduct|updateAdminProduct|Choose image/);
});

test('Manager Analytics uses only shared branch realtime data and contains no demo station series', () => {
  assert.match(managerAnalytics, /useManagerRealtimeData/);
  assert.match(managerAnalytics, /Snapshot revenue/);
  assert.match(managerAnalytics, /Order status distribution/);
  assert.doesNotMatch(managerAnalytics, /Station A|Station B|Aquabea|DEFAULT_STATIONS/);
});

test('Manager dispatch uses a compact valid-date selector rather than a long date-pill row', () => {
  assert.match(distributors, /accessibilityRole="combobox"/);
  assert.match(distributors, /allowedDayOffsets/);
  assert.match(distributors, /Today/);
  assert.match(distributors, /Tomorrow/);
});
