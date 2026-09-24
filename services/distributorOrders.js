import React from 'react';
import { auth } from '../firebase';
import { getApiUrl } from './apiClient';

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

export function toDistributorScreenOrder(order = {}) {
  const items = Array.isArray(order.items) ? order.items : [];
  const quantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const productNames = items.map((item) => item.productNameSnapshot).filter(Boolean);
  const totalAmount = Number(order.totalAtOrder || 0);
  const deliveryDate = formatDistributorOrderDate(order.expectedDeliveryDate, 'Not set');
  const status = order.status || 'distributor_assigned';
  const requestId = order.requestId || order.id || 'Not set';
  const requesterName = order.requesterName || 'Not set';
  const requesterId = order.requesterUniqueId || '';
  const mappedItems = items.map((item, index) => ({
    id: `${order.id || requestId}-${index}`,
    productName: item.productNameSnapshot || 'Product',
    quantity: Number(item.quantity) || 0,
    unitPrice: Number(item.quantity) > 0 ? Number(item.totalAtOrder || 0) / Number(item.quantity) : Number(item.totalAtOrder || 0),
    subtotal: Number(item.totalAtOrder || 0),
  }));

  return {
    sourceId: order.id || requestId,
    id: requestId,
    requestId,
    status,
    requester: requesterName,
    customerName: requesterName,
    requesterName,
    requesterId,
    requesterUniqueId: requesterId,
    contact: order.contactNumber || 'Not set',
    contactNumber: order.contactNumber || 'Not set',
    address: order.address || 'Not set',
    deliveryAddress: order.address || 'Not set',
    productName: productNames[0] || 'Product',
    productsOrdered: productNames.length > 1 ? `${productNames[0]} +${productNames.length - 1} more` : productNames[0] || 'Product',
    quantity: quantity ? String(quantity) : 'Not set',
    container: order.container || 'Not set',
    containerType: order.container || 'Not set',
    totalAmount,
    total_cost: totalAmount,
    amountDue: `₱${totalAmount.toFixed(2)}`,
    amountPaid: `₱${totalAmount.toFixed(2)}`,
    deliveryDate,
    scheduledDateTime: formatDistributorOrderDate(order.scheduledAt || order.expectedDeliveryDate, 'Not set'),
    deliveredDateTime: formatDistributorOrderDate(order.deliveredAt || order.updatedAt, 'Not set'),
    orderDate: formatDistributorOrderDate(order.createdAt, 'Not set'),
    waterStation: order.currentBranchName || 'Not set',
    paymentMethod: order.paymentMethod || 'Not set',
    distributor: order.assignedDistributorName || '',
    distributorName: order.assignedDistributorName || '',
    distributorId: '',
    distributorUniqueId: '',
    items: mappedItems,
    grandTotalAmount: totalAmount,
    failureReason: order.failureReason || '',
    notes: order.notes || order.specialInstructions || '',
    specialInstructions: order.notes || order.specialInstructions || '',
    deliveryLocation: order.deliveryLocation || null,
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
    try { setOrders(await getAssignedDistributorOrders()); }
    catch (loadFailure) { setError(loadFailure.message || 'Assigned deliveries are temporarily unavailable.'); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);
  return { orders, loading, error, refresh };
}
