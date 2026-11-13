const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
};
function sessionFunctions(context) {
  const source = read('services/authSession.js')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace(/export const /g, 'const ')
    .replace(/^export \{[^}]+\};\r?\n/gm, '');
  return vm.runInNewContext(`${source}\n({ getPostAuthenticationDestination, getCanonicalAccountStatus, recheckPendingEmailVerification, validateRoleAccess })`, context);
}
function profileFor(role, overrides = {}) {
  return { uid: 'account', email: 'test@example.test', role, accountStatus: 'active',
    emailVerificationRequired: true, emailVerified: true, registrationCompleted: true,
    emailOtpVerification: { status: 'verified', profileSynced: true },
    faceVerification: { required: false, status: 'not_required' },
    distributorStatus: 'active', managerStatus: 'active', branchId: 'branch', ...overrides };
}
function entryHarness({ role = 'requester', verified = true, profile = profileFor(role), reloadImpl = async () => {}, fetchImpl, rootReady = true } = {}) {
  const events = [];
  const account = { uid: 'account', email: 'test@example.test', emailVerified: verified,
    getIdToken: async (force) => { events.push(`token:${force}`); return 'mock-token'; } };
  const auth = { currentUser: account };
  const session = sessionFunctions({ auth });
  const page = read('app/email-verification.jsx');
  const start = page.indexOf('  React.useEffect(() => {\r\n    if (registration) {\r\n      if (registrationCompletedRef.current) return;');
  const end = page.indexOf('  const changeOtp = (value) => {', start);
  assert.ok(start >= 0 && end > start);
  let listener;
  const context = {
    React: { useEffect: (fn) => { fn(); } }, registration: false,
    auth, params: {}, router: { replace: (path) => events.push(`route:${path}`) },
    unavailableRoute: null, registrationSteps: [], entryAttempt: 0,
    rootNavigationState: rootReady ? { key: 'root' } : {},
    onAuthStateChanged: (_auth, callback) => { listener = callback; return () => {}; },
    reload: reloadImpl, fetchFirestoreUserProfile: fetchImpl || (async () => profile),
    getCanonicalAccountStatus: session.getCanonicalAccountStatus,
    getPostAuthenticationDestination: session.getPostAuthenticationDestination,
    setLoading: (value) => events.push(`loading:${value}`),
    setEntryError: (value) => events.push(`error:${value}`),
    setUser: () => {},
  };
  vm.runInNewContext(page.slice(start, end), context);
  return { account, auth, events, run: () => listener(account), page };
}

test('verification entry waits for Auth and profile, then routes verified accounts of each role', async () => {
  for (const [role, home] of [['requester', '/requester/r_dashboard'], ['distributor', '/distributor/d_dashboard'], ['manager', '/manager/dashboard']]) {
    const pending = deferred();
    const h = entryHarness({ role, fetchImpl: () => pending.promise });
    const run = h.run();
    await Promise.resolve();
    assert.equal(h.events.includes('loading:false'), false);
    assert.equal(h.events.some((event) => event.startsWith('route:')), false);
    pending.resolve(profileFor(role));
    await run;
    assert.equal(h.events.includes(`route:${home}`), true);
    assert.equal(h.events.includes('loading:false'), false);
    assert.doesNotMatch(h.page, /automaticRequestRef/);
  }
  const refreshed = entryHarness({ verified: false, reloadImpl: async (account) => { account.emailVerified = true; } });
  await refreshed.run();
  assert.equal(refreshed.events.includes('token:true'), true);
  assert.equal(refreshed.events.includes('route:/requester/r_dashboard'), true);
});

test('verification entry fails closed for required OTP, password change, account holds, failed reads and stale sessions', async () => {
  const required = entryHarness({ verified: false, profile: profileFor('requester', { emailVerified: false }) });
  await required.run();
  assert.equal(required.events.includes('loading:false'), true);
  assert.equal(required.events.some((event) => event.startsWith('route:')), false);
  for (const role of ['manager', 'distributor']) {
    const firstLogin = entryHarness({ role, verified: false, profile: profileFor(role, { mustChangePassword: true, emailVerified: false }) });
    await firstLogin.run();
    assert.equal(firstLogin.events.includes('route:/required-password-change'), true);
  }
  const held = entryHarness({ profile: profileFor('requester', { accountActionHoldIntentId: 'hold' }) });
  await held.run();
  assert.equal(held.events.some((event) => event.includes('account is not available')), true);
  assert.equal(held.events.some((event) => event.startsWith('route:')), false);
  const failed = entryHarness({ fetchImpl: async () => { throw new Error('offline'); } });
  await failed.run();
  assert.equal(failed.events.some((event) => event.includes('could not be checked')), true);
  assert.equal(failed.events.some((event) => event.startsWith('route:')), false);
  const pending = deferred();
  const stale = entryHarness({ fetchImpl: () => pending.promise });
  const staleRun = stale.run();
  await Promise.resolve();
  stale.auth.currentUser = { uid: 'other' };
  pending.resolve(profileFor('requester'));
  await staleRun;
  assert.equal(stale.events.some((event) => event.startsWith('route:')), false);
  assert.equal(stale.events.includes('loading:false'), false);
  const waiting = entryHarness({ rootReady: false });
  await waiting.run();
  assert.equal(waiting.events.some((event) => event.startsWith('route:')), false);
  assert.equal(waiting.events.includes('loading:false'), false);
});

