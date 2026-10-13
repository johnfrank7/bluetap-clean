import React from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { getApiUrl } from './apiClient';
import { formatDisplayUniqueId, isPublicOrFormattedUniqueId } from './uniqueIds';
import { subscribeProtectedReadSession, useProtectedReadSession } from './useProtectedReadSession';
const { protectedReadReadiness } = require('./protectedReadReadiness');
import { parseTimestamp } from './notificationTimestamp';
const { formatDeliveryFailureReason } = require('../constants/deliveryFailureReasons');

export async function getAssignedDistributorOrders() {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Distributor authentication is required.');
  const response = await fetch(getApiUrl('/api/distributor/orders'), { headers: { Authorization: `Bearer ${token}` } });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Assigned deliveries are temporarily unavailable.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  return result?.orders || [];
}

const normStatus = (s) => String(s || '').trim().toLowerCase().replace(/[_\s-]+/g, '_');

export function isDistributorActionCommitted(action, order, currentUid, payload = {}) {
  if (!order || typeof order !== 'object') return false;
  const normalizedAction = String(action || '').trim().toLowerCase();
  const status = normStatus(order.status);
  const orderDistributorUid = String(order.assignedDistributorUid || order.distributor_id || order.distributorUid || '').trim();
  const normalizedCurrentUid = String(currentUid || '').trim();

  // If expectedAssignmentVersion is supplied, verify it matches
  if (payload.expectedAssignmentVersion !== undefined && payload.expectedAssignmentVersion !== null && order.assignmentVersion !== undefined) {
    if (Number(order.assignmentVersion) !== Number(payload.expectedAssignmentVersion)) {
      return false;
    }
  }

  // If clientMutationId is provided and present in history, verify receipt
  if (payload.clientMutationId && Array.isArray(order.distributorDeliveryHistory)) {
    const receipt = order.distributorDeliveryHistory.find(
      (h) => h.clientMutationId === payload.clientMutationId
    );
    if (receipt) {
      if (receipt.distributorUid && receipt.distributorUid !== normalizedCurrentUid) {
        return false;
      }
      return true;
    }
  }

  switch (normalizedAction) {
    case 'accept-assignment':
      return orderDistributorUid === normalizedCurrentUid && (status === 'accepted' || status === 'scheduled');
    case 'start-delivery':
      return orderDistributorUid === normalizedCurrentUid && status === 'out_for_delivery';
    case 'fail-delivery': {
      const statusMatches = orderDistributorUid === normalizedCurrentUid && status === 'delivery_failed';
      if (!statusMatches) return false;
      if (payload.failureReasonCode) {
        if (String(order.failureReasonCode || '').trim() !== String(payload.failureReasonCode || '').trim()) {
          return false;
        }
      }
      if (payload.failureReasonNote !== undefined) {
        if (String(order.failureReasonNote || '').trim() !== String(payload.failureReasonNote || '').trim()) {
          return false;
        }
      }
      return true;
    }
    case 'mark-delivered':
      return orderDistributorUid === normalizedCurrentUid && status === 'delivered';
    case 'schedule-delivery':
    case 'reschedule-delivery':
      return orderDistributorUid === normalizedCurrentUid && status === 'scheduled';
    case 'decline-assignment':
      return status === 'declined' || status === 'pending' || (!!orderDistributorUid && orderDistributorUid !== normalizedCurrentUid);
    default:
      return false;
  }
}

export function isDistributorActionUnchanged(action, order, currentUid) {
  if (!order || typeof order !== 'object') return false;
  const normalizedAction = String(action || '').trim().toLowerCase();
  const status = normStatus(order.status);
  const orderDistributorUid = String(order.assignedDistributorUid || order.distributor_id || order.distributorUid || '').trim();
  const normalizedCurrentUid = String(currentUid || '').trim();

  if (orderDistributorUid !== normalizedCurrentUid) return false;

  switch (normalizedAction) {
    case 'accept-assignment':
      return status === 'distributor_assigned';
    case 'start-delivery':
      return status === 'accepted' || status === 'scheduled';
    case 'fail-delivery':
    case 'mark-delivered':
      return status === 'out_for_delivery';
    case 'schedule-delivery':
      return status === 'distributor_assigned' || status === 'accepted' || status === 'scheduled';
    case 'reschedule-delivery':
      return status === 'scheduled' || status === 'accepted';
    case 'decline-assignment':
      return status === 'distributor_assigned';
    default:
      return false;
  }
}

