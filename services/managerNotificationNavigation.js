const MANAGER_DASHBOARD_PATH = '/manager/dashboard';
const MANAGER_NOTIFICATIONS_PATH = '/manager/notifications';

let pendingManagerOrigin = '';

const sanitizeManagerOrigin = (value) => {
  const path = String(value || '').trim().split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  if (!path.startsWith('/manager/')) return '';
  if (path === MANAGER_NOTIFICATIONS_PATH || path === '/manager/login') return '';
  return path;
};

const recordManagerNotificationOrigin = (value) => {
  pendingManagerOrigin = sanitizeManagerOrigin(value);
  return pendingManagerOrigin;
};

const consumeManagerNotificationOrigin = () => {
  const origin = pendingManagerOrigin;
  pendingManagerOrigin = '';
  return origin;
};

const clearManagerNotificationOrigin = () => {
  pendingManagerOrigin = '';
};

const resolveManagerNotificationBack = ({ canGoBack = false, origin = '' } = {}) => {
  const safeOrigin = sanitizeManagerOrigin(origin);
  if (safeOrigin && canGoBack) return { method: 'back', target: safeOrigin };
  return { method: 'replace', target: safeOrigin || MANAGER_DASHBOARD_PATH };
};

module.exports = {
  MANAGER_DASHBOARD_PATH,
  MANAGER_NOTIFICATIONS_PATH,
  clearManagerNotificationOrigin,
  consumeManagerNotificationOrigin,
  recordManagerNotificationOrigin,
  resolveManagerNotificationBack,
  sanitizeManagerOrigin,
};
