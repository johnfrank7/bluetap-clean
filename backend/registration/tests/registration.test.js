const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { createRegistrationService } = require('../registration');
const { createRegistrationSessionService } = require('../registrationSession');

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
  let failDelete = false;
  let failEnrollment = false;
  const otpStages = [];
  let creates = 0;
  let queue = Promise.resolve();
  const snapshot = (key) => ({ exists: records.has(key), data: () => records.get(key) });
  const db = {
    collection: (collection) => ({
      doc: (id) => ({ key: collection + '/' + id, get: async () => snapshot(collection + '/' + id) }),
      where: (field, operator, value) => ({ limit: (count) => ({ get: async () => ({ docs: [...records.entries()]
        .filter(([key, data]) => key.startsWith(collection + '/') && operator === '==' && field.split('.').reduce((entry, part) => entry?.[part], data) === value)
        .slice(0, count).map(([key, data]) => ({ id: key.slice(collection.length + 1), data: () => data })) }) }) }),
    }),
    runTransaction: (callback) => {
      const task = queue.then(async () => {
        const writes = [];
        let writeStarted = false;
        const result = await callback({
          get: async (ref) => {
            if (writeStarted) throw new Error('Firestore transactions require all reads before all writes.');
            return snapshot(ref.key);
          },
          set: (ref, data, options) => {
            writeStarted = true;
            if (failProfile && ref.key.startsWith('users/')) throw new Error('Profile write unavailable');
            writes.push([ref.key, options?.merge ? { ...records.get(ref.key), ...data } : data]);
          },
          update: (ref, data) => {
            writeStarted = true;
            writes.push([ref.key, { ...records.get(ref.key), ...data }]);
          },
          delete: (ref) => {
            writeStarted = true;
            writes.push([ref.key, undefined]);
          },
        });
        for (const [key, data] of writes) data === undefined ? records.delete(key) : records.set(key, data);
        return result;
      });
      queue = task.catch(() => {});
      return task;
    },
  };
  const auth = {
    verifyIdToken: async () => ({ uid: 'new-user' }),
    getUser: async (uid) => {
      const user = users.get(uid);
      if (!user) throw Object.assign(new Error('Not found'), { code: 'auth/user-not-found' });
      return { ...user };
    },
    getUserByEmail: async (email) => {
      const user = [...users.values()].find((u) => u.email === email);
      if (!user) throw Object.assign(new Error('Not found'), { code: 'auth/user-not-found' });
      return { ...user };
    },
    createUser: async (data) => {
      if ([...users.values()].some((user) => user.email === data.email)) throw Object.assign(new Error('Email exists'), { code: 'auth/email-already-exists' });
      creates++;
      const user = { ...data, uid: 'new-user' };
      users.set(user.uid, user);
      return user;
    },
    deleteUser: async (uid) => { if (failDelete) throw new Error('Auth rollback unavailable'); users.delete(uid); },
    updateUser: async (uid, data) => users.set(uid, { ...users.get(uid), ...data }),
    createCustomToken: async (uid) => 'test-custom-token-for-' + uid,
  };
  const renderCalls = [];
  const service = createRegistrationService({ auth, db, hashSecret: 'test-signing-key', now: () => time, newUid: () => 'new-user',
    otpStage: (stage) => otpStages.push(stage),
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
    const personalInfoDigest = createHmac('sha256', 'test-signing-key').update(JSON.stringify([profile.role, profile.firstName, profile.lastName, profile.phone, profile.barangay, profile.address, ...(profile.role === 'distributor' ? [profile.requestedBranchId || 'branch-a'] : [])])).digest('hex');
    records.set('registrationSessions/' + sessionId, {
      role: profile.role, personalInfoCompleted: true, personalInfoDigest,
      ...(profile.role === 'distributor' ? { requestedBranchId: profile.requestedBranchId || 'branch-a', requestedBranchNameSnapshot: 'Branch A' } : {}),
      securityPolicySnapshot: { faceVerificationRequired: options.faceRequired !== false, emailOtpRequired: options.otpRequired !== false, maxAccountsPerDevice: 3, maxAccountsPerIp: 3, policyVersion: 1 },
      registrationLimitKeys: { deviceHash: 'device-hash', ipHash: 'ip-hash' },
      faceVerification: options.faceRequired === false && !options.faceStatus
        ? { required: false, status: 'not_required', verifiedAt: null, duplicateCheck: 'not_required', verificationReference: null, livenessPassed: null }
        : options.faceStatus === 'temporary'
          ? { status: 'temporary', verifiedAt: null, duplicateCheck: 'unknown', verificationReference: null, livenessPassed: null, verificationMode: 'temporary', providerVerified: false }
          : { status: options.faceStatus || 'passed_pending_finalization', verifiedAt: new Date(time), duplicateCheck: options.duplicateCheck || 'clear', verificationReference: sessionId, captureHash: createHash('sha256').update(finalFaceImage).digest('hex'), livenessPassed: options.livenessPassed !== false, verificationMode: 'registration-capture', providerVerified: true },
      termsAcceptance: options.terms === false ? null : { accepted: true, acceptedAt: new Date(time), termsVersion: '1.0', privacyVersion: '1.0' },
      completed: false, expiresAt: new Date(time + 3600000),
    });
  };
  setSessionProfile();
  const registrationService = { ...service, request: (email, ip, username = form.username, id = sessionId) => service.request(email, username, id, ip),
    complete: (challenge, code, input, image = finalFaceImage) => service.complete(challenge, code, input, image),
    completeWithoutOtp: (challenge, input, image = finalFaceImage) => service.completeWithoutOtp(challenge, input, image) };
  return { service: registrationService, db, auth, users, records, sent, get creates() { return creates; }, get time() { return time; },
    sessionId, setSessionProfile, addSession: (id, { sameDevice = false } = {}) => {
      const original = records.get('registrationSessions/' + sessionId);
      records.set('registrationSessions/' + id, { ...original,
        registrationLimitKeys: { ...original.registrationLimitKeys, deviceHash: sameDevice ? original.registrationLimitKeys.deviceHash : 'another-device-hash' } });
    },
    renderCalls, otpStages, advance: (ms) => { time += ms; }, failEmail: () => { failEmail = true; }, failProfile: () => { failProfile = true; }, restoreProfile: () => { failProfile = false; }, failDelete: () => { failDelete = true; }, failEnrollment: () => { failEnrollment = true; }, restoreEnrollment: () => { failEnrollment = false; } };
}
const reason = (expected) => (error) => error.reason === expected;

