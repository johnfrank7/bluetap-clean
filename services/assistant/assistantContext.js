import {
  isActiveRequesterOrderStatus,
  isHistoryRequesterOrderStatus,
  requesterOrderStatusLabel,
} from '../../constants/requesterOrderStatus';
import { formatDeliveryFailureReason } from '../../constants/deliveryFailureReasons';
import { getLocalDateKey } from './assistantStorage';

const clean = (value) => String(value || '').trim();

export function getSafeProfileUniqueId(profile = {}) {
  const safeProfile = profile || {};
  const candidate = clean(
    safeProfile.publicUid ||
    safeProfile.displayUid ||
    safeProfile.unique_id ||
    safeProfile.uniqueId
  );
  if (/^(Req|Dis|Man|Mgr|Adm|Acc)\d+$/i.test(candidate)) {
    const prefix = candidate.slice(0, 3).charAt(0).toUpperCase() + candidate.slice(1, 3).toLowerCase();
    const num = candidate.slice(3).padStart(3, '0');
    return `${prefix}${num}`;
  }
  return candidate;
}

export function formatTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : (typeof value?.toDate === 'function' ? value.toDate() : new Date(value));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function sanitizeOrder(order = {}) {
  const publicOrderId = clean(
    order.publicOrderId ||
    order.requestId ||
    order.request_id ||
    order.publicOrderReference ||
    (order.id ? `BT-${String(order.id).slice(-6).toUpperCase()}` : 'Order')
  );

  const status = clean(order.status || 'pending').toLowerCase().replace(/[\s-]+/g, '_');
  const statusLabel = requesterOrderStatusLabel(order.status);
  const branchName = clean(
    order.currentBranchName ||
    order.currentBranchNameSnapshot ||
    order.branchName ||
    order.branch_name ||
    order.branchNameSnapshot ||
    order.water_station ||
    'BlueTap Station'
  );
  const branchId = clean(
    order.currentBranchId ||
    order.branchId ||
    order.water_station_id ||
    order.branch ||
    ''
  );

  const productSummary = clean(
    order.itemsSummary ||
    order.item_name ||
    order.productName ||
    (order.quantity ? `${order.quantity} container(s)` : 'Mineral Water')
  );

  const totalAmount = Number(order.totalAmount ?? order.total ?? order.price ?? 0);
  const total = Number.isFinite(totalAmount) && totalAmount > 0 ? `₱${totalAmount.toFixed(2)}` : '';

  const scheduleRaw = order.scheduledAt || order.scheduled_at || order.delivery_date || order.deliverySchedule;
  const schedule = formatTime(scheduleRaw);

  const safeFailureReason = formatDeliveryFailureReason(order, '');

  const isOutsideRadius = Boolean(
    order.outsideRadiusPendingApproval ||
    order.isOutsideRadius ||
    order.outside_radius ||
    status.includes('outside_radius')
  );

  return {
    id: clean(order.id || order.sourceId || order.orderId), // Retained internally for navigation target only
    publicOrderId,
    status,
    statusLabel,
    branchName,
    branchId,
    productSummary,
    quantity: Number(order.quantity) || 1,
    total,
    schedule,
    safeFailureReason,
    isOutsideRadius,
    isDelivered: status === 'delivered',
    isCancelled: ['cancelled', 'canceled'].includes(status),
    isFailed: status.includes('delivery_failed'),
  };
}

export function sanitizeRestriction(restriction = {}) {
  const category = clean(restriction.category || 'account conduct').toLowerCase().replace(/_/g, ' ');
  const scope = Array.isArray(restriction.scope)
    ? restriction.scope.map(clean)
    : [clean(restriction.scope || 'platform_ordering')];
  const branchName = clean(restriction.branchName || restriction.branch_name || '');
  const branchId = clean(restriction.branchId || restriction.branch_id || '');
  const endsAt = formatTime(restriction.endsAt || restriction.ends_at);

  return {
    id: clean(restriction.id),
    scope,
    branchName,
    branchId,
    category,
    endsAt,
    title: clean(restriction.title || (scope.includes('chat') ? 'Chat restriction' : 'Ordering restriction')),
  };
}

