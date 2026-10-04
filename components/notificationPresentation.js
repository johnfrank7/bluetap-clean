const normalizeNotificationStatus = (status) =>
  String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const SUCCESS_STATUSES = new Set(['delivered', 'completed', 'success']);
const ERROR_STATUSES = new Set([
  'cancelled',
  'canceled',
  'declined',
  'declined_outside_service_area',
  'delivery_failed',
  'error',
  'failed',
]);
const RESTRICTED_STATUSES = new Set([
  'active_restriction',
  'restricted',
  'restriction',
  'suspended',
]);
const WARNING_STATUSES = new Set(['safety_warning', 'warn', 'warning']);
const DELIVERY_STATUSES = new Set(['out_for_delivery']);

const NOTIFICATION_SEVERITIES = Object.freeze({
  success: Object.freeze({
    kind: 'success',
    label: 'Success',
    accent: '#059669',
    soft: '#ECFDF5',
    icon: '\u2713',
  }),
  info: Object.freeze({
    kind: 'info',
    label: 'Information',
    accent: '#0284C7',
    soft: '#EFF6FF',
    icon: 'i',
  }),
  delivery: Object.freeze({
    kind: 'delivery',
    label: 'Delivery update',
    accent: '#7C3AED',
    soft: '#F3E8FF',
    icon: '\u2192',
  }),
  warning: Object.freeze({
    kind: 'warning',
    label: 'Warning',
    accent: '#D97706',
    soft: '#FFF7ED',
    icon: '!',
  }),
  restricted: Object.freeze({
    kind: 'restricted',
    label: 'Restricted',
    accent: '#C2410C',
    soft: '#FFF1F0',
    icon: '\uD83D\uDD12',
  }),
  error: Object.freeze({
    kind: 'error',
    label: 'Error or cancellation',
    accent: '#BE123C',
    soft: '#FFF1F2',
    icon: '\u00D7',
  }),
});

const DARK_NOTIFICATION_SEVERITIES = Object.freeze({
  success: Object.freeze({ ...NOTIFICATION_SEVERITIES.success, accent: '#34D399', soft: '#0F392B' }),
  info: Object.freeze({ ...NOTIFICATION_SEVERITIES.info, accent: '#60A5FA', soft: '#133554' }),
  delivery: Object.freeze({ ...NOTIFICATION_SEVERITIES.delivery, accent: '#C084FC', soft: '#2E1A47' }),
  warning: Object.freeze({ ...NOTIFICATION_SEVERITIES.warning, accent: '#FBBF24', soft: '#38280B' }),
  restricted: Object.freeze({ ...NOTIFICATION_SEVERITIES.restricted, accent: '#FB923C', soft: '#451A03' }),
  error: Object.freeze({ ...NOTIFICATION_SEVERITIES.error, accent: '#FB7185', soft: '#4C1624' }),
});

const notificationSeverity = (status, dark = false) => {
  const normalized = normalizeNotificationStatus(status);
  const palette = dark ? DARK_NOTIFICATION_SEVERITIES : NOTIFICATION_SEVERITIES;
  if (SUCCESS_STATUSES.has(normalized)) return palette.success;
  if (DELIVERY_STATUSES.has(normalized)) return palette.delivery;
  if (RESTRICTED_STATUSES.has(normalized)) return palette.restricted;
  if (ERROR_STATUSES.has(normalized)) return palette.error;
  if (WARNING_STATUSES.has(normalized) || normalized.includes('pending') || normalized.includes('review')) return palette.warning;
  return palette.info;
};

module.exports = {
  normalizeNotificationStatus,
  notificationSeverity,
  NOTIFICATION_SEVERITIES,
  DARK_NOTIFICATION_SEVERITIES,
};
