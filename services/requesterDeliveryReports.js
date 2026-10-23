import { auth } from '../firebase';
import { getApiUrl } from './apiClient';
import { ensureAuthStateReady } from './authSession';

const PATH = '/api/requester/delivery-reports';
const TIMEOUT_MS = 25000;

async function request(path, { method = 'GET', body } = {}) {
  await ensureAuthStateReady();
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    const error = new Error('Sign in again to view delivery reports.');
    error.status = 401;
    throw error;
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    let response;
    try {
      response = await fetch(getApiUrl(path), {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (cause) {
      const error = new Error(cause?.name === 'AbortError'
        ? 'The report request timed out. Please retry.' : 'The connection was interrupted. Please retry.');
      error.uncertain = method === 'POST';
      throw error;
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(result?.error?.message || 'Delivery reports are temporarily unavailable.');
      error.code = result?.error?.reason || 'DELIVERY_REPORT_UNAVAILABLE';
      error.status = response.status;
      error.uncertain = method === 'POST' && response.status >= 500;
      throw error;
    }
    if (!result || method === 'POST' && !result.report) {
      const error = new Error('The response result could not be confirmed. Please retry.');
      error.uncertain = method === 'POST';
      throw error;
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function fetchRequesterDeliveryReports(orderId, { cursor = '', limit = 20 } = {}) {
  const query = `orderId=${encodeURIComponent(orderId)}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  return request(`${PATH}?${query}`);
}

export function fetchRequesterDeliveryReport(attemptId, orderId) {
  return request(`${PATH}?attemptId=${encodeURIComponent(attemptId)}&orderId=${encodeURIComponent(orderId)}`);
}

export function submitRequesterDeliveryResponse({ attemptId, explanation, clientMutationId }) {
  return request(PATH, { method: 'POST', body: { attemptId, explanation, clientMutationId } });
}
