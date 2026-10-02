import { auth } from '../firebase';
import { getApiUrl } from './apiClient';
import { ensureAuthStateReady } from './authSession';

async function request(path, { method = 'GET', body } = {}) {
  await ensureAuthStateReady();
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sign in again to use Reports & Safety.');
  const response = await fetch(getApiUrl(path), {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Reports & Safety is temporarily unavailable.');
    error.code = result?.error?.reason || 'MODERATION_SERVICE_UNAVAILABLE';
    error.status = response.status;
    error.retryAfterSeconds = result?.error?.retryAfterSeconds || null;
    throw error;
  }
  return result || {};
}

export const submitChatReport = (body) => request('/api/chat/reports', { method: 'POST', body });

export function loadModerationCases(role, { status = '', cursor = '', kind = 'reports', limit = 25 } = {}) {
  const params = new URLSearchParams({ kind, limit: String(limit) });
  if (status) params.set('status', status);
  if (cursor) params.set('cursor', cursor);
  return request(`/api/${role}/moderation?${params.toString()}`);
}

export const loadModerationDetail = (role, reportId) => request(`/api/${role}/moderation?kind=detail&reportId=${encodeURIComponent(reportId)}`);
export const applyModerationAction = (role, body) => request(`/api/${role}/moderation`, { method: 'POST', body });
export const loadExpandedChatReview = (body) => request('/api/admin/chat-review', { method: 'POST', body });
export const loadModerationNotices = () => request('/api/moderation/notices');
export const updateModerationNotice = (noticeId, action) => request('/api/moderation/notices', { method: 'POST', body: { noticeId, action } });
export const acknowledgeModerationNotice = (noticeId) => updateModerationNotice(noticeId, 'acknowledge');
export const markModerationNoticeSeen = (noticeId) => updateModerationNotice(noticeId, 'seen');
