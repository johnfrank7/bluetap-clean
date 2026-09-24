const normalizeRequesterOrderStatus = (status) =>
  (status || 'Pending')
    .toString()
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

const TERMINAL_REQUESTER_ORDER_STATUSES = new Set([
  'delivered',
  'cancelled',
  'canceled',
  'declined',
  'rejected',
  'declined outside service area',
]);

// Active is intentionally defined as every known or future non-terminal
// fulfillment state so an operational state cannot disappear into History.
const isHistoryRequesterOrderStatus = (status) =>
  TERMINAL_REQUESTER_ORDER_STATUSES.has(normalizeRequesterOrderStatus(status));

const isActiveRequesterOrderStatus = (status) =>
  !isHistoryRequesterOrderStatus(status);

const REQUESTER_ORDER_STATUS_LABELS = {
  pending: 'Pending',
  'outside radius pending approval': 'Waiting for branch approval',
  'awaiting distributor assignment': 'Waiting for distributor assignment',
  'distributor assigned': 'Distributor assigned',
  assigned: 'Distributor assigned',
  'branch transfer pending': 'Branch transfer in progress',
  accepted: 'Accepted by distributor',
  scheduled: 'Scheduled for delivery',
  'out for delivery': 'Out for delivery',
  'delivery failed': 'Delivery failed (rescheduling)',
  'delivery failed rescheduling': 'Delivery failed (rescheduling)',
  rescheduled: 'Delivery rescheduled',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  declined: 'Declined',
  rejected: 'Rejected',
  'declined outside service area': 'Declined: outside service area',
};

const requesterOrderStatusLabel = (status) => {
  const normalizedStatus = normalizeRequesterOrderStatus(status);
  const knownLabel = REQUESTER_ORDER_STATUS_LABELS[normalizedStatus];

  if (knownLabel) return knownLabel;

  return normalizedStatus.replace(/\b\w/g, (character) => character.toUpperCase());
};

module.exports = {
  TERMINAL_REQUESTER_ORDER_STATUSES,
  REQUESTER_ORDER_STATUS_LABELS,
  isActiveRequesterOrderStatus,
  isHistoryRequesterOrderStatus,
  normalizeRequesterOrderStatus,
  requesterOrderStatusLabel,
};
