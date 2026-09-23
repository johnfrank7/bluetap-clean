const test = require('node:test');
const assert = require('node:assert/strict');
const { createUsernameHandler } = require('../usernameHandler');
const { normalizeUsername } = require('../username');

const response = () => ({
  statusCode: 200, headers: {}, body: null,
  setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
  end() { return this; },
});

function fixture({ known = true } = {}) {
  const records = new Map();
  if (known) {
    records.set('usernames/johnbluetap', { uid: 'expected-user' });
    records.set('users/expected-user', { role: 'requester', registrationCompleted: true, onboardingStatus: 'complete' });
  }
  const ref = (collection, id) => ({ key: `${collection}/${id}`, get: async () => ({ exists: records.has(`${collection}/${id}`), data: () => records.get(`${collection}/${id}`) }) });
  const db = {
    collection: (name) => ({ doc: (id) => ref(name, id) }),
    runTransaction: async (callback) => callback({
      get: async (item) => ({ exists: records.has(item.key), data: () => records.get(item.key) }),
      set: (item, data) => records.set(item.key, data),
    }),
  };
  const auth = {
    getUser: async (uid) => ({ uid, email: 'private@example.test', disabled: false }),
    getUserByEmail: async () => ({ uid: 'expected-user', email: 'private@example.test', disabled: false }),
    verifyIdToken: async () => ({ uid: 'expected-user' }),
    createCustomToken: async (uid) => `custom-${uid}`,
  };
  return { db, auth, records };
}

test('username normalization is case-insensitive and strict', () => {
  assert.equal(normalizeUsername(' JohnBlueTap '), 'johnbluetap');
  for (const invalid of ['abc', 'contains space', 'email@example.com', 'way_too_long_username_1']) {
    assert.throws(() => normalizeUsername(invalid), (error) => error.reason === 'invalid-username');
  }
});

test('username login verifies password through Firebase REST and returns only custom token', async (t) => {
  const originalSecret = process.env.EMAIL_OTP_HASH_SECRET;
  const originalKey = process.env.FIREBASE_WEB_API_KEY;
  process.env.EMAIL_OTP_HASH_SECRET = 'rate-limit-secret';
  process.env.FIREBASE_WEB_API_KEY = require('../../../firebase-web-config.json').apiKey;
  let request;
  t.mock.method(global, 'fetch', async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ localId: 'expected-user', idToken: 'must-not-return' }) };
  });
  try {
    const handler = createUsernameHandler('login', () => fixture());
    const res = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: 'test-ip' }, body: { username: 'JohnBlueTap', password: 'private-password' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.customToken, 'custom-expected-user');
    assert.deepEqual(res.body.profile, { uid: 'expected-user', email: 'private@example.test', role: 'requester', approvalStatus: null, distributorStatus: null, status: null, rejectionReason: null, mustChangePassword: false, registrationCompleted: true, onboardingStatus: 'complete', emailVerificationRequired: false, faceVerification: null, unique_id: null, managerStatus: null, branchId: null, requestedBranchId: null });
    assert.match(request.url, /accounts:signInWithPassword/);
    assert.deepEqual(JSON.parse(request.options.body), { email: 'private@example.test', password: 'private-password', returnSecureToken: true });
    assert.equal(JSON.stringify(res.body).includes('private-password'), false);
    assert.equal(JSON.stringify(res.body).includes('must-not-return'), false);
  } finally {
    if (originalSecret === undefined) delete process.env.EMAIL_OTP_HASH_SECRET; else process.env.EMAIL_OTP_HASH_SECRET = originalSecret;
    if (originalKey === undefined) delete process.env.FIREBASE_WEB_API_KEY; else process.env.FIREBASE_WEB_API_KEY = originalKey;
  }
});