export async function reconcileAuthoritativeDistributorOrder(orderId, options = {}) {
  const normalizedOrderId = String(orderId || '').trim();
  if (!normalizedOrderId) return null;

  if (typeof options.fetchAuthoritativeOrder === 'function') {
    try {
      const order = await options.fetchAuthoritativeOrder(normalizedOrderId);
      if (order) return order;
    } catch {}
  }

  // 1. Try reading directly from Firestore
  try {
    if (db) {
      const snap = await getDoc(doc(db, 'requests', normalizedOrderId));
      if (snap.exists()) {
        return { id: snap.id, ...snap.data() };
      }
    }
  } catch {}

  // 2. Try fetching via authenticated getAssignedDistributorOrders API fallback
  try {
    const fetchFn = options.getAssignedOrders || getAssignedDistributorOrders;
    const orders = await fetchFn();
    if (Array.isArray(orders)) {
      const match = orders.find((o) => getOrderId(o) === normalizedOrderId);
      if (match) return match;
      // If the backend API call succeeded but the order is missing from assigned deliveries,
      // it authoritatively proves the order is no longer assigned to this distributor
      return { id: normalizedOrderId, status: 'unassigned_or_reassigned', assignedDistributorUid: null };
    }
  } catch {}

  // NOTE: Stale client cache (distributorOrderEntries) is intentionally NOT used as proof of mutation!
  return null;
}

