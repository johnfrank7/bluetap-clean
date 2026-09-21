import { adminApiRequest } from './adminApi';
import { ADMIN_CACHE_KEYS, invalidateAdminData } from './adminDataCache';

async function request(path, method = 'GET', body) {
  return adminApiRequest(path, { method, body });
}

export const getBranches = async () => (await request('/api/admin/branches')).branches || [];
export const createBranch = async (branch) => {
  const created = (await request('/api/admin/branches', 'POST', branch)).branch;
  invalidateAdminData(ADMIN_CACHE_KEYS.branches, ADMIN_CACHE_KEYS.dashboard);
  return created;
};
export const updateBranch = async (branchId, changes) => {
  const updated = (await request('/api/admin/branches', 'PATCH', { branchId, ...changes })).branch;
  invalidateAdminData(ADMIN_CACHE_KEYS.branches, ADMIN_CACHE_KEYS.accounts, ADMIN_CACHE_KEYS.dashboard);
  return updated;
};
export const getManagers = async () => (await request('/api/admin/managers')).managers || [];
export const getAccountsWorkspace = async () => {
  const result = await request('/api/admin/accounts');
  return { accounts: result.accounts || [], activity: result.activity || [] };
};
export const getAdminCreatedAccounts = async () => (await getAccountsWorkspace()).accounts;
export const createAdminAccount = async (account) => {
  const created = (await request('/api/admin/accounts', 'POST', account)).account;
  invalidateAdminData(ADMIN_CACHE_KEYS.accounts, ADMIN_CACHE_KEYS.branches, ADMIN_CACHE_KEYS.dashboard);
  if (created?.role === 'distributor') invalidateAdminData(ADMIN_CACHE_KEYS.distributors);
  return created;
};
export const manageAdminAccount = async (uid, action, changes = {}) => {
  const updated = (await request('/api/admin/accounts', 'PATCH', { uid, action, ...changes })).account;
  invalidateAdminData(ADMIN_CACHE_KEYS.accounts);
  if (['deactivate', 'reactivate', 'updateProfile', 'reassignManager'].includes(action)) invalidateAdminData(ADMIN_CACHE_KEYS.dashboard);
  if (updated?.role === 'manager' && ['deactivate', 'reactivate', 'reassignManager', 'updateProfile'].includes(action)) invalidateAdminData(ADMIN_CACHE_KEYS.branches);
  if (updated?.role === 'distributor' && ['deactivate', 'reactivate', 'updateProfile'].includes(action)) invalidateAdminData(ADMIN_CACHE_KEYS.distributors);
  return updated;
};
export const getDistributors = async () => (await request('/api/admin/distributors')).distributors || [];
export const updateDistributor = async (uid, action, rejectionReason = '') => {
  const updated = (await request('/api/admin/distributors', 'POST', { uid, action, rejectionReason })).distributor;
  invalidateAdminData(ADMIN_CACHE_KEYS.distributors, ADMIN_CACHE_KEYS.accounts, ADMIN_CACHE_KEYS.dashboard);
  return updated;
};
export const updateManagerAssignment = async (managerUid, changes) => (await request('/api/admin/managers', 'PATCH', { managerUid, ...changes })).manager;
export const getAdminDashboardOverview = async () => request('/api/admin/dashboard/overview');
