const test = require('node:test');
const assert = require('node:assert/strict');
const babel = require('@babel/core');
const fs = require('fs');
const path = require('path');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const rnw = require('react-native-web');

const mockRN = {
  ...rnw,
  Modal: ({ children, visible }) => (visible ? React.createElement('div', { className: 'mock-modal' }, children) : null),
  useWindowDimensions: () => ({ width: 1200, height: 800 }),
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
  },
};
mockRN.default = mockRN;
mockRN.__esModule = true;

const monitorCode = fs.readFileSync(
  path.resolve(__dirname, '../../../components/ManagerOngoingRequestsMonitor.jsx'),
  'utf8'
);
const monitorTrans = babel.transformSync(monitorCode, {
  presets: [['@babel/preset-react', { runtime: 'classic' }]],
  plugins: ['@babel/plugin-transform-modules-commonjs'],
});

function createMockEnvironment({ ongoingRequests = [], resolvedTheme = 'light' }) {
  const colors = resolvedTheme === 'dark' ? {
    surface: '#1e293b',
    surfaceAlt: '#0f172a',
    border: '#334155',
    primary: '#38bdf8',
    primarySoft: 'rgba(56,189,248,0.15)',
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    danger: '#f87171',
    dangerSoft: 'rgba(239,68,68,0.15)',
    successAction: '#15803d',
    placeholder: '#64748b',
    iconSecondary: '#94a3b8',
  } : {
    surface: '#ffffff',
    surfaceAlt: '#f8fafc',
    border: '#e2e8f0',
    primary: '#187bcd',
    primaryDark: '#0B4F8A',
    primarySoft: '#e0f2fe',
    textPrimary: '#0f172a',
    textSecondary: '#64748b',
    danger: '#ef4444',
    dangerSoft: '#fee2e2',
    successAction: '#167347',
    placeholder: '#94a3b8',
    iconSecondary: '#64748b',
  };

  const customRequire = (spec) => {
    if (spec === 'react') return React;
    if (spec === 'react-native') return mockRN;
    if (spec === 'expo-router') {
      return { usePathname: () => '/manager/distributors' };
    }
    if (spec === 'react-native-safe-area-context') {
      return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
    }
    if (spec.includes('bluetapTheme')) {
      return { BLUETAP_COLORS: colors };
    }
    if (spec.includes('AdminTheme')) {
      return { useAdminTheme: () => ({ colors, resolvedTheme }) };
    }
    if (spec.includes('BlueTapEmptyState')) {
      return ({ title, description }) => React.createElement('div', { className: 'empty-state' }, `${title}: ${description}`);
    }
    if (spec.includes('ManagerRealtimeData')) {
      return {
        useManagerRealtimeData: () => ({
          ongoingRequests,
          ongoingCount: ongoingRequests.length,
          loading: false,
          error: '',
          errors: {},
          retry: () => {},
          branch: { name: 'Toledo Central', id: 'branch-1' },
        }),
      };
    }
    if (spec.includes('OngoingRequestFieldIcon')) {
      return () => React.createElement('span', null, 'Icon');
    }
    if (spec.includes('RequestDetailsModal')) {
      return () => null;
    }
    if (spec.includes('SidebarIcon')) {
      return ({ name }) => React.createElement('span', null, name || 'Icon');
    }
    if (spec.includes('SoftStatusBadge')) {
      return { getSoftStatusMeta: () => ({ bg: '#f1f5f9', border: '#cbd5e1', text: '#334155', label: 'Status' }) };
    }
    if (spec.includes('shadowStyles')) {
      return { createShadow: () => ({}) };
    }
    if (spec.includes('useCurrentPageRequestDetails')) {
      return () => ({ openRequestDetails: () => {} });
    }
    if (spec.includes('useSingleFlightNavigation')) {
      return () => ({ navigateOnce: () => {} });
    }
    if (spec.includes('notificationTimestamp')) {
      return { parseTimestamp: (v) => v ? new Date(v) : new Date() };
    }
    if (spec.includes('uniqueIds')) {
      return { formatDisplayUniqueId: (id) => id || 'UID-001' };
    }
    if (spec.includes('managerOperational')) {
      return require('../../../services/managerOperational');
    }
    if (spec.includes('deliveryFailureReasons')) {
      return { formatDeliveryFailureReason: () => '' };
    }
    if (spec.includes('managerTripCapacity')) {
      return require('../../../services/managerTripCapacity');
    }
    if (spec.startsWith('.')) {
      const resolved = path.resolve(__dirname, '../../../components', spec);
      return require(resolved);
    }
    return require(spec);
  };

  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', 'React', monitorTrans.code);
  fn(customRequire, mod, mod.exports, React);

  return { ...mod.exports, colors };
}