test('username login uses the checked-in public Firebase project key when the server override is absent', async (t) => {
  const originalSecret = process.env.EMAIL_OTP_HASH_SECRET;
  const originalKey = process.env.FIREBASE_WEB_API_KEY;
  process.env.EMAIL_OTP_HASH_SECRET = 'rate-limit-secret';
  delete process.env.FIREBASE_WEB_API_KEY;
  let requestedUrl = '';
  t.mock.method(global, 'fetch', async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ localId: 'expected-user', idToken: 'test-id-token' }) };
  });
  try {
    const res = response();
    await createUsernameHandler('login', () => fixture())({
      method: 'POST', headers: {}, socket: { remoteAddress: 'fallback-key-test' },
      body: { username: 'johnbluetap', password: 'private-password' },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.match(requestedUrl, new RegExp(require('../../../firebase-web-config.json').apiKey));
  } finally {
    if (originalSecret === undefined) delete process.env.EMAIL_OTP_HASH_SECRET; else process.env.EMAIL_OTP_HASH_SECRET = originalSecret;
    if (originalKey === undefined) delete process.env.FIREBASE_WEB_API_KEY; else process.env.FIREBASE_WEB_API_KEY = originalKey;
  }
});

test('unknown username and wrong password return identical generic errors', async (t) => {
  const originalSecret = process.env.EMAIL_OTP_HASH_SECRET;
  const originalKey = process.env.FIREBASE_WEB_API_KEY;
  process.env.EMAIL_OTP_HASH_SECRET = 'rate-limit-secret';
  process.env.FIREBASE_WEB_API_KEY = require('../../../firebase-web-config.json').apiKey;
  t.mock.method(global, 'fetch', async () => ({ ok: false, json: async () => ({ error: { message: 'EMAIL_NOT_FOUND private@example.test' } }) }));
  try {
    const attempts = [];
    for (const known of [false, true]) {
      const res = response();
      await createUsernameHandler('login', () => fixture({ known }))({ method: 'POST', headers: {}, socket: { remoteAddress: known ? 'ip-1' : 'ip-2' }, body: { username: 'johnbluetap', password: 'wrong' } }, res);
      attempts.push({ status: res.statusCode, body: res.body });
    }
    assert.deepEqual(attempts[0], attempts[1]);
    assert.deepEqual(attempts[0], { status: 401, body: { error: { code: 'INVALID_CREDENTIALS', reason: 'invalid-credential', message: 'Invalid username or password.' } } });
  } finally {
    if (originalSecret === undefined) delete process.env.EMAIL_OTP_HASH_SECRET; else process.env.EMAIL_OTP_HASH_SECRET = originalSecret;
    if (originalKey === undefined) delete process.env.FIREBASE_WEB_API_KEY; else process.env.FIREBASE_WEB_API_KEY = originalKey;
  }
});

test('availability endpoint hides registry data and honors active reservations', async () => {
  const f = fixture({ known: false });
  let res = response();
  await createUsernameHandler('check', () => f)({ method: 'POST', headers: {}, body: { username: 'Available_Name' } }, res);
  assert.deepEqual(res.body, { available: true, normalizedUsername: 'available_name' });
  f.records.set('usernameReservations/available_name', { expiresAt: new Date(Date.now() + 60000), ownerHash: 'private' });
  res = response();
  await createUsernameHandler('check', () => f)({ method: 'POST', headers: {}, body: { username: 'AVAILABLE_NAME' } }, res);
  assert.deepEqual(res.body, { available: false, normalizedUsername: 'available_name' });
  // Claiming the registry is enough to prove no UID is exposed by the public response.
  const claimed = fixture({ known: true });
  res = response();
  await createUsernameHandler('check', () => claimed)({ method: 'POST', headers: {}, body: { username: 'JohnBlueTap' } }, res);
  assert.deepEqual(res.body, { available: false, normalizedUsername: 'johnbluetap' });
  assert.equal(JSON.stringify(res.body).includes('expected-user'), false);
});

