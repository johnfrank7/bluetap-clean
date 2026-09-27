const { belongsToBranch, statusOf } = require('./managerOperational');

const deliveryMessages = {
  ASSIGNMENT_ACCEPTED: ['Distributor accepted the assignment.', 'accepted', '/manager/distributors'],
  ASSIGNMENT_DECLINED: ['Distributor declined the assignment. Reassignment is needed.', 'delivery_failed', '/manager/distributors'],
  DELIVERY_SCHEDULED: ['Delivery was scheduled.', 'scheduled', '/manager/distributors'],
  DELIVERY_STARTED: ['Delivery is out for delivery.', 'out_for_delivery', '/manager/distributors'],
  DELIVERY_FAILED: ['Delivery failed. Review the delivery note.', 'delivery_failed', '/manager/distributors'],
  DELIVERY_RESCHEDULED: ['Delivery was rescheduled.', 'scheduled', '/manager/distributors'],
  DELIVERY_COMPLETED: ['Order was delivered.', 'delivered', '/manager/distributors'],
};

function getManagerNotifications(orders = [], incomingTransfers = [], decisions = [], branchId = '', parseTimestamp) {
  if (!branchId || typeof parseTimestamp !== 'function') return [];
  const events = [];
  const add = (id, order, message, status, at, path) => {
    const date = parseTimestamp(at);
    if (!date) return;
    events.push({ id, orderId: order.id, requestId: order.requestId || order.request_id || order.id,
      requesterName: order.requesterNameSnapshot || order.requesterName || 'Requester', message, status, at: date, path, order });
  };
  for (const order of orders.filter((item) => belongsToBranch(item, branchId))) {
    const status = statusOf(order.status);
    if ((order.initialBranchId || order.branchId) === branchId) {
      add(`${order.id}:received`, order, order.outsideServiceArea === true || status === 'outside_radius_pending_approval'
        ? 'Outside-radius request needs branch review.' : 'New branch order received.', status === 'outside_radius_pending_approval' ? status : 'pending', order.createdAt || order.created_at, '/manager/request');
    }
    if (status === 'cancelled' || status === 'canceled') add(`${order.id}:cancelled`, order, 'Requester cancelled the order.', 'cancelled', order.cancelledAt || order.updatedAt, '/manager/request');
    for (const [index, edit] of ((order.initialBranchId || order.branchId) === branchId && Array.isArray(order.editHistory) ? order.editHistory : []).entries()) {
      if (edit.role === 'requester' || edit.editedByRole === 'requester') add(`${order.id}:requester-edit:${index}`, order, 'Requester updated the order.', 'edited', edit.editedAt || edit.createdAt, '/manager/request');
    }
    for (const [index, entry] of (Array.isArray(order.assignmentHistory) ? order.assignmentHistory : []).entries()) {
      const declineAt = parseTimestamp(entry.declinedAt || entry.createdAt);
      const acceptedTransferAt = parseTimestamp(order.transferAcceptedAt);
      const ownAssignment = (order.initialBranchId || order.branchId) === branchId ||
        (declineAt && acceptedTransferAt && declineAt.getTime() >= acceptedTransferAt.getTime());
      if (entry.event === 'ASSIGNMENT_DECLINED' && ownAssignment) add(`${order.id}:assignment-declined:${index}`, order,
        entry.declineReason ? `Distributor declined the assignment: ${entry.declineReason}` : 'Distributor declined the assignment. Reassignment is needed.',
        'delivery_failed', entry.declinedAt || entry.createdAt, '/manager/distributors');
    }
    for (const [index, entry] of (Array.isArray(order.distributorDeliveryHistory) ? order.distributorDeliveryHistory : []).entries()) {
      const definition = deliveryMessages[entry.event];
      if (definition && entry.branchId === branchId && entry.event !== 'ASSIGNMENT_DECLINED') {
        add(`${order.id}:delivery:${index}`, order, definition[0], definition[1], entry.createdAt, definition[2]);
      }
    }
  }
  for (const order of incomingTransfers.filter((item) => item.transferToBranchId === branchId && statusOf(item.status) === 'branch_transfer_pending')) {
    add(`${order.id}:incoming-transfer:${order.transferRequestId || ''}`, order, 'Incoming branch transfer needs review.', 'branch_transfer_pending', order.transferRequestedAt, '/manager/request');
  }
  for (const decision of decisions.filter((item) => item.sourceBranchId === branchId)) {
    const date = parseTimestamp(decision.decidedAt || decision.createdAt);
    if (!date) continue;
    events.push({ id: `transfer-decision:${decision.id}`, orderId: decision.orderId,
      requestId: decision.requestIdSnapshot || decision.orderId, requesterName: '',
      message: `Branch transfer ${decision.decision === 'accepted' ? 'accepted' : 'declined'} by ${decision.targetBranchNameSnapshot || 'target branch'}.`,
      status: decision.decision === 'accepted' ? 'accepted' : 'declined', at: date, path: '/manager/request',
      order: {
        id: decision.orderId,
        requestId: decision.requestIdSnapshot || decision.orderId,
        status: decision.decision === 'accepted' ? 'accepted' : 'declined',
        branchNameSnapshot: decision.sourceBranchNameSnapshot || '',
        transferToBranchName: decision.targetBranchNameSnapshot || '',
        transferDeclineReason: decision.declineReason || '',
      } });
  }
  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 150);
}

const unreadManagerNotifications = (events, seenIds) => events.filter((event) => !seenIds.has(event.id));

function getManagerNotificationDetail(event = {}) {
  const order = event.order || {};
  return {
    status: event.status || statusOf(order.status),
    requestId: event.requestId || order.requestId || order.request_id || order.id || '',
    requesterName: event.requesterName || order.requesterNameSnapshot || order.requesterName || '',
    requesterUniqueId: order.requesterUniqueIdSnapshot || order.requesterUniqueId || order.requester_unique_id || '',
    branchName: order.currentBranchNameSnapshot || order.branchNameSnapshot || order.water_station || '',
    items: Array.isArray(order.items) ? order.items.map((item) => ({
      id: item.id || item.productId || item.product_id || '',
      name: item.productNameSnapshot || item.productName || item.product_name || item.name || 'Product',
      quantity: Number(item.quantity) || 0,
    })) : [],
    deliveryAddress: order.addressSnapshot || order.deliveryAddress || order.address || '',
    distributorName: order.assignedDistributorNameSnapshot || order.assignedDistributorName || order.distributor_name || '',
    distributorUniqueId: order.assignedDistributorUniqueIdSnapshot || order.assignedDistributorUniqueId || order.distributor_unique_id || '',
    scheduledAt: order.scheduledAt || order.expectedDeliveryDate || null,
    deliveryFee: order.deliveryFeeAtOrder ?? order.deliveryFee,
    total: order.totalAtOrder ?? order.total_cost ?? order.grandTotalAmount,
    message: event.message || '',
    at: event.at || null,
  };
}

module.exports = { getManagerNotifications, getManagerNotificationDetail, unreadManagerNotifications };
