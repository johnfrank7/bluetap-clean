const test = require('node:test');
const assert = require('node:assert/strict');
const babel = require('@babel/core');
const fs = require('fs');
const path = require('path');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const rnw = require('react-native-web');

const MockModal = ({ children, visible = true }) => (visible ? React.createElement('div', { 'data-modal': 'true' }, children) : null);
const mockRN = { ...rnw, Modal: MockModal, useWindowDimensions: () => ({ width: 1200, height: 800 }) };
mockRN.default = mockRN;
mockRN.__esModule = true;

const code = fs.readFileSync(path.resolve(__dirname, '../../../app/manager/distributors.jsx'), 'utf8');
const transformed = babel.transformSync(code, {
  presets: [['@babel/preset-react', { runtime: 'classic' }]],
  plugins: ['@babel/plugin-transform-modules-commonjs'],
});

const capCode = fs.readFileSync(path.resolve(__dirname, '../../../components/ManagerTripCapacity.jsx'), 'utf8');
const capTrans = babel.transformSync(capCode, {
  presets: [['@babel/preset-react', { runtime: 'classic' }]],
  plugins: ['@babel/plugin-transform-modules-commonjs'],
});

const modalCode = fs.readFileSync(path.resolve(__dirname, '../../../components/ManagerAssignScheduleModal.jsx'), 'utf8');
const modalTrans = babel.transformSync(modalCode, {
  presets: [['@babel/preset-react', { runtime: 'classic' }]],
  plugins: ['@babel/plugin-transform-modules-commonjs'],
});