export function sanitizeNotification(notification = {}) {
  return {
    id: clean(notification.id),
    kind: clean(notification.kind || notification.type || 'order'),
    status: clean(notification.status || 'info'),
    title: clean(notification.title || 'Notification'),
    message: clean(notification.message || notification.body || ''),
    time: formatTime(notification.at || notification.createdAt || notification.created_at),
  };
}

export function sanitizeBranch(branch = {}) {
  return {
    id: clean(branch.id || branch.branchId),
    name: clean(branch.name || branch.branchName || 'BlueTap Station'),
    address: clean(branch.completeAddress || branch.address || branch.barangay || ''),
    coverageRadius: branch.coverageRadius || branch.radiusKm || 5,
    isActive: branch.isActive !== false,
  };
}

export function sanitizeProduct(product = {}) {
  const name = clean(product.product_name || product.name || 'Mineral Water');
  const containerType = clean(product.containerType || product.capacity || '');
  const size = clean(product.size || '');
  const price = typeof product.price === 'number' && Number.isFinite(product.price) ? Math.round(product.price * 100) / 100 : null;
  return {
    id: clean(product.id),
    name,
    product_name: name,
    containerType,
    size,
    price,
    active: product.active !== false,
  };
}

export function buildSafeAssistantContext({
  requesterData = {},
  moderationNotices = {},
  roleNotifications = {},
  catalogProducts = [],
  products = [],
} = {}) {
  const profile = requesterData.profile || {};
  const firstNameFromProfile = clean(profile.firstName);
  const fullName = clean(
    profile.fullName ||
    profile.full_name ||
    profile.name ||
    (firstNameFromProfile ? `${firstNameFromProfile} ${clean(profile.lastName)}`.trim() : '') ||
    requesterData.displayName ||
    ''
  );
  const firstName = firstNameFromProfile || fullName.split(/\s+/)[0] || 'Requester';
  const publicId = getSafeProfileUniqueId(profile) || '';
  const userId = clean(
    requesterData.uid ||
    profile.uid ||
    profile.id ||
    profile.unique_id ||
    profile.uniqueId ||
    publicId ||
    ''
  );

  const rawOrders = Array.isArray(requesterData.orders) ? requesterData.orders : [];
  const sanitizedOrders = rawOrders.map(sanitizeOrder);

  const activeOrders = sanitizedOrders.filter((order) => isActiveRequesterOrderStatus(order.status));
  const historyOrders = sanitizedOrders.filter((order) => isHistoryRequesterOrderStatus(order.status));
  const primaryActiveOrder = activeOrders[0] || null;

  const rawRestrictions = Array.isArray(moderationNotices.activeRestrictions)
    ? moderationNotices.activeRestrictions
    : [];
  const orderingRestrictions = rawRestrictions
    .filter((r) => r.scope?.includes('ordering'))
    .map(sanitizeRestriction);
  const chatRestrictions = rawRestrictions
    .filter((r) => r.scope?.includes('chat'))
    .map(sanitizeRestriction);

  const rawNotifications = Array.isArray(roleNotifications.events) ? roleNotifications.events : [];
  const recentNotifications = rawNotifications.slice(0, 5).map(sanitizeNotification);

  const rawBranches = Array.isArray(requesterData.branches) ? requesterData.branches : [];
  const availableBranches = rawBranches.filter((b) => b.isActive !== false).slice(0, 8).map(sanitizeBranch);

  const rawProducts = Array.isArray(catalogProducts) && catalogProducts.length > 0
    ? catalogProducts
    : (Array.isArray(products) && products.length > 0 ? products : (Array.isArray(requesterData.products) ? requesterData.products : []));
  const availableProducts = rawProducts
    .filter((p) => p && p.active !== false)
    .slice(0, 10)
    .map(sanitizeProduct);

  const hasActiveRestriction = orderingRestrictions.length > 0 || chatRestrictions.length > 0;
  const activeRestriction = orderingRestrictions[0] || chatRestrictions[0] || null;

  return {
    requester: {
      firstName,
      fullName,
      publicId,
      userId,
    },
    activeOrder: primaryActiveOrder,
    activeOrders,
    hasActiveOrder: Boolean(primaryActiveOrder),
    hasPendingOrder: Boolean(primaryActiveOrder && primaryActiveOrder.status === 'pending'),
    hasActiveRestriction,
    activeRestriction,
    recentOrders: historyOrders.slice(0, 5),
    historyOrders: historyOrders.slice(0, 5),
    restrictions: {
      ordering: orderingRestrictions,
      chat: chatRestrictions,
      hasOrderingRestriction: orderingRestrictions.length > 0,
      hasChatRestriction: chatRestrictions.length > 0,
    },
    recentNotifications,
    notifications: recentNotifications,
    availableBranches,
    branches: availableBranches,
    products: availableProducts,
    availableProducts,
  };
}

