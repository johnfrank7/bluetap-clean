import React from 'react';

export const ADMIN_CACHE_STALE_MS = 45_000;
export const ADMIN_CACHE_KEYS = Object.freeze({
  dashboard: 'admin-dashboard-overview',
  branches: 'admin-branches',
  accounts: 'admin-accounts-workspace',
  distributors: 'admin-distributors',
  security: 'admin-security-settings',
});

const store = globalThis.__bluetapAdminDataCache || new Map();
globalThis.__bluetapAdminDataCache = store;

const entryFor = (key) => store.get(key) || { data: undefined, updatedAt: 0, inFlight: null, generation: 0 };

export const getCachedAdminData = (key) => entryFor(key).data;

export const setCachedAdminData = (key, data) => {
  const current = entryFor(key);
  store.set(key, { data, updatedAt: Date.now(), inFlight: null, generation: current.generation + 1 });
  return data;
};

export const invalidateAdminData = (...keys) => {
  keys.flat().forEach((key) => {
    const current = entryFor(key);
    if (current.data !== undefined || current.inFlight) store.set(key, { ...current, updatedAt: 0, inFlight: null, generation: current.generation + 1 });
  });
};

export const clearAdminDataCache = () => store.clear();

export function loadAdminData(key, loader, { force = false, staleMs = ADMIN_CACHE_STALE_MS } = {}) {
  const current = entryFor(key);
  const fresh = current.data !== undefined && Date.now() - current.updatedAt < staleMs;
  if (!force && fresh) {
    console.info('[admin-performance]', { stage: 'ADMIN_DATA_CACHE_HIT', dataset: key, ageMs: Date.now() - current.updatedAt });
    return Promise.resolve(current.data);
  }
  if (current.inFlight && !force) {
    console.info('[admin-performance]', { stage: 'ADMIN_DATA_REQUEST_DEDUPED', dataset: key });
    return current.inFlight;
  }

  const startedAt = Date.now();
  const generation = current.generation + (force ? 1 : 0);
  const request = Promise.resolve()
    .then(loader)
    .then((data) => {
      if (entryFor(key).generation === generation) store.set(key, { data, updatedAt: Date.now(), inFlight: null, generation });
      console.info('[admin-performance]', { stage: 'ADMIN_DATA_READY', dataset: key, durationMs: Date.now() - startedAt });
      return data;
    })
    .catch((error) => {
      if (entryFor(key).generation === generation) store.set(key, { ...entryFor(key), inFlight: null });
      throw error;
    });
  store.set(key, { ...current, inFlight: request, generation });
  return request;
}

export const prefetchAdminData = (key, loader, options) =>
  loadAdminData(key, loader, options).catch(() => null);

export function useAdminData(key, loader, { staleMs = ADMIN_CACHE_STALE_MS } = {}) {
  const initial = getCachedAdminData(key);
  const [state, setState] = React.useState({
    data: initial,
    loading: initial === undefined,
    refreshing: false,
    error: '',
  });
  const mounted = React.useRef(false);
  const requestId = React.useRef(0);

  const refresh = React.useCallback(async ({ force = false } = {}) => {
    const id = ++requestId.current;
    setState((current) => ({
      ...current,
      loading: current.data === undefined,
      refreshing: current.data !== undefined,
      error: '',
    }));
    try {
      const data = await loadAdminData(key, loader, { force, staleMs });
      if (mounted.current && requestId.current === id) setState({ data, loading: false, refreshing: false, error: '' });
      return data;
    } catch (error) {
      if (mounted.current && requestId.current === id) {
        setState((current) => ({ ...current, loading: false, refreshing: false, error: error.message || 'Unable to load this section.' }));
      }
      return null;
    }
  }, [key, loader, staleMs]);

  React.useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
      requestId.current += 1;
    };
  }, [refresh]);

  return { ...state, refresh };
}