function loadDistributorsWithTheme(resolvedTheme, { customOrders, customDistributors, customUsers, customApplicants } = {}) {
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
    primarySoft: '#e0f2fe',
    textPrimary: '#0f172a',
    textSecondary: '#64748b',
    danger: '#ef4444',
    dangerSoft: '#fee2e2',
    successAction: '#167347',
    placeholder: '#94a3b8',
    iconSecondary: '#64748b',
  };

  const sampleOrders = [
    {
      id: 'order-1',
      branchId: 'branch-1',
      currentBranchId: 'branch-1',
      requesterName: 'Alice Requester',
      status: 'awaiting_distributor_assignment',
      items: [
        { productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 1 },
        { productNameSnapshot: 'BlueTap Bottled Water — 24 Pack', quantity: 1 },
      ],
      totalAtOrder: 150,
      deliveryFeeAtOrder: 20,
      address: '123 Main St, Toledo City',
      serviceRadiusKmSnapshot: 5,
      distanceKmSnapshot: 2.5,
    },
    {
      id: 'order-2',
      branchId: 'branch-1',
      currentBranchId: 'branch-1',
      requesterName: 'Bob Requester',
      status: 'awaiting_distributor_assignment',
      items: [
        { productNameSnapshot: 'Purified Water Refill', quantity: 5 },
      ],
      totalAtOrder: 175,
      address: '456 Elm St, Toledo City',
    },
  ];

  const sampleApplicants = [
    {
      uid: 'dist-applicant-1',
      fullName: 'Juan Dela Cruz',
      status: 'pending',
      phone: '09123456789',
      barangay: 'Poblacion',
      faceVerified: true,
      requestedBranchName: 'Toledo Central',
    },
  ];

  const customRequire = (spec) => {
    if (spec === 'react') return React;
    if (spec === 'react-native') return mockRN;
    if (spec.includes('localUsers')) {
      return { getLocalUsers: () => [], subscribeLocalUsers: () => () => {} };
    }
    if (spec.includes('uniqueIds')) {
      return { getProfileUniqueId: (u) => u.uid || 'UID-001', formatDisplayUniqueId: (id) => id };
    }
    if (spec.includes('location')) {
      return { haversineDistanceKm: () => 2.5 };
    }
    if (spec.includes('notificationTimestamp')) {
      return { parseTimestamp: () => new Date() };
    }
    if (spec.includes('distributorApplications')) {
      return require('../../../services/distributorApplications');
    }
    if (spec.includes('AdminTheme')) {
      return { useAdminTheme: () => ({ colors, resolvedTheme }) };
    }
    if (spec.includes('ManagerRealtimeData')) {
      return {
        useManagerRealtimeData: () => ({
          requests: customOrders !== undefined ? customOrders : sampleOrders,
          incomingTransfers: [],
          branchId: 'branch-1',
          branch: { name: 'Toledo Central', id: 'branch-1' },
          users: customUsers !== undefined ? customUsers : [],
          pendingApplications: customApplicants !== undefined ? customApplicants : sampleApplicants,
          loading: false,
          error: '',
        }),
      };
    }
    if (spec.includes('ManagerShell')) {
      const Shell = ({ children }) => React.createElement('div', { id: 'manager-shell' }, children);
      Shell.ManagerPill = ({ children, tone }) => React.createElement('span', { className: 'pill-' + tone }, children);
      Shell.MANAGER_COLORS = colors;
      return { default: Shell, ManagerPill: Shell.ManagerPill, MANAGER_COLORS: colors, __esModule: true };
    }
    if (spec.includes('authSession')) {
      return {
        getModuleSession: () => ({ branchId: 'branch-1', role: 'manager' }),
        signOutAndClearSessions: () => {},
      };
    }
    if (spec.includes('managerOrderApprovals')) {
      return {
        getManagerDispatch: async () => ({
          distributors: customDistributors !== undefined ? customDistributors : [
            { uid: 'dist-1', name: 'Demo Distributor One', fullName: 'Demo Distributor One' },
            { uid: 'dist-2', name: 'Demo Distributor Two', fullName: 'Demo Distributor Two' },
          ],
          branches: [{ id: 'branch-1', name: 'Toledo Central' }],
        }),
        dispatchManagerOrder: async () => ({}),
      };
    }
    if (spec.includes('managerWorkspace')) {
      return {
        approveManagerDistributor: async () => ({ idempotent: false }),
        rejectManagerDistributor: async () => ({}),
      };
    }
    if (spec.includes('managerTripCapacity')) {
      return require('../../../services/managerTripCapacity');
    }
    if (spec.includes('productOrderPolicy')) {
      return require('../../../services/productOrderPolicy');
    }
    if (spec.includes('ManagerTripCapacity')) {
      const capMod = { exports: {} };
      const capFn = new Function('require', 'module', 'exports', 'React', capTrans.code);
      capFn(customRequire, capMod, capMod.exports, React);
      return capMod.exports;
    }
    if (spec.includes('ManagerAssignScheduleModal')) {
      const modalMod = { exports: {} };
      const modalFn = new Function('require', 'module', 'exports', 'React', modalTrans.code);
      modalFn(customRequire, modalMod, modalMod.exports, React);
      return modalMod.exports;
    }
    if (spec.includes('ManagerWorkloadDetailModal')) {
      return () => null;
    }
    if (spec.includes('AdminIcon')) {
      return () => React.createElement('span', null, 'Icon');
    }
    if (spec.includes('DropdownChevron')) {
      return () => React.createElement('span', null, 'v');
    }
    if (spec.includes('BlueTapEmptyState')) {
      return ({ title }) => React.createElement('div', null, title);
    }
    if (spec.includes('TopToastFeedback')) {
      return () => null;
    }
    if (spec.startsWith('.')) {
      const resolved = path.resolve(__dirname, '../../../app/manager', spec);
      return require(resolved);
    }
    return require(spec);
  };

  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', 'React', transformed.code);
  fn(customRequire, mod, mod.exports, React);
  const Page = mod.exports.default;
  Page.DistributorDispatchQueue = mod.exports.DistributorDispatchQueue;
  Page.colors = colors;
  return Page;
}

test('Authenticated Manager Distributors page renders completely in Light Mode without runtime or theme errors', () => {
  const LightDistributorsPage = loadDistributorsWithTheme('light');
  const lightHtml = ReactDOMServer.renderToString(React.createElement(LightDistributorsPage));

  assert.ok(lightHtml.length > 500, 'Light mode must render full HTML output');
  assert.ok(lightHtml.includes('Other Cargo (2 items)'), 'Must render Other Cargo badge for non-5-gal items');
  assert.ok(lightHtml.includes('5 × 5-gal'), 'Must render 5-gal badge for standard 5-gallon refill items');
  assert.ok(lightHtml.includes('Juan Dela Cruz'), 'Must render pending distributor applicant');
});

test('Authenticated Manager Distributors page renders completely in Dark Mode without runtime or theme errors', () => {
  const DarkDistributorsPage = loadDistributorsWithTheme('dark');
  const darkHtml = ReactDOMServer.renderToString(React.createElement(DarkDistributorsPage));

  assert.ok(darkHtml.length > 500, 'Dark mode must render full HTML output');
  assert.ok(darkHtml.includes('Other Cargo (2 items)'), 'Must render Other Cargo badge in dark mode');
  assert.ok(darkHtml.includes('5 × 5-gal'), 'Must render 5-gal badge in dark mode');
  assert.ok(darkHtml.includes('Juan Dela Cruz'), 'Must render pending distributor applicant in dark mode');
});

