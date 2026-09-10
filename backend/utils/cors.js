const DEFAULT_DEVELOPMENT_ORIGINS = new Set([
  'http://localhost:19006',
  'http://localhost:8081',
  'http://localhost:3000',
  'http://127.0.0.1:19006',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:3000',
]);

function configuredOrigins(env = process.env) {
  return new Set(
    String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
}

function isSameOrigin(req, origin) {
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isAllowedOrigin(req, origin, env = process.env) {
  if (!origin) return true;
  const normalized = String(origin).replace(/\/+$/, '');
  if (isSameOrigin(req, normalized)) return true;
  if (configuredOrigins(env).has(normalized)) return true;
  return env.NODE_ENV !== 'production' && DEFAULT_DEVELOPMENT_ORIGINS.has(normalized);
}

function applyCors(req, res, env = process.env) {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (!isAllowedOrigin(req, origin, env)) {
    res.status(403).json({
      error: {
        reason: 'origin-not-allowed',
        message: 'This website is not allowed to use the BlueTap API.',
      },
    });
    return false;
  }

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  return true;
}

module.exports = { applyCors, configuredOrigins, isAllowedOrigin };
