const assert = require('node:assert/strict');
const test = require('node:test');

const { getCurrentDistributorRequests, getDistributorDashboardCounts } = require('../../../services/distributorDashboardMetrics');

test('Current Requests contains only started delivery work', () => {
  const active = getCurrentDistributorRequests([
    { id: 'assigned', status: 'distributor_assigned' }, { id: 'accepted', status: 'accepted' }, { id: 'started', status: 'out_for_delivery' },
    { id: 'failed', status: 'delivery_failed' }, { id: 'delivered', status: 'delivered' }, { id: 'cancelled', status: 'cancelled' },
  ]);
  assert.deepEqual(active.map((order) => order.id), ['started']);
  assert.deepEqual(getCurrentDistributorRequests([{ id: 'assigned', status: 'delivered' }]), []);
});

const today = new Date('2026-09-26T12:00:00+08:00');

test('Distributor dashboard counts use assignment, schedule, and delivered timestamps', () => {
  const orders = [
    { status: 'distributor_assigned' },
    { status: 'pending' },
    { status: 'scheduled', scheduledAt: '2026-09-26T09:00:00+08:00' },
    { status: 'out_for_delivery', rawScheduledAt: '2026-09-26T10:00:00+08:00' },
    { status: 'scheduled', scheduledAt: '2026-09-25T09:00:00+08:00' },
    { status: 'delivered', deliveredAt: '2026-09-26T11:00:00+08:00' },
    { status: 'delivered', deliveredAt: '2026-09-25T11:00:00+08:00' },
  ];

  assert.deepEqual(getDistributorDashboardCounts(orders, today), {
    pending: 2,
    scheduledToday: 1,
    deliveredToday: 1,
  });
});

test('Distributor dashboard counts recompute from the latest subscription array', () => {
  const assigned = [{ id: 'order-1', status: 'distributor_assigned' }];
  assert.equal(getDistributorDashboardCounts(assigned, today).pending, 1);

  const delivered = [{ id: 'order-1', status: 'delivered', deliveredAt: today }];
  assert.deepEqual(getDistributorDashboardCounts(delivered, today), {
    pending: 0,
    scheduledToday: 0,
    deliveredToday: 1,
  });
});

test('Distributor schedule date formatting parses serialized JSON timestamps and does not show Not set', () => {
  const babel = require('@babel/core');
  const path = require('node:path');
  const vm = require('node:vm');
  const root = path.resolve(__dirname, '../../..');
  const source = require('node:fs').readFileSync(path.join(root, 'services/distributorOrders.js'), 'utf8');

  assert.match(source, /formatDistributorOrderDate/);
  assert.match(source, /parseTimestamp/);

  // Parse serialized JSON timestamp from Node backend: { _seconds: 1775000000, _nanoseconds: 0 }
  const serialized = { _seconds: 1775000000, _nanoseconds: 0 };
  const notifSource = require('node:fs').readFileSync(path.join(root, 'services/notificationTimestamp.js'), 'utf8');
  const notifTransformed = babel.transformSync(notifSource, {
    babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const notifMod = {};
  vm.runInNewContext(notifTransformed, { Date, exports: notifMod, module: { exports: notifMod } });
  const parsed = notifMod.parseTimestamp(serialized);
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getTime(), 1775000000000);

  // Transform distributorOrders
  const transformed = babel.transformSync(source, {
    babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'],
  }).code;
  const modExports = {};
  vm.runInNewContext(transformed, {
    Date,
    exports: modExports,
    module: { exports: modExports },
    require: (id) => {
      if (id.includes('notificationTimestamp')) return notifMod;
      if (id.includes('uniqueIds')) {
        return {
          isPublicOrFormattedUniqueId: (v) => Boolean(v && typeof v === 'string' && /^(Req|Dis|Man)\d+/i.test(v)),
          formatDisplayUniqueId: (v) => v || 'Not set',
        };
      }
      if (id.includes('deliveryFailureReasons')) {
        return { formatDeliveryFailureReason: (v) => v || '' };
      }
      return {};
    },
  });

  const { formatDistributorOrderDate, toDistributorScreenOrder } = modExports;
  assert.equal(typeof formatDistributorOrderDate, 'function');
  const formatted = formatDistributorOrderDate(serialized);
  assert.notEqual(formatted, 'Not set');
  assert.ok(formatted.length > 5);

  const screenOrder = toDistributorScreenOrder({
    id: 'order-1',
    scheduledAt: serialized,
    requesterUid: 'req-1',
  });
  assert.notEqual(screenOrder.scheduledDateTime, 'Not set');
  assert.equal(screenOrder.requesterUid, 'req-1');
});