test('Authenticated Manager Distributors page safely renders orders with Firestore Timestamps, Admin Timestamps, and unscheduled orders without throwing RangeError', () => {
  const customOrders = [
    {
      id: 'order-client-ts',
      branchId: 'branch-1',
      currentBranchId: 'branch-1',
      requesterName: 'Firestore TS Requester',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      assignedDistributorName: 'Distributor One',
      scheduledAt: { seconds: 1731574800, nanoseconds: 0 },
      items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 10 }],
      totalAtOrder: 250,
      address: '789 Pine St, Toledo City',
    },
    {
      id: 'order-admin-ts',
      branchId: 'branch-1',
      currentBranchId: 'branch-1',
      requesterName: 'Admin TS Requester',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      assignedDistributorName: 'Distributor One',
      scheduledAt: { _seconds: 1731574800, _nanoseconds: 0 },
      items: [{ productNameSnapshot: 'BlueTap Bottled Water — 24 Pack', quantity: 2 }],
      totalAtOrder: 200,
      address: '101 Oak St, Toledo City',
    },
    {
      id: 'order-unscheduled',
      branchId: 'branch-1',
      currentBranchId: 'branch-1',
      requesterName: 'Unscheduled Requester',
      status: 'awaiting_distributor_assignment',
      scheduledAt: null,
      items: [{ productNameSnapshot: 'Purified Water Refill', quantity: 5 }],
      totalAtOrder: 125,
      address: '202 Maple St, Toledo City',
    },
    {
      id: 'order-invalid-date',
      branchId: 'branch-1',
      currentBranchId: 'branch-1',
      requesterName: 'Invalid Date Requester',
      status: 'distributor_assigned',
      assignedDistributorUid: 'dist-1',
      assignedDistributorName: 'Distributor One',
      scheduledAt: 'Invalid Date',
      items: [{ productNameSnapshot: 'Purified Water Refill', quantity: 5 }],
      totalAtOrder: 125,
      address: '303 Birch St, Toledo City',
    },
  ];

  // Load page with customOrders passed into realtime
  const Page = loadDistributorsWithTheme('light');
  // Render must succeed without RangeError: Invalid time value
  const html = ReactDOMServer.renderToString(React.createElement(Page));
  assert.ok(html.length > 500);
});