test('requesting and abandoning OTP creates neither Auth user nor user profile', async () => {
  const f = fixture();
  await f.service.request('new@example.test', 'test-ip');
  assert.equal(f.users.size, 0);
  assert.equal(f.creates, 0);
  assert.equal([...f.records.keys()].some((key) => key.startsWith('users/')), false);
  assert.equal([...f.records.keys()].some((key) => key.startsWith('registrationLimits/')), false);
  assert.equal([...f.records.values()].some((data) => JSON.stringify(data).includes(form.password)), false);
  assert.deepEqual(f.otpStages, ['OTP_REQUEST_STARTED', 'OTP_SESSION_VALIDATED', 'OTP_CREATED', 'EMAIL_SEND_STARTED', 'OTP_REQUEST_COMPLETED']);
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
  assert.equal([...f.records.keys()].some((key) => key.startsWith('registrationLimits/')), false);
});

test('changing the registration email invalidates the previous OTP while retaining send limits', async () => {
  const f = fixture();
  const first = await f.service.request('old@example.test', 'test-ip');
  const oldOtpId = [...f.records.entries()].find(([key, value]) =>
    key.startsWith('emailOtpVerifications/registration-') && value?.status === 'active'
  )?.[0];
  const before = { ...f.records.get(oldOtpId) };

  const second = await f.service.request('new@example.test', 'test-ip');
  const invalidated = f.records.get(oldOtpId);
  assert.equal(invalidated.status, 'invalidated');
  assert.equal(invalidated.otpHash, null);
  assert.equal(invalidated.sendCount, before.sendCount);
  assert.equal(invalidated.lastSentAt, before.lastSentAt);
  await assert.rejects(f.service.complete(first.challenge, f.sent[0].code, form), reason('no-active-code'));
  assert.equal(f.creates, 0);
  f.records.set(oldOtpId, { ...before, status: 'active' });
  await assert.rejects(f.service.complete(first.challenge, f.sent[0].code, form), reason('registration-session-invalid'));
  assert.equal(f.creates, 0);

  const completed = await f.service.complete(second.challenge, f.sent[1].code, form);
  assert.equal(completed.verified, true);
  assert.equal(f.users.get('new-user').email, 'new@example.test');
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
  assert.equal(f.records.get('registrationLimits/device_device-hash').finalizedCount, 1);
  assert.equal(f.records.get('registrationLimits/device_device-hash').reservedCount, 0);
  assert.deepEqual(f.renderCalls.map((call) => call.path), ['/ready', '/enroll-face']);
  assert.equal(profile.password, undefined);
  assert.equal(completed.verified, true);
  assert.match(completed.customToken, /^test-custom-token/);
  const replay = await f.service.complete(result.challenge, f.sent[0].code, form);
  assert.equal(replay.finalized, true);
  assert.equal(f.creates, 1);
});

