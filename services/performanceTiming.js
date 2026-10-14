const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

const SENSITIVE_KEY_PATTERN = /token|auth|secret|password|email|phone|address|credential/i;

function sanitizeDetails(details = {}) {
  if (!details || typeof details !== 'object') return {};
  const clean = {};
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (typeof value === 'object' && value !== null) {
      clean[key] = Array.isArray(value) ? `[Array(${value.length})]` : '[Object]';
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export function recordTiming(metricName, durationMs, details = {}) {
  if (!isDev) return;
  try {
    const safe = sanitizeDetails(details);
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(`[perf] ${metricName}: ${Math.round(durationMs)}ms`, safe);
    }
  } catch {}
}

export function startTiming(metricName, initialDetails = {}) {
  const start = Date.now();
  return {
    end: (extraDetails = {}) => {
      const duration = Date.now() - start;
      recordTiming(metricName, duration, { ...initialDetails, ...extraDetails });
      return duration;
    },
  };
}

\n