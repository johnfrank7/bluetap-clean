const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const { createFaceServiceStatusHandler } = require('../faceServiceStatusHandler');
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
  assert.deepEqual(f.res.body, { status: 'ready' });
  assert.equal(f.renderCalls(), 1);
});

test('cold face service reports starting and never changes registration state', async () => {
  const error = Object.assign(new Error('private upstream detail'), { reason: 'FACE_SERVICE_PREPARING' });
  const f = fixture({ renderResult: error });
  await f.handler(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  assert.deepEqual(f.res.body, { status: 'starting' });
  assert.equal(JSON.stringify(f.res.body).includes('private upstream detail'), false);
});

test('disabled face policy does not wake or poll the Python service', async () => {
  const f = fixture({ required: false });
  await f.handler(f.req, f.res);
  assert.deepEqual(f.res.body, { status: 'not_required' });
  assert.equal(f.renderCalls(), 0);
});

test('warm-up remains bounded while allowing a 40-50 second Render wake-up', () => {
  assert.equal(FACE_SERVICE_WARMUP_WINDOW_MS, 60_000);
  assert.equal(shouldContinueFaceWarmup({ required: true, status: 'starting', startedAt: 1_000, now: 51_000 }), true);
  assert.equal(shouldContinueFaceWarmup({ required: true, status: 'starting', startedAt: 1_000, now: 61_000 }), false);
  assert.equal(shouldContinueFaceWarmup({ required: false, status: 'starting', startedAt: 1_000, now: 2_000 }), false);
});

test('preparing errors stay distinct from actual verification failures', () => {
  assert.equal(isFaceServicePreparationError({ code: 'registration/FACE_SERVICE_PREPARING' }), true);
  assert.equal(isFaceServicePreparationError({ code: 'registration/FACE_SERVICE_TIMEOUT' }), true);
  assert.equal(isFaceServicePreparationError({ code: 'registration/FACE_SERVICE_UNAVAILABLE' }), true);
  assert.equal(isFaceServicePreparationError({ code: 'registration/FACE_VERIFICATION_FAILED' }), false);
});

test('signup prewarms only a face-required session and renders neutral preparation UI', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const handler = readFileSync(resolve(root, 'backend/registration/registrationSessionHandler.js'), 'utf8');
  const capture = readFileSync(resolve(root, 'components/RegistrationFaceCapture.jsx'), 'utf8');
  assert.match(handler, /result\.securityPolicy\?\.faceVerificationRequired === true/);
  assert.match(handler, /Promise\.resolve\(\)\.then\(warmFaceService\)/);
  assert.match(capture, /Preparing face verification/);
  assert.match(capture, /Checking service\.\.\./);
  assert.match(capture, /serviceStatus !== 'ready'/);
});
