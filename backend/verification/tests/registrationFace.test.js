const test = require('node:test');
const assert = require('node:assert/strict');
const { createRegistrationFaceService } = require('../registrationFace');
const { createRenderFaceClient } = require('../renderFaceClient');
const { runFaceCaptureFlow } = require('../../../services/faceCaptureFlow');
const id = '12345678-1234-4123-8123-123456789abc';
const image = 'data:image/jpeg;base64,/9j/2Q==';
function fixture(options = {}) {
  let time = 1800000000000;
  const records = new Map([['registrationSessions/' + id, { expiresAt: new Date(time + 3600000), completed: false }]]);
  const snapshot = (key) => ({ exists: records.has(key), data: () => records.get(key) });
  const db = { collection: (collection) => ({ doc: (key) => ({ key: collection + '/' + key, get: async () => snapshot(collection + '/' + key) }) }),
    runTransaction: async (fn) => fn({ get: async (ref) => snapshot(ref.key), set: (ref, data) => records.set(ref.key, data), update: (ref, data) => records.set(ref.key, { ...records.get(ref.key), ...data }), delete: (ref) => records.delete(ref.key) }) };
  const calls = [];
  const args = { db, now: () => time, timestamp: () => 'server-timestamp', render: async (path, form) => {
    calls.push({ path, form });
    const response = options[path] || {
      '/ready': { status: 'ready', modelLoaded: true }, '/verify-face': { verified: true },
      '/check-duplicate': { duplicateDetected: false, reviewRequired: false, distance: null, threshold: 0.637 },
      '/store-registration-face': { stored: true, duplicateDetected: false, reviewRequired: false, registrationSessionId: id, expiresAt: '2026-01-01T00:00:00Z' },
    }[path];
    if (response instanceof Error) throw response;
    return response;
  } };
  if (!options.productionDetector) args.detector = { available: true, evaluate: async () => options.verdict || { passed: true, faceCount: 1, continuousIdentity: true } };
  const service = createRegistrationFaceService(args);
  let challenge;
  return { service, records, calls, advance: (ms) => { time += ms; }, data: () => records.get('registrationSessions/' + id),
    begin: async () => { challenge = await service.begin(id); return challenge; },
    evaluate: (extra = {}) => service.evaluate({ registrationSessionId: id, challengeId: challenge.challengeId, frames: [image, image, image], ...extra }),
    complete: (extra = {}) => service.complete({ registrationSessionId: id, challengeId: challenge.challengeId, referenceImage: image, image, ...extra }),
    webComplete: (extra = {}) => service.webComplete({ registrationSessionId: id, challengeId: challenge.challengeId, referenceImage: image, image, ...extra }),
  };
}
test('production detector stays unavailable; client liveness fields cannot grant a pass', async () => {
  const f = fixture({ productionDetector: true });
  const c = await f.begin();
  assert.equal(c.detectorAvailable, false);
  assert.match(c.instruction, /^Turn your head (left|right)$/);
  await assert.rejects(f.evaluate({ passed: true, livenessPassed: true }), (e) => e.reason === 'liveness-unavailable');
  await assert.rejects(f.complete(), (e) => e.reason === 'face-challenge-expired');
  assert.equal(f.calls.length, 0);
});
test('web capture performs a temporary trusted check without enrollment', async () => {
  const f = fixture({ productionDetector: true });
  await f.begin();
  const result = await f.webComplete({ faceVerification: { status: 'verified', livenessPassed: true } });
  assert.equal(result.faceVerification.status, 'passed_pending_finalization');
  assert.equal(result.faceVerification.duplicateCheck, 'clear');
  assert.deepEqual(f.calls.map((call) => call.path), ['/ready', '/verify-face', '/check-duplicate', '/store-registration-face']);
  assert.equal(f.data().faceVerification.verificationMode, 'web-camera-capture');
  assert.equal(f.data().faceVerification.providerVerified, true);
  assert.equal(JSON.stringify([...f.records]).includes('base64'), false);
});
test('web capture fails closed for missing challenge, expired session, rejected match, and duplicates', async () => {
  const missing = fixture({ productionDetector: true });
  await assert.rejects(missing.service.webComplete({ registrationSessionId: id, challengeId: 'forged', referenceImage: image, image }), (error) => error.reason === 'face-challenge-expired');

  const expired = fixture({ productionDetector: true });
  await expired.begin(); expired.advance(3600001);
  await assert.rejects(expired.webComplete(), (error) => error.reason === 'registration-session-expired');

  const rejected = fixture({ productionDetector: true, '/verify-face': { verified: false } });
  await rejected.begin();
  assert.equal((await rejected.webComplete()).faceVerification.status, 'failed');

  const duplicate = fixture({ productionDetector: true, '/check-duplicate': { duplicateDetected: true, reviewRequired: true, distance: 0.1, threshold: 0.637 } });
  await duplicate.begin();
  assert.equal((await duplicate.webComplete()).faceVerification.status, 'review_required');

  const invalidImage = fixture({ productionDetector: true });
  await invalidImage.begin();
  await assert.rejects(invalidImage.webComplete({ image: 'not-an-image' }), /JPEG or PNG/);

  const unavailable = fixture({ productionDetector: true, '/ready': new Error('timeout') });
  await unavailable.begin();
  await assert.rejects(unavailable.webComplete());
  assert.equal(unavailable.data().faceVerification.status, 'unverified');
});
test('no face, multiple faces, incomplete motion or broken continuity block enrollment', async () => {
  for (const verdict of [{ passed: true, faceCount: 0, continuousIdentity: true }, { passed: true, faceCount: 2, continuousIdentity: true }, { passed: false, faceCount: 1, continuousIdentity: true }, { passed: true, faceCount: 1, continuousIdentity: false }]) {
    const f = fixture({ verdict }); await f.begin();
    assert.equal((await f.evaluate()).challengePassed, false);
    assert.equal(f.data().faceVerification.failureReason, 'liveness_failed');
    await assert.rejects(f.complete()); assert.equal(f.calls.length, 0);
  }
});
test('trusted challenge, pair binding, and clear search create only a pending-finalization session', async () => {
  const f = fixture(); await f.begin(); await f.evaluate();
  const result = await f.complete({ subject_id: 'attacker', faceVerification: { status: 'verified' } });
  assert.equal(result.faceVerification.status, 'passed_pending_finalization');
  assert.deepEqual(f.calls.map((c) => c.path), ['/ready', '/verify-face', '/check-duplicate', '/store-registration-face']);
  assert.equal(f.data().faceVerification.verificationReference, id);
  assert.equal(f.data().faceVerification.verifiedAt, 'server-timestamp');
  assert.equal(f.data().faceChallenge.state, 'used');
  assert.equal(JSON.stringify([...f.records]).includes('base64'), false);
  assert.equal(JSON.stringify(result).includes(id), false);
  await assert.rejects(f.complete());
});
test('duplicate search requires review before temporary verification can proceed', async () => {
  for (const options of [{ '/check-duplicate': { duplicateDetected: true, reviewRequired: true, distance: 0.1, threshold: 0.637, subject_id: 'private' } }]) {
    const f = fixture(options); await f.begin(); await f.evaluate();
    const result = await f.complete();
    assert.equal(result.faceVerification.status, 'review_required');
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(f.calls.length, 3);
  }
});
test('outage and malformed responses fail closed before any enrollment', async () => {
  for (const options of [{ '/ready': { ready: false } }, { '/check-duplicate': {} }]) {
    const f = fixture(options); await f.begin(); await f.evaluate();
    await assert.rejects(f.complete());
    assert.equal(f.data().faceVerification.status, 'unverified');
  }
});
test('challenge expiry, missing evidence and substituted reference cannot self-verify', async () => {
  const f = fixture(); await f.begin(); await assert.rejects(f.evaluate({ frames: [] }));
  await f.evaluate(); await assert.rejects(f.complete({ referenceImage: 'substituted' }));
  f.advance(120001); await assert.rejects(f.complete());
  assert.equal(f.calls.length, 0);
});
test('capture waits for detector pass, cancels on back, and never passes via elapsed time', async () => {
  for (const passed of [false, true]) {
    let captures = 0; let completions = 0;
    await runFaceCaptureFlow({ challenge: { detectorAvailable: true, instruction: 'Turn left' },
      capture: async () => { captures++; return image; }, pause: async () => {}, showInstruction: () => {}, assertActive: () => {},
      evaluate: async () => { assert.equal(captures, 3); return { challengePassed: passed }; },
      complete: async () => { completions++; assert.equal(captures, 4); return {}; },
    });
    assert.equal(captures, passed ? 4 : 3); assert.equal(completions, passed ? 1 : 0);
  }
  let captures = 0;
  await assert.rejects(runFaceCaptureFlow({ challenge: { detectorAvailable: false }, capture: async () => { captures++; } }));
  await assert.rejects(runFaceCaptureFlow({ challenge: { detectorAvailable: true }, assertActive: () => { throw new Error('cancelled'); } }));
  assert.equal(captures, 0);
});

