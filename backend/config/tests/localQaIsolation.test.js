const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { transformSync } = require('@babel/core');
const { assertLocalQaServerEnvironment, isLocalQaBrowserOrigin } = require('../localQaIsolation');
const { getPasswordApiKey } = require('../../username/usernameHandler');
const { createAppServer } = require('../../app');

const serverEnv = {
  APP_ENV: 'local-qa', LOCAL_QA_EMULATORS: '1', FIREBASE_PROJECT_ID: 'demo-bluetap-local-qa',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_WEB_API_KEY: 'fake-local-qa-key', EMAIL_OTP_HASH_SECRET: 'isolated-test-only-hash',
};
const clientEnv = {
  EXPO_PUBLIC_LOCAL_QA: '1', EXPO_PUBLIC_APP_ENV: 'local-qa',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-bluetap-local-qa',
  EXPO_PUBLIC_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
  EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST: '127.0.0.1', EXPO_PUBLIC_FIRESTORE_EMULATOR_PORT: '8080',
  EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3000',
};

function loadClient(relativePath, modules = {}) {
  const filename = resolve(__dirname, '../../..', relativePath);
  const code = transformSync(readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  const localRequire = (name) => modules[name] ||
    (name === '../firebase-web-config.json' ? require('../../../firebase-web-config.json') : require(name));
  new Function('require', 'module', 'exports', 'process', code)(localRequire, module, module.exports, process);
  return module.exports;
}

test('local QA server accepts only an exact demo project and loopback emulators without credentials', () => {
  assert.equal(assertLocalQaServerEnvironment(serverEnv), true);
  for (const [key, value] of [
    ['APP_ENV', 'production'], ['LOCAL_QA_EMULATORS', ''],
    ['FIREBASE_PROJECT_ID', 'bluetap-8c98d'],
    ['FIREBASE_AUTH_EMULATOR_HOST', 'bluetap-staging.firebaseapp.com:9099'],
    ['FIRESTORE_EMULATOR_HOST', '127.0.0.1:8081'],
    ['FIREBASE_WEB_API_KEY', ''], ['EMAIL_OTP_HASH_SECRET', ''],
    ['FIREBASE_CLIENT_EMAIL', 'any@example.test'], ['FIREBASE_PRIVATE_KEY', 'fake'],
    ['GOOGLE_APPLICATION_CREDENTIALS', 'any.json'], ['EMAIL_PROVIDER', 'resend'],
    ['RESEND_API_KEY', 'fake'], ['DEEPFACE_API_URL', 'https://example.test'],
    ['RENDER_EXTERNAL_HOSTNAME', 'bluetap-clean.onrender.com'],
  ]) {
    assert.throws(() => assertLocalQaServerEnvironment({ ...serverEnv, [key]: value }), /Local QA/, key);
  }
  assert.throws(() => assertLocalQaServerEnvironment({ ...serverEnv, NODE_ENV: 'production' }), /Local QA/);
  assert.equal(assertLocalQaServerEnvironment({ ...serverEnv, ALLOWED_ORIGINS: 'http://localhost:8082,http://127.0.0.1:8082' }), true);
  assert.throws(() => assertLocalQaServerEnvironment({ ...serverEnv, ALLOWED_ORIGINS: 'https://external.example.com' }), /loopback only/);
  assert.equal(assertLocalQaServerEnvironment({ APP_ENV: 'production', FIREBASE_PROJECT_ID: 'bluetap-8c98d' }), false);
});

test('local QA browser origin gate rejects production and external origins', () => {
  assert.equal(isLocalQaBrowserOrigin('http://127.0.0.1:8081'), true);
  assert.equal(isLocalQaBrowserOrigin('http://localhost:8081'), true);
  assert.equal(isLocalQaBrowserOrigin('http://127.0.0.1:8082'), true);
  assert.equal(isLocalQaBrowserOrigin('http://localhost:8082'), true);
  assert.equal(isLocalQaBrowserOrigin('https://bluetap-beta.vercel.app'), false);
  assert.equal(isLocalQaBrowserOrigin('https://external.example.com'), false);
  assert.equal(isLocalQaBrowserOrigin('null'), false);
});

test('local QA API applies its loopback origin policy to preflight and actual requests', async (t) => {
  const keys = { ...serverEnv, ALLOWED_ORIGINS: 'http://localhost:8081,http://127.0.0.1:8081,http://127.0.0.1:8082' };
  const original = Object.fromEntries(Object.keys(keys).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(keys)) process.env[key] = value;
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/health`;
  for (const method of ['OPTIONS', 'GET']) {
    const headers = { Origin: 'https://bluetap-beta.vercel.app' };
    if (method === 'OPTIONS') headers['Access-Control-Request-Method'] = 'GET';
    const external = await fetch(url, { method, headers });
    assert.equal(external.status, 403);
    assert.equal(external.headers.get('access-control-allow-origin'), null);
    for (const origin of ['http://localhost:8081', 'http://127.0.0.1:8081', 'http://127.0.0.1:8082']) {
      headers.Origin = origin;
      const local = await fetch(url, { method, headers });
      assert.equal(local.status, method === 'OPTIONS' ? 204 : 200);
      assert.equal(local.headers.get('access-control-allow-origin'), origin);
    }
  }
});

test('local QA web configuration and backend URL cannot fall back to production or staging', () => {
  const config = loadClient('services/stagingConfig.js');
  const api = loadClient('services/apiClientConfig.js', { './stagingConfig': config });
  assert.equal(config.resolveFirebaseWebConfig(clientEnv, 'localhost').projectId, 'demo-bluetap-local-qa');
  assert.equal(api.getApiBaseUrl(clientEnv, 'localhost'), 'http://127.0.0.1:3000');
  assert.equal(config.resolveLocalQaClient(clientEnv, 'localhost').authUrl, 'http://127.0.0.1:9099');
  for (const [key, value] of [
    ['EXPO_PUBLIC_LOCAL_QA', ''], ['EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'bluetap-8c98d'],
    ['EXPO_PUBLIC_AUTH_EMULATOR_URL', ''],
    ['EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST', 'bluetap-8c98d.firebaseapp.com'],
    ['EXPO_PUBLIC_FIRESTORE_EMULATOR_PORT', ''],
    ['EXPO_PUBLIC_FIREBASE_API_KEY', 'unexpected-key'],
  ]) {
    assert.throws(() => config.resolveFirebaseWebConfig({ ...clientEnv, [key]: value }, 'localhost'), /Local QA/, key);
  }
  assert.throws(() => config.resolveFirebaseWebConfig(clientEnv, 'bluetap-beta.vercel.app'), /Local QA/);
  assert.throws(() => api.getApiBaseUrl({ ...clientEnv, EXPO_PUBLIC_API_BASE_URL: 'https://bluetap-clean.onrender.com' }, 'localhost'), /Local QA/);
});

test('local QA server startup and username key check fail closed before any hosted fetch', async (t) => {
  const original = {};
  for (const [key, value] of Object.entries(serverEnv)) {
    original[key] = process.env[key]; process.env[key] = value;
  }
  t.after(() => {
    for (const key of Object.keys(serverEnv)) {
      if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
    }
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Hosted fetch forbidden'); });
  assert.equal(await getPasswordApiKey(), 'fake-local-qa-key');
  assert.equal(calls, 0);
  const server = createAppServer();
  assert.equal(server.listening, false);
  process.env.FIRESTORE_EMULATOR_HOST = 'bluetap-8c98d.firebaseapp.com:8080';
  assert.throws(() => createAppServer(), /Local QA/);
});
