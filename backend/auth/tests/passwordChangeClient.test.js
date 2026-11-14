const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { transformSync } = require('@babel/core');

function client(fetchImpl, getApiUrl = (path) => `http://127.0.0.1:3000${path}`, options = {}) {
  const filename = resolve(__dirname, '../../../services/passwordChangeOtp.js');
  const code = transformSync(readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', 'process', 'globalThis', '__DEV__', code)(
    (name) => {
      if (name !== './apiClientConfig') throw new Error('Unexpected module');
      return { getApiUrl };
    }, module, module.exports, fetchImpl, { env: options.env || {} },
    { location: { hostname: options.hostname || 'localhost' } }, options.dev ?? true,
  );
  return module.exports.passwordChangeOtp;
}

const user = { getIdToken: async () => 'synthetic-token' };

test('password OTP request reaches the configured route with authentication', async () => {
  let calls = 0;
  const request = client(async (url, init) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:3000/api/auth/password-change-otp');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
    assert.deepEqual(JSON.parse(init.body), { action: 'request' });
    return { ok: true, status: 200, json: async () => ({ retryAfterSeconds: 60 }) };
  });
  assert.equal((await request(user, 'request')).retryAfterSeconds, 60);
  assert.equal(calls, 1);
});

test('only an explicitly configured development password request uses the loopback override', async () => {
  const authenticated = { ...user, auth: { app: { options: { projectId: 'bluetap-8c98d' } }, config: {} } };
  const request = client(async (url) => {
    assert.equal(url, 'http://127.0.0.1:3001/api/auth/password-change-otp');
    return { ok: true, json: async () => ({ sent: true }) };
  }, undefined, { env: { EXPO_PUBLIC_LOCAL_PASSWORD_CHANGE_URL: 'http://127.0.0.1:3001' } });
  assert.equal((await request(authenticated, 'request')).sent, true);
});

test('unsafe local password overrides fail before obtaining or sending a token', async () => {
  let tokenCalls = 0; let fetchCalls = 0;
  const authenticated = { getIdToken: async () => { tokenCalls++; }, auth: { app: { options: { projectId: 'bluetap-8c98d' } }, config: {} } };
  const cases = [
    { env: { EXPO_PUBLIC_LOCAL_PASSWORD_CHANGE_URL: 'http://example.test:3001' } },
    { env: { EXPO_PUBLIC_LOCAL_PASSWORD_CHANGE_URL: 'http://127.0.0.1:3001' }, hostname: 'external.example' },
    { env: { EXPO_PUBLIC_LOCAL_PASSWORD_CHANGE_URL: 'http://127.0.0.1:3001' }, dev: false },
  ];
  for (const options of cases) {
    await assert.rejects(client(async () => { fetchCalls++; }, undefined, options)(authenticated, 'request'), /not safely configured/);
  }
  const options = { env: { EXPO_PUBLIC_LOCAL_PASSWORD_CHANGE_URL: 'http://127.0.0.1:3001' } };
  for (const auth of [
    { app: { options: { projectId: 'demo-bluetap-local-qa' } }, config: {} },
    { app: { options: { projectId: 'bluetap-8c98d' } }, config: { emulator: { url: 'http://127.0.0.1:9099' } } },
  ]) {
    await assert.rejects(client(async () => { fetchCalls++; }, undefined, options)({ ...authenticated, auth }, 'request'), /not safely configured/);
  }
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('missing password route produces a useful backend error', async () => {
  const request = client(async () => ({
    ok: false, status: 404, json: async () => ({ error: { message: 'Endpoint not found.' } }),
  }));
  await assert.rejects(request(user, 'request'), /backend URL and restart an up-to-date backend/);
});

test('backend errors remain visible and unavailable services never report success', async () => {
  const request = client(async () => ({
    ok: false, status: 429,
    json: async () => ({ error: { reason: 'SEND_LIMIT', message: 'Please try again later.' } }),
  }));
  await assert.rejects(request(user, 'request'), (error) =>
    error.code === 'SEND_LIMIT' && error.message === 'Please try again later.');
});

test('missing mail transport reports the password change email limitation', async () => {
  const request = client(async () => ({
    ok: false, status: 503,
    json: async () => ({ error: { reason: 'MAIL_PROVIDER_CONFIG_MISSING', message: 'Password recovery email is unavailable.' } }),
  }));
  await assert.rejects(request(user, 'request'), (error) =>
    error.code === 'MAIL_PROVIDER_CONFIG_MISSING' && /Password change email is unavailable/.test(error.message));
});

test('network failure distinguishes a code request from uncertain confirmation', async () => {
  const request = client(async () => { throw new Error('offline'); });
  await assert.rejects(request(user, 'request'), /Could not reach the password change service/);
  await assert.rejects(request(user, 'confirm'), /could not be confirmed.*new password/);
});

test('configuration errors are not disguised as network errors', async () => {
  let contacted = false;
  const request = client(async () => { contacted = true; }, () => { throw new Error('Invalid local-QA backend configuration.'); });
  await assert.rejects(request(user, 'request'), /Invalid local-QA backend configuration/);
  assert.equal(contacted, false);
});
