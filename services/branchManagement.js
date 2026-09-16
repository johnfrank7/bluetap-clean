import { auth } from '../firebase';
import { getApiUrl } from './apiClient';

async function request(path, method = 'GET', body) {
  const token = await auth.currentUser?.getIdToken(true);
  if (!token) throw new Error('Administrator authentication is required.');
  const response = await fetch(getApiUrl(path), {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Branch management is unavailable.');
    error.code = result?.error?.reason || 'service-unavailable';
    throw error;
  }
  return result;
}

export const getBranches = async () => (await request('/api/admin/branches')).branches || [];
export const createBranch = async (branch) => (await request('/api/admin/branches', 'POST', branch)).branch;
export const updateBranch = async (branchId, changes) => (await request('/api/admin/branches', 'PATCH', { branchId, ...changes })).branch;
export const getManagers = async () => (await request('/api/admin/managers')).managers || [];
export const getAdminCreatedAccounts = async () => (await request('/api/admin/accounts')).accounts || [];
export const createAdminAccount = async (account) => (await request('/api/admin/accounts', 'POST', account)).account;
export const updateManagerAssignment = async (managerUid, changes) => (await request('/api/admin/managers', 'PATCH', { managerUid, ...changes })).manager;
