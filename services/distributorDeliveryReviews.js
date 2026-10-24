import { auth } from '../firebase';
import { getApiUrl } from './apiClient';
import { ensureAuthStateReady } from './authSession';

const PATH = '/api/distributor/delivery-reviews';
const TIMEOUT_MS = 25000;

async function request(path, expectedUid) {
  await ensureAuthStateReady();
  const user = auth.currentUser;
  if (!user || user.uid !== expectedUid) throw new Error('Distributor session changed. Sign in again.');
  const token = await user.getIdToken();
  if (!token || auth.currentUser?.uid !== expectedUid) throw new Error('Distributor session changed. Sign in again.');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    const response = await fetch(getApiUrl(path), {
      headers: { Authorization: `Bearer ${token}` },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (auth.currentUser?.uid !== expectedUid) throw new Error('Distributor session changed. Sign in again.');
    const result = await response.json().catch(() => null);
    if (auth.currentUser?.uid !== expectedUid) throw new Error('Distributor session changed. Sign in again.');
    if (!response.ok || !result || typeof result !== 'object') {
      const error = new Error(result?.error?.message || 'Delivery reviews are temporarily unavailable.');
      error.status = response.status;
      throw error;
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function fetchDistributorDeliveryReviews({ cursor = '', limit = 5, expectedUid } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new RangeError('Choose a page size from 1 to 25.');
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return request(`${PATH}?${params.toString()}`, expectedUid);
}

export function fetchDistributorDeliveryReview(attemptId, expectedUid) {
  return request(`${PATH}?attemptId=${encodeURIComponent(attemptId)}`, expectedUid);
}
