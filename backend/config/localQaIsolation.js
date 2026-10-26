// Local browser QA is opt-in and can only use the disposable Firebase emulators.
const LOCAL_QA_PROJECT_ID = 'demo-bluetap-local-qa';
const LOCAL_QA_WEB_KEY = 'fake-local-qa-key';

function localQaRequested(env = process.env) {
  return env.APP_ENV === 'local-qa' || env.LOCAL_QA_EMULATORS === '1' ||
    env.FIREBASE_PROJECT_ID === LOCAL_QA_PROJECT_ID;
}

function assertLocalQaServerEnvironment(env = process.env) {
  if (!localQaRequested(env)) return false;
  if (env.APP_ENV !== 'local-qa' || env.LOCAL_QA_EMULATORS !== '1' ||
      env.FIREBASE_PROJECT_ID !== LOCAL_QA_PROJECT_ID ||
      env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
      env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      env.FIREBASE_WEB_API_KEY !== LOCAL_QA_WEB_KEY ||
      !String(env.EMAIL_OTP_HASH_SECRET || '').trim() ||
      env.NODE_ENV === 'production' ||
      [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT, env.EXPO_PUBLIC_FIREBASE_PROJECT_ID]
        .some((value) => value && value !== LOCAL_QA_PROJECT_ID) ||
      (env.EXPO_PUBLIC_APP_ENV && env.EXPO_PUBLIC_APP_ENV !== 'local-qa') ||
      (env.EXPO_PUBLIC_API_BASE_URL && env.EXPO_PUBLIC_API_BASE_URL !== 'http://127.0.0.1:3000')) {
    throw new Error('Local QA requires the demo project, exact loopback emulators and an isolated login hash secret.');
  }
  const forbidden = [
    'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_APPLICATION_CREDENTIALS',
    'EMAIL_PROVIDER', 'RESEND_API_KEY', 'VERCEL_MAIL_RELAY_URL', 'INTERNAL_MAIL_RELAY_SECRET',
    'EMAIL_FROM_ADDRESS', 'DEEPFACE_API_URL', 'DEEPFACE_API_KEY',
    'RENDER_EXTERNAL_HOSTNAME', 'RENDER_SERVICE_NAME', 'VERCEL_URL',
  ];
  if (forbidden.some((key) => String(env[key] || '').trim())) {
    throw new Error('Local QA cannot use hosted services, email providers or service-account credentials.');
  }
  if (env.ALLOWED_ORIGINS) {
    const origins = String(env.ALLOWED_ORIGINS).split(',').map((item) => item.trim()).filter(Boolean);
    for (const origin of origins) {
      try {
        const url = new URL(origin);
        if (!['localhost', '127.0.0.1'].includes(url.hostname.toLowerCase())) {
          throw new Error('Local QA allowed origins must be loopback only.');
        }
      } catch {
        throw new Error('Local QA allowed origins must be loopback only.');
      }
    }
  }
  return true;
}

function isLocalQaBrowserOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname.toLowerCase()) &&
      url.origin === origin;
  } catch {
    return false;
  }
}

module.exports = { LOCAL_QA_PROJECT_ID, LOCAL_QA_WEB_KEY, localQaRequested, assertLocalQaServerEnvironment, isLocalQaBrowserOrigin };