export const buildSafeRequesterContext = buildSafeAssistantContext;

const FAILED_DELIVERY_CHAT_GRACE_MS = 60 * 60 * 1000;

export function evaluateDistributorOrderChatAuthority(order = {}, now = Date.now()) {
  const status = clean(order.status || '').toLowerCase().replace(/[\s-]+/g, '_');
  const nowMs = typeof now === 'number' ? now : (now instanceof Date ? now.getTime() : Date.now());

  if (['delivered', 'completed'].includes(status)) {
    return {
      chatAllowed: false,
      chatState: 'delivered',
      chatGraceActive: false,
      chatEndsAt: null,
      explanation: 'Messaging for this delivery has ended because the order is already delivered.',
    };
  }

  if (status.includes('delivery_failed') || status.includes('failed')) {
    const persistedGrace = order.distributorChatGraceUntil || order.deliveryFailureChatEndsAt || null;
    let graceEndsMs = 0;
    if (persistedGrace) {
      graceEndsMs = typeof persistedGrace === 'number' ? persistedGrace : (typeof persistedGrace?.toDate === 'function' ? persistedGrace.toDate().getTime() : new Date(persistedGrace).getTime());
    } else {
      const failedAt =
        order.failedAt ||
        order.failed_at ||
        order.deliveryFailedAt ||
        order.delivery_failed_at ||
        order.updatedAt ||
        order.updated_at ||
        null;
      const failedMs = failedAt ? (typeof failedAt === 'number' ? failedAt : (typeof failedAt?.toDate === 'function' ? failedAt.toDate().getTime() : new Date(failedAt).getTime())) : 0;
      if (failedMs > 0) {
        graceEndsMs = failedMs + FAILED_DELIVERY_CHAT_GRACE_MS;
      }
    }

    if (graceEndsMs > 0 && nowMs < graceEndsMs) {
      return {
        chatAllowed: true,
        chatState: 'failed_grace_active',
        chatGraceActive: true,
        chatEndsAt: graceEndsMs,
        explanation: 'You can still contact the requester during the temporary failed-delivery follow-up period.',
      };
    }

    return {
      chatAllowed: false,
      chatState: 'failed_grace_expired',
      chatGraceActive: false,
      chatEndsAt: graceEndsMs || null,
      explanation: 'The follow-up messaging period for this delivery has ended.',
    };
  }

  const TERMINAL = new Set(['cancelled', 'canceled', 'rejected', 'declined', 'declined_outside_service_area']);
  if (TERMINAL.has(status)) {
    return {
      chatAllowed: false,
      chatState: 'closed',
      chatGraceActive: false,
      chatEndsAt: null,
      explanation: 'This order is closed and does not grant messaging authority.',
    };
  }

  return {
    chatAllowed: true,
    chatState: 'active',
    chatGraceActive: false,
    chatEndsAt: null,
    explanation: 'Direct messaging with the requester is available for this active delivery.',
  };
}

