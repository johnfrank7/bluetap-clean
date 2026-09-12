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
  process.env.FIREBASE_WEB_API_KEY = 'public-web-key';
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
    assert.deepEqual(res.body, { customToken: 'custom-expected-user' });
    assert.match(request.url, /accounts:signInWithPassword/);
    assert.deepEqual(JSON.parse(request.options.body), { email: 'private@example.test', password: 'private-password', returnSecureToken: true });
    assert.equal(JSON.stringify(res.body).includes('private@example.test'), false);
  } finally {
    if (originalSecret === undefined) delete process.env.EMAIL_OTP_HASH_SECRET; else process.env.EMAIL_OTP_HASH_SECRET = originalSecret;
    if (originalKey === undefined) delete process.env.FIREBASE_WEB_API_KEY; else process.env.FIREBASE_WEB_API_KEY = originalKey;
  }
});

test('unknown username and wrong password return identical generic errors', async (t) => {
  const originalSecret = process.env.EMAIL_OTP_HASH_SECRET;
  const originalKey = process.env.FIREBASE_WEB_API_KEY;
  process.env.EMAIL_OTP_HASH_SECRET = 'rate-limit-secret';
  process.env.FIREBASE_WEB_API_KEY = 'public-web-key';
  t.mock.method(global, 'fetch', async () => ({ ok: false, json: async () => ({ error: { message: 'EMAIL_NOT_FOUND private@example.test' } }) }));
  try {
    const attempts = [];
    for (const known of [false, true]) {
      const res = response();
      await createUsernameHandler('login', () => fixture({ known }))({ method: 'POST', headers: {}, socket: { remoteAddress: known ? 'ip-1' : 'ip-2' }, body: { username: 'johnbluetap', password: 'wrong' } }, res);
      attempts.push({ status: res.statusCode, body: res.body });
    }
    assert.deepEqual(attempts[0], attempts[1]);
    assert.deepEqual(attempts[0], { status: 401, body: { error: { reason: 'invalid-credential', message: 'Invalid username or password.' } } });
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