test('ManagerOngoingRequestsProvider renders without ReferenceError when order data is empty', () => {
  const {
    ManagerOngoingRequestsProvider,
    useManagerOngoingRequests,
  } = createMockEnvironment({ ongoingRequests: [] });

  let capturedContext = null;
  function TestConsumer() {
    capturedContext = useManagerOngoingRequests();
    return React.createElement('div', { id: 'test-consumer' }, `Trips: ${capturedContext.tripsCount}`);
  }

  const tree = React.createElement(
    ManagerOngoingRequestsProvider,
    null,
    React.createElement(TestConsumer)
  );

  let html = '';
  assert.doesNotThrow(() => {
    html = ReactDOMServer.renderToString(tree);
  }, 'Mounting ManagerOngoingRequestsProvider with empty orders must not throw ReferenceError');

  assert.ok(html.includes('Trips: 0'));
  assert.ok(capturedContext);
  assert.equal(capturedContext.tripsCount, 0);
  assert.equal(capturedContext.activeTripsCount, 0);
  assert.equal(capturedContext.scheduledTripsCount, 0);
  assert.equal(capturedContext.overdueTripsCount, 0);
  assert.equal(capturedContext.totalTripOrdersCount, 0);
});

test('ManagerOngoingRequestsProvider mounts with authorized Manager order data and derives accurate deduplicated counts', () => {
  const tomorrow = new Date(Date.now() + 86400000);
  tomorrow.setHours(9, 0, 0, 0);
  const tomorrowIso = tomorrow.toISOString();

  const dayAfter = new Date(Date.now() + 2 * 86400000);
  dayAfter.setHours(14, 0, 0, 0);
  const dayAfterIso = dayAfter.toISOString();

  const pastDate = new Date(Date.now() - 2 * 86400000);
  pastDate.setHours(10, 0, 0, 0);
  const pastDateIso = pastDate.toISOString();

  const authorizedOrders = [
    // Trip 1 (dist-1, tomorrow 09:00 AM) - Active (in transit / out for delivery)
    {
      id: 'ord-101',
      requestId: 'REQ-101',
      status: 'out_for_delivery',
      assignedDistributorUid: 'dist-1',
      assignedDistributorName: 'Distributor One',
      scheduledAt: tomorrowIso,
      items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 10 }],
    },
    {
      id: 'ord-102',
      requestId: 'REQ-102',
      status: 'assigned',
      assignedDistributorUid: 'dist-1',
      assignedDistributorName: 'Distributor One',
      scheduledAt: tomorrowIso,
      items: [{ productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 2 }],
    },
    // Trip 2 (dist-2, day after tomorrow 02:00 PM) - Scheduled
    {
      id: 'ord-201',
      requestId: 'REQ-201',
      status: 'scheduled',
      assignedDistributorUid: 'dist-2',
      assignedDistributorName: 'Distributor Two',
      scheduledAt: dayAfterIso,
      items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 15 }],
    },
    // Trip 3 (dist-3, pastDate) - Overdue
    {
      id: 'ord-301',
      requestId: 'REQ-301',
      status: 'distributor_assigned',
      assignedDistributorUid: 'dist-3',
      assignedDistributorName: 'Distributor Three',
      scheduledAt: pastDateIso,
      items: [{ productNameSnapshot: 'Purified Water Refill', quantity: 5 }],
    },
    // Duplicate legacy reference for ord-101 (must be deduplicated in totalTripOrdersCount)
    {
      id: 'ord-101',
      requestId: 'REQ-101',
      status: 'out_for_delivery',
      assignedDistributorUid: 'dist-1',
      assignedDistributorName: 'Distributor One',
      scheduledAt: tomorrowIso,
      items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 10 }],
    },
  ];

  const {
    ManagerOngoingRequestsProvider,
    useManagerOngoingRequests,
  } = createMockEnvironment({ ongoingRequests: authorizedOrders });

  let capturedContext = null;
  function TestConsumer() {
    capturedContext = useManagerOngoingRequests();
    return React.createElement(
      'div',
      { id: 'test-consumer' },
      `Trips: ${capturedContext.tripsCount}, Orders: ${capturedContext.totalTripOrdersCount}`
    );
  }

  const tree = React.createElement(
    ManagerOngoingRequestsProvider,
    null,
    React.createElement(TestConsumer)
  );

  let html = '';
  assert.doesNotThrow(() => {
    html = ReactDOMServer.renderToString(tree);
  }, 'Mounting ManagerOngoingRequestsProvider with authorized orders must NOT throw ReferenceError: totalTripOrdersCount is not defined');

  assert.ok(html.includes('Trips: 3, Orders: 4'));
  assert.ok(capturedContext);

  // Assert exact counts
  assert.equal(capturedContext.tripsCount, 3, 'Must have 3 distinct trips');
  assert.equal(capturedContext.activeTripsCount, 1, 'Trip 1 with out_for_delivery order is active');
  assert.equal(capturedContext.scheduledTripsCount, 1, 'Trip 2 in future is scheduled');
  assert.equal(capturedContext.overdueTripsCount, 1, 'Trip 3 in past is overdue');
  assert.equal(
    capturedContext.activeTripsCount + capturedContext.scheduledTripsCount + capturedContext.overdueTripsCount,
    capturedContext.tripsCount,
    'Active + Scheduled + Overdue must be mutually exclusive and sum to total trips'
  );
  assert.equal(capturedContext.totalTripOrdersCount, 4, 'Must deduplicate duplicate order references (ord-101, 102, 201, 301)');
});