test('Render face client reports safe upstream failure stages without exposing credentials', async () => {
  const env = { DEEPFACE_API_URL: 'https://face.example.test', DEEPFACE_API_KEY: 'server-secret' };
  const cases = [
    [401, 502, 'FACE_SERVICE_AUTH_FAILED'],
    [403, 502, 'FACE_SERVICE_AUTH_FAILED'],
    [404, 502, 'FACE_SERVICE_ROUTE_MISMATCH'],
    [422, 400, 'FACE_INPUT_INVALID'],
    [500, 503, 'FACE_SERVICE_UPSTREAM_ERROR'],
    [503, 503, 'FACE_SERVICE_UNAVAILABLE'],
  ];
  for (const [upstreamStatus, status, reason] of cases) {
    const request = createRenderFaceClient({ env, fetchImpl: async () => ({ ok: false, status: upstreamStatus }), readyRetryDelayMs: 0 });
    await assert.rejects(request('/verify-face', new FormData()), (error) => {
      assert.equal(error.status, status);
      assert.equal(error.reason, reason);
      assert.deepEqual(error.details, { upstreamPath: '/verify-face', upstreamStatus });
      assert.equal(JSON.stringify(error).includes(env.DEEPFACE_API_KEY), false);
      return true;
    });
  }
  const request = createRenderFaceClient({ env, fetchImpl: async () => { throw new Error('private network detail'); } });
  await assert.rejects(request('/check-duplicate', new FormData()), (error) => {
    assert.equal(error.reason, 'FACE_SERVICE_UNAVAILABLE');
    assert.deepEqual(error.details, { upstreamPath: '/check-duplicate' });
    assert.equal(JSON.stringify(error).includes('private network detail'), false);
    return true;
  });
});

