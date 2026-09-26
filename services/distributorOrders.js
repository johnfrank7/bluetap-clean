import React from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { getApiUrl } from './apiClient';
import { formatDisplayUniqueId, isPublicOrFormattedUniqueId } from './uniqueIds';
import { subscribeDistributorProfile } from './distributorProfile';

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

export async function updateAssignedDistributorOrder(orderId, action, payload = {}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Distributor authentication is required.');
  const response = await fetch(getApiUrl('/api/distributor/orders'), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, action, ...payload }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'The delivery could not be updated.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  const order = result?.order || null;
  if (order) primeAssignedDistributorOrder(auth.currentUser?.uid, order);
  return order;
}

export const acceptAssignedOrder = (orderId) => updateAssignedDistributorOrder(orderId, 'accept-assignment');
export const declineAssignedOrder = (orderId, declineReason = '') => updateAssignedDistributorOrder(orderId, 'decline-assignment', { declineReason });
export const startAssignedDelivery = (orderId) => updateAssignedDistributorOrder(orderId, 'start-delivery');
export const failAssignedDelivery = (orderId, failureReason) => updateAssignedDistributorOrder(orderId, 'fail-delivery', { failureReason });
export const rescheduleAssignedDelivery = (orderId, scheduledAt) => updateAssignedDistributorOrder(orderId, 'reschedule-delivery', { scheduledAt });
export const completeAssignedDelivery = (orderId) => updateAssignedDistributorOrder(orderId, 'mark-delivered');

const dateFrom = (value) => value?.toDate?.()
  || (value?.seconds ? new Date(value.seconds * 1000) : value ? new Date(value) : null);

export const normalizeDistributorOrderStatus = (status) => String(status || '')
  .trim()
  .toLowerCase()
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ');

export const formatDistributorOrderDate = (value, fallback = 'Not set') => {
  const date = dateFrom(value);
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
  const deliveryDate = formatDistributorOrderDate(order.expectedDeliveryDate || order.delivery_date, 'Not set');
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
    requesterUid: safeString(order.requesterUid || order.requester_id, ''),
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
    scheduledDateTime: formatDistributorOrderDate(order.scheduledAt || order.expectedDeliveryDate, 'Not set'),
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
    failureReason: safeString(order.failureReason, ''),
    notes: safeString(order.notes || order.specialInstructions, ''),
    specialInstructions: safeString(order.notes || order.specialInstructions, ''),
    deliveryLocation: order.deliveryLocation || null,
    branchId: safeString(order.branchId || order.currentBranchId, ''),
    branchLocation: order.branchLocation || order.currentBranchLocation || null,
    subtotalAtOrder: Number(order.subtotalAtOrder || order.subtotal || 0),
    deliveryFeeAtOrder: Number(order.deliveryFeeAtOrder || order.deliveryFee || 0),
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
      error: '',
      branchId: '',
      subscribers: new Set(),
      profileUnsubscribe: null,
      ordersUnsubscribe: null,
      refreshPromise: null,
      stopTimer: null,
    });
  }
  return distributorOrderEntries.get(uid);
};

const emitDistributorOrders = (entry, force = false) => {
  const nextSignature = orderSignature(entry.orders);
  if (!force && nextSignature === entry.signature) return;
  entry.signature = nextSignature;
  const state = { orders: entry.orders, loading: !entry.loaded, error: entry.error };
  entry.subscribers.forEach((listener) => listener(state));
};

const hydrateDistributorOrders = (uid, entry) => {
  if (entry.refreshPromise) return entry.refreshPromise;
  entry.refreshPromise = getAssignedDistributorOrders()
    .then((orders) => {
      const existing = new Map(entry.orders.map((order) => [getOrderId(order), order]));
      const hydrated = (Array.isArray(orders) ? orders : []).map((order) => ({
        ...order,
        ...(existing.get(getOrderId(order)) || {}),
      }));
      const hydratedIds = new Set(hydrated.map(getOrderId));
      entry.orders = [...hydrated, ...entry.orders.filter((order) => !hydratedIds.has(getOrderId(order)))];
      entry.loaded = true;
      entry.error = '';
      emitDistributorOrders(entry, true);
    })
    .catch((error) => {
      entry.loaded = true;
      entry.error = error.message || 'Assigned deliveries are temporarily unavailable.';
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
      entry.error = '';
      emitDistributorOrders(entry, true);
    },
    (error) => {
      entry.loaded = true;
      entry.error = error.message || 'Assigned deliveries are temporarily unavailable.';
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
    entry.profileUnsubscribe = subscribeDistributorProfile(uid, ({ profile }) => {
      listenForDistributorOrders(uid, profile?.branchId || profile?.assignedBranchId, entry);
    });
  }
  hydrateDistributorOrders(uid, entry);
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
    listener({ orders: [], loading: false, error: '' });
    return () => {};
  }
  const entry = getDistributorOrderEntry(normalizedUid);
  entry.subscribers.add(listener);
  listener({ orders: entry.orders, loading: !entry.loaded, error: entry.error });
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
  const [orders, setOrders] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const refresh = React.useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const entry = getDistributorOrderEntry(uid);
    await hydrateDistributorOrders(uid, entry);
  }, []);

  React.useEffect(() => {
    let unsubscribeOrders = subscribeAssignedDistributorOrders(auth.currentUser?.uid, (state) => {
      setOrders(state.orders);
      setLoading(state.loading);
      setError(state.error);
    });
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeOrders?.();
      unsubscribeOrders = subscribeAssignedDistributorOrders(user?.uid, (state) => {
        setOrders(state.orders);
        setLoading(state.loading);
        setError(state.error);
      });
    });

    return () => {
      unsubscribeAuth();
      unsubscribeOrders?.();
    };
  }, [refresh]);

  return { orders, loading, error, refresh };
}