export async function updateAssignedDistributorOrder(orderId, action, payload = {}, options = {}) {
  const currentUid = auth.currentUser?.uid;
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Distributor authentication is required.');

  const clientMutationId = String(
    payload.clientMutationId ||
    options.clientMutationId ||
    `dist_mut_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  ).trim();

  const expectedAssignmentVersion = payload.expectedAssignmentVersion ??
    options.expectedAssignmentVersion ??
    payload.assignmentVersion ??
    options.assignmentVersion;

  const requestBody = {
    orderId,
    action,
    clientMutationId,
    ...(expectedAssignmentVersion !== undefined && expectedAssignmentVersion !== null ? { expectedAssignmentVersion } : {}),
    ...payload,
  };

  let response;
  let networkOrServerError = null;

  try {
    response = await fetch(getApiUrl('/api/distributor/orders'), {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (fetchErr) {
    networkOrServerError = fetchErr;
  }

  if (response && response.ok) {
    const result = await response.json().catch(() => null);
    const order = result?.order || null;
    if (order) primeAssignedDistributorOrder(currentUid, order);
    return order;
  }

  // 4xx Client Rejections: definite rejection, throw immediately
  if (response && response.status >= 400 && response.status < 500) {
    const result = await response.json().catch(() => null);
    const error = new Error(result?.error?.message || 'The delivery could not be updated.');
    error.code = result?.error?.reason || 'client-error';
    error.status = response.status;
    error.rejected = true;
    throw error;
  }

  // Network error or 5xx: perform bounded authoritative reconciliation
  const maxAttempts = Number.isInteger(options.reconcileAttempts) ? options.reconcileAttempts : 2;
  const delayMs = Number.isInteger(options.reconcileDelay) ? options.reconcileDelay : 300;
  const reconciler = options.reconciler || reconcileAuthoritativeDistributorOrder;

  let authoritativeOrder = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      authoritativeOrder = await reconciler(orderId, options);
    } catch {
      authoritativeOrder = null;
    }
    if (authoritativeOrder && isDistributorActionCommitted(action, authoritativeOrder, currentUid, payload)) {
      break;
    }
  }

  if (authoritativeOrder) {
    // Case A: Confirmed operation success
    if (isDistributorActionCommitted(action, authoritativeOrder, currentUid, payload)) {
      const reconciled = { ...authoritativeOrder, reconciled: true };
      if (currentUid) primeAssignedDistributorOrder(currentUid, reconciled);
      return reconciled;
    }

    // Case C: Order still in pre-mutation status (delayed commit race safety)
    if (isDistributorActionUnchanged(action, authoritativeOrder, currentUid)) {
      const pendingError = new Error('Network connection was interrupted. The update may still be processing. Please refresh or check the order status before trying again.');
      pendingError.statusUnknown = true;
      pendingError.uncertain = true;
      pendingError.unchanged = true;
      pendingError.reconciledOrder = authoritativeOrder;
      throw pendingError;
    }

    // Case B: Confirmed backend rejection / reassigned / cancelled / incompatible transition
    const rejectedError = new Error('The delivery could not be updated because its status has changed.');
    rejectedError.rejected = true;
    rejectedError.reconciledOrder = authoritativeOrder;
    throw rejectedError;
  }

  // Case D: Operation result unknown / network loss
  const unknownError = new Error('Unable to confirm the action. Please refresh or check the order status.');
  unknownError.statusUnknown = true;
  if (networkOrServerError) {
    unknownError.originalError = networkOrServerError;
  }
  throw unknownError;
}

export const acceptAssignedOrder = (orderId, options = {}) => updateAssignedDistributorOrder(orderId, 'accept-assignment', {}, options);
export const declineAssignedOrder = (orderId, declineReason = '', options = {}) => updateAssignedDistributorOrder(orderId, 'decline-assignment', { declineReason }, options);
export const startAssignedDelivery = (orderId, options = {}) => updateAssignedDistributorOrder(orderId, 'start-delivery', {}, options);
export const failAssignedDelivery = (orderId, reason = {}, options = {}) => updateAssignedDistributorOrder(orderId, 'fail-delivery', {
  failureReasonCode: reason.failureReasonCode,
  failureReasonNote: reason.failureReasonNote || '',
}, options);
export const rescheduleAssignedDelivery = (orderId, scheduledAt, options = {}) => updateAssignedDistributorOrder(orderId, 'reschedule-delivery', { scheduledAt }, options);
export const completeAssignedDelivery = (orderId, options = {}) => updateAssignedDistributorOrder(orderId, 'mark-delivered', {}, options);

const dateFrom = (value) => parseTimestamp(value);

export const normalizeDistributorOrderStatus = (status) => String(status || '')
  .trim()
  .toLowerCase()
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ');

export const formatDistributorOrderDate = (value, fallback = 'Not set') => {
  const date = parseTimestamp(value);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : fallback;
};

function safeString(val, fallback = '') {
  if (val == null) return fallback;
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    if (val.addressText) return String(val.addressText).trim();
    if (val.address) return safeString(val.address, fallback);
    if (val.street || val.barangay || val.city) {
      return [val.street, val.barangay, val.city].filter(Boolean).join(', ');
    }
    if (val.name) return String(val.name).trim();
    if (val.fullName) return String(val.fullName).trim();
    if (val.label) return String(val.label).trim();
    try {
      return JSON.stringify(val);
    } catch {
      return fallback;
    }
  }
  return String(val);
}

export function toDistributorScreenOrder(order = {}) {
  const items = Array.isArray(order.items) ? order.items.filter(Boolean) : [];
  const quantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const productNames = items.map((item) => safeString(item.productNameSnapshot || item.product_name || item.name)).filter(Boolean);
  const totalAmount = Number(order.totalAtOrder || order.total_cost || order.totalAmount || 0);
  const scheduledRaw = order.scheduledAt || order.scheduledDateTime || order.expectedDeliveryDate || order.delivery_date || order.deliveryDate || order.scheduledDate || order.scheduleDate;
  const deliveryRaw = order.expectedDeliveryDate || order.delivery_date || order.deliveryDate || order.scheduledAt || order.scheduledDate;
  const deliveryDate = formatDistributorOrderDate(deliveryRaw, 'Not set');
  const scheduledDateTime = formatDistributorOrderDate(scheduledRaw, 'Not set');
  const status = safeString(order.status, 'distributor_assigned');
  const requestId = safeString(order.requestId || order.id || order.request_id, 'Not set');
  const requesterName = safeString(order.requesterName || order.customerName || order.requester_name, 'Not set');
  const rawRequesterUid = order.requesterUniqueId || order.requesterUniqueIdSnapshot || order.requester_unique_id || order.requesterPublicUid || order.requesterId;
  const formattedRequesterId = isPublicOrFormattedUniqueId(rawRequesterUid)
    ? formatDisplayUniqueId(rawRequesterUid)
    : 'Not assigned';

  const rawDistributorUid = order.assignedDistributorUniqueIdSnapshot || order.distributorUniqueId || order.distributor_unique_id || order.distributorPublicUid;
  const formattedDistributorId = isPublicOrFormattedUniqueId(rawDistributorUid)
    ? formatDisplayUniqueId(rawDistributorUid)
    : '';

  const mappedItems = items.map((item, index) => ({
    id: safeString(item.id || item.product_id || `${order.id || requestId}-${index}`),
    productName: safeString(item.productNameSnapshot || item.product_name || item.name, 'Product'),
    quantity: Number(item.quantity) || 0,
    unitPrice: Number(item.quantity) > 0 ? Number(item.totalAtOrder || item.line_total || 0) / Number(item.quantity) : Number(item.totalAtOrder || item.line_total || 0),
    subtotal: Number(item.totalAtOrder || item.line_total || 0),
  }));

  const rawAddress = order.deliveryAddress || order.address || order.deliveryLocation?.address;
  const resolvedAddress = safeString(rawAddress, 'Not set');

  return {
    sourceId: safeString(order.id || requestId, 'Not set'),
    id: requestId,
    requestId,
    status,
    requester: requesterName,
    customerName: requesterName,
    requesterName,
    requesterUid: safeString(order.requesterUid || order.requester_id || order.userId || order.user_id, ''),
    requesterId: formattedRequesterId,
    requesterUniqueId: formattedRequesterId,
    contact: safeString(order.contactNumber || order.contact_number || order.phone, 'Not set'),
    contactNumber: safeString(order.contactNumber || order.contact_number || order.phone, 'Not set'),
    address: resolvedAddress,
    deliveryAddress: resolvedAddress,
    productName: productNames[0] || 'Product',
    productsOrdered: productNames.length > 1 ? `${productNames[0]} +${productNames.length - 1} more` : productNames[0] || 'Product',
    quantity: quantity ? String(quantity) : 'Not set',
    container: safeString(order.container || order.containerType, 'Not set'),
    containerType: safeString(order.container || order.containerType, 'Not set'),
    totalAmount,
    total_cost: totalAmount,
    amountDue: `₱${totalAmount.toFixed(2)}`,
    amountPaid: `₱${totalAmount.toFixed(2)}`,
    deliveryDate,
    scheduledDateTime,
    deliveredDateTime: formatDistributorOrderDate(order.deliveredAt || order.updatedAt, 'Not set'),
    orderDate: formatDistributorOrderDate(order.createdAt, 'Not set'),
    waterStation: safeString(order.currentBranchName || order.branchNameSnapshot || order.waterStation || order.water_station, 'Not set'),
    paymentMethod: safeString(order.paymentMethod || order.payment_method, 'Not set'),
    distributorUid: safeString(order.assignedDistributorUid || order.distributor_id, ''),
    distributor: safeString(order.assignedDistributorName || order.distributor_name, ''),
    distributorName: safeString(order.assignedDistributorName || order.distributor_name, ''),
    distributorId: formattedDistributorId || 'Not assigned',
    distributorUniqueId: formattedDistributorId,
    items: mappedItems,
    grandTotalAmount: totalAmount,
    failureReason: formatDeliveryFailureReason(order, ''),
    failureReasonCode: safeString(order.failureReasonCode, ''),
    failureReasonLabel: safeString(order.failureReasonLabel, ''),
    failureReasonNote: safeString(order.failureReasonNote, ''),
    notes: safeString(order.notes || order.specialInstructions, ''),
    specialInstructions: safeString(order.notes || order.specialInstructions, ''),
    deliveryLocation: order.deliveryLocation || null,
    branchId: safeString(order.branchId || order.currentBranchId, ''),
    branchLocation: order.branchLocation || order.currentBranchLocation || null,
    assignmentVersion: order.assignmentVersion,
    subtotalAtOrder: (order.subtotalAtOrder ?? order.subtotal) !== undefined && (order.subtotalAtOrder ?? order.subtotal) !== null && (order.subtotalAtOrder ?? order.subtotal) !== '' && Number.isFinite(Number(order.subtotalAtOrder ?? order.subtotal))
      ? Number(order.subtotalAtOrder ?? order.subtotal)
      : undefined,
    subtotal: (order.subtotalAtOrder ?? order.subtotal) !== undefined && (order.subtotalAtOrder ?? order.subtotal) !== null && (order.subtotalAtOrder ?? order.subtotal) !== '' && Number.isFinite(Number(order.subtotalAtOrder ?? order.subtotal))
      ? Number(order.subtotalAtOrder ?? order.subtotal)
      : undefined,
    deliveryFeeAtOrder: (order.deliveryFeeAtOrder ?? order.deliveryFee ?? order.delivery_fee) !== undefined && (order.deliveryFeeAtOrder ?? order.deliveryFee ?? order.delivery_fee) !== null && (order.deliveryFeeAtOrder ?? order.deliveryFee ?? order.delivery_fee) !== '' && Number.isFinite(Number(order.deliveryFeeAtOrder ?? order.deliveryFee ?? order.delivery_fee))
      ? Number(order.deliveryFeeAtOrder ?? order.deliveryFee ?? order.delivery_fee)
      : undefined,
    deliveryFee: (order.deliveryFeeAtOrder ?? order.deliveryFee ?? order.delivery_fee) !== undefined && (order.deliveryFeeAtOrder ?? order.deliveryFee ?? order.delivery_fee) !== null && (order.deliveryFeeAtOrder ?? order.deliveryFee ?? order.delivery_fee) !== '' && Number.isFinite(Number(order.deliveryFeeAtOrder ?? order.deliveryFee ?? order.delivery_fee))
      ? Number(order.deliveryFeeAtOrder ?? order.deliveryFee ?? order.delivery_fee)
      : undefined,
    deliveryFeePolicy: order.deliveryFeePolicy || null,
    totalAtOrder: order.totalAtOrder !== undefined ? Number(order.totalAtOrder) : totalAmount,
    distanceKm: Number(order.distanceKmAtOrder || order.distanceKm || 0),
    distanceKmAtOrder: Number(order.distanceKmAtOrder || order.distanceKm || 0),
    scheduledAt: order.scheduledAt || null,
    deliveredAt: order.deliveredAt || null,
    rawScheduledAt: order.scheduledAt || order.expectedDeliveryDate || null,
    rawDeliveredAt: order.deliveredAt || order.updatedAt || null,
    rawCreatedAt: order.createdAt || null,
  };
}

const distributorOrderEntries = new Map();
const distributorOrdersError = (error) => error?.code === 'permission-denied'
  ? 'Your delivery access could not be verified. Please try again.'
  : error?.message || 'Assigned deliveries are temporarily unavailable.';

const getOrderId = (order = {}) => String(order.id || order.requestId || order.request_id || '').trim();
const orderSignature = (orders) => orders.map((order) => [
  getOrderId(order),
  order.status,
  dateFrom(order.updatedAt || order.updated_at)?.getTime() || 0,
  dateFrom(order.scheduledAt)?.getTime() || 0,
  dateFrom(order.deliveredAt)?.getTime() || 0,
].join('|')).join('::');

const getDistributorOrderEntry = (uid) => {
  if (!distributorOrderEntries.has(uid)) {
    distributorOrderEntries.set(uid, {
      orders: [],
      signature: '',
      loaded: false,
      hasLoadedOnce: false,
      refreshing: false,
      error: '',
      branchId: '',
      subscribers: new Set(),
      profileUnsubscribe: null,
      ordersUnsubscribe: null,
      refreshPromise: null,
      stopTimer: null,
      lastSnapshotTimestamp: 0,
      prevError: undefined,
      prevLoaded: undefined,
      prevRefreshing: undefined,
      prevHasLoadedOnce: undefined,
    });
  }
  return distributorOrderEntries.get(uid);
};

const emitDistributorOrders = (entry, force = false) => {
  const nextSignature = orderSignature(entry.orders);
  if (
    !force &&
    nextSignature === entry.signature &&
    entry.prevError === entry.error &&
    entry.prevLoaded === entry.loaded &&
    entry.prevRefreshing === entry.refreshing &&
    entry.prevHasLoadedOnce === entry.hasLoadedOnce
  ) {
    return;
  }
  entry.signature = nextSignature;
  entry.prevError = entry.error;
  entry.prevLoaded = entry.loaded;
  entry.prevRefreshing = entry.refreshing;
  entry.prevHasLoadedOnce = entry.hasLoadedOnce;
  const state = {
    orders: entry.orders,
    loading: !entry.loaded,
    hasLoadedOnce: !!entry.hasLoadedOnce,
    refreshing: !!entry.refreshing,
    error: entry.error,
  };
  entry.subscribers.forEach((listener) => listener(state));
};

const hydrateDistributorOrders = (uid, entry) => {
  if (entry.refreshPromise) return entry.refreshPromise;
  const fetchStartTime = Date.now();
  entry.refreshing = !!entry.hasLoadedOnce;
  emitDistributorOrders(entry, true);
  entry.refreshPromise = getAssignedDistributorOrders()
    .then((orders) => {
      const existing = new Map(entry.orders.map((order) => [getOrderId(order), order]));
      const isSnapshotNewer = entry.lastSnapshotTimestamp && entry.lastSnapshotTimestamp > fetchStartTime;
      const hydrated = (Array.isArray(orders) ? orders : []).map((order) => {
        const cached = existing.get(getOrderId(order));
        if (cached && isSnapshotNewer) {
          return { ...order, ...cached };
        }
        return { ...(cached || {}), ...order };
      });
      const hydratedIds = new Set(hydrated.map(getOrderId));
      entry.orders = [...hydrated, ...entry.orders.filter((order) => !hydratedIds.has(getOrderId(order)))];
      entry.loaded = true;
      entry.hasLoadedOnce = true;
      entry.refreshing = false;
      entry.error = '';
      emitDistributorOrders(entry, true);
    })
    .catch((error) => {
      entry.loaded = true;
      entry.refreshing = false;
      entry.error = distributorOrdersError(error);
      emitDistributorOrders(entry, true);
    })
    .finally(() => {
      entry.refreshPromise = null;
    });
  return entry.refreshPromise;
};

const listenForDistributorOrders = (uid, branchId, entry) => {
  const normalizedBranchId = String(branchId || '').trim();
  if (!normalizedBranchId || (entry.branchId === normalizedBranchId && entry.ordersUnsubscribe)) return;

  entry.ordersUnsubscribe?.();
  entry.ordersUnsubscribe = null;
  entry.branchId = normalizedBranchId;
  const assignedOrdersQuery = query(
    collection(db, 'requests'),
    where('assignedDistributorUid', '==', uid),
    where('branchId', '==', normalizedBranchId)
  );
  entry.ordersUnsubscribe = onSnapshot(
    assignedOrdersQuery,
    (snapshot) => {
      const cached = new Map(entry.orders.map((order) => [getOrderId(order), order]));
      entry.orders = snapshot.docs.map((orderDocument) => ({
        ...(cached.get(orderDocument.id) || {}),
        id: orderDocument.id,
        ...orderDocument.data(),
      }));
      entry.loaded = true;
      entry.hasLoadedOnce = true;
      entry.refreshing = false;
      entry.error = '';
      entry.lastSnapshotTimestamp = Date.now();
      emitDistributorOrders(entry, true);
    },
    (error) => {
      entry.loaded = true;
      entry.refreshing = false;
      entry.error = distributorOrdersError(error);
      emitDistributorOrders(entry, true);
    }
  );
};

const startDistributorOrders = (uid, entry) => {
  if (entry.stopTimer) {
    clearTimeout(entry.stopTimer);
    entry.stopTimer = null;
  }
  if (!entry.profileUnsubscribe) {
    entry.profileUnsubscribe = subscribeProtectedReadSession('distributor', (session) => {
      const { profile } = session;
      const readiness = protectedReadReadiness({ ...session, role: 'distributor' });
      if (session.uid !== uid || readiness !== 'READY') {
        entry.ordersUnsubscribe?.();
        entry.ordersUnsubscribe = null;
        entry.orders = [];
        entry.branchId = '';
        entry.hasLoadedOnce = false;
        entry.refreshing = false;
        entry.loaded = readiness === 'GENUINE_DENIED';
        entry.error = entry.loaded ? 'Your delivery access could not be verified.' : '';
        emitDistributorOrders(entry, true);
        return;
      }
      const branchId = String(profile?.branchId || '').trim();
      if (!branchId) {
        entry.loaded = true;
        entry.hasLoadedOnce = false;
        entry.refreshing = false;
        entry.error = profile ? 'Your Distributor account is not assigned to an active branch.' : '';
        emitDistributorOrders(entry, true);
        return;
      }
      listenForDistributorOrders(uid, branchId, entry);
      hydrateDistributorOrders(uid, entry);
    });
  }
};

const stopDistributorOrders = (uid, entry) => {
  entry.profileUnsubscribe?.();
  entry.ordersUnsubscribe?.();
  entry.profileUnsubscribe = null;
  entry.ordersUnsubscribe = null;
  entry.stopTimer = null;
  distributorOrderEntries.delete(uid);
};

export const subscribeAssignedDistributorOrders = (uid, listener) => {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) {
    listener({ orders: [], loading: false, hasLoadedOnce: false, refreshing: false, error: '' });
    return () => {};
  }
  const entry = getDistributorOrderEntry(normalizedUid);
  entry.subscribers.add(listener);
  listener({
    orders: entry.orders,
    loading: !entry.loaded,
    hasLoadedOnce: !!entry.hasLoadedOnce,
    refreshing: !!entry.refreshing,
    error: entry.error,
  });
  startDistributorOrders(normalizedUid, entry);

  return () => {
    entry.subscribers.delete(listener);
    if (entry.subscribers.size === 0) stopDistributorOrders(normalizedUid, entry);
  };
};

const primeAssignedDistributorOrder = (uid, order) => {
  const normalizedUid = String(uid || '').trim();
  const orderId = getOrderId(order);
  if (!normalizedUid || !orderId) return;
  const entry = getDistributorOrderEntry(normalizedUid);
  entry.orders = [order, ...entry.orders.filter((item) => getOrderId(item) !== orderId)];
  entry.loaded = true;
  entry.hasLoadedOnce = true;
  entry.error = '';
  emitDistributorOrders(entry, true);
};

export const clearAssignedDistributorOrdersCache = (uid) => {
  const normalizedUid = String(uid || '').trim();
  const entries = normalizedUid
    ? [[normalizedUid, distributorOrderEntries.get(normalizedUid)]]
    : [...distributorOrderEntries.entries()];
  entries.forEach(([key, entry]) => {
    if (!entry) return;
    if (entry.stopTimer) clearTimeout(entry.stopTimer);
    stopDistributorOrders(key, entry);
  });
};

export function useAssignedDistributorOrders() {
  const session = useProtectedReadSession('distributor');
  const [orders, setOrders] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState('');
  const refresh = React.useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const entry = getDistributorOrderEntry(uid);
    await hydrateDistributorOrders(uid, entry);
  }, []);

  React.useEffect(() => {
    if (session.readiness !== 'READY') {
      setOrders([]);
      setLoading(session.readiness !== 'GENUINE_DENIED');
      setHasLoadedOnce(false);
      setRefreshing(false);
      setError(session.readiness === 'GENUINE_DENIED' ? session.error || 'Your delivery access could not be verified.' : '');
      return undefined;
    }
    return subscribeAssignedDistributorOrders(session.uid, (state) => {
      setOrders(state.orders);
      setLoading(state.loading);
      setHasLoadedOnce(state.hasLoadedOnce);
      setRefreshing(state.refreshing);
      setError(state.error);
    });
  }, [session.readiness, session.uid, session.profile?.branchId, session.error]);

  return { orders, loading, error, refresh, hasLoadedOnce, refreshing };
}
