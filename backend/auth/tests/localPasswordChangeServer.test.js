const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { validateEnvironment, createLocalServer } = require('../../../scripts/local-password-change-server');

const valid = {
  BLUETAP_LOCAL_PASSWORD_CHANGE: '1', FIREBASE_PROJECT_ID: 'bluetap-8c98d',
  FIREBASE_CLIENT_EMAIL: 'synthetic@bluetap-8c98d.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: 'synthetic', EMAIL_OTP_HASH_SECRET: 'x'.repeat(40),
  EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'synthetic', EMAIL_FROM_ADDRESS: 'test@example.test',
};

test('local password service requires explicit matching Firebase and mail configuration', () => {
  assert.doesNotThrow(() => validateEnvironment(valid));
  for (const change of [
    { BLUETAP_LOCAL_PASSWORD_CHANGE: '' }, { FIREBASE_PROJECT_ID: 'demo-bluetap-local-qa' },
    { FIREBASE_CLIENT_EMAIL: 'wrong@example.test' }, { FIREBASE_PRIVATE_KEY: '' },
    { EMAIL_OTP_HASH_SECRET: '' }, { RESEND_API_KEY: '' }, { APP_ENV: 'production' },
    { EXPO_PUBLIC_APP_ENV: 'staging' }, { NODE_ENV: 'Production' },
    { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, { EXPO_PUBLIC_LOCAL_QA: '1' },
    { GOOGLE_APPLICATION_CREDENTIALS: 'example.json' }, { GCLOUD_PROJECT: 'another-project' },
  ]) assert.throws(() => validateEnvironment({ ...valid, ...change }));
});

test('local server only routes the password endpoint from the approved browser origins', async (t) => {
  let calls = 0;
  const server = createLocalServer((req, res) => { calls++; res.status(401).json({ error: { reason: 'unauthorized' } }); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const request = (pathname, origin, host = '127.0.0.1:3001', method = 'POST') => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: { host, ...(origin ? { origin } : {}) } },
      (res) => { res.resume(); res.on('end', () => resolve(res)); });
    req.on('error', reject); req.end();
  });
  assert.equal((await request('/api/auth/password-change-otp', 'http://localhost:8081')).statusCode, 401);
  assert.equal((await request('/api/auth/password-change-otp', 'http://localhost:8081', undefined, 'OPTIONS')).statusCode, 204);
  assert.equal((await request('/api/auth/password-change-otp', 'https://example.test')).statusCode, 403);
  assert.equal((await request('/api/auth/password-change-otp', null)).statusCode, 403);
  assert.equal((await request('/api/auth/password-change-otp', 'http://localhost:8081', 'example.test:3001')).statusCode, 403);
  assert.equal((await request('/api/auth/password-recovery', 'http://localhost:8081')).statusCode, 404);
  assert.equal(calls, 1);
});
