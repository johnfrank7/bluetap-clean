import { getRegistrationSecurity } from './adminRegistrationSecurity';
import { ADMIN_CACHE_KEYS, prefetchAdminData } from './adminDataCache';
import { getAccountsWorkspace, getBranches, getDistributors } from './branchManagement';
import { getAdminProducts } from './adminProducts';
import { getSystemMaintenance } from './adminSystemMaintenance';

const destinations = {
  '/admin/branches': [ADMIN_CACHE_KEYS.branches, getBranches],
  '/admin/managers': [ADMIN_CACHE_KEYS.accounts, getAccountsWorkspace],
  '/admin/distributors': [ADMIN_CACHE_KEYS.distributors, getDistributors],
  '/admin/products': [ADMIN_CACHE_KEYS.products, getAdminProducts],
  '/admin/registration-security': [ADMIN_CACHE_KEYS.security, getRegistrationSecurity],
  '/admin/system-maintenance': [ADMIN_CACHE_KEYS.maintenance, getSystemMaintenance],
};

export const prefetchAdminDestination = (path) => {
  const target = destinations[path];
  return target ? prefetchAdminData(target[0], target[1]) : Promise.resolve(null);
};

export function prefetchLikelyAdminDestinations() {
  const run = () => Promise.allSettled(Object.keys(destinations).map(prefetchAdminDestination));
  if (typeof globalThis.requestIdleCallback === 'function') {
    const handle = globalThis.requestIdleCallback(run, { timeout: 2_000 });
    return () => globalThis.cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(run, 250);
  return () => clearTimeout(handle);
}
