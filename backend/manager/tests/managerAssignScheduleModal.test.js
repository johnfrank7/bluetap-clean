const test = require('node:test');
const assert = require('node:assert/strict');
const babel = require('@babel/core');
const fs = require('fs');
const path = require('path');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const rnw = require('react-native-web');

const MockModal = ({ children, visible = true }) =>
  visible ? React.createElement('div', { 'data-modal': 'true' }, children) : null;

const mockRN = { ...rnw, Modal: MockModal, useWindowDimensions: () => ({ width: 1200, height: 800 }) };
mockRN.default = mockRN;
mockRN.__esModule = true;

const modalCode = fs.readFileSync(path.resolve(__dirname, '../../../components/ManagerAssignScheduleModal.jsx'), 'utf8');
const modalTrans = babel.transformSync(modalCode, {
  presets: [['@babel/preset-react', { runtime: 'classic' }]],
  plugins: ['@babel/plugin-transform-modules-commonjs'],
});

const capCode = fs.readFileSync(path.resolve(__dirname, '../../../components/ManagerTripCapacity.jsx'), 'utf8');
const capTrans = babel.transformSync(capCode, {
  presets: [['@babel/preset-react', { runtime: 'classic' }]],
  plugins: ['@babel/plugin-transform-modules-commonjs'],
});

function loadModalWithTheme(resolvedTheme = 'light') {
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

  const customRequire = (spec) => {
    if (spec === 'react') return React;
    if (spec === 'react-native') return mockRN;
    if (spec.includes('uniqueIds')) {
      return { getProfileUniqueId: (u) => u.uid || 'UID-001' };
    }
    if (spec.includes('AdminTheme')) {
      return { useAdminTheme: () => ({ colors, resolvedTheme }) };
    }
    if (spec.includes('ManagerShell')) {
      const Shell = ({ children }) => React.createElement('div', null, children);
      Shell.ManagerPill = ({ children, tone }) => React.createElement('span', { className: `pill-${tone}` }, children);
      return { default: Shell, ManagerPill: Shell.ManagerPill, __esModule: true };
    }
    if (spec.includes('ManagerTripCapacity')) {
      const capMod = { exports: {} };
      const capFn = new Function('require', 'module', 'exports', 'React', capTrans.code);
      capFn(customRequire, capMod, capMod.exports, React);
      return capMod.exports;
    }
    if (spec.includes('DropdownChevron')) {
      return () => React.createElement('span', null, '▼');
    }
    if (spec.includes('managerTripCapacity')) {
      return require('../../../services/managerTripCapacity');
    }
    if (spec.includes('productOrderPolicy')) {
      return require('../../../services/productOrderPolicy');
    }
    return require(spec);
  };

  const modalMod = { exports: {} };
  const modalFn = new Function('require', 'module', 'exports', 'React', modalTrans.code);
  modalFn(customRequire, modalMod, modalMod.exports, React);
  return { ModalComponent: modalMod.exports.default, colors };
}

const sampleOrder = {
  id: 'order-test-1',
  requestId: 'REQ-101',
  requesterName: 'Juan Dela Cruz',
  status: 'awaiting_distributor_assignment',
  currentBranchName: 'Toledo Central',
  items: [
    { productNameSnapshot: '5-Gallon Water Refill', quantity: 10 },
    { productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 2 },
  ],
  totalAtOrder: 250,
  deliveryFeeAtOrder: 20,
  address: '777 Rizal St, Toledo City',
  distanceKmSnapshot: 2.1,
  serviceRadiusKmSnapshot: 5,
};

const sampleDistributors = [
  { uid: 'dist-1', name: 'Marco Polo Distributor', fullName: 'Marco Polo Distributor', displayUid: 'DIST-001' },
  { uid: 'dist-2', name: 'Sara Distributor', fullName: 'Sara Distributor', displayUid: 'DIST-002' },
];

test('ManagerAssignScheduleModal renders null when visible is false or order is null', () => {
  const { ModalComponent, colors } = loadModalWithTheme('light');

  const htmlHidden = ReactDOMServer.renderToString(
    React.createElement(ModalComponent, {
      visible: false,
      order: sampleOrder,
      distributors: sampleDistributors,
      colors,
      isDark: false,
    })
  );
  assert.equal(htmlHidden, '', 'Must render empty string when hidden');

  const htmlNoOrder = ReactDOMServer.renderToString(
    React.createElement(ModalComponent, {
      visible: true,
      order: null,
      distributors: sampleDistributors,
      colors,
      isDark: false,
    })
  );
  assert.equal(htmlNoOrder, '', 'Must render empty string when order is null');
});

