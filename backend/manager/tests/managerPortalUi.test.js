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
const accounts = read('app/manager/accounts.jsx');
const emptyState = read('components/BlueTapEmptyState.jsx');
const notificationHook = read('components/ManagerNotifications.jsx');
const managerLayout = read('app/manager/_layout.jsx');
const notificationCard = read('components/NotificationCard.jsx');
const rules = read('firestore.rules');
const globalCss = read('global.css');
const {
  clearManagerNotificationOrigin,
  consumeManagerNotificationOrigin,
  recordManagerNotificationOrigin,
  resolveManagerNotificationBack,
  sanitizeManagerOrigin,
} = require('../../../services/managerNotificationNavigation');

test('Manager operational queues use shared BlueTap visual empty states with contextual copy', () => {
  assert.match(requests, /BlueTapEmptyState/);
  for (const pattern of [
    /(?:All caught up!|No Orders Awaiting Review)/i,
    /(?:No approvals pending|No Delivery Exceptions)/i,
    /(?:No active branch orders|No Active Branch Orders)/i,
    /(?:No transfer requests|No Transfer Requests)/i,
    /(?:No transfer updates|No Transfer Updates)/i,
  ]) {
    assert.match(requests, pattern);
  }
  assert.match(distributors, /BlueTapEmptyState/);
  for (const title of ['No Orders Awaiting Assignment', 'No Pending Applications']) {
    assert.match(distributors, new RegExp(title));
  }
  assert.match(accounts, /No Registered Distributors/);
  for (const variant of ['orders', 'exceptions', 'management', 'coordination']) {
    assert.match(requests, new RegExp(`variant="${variant}"`));
  }
  for (const variant of ['dispatch', 'applications']) {
    assert.match(distributors, new RegExp(`variant="${variant}"`));
  }
  assert.match(accounts, /variant="people"/);
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
  assert.match(requests, /width < 430 \? '48%' : 138/);
});