test('distributor registration cannot set its own approval or branch and remains pending', async () => {
  const f = fixture();
  f.setSessionProfile({ ...form, role: 'distributor', requestedBranchId: 'branch-a' });
  const result = await f.service.request('new@example.test', 'test-ip');
  await f.service.complete(result.challenge, f.sent[0].code, { ...form, role: 'distributor', requestedBranchId: 'branch-a', branchId: 'forged', approvalStatus: 'approved', faceVerification: { status: 'verified' } });
  const profile = f.records.get('users/new-user');
  assert.equal(profile.distributorStatus, 'pending');
  assert.equal(profile.approvalStatus, 'pending');
  assert.equal(profile.requestedBranchId, 'branch-a');
  assert.equal(profile.branchId, null);
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

test('face-only policy sends no OTP and preserves unverified email state', async () => {
  const f = fixture();
  f.setSessionProfile(form, { otpRequired: false });
  const result = await f.service.request('new@example.test', 'test-ip');
  assert.equal(result.otpRequired, false);
  assert.equal(f.sent.length, 0);
  const completed = await f.service.completeWithoutOtp(result.challenge, form, finalFaceImage);
  assert.equal(completed.finalized, true);
  assert.equal(f.users.get('new-user').emailVerified, false);
  assert.equal(f.records.get('users/new-user').emailOtpVerification.status, 'not_required');
});

test('face-only signup cannot take over an existing unverified Auth identity', async () => {
  const f = fixture();
  f.setSessionProfile(form, { otpRequired: false });
  f.users.set('unrelated', { uid: 'unrelated', email: 'old@example.test', emailVerified: false });
  await assert.rejects(f.service.request('old@example.test', 'test-ip'), reason('account-exists'));
  assert.equal(f.users.get('unrelated').password, undefined);
});

test('OTP-only policy never calls face service and stores face as not required', async () => {
  const f = fixture();
  f.setSessionProfile(form, { faceRequired: false });
  const session = f.records.get('registrationSessions/' + f.sessionId);
  session.faceVerification = { required: false, status: 'not_required', duplicateCheck: 'not_required' };
  const result = await f.service.request('new@example.test', 'test-ip');
  await f.service.complete(result.challenge, f.sent[0].code, form);
  assert.equal(f.renderCalls.length, 0);
  assert.equal(f.records.get('users/new-user').faceVerification.status, 'not_required');
});

test('base registration succeeds when both optional verification methods are disabled', async () => {
  const f = fixture();
  f.setSessionProfile(form, { faceRequired: false, otpRequired: false });
  const session = f.records.get('registrationSessions/' + f.sessionId);
  session.faceVerification = { required: false, status: 'not_required', duplicateCheck: 'not_required' };
  const result = await f.service.request('new@example.test', 'test-ip');
  assert.equal(result.otpRequired, false);
  const completed = await f.service.completeWithoutOtp(result.challenge, form);
  assert.equal(completed.finalized, true);
  assert.equal(f.records.get('users/new-user').faceVerification.status, 'not_required');
  assert.equal(f.records.get('users/new-user').emailOtpVerification.status, 'not_required');
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
  assert.equal(profile.faceVerification.antiSpoofing, false);
});

test('SFace capture with livenessPassed: false finalizes successfully with antiSpoofing: false', async () => {
  const f = fixture();
  f.setSessionProfile(form, { livenessPassed: false });
  const session = f.records.get('registrationSessions/' + f.sessionId);
  Object.assign(session.faceVerification, { verificationMode: 'web-camera-capture', verificationReference: f.sessionId, model: 'SFace', detectorBackend: 'yunet', livenessPassed: false, antiSpoofing: false });
  const result = await f.service.request('new@example.test', 'test-ip');
  await f.service.complete(result.challenge, f.sent[0].code, form);
  const profile = f.records.get('users/new-user');
  assert.equal(profile.faceVerification.verificationReference, 'new-user');
  assert.equal(profile.faceVerification.livenessPassed, false);
  assert.equal(profile.faceVerification.antiSpoofing, false);
  assert.equal(profile.faceVerification.providerVerified, true);
  assert.equal(profile.faceVerification.duplicateCheck, 'clear');
  assert.equal(profile.faceVerification.status, 'verified');
  assert.equal(profile.onboardingStatus, 'complete');
  assert.equal(profile.registrationCompleted, true);
});

test('distributor registration finalizes successfully with livenessPassed: false', async () => {
  const f = fixture();
  const distForm = { ...form, role: 'distributor', requestedBranchId: 'branch-a' };
  f.setSessionProfile(distForm, { livenessPassed: false });
  const session = f.records.get('registrationSessions/' + f.sessionId);
  Object.assign(session.faceVerification, { verificationMode: 'web-camera-capture', verificationReference: f.sessionId, model: 'SFace', detectorBackend: 'yunet', livenessPassed: false, antiSpoofing: false });
  const result = await f.service.request('new-dist@example.test', 'test-ip');
  await f.service.complete(result.challenge, f.sent[0].code, distForm);
  const profile = f.records.get('users/new-user');
  assert.equal(profile.role, 'distributor');
  assert.equal(profile.faceVerification.verificationReference, 'new-user');
  assert.equal(profile.faceVerification.livenessPassed, false);
  assert.equal(profile.faceVerification.antiSpoofing, false);
  assert.equal(profile.faceVerification.status, 'verified');
});

test('tampered challenge and privileged roles cannot create an account', async () => {
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  await assert.rejects(f.service.complete(result.challenge + 'x', f.sent[0].code, form), reason('registration-expired'));
  await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, { ...form, role: 'admin' }), reason('invalid-registration'));
  await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, { ...form, role: 'manager' }), reason('invalid-registration'));
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
  assert.equal(f.records.get('registrationLimits/device_device-hash').finalizedCount, 0);
  assert.equal(f.records.get('registrationLimits/device_device-hash').reservedCount, 0);
});

test('an Auth-only partial finalization remains locked to its session and recovers after rollback failure', async () => {
  const f = fixture();
  const request = await f.service.request('new@example.test', 'test-ip');
  f.failProfile();
  f.failDelete();
  await assert.rejects(f.service.complete(request.challenge, f.sent[0].code, form));
  assert.equal(f.users.has('new-user'), true);
  assert.equal(f.records.has('users/new-user'), false);
  assert.equal(f.records.get('registrationSessions/' + f.sessionId).finalization.status, 'recovery_required');
  assert.equal(f.records.get('registrationSessions/' + f.sessionId).finalization.uid, 'new-user');
  f.restoreProfile();
  const recovered = await f.service.retryFinalization(request.challenge, form, finalFaceImage);
  assert.equal(recovered.finalized, true);
  assert.equal(f.records.get('users/new-user').registrationCompleted, true);
  assert.equal(f.records.get('counters/unique_ids').requester, 1);
});

test('a refreshed OTP signup can reclaim its verified Auth-only orphan after the old reservation expires', async () => {
  const f = fixture();
  const freshSession = '123e4567-e89b-42d3-b456-426614174000';
  f.addSession(freshSession);
  const original = await f.service.request('new@example.test', 'test-ip');
  f.failProfile();
  f.failDelete();
  await assert.rejects(f.service.complete(original.challenge, f.sent[0].code, form));
  f.restoreProfile();
  f.advance(15 * 60 * 1000);
  const available = await f.service.availability(form.username, 'new@example.test', freshSession);
  assert.equal(available.usernameAvailable, true);
  assert.equal(available.emailAvailable, true);
  const requested = await f.service.request('new@example.test', 'second-ip', form.username, freshSession);
  const completed = await f.service.complete(requested.challenge, f.sent[1].code, form);
  assert.equal(completed.finalized, true);
  assert.equal(f.users.size, 1);
  assert.equal(f.records.get('users/new-user').registrationCompleted, true);
  assert.equal(f.records.get('counters/unique_ids').requester, 1);
});