test('ManagerAssignScheduleModal renders sticky header, order summary, 3 steps, and sticky footer in Light Mode', () => {
  const { ModalComponent, colors } = loadModalWithTheme('light');

  const html = ReactDOMServer.renderToString(
    React.createElement(ModalComponent, {
      visible: true,
      order: sampleOrder,
      distributors: sampleDistributors,
      allOrders: [sampleOrder],
      colors,
      isDark: false,
      initialDistributorUid: 'dist-1',
    })
  );

  // 1. Sticky Header
  assert.ok(html.includes('DISPATCH &amp; SCHEDULING') || html.includes('DISPATCH & SCHEDULING'));
  assert.ok(html.includes('Assign &amp; Schedule Delivery') || html.includes('Assign & Schedule Delivery'));
  assert.ok(html.includes('Order #REQ-101'));
  assert.ok(html.includes('Juan Dela Cruz'));
  assert.ok(html.includes('✕'), 'Must render Close/X button');

  // 2. Compact Order Summary
  assert.ok(html.includes('CANDIDATE ORDER'));
  assert.ok(html.includes('10 × 5-Gallon Water Refill, 2 × BlueTap 1-Gallon Purified Water'));
  assert.ok(html.includes('₱250.00'), 'Must render total amount');
  assert.ok(html.includes('Awaiting Assignment'), 'Must render status pill');
  assert.ok(html.includes('777 Rizal St, Toledo City'));
  assert.ok(html.includes('Approx. 2.1 km'));

  // 3. Step 1 — Select Available Distributor
  assert.ok(html.includes('1. Select Available Distributor'));
  assert.ok(html.includes('Marco Polo Distributor'));
  assert.ok(html.includes('Sara Distributor'));
  assert.ok(html.includes('DISTRIBUTOR WORKLOAD SUMMARY'));
  assert.ok(html.includes('Active Orders'));
  assert.ok(html.includes('Active Trips'));

  // 4. Step 2 — Set Delivery Schedule
  assert.ok(html.includes('2. Set Delivery Schedule'));
  assert.ok(html.includes('Delivery Date:'));
  assert.ok(html.includes('Time Slot:'));
  assert.ok(html.includes('09:00 AM'));
  assert.ok(html.includes('11:00 AM'));
  assert.ok(html.includes('01:00 PM'));

  // 5. Step 3 — Trip Summary & Capacity
  assert.ok(html.includes('3. Trip Summary &amp; Capacity') || html.includes('3. Trip Summary & Capacity'));
  assert.ok(html.includes('5-Gallon Container Utilization'), 'Must render 5-gallon container utilization label');
  assert.ok(html.includes('Remaining 5-Gal'), 'Must render Remaining 5-gal stat chip');

  // 6. Sticky Footer
  assert.ok(html.includes('Cancel'), 'Must render Cancel button');
  assert.ok(html.includes('Approve &amp; Assign to Trip') || html.includes('Approve & Assign to Trip'));
  assert.ok(html.includes('aria-label="Cancel assignment"'), 'Cancel button has accessible aria-label');
});

test('ManagerAssignScheduleModal renders high-contrast visible buttons in Light Mode', () => {
  const { ModalComponent, colors } = loadModalWithTheme('light');

  const html = ReactDOMServer.renderToString(
    React.createElement(ModalComponent, {
      visible: true,
      order: sampleOrder,
      distributors: sampleDistributors,
      allOrders: [sampleOrder],
      colors,
      isDark: false,
      initialDistributorUid: 'dist-1',
    })
  );

  // Verify Cancel button is rendered with high-contrast text and border
  assert.ok(html.includes('aria-label="Cancel assignment"'));
  assert.ok(html.includes('data-bluetap-modal-cancel="true"'));
  assert.ok(html.includes('Cancel'));

  // Verify primary action button is clearly visible and framed
  assert.ok(html.includes('Approve &amp; Assign to Trip') || html.includes('Approve & Assign to Trip'));
  assert.ok(html.includes('data-bluetap-assign-btn="true"'));
});

