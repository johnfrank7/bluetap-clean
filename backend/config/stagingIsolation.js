// Staging must never inherit production Firebase or mail configuration.
const STAGING_PROJECT_ID = 'bluetap-staging';
const PRODUCTION_PROJECT_ID = 'bluetap-8c98d';
const PRODUCTION_RELAY_HOST = 'bluetap-beta.vercel.app';
const STAGING_RELAY_HOST = 'bluetap-staging-web.vercel.app';
const STAGING_RENDER_HOST = 'bluetap-staging-backend.onrender.com';
const productionWebConfig = require('../../firebase-web-config.json');

function isStaging(env = process.env) {
  const appEnv = String(env.APP_ENV || '').trim().toLowerCase();
  const clientEnv = String(env.EXPO_PUBLIC_APP_ENV || '').trim().toLowerCase();
  if ([appEnv, clientEnv].some((value) => value && !['development', 'staging', 'production'].includes(value))) {
    throw new Error('Invalid application environment setting.');
  }
  const stagingHost = String(env.RENDER_EXTERNAL_HOSTNAME || '').trim().toLowerCase() === STAGING_RENDER_HOST ||
    String(env.RENDER_SERVICE_NAME || '').trim().toLowerCase() === 'bluetap-staging-backend';
  if (appEnv && clientEnv && appEnv !== clientEnv) {
    throw new Error('Conflicting application environment settings.');
  }
  if (stagingHost && [appEnv, clientEnv].some((value) => value && value !== 'staging')) {
    throw new Error('Conflicting staging application environment.');
  }
  return stagingHost || appEnv === 'staging' || clientEnv === 'staging';
}

function assertStagingRelayTarget(env = process.env) {
  if (!isStaging(env) || !env.VERCEL_MAIL_RELAY_URL) return;
  let target;
  try { target = new URL(String(env.VERCEL_MAIL_RELAY_URL)); } catch {
    throw new Error('Staging mail relay URL is invalid.');
  }
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash ||
      target.pathname !== '/api/internal/send-otp-email') {
    throw new Error('Staging mail relay URL is invalid.');
  }
  const host = target.hostname.toLowerCase();
  if (host === PRODUCTION_RELAY_HOST) {
    throw new Error('Staging cannot target the production mail relay.');
  }
  if (host !== STAGING_RELAY_HOST) {
    throw new Error('Staging mail relay target is not the approved staging host.');
  }
}

function assertStagingServerEnvironment(env = process.env) {
  if (!isStaging(env)) return;
  if (String(env.FIREBASE_PROJECT_ID || '').trim() !== STAGING_PROJECT_ID) {
    throw new Error('Staging Firebase project identity is missing or incorrect.');
  }
  if ([env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].some((value) =>
    value && String(value).trim() !== STAGING_PROJECT_ID)) {
    throw new Error('Staging cloud project identity is contradictory.');
  }
  const email = String(env.FIREBASE_CLIENT_EMAIL || '').trim().toLowerCase();
  if (!email.endsWith(`@${STAGING_PROJECT_ID}.iam.gserviceaccount.com`) || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error('Staging Firebase Admin credential identity is missing or incorrect.');
  }
  if ([env.FIREBASE_WEB_PROJECT_ID, env.EXPO_PUBLIC_FIREBASE_PROJECT_ID].some((value) =>
    value && String(value).trim() !== STAGING_PROJECT_ID)) {
    throw new Error('Staging Firebase web project identity is incorrect.');
  }
  if (!String(env.FIREBASE_WEB_API_KEY || '').trim() ||
      !/^\d+$/.test(String(env.FIREBASE_PROJECT_NUMBER || '').trim())) {
    throw new Error('Staging Firebase web key or project number is missing.');
  }
  if (String(env.FIREBASE_WEB_API_KEY).trim() === productionWebConfig.apiKey ||
      String(env.FIREBASE_PROJECT_NUMBER).trim() === String(productionWebConfig.messagingSenderId)) {
    throw new Error('Staging cannot use the known production Firebase web identity.');
  }
  if (env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID &&
      String(env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID).trim() !== String(env.FIREBASE_PROJECT_NUMBER).trim()) {
    throw new Error('Staging Firebase project numbers disagree.');
  }
  assertStagingRelayTarget(env);
}

module.exports = {
  STAGING_PROJECT_ID,
  PRODUCTION_PROJECT_ID,
  isStaging,
  assertStagingRelayTarget,
  assertStagingServerEnvironment,
};
