const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { transformSync } = require('@babel/core');
const {
  assertStagingServerEnvironment,
  assertStagingRelayTarget,
} = require('../stagingIsolation');
const { createEmailProvider } = require('../../email/emailProvider');
const { getPasswordApiKey } = require('../../username/usernameHandler');
const { createAppServer } = require('../../app');
const { getFirebaseAdmin } = require('../../firebase/firebaseAdmin');

const validStaging = {
  APP_ENV: 'staging', FIREBASE_PROJECT_ID: 'bluetap-staging',
  FIREBASE_CLIENT_EMAIL: 'backend@bluetap-staging.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: 'test-only-key', FIREBASE_WEB_API_KEY: 'staging-test-key',
  FIREBASE_PROJECT_NUMBER: '123456789', EMAIL_PROVIDER: 'resend',
};

function loadClient(relativePath, modules = {}) {
  const filename = resolve(__dirname, '../../..', relativePath);
  const code = transformSync(readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  const localRequire = (name) => modules[name] ||
    (name === '../firebase-web-config.json' ? require('../../../firebase-web-config.json') : require(name));
  new Function('require', 'module', 'exports', 'process', code)(localRequire, module, module.exports, process);
  return module.exports;
}

test('staging backend accepts only the expected Firebase project and matching Admin identity', () => {
  assert.doesNotThrow(() => assertStagingServerEnvironment(validStaging));
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, FIREBASE_PROJECT_ID: 'bluetap-8c98d' }), /project identity/);
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, GOOGLE_CLOUD_PROJECT: 'bluetap-8c98d' }), /cloud project identity/);
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, FIREBASE_CLIENT_EMAIL: 'backend@bluetap-8c98d.iam.gserviceaccount.com' }), /credential identity/);
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, FIREBASE_PROJECT_ID: '' }), /project identity/);
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, FIREBASE_PRIVATE_KEY: '' }), /credential identity/);
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, FIREBASE_PROJECT_NUMBER: '' }), /project number/);
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, FIREBASE_WEB_API_KEY: '' }), /web key/);
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, FIREBASE_WEB_API_KEY: require('../../../firebase-web-config.json').apiKey }), /production Firebase web identity/);
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, FIREBASE_PROJECT_NUMBER: require('../../../firebase-web-config.json').messagingSenderId }), /production Firebase web identity/);
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, EXPO_PUBLIC_APP_ENV: 'production' }), /Conflicting/);
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, APP_ENV: 'stagin' }), /Invalid/);
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, RENDER_EXTERNAL_HOSTNAME: 'bluetap-staging-backend.onrender.com', APP_ENV: 'production' }), /Conflicting/);
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, FIREBASE_WEB_PROJECT_ID: 'bluetap-8c98d' }), /web project identity/);
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '987654321' }), /project numbers disagree/);
  assert.doesNotThrow(() => assertStagingServerEnvironment({ APP_ENV: 'production', FIREBASE_PROJECT_ID: 'bluetap-8c98d' }));
});

test('staging server startup and Admin access fail before connecting to Firebase', () => {
  const previous = {};
  const blocked = { ...validStaging, FIREBASE_CLIENT_EMAIL: 'admin@bluetap-8c98d.iam.gserviceaccount.com' };
  for (const [key, value] of Object.entries(blocked)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    assert.throws(() => createAppServer(), /credential identity/);
    assert.throws(() => getFirebaseAdmin(), /credential identity/);
  } finally {
    for (const key of Object.keys(blocked)) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test('staging production relay is blocked before provider fetch; Resend OTP and notices remain independent', async () => {
  const productionRelay = 'https://bluetap-beta.vercel.app/api/internal/send-otp-email';
  assert.throws(() => assertStagingRelayTarget({ ...validStaging, VERCEL_MAIL_RELAY_URL: productionRelay }), /production mail relay/);
  assert.throws(() => assertStagingRelayTarget({ ...validStaging, VERCEL_MAIL_RELAY_URL: 'https://unverified.example.test/api/internal/send-otp-email' }), /approved staging host/);
  assert.doesNotThrow(() => assertStagingRelayTarget({ ...validStaging, VERCEL_MAIL_RELAY_URL: 'https://bluetap-staging-web.vercel.app/api/internal/send-otp-email' }));
  assert.throws(() => assertStagingServerEnvironment({ ...validStaging, VERCEL_MAIL_RELAY_URL: productionRelay }), /production mail relay/);
  let relayCalls = 0;
  const relay = createEmailProvider({ env: { ...validStaging, EMAIL_PROVIDER: 'vercel-relay', VERCEL_MAIL_RELAY_URL: productionRelay,
    INTERNAL_MAIL_RELAY_SECRET: 'test-only' }, fetchImpl: async () => { relayCalls++; }, logger: { info() {}, error() {} } });
  await assert.rejects(relay.sendEmailOtp({ recipient: 'test@example.test', code: '123456', requestId: 'test-id' }), /production mail relay/);
  assert.equal(relayCalls, 0);

  const calls = [];
  const resend = createEmailProvider({ env: { ...validStaging, RESEND_API_KEY: 'test-only', EMAIL_FROM_ADDRESS: 'onboarding@resend.dev' },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 202 }; },
    logger: { info() {}, error() {} } });
  assert.equal((await resend.sendEmailOtp({ recipient: 'test@example.test', code: '123456', requestId: 'otp-id' })).provider, 'resend');
  assert.equal((await resend.sendEmail({ to: 'test@example.test', subject: 'Account notice', text: 'Notice',
    html: '<p>Notice</p>', requestId: 'notice-id' })).provider, 'resend');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ url }) => url === 'https://api.resend.com/emails'));
  assert.notEqual(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
});

