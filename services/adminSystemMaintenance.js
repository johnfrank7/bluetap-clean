import { adminApiRequest } from './adminApi';
import { ADMIN_CACHE_KEYS, setCachedAdminData } from './adminDataCache';

const request = (method, body) => adminApiRequest('/api/admin/system-maintenance', { method, body });

export const getSystemMaintenance = () => request('GET');

export async function saveRetentionPolicy(policy) {
  const response = await request('PATCH', { policy });
  return response.policy;
}

export const previewSystemCleanup = () => request('POST', { action: 'preview' });

export async function runSystemCleanup() {
  const result = await request('POST', { action: 'run' });
  const overview = await getSystemMaintenance();
  setCachedAdminData(ADMIN_CACHE_KEYS.maintenance, overview);
  return { result, overview };
}
