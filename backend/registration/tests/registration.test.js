const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { createRegistrationService } = require('../registration');

const form = { firstName: 'Test', lastName: 'Person', phone: '+639123456789',
  barangay: 'Awihao', address: 'Test Street', username: 'Test_User',
  role: 'requester', password: 'test-password-only' };
const finalFaceImage = 'data:image/jpeg;base64,/9j/2Q==';
function fixture() {
  let time = 1800000000000;
  const records = new Map();
  const users = new Map();
  const sent = [];
  const sessionId = '123e4567-e89b-42d3-a456-426614174000';
  let failEmail = false;
  let failProfile = false;
  let failEnrollment = false;
  let creates = 0;
  let queue = Promise.resolve();
  const snapshot = (key) => ({ exists: records.has(key), data: () => records.get(key) });
  const db = {
    collection: (collection) => ({ doc: (id) => ({ key: collection + '/' + id, get: async () => snapshot(collection + '/' + id) }) }),
    runTransaction: (callback) => {
      const task = queue.then(async () => {
        const writes = [];
        const result = await callback({
          get: async (ref) => snapshot(ref.key),
          set: (ref, data, options) => {
            if (failProfile && ref.key.startsWith('users/')) throw new Error('Profile write unavailable');
            writes.push([ref.key, options?.merge ? { ...records.get(ref.key), ...data } : data]);
          },
          update: (ref, data) => writes.push([ref.key, { ...records.get(ref.key), ...data }]),
          delete: (ref) => writes.push([ref.key, undefined]),
        });
        for (const [key, data] of writes) data === undefined ? records.delete(key) : records.set(key, data);
        return result;
      });
      queue = task.catch(() => {});
      return task;
    },
  };
  const auth = {
    getUserByEmail: async (email) => {
      const user = [...users.values()].find((u) => u.email === email);
      if (!user) throw Object.assign(new Error('Not found'), { code: 'auth/user-not-found' });
      return { ...user };
    },
    createUser: async (data) => {
      creates++;
      const user = { ...data, uid: 'new-user' };
      users.set(user.uid, user);
      return user;
    },
    deleteUser: async (uid) => users.delete(uid),
    updateUser: async (uid, data) => users.set(uid, { ...users.get(uid), ...data }),
    createCustomToken: async (uid) => 'test-custom-token-for-' + uid,
  };
  const renderCalls = [];
  const service = createRegistrationService({ auth, db, hashSecret: 'test-signing-key', now: () => time,
    render: async (path, body) => {
      renderCalls.push({ path, body });
      if (path === '/ready') return { status: 'ready', modelLoaded: true };
      if (path === '/enroll-face') return failEnrollment
        ? { enrolled: false, duplicateDetected: false, reviewRequired: false }
        : { enrolled: true, duplicateDetected: false, reviewRequired: false };
      throw new Error('Unexpected Render path');
    },
    sendEmailOtp: async (message) => { if (failEmail) throw new Error('Test provider outage'); sent.push(message); },
  });
  const setSessionProfile = (profile = form, options = {}) => {
    const personalInfoDigest = createHmac('sha256', 'test-signing-key').update(JSON.stringify([profile.role, profile.firstName, profile.lastName, profile.phone, profile.barangay, profile.address])).digest('hex');
    records.set('registrationSessions/' + sessionId, {
      role: profile.role, personalInfoCompleted: true, personalInfoDigest,
      faceVerification: options.faceStatus === 'temporary'
        ? { status: 'temporary', verifiedAt: null, duplicateCheck: 'unknown', verificationReference: null, livenessPassed: null, verificationMode: 'temporary', providerVerified: false }
        : { status: options.faceStatus || 'passed_pending_finalization', verifiedAt: new Date(time), duplicateCheck: options.duplicateCheck || 'clear', verificationReference: sessionId, captureHash: createHash('sha256').update(finalFaceImage).digest('hex'), livenessPassed: options.livenessPassed !== false, verificationMode: 'registration-capture', providerVerified: true },
      termsAcceptance: options.terms === false ? null : { accepted: true, acceptedAt: new Date(time), termsVersion: '1.0', privacyVersion: '1.0' },
      completed: false, expiresAt: new Date(time + 3600000),
    });
  };
  setSessionProfile();
  const registrationService = { ...service, request: (email, ip, username = form.username) => service.request(email, username, sessionId, ip),
    complete: (challenge, code, input) => service.complete(challenge, code, input, finalFaceImage) };
  return { service: registrationService, users, records, sent, get creates() { return creates; },
    sessionId, setSessionProfile, renderCalls, advance: (ms) => { time += ms; }, failEmail: () => { failEmail = true; }, failProfile: () => { failProfile = true; }, failEnrollment: () => { failEnrollment = true; }, restoreEnrollment: () => { failEnrollment = false; } };
}
const reason = (expected) => (error) => error.reason === expected;

