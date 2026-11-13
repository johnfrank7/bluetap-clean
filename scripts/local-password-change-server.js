// Explicit, loopback-only development host for the existing password handler.
// It is not imported by the deployed backend or registered on public routes.
const http = require('node:http');
const { createRequestListener } = require('../backend/app');
const { createPasswordChangeOtpHandler } = require('../backend/auth/passwordChangeOtpHandler');
const { assertRecoveryTransportConfigured } = require('../backend/auth/passwordRecoveryHandler');
const { getFirebaseAdmin } = require('../backend/firebase/firebaseAdmin');

const project = 'bluetap-8c98d';
const route = '/api/auth/password-change-otp';
const origins = new Set(['http://localhost:8081', 'http://127.0.0.1:8081']);

function validateEnvironment(env = process.env) {
  const appEnv = String(env.APP_ENV || '').trim().toLowerCase();
  const publicEnv = String(env.EXPO_PUBLIC_APP_ENV || '').trim().toLowerCase();
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  if (env.BLUETAP_LOCAL_PASSWORD_CHANGE !== '1' || env.FIREBASE_PROJECT_ID !== project ||
      !String(env.FIREBASE_CLIENT_EMAIL || '').toLowerCase().endsWith(`@${project}.iam.gserviceaccount.com`) ||
      !env.FIREBASE_PRIVATE_KEY || String(env.EMAIL_OTP_HASH_SECRET || '').length < 32 ||
      (appEnv && appEnv !== 'development') || (publicEnv && publicEnv !== 'development') ||
      (nodeEnv && !['development', 'test'].includes(nodeEnv)) || env.LOCAL_QA_EMULATORS === '1' ||
      env.EXPO_PUBLIC_LOCAL_QA === '1' || env.BLUETAP_TRIP_EMULATOR_MODE === '1' ||
      env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST || env.EXPO_PUBLIC_AUTH_EMULATOR_URL ||
      env.EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST || env.GOOGLE_APPLICATION_CREDENTIALS ||
      [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].some((id) => id && id !== project) ||
      (env.EXPO_PUBLIC_FIREBASE_PROJECT_ID && env.EXPO_PUBLIC_FIREBASE_PROJECT_ID !== project)) {
    throw new Error('Local password service requires explicit enablement and matching server-only Firebase configuration without emulators.');
  }
  assertRecoveryTransportConfigured(env);
}

function createLocalServer(handler = createPasswordChangeOtpHandler()) {
  const listener = createRequestListener(new Map([[route, handler]]));
  return http.createServer((req, res) => {
    // Reject DNS rebinding, absent or nonlocal browser origins, and every other
    // route before the shared request handler examines the body or token.
    if (req.headers.host !== '127.0.0.1:3001' || !origins.has(req.headers.origin)) {
      res.writeHead(403).end();
      return;
    }
    if (req.url !== route) {
      res.writeHead(404).end();
      return;
    }
    listener(req, res);
  });
}

if (require.main === module) {
  try {
    validateEnvironment();
    const { auth, db } = getFirebaseAdmin();
    if (auth.app.options.projectId !== project || db.projectId !== project) throw new Error('Project mismatch');
    const server = createLocalServer();
    server.on('error', () => { console.error('Local password service could not bind to 127.0.0.1:3001.'); process.exitCode = 1; });
    server.listen(3001, '127.0.0.1', () => console.log('Local password service listening on 127.0.0.1:3001.'));
  } catch {
    console.error('Local password service did not start: check its private Firebase, hash secret, and email transport configuration.');
    process.exitCode = 1;
  }
}

module.exports = { validateEnvironment, createLocalServer };