test('a refreshed Distributor signup recovers its incomplete profile without a second public UID or approval', async () => {
  const f = fixture();
  const distributor = { ...form, role: 'distributor', requestedBranchId: 'branch-a' };
  f.setSessionProfile(distributor);
  const freshSession = '123e4567-e89b-42d3-b456-426614174000';
  f.addSession(freshSession);
  const original = await f.service.request('driver@example.test', 'first-ip');
  f.failEnrollment();
  f.failDelete();
  await assert.rejects(f.service.complete(original.challenge, f.sent[0].code, distributor));
  const pending = f.records.get('users/new-user');
  assert.equal(pending.registrationCompleted, false);
  assert.equal(pending.publicUid, 'Dis001');
  f.restoreEnrollment();
  f.advance(15 * 60 * 1000);
  const available = await f.service.availability(distributor.username, 'driver@example.test', freshSession);
  assert.equal(available.emailAvailable, true);
  const requested = await f.service.request('driver@example.test', 'second-ip', distributor.username, freshSession);
  const result = await f.service.complete(requested.challenge, f.sent[1].code, distributor);
  assert.equal(result.finalized, true);
  const profile = f.records.get('users/new-user');
  assert.equal(profile.registrationCompleted, true);
  assert.equal(profile.publicUid, 'Dis001');
  assert.equal(profile.distributorStatus, 'pending');
  assert.equal(profile.approvalStatus, 'pending');
  assert.equal(f.records.get('counters/unique_ids').distributor, 1);
  assert.equal([...f.records.entries()].filter(([key]) => key.startsWith('users/')).length, 1);
});

test('face-only policy recovers its own Auth-only partial account without claiming another identity', async () => {
  const f = fixture();
  f.setSessionProfile(form, { otpRequired: false });
  const request = await f.service.request('new@example.test', 'test-ip');
  f.failProfile();
  f.failDelete();
  await assert.rejects(f.service.completeWithoutOtp(request.challenge, form, finalFaceImage));
  assert.equal(f.records.get('registrationSessions/' + f.sessionId).finalization.uid, 'new-user');
  f.restoreProfile();
  const recovered = await f.service.retryFinalization(request.challenge, form, finalFaceImage);
  assert.equal(recovered.finalized, true);
  assert.equal(f.records.get('users/new-user').emailVerified, false);
});

test('a refreshed face-only signup reclaims its own orphan only after the original Auth password is verified', async (t) => {
  const f = fixture();
  f.setSessionProfile(form, { otpRequired: false });
  const freshSession = '123e4567-e89b-42d3-b456-426614174000';
  f.addSession(freshSession);
  const original = await f.service.request('new@example.test', 'test-ip');
  f.failProfile();
  f.failDelete();
  await assert.rejects(f.service.completeWithoutOtp(original.challenge, form, finalFaceImage));
  f.restoreProfile();
  f.advance(15 * 60 * 1000);
  const requested = await f.service.request('new@example.test', 'second-ip', form.username, freshSession);
  let passwordCorrect = false;
  t.mock.method(global, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    passwordCorrect = body.password === form.password;
    return { ok: passwordCorrect, json: async () => passwordCorrect ? { localId: 'new-user', idToken: 'verified-test-token' } : { error: { message: 'INVALID_PASSWORD' } } };
  });
  await assert.rejects(f.service.completeWithoutOtp(requested.challenge, { ...form, password: 'wrong-password' }, finalFaceImage), reason('registration-recovery-unavailable'));
  assert.equal(passwordCorrect, false);
  assert.equal(f.records.has('users/new-user'), false);
  const recovered = await f.service.completeWithoutOtp(requested.challenge, form, finalFaceImage);
  assert.equal(passwordCorrect, true);
  assert.equal(recovered.finalized, true);
  assert.equal(f.records.get('users/new-user').registrationCompleted, true);
});

test('final face enrollment failure leaves no Auth account or operational profile', async () => {
  const f = fixture();
  const result = await f.service.request('new@example.test', 'test-ip');
  f.failEnrollment();
  await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, form));
  const session = f.records.get('registrationSessions/' + f.sessionId);
  assert.equal(f.users.size, 0);
  assert.equal(f.records.has('users/new-user'), false);
  assert.equal(session.completed, false);
  assert.equal(session.userUid, null);
  assert.equal(f.records.get('registrationLimits/device_device-hash').finalizedCount, 0);
  assert.equal(f.records.get('registrationLimits/device_device-hash').reservedCount, 0);
  assert.equal(f.records.has('usernames/test_user'), false);
});

test('a failed face finalization retry recreates one account and reuses its reserved public UID', async () => {
  const f = fixture();
  const first = await f.service.request('new@example.test', 'test-ip');
  f.failEnrollment();
  await assert.rejects(f.service.complete(first.challenge, f.sent[0].code, form));
  f.restoreEnrollment();
  const completed = await f.service.retryFinalization(first.challenge, form, finalFaceImage);
  assert.equal(f.creates, 2);
  assert.equal(f.users.size, 1);
  assert.equal(f.sent.length, 1);
  assert.equal(f.records.get('usernames/test_user').uid, 'new-user');
  assert.equal(f.records.get('users/new-user').publicUid, 'Req001');
  assert.equal(f.records.get('registrationSessions/' + f.sessionId).completed, true);
  assert.equal(completed.finalized, true);
});

test('a pending finalization can reserve and finalize a replacement username', async () => {
  const f = fixture();
  const first = await f.service.request('new@example.test', 'test-ip');
  f.failEnrollment();
  await assert.rejects(f.service.complete(first.challenge, f.sent[0].code, form));
  f.restoreEnrollment();
  f.advance(60 * 1000);
  const retry = await f.service.request('new@example.test', 'test-ip', 'Replacement_Name');
  const completed = await f.service.complete(retry.challenge, f.sent[1].code, { ...form, username: 'Replacement_Name' });
  assert.equal(completed.finalized, true);
  assert.equal(f.records.has('usernames/test_user'), false);
  assert.equal(f.records.get('usernames/replacement_name').uid, 'new-user');
});

test('a finalization username race preserves the existing owner and creates no replacement claim', async () => {
  const f = fixture();
  const first = await f.service.request('new@example.test', 'test-ip');
  f.records.set('usernames/test_user', { uid: 'other-user', createdAt: new Date() });
  await assert.rejects(f.service.complete(first.challenge, f.sent[0].code, form), reason('username-taken'));
  assert.equal(f.records.get('usernames/test_user').uid, 'other-user');
  assert.equal(f.records.has('users/new-user'), false);
  assert.equal(f.users.has('new-user'), false);
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
  const secondSession = '123e4567-e89b-42d3-b456-426614174000';
  f.addSession(secondSession);
  await assert.rejects(f.service.request('second@example.test', 'second-ip', 'johnbluetap', secondSession), reason('username-taken'));
  assert.equal(f.records.has('usernames/johnbluetap'), false);
  f.advance(15 * 60 * 1000);
  await f.service.request('second@example.test', 'second-ip', 'JOHNBLUETAP', secondSession);
  assert.equal(f.sent.length, 2);
});