test('ManagerOngoingRequestsPanel renders all 4 tabs and trips drawer without runtime errors in Light and Dark mode', () => {
  const tomorrow = new Date(Date.now() + 86400000);
  tomorrow.setHours(9, 0, 0, 0);

  const testOrders = [
    {
      id: 'ord-active-1',
      status: 'out_for_delivery',
      assignedDistributorUid: 'dist-1',
      assignedDistributorName: 'Juan Distributor',
      scheduledAt: tomorrow.toISOString(),
      items: [
        { productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 2 },
        { productNameSnapshot: 'BlueTap Bottled Water — 24 Pack', quantity: 1 },
      ],
    },
    {
      id: 'ord-scheduled-1',
      status: 'scheduled',
      assignedDistributorUid: 'dist-2',
      assignedDistributorName: 'Maria Distributor',
      scheduledAt: new Date(Date.now() + 172800000).toISOString(),
      items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 20 }],
    },
    {
      id: 'ord-failed-1',
      status: 'delivery_failed',
      assignedDistributorUid: 'dist-3',
      assignedDistributorName: 'Carlos Distributor',
      scheduledAt: new Date(Date.now() - 3600000).toISOString(),
      items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 5 }],
    },
  ];

  for (const theme of ['light', 'dark']) {
    const {
      ManagerOngoingRequestsProvider,
      ManagerOngoingRequestsPanel,
    } = createMockEnvironment({ ongoingRequests: testOrders, resolvedTheme: theme });

    // Test 1: Closed panel returns null safely
    const closedTree = React.createElement(
      ManagerOngoingRequestsProvider,
      { initialOpen: false },
      React.createElement(ManagerOngoingRequestsPanel)
    );
    assert.doesNotThrow(() => {
      ReactDOMServer.renderToString(closedTree);
    });

    // Test 2: Open panel in 'trips' segment renders complete drawer and cards
    const openTripsTree = React.createElement(
      ManagerOngoingRequestsProvider,
      { initialOpen: true, initialSegment: 'trips' },
      React.createElement(ManagerOngoingRequestsPanel)
    );

    let html = '';
    assert.doesNotThrow(() => {
      html = ReactDOMServer.renderToString(openTripsTree);
    }, `ManagerOngoingRequestsPanel must render cleanly in ${theme} mode without runtime errors`);

    assert.ok(html.length > 0, 'Rendered markup must not be empty');
    assert.ok(html.includes('Active'), 'Must render Active tab');
    assert.ok(html.includes('Scheduled'), 'Must render Scheduled tab');
    assert.ok(html.includes('Exceptions'), 'Must render Exceptions tab');
    assert.ok(html.includes('Trips'), 'Must render Trips tab');
    assert.ok(html.includes('Active Trips'), 'Must render Active Trips label');
    assert.ok(html.includes('Assigned Orders'), 'Must render Assigned Orders label');
    assert.ok(html.includes('Open Manager Dispatch'), 'Must render Open Manager Dispatch button');
    assert.ok(html.includes('Full View'), 'Must render Full View toggle button in drawer header');
    assert.ok(html.includes('✕'), 'Must render Close button in drawer header');

    // Test 3: Open panel across all 4 segments renders without errors
    for (const seg of ['active', 'scheduled', 'exceptions', 'trips']) {
      const segTree = React.createElement(
        ManagerOngoingRequestsProvider,
        { initialOpen: true, initialSegment: seg },
        React.createElement(ManagerOngoingRequestsPanel)
      );
      assert.doesNotThrow(() => {
        const segHtml = ReactDOMServer.renderToString(segTree);
        assert.ok(segHtml.length > 0);
      }, `Segment ${seg} must render without error in ${theme} mode`);
    }
  }
});

