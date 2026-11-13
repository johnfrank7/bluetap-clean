const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const script = path.resolve(__dirname, '../../../scripts/local-qa-admin-drafts.js');
const safeEnvironment = {
  APP_ENV: 'local-qa', LOCAL_QA_EMULATORS: '1', BLUETAP_DRAFT_QA: '1',
  GCLOUD_PROJECT: 'demo-bluetap-local-qa', FIREBASE_PROJECT_ID: 'demo-bluetap-local-qa',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_WEB_API_KEY: 'fake-local-qa-key', EMAIL_OTP_HASH_SECRET: 'synthetic-test-only',
};

function rejected(overrides, expected) {
  const result = spawnSync(process.execPath, [script], {
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, ...safeEnvironment, ...overrides },
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, expected);
}

test('draft QA requires explicit enablement and matching emulator projects', () => {
  rejected({ BLUETAP_DRAFT_QA: '' }, /Explicit isolated local-QA enablement/);
  rejected({ GCLOUD_PROJECT: 'some-other-project' }, /Explicit isolated local-QA enablement/);
  rejected({ FIREBASE_CONFIG: '{"projectId":"some-other-project"}' }, /matching emulator project/);
});

test('draft QA rejects non-loopback emulators, credentials and experimental trip mode', () => {
  rejected({ FIRESTORE_EMULATOR_HOST: 'example.test:8080' }, /exact loopback emulators/);
  rejected({ FIREBASE_AUTH_EMULATOR_HOST: 'example.test:9099' }, /exact loopback emulators/);
  rejected({ GOOGLE_APPLICATION_CREDENTIALS: 'some-credentials.json' }, /service-account credentials/);
  rejected({ BLUETAP_TRIP_EMULATOR_MODE: '1' }, /trip mode must remain disabled/);
});
