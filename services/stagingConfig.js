import productionFirebaseConfig from '../firebase-web-config.json';

const STAGING_PROJECT_ID = 'bluetap-staging';
const STAGING_WEB_HOST = 'bluetap-staging-web.vercel.app';
const STAGING_BACKEND_HOST = 'bluetap-staging-backend.onrender.com';
const PRODUCTION_BACKEND_HOSTS = ['bluetap-clean.onrender.com', 'bluetap-backend.onrender.com'];
const LOCAL_QA_PROJECT_ID = 'demo-bluetap-local-qa';
const LOCAL_QA_API_URL = 'http://127.0.0.1:3000';
const LOCAL_QA_AUTH_URL = 'http://127.0.0.1:9099';

function bundledEnvironment() {
  return {
    APP_ENV: process.env.APP_ENV,
    EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
    EXPO_PUBLIC_LOCAL_QA: process.env.EXPO_PUBLIC_LOCAL_QA,
    EXPO_PUBLIC_AUTH_EMULATOR_URL: process.env.EXPO_PUBLIC_AUTH_EMULATOR_URL,
    EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST: process.env.EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST,
    EXPO_PUBLIC_FIRESTORE_EMULATOR_PORT: process.env.EXPO_PUBLIC_FIRESTORE_EMULATOR_PORT,
    EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  };
}

function localQaRequested(env) {
  return env.EXPO_PUBLIC_LOCAL_QA === '1' || env.EXPO_PUBLIC_APP_ENV === 'local-qa' ||
    env.APP_ENV === 'local-qa' || env.EXPO_PUBLIC_FIREBASE_PROJECT_ID === LOCAL_QA_PROJECT_ID;
}

export function resolveLocalQaClient(env = bundledEnvironment(), hostname = globalThis.location?.hostname) {
  if (!localQaRequested(env)) return null;
  const expected = {
    EXPO_PUBLIC_FIREBASE_API_KEY: 'fake-local-qa-key',
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: `${LOCAL_QA_PROJECT_ID}.firebaseapp.com`,
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '111111111111',
    EXPO_PUBLIC_FIREBASE_APP_ID: '1:111111111111:web:localqa',
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: `${LOCAL_QA_PROJECT_ID}.appspot.com`,
  };
  const contradictoryIdentity = Object.entries(expected).some(([key, value]) =>
    env[key] && String(env[key]).trim() !== value);
  if (env.EXPO_PUBLIC_LOCAL_QA !== '1' || env.EXPO_PUBLIC_APP_ENV !== 'local-qa' ||
      (env.APP_ENV && env.APP_ENV !== 'local-qa') ||
      !['localhost', '127.0.0.1'].includes(String(hostname || '').toLowerCase()) ||
      env.EXPO_PUBLIC_FIREBASE_PROJECT_ID !== LOCAL_QA_PROJECT_ID ||
      env.EXPO_PUBLIC_API_BASE_URL !== LOCAL_QA_API_URL ||
      env.EXPO_PUBLIC_AUTH_EMULATOR_URL !== LOCAL_QA_AUTH_URL ||
      env.EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST !== '127.0.0.1' ||
      String(env.EXPO_PUBLIC_FIRESTORE_EMULATOR_PORT) !== '8080' || contradictoryIdentity) {
    throw new Error('Local QA requires the demo Firebase project and exact loopback emulator and API targets.');
  }
  return {
    firebase: {
      apiKey: expected.EXPO_PUBLIC_FIREBASE_API_KEY,
      authDomain: expected.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: LOCAL_QA_PROJECT_ID,
      messagingSenderId: expected.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: expected.EXPO_PUBLIC_FIREBASE_APP_ID,
      storageBucket: expected.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    },
    authUrl: LOCAL_QA_AUTH_URL,
    firestoreHost: '127.0.0.1',
    firestorePort: 8080,
    apiUrl: LOCAL_QA_API_URL,
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
  const localQa = resolveLocalQaClient(env, hostname);
  if (localQa) return localQa.firebase;
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
  const localQa = resolveLocalQaClient(env, hostname);
  if (localQa) {
    if (url !== localQa.apiUrl) throw new Error('Local QA backend must use the exact loopback API target.');
    return;
  }
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