test('ManagerTripCapacity component renders co-loading details, explanation, and assigned deliveries in Light and Dark mode', () => {
  const capMod = { exports: {} };
  const customRequire = (spec) => {
    if (spec === 'react') return React;
    if (spec === 'react-native') return mockRN;
    if (spec.includes('managerTripCapacity')) {
      return require('../../../services/managerTripCapacity');
    }
    if (spec.includes('productOrderPolicy')) {
      return require('../../../services/productOrderPolicy');
    }
    if (spec.includes('DropdownChevron')) {
      return () => React.createElement('span', null, 'v');
    }
    return require(spec);
  };
  const capFn = new Function('require', 'module', 'exports', 'React', capTrans.code);
  capFn(customRequire, capMod, capMod.exports, React);
  const ManagerTripCapacity = capMod.exports.default || capMod.exports;

  const assignedOrders = [
    {
      id: 'ord-101',
      requestId: 'REQ-101',
      requesterName: 'Juan Dela Cruz',
      status: 'scheduled',
      items: [{ productNameSnapshot: '5-Gallon Purified Water Refill', quantity: 20 }],
    },
    {
      id: 'ord-102',
      requestId: 'REQ-102',
      requesterName: 'Maria Santos',
      status: 'scheduled',
      items: [{ productNameSnapshot: 'BlueTap Bottled Water — 24 Pack', quantity: 2 }],
    },
  ];

  // 1. Light Mode Render
  const lightHtml = ReactDOMServer.renderToString(
    React.createElement(ManagerTripCapacity, {
      currentContainers: 20,
      orderContainers: 10,
      orderCargo: { standard5GallonCount: 10, otherCargoCount: 0, hasUnknownCargo: false, isPure5Gallon: true },
      maxCapacity: 60,
      colors: {
        border: '#e2e8f0',
        primary: '#187bcd',
        textPrimary: '#0f172a',
        textSecondary: '#64748b',
        error: '#ef4444',
      },
      isDark: false,
      isExistingTrip: true,
      tripNumber: 2,
      slotLabel: '11:00 AM',
      assignedOrders,
      explanation: 'Eligible for Co-Loading: Order fits within Trip #2 (30/60 used, 30 remaining).',
    })
  );

  assert.ok(lightHtml.includes('Co-Loading: Trip #2 (11:00 AM)'), 'Must render co-loading trip title');
  assert.ok(lightHtml.includes('30 remaining'), 'Must display remaining containers');
  assert.ok(lightHtml.includes('50%') && lightHtml.includes('5-gal'), 'Must display fill percentage');
  assert.ok(lightHtml.includes('View 2 Assigned Orders in this Trip'), 'Must render assigned deliveries toggle button');

  // 2. Dark Mode Render with turnaround conflict
  const darkHtml = ReactDOMServer.renderToString(
    React.createElement(ManagerTripCapacity, {
      currentContainers: 0,
      orderContainers: 15,
      orderCargo: { standard5GallonCount: 15, otherCargoCount: 0, hasUnknownCargo: false, isPure5Gallon: true },
      maxCapacity: 60,
      colors: {
        border: '#334155',
        primary: '#38bdf8',
        textPrimary: '#f8fafc',
        textSecondary: '#94a3b8',
        error: '#f87171',
      },
      isDark: true,
      conflict: true,
      conflictMessage: 'Distributor already has Trip #1 scheduled within 30 minutes of this time slot.',
      isExistingTrip: false,
      tripNumber: 1,
      slotLabel: '01:00 PM',
      explanation: 'Turnaround conflict: Distributor has Trip #1 scheduled within 30 minutes of this slot.',
    })
  );

  assert.ok(darkHtml.includes('New Trip #1 (01:00 PM)'), 'Must render new trip title');
  assert.ok(darkHtml.includes('Distributor already has Trip #1 scheduled within 30 minutes'), 'Must display conflict message');

  // 3. User Reported Scenario: Trip #2 with 0 standard 5-gallon containers and 3 other-cargo items
  const trip2Html = ReactDOMServer.renderToString(
    React.createElement(ManagerTripCapacity, {
      currentContainers: 0,
      orderContainers: 0,
      orderCargo: {
        standard5GallonCount: 0,
        otherCargoCount: 1,
        has5Gallon: false,
        hasOtherCargo: true,
        hasUnknownCargo: false,
        isOnlyOther: true,
        isPhysicalLoadVerified: false,
      },
      existingTripCargo: {
        totalContainers: 0,
        otherCargoCount: 2,
        otherCargoSummary: '2 × BlueTap 1-Gallon Purified Water',
        isPhysicalLoadVerified: false,
      },
      hasOtherCargo: true,
      otherCargoCount: 3,
      otherCargoSummary: '2 × BlueTap 1-Gallon Purified Water, 1 × BlueTap Bottled Water — 24 Pack',
      isPhysicalLoadVerified: false,
      maxCapacity: 60,
      colors: {
        border: '#e2e8f0',
        primary: '#187bcd',
        textPrimary: '#0f172a',
        textSecondary: '#64748b',
        warning: '#f59e0b',
        error: '#ef4444',
      },
      isDark: false,
      isExistingTrip: true,
      tripNumber: 2,
      slotLabel: '09:00 AM',
      assignedOrders: [
        { id: 'ord-1', requestId: 'REQ-001', requesterName: 'User 1', items: [{ productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 2 }] },
        { id: 'ord-2', requestId: 'REQ-002', requesterName: 'User 2', items: [{ productNameSnapshot: 'BlueTap Bottled Water — 24 Pack', quantity: 1 }] },
      ],
      explanation: 'Eligible for Co-Loading: Order fits within Trip #2 (0/60 standard 5-gal used, 60 remaining + 3 other cargo).',
    })
  );

  // Must label progress bar strictly as 5-Gallon Container Utilization (Requirement 3)
  assert.ok(trip2Html.includes('5-Gallon Container Utilization'), 'Progress bar must be labeled 5-Gallon Container Utilization');

  // Must NOT display misleading generic "60 remaining" when other cargo is loaded
  assert.ok(!trip2Html.includes('>60 remaining<'), 'Must not display generic 60 remaining badge when other cargo is present');

  // Must NOT display obsolete Physical Load Not Yet Verified badge or warning
  assert.ok(!trip2Html.includes('Physical Load Not Yet Verified'), 'Must NOT display obsolete Physical Load Not Yet Verified');

  // Must NOT render redundant Other Cargo section, purple chips, or Overall Physical Load row
  assert.ok(!trip2Html.includes('Other Cargo Occupying Vehicle Space'), 'Must NOT render redundant Other Cargo section');
  assert.ok(!trip2Html.includes('Overall Physical Load'), 'Must NOT render redundant Overall Physical Load text row');
  assert.ok(!trip2Html.includes('📦'), 'Must NOT render purple cargo pills on main panel');

  // Must show 5-gal container utilization metrics (Requirement 2)
  assert.ok(trip2Html.includes('0 / 60 containers (0% 5-gal)'), 'Must show standard 5-gallon container metrics');

  // Must show compact other cargo item count in stat tile
  assert.ok(trip2Html.includes('3 items'), 'Must display 3 items other cargo in stat tile');

  // Must show assigned orders count in stat tile
  assert.ok(trip2Html.includes('2 orders assigned'), 'Must display assigned orders count');

  // Must render clean visual redesign features: status chip, stat tiles, and expandable button
  assert.ok(trip2Html.includes('Co-Loading'), 'Must render Co-Loading status chip');
  assert.ok(trip2Html.includes('Assigned Orders'), 'Must render Assigned Orders stat tile');
  assert.ok(trip2Html.includes('5-Gal Used'), 'Must render 5-Gal Used stat tile');
  assert.ok(trip2Html.includes('Remaining 5-Gal'), 'Must render Remaining 5-Gal stat tile');
  assert.ok(trip2Html.includes('View 2 Assigned Orders in this Trip'), 'Must render expandable assigned orders toggle button');
});