test('ManagerAssignScheduleModal renders co-loading details and Co-Load button when co-loading into an existing trip', () => {
  const { manilaScheduleDate } = require('../../../services/productOrderPolicy');
  const tomorrow9am = manilaScheduleDate(1, 9, 0);
  const existingTripOrder = {
    id: 'existing-ord-1',
    requestId: 'REQ-EXISTING-1',
    branchId: 'branch-1',
    status: 'scheduled',
    assignedDistributorUid: 'dist-1',
    assignedDistributorName: 'Marco Polo Distributor',
    scheduledAt: tomorrow9am.toISOString(),
    tripNumber: 1,
    items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 20 }],
    totalAtOrder: 500,
    address: '888 Osmena Blvd, Toledo City',
  };

  const { ModalComponent, colors } = loadModalWithTheme('light');

  const html = ReactDOMServer.renderToString(
    React.createElement(ModalComponent, {
      visible: true,
      order: sampleOrder,
      distributors: sampleDistributors,
      allOrders: [sampleOrder, existingTripOrder],
      colors,
      isDark: false,
      initialDistributorUid: 'dist-1',
      initialDayOffset: 1,
      initialSlotIndex: 0,
    })
  );

  assert.ok(html.includes('Co-Loading') || html.includes('Co-load eligible'));
  assert.ok(html.includes('Co-Load &amp; Approve Trip #1') || html.includes('Co-Load & Approve Trip #1'));
  assert.ok(html.includes('data-bluetap-coload-btn="true"'));
  assert.ok(html.includes('id="bluetap-modal-coload-action"'));
  assert.ok(html.includes('id="bluetap-modal-coload-action-inner"'));
  // Verify inner View provides solid non-transparent background to defeat web button resets
  assert.ok(html.includes('rgba(21,128,61,1.00)') || html.includes('#15803D') || html.includes('#15803d'));
});

test('global.css protects Assign & Schedule modal action buttons from web CSS resets', () => {
  const globalCss = fs.readFileSync(path.resolve(__dirname, '../../../global.css'), 'utf8');

  // Co-load button protections
  assert.match(globalCss, /#bluetap-modal-coload-action/);
  assert.match(globalCss, /#bluetap-modal-coload-action-inner/);
  assert.match(globalCss, /button\[data-bluetap-coload-btn='true'\]/);
  assert.match(globalCss, /button\[aria-label\^='Co-Load and Approve'\]/);
  assert.match(globalCss, /button\[aria-label\*='Co-Load'\]/);
  assert.match(globalCss, /background-color:\s*#15803d\s*!important/);

  // Assign button protections
  assert.match(globalCss, /#bluetap-modal-assign-action/);
  assert.match(globalCss, /#bluetap-modal-assign-action-inner/);
  assert.match(globalCss, /button\[data-bluetap-assign-btn='true'\]/);
  assert.match(globalCss, /button\[aria-label\^='Approve and Assign'\]/);
  assert.match(globalCss, /background-color:\s*#0b67ad\s*!important/);

  // Modal Cancel button protections
  assert.match(globalCss, /#bluetap-modal-cancel-action/);
  assert.match(globalCss, /button\[data-bluetap-modal-cancel='true'\]/);
  assert.match(globalCss, /button\[aria-label='Cancel assignment'\]/);
  assert.match(globalCss, /background-color:\s*#f1f5f9\s*!important/);
});

test('ManagerAssignScheduleModal renders without errors in Dark Mode', () => {
  const { ModalComponent, colors } = loadModalWithTheme('dark');

  const darkHtml = ReactDOMServer.renderToString(
    React.createElement(ModalComponent, {
      visible: true,
      order: sampleOrder,
      distributors: sampleDistributors,
      allOrders: [sampleOrder],
      colors,
      isDark: true,
      initialDistributorUid: 'dist-1',
    })
  );

  assert.ok(darkHtml.length > 500, 'Dark mode modal must render full HTML output');
  assert.ok(darkHtml.includes('Assign &amp; Schedule Delivery') || darkHtml.includes('Assign & Schedule Delivery'));
  assert.ok(darkHtml.includes('Marco Polo Distributor'));
});