test('staging web Firebase and backend configuration cannot fall back to production', () => {
  const staging = loadClient('services/stagingConfig.js');
  const api = loadClient('services/apiClientConfig.js', { './stagingConfig': staging });
  const env = {
    EXPO_PUBLIC_APP_ENV: 'staging', EXPO_PUBLIC_FIREBASE_API_KEY: 'staging-public-key',
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'bluetap-staging',
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'bluetap-staging.firebaseapp.com',
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123456789',
    EXPO_PUBLIC_FIREBASE_APP_ID: '1:123456789:web:staging',
    EXPO_PUBLIC_API_BASE_URL: 'https://bluetap-staging-backend.onrender.com',
  };
  assert.equal(staging.resolveFirebaseWebConfig(env).projectId, 'bluetap-staging');
  assert.equal(api.getApiBaseUrl(env), 'https://bluetap-staging-backend.onrender.com');
  assert.throws(() => staging.resolveFirebaseWebConfig({ ...env, EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'bluetap-8c98d' }), /identity/);
  assert.throws(() => staging.resolveFirebaseWebConfig({ ...env, EXPO_PUBLIC_FIREBASE_API_KEY: '' }), /identity/);
  assert.throws(() => staging.resolveFirebaseWebConfig({ ...env, EXPO_PUBLIC_FIREBASE_API_KEY: require('../../../firebase-web-config.json').apiKey }), /identity/);
  assert.throws(() => staging.resolveFirebaseWebConfig({ ...env, EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'bluetap-8c98d.firebaseapp.com' }), /identity/);
  assert.throws(() => api.getApiBaseUrl({ ...env, EXPO_PUBLIC_API_BASE_URL: 'https://bluetap-clean.onrender.com' }), /production backend/);
  assert.throws(() => api.getApiBaseUrl({ ...env, EXPO_PUBLIC_API_BASE_URL: 'https://unverified.example.test' }), /approved staging backend/);
  assert.throws(() => api.getApiBaseUrl({ ...env, EXPO_PUBLIC_API_BASE_URL: '' }), /missing or invalid/);
  assert.throws(() => staging.resolveFirebaseWebConfig({}, 'bluetap-staging-web.vercel.app'), /identity/);
  assert.throws(() => api.getApiBaseUrl({}, 'bluetap-staging-web.vercel.app'), /missing or invalid/);
  assert.throws(() => staging.resolveFirebaseWebConfig({ ...env, EXPO_PUBLIC_APP_ENV: 'stagin' }), /Invalid/);
  assert.equal(api.getApiBaseUrl({}), 'https://bluetap-clean.onrender.com');
});

test('staging username login API key is checked against the staging project number', async (t) => {
  const previous = {};
  for (const [key, value] of Object.entries(validStaging)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  t.after(() => {
    for (const key of Object.keys(validStaging)) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ projectId: '999999999' }) }));
  await assert.rejects(getPasswordApiKey(), /Web API key project mismatch/);
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ projectId: '123456789' }) }));
  assert.equal(await getPasswordApiKey(), 'staging-test-key');
  process.env.FIREBASE_WEB_API_KEY = 'second-staging-key';
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ projectId: 'bluetap-staging' }) }));
  assert.equal(await getPasswordApiKey(), 'second-staging-key');
});
