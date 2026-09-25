/**
 * Robust timestamp parsing and formatting for BlueTap notifications and order lifecycles.
 * Handles:
 * - JavaScript Date instances
 * - Firestore Timestamp objects (.toDate(), .toMillis(), .seconds)
 * - Serialized Firestore Timestamps ({ _seconds, _nanoseconds })
 * - Plain object seconds ({ seconds, nanoseconds })
 * - Epoch timestamps (seconds or milliseconds)
 * - ISO-8601 strings and date strings
 */

export function parseTimestamp(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === 'function') {
    try {
      const d = value.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
    } catch {}
  }

  if (typeof value?.toMillis === 'function') {
    try {
      const ms = value.toMillis();
      if (Number.isFinite(ms)) return new Date(ms);
    } catch {}
  }

  // Handle serialized Firestore timestamp: { _seconds, _nanoseconds }
  if (value && typeof value._seconds === 'number') {
    const ms = value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000);
    return new Date(ms);
  }

  // Handle client Firestore timestamp: { seconds, nanoseconds }
  if (value && typeof value.seconds === 'number') {
    const ms = value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
    return new Date(ms);
  }

  if (typeof value === 'number') {
    // Determine if seconds or milliseconds
    const ms = value > 1e11 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Check for "MM-DD-YYYY" format
    const formMatch = trimmed.match(/^(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})$/);
    if (formMatch) {
      const d = new Date(Number(formMatch[3]), Number(formMatch[1]) - 1, Number(formMatch[2]));
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

export function getOrderLifecycleTimestamp(order) {
  if (!order || typeof order !== 'object') return null;

  const rawStatus = String(order.status || '').toLowerCase().replace(/[\s-]+/g, '_');

  if (rawStatus === 'delivered' || rawStatus === 'completed') {
    const ts = order.deliveredAt || order.delivered_at || order.deliveredDateTime;
    if (ts) return ts;
  }

  if (rawStatus === 'cancelled' || rawStatus === 'canceled') {
    const ts = order.cancelledAt || order.canceled_at || order.cancelled_at;
    if (ts) return ts;
  }

  if (rawStatus === 'delivery_failed') {
    const ts = order.deliveryFailedAt || order.delivery_failed_at;
    if (ts) return ts;
  }

  if (rawStatus === 'out_for_delivery') {
    const ts = order.outForDeliveryAt || order.out_for_delivery_at;
    if (ts) return ts;
  }

  if (rawStatus === 'scheduled') {
    const ts = order.scheduledAt || order.scheduled_at || order.delivery_date;
    if (ts) return ts;
  }

  if (rawStatus === 'accepted') {
    const ts = order.acceptedAt || order.accepted_at;
    if (ts) return ts;
  }

  if (rawStatus === 'distributor_assigned') {
    const ts = order.assignedAt || order.assigned_at;
    if (ts) return ts;
  }

  return (
    order.updated_at ||
    order.updatedAt ||
    order.created_at ||
    order.createdAt ||
    order.when ||
    null
  );
}

export function formatNotificationTime(value, fallback = 'Recently') {
  const date = parseTimestamp(value);
  if (!date || Number.isNaN(date.getTime())) {
    return fallback;
  }

  try {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return date.toLocaleString();
  }
}