test('Manager responsive surfaces stack actions and preserve wide tables with horizontal scrolling', () => {
  assert.match(requests, /actionButton/);
  assert.match(requests, /flexDirection: width < 430 \? 'column' : 'row'/);
  assert.match(managerDashboard, /<ScrollView horizontal/);
  assert.match(managerDashboard, /table: \{ minWidth: 900/);
  assert.match(managerProducts, /const compact = useWindowDimensions\(\)\.width < 760/);
  assert.match(accounts, /<ScrollView horizontal/);
  assert.match(distributors, /flexDirection: width < 600 \? 'column' : 'row'/);
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

test('Manager Products delivery pricing edit button remains high contrast and visible across themes and CSS resets', () => {
  assert.match(managerProducts, /accessibilityLabel="Edit branch delivery pricing"/);
  assert.match(managerProducts, /dataSet=\{\{\s*bluetapCta:\s*'true'\s*\}\}/);
  assert.match(managerProducts, /backgroundColor:\s*isDark\s*\?\s*'#1D78C1'\s*:\s*'#0B67AD'/);
  assert.match(managerProducts, /color:\s*'#FFFFFF'/);
  assert.match(globalCss, /button\[aria-label='Edit branch delivery pricing'\]/);
  assert.match(globalCss, /button\[data-bluetap-cta='true'\]/);
});

test('Manager Ongoing Requests floating button is stacked above the chat button exclusively on the Manager portal', () => {
  const chatLauncher = read('components/chat/ChatFloatingLauncher.jsx');
  const ongoingMonitor = read('components/ManagerOngoingRequestsMonitor.jsx');

  assert.match(chatLauncher, /role === 'manager' && \(\s*<ManagerOngoingRequestsButton/);
  assert.match(chatLauncher, /gap:\s*12/);
  const ongoingIndex = chatLauncher.indexOf('<ManagerOngoingRequestsButton');
  const chatButtonIndex = chatLauncher.indexOf('Open BlueTap messages');
  assert.ok(ongoingIndex > -1 && chatButtonIndex > ongoingIndex);

  assert.match(ongoingMonitor, /import \{ createShadow \} from '\.\/shadowStyles';/);
  assert.doesNotMatch(ongoingMonitor, /elevationShadow/);
  assert.match(ongoingMonitor, /<SidebarIcon name="ClipboardList" size=\{24\} tintColor="#FFFFFF" \/>/);
  assert.match(ongoingMonitor, /const showBadge = !hasError && ongoingCount > 0;/);
  assert.match(managerLayout, /<ManagerOngoingRequestsProvider>/);
  assert.match(managerLayout, /<ManagerOngoingRequestsPanel \/>/);
});

test('Ongoing Requests Panel is read-only, responsive, uses single-flight navigateOnce, and integrates with RequestDetailsModal and Requests filter tabs', () => {
  const ongoingMonitor = read('components/ManagerOngoingRequestsMonitor.jsx');

  assert.match(ongoingMonitor, /Ongoing Requests/);
  assert.match(ongoingMonitor, /Monitor active water deliveries\./);
  assert.match(ongoingMonitor, /title="No ongoing requests"/);
  assert.match(ongoingMonitor, /description="Assigned deliveries will appear here once they are in progress\."/);
  assert.match(ongoingMonitor, /Unable to load ongoing requests/);
  assert.match(ongoingMonitor, /View Details/);
  assert.match(ongoingMonitor, /View All Requests/);
  assert.match(ongoingMonitor, /const \{ navigateOnce \} = useSingleFlightNavigation\(\);/);
  assert.match(ongoingMonitor, /navigateOnce\('\/manager\/request\?filter=ongoing'\);/);
  assert.doesNotMatch(ongoingMonitor, /navigation\.push\(/);
  assert.match(ongoingMonitor, /<View style=\{styles\.bodyViewport\}>/);
  assert.match(ongoingMonitor, /paddingBottom:\s*32/);
  assert.match(ongoingMonitor, /styles\.closeIconGlyph/);
  assert.match(ongoingMonitor, /<RequestDetailsModal/);
  assert.match(ongoingMonitor, /const isDesktopDrawer = width >= 720;/);

  // Ensure panel remains strictly read-only without approval, assignment, or delivery mutation calls
  assert.doesNotMatch(
    ongoingMonitor,
    /dispatchManagerOrder|decideOutsideRadiusOrder|approveManagerDistributor|rejectManagerDistributor|markDelivered/
  );

  // Requests page integrates Ongoing, Pending, and Completed tabs using shared queue logic
  assert.match(requests, /Pending \(\$\{tabCounts\.pending\}\)/);
  assert.match(requests, /Ongoing \(\$\{tabCounts\.ongoing\}\)/);
  assert.match(requests, /Completed \(\$\{tabCounts\.completed\}\)/);
  assert.match(requests, /ongoing: queues\.ongoing\.map\(mapOrder\)/);
  assert.match(requests, /pendingOrders: queues\.pendingOrders\.map\(mapOrder\)/);
  assert.match(requests, /completed: queues\.completed\.map\(mapOrder\)/);
});

test('ManagerOngoingRequestsMonitor initializes cleanly against the actual shadowStyles module without runtime errors', () => {
  const babel = require('@babel/core');
  const evalModule = (relPath, customMocks = {}) => {
    const fullPath = resolve(root, relPath);
    const transformed = babel.transformSync(readFileSync(fullPath, 'utf8'), {
      presets: ['babel-preset-expo'],
      filename: fullPath,
    }).code;
    const mod = { exports: {} };
    const fn = new Function('require', 'module', 'exports', transformed);
    fn((id) => {
      if (customMocks[id]) return customMocks[id];
      if (id === 'react') return require('react');
      if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
      if (id === 'react-native') {
        return {
          AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false), addEventListener: () => ({ remove: () => {} }) },
          ActivityIndicator: 'ActivityIndicator',
          Animated: { Value: function Value() {}, timing: () => ({ start: () => {} }), View: 'Animated.View' },
          Easing: { out: (v) => v, cubic: {} },
          Modal: 'Modal',
          Platform: { OS: 'web', select: (obj) => obj.web || obj.default || {} },
          Pressable: 'Pressable',
          ScrollView: 'ScrollView',
          StyleSheet: { create: (s) => s, absoluteFill: {}, hairlineWidth: 1 },
          Text: 'Text',
          TouchableOpacity: 'TouchableOpacity',
          useWindowDimensions: () => ({ width: 1280, height: 800 }),
          View: 'View',
        };
      }
      if (id === 'expo-router') return { usePathname: () => '/manager/dashboard' };
      if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
      if (id === '../constants/bluetapTheme') return { BLUETAP_COLORS: { primary: '#187BCD', primaryDark: '#0D5FA8', danger: '#EF4444', success: '#10B981' } };
      if (id === '../services/managerOperational') return require('../../../services/managerOperational');
      if (id === '../constants/deliveryFailureReasons') return require('../../../constants/deliveryFailureReasons');
      if (!id.startsWith('.')) return require(id);
      return {};
    }, mod, mod.exports);
    return mod.exports;
  };

  const realShadowStyles = evalModule('components/shadowStyles.js');
  assert.equal(typeof realShadowStyles.createShadow, 'function');

  const monitorMod = evalModule('components/ManagerOngoingRequestsMonitor.jsx', {
    './shadowStyles': realShadowStyles,
  });
  assert.equal(typeof monitorMod.ManagerOngoingRequestsProvider, 'function');
  assert.equal(typeof monitorMod.ManagerOngoingRequestsButton, 'function');
  assert.equal(typeof monitorMod.ManagerOngoingRequestsPanel, 'function');
  assert.equal(typeof monitorMod.useManagerOngoingRequests, 'function');
});
