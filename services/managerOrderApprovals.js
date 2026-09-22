import { auth } from '../firebase';
import { getApiUrl } from './apiClient';

async function managerRequest(path, { method = 'GET', body } = {}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Manager authentication is required.');
  const response = await fetch(getApiUrl(path), {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Outside-radius approvals are temporarily unavailable.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  return result || {};
}

export const getOutsideRadiusOrders = async () => (await managerRequest('/api/manager/outside-radius-orders')).orders || [];
export const decideOutsideRadiusOrder = async (orderId, action) => (await managerRequest('/api/manager/outside-radius-orders', { method: 'PATCH', body: { orderId, action } })).order;
export const getManagerDispatch = async () => managerRequest('/api/manager/dispatch-orders');
export const dispatchManagerOrder = async (orderId, action, payload = {}) => (await managerRequest('/api/manager/dispatch-orders', { method: 'PATCH', body: { orderId, action, ...payload } })).order;
