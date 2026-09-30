const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const requests = read('app/manager/request.jsx');
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
const rules = read('firestore.rules');

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
  assert.match(emptyState, /ICON_ASSETS/);
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

test('Manager notification control reuses the canonical BlueTap bell asset and keeps its live badge', () => {
  assert.match(managerShell, /assets\/icons\/notif\.png/);
  assert.match(managerShell, /unreadCount/);
  assert.match(managerShell, /notificationCount/);
  assert.doesNotMatch(managerShell, /AdminIcon name="bell"/);
});

test('notification cards open read-only context details with no operational actions', () => {
  assert.match(notifications, /setSelectedEventId\(event\.id\)/);
  assert.match(notifications, /events\.find/);
  assert.match(notifications, /ManagerNotificationDetailsModal/);
  for (const label of ['Order ID', 'Requester UID', 'Delivery address', 'Distributor UID', 'Delivery fee', 'Event time', 'Products']) {
    assert.match(notificationModal, new RegExp(label));
  }
  assert.doesNotMatch(notificationModal, /dispatchManagerOrder|onEdit|onCancel|Accept Transfer|Reject Order|Assign Distributor|Schedule Delivery/);
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