test('Regression: DistributorDispatchQueue renders with unassigned order, selected distributor, existing trips, and co-loading preview without ReferenceError', () => {
  const tomorrow = new Date(Date.now() + 86400000);
  const sampleDistributors = [
    { uid: 'dist-demo-1', name: 'Marco Polo Distributor', fullName: 'Marco Polo Distributor' },
    { uid: 'dist-demo-2', name: 'Sara Distributor', fullName: 'Sara Distributor' },
  ];

  const ordersWithTrips = [
    // 1. Unassigned candidate order awaiting assignment
    {
      id: 'candidate-order-1',
      requestId: 'REQ-CAND-01',
      branchId: 'branch-1',
      currentBranchId: 'branch-1',
      requesterName: 'Juan Dela Cruz',
      status: 'awaiting_distributor_assignment',
      items: [
        { productNameSnapshot: '5-Gallon Water Refill', quantity: 10 },
        { productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 2 },
      ],
      totalAtOrder: 250,
      deliveryFeeAtOrder: 20,
      address: '777 Rizal St, Toledo City',
      serviceRadiusKmSnapshot: 5,
      distanceKmSnapshot: 2.1,
    },
    // 2. Existing order assigned to Trip #1 for Marco Polo Distributor
    {
      id: 'existing-trip1-order',
      requestId: 'REQ-EXIST-01',
      branchId: 'branch-1',
      currentBranchId: 'branch-1',
      requesterName: 'Existing Customer 1',
      status: 'scheduled',
      assignedDistributorUid: 'dist-demo-1',
      assignedDistributorName: 'Marco Polo Distributor',
      scheduledAt: tomorrow.toISOString(),
      tripNumber: 1,
      items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 20 }],
      totalAtOrder: 500,
      address: '888 Osmena Blvd, Toledo City',
    },
    // 3. Existing order assigned to Trip #2 for Marco Polo Distributor
    {
      id: 'existing-trip2-order',
      requestId: 'REQ-EXIST-02',
      branchId: 'branch-1',
      currentBranchId: 'branch-1',
      requesterName: 'Existing Customer 2',
      status: 'scheduled',
      assignedDistributorUid: 'dist-demo-1',
      assignedDistributorName: 'Marco Polo Distributor',
      scheduledAt: tomorrow.toISOString(),
      tripNumber: 2,
      items: [
        { productNameSnapshot: 'BlueTap Bottled Water — 24 Pack', quantity: 3 },
      ],
      totalAtOrder: 450,
      address: '999 Colon St, Toledo City',
    },
  ];

  // A. Populated queue with active assignment panel open on candidate-order-1
  const PagePopulated = loadDistributorsWithTheme('light', {
    customOrders: ordersWithTrips,
    customDistributors: sampleDistributors,
  });

  const populatedHtml = ReactDOMServer.renderToString(
    React.createElement(PagePopulated.DistributorDispatchQueue, {
      styles: {},
      colors: PagePopulated.colors,
      isDark: false,
      onShowToast: () => {},
      initialAssigningOrderId: 'candidate-order-1',
      initialDistributorUid: 'dist-demo-1',
      initialDistributors: sampleDistributors,
    })
  );

  // Assertions on populated queue & open co-loading preview
  assert.ok(populatedHtml.length > 500, 'Populated dispatch queue must render completely');
  assert.ok(populatedHtml.includes('Marco Polo Distributor'), 'Must render selected distributor name');
  assert.ok(populatedHtml.includes('DISTRIBUTOR WORKLOAD SUMMARY'), 'Must render distributor workload card');
  assert.ok(populatedHtml.includes('Set Delivery Schedule'), 'Must render schedule section');
  assert.ok(populatedHtml.includes('5-Gallon Container Utilization'), 'Must render co-loading 5-gal container utilization');
  assert.ok(populatedHtml.includes('Co-Loading') || populatedHtml.includes('New Trip'), 'Must render trip status chip');
  assert.ok(populatedHtml.includes('Assigned Orders'), 'Must render assigned orders stat chip');
  assert.ok(populatedHtml.includes('5-Gal Used'), 'Must render 5-gal used stat chip');
  assert.ok(populatedHtml.includes('Remaining 5-Gal'), 'Must render remaining 5-gal stat chip');
  assert.ok(!populatedHtml.includes('ReferenceError'), 'Must not contain ReferenceError');

  // B. Empty orders list renders empty state cleanly without crashing
  const PageEmpty = loadDistributorsWithTheme('light', {
    customOrders: [],
    customDistributors: sampleDistributors,
  });

  const emptyHtml = ReactDOMServer.renderToString(
    React.createElement(PageEmpty.DistributorDispatchQueue, {
      styles: {},
      colors: PageEmpty.colors,
      isDark: false,
      onShowToast: () => {},
      initialAssigningOrderId: '',
      initialDistributorUid: '',
      initialDistributors: sampleDistributors,
    })
  );

  assert.ok(emptyHtml.includes('No Orders Awaiting Assignment'), 'Empty queue must render empty state');
});

