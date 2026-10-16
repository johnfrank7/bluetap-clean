const REVIEW_STATUS = 'pending';
const DISPATCH_STATUS = 'awaiting_distributor_assignment';
const EDITABLE_STATUSES = new Set([DISPATCH_STATUS, 'distributor_assigned', 'accepted', 'scheduled']);
const ONGOING_ASSIGNED_STATUSES = new Set([
  'distributor_assigned',
  'assigned',
  'accepted',
  'scheduled',
  'rescheduled',
  'out_for_delivery',
  'delivery_failed',
]);
const COMPLETED_ORDER_STATUSES = new Set([
  'delivered',
  'cancelled',
  'canceled',
  'declined',
  'rejected',
  'declined_outside_service_area',
]);
const PENDING_ORDER_STATUSES = new Set([
  REVIEW_STATUS,
  'outside_radius_pending_approval',
  'manager_approval_pending',
  'branch_transfer_pending',
  DISPATCH_STATUS,
]);
const ONGOING_PROGRESS_STEPS = ['Assigned', 'Scheduled', 'Out for Delivery', 'Delivered'];
const ONGOING_STATUS_RANK = {
  out_for_delivery: 0,
  delivery_failed: 1,
  scheduled: 2,
  rescheduled: 2,
  accepted: 3,
  distributor_assigned: 4,
  assigned: 4,
};

const statusOf = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const ownBranch = (order) => String(order?.currentBranchId || order?.branchId || '').trim();
const assignedUid = (order) => String(order?.assignedDistributorUid || order?.distributor_id || '').trim();
const belongsToBranch = (order, branchId) => !!branchId && ownBranch(order) === branchId;
const needsReview = (order) => statusOf(order?.status) === REVIEW_STATUS && order?.outsideServiceArea !== true;
const needsException = (order) => ['outside_radius_pending_approval', 'manager_approval_pending'].includes(statusOf(order?.status));
const needsDispatch = (order) => {
  const status = statusOf(order?.status);
  return (status === DISPATCH_STATUS && !assignedUid(order)) || (status === 'delivery_failed' && !!assignedUid(order));
};
const timestampToMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};
const lastStatusUpdateOf = (order) =>
  order?.lastStatusUpdateAt ||
  order?.updatedAt ||
  order?.updated_at ||
  order?.outForDeliveryAt ||
  order?.deliveryFailedAt ||
  order?.scheduledAt ||
  order?.distributorAcceptedAt ||
  order?.distributorAssignedAt ||
  order?.dispatchReadyAt ||
  order?.managerApprovedAt ||
  order?.managerAcceptedAt ||
  order?.createdAt ||
  order?.created_at ||
  null;
const queueTime = (order) => {
  const value = order?.dispatchReadyAt || order?.managerApprovedAt || order?.managerAcceptedAt || order?.createdAt || order?.created_at;
  return timestampToMillis(value);
};
const compareDispatchPriority = (left, right) => queueTime(left) - queueTime(right) || String(left?.id || '').localeCompare(String(right?.id || ''));
const canEdit = (order) => EDITABLE_STATUSES.has(statusOf(order?.status));

const isOngoingAssignedOrder = (order, branchId = '') => {
  if (branchId && !belongsToBranch(order, branchId)) return false;
  if (!assignedUid(order)) return false;
  return ONGOING_ASSIGNED_STATUSES.has(statusOf(order?.status));
};

const isCompletedManagerOrder = (order) => COMPLETED_ORDER_STATUSES.has(statusOf(order?.status));

const isPendingManagerOrder = (order) => {
  if (isCompletedManagerOrder(order) || isOngoingAssignedOrder(order)) return false;
  return PENDING_ORDER_STATUSES.has(statusOf(order?.status)) || !assignedUid(order);
};

const compareOngoingOrders = (left, right) => {
  const leftRank = ONGOING_STATUS_RANK[statusOf(left?.status)] ?? 5;
  const rightRank = ONGOING_STATUS_RANK[statusOf(right?.status)] ?? 5;
  if (leftRank !== rightRank) return leftRank - rightRank;
  const timeDiff = timestampToMillis(lastStatusUpdateOf(right)) - timestampToMillis(lastStatusUpdateOf(left));
  if (timeDiff !== 0) return timeDiff;
  return String(left?.id || '').localeCompare(String(right?.id || ''));
};