test('RoleGate rechecks pending verification before routing and fails closed on errors', async () => {
  for (const role of ['requester', 'distributor', 'manager']) {
    const user = { uid: 'account', email: 'test@example.test', emailVerified: false,
      getIdToken: async () => 'mock-token', getIdTokenResult: async () => ({ claims: { manager: true } }) };
    const auth = { currentUser: user };
    let reads = 0;
    const session = sessionFunctions({ auth, db: {}, doc: () => ({}),
      getDocFromServer: async () => { const value = profileFor(role, reads++ === 0 ? { emailVerified: false } : {}); return { exists: () => true, data: () => value }; },
      reload: async (account) => { account.emailVerified = true; },
      normalizeFaceVerification: (p) => p.faceVerification, isFaceVerified: () => true,
      saveLocalUser: () => {}, clearAdminDataCache: () => {}, logDevelopmentTiming: () => {},
      getManagerContext: async () => ({ manager: {}, branch: { name: 'Test' } }), signOut: async () => {},
    });
    assert.equal((await session.validateRoleAccess(role)).status, 'authorized');
    assert.equal(reads, 2);
  }
  const user = { uid: 'account', email: 'test@example.test', emailVerified: false };
  const auth = { currentUser: user };
  const session = sessionFunctions({ auth, db: {}, doc: () => ({}),
    getDocFromServer: async () => ({ exists: () => true, data: () => profileFor('requester', { emailVerified: false }) }),
    reload: async () => { throw new Error('offline'); }, normalizeFaceVerification: (p) => p.faceVerification,
    isFaceVerified: () => true, saveLocalUser: () => {}, clearAdminDataCache: () => {}, logDevelopmentTiming: () => {},
  });
  const failed = await session.validateRoleAccess('requester');
  assert.equal(failed.status, 'verification-check-failed');
  assert.notEqual(failed.redirectTo, '/email-verification');
  assert.equal(failed.shouldSignOut, false);

  const pendingUser = { uid: 'account', email: 'test@example.test', emailVerified: false };
  const pendingAuth = { currentUser: pendingUser };
  const pendingSession = sessionFunctions({ auth: pendingAuth, db: {}, doc: () => ({}),
    getDocFromServer: async () => ({ exists: () => true, data: () => profileFor('requester', { emailVerified: false }) }),
    reload: async () => {}, normalizeFaceVerification: (p) => p.faceVerification,
    isFaceVerified: () => true, saveLocalUser: () => {}, clearAdminDataCache: () => {}, logDevelopmentTiming: () => {},
  });
  const pendingResult = await pendingSession.validateRoleAccess('requester');
  assert.equal(pendingResult.status, 'email-unverified');
  assert.equal(pendingResult.redirectTo, '/email-verification');

  let holdReloads = 0;
  const heldSession = sessionFunctions({ auth: pendingAuth, db: {}, doc: () => ({}),
    getDocFromServer: async () => ({ exists: () => true, data: () => profileFor('requester', { emailVerified: false, accountActionHoldIntentId: 'hold' }) }),
    reload: async () => { holdReloads += 1; }, normalizeFaceVerification: (p) => p.faceVerification,
    saveLocalUser: () => {}, clearAdminDataCache: () => {}, logDevelopmentTiming: () => {},
  });
  assert.equal((await heldSession.validateRoleAccess('requester')).status, 'account-pending');
  assert.equal(holdReloads, 0);
});

