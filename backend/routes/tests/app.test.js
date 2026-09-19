const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');

const { createAppServer } = require('../../app');
const { routes } = require('..');
const { getClientIp } = require('../../utils/request');

const EXPECTED_ROUTES = [
  '/api/admin/accounts',
  '/api/admin/branches',
  '/api/admin/managers',
  '/api/admin/registration-security',
  '/api/auth/accept-registration-terms',
  '/api/auth/check-username',
  '/api/auth/complete-registration',
  '/api/auth/complete-required-password-change',
  '/api/auth/create-registration-session',
  '/api/auth/login-with-username',
  '/api/auth/registration-policy',
  '/api/auth/registration-session-status',
  '/api/auth/request-email-otp',
  '/api/auth/request-registration-otp',
  '/api/auth/start-registration-face-verification',
  '/api/auth/verify-email-otp',
  '/api/manager/context',
  '/api/verification/face-service-status',
  '/api/verification/registration-face',
  '/api/verification/verify-face',
  '/api/verification/warm-face-service',
];

test('web and native API clients share the Render Node backend resolver', () => {
  const root = resolve(__dirname, '../../..');
  const config = readFileSync(resolve(root, 'services/apiClientConfig.js'), 'utf8');
  const web = readFileSync(resolve(root, 'services/apiClient.web.js'), 'utf8');
  const native = readFileSync(resolve(root, 'services/apiClient.native.js'), 'utf8');
  assert.match(config, /https:\/\/bluetap-clean\.onrender\.com/);
  assert.match(config, /hostname\.endsWith\('\.vercel\.app'\)/);
  assert.match(config, /bluetap-face-api\.onrender\.com/);
  assert.match(web, /apiClientConfig/);
  assert.match(native, /apiClientConfig/);
  assert.doesNotMatch(web + native, /bluetap-beta\.vercel\.app/);
});

async function withServer(run) {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('Render route map preserves every Vercel API path', () => {
  assert.deepEqual([...routes.keys()].sort(), EXPECTED_ROUTES);
  for (const handler of routes.values()) assert.equal(typeof handler, 'function');
});

test('Render rate limits use the first trusted forwarded client address', () => {
  const req = {
    headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.2' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.equal(getClientIp(req, { RENDER: 'true' }), '203.0.113.7');
  assert.equal(getClientIp(req, {}), '127.0.0.1');
});

test('health endpoint is lightweight and unknown paths return JSON 404', async () => {
  await withServer(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const missing = await fetch(`${baseUrl}/api/missing`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.reason, 'not-found');
  });
});

test('Render routes accept configured origins and reject unlisted production origins', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedOrigins = process.env.ALLOWED_ORIGINS;
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_ORIGINS = 'https://bluetap.example';
  try {
    await withServer(async (baseUrl) => {
      const allowed = await fetch(`${baseUrl}/api/auth/check-username`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://bluetap.example' },
      });
      assert.equal(allowed.status, 204);
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://bluetap.example');
      assert.equal(allowed.headers.get('access-control-allow-methods'), 'GET, POST, PATCH, OPTIONS');

      const productionWeb = await fetch(`${baseUrl}/api/auth/check-username`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://bluetap-beta.vercel.app' },
      });
      assert.equal(productionWeb.status, 204);
      assert.equal(productionWeb.headers.get('access-control-allow-origin'), 'https://bluetap-beta.vercel.app');

      const denied = await fetch(`${baseUrl}/api/auth/check-username`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://unexpected.example' },
      });
      assert.equal(denied.status, 403);
      assert.equal((await denied.json()).error.reason, 'origin-not-allowed');
    });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousAllowedOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previousAllowedOrigins;
  }
});

test('outer server failures and missing routes retain CORS before business logic', async () => {
  const server = createAppServer(new Map([['/api/failure', () => { throw new Error('test'); }]]));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const [path, status] of [['/api/missing', 404], ['/api/failure', 500]]) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: 'POST', headers: { Origin: 'https://bluetap-beta.vercel.app', 'Content-Type': 'application/json' }, body: '{}',
      });
      assert.equal(res.status, status);
      assert.equal(res.headers.get('access-control-allow-origin'), 'https://bluetap-beta.vercel.app');
      assert.match(res.headers.get('vary'), /Origin/);
      await res.json();
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