test('ready check retries are bounded and cold start leaves the registration challenge retryable', async () => {
  const logs = [];
  let calls = 0;
  const request = createRenderFaceClient({
    env: { DEEPFACE_API_URL: 'https://face.example.test', DEEPFACE_API_KEY: 'server-secret' },
    fetchImpl: async () => { calls++; return { ok: false, status: 503 }; },
    logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    readyAttempts: 2,
    readyRetryDelayMs: 0,
  });
  await assert.rejects(request('/ready'), (error) => error.status === 503 && error.reason === 'FACE_SERVICE_PREPARING');
  assert.equal(calls, 2);
  const serialized = JSON.stringify(logs);
  assert.ok(serialized.includes('FACE_UPSTREAM_READY_CHECK'));
  assert.ok(serialized.includes('FACE_UPSTREAM_STATUS'));
  assert.ok(serialized.includes('FACE_UPSTREAM_FAILED'));
  assert.ok(serialized.includes('FACE_READY_ATTEMPT'));
  assert.ok(serialized.includes('FACE_READY_NOT_READY'));
  assert.ok(serialized.includes('FACE_READY_CHECK_RETRY'));
  assert.equal(serialized.includes('server-secret'), false);

  const f = fixture({ productionDetector: true, '/ready': Object.assign(new Error('warming'), { reason: 'FACE_SERVICE_PREPARING' }) });
  await f.begin();
  await assert.rejects(f.webComplete(), (error) => error.reason === 'FACE_SERVICE_PREPARING');
  assert.equal(f.data().faceChallenge.state, 'issued');
  assert.equal(f.data().faceVerification.status, 'unverified');
});

test('readiness treats temporary Python 500 responses as warming but verification still fails safely', async () => {
  const env = { DEEPFACE_API_URL: 'https://face.example.test', DEEPFACE_API_KEY: 'server-secret' };
  const ready = createRenderFaceClient({ env, fetchImpl: async () => ({ ok: false, status: 500 }), readyAttempts: 1 });
  await assert.rejects(ready('/ready'), (error) => error.reason === 'FACE_SERVICE_PREPARING');
  const verify = createRenderFaceClient({ env, fetchImpl: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(verify('/verify-face', new FormData()), (error) => error.reason === 'FACE_SERVICE_UPSTREAM_ERROR');
});

test('ready check can recover from one cold-start response and uses the trusted bearer contract', async () => {
  const calls = [];
  const logs = [];
  const request = createRenderFaceClient({
    env: { DEEPFACE_API_URL: 'https://face.example.test', DEEPFACE_API_KEY: 'server-secret' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return { ok: false, status: 503 };
      return { ok: true, status: 200, json: async () => ({ status: 'ready', modelLoaded: true }) };
    },
    logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    readyAttempts: 2,
    readyRetryDelayMs: 0,
  });
  assert.deepEqual(await request('/ready'), { status: 'ready', modelLoaded: true });
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://face.example.test/ready',
    'https://face.example.test/ready',
  ]);
  assert.ok(calls.every(({ options }) => options.method === 'GET'));
  assert.ok(calls.every(({ options }) => options.headers.Authorization === 'Bearer server-secret'));
  assert.ok(JSON.stringify(logs).includes('FACE_READY_200'));
});

test('face upstream timeout is safe and bounded', async () => {
  const logs = [];
  const request = createRenderFaceClient({
    env: { DEEPFACE_API_URL: 'https://face.example.test', DEEPFACE_API_KEY: 'server-secret' },
    fetchImpl: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('private timeout'), { name: 'AbortError' })), { once: true });
    }),
    logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    readyAttempts: 1,
    readyAttemptTimeoutMs: 5,
    readyRetryDelayMs: 0,
  });
  await assert.rejects(request('/ready'), (error) => error.status === 504 && error.reason === 'FACE_SERVICE_TIMEOUT');
  assert.ok(JSON.stringify(logs).includes('FACE_UPSTREAM_TIMEOUT'));
  assert.equal(JSON.stringify(logs).includes('private timeout'), false);
});
