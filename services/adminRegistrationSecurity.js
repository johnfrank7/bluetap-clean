import { adminApiRequest } from './adminApi';
import { ADMIN_CACHE_KEYS, invalidateAdminData, setCachedAdminData } from './adminDataCache';

async function request(method, body) {
  return adminApiRequest('/api/admin/registration-security', { method, body });
}
export const getRegistrationSecurity = () => request('GET');
export const updateRegistrationSecurity = async (settings) => {
  const updated = await request('PATCH', settings);
  setCachedAdminData(ADMIN_CACHE_KEYS.security, updated);
  invalidateAdminData(ADMIN_CACHE_KEYS.dashboard);
  return updated;
};