test('requesting and abandoning OTP creates neither Auth user nor user profile', async () => {
  const f = fixture();
  await f.service.request('new@example.test', 'test-ip');
  assert.equal(f.users.size, 0);
  assert.equal(f.creates, 0);
  assert.equal([...f.records.keys()].some((key) => key.startsWith('users/')), false);
  assert.equal([...f.records.values()].some((data) => JSON.stringify(data).includes(form.password)), false);
});

test('provider failure and wrong OTP never create an account', async () => {
  const failed = fixture();
  failed.failEmail();
  await assert.rejects(failed.service.request('new@example.test', 'test-ip'));
  assert.equal(failed.creates, 0);
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  await assert.rejects(f.service.complete(result.challenge, '000000', form), reason('incorrect-code'));
  assert.equal(f.creates, 0);
});

test('correct OTP creates verified Auth account and server-owned profile exactly once', async () => {
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  const completed = await f.service.complete(result.challenge, f.sent[0].code, { ...form, uid: 'forged', email: 'forged@example.test', emailVerified: true, approvalStatus: 'approved' });
  assert.equal(f.creates, 1);
  assert.equal(f.users.get('new-user').email, 'new@example.test');
  assert.equal(f.users.get('new-user').emailVerified, true);
  const profile = f.records.get('users/new-user');
  assert.equal(profile.email, 'new@example.test');
  assert.equal(profile.registrationCompleted, true);
  assert.equal(profile.uid, 'new-user');
  assert.equal(profile.unique_id, 'REQ-000001');
  assert.equal(profile.faceVerification.status, 'verified');
  assert.equal(profile.faceVerification.verificationReference, 'new-user');
  assert.equal(profile.termsAcceptance.accepted, true);
  assert.equal(profile.termsAcceptance.termsVersion, '1.0');
  assert.equal(profile.username, 'Test_User');
  assert.equal(profile.usernameNormalized, 'test_user');
  assert.equal(profile.address, 'Test Street');
  assert.equal(f.records.get('usernames/test_user').uid, 'new-user');
  assert.equal(f.records.has('usernameReservations/test_user'), false);
  assert.deepEqual(f.renderCalls.map((call) => call.path), ['/ready', '/enroll-face']);
  assert.equal(profile.password, undefined);
  assert.equal(completed.verified, true);
  assert.match(completed.customToken, /^test-custom-token/);
  const replay = await f.service.complete(result.challenge, f.sent[0].code, form);
  assert.equal(replay.finalized, true);
  assert.equal(f.creates, 1);
});

test('distributor registration cannot set its own approval or face verification', async () => {
  const f = fixture();
  f.setSessionProfile({ ...form, role: 'distributor' });
  const result = await f.service.request('new@example.test', 'test-ip');
  await f.service.complete(result.challenge, f.sent[0].code, { ...form, role: 'distributor', approvalStatus: 'approved', faceVerification: { status: 'verified' } });
  const profile = f.records.get('users/new-user');
  assert.equal(profile.approvalStatus, 'pending');
  assert.equal(profile.faceVerification.status, 'verified');
  assert.notEqual(profile.faceVerification.verificationReference, 'forged');
  assert.equal(profile.unique_id, 'DIS-000001');
});

