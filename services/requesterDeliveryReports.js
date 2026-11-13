import { auth } from '../firebase';
import { getApiUrl } from './apiClient';
import { ensureAuthStateReady } from './authSession';
import { missingEndpointError, rememberMissingEndpoint } from './unavailableEndpoint';

const PATH = '/api/requester/delivery-reports';
const TIMEOUT_MS = 25000;

async function request(path, { method = 'GET', body } = {}) {
  const url = getApiUrl(path);
  const unavailable = method === 'GET' && missingEndpointError(url);
  if (unavailable) throw unavailable;
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
      response = await fetch(url, {
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
    if (method === 'GET') rememberMissingEndpoint(url, response.status, result);
    if (!response.ok) {
      const error = new Error(missingEndpointError(url)?.message || result?.error?.message || 'Delivery reports are temporarily unavailable.');
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

export function fetchRequesterDeliveryReports(orderId = '', { cursor = '', limit = 20 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
    throw new RangeError('Choose a report page size from 1 to 25.');
  }
  const params = new URLSearchParams();
  if (orderId) params.set('orderId', orderId);
  params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  return request(`${PATH}?${params.toString()}`);
}

export function fetchRequesterDeliveryReport(attemptId, orderId) {
  return request(`${PATH}?attemptId=${encodeURIComponent(attemptId)}&orderId=${encodeURIComponent(orderId)}`);
}

export function fetchRequesterReviewCompletions({ cursor = '', limit = 20 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
    throw new RangeError('Choose a review page size from 1 to 25.');
  }
  const params = new URLSearchParams({ feed: 'review-completions', limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return request(`${PATH}?${params.toString()}`);
}

export function submitRequesterDeliveryResponse({ attemptId, explanation, clientMutationId }) {
  return request(PATH, { method: 'POST', body: { attemptId, explanation, clientMutationId } });
}