test('an earlier existing-session lookup cannot redirect after a new login starts', async () => {
  const page = read('app/login.jsx');
  const start = page.indexOf('  React.useEffect(() => {\r\n    let cancelled = false;\r\n    const checkActiveSession');
  const end = page.indexOf('  const clearFocusScrollTimeout', start);
  assert.ok(start >= 0 && end > start);
  const pending = deferred();
  const routes = [];
  const auth = { currentUser: { uid: 'old-account' } };
  const loginInFlight = { current: false };
  const context = { React: { useEffect: (fn) => { fn(); } }, auth, loginInFlight,
    loginSucceeded: { current: false }, fetchFirestoreUserProfile: () => pending.promise,
    getPostAuthenticationDestination: () => '/email-verification', router: { replace: (path) => routes.push(path) } };
  vm.runInNewContext(page.slice(start, end), context);
  loginInFlight.current = true;
  pending.resolve({ role: 'requester' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(routes, []);
});

test('public login waits for a pending verification recheck before choosing its route', async () => {
  const page = read('app/login.jsx');
  const helpers = page.slice(page.indexOf('const normalizeApprovalStatus'), page.indexOf('const BASE_SCROLL_PADDING_BOTTOM'));
  const submit = page.slice(page.indexOf('  const finishSuccessfulLogin'), page.indexOf('  const confirmRestartIncompleteRegistration'));
  for (const role of ['requester', 'distributor', 'manager']) {
    for (const scenario of ['verified-after-reload', 'required', 'read-failed', 'password-required']) {
      const events = [];
      const user = { uid: 'account', email: 'test@example.test', emailVerified: false,
        getIdToken: async () => 'mock-token' };
      const auth = { currentUser: null };
      const inputProfile = profileFor(role, { emailVerified: false, mustChangePassword: scenario === 'password-required' });
      const authoritative = profileFor(role, { emailVerified: scenario === 'verified-after-reload' });
      const session = sessionFunctions({ auth, db: {}, doc: () => ({}),
        reload: async (account) => {
          if (scenario === 'read-failed') throw new Error('offline');
          if (scenario === 'verified-after-reload') account.emailVerified = true;
        },
        getDocFromServer: async () => ({ exists: () => true, data: () => authoritative }),
        normalizeFaceVerification: (p) => p.faceVerification, isFaceVerified: () => true,
        saveLocalUser: () => {}, clearAdminDataCache: () => {}, logDevelopmentTiming: () => {},
      });
      const context = { auth, loading: false, email: 'test_user', password: 'test-password',
        loginInFlight: { current: false }, loginRequestId: { current: 0 }, loginSucceeded: { current: false },
        console: { info: () => {}, warn: () => {} }, setLoading: () => {}, setLoginConnecting: () => {},
        clearAllAuthSessions: () => {}, saveLocalUser: () => {}, saveRoleSession: () => {},
        loginWithUsernameResult: async () => ({ customToken: 'mock-token', profile: inputProfile }),
        signInWithCustomToken: async () => { auth.currentUser = user; return { user }; },
        signOut: async () => { events.push('signout'); auth.currentUser = null; },
        recheckPendingEmailVerification: session.recheckPendingEmailVerification,
        getPostAuthenticationDestination: session.getPostAuthenticationDestination,
        router: { replace: (path) => events.push(`route:${path}`) },
        showNotification: (title) => events.push(`notice:${title}`),
        getPublicLoginErrorMessage: () => 'Login failed',
      };
      const login = vm.runInNewContext(`${helpers}\n${submit}\nhandleLogin`, context);
      await login();
      if (scenario === 'verified-after-reload') {
        const home = role === 'requester' ? '/requester/r_dashboard' : role === 'distributor' ? '/distributor/d_dashboard' : '/manager/dashboard';
        assert.equal(events.includes(`route:${home}`), true);
        assert.equal(events.includes('route:/email-verification'), false);
      } else if (scenario === 'required') {
        assert.equal(events.includes('route:/email-verification'), true);
      } else if (scenario === 'password-required') {
        assert.equal(events.includes('route:/required-password-change'), true);
      } else {
        assert.equal(events.includes('notice:Account check unavailable'), true);
        assert.equal(events.some((event) => event.startsWith('route:')), false);
        assert.equal(events.includes('signout'), false);
      }
    }
  }
});

test('public login ignores a verification result if the active account changes during the check', async () => {
  const page = read('app/login.jsx');
  const helpers = page.slice(page.indexOf('const normalizeApprovalStatus'), page.indexOf('const BASE_SCROLL_PADDING_BOTTOM'));
  const submit = page.slice(page.indexOf('  const finishSuccessfulLogin'), page.indexOf('  const confirmRestartIncompleteRegistration'));
  const pending = deferred();
  const events = [];
  const user = { uid: 'account', email: 'test@example.test', emailVerified: false };
  const auth = { currentUser: null };
  const profile = profileFor('requester', { emailVerified: false });
  const context = { auth, loading: false, email: 'test_user', password: 'test-password',
    loginInFlight: { current: false }, loginRequestId: { current: 0 }, loginSucceeded: { current: false },
    console: { info: () => {}, warn: () => {} }, setLoading: () => {}, setLoginConnecting: () => {},
    clearAllAuthSessions: () => {}, saveLocalUser: () => events.push('save'), saveRoleSession: () => {},
    loginWithUsernameResult: async () => ({ customToken: 'mock-token', profile }),
    signInWithCustomToken: async () => { auth.currentUser = user; return { user }; },
    signOut: async () => events.push('signout'),
    recheckPendingEmailVerification: () => pending.promise,
    getPostAuthenticationDestination: () => '/requester/r_dashboard',
    router: { replace: (path) => events.push(`route:${path}`) },
    showNotification: () => {}, getPublicLoginErrorMessage: () => 'Login failed',
  };
  const login = vm.runInNewContext(`${helpers}\n${submit}\nhandleLogin`, context);
  const run = login();
  await new Promise((resolve) => setImmediate(resolve));
  auth.currentUser = { uid: 'different-account' };
  pending.resolve(profile);
  await run;
  assert.deepEqual(events, []);
});
