const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  formatNotificationBadge,
  getChatFollowupNotifications,
  getDistributorAttentionCounts,
  getRoleOrderNotifications,
} = require('../../../services/orderNotifications');
const {
  DELIVERY_FAILURE_REASONS,
  formatDeliveryFailureReason,
} = require('../../../constants/deliveryFailureReasons');
const {
  orderDetailPathForRole,
  orderDetailTarget,
} = require('../../../services/orderNavigation');
const {
  notificationSeverity,
} = require('../../../components/notificationPresentation');

const root = path.resolve(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Requester scheduled and delivery-failure notifications use authoritative order state', () => {
  const scheduled = getRoleOrderNotifications([{
    id: 'order-one',
    requestId: 'BT-2026-0001',
    status: 'scheduled',
    scheduledAt: '2026-10-03T01:00:00.000Z',
    currentBranchNameSnapshot: 'BlueTap North',
  }], 'requester', Date.parse('2026-10-01T00:00:00.000Z'));
  assert.equal(scheduled.length, 1);
  assert.match(scheduled[0].message, /Order BT-2026-0001 has been approved and scheduled for delivery on/);
  assert.match(scheduled[0].message, /Provider: BlueTap North/);

  const failed = getRoleOrderNotifications([{
    id: 'order-two', requestId: 'BT-2026-0002', status: 'delivery_failed',
    deliveryFailedAt: '2026-10-01T01:00:00.000Z', failureReasonCode: 'CUSTOMER_UNAVAILABLE',
  }], 'requester', Date.parse('2026-10-01T02:00:00.000Z'));
  assert.equal(failed.length, 1);
  assert.equal(failed[0].message, 'Delivery attempt failed for Order BT-2026-0002. Reason: Customer unavailable.');
  assert.deepEqual(getRoleOrderNotifications([failed[0].order], 'requester', Date.parse('2026-10-01T02:00:00.000Z')).map((event) => event.id), [failed[0].id]);
});

test('structured and legacy failure reasons remain display compatible', () => {
  assert.equal(DELIVERY_FAILURE_REASONS.length, 10);
  assert.equal(formatDeliveryFailureReason({ failureReasonCode: 'NO_RESPONSE' }), 'Customer did not respond');
  assert.equal(formatDeliveryFailureReason({ failureReasonCode: 'OTHER', failureReasonLabel: 'Other', failureReasonNote: 'Gate was locked' }), 'Other: Gate was locked');
  assert.equal(formatDeliveryFailureReason({ failureReasonLabel: 'Address could not be confirmed' }), 'Address could not be confirmed');
  assert.equal(formatDeliveryFailureReason({ failureReason: 'Legacy free-text reason' }), 'Legacy free-text reason');
});

test('delivery failure formatting is null-safe for empty and non-failed order state', () => {
  assert.doesNotThrow(() => formatDeliveryFailureReason(null));
  assert.equal(formatDeliveryFailureReason(null), '');
  assert.equal(formatDeliveryFailureReason(undefined), '');
  assert.equal(formatDeliveryFailureReason({}), '');
  assert.equal(formatDeliveryFailureReason({ status: 'scheduled' }), '');
  assert.equal(formatDeliveryFailureReason(null, 'Delivery issue reported'), 'Delivery issue reported');
});

test('notification severity distinguishes success, information, warning, restriction, and cancellation without color alone', () => {
  assert.equal(notificationSeverity('delivered').kind, 'success');
  assert.equal(notificationSeverity('scheduled').kind, 'info');
  assert.equal(notificationSeverity('out_for_delivery').kind, 'delivery');
  assert.equal(notificationSeverity('pending').kind, 'warning');
  assert.equal(notificationSeverity('outside_radius_pending_approval').kind, 'warning');
  assert.equal(notificationSeverity('review').kind, 'warning');
  assert.equal(notificationSeverity('warning').kind, 'warning');
  assert.equal(notificationSeverity('restricted').kind, 'restricted');
  assert.equal(notificationSeverity('cancelled').kind, 'error');
  assert.notEqual(notificationSeverity('warning').icon, notificationSeverity('restricted').icon);
  assert.notEqual(notificationSeverity('restricted').icon, notificationSeverity('cancelled').icon);
  assert.notEqual(notificationSeverity('warning').accent, notificationSeverity('restricted').accent);
  assert.notEqual(notificationSeverity('warning').soft, notificationSeverity('warning', true).soft);

  for (const file of ['app/requester/r_notification.jsx', 'app/distributor/d_notification.jsx', 'app/manager/notifications.jsx']) {
    const source = read(file);
    assert.match(source, /NotificationCard/);
  }
  const card = read('components/NotificationCard.jsx');
  assert.match(card, /notificationSeverity\(status, dark\)/);
  assert.match(card, /accessibilityLabel=\{`\$\{tone\.label\} notification`\}/);
  assert.match(card, /tone\.icon/);
  assert.match(card, /flexWrap: 'wrap'/);
  assert.match(card, /borderLeftColor: tone\.accent/);
});

test('Requester and Distributor detail presentation tolerate a missing selected order', () => {
  const details = read('components/RequestDetailsModal.jsx');
  const requesterDashboard = read('app/requester/r_dashboard.jsx');
  const distributorDashboard = read('app/distributor/d_dashboard.jsx');

  assert.doesNotThrow(() => formatDeliveryFailureReason(null, ''));
  assert.equal(formatDeliveryFailureReason(null, ''), '');
  assert.match(details, /formatDeliveryFailureReason\(request, ''\)/);
  assert.match(details, /!!failureReason &&/);
  assert.match(requesterDashboard, /<RequestDetailsModal/);
  assert.match(distributorDashboard, /<RequestDetailsModal/);
});