function getOngoingDeliveryProgress(order = {}) {
  const status = statusOf(order?.status);
  if (status === 'delivery_failed') {
    return {
      status,
      isException: true,
      linearSupported: false,
      activeStepIndex: -1,
      statusLabel: 'Delivery Issue Reported',
      steps: ONGOING_PROGRESS_STEPS.map((label) => ({
        key: label.toLowerCase().replace(/\s+/g, '_'),
        label,
        completed: false,
        current: false,
        upcoming: true,
      })),
    };
  }
  let activeStepIndex = -1;
  if (status === 'distributor_assigned' || status === 'assigned' || status === 'accepted') {
    activeStepIndex = 0;
  } else if (status === 'scheduled' || status === 'rescheduled') {
    activeStepIndex = 1;
  } else if (status === 'out_for_delivery') {
    activeStepIndex = 2;
  } else if (status === 'delivered') {
    activeStepIndex = 3;
  }
  const linearSupported = activeStepIndex >= 0;
  return {
    status,
    isException: false,
    linearSupported,
    activeStepIndex,
    steps: ONGOING_PROGRESS_STEPS.map((label, index) => ({
      key: label.toLowerCase().replace(/\s+/g, '_'),
      label,
      completed: linearSupported && activeStepIndex > index,
      current: linearSupported && activeStepIndex === index,
      upcoming: !linearSupported || activeStepIndex < index,
    })),
  };
}

function getManagerQueues(orders = [], incomingTransfers = [], branchId = '') {
  const owned = orders.filter((order) => belongsToBranch(order, branchId));
  const transfers = incomingTransfers.filter((order) =>
    statusOf(order.status) === 'branch_transfer_pending' && order.transferToBranchId === branchId);
  const ongoing = owned.filter((order) => isOngoingAssignedOrder(order, branchId)).sort(compareOngoingOrders);
  const pendingOrders = owned.filter(isPendingManagerOrder);
  const completed = owned
    .filter(isCompletedManagerOrder)
    .sort((left, right) => timestampToMillis(lastStatusUpdateOf(right)) - timestampToMillis(lastStatusUpdateOf(left)));
  return {
    review: owned.filter(needsReview),
    exceptions: owned.filter(needsException),
    dispatch: owned.filter(needsDispatch).sort(compareDispatchPriority),
    editable: owned.filter(canEdit),
    ongoing,
    pendingOrders,
    completed,
    incomingTransfers: transfers,
    requestsCount: owned.filter((order) => needsReview(order) || needsException(order)).length + transfers.length,
    dispatchCount: owned.filter(needsDispatch).length,
    ongoingCount: ongoing.length,
  };
}

function toManagerOrder(id, data = {}, branchName = '', branchUsers = []) {
  const items = Array.isArray(data.items) ? data.items.map((item) => ({
    ...item,
    productId: item.productId || item.product_id || item.id || '',
    productNameSnapshot: item.productNameSnapshot || item.product_name || item.name || '',
    quantity: Number(item.quantity) || 0,
  })) : [];
  const distUid = assignedUid(data);
  const matchedDistributor = distUid && Array.isArray(branchUsers)
    ? branchUsers.find((user) => String(user?.uid || user?.id || '').trim() === distUid)
    : null;
  const totalQuantity = items.length > 0
    ? items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
    : (Number(data.quantity ?? data.totalQuantity) || 0);
  const productSummary = items.length > 0
    ? items.map((item) => `${item.productNameSnapshot || 'Water Refill'} x${item.quantity || 1}`).join(', ')
    : (data.productNameSnapshot || data.product_name || data.productName || '');
  return {
    ...data,
    id,
    requestId: data.requestId || data.request_id || id,
    requesterName: data.requesterNameSnapshot || data.requesterName || data.requester_name || 'Requester',
    requesterUniqueId: data.requesterUniqueIdSnapshot || data.requester_unique_id || '',
    currentBranchName: data.currentBranchNameSnapshot || data.branchNameSnapshot || branchName,
    address: data.addressSnapshot || data.address || data.deliveryAddress || '',
    items,
    totalQuantity,
    productSummary,
    container: data.container || data.containerType || data.container_type || '',
    scheduledDate: data.scheduledDate || data.scheduled_date || '',
    scheduledWindow: data.scheduledWindow || data.scheduled_window || '',
    scheduledAt: data.scheduledAt || data.scheduled_at || data.scheduledDeliveryAt || data.scheduledDate || null,
    lastStatusUpdateAt: lastStatusUpdateOf(data),
    totalAtOrder: Number(data.totalAtOrder ?? data.total_cost) || 0,
    deliveryFeeAtOrder: Number(data.deliveryFeeAtOrder ?? data.deliveryFee) || 0,
    assignedDistributorName:
      data.assignedDistributorNameSnapshot ||
      data.assignedDistributorName ||
      data.distributor_name ||
      matchedDistributor?.fullName ||
      matchedDistributor?.name ||
      '',
    assignedDistributorUniqueId:
      data.assignedDistributorUniqueIdSnapshot ||
      data.assignedDistributorUniqueId ||
      data.distributorPublicUidSnapshot ||
      data.distributor_unique_id ||
      data.distributorUniqueId ||
      matchedDistributor?.publicUid ||
      matchedDistributor?.displayUid ||
      matchedDistributor?.uniqueId ||
      '',
    distributorUniqueId:
      data.distributorPublicUidSnapshot ||
      data.assignedDistributorUniqueIdSnapshot ||
      data.assignedDistributorUniqueId ||
      data.distributor_unique_id ||
      data.distributorUniqueId ||
      matchedDistributor?.publicUid ||
      matchedDistributor?.displayUid ||
      matchedDistributor?.uniqueId ||
      '',
    assignedDistributorUid: distUid,
    status: statusOf(data.status),
  };
}

