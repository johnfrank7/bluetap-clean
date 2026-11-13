const test = require('node:test');
const assert = require('node:assert/strict');
const { assertPasswordMailIsolation } = require('../../../scripts/local-qa-password-mail');

class ApplicationDefaultCredential {}
const admin = () => ({
  auth: { app: { options: { projectId: 'demo-bluetap-local-qa', credential: new ApplicationDefaultCredential() } } },
  db: { projectId: 'demo-bluetap-local-qa', _settings: { servicePath: '127.0.0.1', port: 8080, ssl: false } },
});
const safe = {
  BLUETAP_QA_PASSWORD_MAIL: '1', APP_ENV: 'local-qa', LOCAL_QA_EMULATORS: '1',
  FIREBASE_PROJECT_ID: 'demo-bluetap-local-qa', GCLOUD_PROJECT: 'demo-bluetap-local-qa',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_WEB_API_KEY: 'fake-local-qa-key', EMAIL_OTP_HASH_SECRET: 'synthetic-test-only',
};

test('password mail capture requires explicit local-QA isolation and a private controller', (t) => {
  const fields = [...Object.keys(safe), 'NODE_ENV', 'GOOGLE_CLOUD_PROJECT', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
    'EXPO_PUBLIC_APP_ENV', 'EXPO_PUBLIC_API_BASE_URL', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
    'GOOGLE_APPLICATION_CREDENTIALS', 'EMAIL_PROVIDER', 'RESEND_API_KEY', 'VERCEL_MAIL_RELAY_URL',
    'INTERNAL_MAIL_RELAY_SECRET', 'EMAIL_FROM_ADDRESS', 'DEEPFACE_API_URL', 'DEEPFACE_API_KEY',
    'RENDER_EXTERNAL_HOSTNAME', 'RENDER_SERVICE_NAME', 'VERCEL_URL', 'ALLOWED_ORIGINS'];
  const previous = Object.fromEntries(fields.map((key) => [key, process.env[key]]));
  const originalSend = process.send;
  const originalConnected = process.connected;
  t.after(() => {
    for (const key of fields) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    if (originalSend === undefined) delete process.send; else process.send = originalSend;
    if (originalConnected === undefined) delete process.connected; else process.connected = originalConnected;
  });
  for (const key of fields) delete process.env[key];
  Object.assign(process.env, safe);
  process.send = () => {};
  process.connected = true;
  assert.doesNotThrow(() => assertPasswordMailIsolation(admin));
  for (const [key, value] of [
    ['BLUETAP_QA_PASSWORD_MAIL', '0'], ['FIREBASE_PROJECT_ID', 'another-project'],
    ['FIREBASE_AUTH_EMULATOR_HOST', 'example.test:9099'],
    ['FIRESTORE_EMULATOR_HOST', 'example.test:8080'],
    ['FIREBASE_CLIENT_EMAIL', 'synthetic@example.test'],
    ['GOOGLE_APPLICATION_CREDENTIALS', 'synthetic.json'], ['EMAIL_PROVIDER', 'resend'],
  ]) {
    const original = process.env[key];
    process.env[key] = value;
    assert.throws(() => assertPasswordMailIsolation(admin));
    if (original === undefined) delete process.env[key]; else process.env[key] = original;
  }
  process.connected = false;
  assert.throws(() => assertPasswordMailIsolation(admin), /test controller/);
  process.connected = true;
  assert.throws(() => assertPasswordMailIsolation(() => ({ ...admin(), db: { ...admin().db, projectId: 'another-project' } })), /matching local emulators/);
});
