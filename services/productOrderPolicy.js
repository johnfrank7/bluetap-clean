const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const ALL_DAYS = new Set(WEEKDAYS);

function productLimit(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean' || typeof value === 'object') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 100 ? number : null;
}

function productDeliveryDays(value) {
  if (!Array.isArray(value)) return [];
  return WEEKDAYS.filter((day) => value.includes(day));
}

function effectiveDeliveryDays(items = []) {
  const restricted = items.map((item) => productDeliveryDays(item.deliveryDaysSnapshot ?? item.deliveryDays)).filter((days) => days.length);
  return restricted.length ? WEEKDAYS.filter((day) => restricted.every((days) => days.includes(day))) : [...ALL_DAYS];
}

function scheduledWeekday(value) {
  const date = value instanceof Date ? value : value?.toDate?.() || (value?.seconds != null ? new Date(value.seconds * 1000) : new Date(value));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Manila' }).format(date).toLowerCase();
}

function isAllowedDeliveryDate(value, days) {
  return productDeliveryDays(days).includes(scheduledWeekday(value));
}

function manilaScheduleDate(dayOffset, hours, minutes = 0, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(value('year'), value('month') - 1, value('day') + dayOffset, hours - 8, minutes));
}

function limitViolations(items = []) {
  const byProduct = new Map();
  for (const item of items) {
    const id = String(item.productId || '');
    const previous = byProduct.get(id);
    byProduct.set(id, { productId: id, productNameSnapshot: item.productNameSnapshot || '', requestedQuantity: (previous?.requestedQuantity || 0) + Number(item.quantity || 0), configuredLimit: productLimit(item.maxQuantityPerRequesterSnapshot ?? item.maxQuantityPerRequester) });
  }
  return [...byProduct.values()].filter((item) => item.configuredLimit !== null && item.requestedQuantity > item.configuredLimit);
}

module.exports = { WEEKDAYS, productLimit, productDeliveryDays, effectiveDeliveryDays, scheduledWeekday, isAllowedDeliveryDate, manilaScheduleDate, limitViolations };