test('registration cannot request OTP without trusted face verification and terms', async () => {
  const face = fixture();
  face.setSessionProfile(form, { faceStatus: 'unverified', duplicateCheck: 'unknown', livenessPassed: false });
  await assert.rejects(face.service.request('new@example.test', 'test-ip'), reason('face-verification-required'));
  assert.equal(face.sent.length, 0);
  const review = fixture();
  review.setSessionProfile(form, { faceStatus: 'review_required', duplicateCheck: 'flagged' });
  await assert.rejects(review.service.request('new@example.test', 'test-ip'), reason('face-review-required'));
  const terms = fixture();
  terms.setSessionProfile(form, { terms: false });
  await assert.rejects(terms.service.request('new@example.test', 'test-ip'), reason('terms-required'));
});

test('temporary face placeholder cannot bypass verification', async () => {
  const f = fixture();
  f.setSessionProfile(form, { faceStatus: 'temporary' });
  await assert.rejects(f.service.request('new@example.test', 'test-ip'), reason('face-verification-required'));
});

test('pairwise-only verification cannot request OTP', async () => {
  const f = fixture();
  f.setSessionProfile(form, { duplicateCheck: 'unknown', livenessPassed: false });
  await assert.rejects(f.service.request('new@example.test', 'test-ip'), reason('face-verification-required'));
});

test('final enrollment binds the final uid without copying biometric fields', async () => {
  const f = fixture();
  const session = f.records.get('registrationSessions/' + f.sessionId);
  Object.assign(session.faceVerification, { verificationMode: 'registration-enrollment', verificationReference: f.sessionId, model: 'SFace', detectorBackend: 'yunet', rawImage: 'must-not-copy', embedding: [1, 2, 3] });
  const result = await f.service.request('new@example.test', 'test-ip');
  await f.service.complete(result.challenge, f.sent[0].code, form);
  const profile = f.records.get('users/new-user');
  assert.equal(profile.faceVerification.verificationReference, 'new-user');
  assert.equal(profile.faceVerification.livenessPassed, true);
  assert.equal(profile.faceVerification.duplicateCheck, 'clear');
  assert.equal(profile.faceVerification.model, 'SFace');
  assert.equal(profile.faceVerification.rawImage, undefined);
  assert.equal(profile.faceVerification.embedding, undefined);
  assert.equal(f.records.get('registrationSessions/' + f.sessionId).userUid, 'new-user');
  assert.equal(f.records.get('registrationSessions/' + f.sessionId).completed, true);
  assert.equal(f.renderCalls[1].body.get('uid'), 'new-user');
  assert.equal(f.renderCalls[1].body.get('registration_session_id'), f.sessionId);
});

test('tampered challenge and admin role cannot create an account', async () => {
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  await assert.rejects(f.service.complete(result.challenge + 'x', f.sent[0].code, form), reason('registration-expired'));
  await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, { ...form, role: 'admin' }), reason('invalid-registration'));
  assert.equal(f.creates, 0);
});

test('existing orphaned unverified signup is completed only after OTP without duplication', async () => {
  const f = fixture();
  f.users.set('old', { uid: 'old', email: 'old@example.test', emailVerified: false });
  const result = await f.service.request('old@example.test', 'test-ip');
  assert.equal(f.records.has('users/old'), false);
  await f.service.complete(result.challenge, f.sent[0].code, form);
  assert.equal(f.users.size, 1);
  assert.equal(f.creates, 0);
  assert.equal(f.users.get('old').emailVerified, true);
  assert.equal(f.records.get('users/old').role, 'requester');
});

test('existing unverified distributor keeps role and approval on recovery', async () => {
  const f = fixture();
  f.users.set('old', { uid: 'old', email: 'old@example.test', emailVerified: false });
  f.records.set('users/old', { role: 'distributor', approvalStatus: 'rejected', unique_id: 'DIS-000007' });
  const result = await f.service.request('old@example.test', 'test-ip');
  await f.service.complete(result.challenge, f.sent[0].code, form);
  assert.equal(f.records.get('users/old').role, 'distributor');
  assert.equal(f.records.get('users/old').approvalStatus, 'rejected');
  assert.equal(f.records.get('users/old').unique_id, 'DIS-000007');
});

