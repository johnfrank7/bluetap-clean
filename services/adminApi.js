import { auth } from '../firebase';
import { getApiUrl } from './apiClient';

const getRequests = new Map();

const stageFor = (path) => {
  if (path.includes('/dashboard/')) return 'ADMIN_DASHBOARD';
  if (path.endsWith('/branches')) return 'ADMIN_BRANCHES';
  if (path.endsWith('/accounts')) return 'ADMIN_ACCOUNTS';
  if (path.endsWith('/distributors')) return 'ADMIN_DISTRIBUTORS';
  if (path.endsWith('/registration-security')) return 'ADMIN_SECURITY';
  return 'ADMIN_API';
};

async function runRequest(path, { method, body }) {
  const stage = stageFor(path);
  const startedAt = Date.now();
  console.info('[admin-performance]', { stage: `${stage}_FETCH_STARTED` });
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Administrator authentication is required.');
  const response = await fetch(getApiUrl(path), {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  console.info('[admin-performance]', { stage: `${stage}_FIRST_DATA`, durationMs: Date.now() - startedAt });
  const result = await response.json().catch(() => null);
  console.info('[admin-performance]', { stage: `${stage}_FETCH_FINISHED`, durationMs: Date.now() - startedAt, status: response.status });
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Administrator data is temporarily unavailable.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  return result;
}

export function adminApiRequest(path, { method = 'GET', body } = {}) {
  const key = method === 'GET' ? `${method}:${path}` : '';
  if (key && getRequests.has(key)) {
    console.info('[admin-performance]', { stage: 'ADMIN_API_REQUEST_DEDUPED', path });
    return getRequests.get(key);
  }
  const request = runRequest(path, { method, body }).finally(() => {
    if (key) getRequests.delete(key);
  });
  if (key) getRequests.set(key, request);
  return request;
}
