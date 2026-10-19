const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { getPublicLoginErrorMessage } = require('../../../services/publicLoginErrors');
const root = resolve(__dirname, '../../..');

function loadService(file, context, expose) {
  const source = readFileSync(resolve(root, file), 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace(/export const /g, 'const ')
    .replace(/^export \{[^}]+\};\r?\n/gm, '');
  return vm.runInNewContext(`${source}\n${expose}`, context);
}

test('public error mapping never guesses a privileged account from a generic error', () => {
  for (const code of ['INVALID_CREDENTIALS', 'username/invalid-credential', 'auth/wrong-password']) {
    assert.equal(getPublicLoginErrorMessage({ code }), 'Invalid username or password.');
  }
  assert.equal(getPublicLoginErrorMessage({ code: 'PRIVILEGED_LOGIN_REQUIRED' }), 'This account must use the Administrator sign-in portal.');
  assert.equal(getPublicLoginErrorMessage({ code: 'username/network' }), 'We could not reach the authentication service. Please try again.');
  assert.equal(getPublicLoginErrorMessage({ code: 'username/connection-unavailable' }), 'Unable to connect to BlueTap. Please try again.');
  for (const code of ['SERVER_ERROR', 'auth/invalid-custom-token', 'unknown', undefined]) {
    assert.equal(getPublicLoginErrorMessage({ code, message: 'This account must use the Administrator sign-in portal.' }), 'Login is temporarily unavailable. Please try again.');
  }
});

test('username client honors response codes, rejects malformed tokens and distinguishes fetch failures', async () => {
  const scenarios = [
    { response: { ok: false, json: async () => ({ error: { code: 'INVALID_CREDENTIALS' } }) }, expected: 'Invalid username or password.' },
    { response: { ok: false, json: async () => ({ error: { reason: 'invalid-credential' } }) }, expected: 'Invalid username or password.' },
    { response: { ok: false, json: async () => ({ error: { code: 'PRIVILEGED_LOGIN_REQUIRED' } }) }, expected: 'This account must use the Administrator sign-in portal.' },
    { response: { ok: false, json: async () => { throw new Error('HTML proxy error'); } }, expected: 'Login is temporarily unavailable. Please try again.' },
    { response: { ok: true, json: async () => ({ idToken: 'wrong-contract' }) }, expected: 'Login is temporarily unavailable. Please try again.' },
    { network: true, expected: 'Unable to connect to BlueTap. Please try again.' },
  ];
  for (const scenario of scenarios) {
    const login = loadService('services/usernameAuth.js', {
      AbortController, setTimeout, clearTimeout, getApiUrl: (path) => path,
      fetch: async () => { if (scenario.network) throw new TypeError('fetch failed'); return scenario.response; },
    }, 'loginWithUsername');
    await assert.rejects(login('test_user', 'password', { readinessTimeoutMs: 0 }), (error) => getPublicLoginErrorMessage(error) === scenario.expected);
  }
});