test('verified accounts and admin profiles cannot be overwritten by registration', async () => {
  for (const admin of [true, false]) {
    const f = fixture();
    f.users.set('old', { uid: 'old', email: 'old@example.test', emailVerified: !admin });
    if (admin) f.records.set('users/old', { role: 'admin' });
    await assert.rejects(f.service.request(' OLD@example.test ', 'test-ip'), reason('account-exists'));
    assert.equal(f.sent.length, 0);
    assert.equal(f.creates, 0);
    assert.equal(f.users.get('old').password, undefined);
  }
});

test('profile write failure rolls back only the newly created Auth account', async () => {
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  f.failProfile();
  await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, form));
  assert.equal(f.users.size, 0);
  assert.equal(f.records.has('users/new-user'), false);
});

test('final face enrollment failure leaves the account and session explicitly pending', async () => {
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  f.failEnrollment();
  await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, form));
  const profile = f.records.get('users/new-user');
  const session = f.records.get('registrationSessions/' + f.sessionId);
  assert.equal(profile.registrationCompleted, false);
  assert.equal(profile.onboardingStatus, 'face_enrollment_pending');
  assert.equal(session.completed, false);
  assert.equal(session.faceEnrollmentPending, true);
  assert.equal(f.records.get('usernames/test_user').uid, 'new-user');
});

test('a pending face-enrollment finalization can safely retry without another account or username claim', async () => {
  const f = fixture();
  const first = await f.service.request('new@example.test', 'test-ip');
  f.failEnrollment();
  await assert.rejects(f.service.complete(first.challenge, f.sent[0].code, form));
  f.advance(60000);
  f.restoreEnrollment();
  const retry = await f.service.request('new@example.test', 'test-ip');
  const completed = await f.service.complete(retry.challenge, f.sent[1].code, form);
  assert.equal(f.creates, 1);
  assert.equal(f.records.get('usernames/test_user').uid, 'new-user');
  assert.equal(f.records.get('registrationSessions/' + f.sessionId).completed, true);
  assert.equal(completed.finalized, true);
});

test('expired registration challenge requires restarting and does not create an account', async () => {
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  f.advance(3600000);
  await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, form), reason('registration-expired'));
  assert.equal(f.creates, 0);
});

test('public request endpoint rate limits sends across different emails by IP', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) await f.service.request(`test${i}@example.test`, 'one-ip', `test_user_${i}`);
  await assert.rejects(f.service.request('another@example.test', 'one-ip', 'another_user'), reason('resend-limit-reached'));
  assert.equal(f.creates, 0);
});

test('usernames are normalized and reserved without permanent abandoned claims', async () => {
  const f = fixture();
  await f.service.request('first@example.test', 'first-ip', 'JohnBlueTap');
  await assert.rejects(f.service.request('second@example.test', 'second-ip', 'johnbluetap'), reason('username-taken'));
  assert.equal(f.records.has('usernames/johnbluetap'), false);
  f.advance(15 * 60 * 1000);
  await f.service.request('second@example.test', 'second-ip', 'JOHNBLUETAP');
  assert.equal(f.sent.length, 2);
});

test('account completed after requesting OTP cannot be overwritten', async () => {
  const f = fixture();
  const result = await f.service.request('old@example.test', 'test-ip');
  f.users.set('old', { uid: 'old', email: 'old@example.test', emailVerified: true });
  await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, form), reason('account-exists'));
  assert.equal(f.creates, 0);
  assert.equal(f.users.get('old').password, undefined);
});

test('email send limit returns remaining wait and permits requests after window ends', async () => {
  const f = fixture();
  for (let i = 0; i < 6; i++) {
    await f.service.request('new@example.test', 'test-ip');
    f.advance(60000);
  }
  await assert.rejects(f.service.request('new@example.test', 'test-ip'), (error) => {
    assert.equal(error.reason, 'resend-limit-reached');
    assert.equal(error.details.retryAfterSeconds, 3240);
    return true;
  });
  assert.equal(f.sent.length, 6);
  f.advance(3240000);
  f.setSessionProfile();
  await f.service.request('new@example.test', 'test-ip');
  assert.equal(f.sent.length, 7);
});
