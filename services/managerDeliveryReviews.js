import { auth } from '../firebase';
import { getApiUrl } from './apiClient';
import { ensureAuthStateReady } from './authSession';

const PATH = '/api/manager/delivery-reviews';
const TIMEOUT_MS = 25000;

async function request(path, { method = 'GET', body, expectedUid } = {}) {
  await ensureAuthStateReady();
  const user = auth.currentUser;
  if (expectedUid && user?.uid !== expectedUid) {
    const error = new Error('Manager session changed. Open the review again.');
    error.status = 401;
    throw error;
  }
  const token = await user?.getIdToken();
  if (!token || auth.currentUser?.uid !== user.uid) {
    const error = new Error('Manager authentication is required.');
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
        ? 'The review request timed out. Please retry.' : 'The connection was interrupted. Please retry.');
      error.uncertain = method === 'POST';
      throw error;
    }
    if (auth.currentUser?.uid !== user.uid) {
      const error = new Error('Manager session changed. Open the review again.');
      error.status = 401;
      throw error;
    }
    const result = await response.json().catch(() => null);
    if (auth.currentUser?.uid !== user.uid) {
      const error = new Error('Manager session changed. Open the review again.');
      error.status = 401;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(result?.error?.message || 'Delivery reviews are temporarily unavailable.');
      error.status = response.status;
      error.code = result?.error?.reason || 'DELIVERY_REVIEW_UNAVAILABLE';
      error.uncertain = method === 'POST' && response.status >= 500;
      throw error;
    }
    if (!result || typeof result !== 'object' || method === 'POST' && !result.decision) {
      const error = new Error('The review result could not be confirmed. Please retry.');
      error.uncertain = method === 'POST';
      throw error;
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function fetchManagerDeliveryReviews(cursor = '', expectedUid = '') {
  const params = new URLSearchParams({ state: 'reported', limit: '20' });
  if (cursor) params.set('cursor', cursor);
  return request(`${PATH}?${params.toString()}`, { expectedUid });
}

export function fetchManagerDeliveryReview(attemptId, expectedUid = '') {
  return request(`${PATH}?attemptId=${encodeURIComponent(attemptId)}`, { expectedUid });
}

export function submitManagerDeliveryDecision(payload, expectedUid = '') {
  return request(PATH, { method: 'POST', body: payload, expectedUid });
}