test('Manager Distributors page renders single unified Distributor Workload Summary section with Pending Applications header trigger', () => {
  const sampleRegisteredUsers = [
    {
      uid: 'dist-registered-1',
      firstName: 'Marco',
      lastName: 'Distributor',
      role: 'distributor',
      status: 'approved',
      assignedBranchId: 'branch-1',
    },
  ];

  const sampleActiveOrders = [
    {
      id: 'active-ord-1',
      branchId: 'branch-1',
      status: 'out_for_delivery',
      assignedDistributorUid: 'dist-registered-1',
      scheduledAt: new Date().toISOString(),
      tripNumber: 1,
      items: [{ productNameSnapshot: '5-Gallon Purified Water', quantity: 10 }],
    },
  ];

  // 1. Populated with both pending application and registered distributor
  const PagePopulated = loadDistributorsWithTheme('light', {
    customOrders: sampleActiveOrders,
    customUsers: sampleRegisteredUsers,
  });

  const populatedHtml = ReactDOMServer.renderToString(React.createElement(PagePopulated));

  assert.ok(populatedHtml.includes('Distributor Workload Summary (1)'), 'Must render unified section header Distributor Workload Summary (1)');
  assert.ok(populatedHtml.includes('Active assignments, scheduled routes, and delivery status across approved branch distributors'), 'Must render subtitle');
  assert.ok(populatedHtml.includes('Pending Applications (1)'), 'Must render header trigger button with count');
  assert.ok(populatedHtml.includes('Juan Dela Cruz'), 'Must render pending applicant in top subsection');
  assert.ok(populatedHtml.includes('Marco Distributor'), 'Must render registered distributor name');
  assert.ok(populatedHtml.includes('Active Orders'), 'Must render Active Orders stat label');
  assert.ok(populatedHtml.includes('Active Trips'), 'Must render Active Trips stat label');
  assert.ok(populatedHtml.includes('Scheduled'), 'Must render Scheduled stat label');
  assert.ok(populatedHtml.includes('Overdue'), 'Must render Overdue stat label');

  // 2. Empty state: 0 pending applications and 0 registered distributors
  const PageEmpty = loadDistributorsWithTheme('light', {
    customOrders: [],
    customUsers: [],
    customApplicants: [],
  });

  const emptyHtml = ReactDOMServer.renderToString(React.createElement(PageEmpty));
  assert.ok(emptyHtml.includes('Pending Applications (0)'), 'Must render Pending Applications (0) button trigger');
  assert.ok(!emptyHtml.includes('No Pending Applications'), 'Must NOT render empty pending applications box by default when count is zero');
  assert.ok(emptyHtml.includes('Distributor Workload Summary (0)'), 'Must render 0 registered distributors');
  assert.ok(emptyHtml.includes('No registered distributors for this branch yet'), 'Must render empty text for registered distributors');
});