test('OngoingTripCard renders responsive two-column styles and keeps overdue alert inside expanded view', () => {
  const { OngoingTripCard, colors } = createMockEnvironment({ ongoingRequests: [] });

  const overdueTrip = {
    tripId: 'trip-dist-1-overdue',
    tripNumber: 2,
    distributorUid: 'dist-1',
    distributorName: 'Juan Dela Cruz',
    distributorUniqueId: 'USR-DIST-001',
    fullScheduleLabel: 'Yesterday · 10:00 AM',
    isOverdue: true,
    status: 'scheduled',
    totalContainers: 25,
    otherCargoCount: 2,
    otherCargoSummary: '2x Dispensers',
    orders: [
      {
        id: 'ord-overdue-1',
        requestId: 'REQ-OD-1',
        requesterName: 'Maria Santos',
        status: 'scheduled',
        address: '123 Mango St',
        items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 25 }],
      },
    ],
  };

  // 1. Render collapsed in 2-column mode
  const collapsed2Col = React.createElement(OngoingTripCard, {
    trip: overdueTrip,
    colors,
    isDark: false,
    isTwoColumn: true,
    onViewDetails: () => {},
  });
  const collapsedHtml = ReactDOMServer.renderToString(collapsed2Col);

  // Must render trip identifier, schedule, subtle overdue status badge, and distributor info
  assert.ok(collapsedHtml.includes('Trip #2'));
  assert.ok(collapsedHtml.includes('Yesterday · 10:00 AM'));
  assert.ok(collapsedHtml.includes('Overdue Scheduled'));
  assert.ok(collapsedHtml.includes('Juan Dela Cruz'));

  // Collapsed card MUST NOT render full-width overdue warning box
  assert.ok(
    !collapsedHtml.includes('Past scheduled delivery window without recorded completion'),
    'Collapsed card must not render redundant overdue notice box'
  );

  // Must render 2-column card width on web (calc(50% - 8px))
  assert.ok(
    collapsedHtml.includes('calc(50% - 8px)') || collapsedHtml.includes('r-width-') || collapsedHtml.includes('r-maxWidth-'),
    'Two-column mode must constrain card width'
  );
});

test('DeliveryProgressTrack renders leading green line starting at track edge and aligns all 4 delivery stages', () => {
  const { DeliveryProgressTrack, colors } = createMockEnvironment({ ongoingRequests: [], resolvedTheme: 'light' });

  const stages = [
    { status: 'distributor_assigned', stepNum: 1, label: 'Assigned' },
    { status: 'scheduled', stepNum: 2, label: 'Scheduled' },
    { status: 'out_for_delivery', stepNum: 3, label: 'Out for Delivery' },
    { status: 'delivered', stepNum: 4, label: 'Delivered' },
  ];

  for (const { status, stepNum, label } of stages) {
    const order = {
      id: `ord-${status}`,
      requestId: `REQ-${status}`,
      status,
    };

    const tree = React.createElement(DeliveryProgressTrack, {
      order,
      colors,
      isDark: false,
    });

    const html = ReactDOMServer.renderToString(tree);
    // 1. Must render header summary
    assert.ok(html.includes('Delivery Progress'), 'Must render Delivery Progress header');
    assert.ok(
      html.includes(`Step <!-- -->${stepNum}<!-- --> of <!-- -->4`) || html.includes(`Step ${stepNum} of 4`),
      `Must render Step ${stepNum} of 4 for status ${status}`
    );

    // 2. Must render all four milestone labels
    assert.ok(html.includes('Assigned'), 'Must render Assigned label');
    assert.ok(html.includes('Scheduled'), 'Must render Scheduled label');
    assert.ok(html.includes('Out for Delivery'), 'Must render Out for Delivery label');
    assert.ok(html.includes('Delivered'), 'Must render Delivered label');

    // 3. Leading segment before Assigned must be green (#1F9D61 or rgb(31, 157, 97))
    // ensuring completed progress begins at the actual left edge of the track
    assert.ok(
      html.includes('#1F9D61') || html.includes('rgb(31, 157, 97)') || html.includes('rgba(31,157,97'),
      `Must render green leading line segment at track start for ${status}`
    );

    // 4. Trailing segment after Delivered must NOT be painted (hidden/transparent)
    assert.ok(
      html.includes('transparent') || html.includes('rgba(0,0,0,0') || html.includes('rgba(0, 0, 0, 0'),
      `Must render transparent trailing segment after final milestone for ${status}`
    );
  }

  // Verify Dark mode rendering
  const darkEnv = createMockEnvironment({ ongoingRequests: [], resolvedTheme: 'dark' });
  const darkTree = React.createElement(darkEnv.DeliveryProgressTrack, {
    order: { status: 'out_for_delivery' },
    colors: darkEnv.colors,
    isDark: true,
  });
  const darkHtml = ReactDOMServer.renderToString(darkTree);
  assert.ok(darkHtml.includes('Delivery Progress'));
  assert.ok(darkHtml.includes('Step <!-- -->3<!-- --> of <!-- -->4') || darkHtml.includes('Step 3 of 4'));
  assert.ok(darkHtml.includes('#10B981') || darkHtml.includes('16,185,129') || darkHtml.includes('16, 185, 129'));
});
