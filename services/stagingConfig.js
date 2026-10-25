import productionFirebaseConfig from '../firebase-web-config.json';

const STAGING_PROJECT_ID = 'bluetap-staging';
const STAGING_WEB_HOST = 'bluetap-staging-web.vercel.app';
const STAGING_BACKEND_HOST = 'bluetap-staging-backend.onrender.com';
const PRODUCTION_BACKEND_HOSTS = ['bluetap-clean.onrender.com', 'bluetap-backend.onrender.com'];

function bundledEnvironment() {
  return {
    APP_ENV: process.env.APP_ENV,
    EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
    EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  };
}

export function isStagingClient(env = bundledEnvironment(), hostname = globalThis.location?.hostname) {
  const appEnv = String(env.APP_ENV || '').trim().toLowerCase();
  const publicEnv = String(env.EXPO_PUBLIC_APP_ENV || '').trim().toLowerCase();
  if ([appEnv, publicEnv].some((value) => value && !['development', 'staging', 'production'].includes(value))) {
    throw new Error('Invalid application environment setting.');
  }
  const stagingHost = String(hostname || '').toLowerCase() === STAGING_WEB_HOST;
  if ((appEnv && publicEnv && appEnv !== publicEnv) ||
      (stagingHost && (appEnv && appEnv !== 'staging' || publicEnv && publicEnv !== 'staging'))) {
    throw new Error('Conflicting staging application environment.');
  }
  return stagingHost || appEnv === 'staging' || publicEnv === 'staging';
}

export function resolveFirebaseWebConfig(env = bundledEnvironment(), hostname) {
  if (!isStagingClient(env, hostname)) return productionFirebaseConfig;
  const projectId = String(env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  const apiKey = String(env.EXPO_PUBLIC_FIREBASE_API_KEY || '').trim();
  const authDomain = String(env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || '').trim();
  const messagingSenderId = String(env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '').trim();
  const appId = String(env.EXPO_PUBLIC_FIREBASE_APP_ID || '').trim();
  const storageBucket = String(env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || '').trim();
  if (projectId !== STAGING_PROJECT_ID || !apiKey || apiKey === productionFirebaseConfig.apiKey ||
      authDomain !== `${STAGING_PROJECT_ID}.firebaseapp.com` ||
      !/^\d+$/.test(messagingSenderId) || messagingSenderId === productionFirebaseConfig.messagingSenderId ||
      !appId.startsWith(`1:${messagingSenderId}:web:`) ||
      storageBucket.includes('bluetap-8c98d')) {
    throw new Error('Staging Firebase web identity is missing or incorrect.');
  }
  return { apiKey, authDomain, projectId, messagingSenderId, appId,
    ...(storageBucket ? { storageBucket } : {}) };
}

export function assertStagingBackendUrl(url, env = bundledEnvironment(), hostname) {
  if (!isStagingClient(env, hostname)) return;
  if (!String(env.EXPO_PUBLIC_API_BASE_URL || '').trim() || !url) {
    throw new Error('Staging backend URL is missing or invalid.');
  }
  const target = new URL(url);
  if (PRODUCTION_BACKEND_HOSTS.includes(target.hostname.toLowerCase())) {
    throw new Error('Staging cannot connect to the production backend.');
  }
  if (target.hostname.toLowerCase() !== STAGING_BACKEND_HOST) {
    throw new Error('Staging API target is not the approved staging backend.');
  }
}

export { bundledEnvironment };
