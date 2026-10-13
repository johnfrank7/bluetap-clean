// Server-side application environment and production isolation constants.
const APP_ENVIRONMENTS = Object.freeze({
  DEVELOPMENT: 'development',
  STAGING: 'staging',
  PRODUCTION: 'production',
});

const KNOWN_PRODUCTION_RESOURCES = Object.freeze({
  FIREBASE_PROJECT_IDS: Object.freeze(['bluetap-8c98d']),
  BACKEND_HOSTS: Object.freeze(['bluetap-clean.onrender.com', 'bluetap-backend.onrender.com']),
  FACE_API_HOSTS: Object.freeze(['bluetap-face-api.onrender.com']),
  VERCEL_ORIGINS: Object.freeze(['https://bluetap-beta.vercel.app']),
  MAIL_RELAY_URLS: Object.freeze(['https://bluetap-beta.vercel.app/api/internal/send-otp-email']),
  SUPABASE_HOSTS: Object.freeze([]),
});

function normalizeEnvName(name) {
  const trimmed = String(name || '').trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed === 'test') return APP_ENVIRONMENTS.DEVELOPMENT;
  if (trimmed === 'dev') return APP_ENVIRONMENTS.DEVELOPMENT;
  return trimmed;
}

function getAppEnv(env = process.env) {
  const rawAppEnv = env.APP_ENV ? String(env.APP_ENV).trim().toLowerCase() : '';
  const rawExpoAppEnv = env.EXPO_PUBLIC_APP_ENV ? String(env.EXPO_PUBLIC_APP_ENV).trim().toLowerCase() : '';

  const validEnvs = new Set([
    APP_ENVIRONMENTS.DEVELOPMENT,
    APP_ENVIRONMENTS.STAGING,
    APP_ENVIRONMENTS.PRODUCTION,
    'test',
    'dev',
  ]);

  if (rawAppEnv && !validEnvs.has(rawAppEnv)) {
    throw new Error(`[BlueTap Environment Error] Invalid APP_ENV "${env.APP_ENV}". Valid values: development, staging, production.`);
  }

  if (rawExpoAppEnv && !validEnvs.has(rawExpoAppEnv)) {
    throw new Error(`[BlueTap Environment Error] Invalid EXPO_PUBLIC_APP_ENV "${env.EXPO_PUBLIC_APP_ENV}". Valid values: development, staging, production.`);
  }

  const normApp = normalizeEnvName(rawAppEnv);
  const normExpo = normalizeEnvName(rawExpoAppEnv);

  if (normApp && normExpo && normApp !== normExpo) {
    throw new Error(`[BlueTap Environment Conflict] Conflicting environment settings: APP_ENV="${env.APP_ENV}" and EXPO_PUBLIC_APP_ENV="${env.EXPO_PUBLIC_APP_ENV}".`);
  }

  const explicit = normApp || normExpo;
  if (explicit === 'staging') return APP_ENVIRONMENTS.STAGING;
  if (explicit === 'production') return APP_ENVIRONMENTS.PRODUCTION;
  if (explicit === 'development') return APP_ENVIRONMENTS.DEVELOPMENT;

  if (env.NODE_ENV === 'production') return APP_ENVIRONMENTS.PRODUCTION;
  return APP_ENVIRONMENTS.DEVELOPMENT;
}

function isKnownProductionFirebaseProject(projectId) {
  if (!projectId || typeof projectId !== 'string') return false;
  return KNOWN_PRODUCTION_RESOURCES.FIREBASE_PROJECT_IDS.includes(projectId.trim().toLowerCase());
}

function extractHostname(input) {
  if (!input || typeof input !== 'string') return '';
  try {
    const raw = input.trim();
    if (raw.includes('://')) {
      return new URL(raw).hostname.toLowerCase();
    }
    return raw.split('/')[0].split(':')[0].toLowerCase();
  } catch {
    return '';
  }
}

function isKnownProductionBackendHost(urlOrHost) {
  const hostname = extractHostname(urlOrHost);
  if (!hostname) return false;
  return KNOWN_PRODUCTION_RESOURCES.BACKEND_HOSTS.some((h) => h.toLowerCase() === hostname);
}

function isKnownProductionDeepFaceHost(urlOrHost) {
  const hostname = extractHostname(urlOrHost);
  if (!hostname) return false;
  return KNOWN_PRODUCTION_RESOURCES.FACE_API_HOSTS.some((h) => h.toLowerCase() === hostname);
}

function isKnownProductionMailRelay(url) {
  if (!url || typeof url !== 'string') return false;
  const normalized = url.trim().replace(/\/+$/, '');
  if (KNOWN_PRODUCTION_RESOURCES.MAIL_RELAY_URLS.some((target) => target.replace(/\/+$/, '') === normalized)) {
    return true;
  }
  const hostname = extractHostname(url);
  if (hostname && isKnownProductionVercelOrigin(hostname)) {
    return true;
  }
  return false;
}

function isKnownProductionVercelOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  const normalized = origin.trim().replace(/\/+$/, '');
  if (KNOWN_PRODUCTION_RESOURCES.VERCEL_ORIGINS.some((target) => target.replace(/\/+$/, '') === normalized)) {
    return true;
  }
  const hostname = extractHostname(origin);
  return KNOWN_PRODUCTION_RESOURCES.VERCEL_ORIGINS.some((target) => extractHostname(target) === hostname);
}

function isKnownProductionSupabaseHost(urlOrHost, env = process.env) {
  const hostname = extractHostname(urlOrHost);
  if (!hostname) return false;
  if (KNOWN_PRODUCTION_RESOURCES.SUPABASE_HOSTS.some((h) => h.toLowerCase() === hostname)) {
    return true;
  }
  const prodSupabase = env?.PRODUCTION_SUPABASE_URL || process.env?.PRODUCTION_SUPABASE_URL;
  if (prodSupabase) {
    const prodHostname = extractHostname(prodSupabase);
    if (prodHostname && prodHostname === hostname) return true;
  }
  return false;
}

module.exports = {
  APP_ENVIRONMENTS,
  KNOWN_PRODUCTION_RESOURCES,
  getAppEnv,
  isKnownProductionFirebaseProject,
  isKnownProductionBackendHost,
  isKnownProductionDeepFaceHost,
  isKnownProductionMailRelay,
  isKnownProductionVercelOrigin,
  isKnownProductionSupabaseHost,
};