test('Distributor action badges exclude terminal history and cap presentation at 99+', () => {
  assert.deepEqual(getDistributorAttentionCounts([
    { status: 'distributor_assigned' }, { status: 'pending' },
    { status: 'accepted' }, { status: 'scheduled' }, { status: 'delivery_failed' },
    { status: 'delivered' }, { status: 'cancelled' },
  ]), { requests: 2, schedule: 3 });
  assert.equal(formatNotificationBadge(0), '0');
  assert.equal(formatNotificationBadge(1), '1');
  assert.equal(formatNotificationBadge(99), '99');
  assert.equal(formatNotificationBadge(100), '99+');
});

test('order-linked chat follow-ups coalesce to one stable event per unread conversation epoch', () => {
  const conversation = {
    id: 'conversation-one', type: 'requester_branch', unreadCount: 3, notificationEpoch: 7,
    lastMessageAt: '2026-10-01T01:00:00.000Z',
    orderContextLocal: { id: 'order-one', requestId: 'BT-2026-0001' },
  };
  const first = getChatFollowupNotifications([conversation], 'manager');
  const second = getChatFollowupNotifications([conversation], 'manager');
  assert.equal(first.length, 1);
  assert.equal(first[0].message, 'Requester followed up on Order BT-2026-0001.');
  assert.equal(first[0].id, second[0].id);
  assert.deepEqual(getChatFollowupNotifications([{ ...conversation, unreadCount: 0 }], 'manager'), []);
  assert.deepEqual(getChatFollowupNotifications([{ ...conversation, type: 'requester_distributor' }], 'manager'), []);
});

test('role-aware order detail targets use verified existing route files', () => {
  const routes = {
    requester: ['/requester/r_notification', 'app/requester/r_notification.jsx'],
    distributor: ['/distributor/d_notification', 'app/distributor/d_notification.jsx'],
    manager: ['/manager/request', 'app/manager/request.jsx'],
  };
  for (const [role, [route, file]] of Object.entries(routes)) {
    assert.equal(orderDetailPathForRole(role), route);
    assert.deepEqual(orderDetailTarget(role, { id: 'order-one' }), { pathname: route, params: { orderId: 'order-one' } });
    assert.equal(fs.existsSync(path.join(root, file)), true);
  }
  assert.equal(orderDetailTarget('admin', { id: 'order-one' }), null);
});

test('shared UI sources keep dialogs bounded, bubbles content-sized, maps graceful, and badges hidden at zero', () => {
  const dialog = read('components/ResponsiveActionDialog.jsx');
  const deliveryDialog = read('components/DeliveryActionDialog.jsx');
  const bubble = read('components/chat/ChatMessageBubble.jsx');
  const details = read('components/RequestDetailsModal.jsx');
  const header = read('components/BlueTapHeader.jsx');
  const nav = read('components/AppBottomNav.jsx');
  assert.match(dialog, /maxWidth: 500/);
  assert.match(dialog, /width: '100%'/);
  assert.match(dialog, /KeyboardAvoidingView/);
  assert.match(deliveryDialog, /Confirm Delivered/);
  assert.match(deliveryDialog, /DELIVERY_FAILURE_REASONS\.map/);
  assert.match(bubble, /maxWidth: '100%'/);
  assert.match(bubble, /overflowWrap: 'anywhere'/);
  assert.match(details, /Delivery Location Map/);
  assert.match(details, /Location unavailable/);
  assert.match(details, /maxWidth: 640/);
  assert.match(details, /height - \(compact \? 24 : 40\)/);
  assert.match(details, /compactGridRow/);
  assert.match(details, /compactProductMeta/);
  assert.match(details, /style=\{styles\.scroll\}/);
  assert.match(header, /unseenCount > 0 &&/);
  assert.match(nav, /badgeCount > 0 &&/);
});

test('authorized role detail entry points pass map snapshots to the shared dashed-distance map', () => {
  const distributorDashboard = read('app/distributor/d_dashboard.jsx');
  const distributorHistory = read('app/distributor/d_history.jsx');
  const requesterDashboard = read('app/requester/r_dashboard.jsx');
  const requesterOrders = read('app/requester/r_request.jsx');
  const requesterNotifications = read('app/requester/r_notification.jsx');
  const requesterProvider = read('components/RoleDataProviders.jsx');
  const details = read('components/RequestDetailsModal.jsx');
  const managerRequests = read('app/manager/request.jsx');
  const map = read('components/LocationMap.jsx');
  for (const source of [distributorDashboard, distributorHistory, requesterDashboard, requesterOrders]) {
    assert.match(source, /deliveryLocation/);
    assert.match(source, /branchLocation/);
    assert.match(source, /RequestDetailsModal/);
  }
  for (const source of [requesterDashboard, requesterOrders, requesterNotifications]) assert.match(source, /branches=/);
  assert.match(requesterProvider, /getActiveBranches/);
  assert.match(details, /branchMapDataForRequest\(request, branches\)/);
  assert.match(details, /branches=\{branchMapData \? \[branchMapData\] : \[\]\}/);
  assert.match(managerRequests, /Delivery Location Map/);
  assert.match(managerRequests, /<LocationMap/);
  assert.match(map, /requesterPosition = requester \? position\(requester\) : null/);
  assert.match(map, /screenPosition: position\(point\)/);
  assert.match(map, /projectedOverlayGeometry\(requesterPosition, selectedBranchPoint\.screenPosition\)/);
  assert.match(map, /distanceDash/);
  assert.match(map, /Dashed line shows straight-line distance estimate, not driving distance\./);
  assert.match(map, /onPress=\{fitView\}/);
});
