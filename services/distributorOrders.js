import React from 'react';
import { auth } from '../firebase';
import { getApiUrl } from './apiClient';
import { formatDisplayUniqueId, isPublicOrFormattedUniqueId } from './uniqueIds';

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
  return result?.order || null;
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

export function useAssignedDistributorOrders() {
  const [orders, setOrders] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setOrders(await getAssignedDistributorOrders());
    } catch (loadFailure) {
      setError(loadFailure.message || 'Assigned deliveries are temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    const unsubscribe = auth.onAuthStateChanged?.((user) => {
      if (user && active) {
        refresh();
      } else if (!user && active) {
        setOrders([]);
        setLoading(false);
      }
    });

    if (auth.currentUser) {
      refresh();
    }

    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [refresh]);

  return { orders, loading, error, refresh };
}
