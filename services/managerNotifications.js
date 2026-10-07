const { belongsToBranch, statusOf } = require('./managerOperational');

const { formatDeliveryFailureReason } = require('../constants/deliveryFailureReasons');

const deliveryMessages = {
  ASSIGNMENT_ACCEPTED: ['Distributor accepted the assignment.', 'accepted', '/manager/distributors'],
  ASSIGNMENT_DECLINED: ['Distributor declined the assignment. Reassignment is needed.', 'delivery_failed', '/manager/distributors'],
  DELIVERY_SCHEDULED: ['Delivery was scheduled.', 'scheduled', '/manager/distributors'],
  DELIVERY_STARTED: ['Delivery is out for delivery.', 'out_for_delivery', '/manager/distributors'],
  DELIVERY_FAILED: ['Delivery failed. Review the delivery note.', 'delivery_failed', '/manager/distributors'],
  DELIVERY_RESCHEDULED: ['Delivery was rescheduled.', 'scheduled', '/manager/distributors'],
  DELIVERY_COMPLETED: ['Order was delivered.', 'delivered', '/manager/distributors'],
};

const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function getManagerNotifications(orders = [], incomingTransfers = [], decisions = [], branchId = '', parseTimestamp, now = Date.now(), pendingApplications = [], branchName = '') {
  if (!branchId || typeof parseTimestamp !== 'function') return [];
  const events = [];
  const add = (id, order, message, status, at, path, navigable = true) => {
    const date = parseTimestamp(at);
    if (!date || date.getTime() < now - NOTIFICATION_RETENTION_MS) return;
    events.push({ id, orderId: order.id, requestId: order.requestId || order.request_id || order.id,
      requesterName: order.requesterNameSnapshot || order.requesterName || 'Requester', message, status, at: date, path, navigable, order });
  };
  for (const order of orders.filter((item) => belongsToBranch(item, branchId))) {
    const status = statusOf(order.status);
    if ((order.initialBranchId || order.branchId) === branchId) {
      const needsApproval = status === 'outside_radius_pending_approval' || status === 'manager_approval_pending';
      add(`${order.id}:received`, order, status === 'manager_approval_pending'
        ? 'Order quantity needs Manager approval.' : order.outsideServiceArea === true || status === 'outside_radius_pending_approval'
          ? 'Outside-radius request needs branch review.' : 'New branch order received.', needsApproval ? status : 'pending', order.createdAt || order.created_at, '/manager/request');
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
        const message = entry.event === 'DELIVERY_FAILED'
          ? `Delivery failed. Reason: ${formatDeliveryFailureReason(entry, formatDeliveryFailureReason(order, 'Delivery issue reported'))}.`
          : definition[0];
        add(`${order.id}:delivery:${index}`, order, message, definition[1], entry.createdAt, definition[2]);
      }
    }
  }
  for (const order of incomingTransfers.filter((item) => item.transferToBranchId === branchId && statusOf(item.status) === 'branch_transfer_pending')) {
    add(`${order.id}:incoming-transfer:${order.transferRequestId || ''}`, order, 'Incoming branch transfer needs review.', 'branch_transfer_pending', order.transferRequestedAt, '/manager/request');
  }
  for (const decision of decisions.filter((item) => item.sourceBranchId === branchId)) {
    const date = parseTimestamp(decision.decidedAt || decision.createdAt);
    if (!date || date.getTime() < now - NOTIFICATION_RETENTION_MS) continue;
    events.push({ id: `transfer-decision:${decision.id}`, orderId: decision.orderId,
      requestId: decision.requestIdSnapshot || decision.orderId, requesterName: '',
      message: `Branch transfer ${decision.decision === 'accepted' ? 'accepted' : 'declined'} by ${decision.targetBranchNameSnapshot || 'target branch'}.`,
      status: decision.decision === 'accepted' ? 'accepted' : 'declined', at: date, path: '/manager/request', navigable: false,
      order: {
        id: decision.orderId,
        requestId: decision.requestIdSnapshot || decision.orderId,
        status: decision.decision === 'accepted' ? 'accepted' : 'declined',
        branchNameSnapshot: decision.sourceBranchNameSnapshot || '',
        transferToBranchName: decision.targetBranchNameSnapshot || '',
        transferDeclineReason: decision.declineReason || '',
      } });
  }
  for (const applicant of (Array.isArray(pendingApplications) ? pendingApplications : [])) {
    const applicantBranchId = applicant.requestedBranchId || applicant.branchId;
    if (applicantBranchId && applicantBranchId !== branchId) continue;
    const at = applicant.createdAt || applicant.created_at;
    const date = parseTimestamp(at);
    if (!date || date.getTime() < now - NOTIFICATION_RETENTION_MS) continue;
    const targetBranchName = branchName || applicant.requestedBranchName || applicant.branchName || 'your branch';
    events.push({
      id: `applicant:${applicant.id || applicant.uid}`,
      orderId: '',
      requestId: applicant.displayUid || applicant.publicUid || applicant.id || applicant.uid || '',
      requesterName: applicant.fullName || applicant.full_name || 'Distributor applicant',
      message: `A new Distributor application is awaiting review for ${targetBranchName}.`,
      status: 'pending',
      at: date,
      path: '/manager/distributors',
      navigable: true,
      applicant,
    });
  }
  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 150);
}

const unreadManagerNotifications = (events, seenIds) => events.filter((event) => !seenIds.has(event.id));

function getManagerNotificationDetail(event) {
  const source = event || {};
  const order = source.order || {};
  return {
    status: source.status || statusOf(order.status),
    requestId: source.requestId || order.requestId || order.request_id || order.id || '',
    requesterName: source.requesterName || order.requesterNameSnapshot || order.requesterName || '',
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
    message: source.message || '',
    at: source.at || null,
  };
}

module.exports = { getManagerNotifications, getManagerNotificationDetail, unreadManagerNotifications };
