const DEFAULT_NAVIGATION_LOCK_MS = 600;

const normalizeRoutePath = (target) => {
  const raw = typeof target === 'string' ? target : target?.pathname;
  if (typeof raw !== 'string') return '';
  const path = raw.split('?')[0].split('#')[0].replace(/\/+$/, '');
  return path || '/';
};

function createSingleFlightLock({
  lockMs = DEFAULT_NAVIGATION_LOCK_MS,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let key = '';
  let timer = null;
  let disposed = false;

  const release = () => {
    if (timer) cancel(timer);
    timer = null;
    key = '';
  };

  const acquire = (nextKey) => {
    if (disposed || key) return false;
    key = String(nextKey || 'navigation');
    timer = schedule(release, lockMs);
    return true;
  };

  const dispose = () => {
    disposed = true;
    release();
  };

  return {
    acquire,
    dispose,
    isLocked: () => Boolean(key),
    key: () => key,
    release,
  };
}

function createSingleFlightNavigation(options) {
  const lock = createSingleFlightLock(options);
  let pendingPath = '';

  const navigate = ({ currentPath, target, action }) => {
    const destinationPath = normalizeRoutePath(target);
    if (!destinationPath || typeof action !== 'function') return false;
    if (normalizeRoutePath(currentPath) === destinationPath) return false;
    if (!lock.acquire(destinationPath)) return false;
    pendingPath = destinationPath;
    try {
      action(target);
      return true;
    } catch (error) {
      pendingPath = '';
      lock.release();
      throw error;
    }
  };

  const settle = (currentPath) => {
    if (!pendingPath || normalizeRoutePath(currentPath) !== pendingPath) return false;
    pendingPath = '';
    lock.release();
    return true;
  };

  return {
    dispose: lock.dispose,
    isLocked: lock.isLocked,
    navigate,
    pendingPath: () => pendingPath,
    release: () => {
      pendingPath = '';
      lock.release();
    },
    settle,
  };
}

module.exports = {
  DEFAULT_NAVIGATION_LOCK_MS,
  createSingleFlightLock,
  createSingleFlightNavigation,
  normalizeRoutePath,
};
