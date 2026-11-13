const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { Timestamp } = require('firebase-admin/firestore');
const { scheduleTimestampMillis } = require('../../utils/scheduleTimestamp');
const { schedulingEvent } = require('../../utils/schedulingEvent');
const { getEligibleBranchDistributors } = require('../../../services/managerFailedDeliveryResolution');
const { getRoleOrderNotifications } = require('../../../services/orderNotifications');

test('schedule timestamp parser supports Firestore, Date, serialized and invalid values', () => {
  const date = new Date('2030-01-01T00:00:00Z');
  for (const value of [date, Timestamp.fromDate(date), { _seconds: date.getTime() / 1000 }, date.toISOString(), date.getTime()]) {
    assert.equal(scheduleTimestampMillis(value), date.getTime());
  }
  for (const value of ['invalid', {}, { seconds: 4, nanoseconds: 1e9 }, new Date('invalid')]) assert.equal(scheduleTimestampMillis(value), null);
});

test('picker includes only explicitly approved same-branch Distributors', () => {
  const valid = { uid: 'd1', role: 'distributor', branchId: 'b1', distributorStatus: 'active', accountStatus: 'active' };
  const entries = [valid,
    ...['manager', 'requester', 'admin'].map((role) => ({ ...valid, uid: role, role })),
    { ...valid, uid: 'pending', distributorStatus: 'pending' },
    { ...valid, uid: 'wrong', branchId: 'b2' },
    { ...valid, uid: 'missing-branch', branchId: '' },
    { ...valid, uid: 'missing-status', distributorStatus: '' },
    { ...valid, uid: 'suspended', accountStatus: 'suspended' },
  ];
  const selected = getEligibleBranchDistributors(entries, 'b1', '', 'assign');
  assert.deepEqual(selected.map((item) => item.uid), ['d1']);
  assert.deepEqual(getEligibleBranchDistributors(selected, 'b1', '', 'assign').map((item) => item.uid), ['d1']);
});

test('notifications follow sequential committed scheduling events and replay deterministically', () => {
  const order = { id: 'order-1', status: 'scheduled', scheduledAt: '2030-01-05T00:00:00Z', rescheduleReason: 'Old manager note', assignmentHistory: [{ event: 'DELIVERY_RESCHEDULED_BY_MANAGER', rescheduledAt: '2030-01-01T00:00:00Z', rescheduleReason: 'Old manager note' }], distributorDeliveryHistory: [] };
  const now = Date.parse('2030-01-04T00:00:00Z');
  const event = () => getRoleOrderNotifications([order], 'requester', now)[0];
  assert.match(event().message, /Old manager note/);
  const firstId = event().id;
  assert.equal(event().id, firstId);
  order.distributorDeliveryHistory.push({ event: 'DELIVERY_RESCHEDULED', createdAt: '2030-01-02T00:00:00Z' });
  assert.doesNotMatch(event().message, /Old manager note/);
  assert.notEqual(event().id, firstId);
  order.assignmentHistory.push({ event: 'DISTRIBUTOR_REASSIGNED', assignedAt: '2030-01-03T00:00:00Z' });
  order.status = 'distributor_assigned';
  assert.match(event().message, /new Distributor/);
  assert.doesNotMatch(event().message, /Old manager note/);
  const reassignedId = event().id;
  assert.equal(event().id, reassignedId);
  order.status = 'scheduled';
  assert.doesNotMatch(event().message, /Old manager note/);
});

test('committed scheduling projection disambiguates events sharing a timestamp', () => {
  const at = new Date('2030-01-01T00:00:00Z');
  const order = { id: 'same-time', status: 'scheduled', scheduledAt: '2030-01-05T00:00:00Z', assignmentHistory: [], distributorDeliveryHistory: [] };
  order.latestSchedulingEvent = schedulingEvent(order, 'DELIVERY_RESCHEDULED_BY_MANAGER', at, 'Previous note');
  order.assignmentHistory.push({ event: 'DELIVERY_RESCHEDULED_BY_MANAGER', rescheduledAt: at, rescheduleReason: 'Previous note' });
  const first = getRoleOrderNotifications([order], 'requester', at.getTime())[0];
  assert.match(first.message, /Previous note/);
  order.latestSchedulingEvent = schedulingEvent(order, 'DELIVERY_RESCHEDULED', at);
  const second = getRoleOrderNotifications([order], 'requester', at.getTime())[0];
  assert.doesNotMatch(second.message, /Previous note/);
  assert.notEqual(second.id, first.id);
  assert.equal(getRoleOrderNotifications([order], 'requester', at.getTime())[0].id, second.id);
});

test('Manila schedule formatting is stable across device timezones and midnight', () => {
  const script = "const x=require('./services/managerFailedDeliveryResolution'); const d=new Date('2030-01-01T16:15:00Z'); console.log(x.formatManilaDate(d)+' '+x.formatManilaTime(d));";
  const output = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'].map((tz) => {
    const result = spawnSync(process.execPath, ['-e', script], { cwd: process.cwd(), env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  });
  assert.equal(new Set(output).size, 1);
  assert.match(output[0], /Jan 2/);
  assert.match(output[0], /12:15 AM/);
});
