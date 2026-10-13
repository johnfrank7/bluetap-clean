// Client-side application environment and production isolation constants.
export const APP_ENVIRONMENTS = Object.freeze({
  DEVELOPMENT: 'development',
  STAGING: 'staging',
  PRODUCTION: 'production',
});

export const KNOWN_PRODUCTION_RESOURCES = Object.freeze({
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

export function getAppEnv(env = null) {
  const customAppEnv = env && env.APP_ENV !== undefined ? env.APP_ENV : undefined;
  const customExpoEnv = env && env.EXPO_PUBLIC_APP_ENV !== undefined ? env.EXPO_PUBLIC_APP_ENV : undefined;
  const customNodeEnv = env && env.NODE_ENV !== undefined ? env.NODE_ENV : undefined;

  const rawAppEnv = customAppEnv !== undefined
    ? String(customAppEnv || '').trim().toLowerCase()
    : (typeof process !== 'undefined' && process.env && process.env.APP_ENV ? String(process.env.APP_ENV).trim().toLowerCase() : '');

  const rawExpoAppEnv = customExpoEnv !== undefined
    ? String(customExpoEnv || '').trim().toLowerCase()
    : (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_APP_ENV ? String(process.env.EXPO_PUBLIC_APP_ENV).trim().toLowerCase() : '');

  const validEnvs = new Set([
    APP_ENVIRONMENTS.DEVELOPMENT,
    APP_ENVIRONMENTS.STAGING,
    APP_ENVIRONMENTS.PRODUCTION,
    'test',
    'dev',
  ]);

  const displayAppEnv = customAppEnv !== undefined ? customAppEnv : (typeof process !== 'undefined' && process.env ? process.env.APP_ENV : '');
  const displayExpoEnv = customExpoEnv !== undefined ? customExpoEnv : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_APP_ENV : '');

  if (rawAppEnv && !validEnvs.has(rawAppEnv)) {
    throw new Error(`[BlueTap Environment Error] Invalid APP_ENV "${displayAppEnv}". Valid values: development, staging, production.`);
  }

  if (rawExpoAppEnv && !validEnvs.has(rawExpoAppEnv)) {
    throw new Error(`[BlueTap Environment Error] Invalid EXPO_PUBLIC_APP_ENV "${displayExpoEnv}". Valid values: development, staging, production.`);
  }

  const normApp = normalizeEnvName(rawAppEnv);
  const normExpo = normalizeEnvName(rawExpoAppEnv);

  if (normApp && normExpo && normApp !== normExpo) {
    throw new Error(`[BlueTap Environment Conflict] Conflicting environment settings: APP_ENV="${displayAppEnv}" and EXPO_PUBLIC_APP_ENV="${displayExpoEnv}".`);
  }

  const explicit = normApp || normExpo;
  if (explicit === 'staging') return APP_ENVIRONMENTS.STAGING;
  if (explicit === 'production') return APP_ENVIRONMENTS.PRODUCTION;
  if (explicit === 'development') return APP_ENVIRONMENTS.DEVELOPMENT;

  const nodeEnv = customNodeEnv !== undefined
    ? customNodeEnv
    : (typeof process !== 'undefined' && process.env ? process.env.NODE_ENV : '');

  if (nodeEnv === 'production') return APP_ENVIRONMENTS.PRODUCTION;
  return APP_ENVIRONMENTS.DEVELOPMENT;
}

export function isKnownProductionFirebaseProject(projectId) {
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

export function isKnownProductionBackendHost(urlOrHost) {
  const hostname = extractHostname(urlOrHost);
  if (!hostname) return false;
  return KNOWN_PRODUCTION_RESOURCES.BACKEND_HOSTS.some((h) => h.toLowerCase() === hostname);
}

export function isKnownProductionDeepFaceHost(urlOrHost) {
  const hostname = extractHostname(urlOrHost);
  if (!hostname) return false;
  return KNOWN_PRODUCTION_RESOURCES.FACE_API_HOSTS.some((h) => h.toLowerCase() === hostname);
}

export function isKnownProductionMailRelay(url) {
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

export function isKnownProductionVercelOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  const normalized = origin.trim().replace(/\/+$/, '');
  if (KNOWN_PRODUCTION_RESOURCES.VERCEL_ORIGINS.some((target) => target.replace(/\/+$/, '') === normalized)) {
    return true;
  }
  const hostname = extractHostname(origin);
  return KNOWN_PRODUCTION_RESOURCES.VERCEL_ORIGINS.some((target) => extractHostname(target) === hostname);
}

export function isKnownProductionSupabaseHost(urlOrHost, env = process.env) {
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