test('public login business outcomes retain production CORS through the HTTP server', async (t) => {
  const { createAppServer } = require('../../app');
  const originalFetch = global.fetch;
  const previousSecret = process.env.EMAIL_OTP_HASH_SECRET;
  const previousKey = process.env.FIREBASE_WEB_API_KEY;
  process.env.EMAIL_OTP_HASH_SECRET = 'test-rate-limit-secret';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.EMAIL_OTP_HASH_SECRET;
    else process.env.EMAIL_OTP_HASH_SECRET = previousSecret;
    if (previousKey === undefined) delete process.env.FIREBASE_WEB_API_KEY;
    else process.env.FIREBASE_WEB_API_KEY = previousKey;
  });
  const scenarios = [
    { name: 'valid requester username', role: 'requester', status: 200 },
    { name: 'valid requester email', role: 'requester', email: true, status: 200 },
    { name: 'valid approved distributor', role: 'distributor', status: 200 },
    { name: 'pending distributor authenticates', role: 'distributor', profile: { approvalStatus: 'pending' }, status: 200 },
    { name: 'unfinished onboarding authenticates for status routing', role: 'requester', profile: { registrationCompleted: false }, status: 200 },
    { name: 'unknown username', unknown: true, status: 401, code: 'INVALID_CREDENTIALS' },
    { name: 'unknown email', email: true, missingEmail: true, status: 401, code: 'INVALID_CREDENTIALS' },
    { name: 'wrong requester password', role: 'requester', provider: 'INVALID_LOGIN_CREDENTIALS', status: 401, code: 'INVALID_CREDENTIALS' },
    { name: 'wrong distributor password', role: 'distributor', provider: 'INVALID_PASSWORD', status: 401, code: 'INVALID_CREDENTIALS' },
    { name: 'wrong admin password never shows privileged message', role: 'admin', provider: 'INVALID_PASSWORD', status: 401, code: 'INVALID_CREDENTIALS' },
    { name: 'admin public login', role: 'admin', status: 403, code: 'PRIVILEGED_LOGIN_REQUIRED', message: 'This account must use the Administrator sign-in portal.' },
    { name: 'manager public login', role: 'manager', profile: { managerStatus: 'active', branchId: 'branch-a' }, status: 200 },
    { name: 'legacy unified login cannot admit admin', role: 'admin', portal: 'unified', status: 403, code: 'PRIVILEGED_LOGIN_REQUIRED' },
    { name: 'legacy unified login admits manager through the public flow', role: 'manager', portal: 'unified', status: 200 },
    { name: 'admin authorized portal remains available', role: 'admin', portal: 'admin', status: 200 },
    { name: 'legacy manager portal mode is retired', role: 'manager', portal: 'manager', status: 400, code: 'INVALID_REQUEST' },
    { name: 'public user cannot enter privileged portal', role: 'requester', portal: 'admin', status: 403, code: 'PORTAL_ROLE_MISMATCH' },
    { name: 'deleted mapping target', deleted: true, status: 409, code: 'ACCOUNT_MAPPING_INVALID' },
    { name: 'malformed mapping UID', invalidUid: true, status: 409, code: 'ACCOUNT_MAPPING_INVALID' },
    { name: 'missing profile', noProfile: true, status: 409, code: 'ACCOUNT_SETUP_INCOMPLETE' },
    { name: 'missing role', role: '', status: 409, code: 'ACCOUNT_SETUP_INCOMPLETE' },
    { name: 'mismatched profile UID', profile: { uid: 'another-user' }, status: 409, code: 'ACCOUNT_MAPPING_INVALID' },
    { name: 'mismatched profile username', profile: { usernameNormalized: 'someone_else' }, status: 409, code: 'ACCOUNT_MAPPING_INVALID' },
    { name: 'provider UID mismatch', resultUid: 'another-user', status: 409, code: 'ACCOUNT_MAPPING_INVALID' },
    { name: 'wrong API key is a server error', provider: 'API_KEY_INVALID', status: 503, code: 'SERVER_ERROR' },
    { name: 'override for another project fails before password verification', override: 'wrong-project-test-key', projectId: 'another-project', status: 503, code: 'SERVER_ERROR' },
    { name: 'rotated override for the same project works', override: 'rotated-test-key', projectId: require('../../../firebase-web-config.json').messagingSenderId, status: 200 },
    { name: 'provider unavailable', provider: 'INTERNAL_ERROR', status: 503, code: 'SERVER_ERROR' },
    { name: 'project token verification fails', invalidToken: true, status: 503, code: 'SERVER_ERROR' },
    { name: 'Admin SDK outage is not a mapping/password error', sdkFailure: true, status: 503, code: 'SERVER_ERROR' },
    { name: 'malformed body', malformed: true, status: 400, code: 'INVALID_REQUEST' },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async (t) => {
    process.env.FIREBASE_WEB_API_KEY = scenario.override || require('../../../firebase-web-config.json').apiKey;
    const f = fixture({ known: !scenario.unknown });
    if (scenario.noProfile) f.records.delete('users/expected-user');
    else if (!scenario.unknown) f.records.set('users/expected-user', { role: scenario.role ?? 'requester', ...scenario.profile });
    if (scenario.invalidUid) f.records.set('usernames/johnbluetap', { uid: 'bad/uid' });
    if (scenario.deleted || scenario.sdkFailure) f.auth.getUser = async () => { throw Object.assign(new Error('lookup failed'), { code: scenario.deleted ? 'auth/user-not-found' : 'auth/internal-error' }); };
    if (scenario.missingEmail) f.auth.getUserByEmail = async () => { throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' }); };
    if (scenario.invalidToken) f.auth.verifyIdToken = async () => { throw new Error('wrong audience'); };
    let minted = 0;
    f.auth.createCustomToken = async () => { minted++; return 'test-custom-token'; };
    t.mock.method(global, 'fetch', async (url, options) => {
      assert.match(url, /^https:\/\/identitytoolkit.googleapis.com\//);
      if (url.includes('/v1/projects?')) return { ok: true, json: async () => ({ projectId: scenario.projectId }) };
      assert.notEqual(scenario.projectId, 'another-project');
      assert.equal(JSON.parse(options.body).email, 'private@example.test');
      return { ok: !scenario.provider, status: scenario.provider ? 400 : 200, json: async () => scenario.provider
        ? { error: { message: scenario.provider } }
        : { localId: scenario.resultUid || 'expected-user', idToken: 'test-id-token' } };
    });
    const server = createAppServer(new Map([['/api/auth/login-with-username', createUsernameHandler('login', () => f)]]));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/auth/login-with-username`;
      const headers = { Origin: 'https://bluetap-beta.vercel.app', 'Content-Type': 'application/json' };
      const preflight = await originalFetch(url, { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), headers.Origin);
      const res = await originalFetch(url, { method: 'POST', headers, body: scenario.malformed ? '{bad' : JSON.stringify({ username: scenario.email ? 'PRIVATE@example.test' : ' JohnBlueTap ', password: 'test-password', portal: scenario.portal || 'public' }) });
      const body = await res.json();
      assert.equal(res.status, scenario.status);
      assert.equal(res.headers.get('access-control-allow-origin'), headers.Origin);
      assert.match(res.headers.get('vary'), /Origin/);
      if (scenario.code) {
        assert.equal(body.error.code, scenario.code);
        assert.equal(minted, 0);
        if (scenario.code === 'INVALID_CREDENTIALS') assert.equal(body.error.message, 'Invalid username or password.');
        if (scenario.message) assert.equal(body.error.message, scenario.message);
      } else {
        assert.equal(body.customToken, 'test-custom-token');
        assert.equal(body.profile.uid, 'expected-user');
        assert.equal(minted, 1);
        if (scenario.role === 'manager' && scenario.profile) {
          assert.equal(body.profile.managerStatus, scenario.profile.managerStatus);
          assert.equal(body.profile.branchId, scenario.profile.branchId);
        }
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test('layered rate limiting: repeated failures on Account A return 429 and do not block Account B from same IP', async (t) => {
  const originalSecret = process.env.EMAIL_OTP_HASH_SECRET;
  const originalKey = process.env.FIREBASE_WEB_API_KEY;
  process.env.EMAIL_OTP_HASH_SECRET = 'test-layered-secret';
  process.env.FIREBASE_WEB_API_KEY = require('../../../firebase-web-config.json').apiKey;

  const f = fixture();
  f.records.set('usernames/accounta', { uid: 'user-a' });
  f.records.set('users/user-a', { role: 'manager', managerStatus: 'active', branchId: 'branch-a', registrationCompleted: true, onboardingStatus: 'complete' });
  f.records.set('usernames/accountb', { uid: 'user-b' });
  f.records.set('users/user-b', { role: 'requester', registrationCompleted: true, onboardingStatus: 'complete' });
  f.auth.getUser = async (uid) => ({ uid, email: `${uid}@example.test`, disabled: false });
  f.auth.verifyIdToken = async (token) => ({ uid: token.replace('token-', '') });
  f.auth.createCustomToken = async (uid) => `custom-${uid}`;

  t.mock.method(global, 'fetch', async (url, options) => {
    const body = JSON.parse(options?.body || '{}');
    if (body.password === 'valid-pass') {
      const uid = body.email.replace('@example.test', '');
      return { ok: true, json: async () => ({ localId: uid, idToken: `token-${uid}` }) };
    }
    return { ok: false, json: async () => ({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }) };
  });

  const handler = createUsernameHandler('login', () => f);
  const sharedIp = '203.0.113.50';

  try {
    // 1-4: Account A fails with wrong password -> returns 401 INVALID_CREDENTIALS
    for (let i = 1; i <= 4; i++) {
      const res = response();
      await handler({ method: 'POST', headers: {}, socket: { remoteAddress: sharedIp }, body: { username: 'accounta', password: 'wrong' } }, res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
    }

    // 5: Account A reaches failure threshold (5) -> returns 429 LOGIN_RATE_LIMITED with retryAfterSeconds
    const res5 = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: sharedIp }, body: { username: 'accounta', password: 'wrong' } }, res5);
    assert.equal(res5.statusCode, 429);
    assert.equal(res5.body.code, 'LOGIN_RATE_LIMITED');
    assert.equal(res5.body.error.code, 'LOGIN_RATE_LIMITED');
    assert.equal(res5.body.error.reason, 'too-many-attempts');
    assert.equal(res5.body.retryAfterSeconds, 60);
    assert.equal(res5.body.error.retryAfterSeconds, 60);

    // 6: Account A during cooldown is blocked immediately by pre-check
    const resBlocked = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: sharedIp }, body: { username: 'accounta', password: 'wrong' } }, resBlocked);
    assert.equal(resBlocked.statusCode, 429);
    assert.equal(resBlocked.body.code, 'LOGIN_RATE_LIMITED');

    // 7: Account B on the SAME IP logs in successfully -> Account A cooldown is NOT a global lock!
    const resB = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: sharedIp }, body: { username: 'accountb', password: 'valid-pass' } }, resB);
    assert.equal(resB.statusCode, 200);
    assert.equal(resB.body.customToken, 'custom-user-b');
  } finally {
    if (originalSecret === undefined) delete process.env.EMAIL_OTP_HASH_SECRET; else process.env.EMAIL_OTP_HASH_SECRET = originalSecret;
    if (originalKey === undefined) delete process.env.FIREBASE_WEB_API_KEY; else process.env.FIREBASE_WEB_API_KEY = originalKey;
  }
});

test('layered rate limiting: successful login resets failure counter', async (t) => {
  const originalSecret = process.env.EMAIL_OTP_HASH_SECRET;
  const originalKey = process.env.FIREBASE_WEB_API_KEY;
  process.env.EMAIL_OTP_HASH_SECRET = 'test-reset-secret';
  process.env.FIREBASE_WEB_API_KEY = require('../../../firebase-web-config.json').apiKey;

  const f = fixture();
  f.records.set('usernames/resettable', { uid: 'user-reset' });
  f.records.set('users/user-reset', { role: 'requester', registrationCompleted: true, onboardingStatus: 'complete' });
  f.auth.getUser = async (uid) => ({ uid, email: 'resettable@example.test', disabled: false });
  f.auth.verifyIdToken = async () => ({ uid: 'user-reset' });
  f.auth.createCustomToken = async (uid) => `custom-${uid}`;

  t.mock.method(global, 'fetch', async (url, options) => {
    const body = JSON.parse(options?.body || '{}');
    if (body.password === 'correct') {
      return { ok: true, json: async () => ({ localId: 'user-reset', idToken: 'token-user-reset' }) };
    }
    return { ok: false, json: async () => ({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }) };
  });

  const handler = createUsernameHandler('login', () => f);

  try {
    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      const res = response();
      await handler({ method: 'POST', headers: {}, socket: { remoteAddress: 'test-ip' }, body: { username: 'resettable', password: 'bad' } }, res);
      assert.equal(res.statusCode, 401);
    }

    // 5th attempt succeeds with correct password
    const resSuccess = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: 'test-ip' }, body: { username: 'resettable', password: 'correct' } }, resSuccess);
    assert.equal(resSuccess.statusCode, 200);

    // Next wrong attempt is treated as attempt #1 (returns 401, NOT 429)
    const resAfterReset = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: 'test-ip' }, body: { username: 'resettable', password: 'bad' } }, resAfterReset);
    assert.equal(resAfterReset.statusCode, 401);
    assert.equal(resAfterReset.body.error.code, 'INVALID_CREDENTIALS');
  } finally {
    if (originalSecret === undefined) delete process.env.EMAIL_OTP_HASH_SECRET; else process.env.EMAIL_OTP_HASH_SECRET = originalSecret;
    if (originalKey === undefined) delete process.env.FIREBASE_WEB_API_KEY; else process.env.FIREBASE_WEB_API_KEY = originalKey;
  }
});

test('layered rate limiting: cooldown expires correctly after elapsed time', async (t) => {
  const originalSecret = process.env.EMAIL_OTP_HASH_SECRET;
  const originalKey = process.env.FIREBASE_WEB_API_KEY;
  process.env.EMAIL_OTP_HASH_SECRET = 'test-cooldown-secret';
  process.env.FIREBASE_WEB_API_KEY = require('../../../firebase-web-config.json').apiKey;

  let currentTime = 1000000000000;
  const f = fixture();
  f.records.set('usernames/expirable', { uid: 'user-exp' });
  f.records.set('users/user-exp', { role: 'distributor', distributorStatus: 'approved', registrationCompleted: true, onboardingStatus: 'complete' });
  f.auth.getUser = async (uid) => ({ uid, email: 'expirable@example.test', disabled: false });
  f.auth.verifyIdToken = async () => ({ uid: 'user-exp' });
  f.auth.createCustomToken = async (uid) => `custom-${uid}`;

  t.mock.method(global, 'fetch', async (url, options) => {
    const body = JSON.parse(options?.body || '{}');
    if (body.password === 'good-pass') {
      return { ok: true, json: async () => ({ localId: 'user-exp', idToken: 'token-user-exp' }) };
    }
    return { ok: false, json: async () => ({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }) };
  });

  const handler = createUsernameHandler('login', () => f, { now: () => currentTime });

  try {
    // 5 failures trigger 60s cooldown
    for (let i = 0; i < 5; i++) {
      const res = response();
      await handler({ method: 'POST', headers: {}, socket: { remoteAddress: 'test-ip' }, body: { username: 'expirable', password: 'bad' } }, res);
      if (i < 4) assert.equal(res.statusCode, 401);
      else assert.equal(res.statusCode, 429);
    }

    // 10 seconds later: still blocked, retryAfterSeconds is 50
    currentTime += 10000;
    const resBlocked = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: 'test-ip' }, body: { username: 'expirable', password: 'bad' } }, resBlocked);
    assert.equal(resBlocked.statusCode, 429);
    assert.equal(resBlocked.body.retryAfterSeconds, 50);

    // Advance past the 60s cooldown window (total 65 seconds elapsed)
    currentTime += 55000;
    const resUnblocked = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: 'test-ip' }, body: { username: 'expirable', password: 'good-pass' } }, resUnblocked);
    assert.equal(resUnblocked.statusCode, 200);
    assert.equal(resUnblocked.body.customToken, 'custom-user-exp');
  } finally {
    if (originalSecret === undefined) delete process.env.EMAIL_OTP_HASH_SECRET; else process.env.EMAIL_OTP_HASH_SECRET = originalSecret;
    if (originalKey === undefined) delete process.env.FIREBASE_WEB_API_KEY; else process.env.FIREBASE_WEB_API_KEY = originalKey;
  }
});

test('layered rate limiting: rapid attempts against many accounts from same IP trigger IP abuse protection', async (t) => {
  const originalSecret = process.env.EMAIL_OTP_HASH_SECRET;
  const originalKey = process.env.FIREBASE_WEB_API_KEY;
  process.env.EMAIL_OTP_HASH_SECRET = 'test-ip-abuse-secret';
  process.env.FIREBASE_WEB_API_KEY = require('../../../firebase-web-config.json').apiKey;

  const f = fixture({ known: false });
  const handler = createUsernameHandler('login', () => f);
  const abuserIp = '198.51.100.1';
  const cleanIp = '198.51.100.2';

  try {
    // Send 30 attempts against 30 different accounts from the abuser IP (1 failure per account)
    for (let i = 1; i <= 30; i++) {
      const res = response();
      await handler({ method: 'POST', headers: {}, socket: { remoteAddress: abuserIp }, body: { username: `targetuser_${i}`, password: 'bad' } }, res);
      assert.equal(res.statusCode, 401);
    }

    // 31st attempt from abuser IP triggers IP abuse protection (429)
    const resAbused = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: abuserIp }, body: { username: 'targetuser_31', password: 'bad' } }, resAbused);
    assert.equal(resAbused.statusCode, 429);
    assert.equal(resAbused.body.code, 'LOGIN_RATE_LIMITED');
    assert.match(resAbused.body.error.message, /this network/i);

    // Clean IP is NOT blocked
    const resClean = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: cleanIp }, body: { username: 'targetuser_clean', password: 'bad' } }, resClean);
    assert.equal(resClean.statusCode, 401);
  } finally {
    if (originalSecret === undefined) delete process.env.EMAIL_OTP_HASH_SECRET; else process.env.EMAIL_OTP_HASH_SECRET = originalSecret;
    if (originalKey === undefined) delete process.env.FIREBASE_WEB_API_KEY; else process.env.FIREBASE_WEB_API_KEY = originalKey;
  }
});

test('layered rate limiting: no account-existence leakage through rate-limit responses', async (t) => {
  const originalSecret = process.env.EMAIL_OTP_HASH_SECRET;
  const originalKey = process.env.FIREBASE_WEB_API_KEY;
  process.env.EMAIL_OTP_HASH_SECRET = 'test-leakage-secret';
  process.env.FIREBASE_WEB_API_KEY = require('../../../firebase-web-config.json').apiKey;

  const fKnown = fixture({ known: true });
  const fUnknown = fixture({ known: false });

  t.mock.method(global, 'fetch', async () => ({ ok: false, json: async () => ({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }) }));

  const handlerKnown = createUsernameHandler('login', () => fKnown);
  const handlerUnknown = createUsernameHandler('login', () => fUnknown);

  try {
    let resKnown;
    let resUnknown;

    for (let i = 0; i < 5; i++) {
      resKnown = response();
      resUnknown = response();
      await handlerKnown({ method: 'POST', headers: {}, socket: { remoteAddress: 'ip-known' }, body: { username: 'johnbluetap', password: 'bad' } }, resKnown);
      await handlerUnknown({ method: 'POST', headers: {}, socket: { remoteAddress: 'ip-unknown' }, body: { username: 'ghostaccount', password: 'bad' } }, resUnknown);
    }

    // Both return 429 with identical response structure, error code, reason, and retryAfterSeconds
    assert.equal(resKnown.statusCode, 429);
    assert.equal(resUnknown.statusCode, 429);
    assert.deepEqual(resKnown.body, resUnknown.body);
    assert.deepEqual(resKnown.body, {
      code: 'LOGIN_RATE_LIMITED',
      retryAfterSeconds: 60,
      error: {
        code: 'LOGIN_RATE_LIMITED',
        reason: 'too-many-attempts',
        message: 'Too many login attempts. Please try again in 1 minute.',
        retryAfterSeconds: 60,
      },
    });
  } finally {
    if (originalSecret === undefined) delete process.env.EMAIL_OTP_HASH_SECRET; else process.env.EMAIL_OTP_HASH_SECRET = originalSecret;
    if (originalKey === undefined) delete process.env.FIREBASE_WEB_API_KEY; else process.env.FIREBASE_WEB_API_KEY = originalKey;
  }
});

test('canonical account rate limiting: same account via username and email shares failure counter', async (t) => {
  const originalSecret = process.env.EMAIL_OTP_HASH_SECRET;
  const originalKey = process.env.FIREBASE_WEB_API_KEY;
  process.env.EMAIL_OTP_HASH_SECRET = 'test-alias-secret';
  process.env.FIREBASE_WEB_API_KEY = require('../../../firebase-web-config.json').apiKey;

  const f = fixture();
  f.records.set('usernames/shareduser', { uid: 'canonical-uid-123' });
  f.records.set('users/canonical-uid-123', { role: 'distributor', distributorStatus: 'approved', registrationCompleted: true, onboardingStatus: 'complete' });
  f.records.set('usernames/otheruser', { uid: 'canonical-uid-456' });
  f.records.set('users/canonical-uid-456', { role: 'requester', registrationCompleted: true, onboardingStatus: 'complete' });

  f.auth.getUser = async (uid) => ({ uid, email: uid === 'canonical-uid-123' ? 'shared@example.test' : 'other@example.test', disabled: false });
  f.auth.getUserByEmail = async (email) => {
    if (email === 'shared@example.test') return { uid: 'canonical-uid-123', email, disabled: false };
    if (email === 'other@example.test') return { uid: 'canonical-uid-456', email, disabled: false };
    throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
  };
  f.auth.verifyIdToken = async (token) => ({ uid: token.replace('token-', '') });
  f.auth.createCustomToken = async (uid) => `custom-${uid}`;

  t.mock.method(global, 'fetch', async (url, options) => {
    const body = JSON.parse(options?.body || '{}');
    if (body.password === 'valid-password') {
      const localId = body.email === 'shared@example.test' ? 'canonical-uid-123' : 'canonical-uid-456';
      return { ok: true, json: async () => ({ localId, idToken: `token-${localId}` }) };
    }
    return { ok: false, json: async () => ({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }) };
  });

  const handler = createUsernameHandler('login', () => f);
  const testIp = '198.51.100.99';

  try {
    // 1-2: 2 failed attempts using username 'shareduser'
    for (let i = 1; i <= 2; i++) {
      const res = response();
      await handler({ method: 'POST', headers: {}, socket: { remoteAddress: testIp }, body: { username: 'shareduser', password: 'bad' } }, res);
      assert.equal(res.statusCode, 401);
    }

    // 3-4: 2 failed attempts using email 'shared@example.test'
    for (let i = 3; i <= 4; i++) {
      const res = response();
      await handler({ method: 'POST', headers: {}, socket: { remoteAddress: testIp }, body: { username: 'shared@example.test', password: 'bad' } }, res);
      assert.equal(res.statusCode, 401);
    }

    // 5: 5th failure using username 'shareduser' reaches threshold (5 total failures on canonical-uid-123) -> 429
    const res5 = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: testIp }, body: { username: 'shareduser', password: 'bad' } }, res5);
    assert.equal(res5.statusCode, 429);
    assert.equal(res5.body.code, 'LOGIN_RATE_LIMITED');
    assert.equal(res5.body.retryAfterSeconds, 60);

    // 6: Attempt via email 'shared@example.test' is also immediately blocked by the same cooldown
    const res6 = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: testIp }, body: { username: 'shared@example.test', password: 'bad' } }, res6);
    assert.equal(res6.statusCode, 429);
    assert.equal(res6.body.code, 'LOGIN_RATE_LIMITED');

    // 7: Unrelated account 'otheruser' from the SAME IP can still log in successfully
    const resOther = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: testIp }, body: { username: 'otheruser', password: 'valid-password' } }, resOther);
    assert.equal(resOther.statusCode, 200);
    assert.equal(resOther.body.customToken, 'custom-canonical-uid-456');

    // 8: Nonexistent identifier gets generic error without leakage
    const resNonexistent = response();
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: testIp }, body: { username: 'nonexistentuser', password: 'bad' } }, resNonexistent);
    assert.equal(resNonexistent.statusCode, 401);
    assert.equal(resNonexistent.body.error.code, 'INVALID_CREDENTIALS');
  } finally {
    if (originalSecret === undefined) delete process.env.EMAIL_OTP_HASH_SECRET; else process.env.EMAIL_OTP_HASH_SECRET = originalSecret;
    if (originalKey === undefined) delete process.env.FIREBASE_WEB_API_KEY; else process.env.FIREBASE_WEB_API_KEY = originalKey;
  }
});

test('public login error formatting formats retry duration correctly', () => {
  const { getPublicLoginErrorMessage, formatRetryDuration } = require('../../../services/publicLoginErrors');
  assert.equal(formatRetryDuration(240), '4 minutes');
  assert.equal(formatRetryDuration(60), '1 minute');
  assert.equal(formatRetryDuration(45), '45 seconds');
  assert.equal(formatRetryDuration(1), '1 second');

  assert.equal(getPublicLoginErrorMessage({ code: 'LOGIN_RATE_LIMITED', retryAfterSeconds: 240 }), 'Too many login attempts. Try again in 4 minutes.');
  assert.equal(getPublicLoginErrorMessage({ code: 'LOGIN_RATE_LIMITED', retryAfterSeconds: 60 }), 'Too many login attempts. Try again in 1 minute.');
  assert.equal(getPublicLoginErrorMessage({ code: 'LOGIN_RATE_LIMITED', retryAfterSeconds: 45 }), 'Too many login attempts. Try again in 45 seconds.');
  assert.equal(getPublicLoginErrorMessage({ code: 'LOGIN_RATE_LIMITED' }), 'Too many login attempts. Please try again later.');
  assert.equal(getPublicLoginErrorMessage({ code: 'username/too-many-attempts' }), 'Too many login attempts. Please try again later.');
});
