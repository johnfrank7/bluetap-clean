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
    .replace(/export const /g, 'const ');
  return vm.runInNewContext(`${source}\n${expose}`, context);
}

test('public error mapping never guesses a privileged account from a generic error', () => {
  for (const code of ['INVALID_CREDENTIALS', 'username/invalid-credential', 'auth/wrong-password']) {
    assert.equal(getPublicLoginErrorMessage({ code }), 'Invalid username or password.');
  }
  assert.equal(getPublicLoginErrorMessage({ code: 'PRIVILEGED_LOGIN_REQUIRED' }), 'This account must use its authorized sign-in portal.');
  assert.equal(getPublicLoginErrorMessage({ code: 'username/network' }), 'We could not reach the authentication service. Please try again.');
  for (const code of ['SERVER_ERROR', 'auth/invalid-custom-token', 'unknown', undefined]) {
    assert.equal(getPublicLoginErrorMessage({ code, message: 'This account must use its authorized sign-in portal.' }), 'Login is temporarily unavailable. Please try again.');
  }
});

test('username client honors response codes, rejects malformed tokens and distinguishes fetch failures', async () => {
  const scenarios = [
    { response: { ok: false, json: async () => ({ error: { code: 'INVALID_CREDENTIALS' } }) }, expected: 'Invalid username or password.' },
    { response: { ok: false, json: async () => ({ error: { reason: 'invalid-credential' } }) }, expected: 'Invalid username or password.' },
    { response: { ok: false, json: async () => ({ error: { code: 'PRIVILEGED_LOGIN_REQUIRED' } }) }, expected: 'This account must use its authorized sign-in portal.' },
    { response: { ok: false, json: async () => { throw new Error('HTML proxy error'); } }, expected: 'Login is temporarily unavailable. Please try again.' },
    { response: { ok: true, json: async () => ({ idToken: 'wrong-contract' }) }, expected: 'Login is temporarily unavailable. Please try again.' },
    { network: true, expected: 'We could not reach the authentication service. Please try again.' },
  ];
  for (const scenario of scenarios) {
    const login = loadService('services/usernameAuth.js', {
      AbortController, setTimeout, clearTimeout, getApiUrl: (path) => path,
      fetch: async () => { if (scenario.network) throw new TypeError('fetch failed'); return scenario.response; },
    }, 'loginWithUsername');
    await assert.rejects(login('test_user', 'password'), (error) => getPublicLoginErrorMessage(error) === scenario.expected);
  }
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
    { name: 'approved distributor', role: 'distributor', profile: { approvalStatus: 'approved' }, path: '/distributor/d_dashboard' },
    { name: 'approvalStatus overrides stale legacy status', role: 'distributor', profile: { approvalStatus: 'approved', status: 'Pending' }, path: '/distributor/d_dashboard' },
    { name: 'pending distributor', role: 'distributor', profile: { approvalStatus: 'pending' }, path: '/registration-status' },
    { name: 'rejected distributor', role: 'distributor', profile: { approvalStatus: 'rejected' }, path: '/registration-status' },
    { name: 'unfinished requester', role: 'requester', profile: { registrationCompleted: false }, path: '/registration-status' },
    { name: 'wrong password', error: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' },
    { name: 'admin rejected by backend', error: 'PRIVILEGED_LOGIN_REQUIRED', message: 'This account must use its authorized sign-in portal.' },
    { name: 'manager rejected by backend', error: 'PRIVILEGED_LOGIN_REQUIRED', message: 'This account must use its authorized sign-in portal.' },
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
    const context = {
      auth, db: {}, loading: false, email: scenario.email || 'test_user', password: 'test-password',
      loginInFlight: { current: false }, console: { info: () => {} },
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
      setLoading: () => {}, router: { replace: (path) => events.push(path) },
      showNotification: (_title, message) => events.push(message),
    };
    const run = vm.runInNewContext(`${helpers}\n${submit}\nhandleLogin`, context);
    await run();
    if (scenario.error) {
      assert.deepEqual(events, ['clear', 'backend', scenario.message]);
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
