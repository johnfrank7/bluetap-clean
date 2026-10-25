import { auth } from '../firebase';
import { getApiUrl } from './apiClient';
import { ensureAuthStateReady } from './authSession';

const PATH = '/api/admin/delivery-appeals';
const TIMEOUT_MS = 25000;

async function request(path, { method = 'GET', body } = {}) {
  await ensureAuthStateReady();
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    const error = new Error('Sign in again to access delivery appeals.');
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
        ? 'The appeal request timed out. Please retry.' : 'The connection was interrupted. Please retry.');
      error.uncertain = method === 'POST';
      throw error;
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(result?.error?.message || 'Admin delivery appeals are temporarily unavailable.');
      error.code = result?.error?.reason || 'ADMIN_APPEAL_UNAVAILABLE';
      error.status = response.status;
      error.uncertain = method === 'POST' && response.status >= 500;
      throw error;
    }
    return result || {};
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function fetchAdminAppeals({ status = 'pending', limit = 20, cursor = '' } = {}) {
  const params = new URLSearchParams({ status, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return request(`${PATH}?${params.toString()}`);
}

export function fetchAdminAppealDetail(attemptId) {
  return request(`${PATH}?attemptId=${encodeURIComponent(attemptId)}`);
}

export function fetchAdminDeliveryPenalty(requesterUid) {
  return request(`${PATH}?penaltyRequesterUid=${encodeURIComponent(requesterUid)}`);
}

export function fetchAdminDeliveryPenaltyReviews(cursor = '') {
  return request(`${PATH}?penaltyReviews=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
}

export function resolveAdminAppeal({ attemptId, resolution, resolutionReason, overturnedResponsibility = null, clientMutationId }) {
  const body = { attemptId, resolution, resolutionReason, clientMutationId };
  if (resolution === 'overturned' && overturnedResponsibility) {
    body.overturnedResponsibility = overturnedResponsibility;
  }
  return request(PATH, { method: 'POST', body });
}
