const test = require('node:test');
const assert = require('node:assert/strict');
const { createFaceVerificationHandler } = require('../faceVerification');
const id = '12345678-1234-4123-8123-123456789abc';
const image = 'data:image/jpeg;base64,/9j/2Q==';
function fixture(result = { verified: true, distance: 0.2, threshold: 0.4, model: 'SFace', detector_backend: 'YuNet', identity: 'private' }) {
  let data = { expiresAt: new Date(Date.now() + 60000), faceVerification: { status: 'unverified' } };
  const calls = [];
  const ref = { get: async () => ({ exists: !!data, data: () => data }) };
  const db = { collection: () => ({ doc: () => ref }), runTransaction: async (fn) => fn({ get: ref.get, update: (_, value) => { data = { ...data, ...value }; } }) };
  const handler = createFaceVerificationHandler({ getAdmin: () => ({ db }), env: { DEEPFACE_API_URL: 'https://face.test', DEEPFACE_API_KEY: 'server-secret' }, timestamp: () => 'server-timestamp', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (result instanceof Error) throw result;
    if (result.httpStatus) return { ok: false, status: result.httpStatus };
    if (result.notReady) return { ok: true, status: 200, json: async () => ({ ready: false }) };
    return { ok: true, status: 200, json: async () => url.endsWith('/ready') ? { status: 'ready', modelLoaded: true } : result };
  } });
  async function run(body = {}) {
    const res = { setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { registrationSessionId: id, referenceImage: image, probeImage: image, ...body } }, res);
    return res;
  }
  return { run, calls, data: () => data, set: (value) => { data = value; } };
}
test('only trusted boolean result verifies; forwards only multipart images and keeps metadata', async () => {
  const f = fixture();
  const res = await f.run({ faceVerification: { status: 'failed' }, extra: 'private-profile' });
  assert.equal(res.statusCode, 200);
  assert.equal(f.data().faceVerification.status, 'verified');
  assert.equal(f.data().faceVerification.verifiedAt, 'server-timestamp');
  assert.equal(f.data().faceVerification.livenessPassed, null);
  assert.equal(f.data().faceVerification.duplicateCheck, 'unknown');
  assert.equal(f.calls[1].options.headers.Authorization, 'Bearer server-secret');
  assert.deepEqual([...f.calls[1].options.body.keys()], ['image1', 'image2']);
  assert.equal(JSON.stringify(f.data()).includes('base64'), false);
  assert.equal(JSON.stringify(res.body).includes('private'), false);
});
test('cold starts, auth failures, invalid faces, timeouts and upstream errors are safe', async () => {
  for (const [result, expected] of [
    [{ notReady: true }, 503], [{ httpStatus: 503 }, 503],
    [{ httpStatus: 401 }, 502], [{ httpStatus: 403 }, 502],
    [{ httpStatus: 422 }, 400], [{ httpStatus: 502 }, 502],
    [Object.assign(new Error('timeout'), { name: 'AbortError' }), 504],
  ]) {
    const f = fixture(result);
    assert.equal((await f.run()).statusCode, expected);
    assert.equal(f.data().faceVerification.status, 'unverified');
  }
});
test('false, malformed, and network responses never verify', async () => {
  for (const result of [{ verified: false }, { verified: 'true' }, new Error('sensitive upstream error')]) {
    const f = fixture(result);
    const res = await f.run({ faceVerification: { status: 'verified' } });
    assert.notEqual(f.data().faceVerification.status, 'verified');
    assert.equal(JSON.stringify(res.body).includes('sensitive'), false);
    if (result.verified === false) assert.equal(f.data().faceVerification.status, 'failed');
    else assert.equal(res.statusCode, 502);
  }
});
test('invalid, expired, completed sessions and missing/invalid images fail before upstream', async () => {
  for (const body of [{ registrationSessionId: 'bad' }, { referenceImage: null }, { probeImage: 'data:image/png;base64,YQ==' }, { probeImage: 'x'.repeat(1400001) }]) {
    const f = fixture();
    assert.ok((await f.run(body)).statusCode >= 400);
    assert.equal(f.calls.length, 0);
  }
  for (const value of [null, { expiresAt: new Date(0) }, { completed: true, expiresAt: new Date(Date.now() + 60000) }]) {
    const f = fixture(); f.set(value);
    assert.equal((await f.run()).statusCode, 400);
    assert.equal(f.calls.length, 0);
  }
});
