const assert = require('node:assert/strict');
const test = require('node:test');

const { getCurrentDistributorRequests, getDistributorDashboardCounts } = require('../../../services/distributorDashboardMetrics');

test('Current Requests keeps every active assignment and removes terminal orders after realtime updates', () => {
  const active = getCurrentDistributorRequests([
    { id: 'assigned', status: 'distributor_assigned' }, { id: 'accepted', status: 'accepted' },
    { id: 'failed', status: 'delivery_failed' }, { id: 'delivered', status: 'delivered' }, { id: 'cancelled', status: 'cancelled' },
  ]);
  assert.deepEqual(active.map((order) => order.id), ['assigned', 'accepted', 'failed']);
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
    scheduledToday: 2,
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