export function formatSafeAddressLabel(address, fallbackObj = null) {
  if (typeof address === 'object' && address !== null) {
    if (address.barangay || address.city) {
      return [address.street, address.barangay, address.city].filter(Boolean).join(', ');
    }
    if (address.addressText) return String(address.addressText).trim();
    if (address.label) return String(address.label).trim();
  }
  if (typeof address === 'string') {
    if (!/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(address.trim())) {
      return address.trim();
    }
  }
  if (fallbackObj && (fallbackObj.barangay || fallbackObj.city)) {
    return [fallbackObj.street, fallbackObj.barangay, fallbackObj.city].filter(Boolean).join(', ');
  }
  return 'Delivery Address';
}

export function sanitizeDistributorOrder(order = {}, { now = Date.now() } = {}) {
  const publicOrderId = clean(
    order.publicOrderId ||
    order.orderId ||
    order.requestId ||
    order.request_id ||
    order.publicOrderReference ||
    (order.id ? `BT-${String(order.id).slice(-6).toUpperCase()}` : 'Order')
  );

  const status = clean(order.status || 'pending').toLowerCase().replace(/[\s-]+/g, '_');
  const statusLabel = requesterOrderStatusLabel(order.status);
  const branchName = clean(
    order.currentBranchName ||
    order.currentBranchNameSnapshot ||
    order.branchName ||
    order.branch_name ||
    order.water_station ||
    'BlueTap Station'
  );
  const branchId = clean(
    order.currentBranchId ||
    order.branchId ||
    order.water_station_id ||
    order.branch ||
    ''
  );

  const requesterName = clean(
    order.requesterName ||
    order.customerName ||
    order.requester_name ||
    'Requester'
  );

  const productSummary = clean(
    order.itemsSummary ||
    order.item_name ||
    order.productName ||
    (order.quantity ? `${order.quantity} container(s)` : 'Mineral Water')
  );

  const totalAmount = Number(order.totalAmount ?? order.total ?? order.price ?? 0);
  const total = Number.isFinite(totalAmount) && totalAmount > 0 ? `₱${totalAmount.toFixed(2)}` : '';

  const scheduleRaw =
    order.scheduledDate ||
    order.scheduledAt ||
    order.scheduled_at ||
    order.delivery_date ||
    order.expectedDeliveryDate ||
    order.deliverySchedule;
  const schedule = formatTime(scheduleRaw);
  const scheduledDateKey =
    order.scheduledDateKey || (scheduleRaw ? getLocalDateKey(scheduleRaw) : '');

  const safeAddressLabel = formatSafeAddressLabel(order.deliveryAddress || order.address || order.customerAddress, order);
  const safeFailureReason = formatDeliveryFailureReason(order, '');
  const chatAuth = evaluateDistributorOrderChatAuthority(order, now);

  const isFailed = status.includes('delivery_failed') || status.includes('failed');
  const isDelivered = ['delivered', 'completed'].includes(status);
  const isCancelled = ['cancelled', 'canceled', 'rejected', 'declined'].includes(status);

  return {
    id: clean(order.id || order.sourceId || order.orderId),
    publicOrderId,
    requesterName,
    status,
    statusLabel,
    branchName,
    branchId,
    productSummary,
    quantity: Number(order.quantity) || 1,
    total,
    schedule,
    scheduledDateKey,
    safeAddressLabel,
    safeFailureReason,
    isFailed,
    isDelivered,
    isCancelled,
    isScheduled: ['scheduled', 'accepted', 'distributor_assigned'].includes(status),
    isOutForDelivery: ['out_for_delivery', 'out for delivery'].includes(status),
    chatAllowed: chatAuth.chatAllowed,
    chatState: chatAuth.chatState,
    chatGraceActive: chatAuth.chatGraceActive,
    chatEndsAt: chatAuth.chatEndsAt,
    chatExplanation: chatAuth.explanation,
  };
}

