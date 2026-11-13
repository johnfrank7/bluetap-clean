const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { assertLocalQaServerEnvironment } = require('../config/localQaIsolation');

// This capability is injectable only by a local emulator test harness. HTTP
// input and deployed handler configuration cannot activate promotions.
function promotionTestCapability(getAdmin, options = {}) {
  if (options.emulatorPromotionPricing !== true) return false;
  const env = process.env;
  const project = env.GCLOUD_PROJECT;
  const isolatedPorts = project === 'demo-bluetap' && env.BLUETAP_PROMOTION_ISOLATED_TEST === '1';
  const firestoreHost = isolatedPorts ? '127.0.0.1:18080' : '127.0.0.1:8080';
  const authHost = isolatedPorts ? '127.0.0.1:19099' : '127.0.0.1:9099';
  const firestorePort = isolatedPorts ? 18080 : 8080;
  const forbidden = ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'EMAIL_PROVIDER', 'RESEND_API_KEY', 'VERCEL_MAIL_RELAY_URL', 'INTERNAL_MAIL_RELAY_SECRET', 'EMAIL_FROM_ADDRESS', 'DEEPFACE_API_URL', 'DEEPFACE_API_KEY', 'RENDER_EXTERNAL_HOSTNAME', 'RENDER_SERVICE_NAME', 'VERCEL_URL'];
  let configuredProject = project;
  if (env.FIREBASE_CONFIG) {
    try { configuredProject = JSON.parse(env.FIREBASE_CONFIG).projectId; }
    catch { throw new Error('Promotion test capability requires an isolated matching emulator project.'); }
  }
  if (getAdmin === getFirebaseAdmin || !['demo-bluetap', 'demo-bluetap-local-qa'].includes(project)
    || env.NODE_ENV === 'production' || env.APP_ENV === 'production'
    || env.FIRESTORE_EMULATOR_HOST !== firestoreHost || env.FIREBASE_AUTH_EMULATOR_HOST !== authHost
    || configuredProject !== project || [env.FIREBASE_PROJECT_ID, env.GOOGLE_CLOUD_PROJECT, env.EXPO_PUBLIC_FIREBASE_PROJECT_ID].some((value) => value && value !== project)
    || forbidden.some((key) => String(env[key] || '').trim())) throw new Error('Promotion test capability requires an isolated matching emulator project.');
  if (project === 'demo-bluetap-local-qa' && !assertLocalQaServerEnvironment(env)) throw new Error('Promotion test capability requires local QA isolation.');
  const { auth, db } = getAdmin();
  if (auth?.app?.options?.projectId !== project || db?.projectId !== project || db?._settings?.servicePath !== '127.0.0.1' || db?._settings?.port !== firestorePort || db?._settings?.ssl !== false || auth?.app?.options?.credential?.constructor?.name !== 'ApplicationDefaultCredential') throw new Error('Promotion test capability requires matching emulator clients without service-account credentials.');
  return true;
}

module.exports = { promotionTestCapability };
