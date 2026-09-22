const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isActiveRequesterOrderStatus,
  isHistoryRequesterOrderStatus,
  requesterOrderStatusLabel,
} = require('../../../constants/requesterOrderStatus');

test('every current Requester lifecycle state remains active', () => {
  for (const status of [
    'Pending',
    'outside_radius_pending_approval',
    'awaiting_distributor_assignment',
    'distributor_assigned',
    'assigned',
    'branch_transfer_pending',
    'accepted',
    'scheduled',
    'out_for_delivery',
  ]) {
    assert.equal(isActiveRequesterOrderStatus(status), true, `${status} should remain active`);
    assert.equal(isHistoryRequesterOrderStatus(status), false, `${status} should not appear in History`);
  }
});

test('terminal Requester lifecycle states leave Active Orders and enter History', () => {
  for (const status of [
    'delivered',
    'cancelled',
    'declined',
    'rejected',
    'declined_outside_service_area',
  ]) {
    assert.equal(isActiveRequesterOrderStatus(status), false, `${status} should not remain active`);
    assert.equal(isHistoryRequesterOrderStatus(status), true, `${status} should appear in History`);
  }
});

test('Requester status labels hide transport-oriented backend values', () => {
  assert.equal(requesterOrderStatusLabel('outside_radius_pending_approval'), 'Waiting for branch approval');
  assert.equal(requesterOrderStatusLabel('awaiting_distributor_assignment'), 'Waiting for distributor assignment');
  assert.equal(requesterOrderStatusLabel('branch_transfer_pending'), 'Branch transfer in progress');
  assert.equal(requesterOrderStatusLabel('out_for_delivery'), 'Out for delivery');
});