export function buildSafeDistributorContext({
  distributorData = {},
  moderationNotices = {},
  roleNotifications = {},
  now = Date.now(),
} = {}) {
  const profile = distributorData.profile || {};
  const firstNameFromProfile = clean(profile.firstName);
  const fullName = clean(
    profile.fullName ||
    profile.full_name ||
    profile.name ||
    (firstNameFromProfile ? `${firstNameFromProfile} ${clean(profile.lastName)}`.trim() : '') ||
    distributorData.displayName ||
    ''
  );
  const firstName = firstNameFromProfile || fullName.split(/\s+/)[0] || 'Distributor';
  const publicId = getSafeProfileUniqueId(profile) || clean(profile.distributorId) || '';
  const userId = clean(
    distributorData.uid ||
    profile.uid ||
    profile.id ||
    profile.unique_id ||
    profile.distributorId ||
    publicId ||
    ''
  );
  const branchId = clean(profile.branchId || profile.branch_id || distributorData.branchId || '');
  const branchName = clean(
    profile.branchName ||
    profile.branch_name ||
    profile.waterStation ||
    profile.water_station ||
    'BlueTap Station'
  );

  const rawOrders = Array.isArray(distributorData.orders) ? distributorData.orders : [];
  const sanitizedOrders = rawOrders.map((ord) => sanitizeDistributorOrder(ord, { now }));

  // Primary active assignment
  const activeAssignments = sanitizedOrders.filter((ord) =>
    ['out_for_delivery', 'scheduled', 'accepted', 'distributor_assigned', 'pending'].includes(ord.status) ||
    (ord.isFailed && ord.chatGraceActive)
  );
  const currentAssignment = activeAssignments[0] || null;

  // Today's schedule
  const todayKey = getLocalDateKey(now);
  const todaySchedule = sanitizedOrders
    .filter((ord) => ord.scheduledDateKey === todayKey && !ord.isDelivered && !ord.isCancelled)
    .slice(0, 5);

  // Next delivery
  const upcomingDeliveries = sanitizedOrders
    .filter((ord) => ['scheduled', 'out_for_delivery', 'accepted', 'distributor_assigned'].includes(ord.status));
  const nextDelivery = upcomingDeliveries[0] || null;

  // History
  const recentHistory = sanitizedOrders
    .filter((ord) => ord.isDelivered)
    .slice(0, 5);

  // Notifications
  const rawNotifications = Array.isArray(roleNotifications.events) ? roleNotifications.events : [];
  const recentNotifications = rawNotifications.slice(0, 5).map(sanitizeNotification);

  // Restrictions
  const rawRestrictions = Array.isArray(moderationNotices.activeRestrictions)
    ? moderationNotices.activeRestrictions
    : [];
  const orderingRestrictions = rawRestrictions
    .filter((r) => r.scope?.includes('ordering'))
    .map(sanitizeRestriction);
  const chatRestrictions = rawRestrictions
    .filter((r) => r.scope?.includes('chat'))
    .map(sanitizeRestriction);

  const isDeliveryFailed = Boolean(currentAssignment && currentAssignment.isFailed);

  return {
    role: 'distributor',
    distributor: {
      firstName,
      fullName,
      publicId,
      userId,
      distributorId: publicId,
      branchId,
      branchName,
    },
    currentAssignment,
    hasActiveAssignment: Boolean(currentAssignment && !currentAssignment.isFailed),
    isDeliveryFailed,
    todaySchedule,
    hasSchedule: todaySchedule.length > 0,
    nextDelivery,
    hasNextDelivery: Boolean(nextDelivery),
    recentHistory,
    hasHistory: recentHistory.length > 0,
    notifications: recentNotifications,
    recentNotifications,
    restrictions: {
      ordering: orderingRestrictions,
      chat: chatRestrictions,
      hasOrderingRestriction: orderingRestrictions.length > 0,
      hasChatRestriction: chatRestrictions.length > 0,
    },
    branch: {
      id: branchId,
      name: branchName,
    },
  };
}