test('availability treats a session own temporary username and email as reusable', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.availability(' TEST_USER ', ' NEW@example.test ', f.sessionId),
    { usernameAvailable: true, emailAvailable: true, normalizedUsername: 'test_user', finalizationPending: false });
  await f.service.request('new@example.test', 'test-ip');
  assert.deepEqual(await f.service.availability('test_user', 'new@example.test', f.sessionId),
    { usernameAvailable: true, emailAvailable: true, normalizedUsername: 'test_user', finalizationPending: false });
  const other = '123e4567-e89b-42d3-b456-426614174000';
  f.addSession(other);
  const blocked = await f.service.availability('TEST_USER', 'NEW@example.test', other);
  assert.equal(blocked.usernameAvailable, false);
  assert.equal(blocked.emailAvailable, false);
  f.advance(15 * 60 * 1000);
  const expired = await f.service.availability('TEST_USER', 'NEW@example.test', other);
  assert.equal(expired.usernameAvailable, true);
  assert.equal(expired.emailAvailable, true);
});

test('a refreshed matching installation supersedes its own unverified draft without an active-claim leak', async () => {
  const f = fixture();
  const freshSession = '123e4567-e89b-42d3-b456-426614174000';
  f.addSession(freshSession, { sameDevice: true });
  const original = await f.service.request('new@example.test', 'first-ip');
  const available = await f.service.availability(form.username, 'new@example.test', freshSession);
  assert.equal(available.usernameAvailable, true);
  assert.equal(available.emailAvailable, true);
  f.advance(60000); // Keep the per-email resend cooldown authoritative.
  const refreshed = await f.service.request('new@example.test', 'second-ip', form.username, freshSession);
  assert.equal(f.records.get('registrationSessions/' + f.sessionId).supersededBy, freshSession);
  assert.equal(f.records.get('usernameReservations/test_user').registrationSessionId, freshSession);
  assert.equal(f.records.has('usernames/test_user'), false);
  await assert.rejects(f.service.complete(original.challenge, f.sent[0].code, form));
  assert.equal(f.users.size, 0);
  const completed = await f.service.complete(refreshed.challenge, f.sent[1].code, form);
  assert.equal(completed.finalized, true);
  assert.equal(f.users.size, 1);
});

test('matching email and device do not supersede a different personal identity', async () => {
  const f = fixture();
  const other = '123e4567-e89b-42d3-b456-426614174000';
  f.addSession(other, { sameDevice: true });
  const draft = f.records.get('registrationSessions/' + other);
  f.records.set('registrationSessions/' + other, { ...draft, personalInfoDigest: 'different-person' });
  await f.service.request('new@example.test', 'first-ip');
  const available = await f.service.availability(form.username, 'new@example.test', other);
  assert.equal(available.usernameAvailable, false);
  assert.equal(available.emailAvailable, false);
  await assert.rejects(f.service.request('new@example.test', 'second-ip', form.username, other), reason('username-taken'));
});

test('completed username and primary recovery email remain unavailable', async () => {
  const f = fixture();
  const other = '123e4567-e89b-42d3-b456-426614174000';
  f.addSession(other);
  const requested = await f.service.request('new@example.test', 'test-ip');
  await f.service.complete(requested.challenge, f.sent[0].code, form);
  const unavailable = await f.service.availability('Test_User', 'NEW@example.test', other);
  assert.equal(unavailable.usernameAvailable, false);
  assert.equal(unavailable.emailAvailable, false);
});

test('cancelled provisional signup releases only its own reservations and invalidates OTP', async () => {
  const f = fixture();
  const other = '123e4567-e89b-42d3-b456-426614174000';
  f.addSession(other);
  await f.service.request('new@example.test', 'test-ip');
  const username = f.records.get('usernameReservations/test_user');
  const emailRef = [...f.records.keys()].find((key) => key.startsWith('registrationEmailReservations/'));
  const otpRef = [...f.records.keys()].find((key) => /^emailOtpVerifications\/registration-[a-f0-9]{64}$/.test(key));
  const sessionService = createRegistrationSessionService({ db: f.db, hashSecret: 'test-signing-key', now: () => f.time });
  await sessionService.cancel(f.sessionId);
  assert.equal(f.records.has('usernameReservations/test_user'), false);
  assert.equal(f.records.has(emailRef), false);
  assert.equal(f.records.get(otpRef).status, 'invalidated');
  assert.equal(f.records.has('usernames/test_user'), false);
  f.advance(60000); // The OTP resend cooldown remains intact after cancellation.
  await f.service.request('new@example.test', 'test-ip-2', 'Test_User', other);
  assert.notEqual(username.registrationSessionId, f.records.get('usernameReservations/test_user').registrationSessionId);
});

test('an expired session cannot cancel another session newer reservation or OTP', async () => {
  const f = fixture();
  const other = '123e4567-e89b-42d3-b456-426614174000';
  f.addSession(other);
  await f.service.request('new@example.test', 'first-ip');
  f.advance(15 * 60 * 1000);
  await f.service.request('new@example.test', 'second-ip', form.username, other);
  const sessionService = createRegistrationSessionService({ db: f.db, hashSecret: 'test-signing-key', now: () => f.time });
  await sessionService.cancel(f.sessionId);
  assert.equal(f.records.get('usernameReservations/test_user').registrationSessionId, other);
  const emailReservation = [...f.records.values()].find((value) => value?.registrationSessionId === other && value?.ownerHash === undefined && value?.expiresAt);
  assert.ok(emailReservation);
  const otp = [...f.records.entries()].find(([key]) => /^emailOtpVerifications\/registration-[a-f0-9]{64}$/.test(key))?.[1];
  assert.equal(otp.status, 'active');
});

