const {
  belongsToBranch,
  isCompletedManagerOrder,
  isOngoingAssignedOrder,
  isPendingManagerOrder,
  needsException,
  needsReview,
  statusOf,
} = require('./managerOperational');

const TARGET_HIGHLIGHT_DURATION_MS = 2800;

function matchesOrderIdentifier(order = {}, requestedOrderId = '') {
  const target = String(requestedOrderId || '').trim();
  if (!target || !order) return false;
  const candidates = [
    order.id,
    order.orderId,
    order.requestId,
    order.request_id,
  ]
    .map((val) => String(val || '').trim())
    .filter(Boolean);
  return candidates.includes(target);
}

function classifyManagerOrderSection(order = {}, branchId = '') {
  const status = statusOf(order?.status);
  const transferTo = String(order?.transferToBranchId || '').trim();
  if (status === 'branch_transfer_pending' && branchId && transferTo === String(branchId).trim()) {
    return {
      section: 'transfers',
      ordersTab: null,
      revealDecisions: false,
      sectionTitle: 'Branch Transfer Reviews & Outcomes',
    };
  }
  if (needsReview(order)) {
    return {
      section: 'review',
      ordersTab: 'pending',
      revealDecisions: false,
      sectionTitle: 'Upcoming & Active Branch Orders',
    };
  }
  if (needsException(order)) {
    return {
      section: 'exceptions',
      ordersTab: 'pending',
      revealDecisions: false,
      sectionTitle: 'Order Approvals',
    };
  }
  if (isOngoingAssignedOrder(order, branchId)) {
    return {
      section: 'branchOrders',
      ordersTab: 'ongoing',
      revealDecisions: false,
      sectionTitle: 'Branch Orders & Situational Edits',
    };
  }
  if (isCompletedManagerOrder(order)) {
    return {
      section: 'branchOrders',
      ordersTab: 'completed',
      revealDecisions: false,
      sectionTitle: 'Branch Orders & Situational Edits',
    };
  }
  if (isPendingManagerOrder(order)) {
    return {
      section: 'branchOrders',
      ordersTab: 'pending',
      revealDecisions: false,
      sectionTitle: 'Branch Orders & Situational Edits',
    };
  }
  return {
    section: 'branchOrders',
    ordersTab: 'all',
    revealDecisions: false,
    sectionTitle: 'Branch Orders & Situational Edits',
  };
}

function resolveManagerOrderTarget(
  requestedOrderId,
  {
    requests = [],
    incomingTransfers = [],
    sourceDecisionEvents = [],
    branchId = '',
    loading = false,
  } = {}
) {
  const rawParam = Array.isArray(requestedOrderId) ? requestedOrderId[0] : requestedOrderId;
  const targetRef = String(rawParam || '').trim();
  if (!targetRef) {
    return {
      status: 'none',
      targetRef: '',
      canonicalOrderId: '',
      order: null,
      decisionEvent: null,
      section: null,
      ordersTab: null,
      revealDecisions: false,
      sectionTitle: '',
      fallbackMessage: '',
    };
  }

  const normalizedBranchId = String(branchId || '').trim();
  if (!normalizedBranchId) {
    return {
      status: 'loading',
      targetRef,
      canonicalOrderId: '',
      order: null,
      decisionEvent: null,
      section: null,
      ordersTab: null,
      revealDecisions: false,
      sectionTitle: '',
      fallbackMessage: '',
    };
  }

  const ownedRequests = (Array.isArray(requests) ? requests : []).filter((order) =>
    belongsToBranch(order, normalizedBranchId)
  );
  const authorizedTransfers = (Array.isArray(incomingTransfers) ? incomingTransfers : []).filter(
    (order) =>
      statusOf(order?.status) === 'branch_transfer_pending' &&
      String(order?.transferToBranchId || '').trim() === normalizedBranchId
  );

  // Prefer exact document id match first, then public requestId match
  const combinedOrders = [...ownedRequests, ...authorizedTransfers];
  const matchedOrder =
    combinedOrders.find((order) => String(order?.id || '').trim() === targetRef) ||
    combinedOrders.find((order) => matchesOrderIdentifier(order, targetRef)) ||
    null;

  if (matchedOrder) {
    const classification = classifyManagerOrderSection(matchedOrder, normalizedBranchId);
    const canonicalOrderId = String(matchedOrder.id || matchedOrder.requestId || targetRef).trim();
    return {
      status: 'resolved',
      targetRef,
      canonicalOrderId,
      order: matchedOrder,
      decisionEvent: null,
      ...classification,
      fallbackMessage: '',
    };
  }

  const authorizedDecisions = (Array.isArray(sourceDecisionEvents) ? sourceDecisionEvents : []).filter(
    (event) => String(event?.sourceBranchId || '').trim() === normalizedBranchId
  );
  const matchedDecision =
    authorizedDecisions.find((event) => matchesOrderIdentifier(event, targetRef)) || null;

  if (matchedDecision) {
    const canonicalOrderId = String(
      matchedDecision.id || matchedDecision.orderId || matchedDecision.requestId || targetRef
    ).trim();
    return {
      status: 'resolved_decision',
      targetRef,
      canonicalOrderId,
      order: null,
      decisionEvent: matchedDecision,
      section: 'transfers',
      ordersTab: null,
      revealDecisions: true,
      sectionTitle: 'Branch Transfer Reviews & Outcomes',
      fallbackMessage: '',
    };
  }

  if (loading) {
    return {
      status: 'loading',
      targetRef,
      canonicalOrderId: '',
      order: null,
      decisionEvent: null,
      section: null,
      ordersTab: null,
      revealDecisions: false,
      sectionTitle: '',
      fallbackMessage: '',
    };
  }

  return {
    status: 'unavailable',
    targetRef,
    canonicalOrderId: '',
    order: null,
    decisionEvent: null,
    section: null,
    ordersTab: null,
    revealDecisions: false,
    sectionTitle: '',
    fallbackMessage: `Order ${targetRef} could not be found in this branch or is no longer available.`,
  };
}

module.exports = {
  TARGET_HIGHLIGHT_DURATION_MS,
  matchesOrderIdentifier,
  resolveManagerOrderTarget,
};