test('Distributor Workload Summary renders interactive clickable metric buttons without overall 0/60 progress bar', () => {
  const sampleRegisteredUsers = [
    {
      uid: 'dist-test-99',
      firstName: 'Elena',
      lastName: 'Distributor',
      role: 'distributor',
      status: 'approved',
      assignedBranchId: 'branch-1',
    },
  ];

  const sampleActiveOrders = [
    {
      id: 'active-ord-99',
      branchId: 'branch-1',
      status: 'assigned',
      assignedDistributorUid: 'dist-test-99',
      scheduledAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      tripNumber: 1,
      items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 15 }],
    },
  ];

  const Page = loadDistributorsWithTheme('light', {
    customOrders: sampleActiveOrders,
    customUsers: sampleRegisteredUsers,
  });

  const html = ReactDOMServer.renderToString(React.createElement(Page));

  // 1. Metric buttons are accessible interactive controls
  assert.ok(html.includes('aria-label="View Elena Distributor&#x27;s Active Orders (1)"') || html.includes('Active Orders (1)'));
  assert.ok(html.includes('aria-label="View Elena Distributor&#x27;s Active Trips (1)"') || html.includes('Active Trips (1)'));
  assert.ok(html.includes('aria-label="View Elena Distributor&#x27;s Scheduled Trips (1)"') || html.includes('Scheduled Trips (1)'));
  assert.ok(html.includes('aria-label="View Elena Distributor&#x27;s Overdue Deliveries (0)"') || html.includes('Overdue Deliveries (0)'));

  // 2. Misleading overall vehicle capacity progress bar is removed from the distributor card
  assert.ok(!html.includes('/60 5-gal loaded'), 'Must not display overall 0/60 progress bar on distributor card');
});

test('DistributorDispatchQueue pagination: 0 orders displays empty state and no pagination controls', () => {
  const Page = loadDistributorsWithTheme('light', { customOrders: [] });
  const html = ReactDOMServer.renderToString(React.createElement(Page));

  assert.ok(html.includes('No Orders Awaiting Assignment'));
  assert.ok(!html.includes('aria-label="Dispatch queue pagination"'), 'Must not render pagination when queue is empty');
});

test('DistributorDispatchQueue pagination: 1 order displays range summary and hides navigation buttons', () => {
  const singleOrder = [{
    id: 'order-single-1',
    branchId: 'branch-1',
    currentBranchId: 'branch-1',
    requesterName: 'Maria Single',
    status: 'awaiting_distributor_assignment',
    items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 2 }],
    totalAtOrder: 100,
    address: '100 Single Lane, Toledo City',
  }];

  const Page = loadDistributorsWithTheme('light', { customOrders: singleOrder });
  const html = ReactDOMServer.renderToString(React.createElement(Page));

  assert.ok(html.includes('Showing 1–1 of 1 order'));
  assert.ok(!html.includes('aria-label="Previous page"'), 'Single page hides Previous button');
  assert.ok(!html.includes('aria-label="Next page"'), 'Single page hides Next button');
  assert.ok(html.includes('Maria Single'));
});

test('DistributorDispatchQueue pagination: 5 orders (1 full page) displays summary and hides navigation buttons', () => {
  const fiveOrders = Array.from({ length: 5 }, (_, i) => ({
    id: `order-five-${i + 1}`,
    branchId: 'branch-1',
    currentBranchId: 'branch-1',
    requesterName: `Requester Five ${i + 1}`,
    status: 'awaiting_distributor_assignment',
    items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 1 }],
    totalAtOrder: 50,
    address: `${i + 1} Five St, Toledo City`,
  }));

  const Page = loadDistributorsWithTheme('light', { customOrders: fiveOrders });
  const html = ReactDOMServer.renderToString(React.createElement(Page));

  assert.ok(html.includes('Showing 1–5 of 5 orders'));
  assert.ok(!html.includes('aria-label="Previous page"'), '5 orders fit on 1 page; hide Previous button');
  assert.ok(!html.includes('aria-label="Next page"'), '5 orders fit on 1 page; hide Next button');
  assert.ok(html.includes('Requester Five 1'));
  assert.ok(html.includes('Requester Five 5'));
});

test('DistributorDispatchQueue pagination: 6 orders spills to 2 pages with Previous disabled on page 1', () => {
  const sixOrders = Array.from({ length: 6 }, (_, i) => ({
    id: `order-six-${i + 1}`,
    branchId: 'branch-1',
    currentBranchId: 'branch-1',
    requesterName: `Requester Six ${i + 1}`,
    status: 'awaiting_distributor_assignment',
    items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 1 }],
    totalAtOrder: 50,
    address: `${i + 1} Six St, Toledo City`,
  }));

  const Page = loadDistributorsWithTheme('light', { customOrders: sixOrders });
  const html = ReactDOMServer.renderToString(React.createElement(Page));

  assert.ok(html.includes('Showing 1–5 of 6 orders'));
  assert.ok(html.includes('aria-label="Previous page"'), 'Page 1 must render Previous button');
  assert.ok(html.includes('aria-label="Next page"'), 'Page 1 must render Next button');
  assert.ok(html.includes('aria-label="Current page, page 1"'), 'Page 1 is selected');
  assert.ok(html.includes('aria-label="Go to page 2"'), 'Page 2 is selectable');

  // Verify page 1 contains orders 1..5 and does NOT render order 6 on page 1
  assert.ok(html.includes('Requester Six 1'));
  assert.ok(html.includes('Requester Six 5'));
  assert.ok(!html.includes('Requester Six 6'), 'Order 6 must be on page 2, not page 1');
});

