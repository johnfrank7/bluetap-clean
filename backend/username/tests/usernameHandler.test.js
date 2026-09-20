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
    assert.deepEqual(res.body.profile, { uid: 'expected-user', email: 'private@example.test', role: 'requester', approvalStatus: null, status: null, rejectionReason: null, registrationCompleted: true, onboardingStatus: 'complete', emailVerificationRequired: false, faceVerification: null, unique_id: null });
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
    { name: 'admin public login', role: 'admin', status: 403, code: 'PRIVILEGED_LOGIN_REQUIRED' },
    { name: 'manager public login', role: 'manager', status: 403, code: 'PRIVILEGED_LOGIN_REQUIRED' },
    { name: 'legacy unified login cannot admit admin', role: 'admin', portal: 'unified', status: 403, code: 'PRIVILEGED_LOGIN_REQUIRED' },
    { name: 'legacy unified login cannot admit manager', role: 'manager', portal: 'unified', status: 403, code: 'PRIVILEGED_LOGIN_REQUIRED' },
    { name: 'admin authorized portal remains available', role: 'admin', portal: 'admin', status: 200 },
    { name: 'manager authorized portal remains available', role: 'manager', portal: 'manager', status: 200 },
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
      } else {
        assert.equal(body.customToken, 'test-custom-token');
        assert.equal(body.profile.uid, 'expected-user');
        assert.equal(minted, 1);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