function pendingBranchApplications(users = [], branchId = '') {
  return users.filter((user) => user.role === 'distributor' && user.requestedBranchId === branchId &&
    statusOf(user.distributorStatus || user.approvalStatus || user.status) === 'pending');
}

function extractBranchRequesters(requests = [], users = []) {
  const map = new Map();
  users.forEach((user) => {
    if (String(user.role || '').toLowerCase() === 'requester') {
      const id = user.uid || user.id;
      if (id) {
        map.set(id, {
          ...user,
          id,
          uid: id,
          role: 'requester',
        });
      }
    }
  });
  requests.forEach((req) => {
    const uid = req.requesterUid || req.requester_id || req.userId || req.user_id;
    if (uid) {
      const existing = map.get(uid) || {};
      map.set(uid, {
        id: uid,
        uid,
        role: 'requester',
        fullName: existing.fullName || req.requesterNameSnapshot || req.requester_name || req.requesterName || 'Unnamed Requester',
        email: existing.email || req.requesterEmail || '',
        phone: existing.phone || req.contactNumberSnapshot || req.contact_number || req.requesterContact || '',
        address: existing.address || req.addressSnapshot || req.address || req.deliveryAddress || 'Not set',
        barangay: existing.barangay || req.barangay || 'Not set',
        publicUid: existing.publicUid || req.requesterUniqueIdSnapshot || req.requester_unique_id || req.requesterUniqueId || uid,
        displayUid: existing.displayUid || req.requesterUniqueIdSnapshot || req.requester_unique_id || req.requesterUniqueId || uid,
        uniqueId: existing.uniqueId || req.requesterUniqueIdSnapshot || req.requester_unique_id || req.requesterUniqueId || uid,
        createdAt: existing.createdAt || req.createdAt || req.created_at || null,
        branchSuspended: existing.branchSuspended === true,
      });
    }
  });
  return Array.from(map.values()).sort((a, b) =>
    (a.fullName || '').localeCompare(b.fullName || '')
  );
}

module.exports = {
  REVIEW_STATUS,
  DISPATCH_STATUS,
  EDITABLE_STATUSES,
  ONGOING_ASSIGNED_STATUSES,
  COMPLETED_ORDER_STATUSES,
  PENDING_ORDER_STATUSES,
  ONGOING_PROGRESS_STEPS,
  statusOf,
  belongsToBranch,
  needsReview,
  needsException,
  needsDispatch,
  compareDispatchPriority,
  canEdit,
  isOngoingAssignedOrder,
  isCompletedManagerOrder,
  isPendingManagerOrder,
  compareOngoingOrders,
  getOngoingDeliveryProgress,
  getManagerQueues,
  toManagerOrder,
  pendingBranchApplications,
  extractBranchRequesters,
};
