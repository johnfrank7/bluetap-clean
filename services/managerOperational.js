const REVIEW_STATUS = 'pending';
const DISPATCH_STATUS = 'awaiting_distributor_assignment';
const EDITABLE_STATUSES = new Set([DISPATCH_STATUS, 'distributor_assigned', 'accepted', 'scheduled']);

const statusOf = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const ownBranch = (order) => String(order?.currentBranchId || order?.branchId || '').trim();
const assignedUid = (order) => String(order?.assignedDistributorUid || order?.distributor_id || '').trim();
const belongsToBranch = (order, branchId) => !!branchId && ownBranch(order) === branchId;
const needsReview = (order) => statusOf(order?.status) === REVIEW_STATUS && order?.outsideServiceArea !== true;
const needsException = (order) => statusOf(order?.status) === 'outside_radius_pending_approval';
const needsDispatch = (order) => {
  const status = statusOf(order?.status);
  return (status === DISPATCH_STATUS && !assignedUid(order)) || (status === 'delivery_failed' && !!assignedUid(order));
};
const canEdit = (order) => EDITABLE_STATUSES.has(statusOf(order?.status));

function getManagerQueues(orders = [], incomingTransfers = [], branchId = '') {
  const owned = orders.filter((order) => belongsToBranch(order, branchId));
  const transfers = incomingTransfers.filter((order) =>
    statusOf(order.status) === 'branch_transfer_pending' && order.transferToBranchId === branchId);
  return {
    review: owned.filter(needsReview),
    exceptions: owned.filter(needsException),
    dispatch: owned.filter(needsDispatch),
    editable: owned.filter(canEdit),
    incomingTransfers: transfers,
    requestsCount: owned.filter((order) => needsReview(order) || needsException(order)).length + transfers.length,
    dispatchCount: owned.filter(needsDispatch).length,
  };
}

function toManagerOrder(id, data = {}, branchName = '') {
  const items = Array.isArray(data.items) ? data.items.map((item) => ({
    ...item,
    productId: item.productId || item.product_id || item.id || '',
    productNameSnapshot: item.productNameSnapshot || item.product_name || item.name || '',
    quantity: Number(item.quantity) || 0,
  })) : [];
  return {
    ...data,
    id,
    requestId: data.requestId || data.request_id || id,
    requesterName: data.requesterNameSnapshot || data.requesterName || data.requester_name || 'Requester',
    requesterUniqueId: data.requesterUniqueIdSnapshot || data.requester_unique_id || '',
    currentBranchName: data.currentBranchNameSnapshot || data.branchNameSnapshot || branchName,
    address: data.addressSnapshot || data.address || '',
    items,
    totalAtOrder: Number(data.totalAtOrder ?? data.total_cost) || 0,
    deliveryFeeAtOrder: Number(data.deliveryFeeAtOrder ?? data.deliveryFee) || 0,
    assignedDistributorName: data.assignedDistributorNameSnapshot || data.assignedDistributorName || data.distributor_name || '',
    assignedDistributorUid: assignedUid(data),
    status: statusOf(data.status),
  };
}

function pendingBranchApplications(users = [], branchId = '') {
  return users.filter((user) => user.role === 'distributor' && user.requestedBranchId === branchId &&
    statusOf(user.distributorStatus || user.approvalStatus || user.status) === 'pending');
}

module.exports = { REVIEW_STATUS, DISPATCH_STATUS, EDITABLE_STATUSES, statusOf, belongsToBranch,
  needsReview, needsException, needsDispatch, canEdit, getManagerQueues, toManagerOrder, pendingBranchApplications };