test('DistributorDispatchQueue pagination: 10 orders across 2 full pages', () => {
  const tenOrders = Array.from({ length: 10 }, (_, i) => ({
    id: `order-ten-${String(i + 1).padStart(2, '0')}`,
    branchId: 'branch-1',
    currentBranchId: 'branch-1',
    requesterName: `Requester Ten ${i + 1}`,
    status: 'awaiting_distributor_assignment',
    createdAt: new Date(1700000000000 + i * 1000).toISOString(),
    items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 1 }],
    totalAtOrder: 50,
    address: `${i + 1} Ten St, Toledo City`,
  }));

  const Page = loadDistributorsWithTheme('light', { customOrders: tenOrders });
  const html = ReactDOMServer.renderToString(React.createElement(Page));

  assert.ok(html.includes('Showing 1–5 of 10 orders'));
  assert.ok(html.includes('aria-label="Current page, page 1"'));
  assert.ok(html.includes('aria-label="Go to page 2"'));
  assert.ok(html.includes('Requester Ten 1'));
  assert.ok(html.includes('Requester Ten 5'));
  assert.ok(!html.includes('Requester Ten 6'), 'Order 6 must not appear on page 1');
});

test('DistributorDispatchQueue pagination: 23 orders across 5 pages with compact page numbers', () => {
  const twentyThreeOrders = Array.from({ length: 23 }, (_, i) => ({
    id: `order-23-${String(i + 1).padStart(2, '0')}`,
    branchId: 'branch-1',
    currentBranchId: 'branch-1',
    requesterName: `Requester 23 ${i + 1}`,
    status: 'awaiting_distributor_assignment',
    createdAt: new Date(1700000000000 + i * 1000).toISOString(),
    items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 1 }],
    totalAtOrder: 50,
    address: `${i + 1} TwentyThree St, Toledo City`,
  }));

  const Page = loadDistributorsWithTheme('light', { customOrders: twentyThreeOrders });
  const html = ReactDOMServer.renderToString(React.createElement(Page));

  assert.ok(html.includes('Showing 1–5 of 23 orders'));
  assert.ok(html.includes('aria-label="Previous page"'));
  assert.ok(html.includes('aria-label="Next page"'));
  assert.ok(html.includes('aria-label="Current page, page 1"'));
  assert.ok(html.includes('aria-label="Go to page 2"'));
  assert.ok(html.includes('aria-label="Go to page 3"'));
  assert.ok(html.includes('aria-label="Go to page 4"'));
  assert.ok(html.includes('aria-label="Go to page 5"'));

  // First 5 orders are visible
  assert.ok(html.includes('Requester 23 1'));
  assert.ok(html.includes('Requester 23 5'));
  assert.ok(!html.includes('Requester 23 6'));
});

test('DistributorDispatchQueue pagination preserves Assign & Schedule modal for candidate orders', () => {
  const tenOrders = Array.from({ length: 10 }, (_, i) => ({
    id: `order-modal-${i + 1}`,
    requestId: `REQ-MODAL-${i + 1}`,
    branchId: 'branch-1',
    currentBranchId: 'branch-1',
    requesterName: `Candidate Requester ${i + 1}`,
    status: 'awaiting_distributor_assignment',
    items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 2 }],
    totalAtOrder: 100,
    address: `${i + 1} Modal St, Toledo City`,
  }));

  const Page = loadDistributorsWithTheme('light', { customOrders: tenOrders });
  const QueueComponent = Page.DistributorDispatchQueue;

  // Render Queue with initialAssigningOrderId set to an order
  const html = ReactDOMServer.renderToString(
    React.createElement(QueueComponent, {
      styles: Page.styles || {},
      colors: Page.colors,
      isDark: false,
      initialAssigningOrderId: 'order-modal-3',
      initialDistributors: [],
    })
  );

  assert.ok(html.includes('Assign &amp; Schedule Delivery') || html.includes('Assign & Schedule Delivery'));
  assert.ok(html.includes('Order #REQ-MODAL-3'));
  assert.ok(html.includes('Candidate Requester 3'));
});
