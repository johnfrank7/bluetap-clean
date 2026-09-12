const test = require('node:test');
const assert = require('node:assert/strict');
const { createRegistrationSessionService, setTrustedFaceVerification } = require('../registrationSession');

const personal = { role: 'requester', firstName: 'Test', lastName: 'Person', phone: '+639123456789', barangay: 'Awihao', address: 'Test Street', installationId: '123e4567-e89b-42d3-a456-426614174000' };
function fixture() {
  let time = 1800000000000;
  const records = new Map();
  const snapshot = (key) => ({ exists: records.has(key), data: () => records.get(key) });
  const ref = (collection, id) => ({ key: `${collection}/${id}`, get: async () => snapshot(`${collection}/${id}`), set: async (data) => records.set(`${collection}/${id}`, data) });
  const db = {
    collection: (name) => ({ doc: (id) => ref(name, id) }),
    runTransaction: async (callback) => {
      const writes = [];
      const result = await callback({
        get: async (item) => snapshot(item.key),
        set: (item, data) => writes.push([item.key, data]),
        update: (item, data) => writes.push([item.key, { ...records.get(item.key), ...data }]),
      });
      writes.forEach(([key, data]) => records.set(key, data));
      return result;
    },
  };
  return { db, records, service: createRegistrationSessionService({ db, hashSecret: 'session-secret', deviceHashSecret: 'device-secret', ipHashSecret: 'ip-secret', now: () => time }), advance: (ms) => { time += ms; }, now: () => time };
}

test('registration session uses a random opaque id and starts unverified', async () => {
  const f = fixture();
  const first = await f.service.create({ ...personal, faceVerification: { status: 'verified' } }, 'ip');
  const second = await f.service.create(personal, 'ip');
  assert.match(first.registrationSessionId, /^[0-9a-f-]{36}$/);
  assert.notEqual(first.registrationSessionId, second.registrationSessionId);
  const data = f.records.get('registrationSessions/' + first.registrationSessionId);
  assert.equal(data.faceVerification.status, 'unverified');
  assert.deepEqual(data.securityPolicySnapshot, { faceVerificationRequired: true, emailOtpRequired: true, maxAccountsPerDevice: 3, maxAccountsPerIp: 3, policyVersion: 1 });
  assert.equal(JSON.stringify(data).includes(personal.installationId), false);
  assert.equal(data.termsAcceptance, null);
  assert.equal(JSON.stringify(data).includes('Test Street'), false);
});

test('public start cannot bypass verification', async () => {
  const f = fixture();
  const { registrationSessionId } = await f.service.create(personal, 'ip');
  await assert.rejects(f.service.start(registrationSessionId), (error) => error.reason === 'face-reference-required');
  assert.equal((await f.service.status(registrationSessionId)).faceVerification.status, 'unverified');
  await assert.rejects(f.service.acceptTerms(registrationSessionId), (error) => error.reason === 'face-verification-required');

  const provider = await f.service.create(personal, 'second-ip');
  await assert.rejects(f.service.acceptTerms(provider.registrationSessionId), (error) => error.reason === 'face-verification-required');
  await setTrustedFaceVerification(f.db, provider.registrationSessionId, { livenessPassed: true, duplicateCheck: 'clear', verificationReference: 'provider-reference' }, f.now);
  assert.equal((await f.service.status(provider.registrationSessionId)).faceVerification.status, 'verified');
  assert.equal((await f.service.acceptTerms(provider.registrationSessionId)).accepted, true);
});

test('duplicate flag requires review and expired sessions fail closed', async () => {
  const flagged = fixture();
  const first = await flagged.service.create(personal, 'ip');
  await setTrustedFaceVerification(flagged.db, first.registrationSessionId, { livenessPassed: true, duplicateCheck: 'flagged' }, flagged.now);
  assert.equal((await flagged.service.status(first.registrationSessionId)).faceVerification.status, 'review_required');
  await assert.rejects(flagged.service.acceptTerms(first.registrationSessionId), (error) => error.reason === 'face-verification-required');
  const expired = fixture();
  const second = await expired.service.create(personal, 'ip');
  expired.advance(60 * 60 * 1000);
  await assert.rejects(expired.service.status(second.registrationSessionId), (error) => error.reason === 'registration-session-expired');
});

test('new sessions snapshot admin policy and face-disabled sessions skip face securely', async () => {
  const f = fixture();
  f.records.set('systemConfig/registrationSecurity', { faceVerificationEnabled: false, emailOtpEnabled: true, maxAccountsPerDevice: 5, maxAccountsPerIp: 4, version: 7 });
  const result = await f.service.create(personal, 'ip');
  const session = f.records.get('registrationSessions/' + result.registrationSessionId);
  assert.deepEqual(session.securityPolicySnapshot, { faceVerificationRequired: false, emailOtpRequired: true, maxAccountsPerDevice: 5, maxAccountsPerIp: 4, policyVersion: 7 });
  assert.equal(session.faceVerification.status, 'not_required');
  assert.equal((await f.service.acceptTerms(result.registrationSessionId)).accepted, true);
  await assert.rejects(setTrustedFaceVerification(f.db, result.registrationSessionId, { livenessPassed: true, duplicateCheck: 'clear' }, f.now), (error) => error.reason === 'face-verification-not-required');
});
