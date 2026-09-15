const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const { createFaceServiceStatusHandler } = require('../faceServiceStatusHandler');
const { createFaceServiceWarmupHandler } = require('../faceServiceWarmupHandler');
const {
  FACE_SERVICE_WARMUP_WINDOW_MS,
  isFaceServicePreparationError,
  shouldContinueFaceWarmup,
} = require('../../../services/faceServiceWarmupCore');

const id = '12345678-1234-4123-8123-123456789abc';

function fixture({ required = true, renderResult = { status: 'ready', modelLoaded: true } } = {}) {
  let renderCalls = 0;
  const data = {
    completed: false,
    expiresAt: new Date(Date.now() + 60_000),
    securityPolicySnapshot: { faceVerificationRequired: required },
  };
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => data }) }) }) };
  const render = async () => {
    renderCalls += 1;
    if (renderResult instanceof Error) throw renderResult;
    return renderResult;
  };
  const handler = createFaceServiceStatusHandler({ getAdmin: () => ({ db }), render });
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ registrationSessionId: id }),
  };
  const res = {
    setHeader: () => {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return { handler, req, res, renderCalls: () => renderCalls };
}

test('face-service status reports ready through Node without exposing the upstream response', async () => {
  const f = fixture();
  await f.handler(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  assert.deepEqual(f.res.body, { status: 'ready', code: 'FACE_SERVICE_READY' });
  assert.equal(f.renderCalls(), 1);
});

test('cold face service reports starting and never changes registration state', async () => {
  const error = Object.assign(new Error('private upstream detail'), { reason: 'FACE_SERVICE_PREPARING' });
  const f = fixture({ renderResult: error });
  await f.handler(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  assert.deepEqual(f.res.body, { status: 'starting', code: 'FACE_SERVICE_PREPARING' });
  assert.equal(JSON.stringify(f.res.body).includes('private upstream detail'), false);
});

test('disabled face policy does not wake or poll the Python service', async () => {
  const f = fixture({ required: false });
  await f.handler(f.req, f.res);
  assert.deepEqual(f.res.body, { status: 'not_required', code: 'FACE_SERVICE_NOT_REQUIRED' });
  assert.equal(f.renderCalls(), 0);
});

test('signup click endpoint respects current policy and never waits for Python', async () => {
  for (const [enabled, expectedStatus, expectedCalls] of [[true, 202, 1], [false, 200, 0]]) {
    let calls = 0;
    const db = {
      collection: () => ({
        doc: () => ({ get: async () => ({
          exists: true,
          data: () => ({ faceVerificationEnabled: enabled, emailOtpEnabled: true, maxAccountsPerDevice: 3, maxAccountsPerIp: 3 }),
        }) }),
      }),
    };
    const handler = createFaceServiceWarmupHandler({
      getAdmin: () => ({ db }),
      warmFaceService: () => { calls += 1; return new Promise(() => {}); },
    });
    const res = { setHeader: () => {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'POST', headers: {} }, res);
    await Promise.resolve();
    assert.equal(res.statusCode, expectedStatus);
    assert.equal(calls, expectedCalls);
  }
});

test('warm-up remains bounded while allowing a 20-70 second Render wake-up', () => {
  assert.equal(FACE_SERVICE_WARMUP_WINDOW_MS, 75_000);
  assert.equal(shouldContinueFaceWarmup({ required: true, status: 'starting', startedAt: 1_000, now: 21_000 }), true);
  assert.equal(shouldContinueFaceWarmup({ required: true, status: 'starting', startedAt: 1_000, now: 51_000 }), true);
  assert.equal(shouldContinueFaceWarmup({ required: true, status: 'starting', startedAt: 1_000, now: 71_000 }), true);
  assert.equal(shouldContinueFaceWarmup({ required: true, status: 'starting', startedAt: 1_000, now: 76_000 }), false);
  assert.equal(shouldContinueFaceWarmup({ required: false, status: 'starting', startedAt: 1_000, now: 2_000 }), false);
});

test('preparing errors stay distinct from actual verification failures', () => {
  assert.equal(isFaceServicePreparationError({ code: 'registration/FACE_SERVICE_PREPARING' }), true);
  assert.equal(isFaceServicePreparationError({ code: 'registration/FACE_SERVICE_TIMEOUT' }), true);
  assert.equal(isFaceServicePreparationError({ code: 'registration/FACE_SERVICE_UNAVAILABLE' }), true);
  assert.equal(isFaceServicePreparationError({ code: 'registration/FACE_SERVICE_UPSTREAM_ERROR' }), true);
  assert.equal(isFaceServicePreparationError({ code: 'registration/FACE_VERIFICATION_FAILED' }), false);
});

test('non-retryable readiness failures preserve a safe diagnostic code', async () => {
  for (const reason of ['FACE_SERVICE_AUTH_FAILED', 'FACE_SERVICE_ROUTE_MISMATCH', 'FACE_SERVICE_UPSTREAM_ERROR']) {
    const f = fixture({ renderResult: Object.assign(new Error('private detail'), { reason }) });
    await f.handler(f.req, f.res);
    assert.equal(f.res.statusCode, 200);
    assert.deepEqual(f.res.body, { status: 'unavailable', code: reason });
    assert.equal(JSON.stringify(f.res.body).includes('private detail'), false);
  }
});

test('signup prewarms only a face-required session and renders neutral preparation UI', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const handler = readFileSync(resolve(root, 'backend/registration/registrationSessionHandler.js'), 'utf8');
  const statusHandler = readFileSync(resolve(root, 'backend/verification/faceServiceStatusHandler.js'), 'utf8');
  const capture = readFileSync(resolve(root, 'components/RegistrationFaceCapture.jsx'), 'utf8');
  const login = readFileSync(resolve(root, 'app/login.jsx'), 'utf8');
  const landing = readFileSync(resolve(root, 'app/index.jsx'), 'utf8');
  const warmup = readFileSync(resolve(root, 'services/apiWarmup.js'), 'utf8');
  assert.match(handler, /result\.securityPolicy\?\.faceVerificationRequired === true/);
  assert.match(handler, /Promise\.resolve\(\)\.then\(warmFaceService\)/);
  assert.match(handler, /FACE_PREWARM_TRIGGERED/);
  assert.match(statusHandler, /render = getWarmFaceService/);
  assert.match(capture, /Preparing face verification/);
  assert.match(capture, /Checking service\.\.\./);
  assert.match(capture, /serviceStatus !== 'ready'/);
  assert.match(login, /warmFaceServiceForSignup\(\)/);
  assert.match(landing, /warmFaceServiceForSignup\(\)/);
  assert.match(warmup, /inFlight/);
  assert.match(warmup, /warmLoginBackend/);
});

test('verification pipeline emits safe stage names around each upstream operation', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const service = readFileSync(resolve(root, 'backend/verification/registrationFace.js'), 'utf8');
  for (const stage of [
    'FACE_VERIFY_STARTED', 'FACE_VERIFY_FAILED',
    'FACE_DUPLICATE_CHECK_STARTED', 'FACE_DUPLICATE_CHECK_FAILED',
    'FACE_STORE_STARTED', 'FACE_STORE_FAILED',
  ]) assert.match(service, new RegExp(stage));
  assert.doesNotMatch(service, /logger\[[^\]]+\].*(image|embedding|authorization)/i);
});
