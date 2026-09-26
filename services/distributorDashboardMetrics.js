const normalizeDashboardStatus = (status) => String(status || '')
  .trim()
  .toLowerCase()
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ');

const dateFrom = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  return new Date(value);
};

const occursOnDay = (value, day) => {
  const date = dateFrom(value);
  return Boolean(
    date &&
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === day.getFullYear() &&
    date.getMonth() === day.getMonth() &&
    date.getDate() === day.getDate()
  );
};

const getDistributorDashboardCounts = (orders = [], now = new Date()) => ({
  pending: orders.filter((order) =>
    ['distributor assigned', 'pending'].includes(normalizeDashboardStatus(order?.status))
  ).length,
  scheduledToday: orders.filter((order) =>
    ['accepted', 'scheduled', 'out for delivery'].includes(normalizeDashboardStatus(order?.status)) &&
    occursOnDay(order?.rawScheduledAt || order?.scheduledDateTime || order?.scheduledAt, now)
  ).length,
  deliveredToday: orders.filter((order) =>
    normalizeDashboardStatus(order?.status) === 'delivered' &&
    occursOnDay(order?.rawDeliveredAt || order?.deliveredDateTime || order?.deliveredAt, now)
  ).length,
});

module.exports = { getDistributorDashboardCounts, normalizeDashboardStatus, occursOnDay };
