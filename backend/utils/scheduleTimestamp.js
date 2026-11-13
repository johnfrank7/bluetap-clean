// Return null for missing or malformed values; callers decide whether absence is valid.
function scheduleTimestampMillis(value) {
  try {
    if (value == null || value === '') return null;
    let millis;
    if (value instanceof Date) millis = value.getTime();
    else if (typeof value.toMillis === 'function') millis = value.toMillis();
    else if (typeof value.toDate === 'function') millis = value.toDate().getTime();
    else if (typeof value === 'object') {
      const seconds = value.seconds ?? value._seconds;
      const nanos = value.nanoseconds ?? value._nanoseconds ?? 0;
      if (!Number.isFinite(seconds) || !Number.isFinite(nanos) || nanos < 0 || nanos >= 1e9) return null;
      millis = seconds * 1000 + Math.floor(nanos / 1e6);
    } else if (typeof value === 'number') millis = Math.abs(value) < 1e11 ? value * 1000 : value;
    else if (typeof value === 'string' && value.trim()) millis = new Date(value).getTime();
    else return null;
    return Number.isFinite(millis) && Number.isFinite(new Date(millis).getTime()) ? millis : null;
  } catch { return null; }
}

module.exports = { scheduleTimestampMillis };
