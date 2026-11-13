const test = require('node:test');
const assert = require('node:assert/strict');
const { requireTripEmulator } = require('../../utils/deliveryTripFoundation');

const fields = ['BLUETAP_TRIP_EMULATOR_MODE', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_APP_ENV', 'EXPO_PUBLIC_API_BASE_URL', 'APP_ENV', 'NODE_ENV', 'LOCAL_QA_EMULATORS', 'FIREBASE_WEB_API_KEY', 'EMAIL_OTP_HASH_SECRET', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'EMAIL_PROVIDER', 'RESEND_API_KEY', 'VERCEL_MAIL_RELAY_URL', 'INTERNAL_MAIL_RELAY_SECRET', 'EMAIL_FROM_ADDRESS', 'DEEPFACE_API_URL', 'DEEPFACE_API_KEY', 'RENDER_EXTERNAL_HOSTNAME', 'RENDER_SERVICE_NAME', 'VERCEL_URL', 'ALLOWED_ORIGINS'];
const base = { BLUETAP_TRIP_EMULATOR_MODE: '1', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', GCLOUD_PROJECT: 'demo-bluetap', FIREBASE_PROJECT_ID: 'demo-bluetap' };
const db = (project = 'demo-bluetap') => ({ _settings: { projectId: project, servicePath: '127.0.0.1', port: 8080, ssl: false } });
const auth = (project = 'demo-bluetap') => ({ app: { options: { projectId: project } } });

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(fields.map((key) => [key, process.env[key]]));
  try {
    for (const key of fields) delete process.env[key];
    Object.assign(process.env, values);
    return callback();
  } finally {
    for (const key of fields) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
}

test('trip gate accepts only complete matching demo and local-QA emulator configurations', () => {
  withEnvironment(base, () => assert.doesNotThrow(() => requireTripEmulator(db(), auth())));
  const project = 'demo-bluetap-local-qa';
  const qa = { ...base, APP_ENV: 'local-qa', LOCAL_QA_EMULATORS: '1', FIREBASE_PROJECT_ID: project, GCLOUD_PROJECT: project, FIREBASE_WEB_API_KEY: 'fake-local-qa-key', EMAIL_OTP_HASH_SECRET: 'synthetic-test-only' };
  withEnvironment(qa, () => assert.doesNotThrow(() => requireTripEmulator(db(project), auth(project))));
  const { GCLOUD_PROJECT: unused, ...qaWithoutCloudProject } = qa;
  withEnvironment(qaWithoutCloudProject, () => assert.doesNotThrow(() => requireTripEmulator(db(project), auth(project))));
  for (const [key, value] of [['LOCAL_QA_EMULATORS', ''], ['FIREBASE_WEB_API_KEY', ''], ['EMAIL_OTP_HASH_SECRET', ''], ['APP_ENV', 'production']]) {
    withEnvironment({ ...qa, [key]: value }, () => assert.throws(() => requireTripEmulator(db(project), auth(project)), { reason: 'TRIP_MODE_DISABLED' }));
  }
});

test('trip gate rejects disabled, mismatched, hosted or credentialed configurations', () => {
  for (const [key, value] of [['BLUETAP_TRIP_EMULATOR_MODE', ''], ['FIRESTORE_EMULATOR_HOST', ''], ['FIRESTORE_EMULATOR_HOST', 'firestore.googleapis.com:443'], ['FIREBASE_AUTH_EMULATOR_HOST', ''], ['FIREBASE_AUTH_EMULATOR_HOST', 'identitytoolkit.googleapis.com:443'], ['GCLOUD_PROJECT', ''], ['GCLOUD_PROJECT', 'bluetap-8c98d'], ['FIREBASE_PROJECT_ID', 'different-project'], ['GOOGLE_CLOUD_PROJECT', 'different-project'], ['NODE_ENV', 'production'], ['APP_ENV', 'local-qa'], ['LOCAL_QA_EMULATORS', '1'], ['EXPO_PUBLIC_APP_ENV', 'local-qa'], ['EXPO_PUBLIC_APP_ENV', 'production'], ['EXPO_PUBLIC_API_BASE_URL', 'https://bluetap-clean.onrender.com'], ['FIREBASE_PRIVATE_KEY', 'synthetic'], ['GOOGLE_APPLICATION_CREDENTIALS', 'synthetic.json'], ['EMAIL_PROVIDER', 'hosted'], ['DEEPFACE_API_URL', 'https://example.invalid'], ['RENDER_SERVICE_NAME', 'hosted']]) {
    withEnvironment({ ...base, [key]: value }, () => assert.throws(() => requireTripEmulator(db(), auth()), { reason: 'TRIP_MODE_DISABLED' }), key);
  }
  withEnvironment(base, () => {
    assert.throws(() => requireTripEmulator(db('demo-bluetap-local-qa'), auth()), { reason: 'TRIP_MODE_DISABLED' });
    assert.throws(() => requireTripEmulator(db(), auth('demo-bluetap-local-qa')), { reason: 'TRIP_MODE_DISABLED' });
    assert.throws(() => requireTripEmulator({ _settings: { ...db()._settings, servicePath: 'firestore.googleapis.com' } }, auth()), { reason: 'TRIP_MODE_DISABLED' });
    const credentialed = auth(); credentialed.app.options.credential = { constructor: { name: 'ServiceAccountCredential' } };
    assert.throws(() => requireTripEmulator(db(), credentialed), { reason: 'TRIP_MODE_DISABLED' });
  });
});
