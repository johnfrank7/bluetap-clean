const { formatDeliveryFailureReason } = require('../constants/deliveryFailureReasons');

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const clean = (value) => String(value || '').trim();
const statusOf = (value) => clean(value).toLowerCase().replace(/[\s-]+/g, '_');
const orderIdOf = (order = {}) => clean(order.sourceId || order.id || order.orderId || order.requestId || order.request_id);
const orderReferenceOf = (order = {}) => clean(order.requestId || order.request_id || order.publicOrderReference || order.id);

const dateOf = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.toMillis === 'function') return new Date(value.toMillis());
  if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const date = new Date(typeof value === 'number' && value < 1e11 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date;
};

function lifecycleTimestamp(order = {}) {
  const status = statusOf(order.status);
  if (status === 'delivered') return order.deliveredAt || order.delivered_at || order.updatedAt;
  if (status === 'delivery_failed') return order.deliveryFailedAt || order.delivery_failed_at || order.updatedAt;
  if (status === 'out_for_delivery') return order.deliveryStartedAt || order.outForDeliveryAt || order.updatedAt;
  if (status === 'scheduled') return order.scheduledAt || order.scheduled_at || order.delivery_date || order.updatedAt;
  if (status === 'accepted') return order.acceptedAt || order.accepted_at || order.updatedAt;
  if (status === 'distributor_assigned') return order.assignedAt || order.assigned_at || order.updatedAt;
  if (['cancelled', 'canceled'].includes(status)) return order.cancelledAt || order.canceled_at || order.updatedAt;
  return order.updatedAt || order.updated_at || order.createdAt || order.created_at;
}

const formatSchedule = (value) => {
  const date = dateOf(value);
  if (!date) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function requesterMessage(order) {
  const reference = orderReferenceOf(order) || 'your order';
  const provider = clean(order.currentBranchName || order.currentBranchNameSnapshot || order.branchNameSnapshot || order.water_station) || 'your provider';
  const status = statusOf(order.status);
  if (status === 'scheduled') {
    const schedule = formatSchedule(order.scheduledAt || order.scheduled_at || order.delivery_date);
    return schedule
      ? `Order ${reference} has been approved and scheduled for delivery on ${schedule}. Provider: ${provider}.`
      : `Order ${reference} has been approved and scheduled by ${provider}.`;
  }
  if (status === 'delivery_failed') return `Delivery attempt failed for Order ${reference}. Reason: ${formatDeliveryFailureReason(order, 'Delivery issue reported')}.`;
  if (status === 'awaiting_distributor_assignment') return `Order ${reference} was approved and is waiting for distributor assignment at ${provider}.`;
  if (status === 'distributor_assigned') return `A Distributor has been assigned to Order ${reference}.`;
  if (status === 'out_for_delivery') return `Order ${reference} is out for delivery.`;
  if (status === 'delivered') return `Order ${reference} was delivered.`;
  if (status === 'branch_transfer_pending') return `Order ${reference} has a branch transfer in progress.`;
  if (status === 'outside_radius_pending_approval' || status === 'manager_approval_pending') return `Order ${reference} is waiting for branch approval.`;
  if (status.includes('declined') || status.includes('rejected')) return `Order ${reference} was declined. Open the order for details.`;
  if (status === 'cancelled' || status === 'canceled') return `Order ${reference} was cancelled.`;
  return `Order ${reference} was sent to ${provider} and is awaiting review.`;
}

function distributorMessage(order) {
  const reference = orderReferenceOf(order) || 'your delivery';
  const requester = clean(order.requesterName || order.requesterNameSnapshot || order.requester || order.requester_name) || 'the requester';
  const status = statusOf(order.status);
  if (status === 'delivery_failed') return `Delivery ${reference} failed: ${formatDeliveryFailureReason(order, 'Delivery issue reported')}. Re-attempt scheduling is available.`;
  if (status === 'scheduled') return `Delivery ${reference} is scheduled for ${formatSchedule(order.scheduledAt || order.scheduled_at || order.delivery_date) || 'the assigned time'}.`;
  if (status === 'accepted') return `You accepted Delivery ${reference} for ${requester}.`;
  if (status === 'out_for_delivery') return `Delivery ${reference} is out for delivery to ${requester}.`;
  if (status === 'delivered') return `Delivery ${reference} was delivered to ${requester}.`;
  return `Delivery ${reference} was assigned to you.`;
}

function getRoleOrderNotifications(orders = [], role, now = Date.now()) {
  return orders.map((order) => {
    const at = dateOf(lifecycleTimestamp(order));
    const orderId = orderIdOf(order);
    const status = statusOf(order.status);
    if (!orderId || !at || at.getTime() < now - RETENTION_MS) return null;
    return {
      id: `order:${orderId}:${status}:${at.getTime()}`,
      kind: 'order',
      orderId,
      requestId: orderReferenceOf(order),
      status,
      at,
      message: role === 'distributor' ? distributorMessage(order) : requesterMessage(order),
      order,
    };
  }).filter(Boolean).sort((left, right) => right.at.getTime() - left.at.getTime()).slice(0, 150);
}

function getChatFollowupNotifications(conversations = [], role) {
  const allowedType = role === 'manager' ? 'requester_branch' : role === 'distributor' ? 'requester_distributor' : '';
  if (!allowedType) return [];
  return conversations.filter((conversation) => conversation.type === allowedType && conversation.unreadCount > 0 && conversation.orderContextLocal).map((conversation) => {
    const order = conversation.orderContextLocal;
    const orderId = orderIdOf(order);
    const requestId = orderReferenceOf(order);
    if (!orderId) return null;
    return {
      id: `chat:${conversation.id}:${conversation.notificationEpoch || 1}`,
      kind: 'chat_followup',
      orderId,
      requestId,
      status: 'message',
      at: dateOf(conversation.lastMessageAt || conversation.updatedAt) || new Date(),
      message: `Requester followed up on Order ${requestId || orderId}.`,
      order,
      conversationId: conversation.id,
    };
  }).filter(Boolean);
}

function getDistributorAttentionCounts(orders = []) {
  const statuses = orders.map((order) => statusOf(order.status));
  return {
    requests: statuses.filter((status) => ['distributor_assigned', 'pending'].includes(status)).length,
    schedule: statuses.filter((status) => ['accepted', 'scheduled', 'delivery_failed'].includes(status)).length,
  };
}

const formatNotificationBadge = (count) => count > 99 ? '99+' : String(Math.max(0, Number(count) || 0));

module.exports = {
  RETENTION_MS,
  dateOf,
  formatNotificationBadge,
  getChatFollowupNotifications,
  getDistributorAttentionCounts,
  getRoleOrderNotifications,
  lifecycleTimestamp,
  orderIdOf,
  requesterMessage,
  distributorMessage,
  statusOf,
};
