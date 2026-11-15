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

const modalCode = fs.readFileSync(
  path.resolve(__dirname, '../../../components/ManagerWorkloadDetailModal.jsx'),
  'utf8'
);
const modalTrans = babel.transformSync(modalCode, {
  presets: [['@babel/preset-react', { runtime: 'classic' }]],
  plugins: ['@babel/plugin-transform-modules-commonjs'],
});

function loadModal(resolvedTheme = 'light') {
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
      return { getProfileUniqueId: (u) => (u && (u.displayUid || u.uid)) || 'DIST-001' };
    }
    if (spec.includes('DropdownChevron')) {
      return () => React.createElement('span', null, '▼');
    }
    if (spec.includes('RequestDetailsModal')) {
      return () => null;
    }
    if (spec.includes('managerTripCapacity')) {
      return require('../../../services/managerTripCapacity');
    }
    return require(spec);
  };

  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', 'React', modalTrans.code);
  fn(customRequire, mod, mod.exports, React);
  return { ModalComponent: mod.exports.default, colors };
}

const sampleDistributor = {
  uid: 'dist-101',
  name: 'Marco Polo Distributor',
  fullName: 'Marco Polo Distributor',
  displayUid: 'DIST-001',
};

const sampleOrders = [
  {
    id: 'ord-1',
    requestId: 'REQ-101',
    assignedDistributorUid: 'dist-101',
    requesterName: 'Juan Dela Cruz',
    status: 'assigned',
    items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 5 }],
    totalAtOrder: 250,
    address: '123 Rizal St, Toledo City',
    tripNumber: 1,
  },
  {
    id: 'ord-2',
    requestId: 'REQ-102',
    assignedDistributorUid: 'dist-101',
    requesterName: 'Maria Santos',
    status: 'out_for_delivery',
    items: [{ productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 3 }],
    totalAtOrder: 150,
    address: '456 Burgos St, Toledo City',
    tripNumber: 1,
    scheduledAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), // 2 hours ago (overdue)
  },
];

test('ManagerWorkloadDetailModal renders null when visible is false or distributor is null', () => {
  const { ModalComponent, colors } = loadModal('light');

  const htmlHidden = ReactDOMServer.renderToString(
    React.createElement(ModalComponent, {
      visible: false,
      distributor: sampleDistributor,
      colors,
      isDark: false,
    })
  );
  assert.equal(htmlHidden, '', 'Must render empty when hidden');

  const htmlNoDist = ReactDOMServer.renderToString(
    React.createElement(ModalComponent, {
      visible: true,
      distributor: null,
      colors,
      isDark: false,
    })
  );
  assert.equal(htmlNoDist, '', 'Must render empty when distributor is null');
});

test('ManagerWorkloadDetailModal renders Active Orders tab and displays order details with View Details button', () => {
  const { ModalComponent, colors } = loadModal('light');

  const html = ReactDOMServer.renderToString(
    React.createElement(ModalComponent, {
      visible: true,
      distributor: sampleDistributor,
      initialMetric: 'orders',
      allOrders: sampleOrders,
      colors,
      isDark: false,
    })
  );

  assert.ok(html.includes('DISTRIBUTOR WORKLOAD'));
  assert.ok(html.includes('Marco Polo Distributor'));
  assert.ok(html.includes('Active Orders'));
  assert.ok(html.includes('#REQ-101'));
  assert.ok(html.includes('Juan Dela Cruz'));
  assert.ok(html.includes('#REQ-102'));
  assert.ok(html.includes('Maria Santos'));
  assert.ok(html.includes('View Details'));
  assert.ok(html.includes('Close'));
});

test('ManagerWorkloadDetailModal renders Active Trips tab with per-trip capacity', () => {
  const { ModalComponent, colors } = loadModal('light');

  const html = ReactDOMServer.renderToString(
    React.createElement(ModalComponent, {
      visible: true,
      distributor: sampleDistributor,
      initialMetric: 'trips',
      allOrders: sampleOrders,
      colors,
      isDark: false,
    })
  );

  assert.ok(html.includes('Active Trips'));
  assert.ok(html.includes('Trip #1'));
  assert.ok(html.includes('Standard 5-Gallon Load: 5/60'));
  assert.ok(html.includes('View Assigned Orders'));
});

test('ManagerWorkloadDetailModal renders Overdue tab with elapsed overdue information', () => {
  const { ModalComponent, colors } = loadModal('light');

  const html = ReactDOMServer.renderToString(
    React.createElement(ModalComponent, {
      visible: true,
      distributor: sampleDistributor,
      initialMetric: 'overdue',
      allOrders: sampleOrders,
      colors,
      isDark: false,
    })
  );

  assert.ok(html.includes('Overdue'));
  assert.ok(html.includes('overdue. Delivery time has elapsed'));
  assert.ok(html.includes('Trip #2'));
});

test('ManagerWorkloadDetailModal renders clean empty state when distributor has 0 active orders', () => {
  const { ModalComponent, colors } = loadModal('light');

  const html = ReactDOMServer.renderToString(
    React.createElement(ModalComponent, {
      visible: true,
      distributor: sampleDistributor,
      initialMetric: 'orders',
      allOrders: [],
      colors,
      isDark: false,
    })
  );

  assert.ok(html.includes('No Active Orders'));
  assert.ok(html.includes('Marco Polo Distributor currently has no active orders assigned'));
});