test('a stale finalization lease with no Auth or profile can be cancelled safely', async () => {
  const f = fixture();
  await f.service.request('new@example.test', 'test-ip');
  const ref = 'registrationSessions/' + f.sessionId;
  f.records.set(ref, { ...f.records.get(ref), finalization: { status: 'processing', uid: 'never-created', owner: 'stale-owner', leaseUntil: new Date(f.time - 1) } });
  const sessionService = createRegistrationSessionService({ db: f.db, auth: f.auth, hashSecret: 'test-signing-key', now: () => f.time });
  await sessionService.cancel(f.sessionId);
  assert.equal(f.records.has('usernameReservations/test_user'), false);
  assert.equal(f.records.get(ref).cancelled, true);
});

test('concurrent sessions cannot reserve the same username or email', async () => {
  const first = fixture();
  const other = '123e4567-e89b-42d3-b456-426614174000';
  first.addSession(other);
  const usernames = await Promise.allSettled([
    first.service.request('one@example.test', 'ip-one', 'Shared_Name', first.sessionId),
    first.service.request('two@example.test', 'ip-two', 'shared_name', other),
  ]);
  assert.deepEqual(usernames.map((item) => item.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(usernames.find((item) => item.status === 'rejected').reason.reason, 'username-taken');
  assert.equal(first.records.has('usernames/shared_name'), false);

  const second = fixture();
  second.addSession(other);
  const emails = await Promise.allSettled([
    second.service.request('same@example.test', 'ip-one', 'First_Name', second.sessionId),
    second.service.request('SAME@example.test', 'ip-two', 'Second_Name', other),
  ]);
  assert.deepEqual(emails.map((item) => item.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(emails.find((item) => item.status === 'rejected').reason.reason, 'email-in-use');
  assert.equal(second.sent.length, 1);
});

test('duplicate Distributor confirmation or lost success response returns the same account and public UID', async () => {
  const f = fixture();
  const distributor = { ...form, role: 'distributor', requestedBranchId: 'branch-a' };
  f.setSessionProfile(distributor);
  const request = await f.service.request('driver@example.test', 'test-ip');
  const attempts = await Promise.allSettled([
    f.service.complete(request.challenge, f.sent[0].code, distributor),
    f.service.complete(request.challenge, f.sent[0].code, distributor),
  ]);
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(attempts.find((item) => item.status === 'rejected').reason.reason, 'registration-finalization-pending');
  const recovered = await f.service.complete(request.challenge, f.sent[0].code, distributor);
  assert.equal(recovered.finalized, true);
  assert.equal(f.records.get('counters/unique_ids').distributor, 1);
  assert.equal([...f.records.entries()].filter(([key, data]) => key.startsWith('users/') && data?.role === 'distributor').length, 1);
  assert.equal(f.records.get('users/new-user').publicUid, 'Dis001');
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

test('policy matrix: combination 1 (Face ON + OTP ON) for Distributor requires both verifications', async () => {
  const f = fixture();
  const distributor = { ...form, role: 'distributor', requestedBranchId: 'branch-a' };
  f.setSessionProfile(distributor, { faceRequired: true, otpRequired: true });
  const result = await f.service.request('dist1@example.test', 'test-ip');
  assert.equal(result.otpRequired, true);
  assert.equal(f.sent.length, 1);
  const completed = await f.service.complete(result.challenge, f.sent[0].code, distributor);
  assert.equal(completed.finalized, true);
  assert.equal(completed.role, 'distributor');
  assert.deepEqual(f.renderCalls.map((c) => c.path), ['/ready', '/enroll-face']);
  const profile = f.records.get('users/new-user');
  assert.equal(profile.role, 'distributor');
  assert.equal(profile.distributorStatus, 'pending');
  assert.equal(profile.approvalStatus, 'pending');
  assert.equal(profile.branchId, null);
  assert.equal(profile.requestedBranchId, 'branch-a');
  assert.equal(profile.publicUid, 'Dis001');
  assert.equal(profile.unique_id, 'DIS-000001');
  assert.equal(profile.faceVerification.status, 'verified');
  assert.equal(profile.emailVerified, true);
  assert.equal(profile.emailVerificationRequired, true);
  assert.equal(profile.emailOtpVerification.status, 'verified');
  assert.equal(profile.registrationCompleted, true);
  assert.equal(profile.onboardingStatus, 'complete');
});

test('policy matrix: combination 2 (Face ON + OTP OFF) for Distributor requires Face only and finalizes via completeWithoutOtp', async () => {
  const f = fixture();
  const distributor = { ...form, role: 'distributor', requestedBranchId: 'branch-a' };
  f.setSessionProfile(distributor, { faceRequired: true, otpRequired: false });
  const result = await f.service.request('dist2@example.test', 'test-ip');
  assert.equal(result.otpRequired, false);
  assert.equal(f.sent.length, 0);
  const completed = await f.service.completeWithoutOtp(result.challenge, distributor);
  assert.equal(completed.finalized, true);
  assert.equal(completed.role, 'distributor');
  assert.deepEqual(f.renderCalls.map((c) => c.path), ['/ready', '/enroll-face']);
  const profile = f.records.get('users/new-user');
  assert.equal(profile.role, 'distributor');
  assert.equal(profile.distributorStatus, 'pending');
  assert.equal(profile.approvalStatus, 'pending');
  assert.equal(profile.branchId, null);
  assert.equal(profile.requestedBranchId, 'branch-a');
  assert.equal(profile.publicUid, 'Dis001');
  assert.equal(profile.unique_id, 'DIS-000001');
  assert.equal(profile.faceVerification.status, 'verified');
  assert.equal(profile.emailVerified, false);
  assert.equal(profile.emailVerificationRequired, false);
  assert.equal(profile.emailOtpVerification.status, 'not_required');
  assert.equal(profile.registrationCompleted, true);
  assert.equal(profile.onboardingStatus, 'complete');
});

test('policy matrix: combination 3 (Face OFF + OTP ON) for Distributor requires Email OTP only and skips Face service', async () => {
  const f = fixture();
  const distributor = { ...form, role: 'distributor', requestedBranchId: 'branch-a' };
  f.setSessionProfile(distributor, { faceRequired: false, otpRequired: true });
  const result = await f.service.request('dist3@example.test', 'test-ip');
  assert.equal(result.otpRequired, true);
  assert.equal(f.sent.length, 1);
  const completed = await f.service.complete(result.challenge, f.sent[0].code, distributor, null);
  assert.equal(completed.finalized, true);
  assert.equal(completed.role, 'distributor');
  assert.equal(f.renderCalls.length, 0);
  const profile = f.records.get('users/new-user');
  assert.equal(profile.role, 'distributor');
  assert.equal(profile.distributorStatus, 'pending');
  assert.equal(profile.approvalStatus, 'pending');
  assert.equal(profile.branchId, null);
  assert.equal(profile.requestedBranchId, 'branch-a');
  assert.equal(profile.publicUid, 'Dis001');
  assert.equal(profile.unique_id, 'DIS-000001');
  assert.equal(profile.faceVerification.status, 'not_required');
  assert.equal(profile.emailVerified, true);
  assert.equal(profile.emailVerificationRequired, true);
  assert.equal(profile.emailOtpVerification.status, 'verified');
  assert.equal(profile.registrationCompleted, true);
  assert.equal(profile.onboardingStatus, 'complete');
});

test('policy matrix: combination 4 (Face OFF + OTP OFF) for Distributor finalizes immediately with neither verification', async () => {
  const f = fixture();
  const distributor = { ...form, role: 'distributor', requestedBranchId: 'branch-a' };
  f.setSessionProfile(distributor, { faceRequired: false, otpRequired: false });
  const result = await f.service.request('dist4@example.test', 'test-ip');
  assert.equal(result.otpRequired, false);
  assert.equal(f.sent.length, 0);
  const completed = await f.service.completeWithoutOtp(result.challenge, distributor, null);
  assert.equal(completed.finalized, true);
  assert.equal(completed.role, 'distributor');
  assert.equal(f.renderCalls.length, 0);
  const profile = f.records.get('users/new-user');
  assert.equal(profile.role, 'distributor');
  assert.equal(profile.distributorStatus, 'pending');
  assert.equal(profile.approvalStatus, 'pending');
  assert.equal(profile.branchId, null);
  assert.equal(profile.requestedBranchId, 'branch-a');
  assert.equal(profile.publicUid, 'Dis001');
  assert.equal(profile.unique_id, 'DIS-000001');
  assert.equal(profile.faceVerification.status, 'not_required');
  assert.equal(profile.emailVerified, false);
  assert.equal(profile.emailVerificationRequired, false);
  assert.equal(profile.emailOtpVerification.status, 'not_required');
  assert.equal(profile.registrationCompleted, true);
  assert.equal(profile.onboardingStatus, 'complete');
});

test('enabling OTP prevents completeWithoutOtp bypass across Face ON and Face OFF policies', async () => {
  // Case A: Face ON + OTP ON
  const fOn = fixture();
  fOn.setSessionProfile(form, { faceRequired: true, otpRequired: true });
  const reqOn = await fOn.service.request('on@example.test', 'test-ip');
  await assert.rejects(fOn.service.completeWithoutOtp(reqOn.challenge, form), reason('EMAIL_OTP_REQUIRED'));
  assert.equal(fOn.creates, 0);
  assert.equal(fOn.records.has('users/new-user'), false);

  // Case B: Face OFF + OTP ON
  const fOff = fixture();
  fOff.setSessionProfile(form, { faceRequired: false, otpRequired: true });
  const reqOff = await fOff.service.request('off@example.test', 'test-ip');
  await assert.rejects(fOff.service.completeWithoutOtp(reqOff.challenge, form), reason('EMAIL_OTP_REQUIRED'));
  assert.equal(fOff.creates, 0);
  assert.equal(fOff.records.has('users/new-user'), false);
});

test('enabling Face prevents unauthorized face bypass across OTP ON and OTP OFF policies', async () => {
  // Case A: Face ON + OTP OFF, unverified face in session blocks request
  const fUnverified = fixture();
  fUnverified.setSessionProfile(form, { faceRequired: true, otpRequired: false, faceStatus: 'unverified', duplicateCheck: 'unknown', livenessPassed: false });
  await assert.rejects(fUnverified.service.request('face1@example.test', 'test-ip'), reason('face-verification-required'));
  assert.equal(fUnverified.creates, 0);

  // Case B: Face ON + OTP OFF, review_required / flagged duplicate blocks request
  const fFlagged = fixture();
  fFlagged.setSessionProfile(form, { faceRequired: true, otpRequired: false, faceStatus: 'review_required', duplicateCheck: 'flagged' });
  await assert.rejects(fFlagged.service.request('face2@example.test', 'test-ip'), reason('face-review-required'));

  // Case C: Face ON + OTP OFF, verified face in session but completeWithoutOtp missing or wrong face image
  const fMissingImg = fixture();
  fMissingImg.setSessionProfile(form, { faceRequired: true, otpRequired: false });
  const reqMissing = await fMissingImg.service.request('face3@example.test', 'test-ip');
  await assert.rejects(fMissingImg.service.completeWithoutOtp(reqMissing.challenge, form, null), reason('face-capture-required'));
  await assert.rejects(fMissingImg.service.completeWithoutOtp(reqMissing.challenge, form, 'data:image/jpeg;base64,corrupted'), reason('face-capture-required'));
  assert.equal(fMissingImg.creates, 0);

  // Case D: Face ON + OTP ON, complete called with corrupted face image
  const fOtpMismatched = fixture();
  fOtpMismatched.setSessionProfile(form, { faceRequired: true, otpRequired: true });
  const reqOtp = await fOtpMismatched.service.request('face4@example.test', 'test-ip');
  await assert.rejects(fOtpMismatched.service.complete(reqOtp.challenge, fOtpMismatched.sent[0].code, form, 'data:image/jpeg;base64,mismatched'), reason('face-capture-required'));
  assert.equal(fOtpMismatched.creates, 0);
});

test('backend enforces trusted session policy snapshot regardless of client-supplied values', async () => {
  const f = fixture();
  f.setSessionProfile(form, { faceRequired: true, otpRequired: true });
  const result = await f.service.request('forged@example.test', 'test-ip');

  // Client attempts to bypass by passing forged policy in input to completeWithoutOtp
  const forgedInput = {
    ...form,
    securityPolicy: { faceVerificationRequired: false, emailOtpRequired: false },
    faceVerification: { status: 'verified', providerVerified: true },
    emailVerified: true,
  };
  await assert.rejects(f.service.completeWithoutOtp(result.challenge, forgedInput), reason('EMAIL_OTP_REQUIRED'));
  assert.equal(f.creates, 0);

  // Client attempts privilege escalation during OTP completion
  const forgedRole = {
    ...form,
    role: 'admin',
    approvalStatus: 'approved',
    branchId: 'admin-branch',
  };
  await assert.rejects(f.service.complete(result.challenge, f.sent[0].code, forgedRole), reason('invalid-registration'));
  assert.equal(f.creates, 0);
});

test('disabled verification methods do not block registration when external services are unavailable', async () => {
  // Case A: Face disabled, DeepFace service broken -> OTP registration succeeds cleanly
  const fFaceDown = fixture();
  fFaceDown.setSessionProfile(form, { faceRequired: false, otpRequired: true });
  fFaceDown.failEnrollment();
  const reqFaceDown = await fFaceDown.service.request('facedown@example.test', 'test-ip');
  const resFaceDown = await fFaceDown.service.complete(reqFaceDown.challenge, fFaceDown.sent[0].code, form, null);
  assert.equal(resFaceDown.finalized, true);
  assert.equal(fFaceDown.renderCalls.length, 0);
  assert.equal(fFaceDown.records.get('users/new-user').faceVerification.status, 'not_required');

  // Case B: OTP disabled, Email provider broken -> Face registration succeeds cleanly
  const fEmailDown = fixture();
  fEmailDown.setSessionProfile(form, { faceRequired: true, otpRequired: false });
  fEmailDown.failEmail();
  const reqEmailDown = await fEmailDown.service.request('emaildown@example.test', 'test-ip');
  assert.equal(reqEmailDown.otpRequired, false);
  assert.equal(fEmailDown.sent.length, 0);
  const resEmailDown = await fEmailDown.service.completeWithoutOtp(reqEmailDown.challenge, form);
  assert.equal(resEmailDown.finalized, true);
  assert.equal(fEmailDown.records.get('users/new-user').emailOtpVerification.status, 'not_required');

  // Case C: Both disabled, both DeepFace and Email broken -> Registration succeeds cleanly
  const fBothDown = fixture();
  fBothDown.setSessionProfile(form, { faceRequired: false, otpRequired: false });
  fBothDown.failEnrollment();
  fBothDown.failEmail();
  const reqBothDown = await fBothDown.service.request('bothdown@example.test', 'test-ip');
  assert.equal(reqBothDown.otpRequired, false);
  const resBothDown = await fBothDown.service.completeWithoutOtp(reqBothDown.challenge, form, null);
  assert.equal(resBothDown.finalized, true);
  assert.equal(fBothDown.renderCalls.length, 0);
  assert.equal(fBothDown.sent.length, 0);
  assert.equal(fBothDown.records.get('users/new-user').faceVerification.status, 'not_required');
  assert.equal(fBothDown.records.get('users/new-user').emailOtpVerification.status, 'not_required');
});

test('in-flight registration session preserves its security policy snapshot when Admin changes global policy', async () => {
  const f = fixture();
  // Session A created when policy is Face ON + OTP ON
  f.setSessionProfile(form, { faceRequired: true, otpRequired: true });
  const resultA = await f.service.request('sessiona@example.test', 'test-ip');

  // Admin toggles policy globally to Face OFF + OTP OFF
  f.records.set('systemConfig/registrationSecurity', {
    faceVerificationEnabled: false, emailOtpEnabled: false,
    maxAccountsPerDevice: 3, maxAccountsPerIp: 3, version: 2,
  });

  // Session A was snapshotted with Face ON + OTP ON: it CANNOT complete without OTP
  await assert.rejects(f.service.completeWithoutOtp(resultA.challenge, form), reason('EMAIL_OTP_REQUIRED'));

  // Session A completes with OTP and enrolls face
  const completedA = await f.service.complete(resultA.challenge, f.sent[0].code, form);
  assert.equal(completedA.finalized, true);
  assert.equal(f.records.get('users/new-user').faceVerification.status, 'verified');
  assert.equal(f.records.get('users/new-user').emailVerified, true);
});

test('completeWithoutOtp is idempotent on network retry and does not duplicate account or counters', async () => {
  const f = fixture();
  f.setSessionProfile(form, { faceRequired: false, otpRequired: false });
  const result = await f.service.request('retry@example.test', 'test-ip');
  assert.equal(result.otpRequired, false);
  const first = await f.service.completeWithoutOtp(result.challenge, form, null);
  assert.equal(first.finalized, true);
  assert.equal(f.creates, 1);
  assert.equal(f.records.get('counters/unique_ids').requester, 1);

  // Network retry with identical challenge and form
  const second = await f.service.completeWithoutOtp(result.challenge, form, null);
  assert.equal(second.finalized, true);
  assert.equal(f.creates, 1);
  assert.equal(f.records.get('counters/unique_ids').requester, 1);
  assert.equal(first.customToken, second.customToken);
});