test('transient username login transport failure waits for readiness and retries credentials once', async () => {
  const calls = [];
  const connectionStates = [];
  let credentials = 0;
  const source = readFileSync(resolve(root, 'services/usernameAuth.js'), 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace(/export const /g, 'const ')
    .replace('export { waitForBackendReadiness };', '');
  const login = vm.runInNewContext(`${source}\nloginWithUsernameResult`, {
    AbortController, setTimeout, clearTimeout, Date, Promise,
    getApiBaseUrl: () => 'https://api.example.test',
    getApiUrl: (path) => `https://api.example.test${path}`,
    fetch: async (url, options) => {
      calls.push({ url, body: options?.body ? JSON.parse(options.body) : null });
      if (url.endsWith('/health')) return { ok: true };
      credentials += 1;
      if (credentials === 1) throw new TypeError('connection closed');
      return { ok: true, json: async () => ({ customToken: 'token', profile: {} }) };
    },
  });
  const result = await login('test_user', 'test-password', {
    readinessTimeoutMs: 50,
    onConnectionWait: (waiting) => connectionStates.push(waiting),
  });
  assert.equal(result.customToken, 'token');
  assert.equal(credentials, 2);
  assert.equal(calls.filter((call) => call.url.endsWith('/health')).length, 1);
  const credentialBodies = calls.filter((call) => call.url.endsWith('/api/auth/login-with-username')).map((call) => call.body);
  assert.equal(credentialBodies[0].attemptId, credentialBodies[1].attemptId);
  assert.equal(JSON.stringify(credentialBodies[0]), JSON.stringify(credentialBodies[1]));
  assert.deepEqual(connectionStates, [true, false]);
});

test('a delayed initial login response succeeds without readiness polling or a second credential request', async () => {
  let credentialCalls = 0;
  let healthCalls = 0;
  const source = readFileSync(resolve(root, 'services/usernameAuth.js'), 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace(/export const /g, 'const ')
    .replace('export { waitForBackendReadiness };', '');
  const login = vm.runInNewContext(`${source}\nloginWithUsernameResult`, {
    AbortController, setTimeout, clearTimeout, Date, Promise,
    getApiBaseUrl: () => 'https://api.example.test',
    getApiUrl: (path) => `https://api.example.test${path}`,
    fetch: async (url) => {
      if (url.endsWith('/health')) healthCalls += 1;
      else credentialCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { ok: true, json: async () => ({ customToken: 'token', profile: {} }) };
    },
  });
  const result = await login('test_user', 'test-password');
  assert.equal(result.customToken, 'token');
  assert.equal(credentialCalls, 1);
  assert.equal(healthCalls, 0);
});

test('invalid credentials and blocked readiness checks do not trigger repeated password requests', async () => {
  const source = readFileSync(resolve(root, 'services/usernameAuth.js'), 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace(/export const /g, 'const ')
    .replace('export { waitForBackendReadiness };', '');
  const makeLogin = (fetch) => vm.runInNewContext(`${source}\nloginWithUsernameResult`, {
    AbortController, setTimeout, clearTimeout, Date, Promise,
    getApiBaseUrl: () => 'https://api.example.test',
    getApiUrl: (path) => `https://api.example.test${path}`,
    fetch,
  });
  let invalidCredentialCalls = 0;
  const invalidLogin = makeLogin(async () => {
    invalidCredentialCalls += 1;
    return { ok: false, json: async () => ({ error: { code: 'INVALID_CREDENTIALS' } }) };
  });
  await assert.rejects(invalidLogin('test_user', 'wrong-password'), { code: 'INVALID_CREDENTIALS' });
  assert.equal(invalidCredentialCalls, 1);

  let credentialCalls = 0;
  const blockedLogin = makeLogin(async (url) => {
    if (url.endsWith('/health')) throw new TypeError('blocked by client');
    credentialCalls += 1;
    if (credentialCalls === 1) throw new TypeError('connection closed');
    return { ok: true, json: async () => ({ customToken: 'token', profile: {} }) };
  });
  const result = await blockedLogin('test_user', 'test-password', { readinessTimeoutMs: 1, readinessPollIntervalMs: 0 });
  assert.equal(result.customToken, 'token');
  assert.equal(credentialCalls, 2);
});

test('unreachable API ends with connection-unavailable and clears connecting feedback', async () => {
  const connectionStates = [];
  let credentialCalls = 0;
  const source = readFileSync(resolve(root, 'services/usernameAuth.js'), 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace(/export const /g, 'const ')
    .replace('export { waitForBackendReadiness };', '');
  const login = vm.runInNewContext(`${source}\nloginWithUsernameResult`, {
    AbortController, setTimeout, clearTimeout, Date, Promise,
    getApiBaseUrl: () => 'https://api.example.test',
    getApiUrl: (path) => `https://api.example.test${path}`,
    fetch: async (url) => {
      if (url.endsWith('/health')) throw new TypeError('offline');
      credentialCalls += 1;
      throw new TypeError('offline');
    },
  });
  await assert.rejects(login('test_user', 'test-password', {
    readinessTimeoutMs: 1,
    readinessPollIntervalMs: 0,
    onConnectionWait: (waiting) => connectionStates.push(waiting),
  }), { code: 'username/connection-unavailable' });
  assert.equal(credentialCalls, 2);
  assert.deepEqual(connectionStates, [true, false]);
});

// Execute the screen's actual async submit and routing functions with SDK
// boundaries mocked. These tests do not claim a real Firebase/browser login.
test('public form establishes the client session before profile lookup and role routing', async (t) => {
  const page = readFileSync(resolve(root, 'app/login.jsx'), 'utf8');
  const helpers = page.slice(page.indexOf('const normalizeApprovalStatus'), page.indexOf('const BASE_SCROLL_PADDING_BOTTOM'));
  const submit = page.slice(page.indexOf('  const finishSuccessfulLogin'), page.indexOf('  const confirmRestartIncompleteRegistration'));
  const cases = [
    { name: 'requester username', role: 'requester', path: '/requester/r_dashboard' },
    { name: 'requester after stale Admin session', role: 'requester', staleAdmin: true, path: '/requester/r_dashboard' },
    { name: 'requester email', role: 'requester', email: 'requester@example.test', path: '/requester/r_dashboard' },
    { name: 'approved distributor with an assigned branch', role: 'distributor', profile: { approvalStatus: 'approved', branchId: 'branch-a' }, path: '/distributor/d_dashboard' },
    { name: 'approvalStatus overrides stale legacy status when a branch is assigned', role: 'distributor', profile: { approvalStatus: 'approved', status: 'Pending', branchId: 'branch-a' }, path: '/distributor/d_dashboard' },
    { name: 'active Distributor without an operational branch is held at status', role: 'distributor', profile: { distributorStatus: 'active' }, path: '/registration-status' },
    { name: 'pending distributor', role: 'distributor', profile: { approvalStatus: 'pending' }, path: '/registration-status' },
    { name: 'rejected distributor', role: 'distributor', profile: { approvalStatus: 'rejected' }, path: '/registration-status' },
    { name: 'unfinished requester', role: 'requester', profile: { registrationCompleted: false }, path: '/registration-status' },
    { name: 'wrong password', error: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' },
    { name: 'unreachable backend', error: 'username/connection-unavailable', message: 'Unable to connect to BlueTap. Please try again.', actionLabel: 'Try again' },
    { name: 'active manager username', role: 'manager', profile: { managerStatus: 'active', branchId: 'branch-a' }, path: '/manager/dashboard' },
    { name: 'manager temporary password', role: 'manager', profile: { managerStatus: 'active', branchId: 'branch-a', mustChangePassword: true }, path: '/required-password-change' },
    { name: 'admin rejected by backend', error: 'PRIVILEGED_LOGIN_REQUIRED', message: 'This account must use the Administrator sign-in portal.', actionLabel: 'Go to Admin Login', actionPath: '/admin/login' },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const events = [];
    const auth = { currentUser: scenario.staleAdmin ? { uid: 'old-admin' } : null };
    const profile = { role: scenario.role, registrationCompleted: true, faceVerification: { required: false, status: 'not_required' }, ...scenario.profile };
    const destination = loadService('services/authSession.js', {}, 'getPostAuthenticationDestination');
    const usernameLogin = loadService('services/usernameAuth.js', {
      AbortController, setTimeout, clearTimeout, getApiUrl: (path) => path,
      fetch: async (_url, options) => {
        events.push('backend');
        const body = JSON.parse(options.body);
        assert.equal(body.portal, 'public');
        assert.equal(body.username, scenario.email || 'test_user');
        return { ok: !scenario.error, json: async () => scenario.error ? { error: { code: scenario.error } } : { customToken: 'test-custom-token', profile: { uid: 'public-user', email: 'public@example.test', role: scenario.role, registrationCompleted: true, faceVerification: { required: false, status: 'not_required' }, ...scenario.profile } } };
      },
    }, 'loginWithUsernameResult');
    const loadingEvents = [];
    const context = {
      auth, db: {}, loading: false, email: scenario.email || 'test_user', password: 'test-password',
      loginInFlight: { current: false }, console: { info: () => {} },
      setLoginConnecting: () => {},
      getPublicLoginErrorMessage, loginWithUsernameResult: usernameLogin,
      signInWithCustomToken: async (_auth, token) => {
        assert.equal(token, 'test-custom-token'); events.push('client-session');
        auth.currentUser = { uid: 'public-user', email: 'public@example.test', emailVerified: true };
        return { user: auth.currentUser };
      },
      fetchFirestoreUserProfile: async (user) => ({ ...profile, uid: user.uid, email: 'public@example.test' }),
      ensureUserUniqueId: async (_user, data) => data,
      saveLocalUser: () => {}, saveRoleSession: () => events.push('shared-session'),
      clearAllAuthSessions: () => events.push('clear'), signOut: async () => {
        if (scenario.staleAdmin && auth.currentUser?.uid === 'old-admin') events.push('firebase-signout');
        auth.currentUser = null;
      },
      getPostAuthenticationDestination: destination,
      setLoading: (value) => loadingEvents.push(value), router: { replace: (path) => events.push(path) },
      showNotification: (_title, message, onConfirm, actionLabel) => {
        events.push(message);
        if (actionLabel) events.push(actionLabel);
        if (onConfirm && scenario.actionPath) onConfirm();
      },
    };
    const run = vm.runInNewContext(`${helpers}\n${submit}\nhandleLogin`, context);
    await run();
    assert.equal(loadingEvents[0], true);
    assert.equal(loadingEvents.at(-1), false);
    assert.ok(loadingEvents.slice(1).every((value) => value === false));
    if (scenario.error) {
      assert.deepEqual(events, ['clear', 'backend', scenario.message, ...(scenario.actionLabel ? [scenario.actionLabel, ...(scenario.actionPath ? [scenario.actionPath] : [])] : [])]);
      assert.equal(auth.currentUser, null);
    } else {
      assert.deepEqual(events, [
        'clear',
        ...(scenario.staleAdmin ? ['firebase-signout'] : []),
        'backend',
        'client-session',
        'shared-session',
        scenario.path,
      ]);
      assert.equal(auth.currentUser.uid, 'public-user');
    }
  });
});
