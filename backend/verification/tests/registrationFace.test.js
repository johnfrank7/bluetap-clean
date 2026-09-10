const test = require('node:test');
const assert = require('node:assert/strict');
const { createRegistrationFaceService } = require('../registrationFace');
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
      '/enroll-face': { enrolled: true, duplicateDetected: false, reviewRequired: false },
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
test('web capture uses trusted pair verification and enrollment without the native detector', async () => {
  const f = fixture({ productionDetector: true });
  await f.begin();
  const result = await f.webComplete({ faceVerification: { status: 'verified', livenessPassed: true } });
  assert.equal(result.faceVerification.status, 'verified');
  assert.equal(result.faceVerification.duplicateCheck, 'clear');
  assert.deepEqual(f.calls.map((call) => call.path), ['/ready', '/verify-face', '/check-duplicate', '/enroll-face']);
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
test('trusted challenge, pair binding, clear search, then enrollment verify the session', async () => {
  const f = fixture(); await f.begin(); await f.evaluate();
  const result = await f.complete({ subject_id: 'attacker', faceVerification: { status: 'verified' } });
  assert.equal(result.faceVerification.status, 'verified');
  assert.deepEqual(f.calls.map((c) => c.path), ['/ready', '/verify-face', '/check-duplicate', '/enroll-face']);
  assert.equal(f.calls[3].form.get('subject_id'), id);
  assert.deepEqual([...f.calls[3].form.keys()], ['subject_id', 'image']);
  assert.equal(f.data().faceVerification.verificationReference, id);
  assert.equal(f.data().faceVerification.verifiedAt, 'server-timestamp');
  assert.equal(f.data().faceChallenge.state, 'used');
  assert.equal(JSON.stringify([...f.records]).includes('base64'), false);
  assert.equal(JSON.stringify(result).includes(id), false);
  await assert.rejects(f.complete());
});
test('duplicate search and enrollment-time duplicate both require review', async () => {
  for (const options of [
    { '/check-duplicate': { duplicateDetected: true, reviewRequired: true, distance: 0.1, threshold: 0.637, subject_id: 'private' } },
    { '/enroll-face': { enrolled: false, duplicateDetected: true, reviewRequired: true, distance: 0.1, threshold: 0.637 } },
  ]) {
    const f = fixture(options); await f.begin(); await f.evaluate();
    const result = await f.complete();
    assert.equal(result.faceVerification.status, 'review_required');
    assert.equal(JSON.stringify(result).includes('private'), false);
    if (options['/check-duplicate']) assert.equal(f.calls.length, 3);
  }
});
test('outage/malformed responses fail closed; uncertain enrollment cannot retry silently', async () => {
  for (const options of [{ '/ready': { ready: false } }, { '/check-duplicate': {} }, { '/enroll-face': new Error('timeout') }]) {
    const f = fixture(options); await f.begin(); await f.evaluate();
    await assert.rejects(f.complete());
    assert.equal(f.data().faceVerification.status, 'unverified');
    if (options['/enroll-face']) { f.advance(15000); await assert.rejects(f.begin(), (e) => e.reason === 'face-review-required'); }
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
