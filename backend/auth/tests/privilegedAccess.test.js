const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const { hasTrustedRole } = require('../../../services/privilegedAccess');

test('privileged login requires matching trusted claim and Firestore role', () => {
  assert.equal(hasTrustedRole('admin', { admin: true }, { role: 'admin' }), true);
  assert.equal(hasTrustedRole('admin', { admin: true }, { role: 'requester' }), false);
  assert.equal(hasTrustedRole('admin', { manager: true }, { role: 'manager' }), false);
  assert.equal(hasTrustedRole('admin', {}, { role: 'admin' }), false);
  assert.equal(hasTrustedRole('manager', { manager: true }, { role: 'manager' }), true);
  assert.equal(hasTrustedRole('manager', { admin: true }, { role: 'admin' }), false);
});

test('Admin keeps its portal while the legacy Manager login redirects to public login', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const adminLayout = readFileSync(resolve(root, 'app/admin/_layout.jsx'), 'utf8');
  const managerLayout = readFileSync(resolve(root, 'app/manager/_layout.jsx'), 'utf8');
  const managerLogin = readFileSync(resolve(root, 'app/manager/login.jsx'), 'utf8');
  assert.match(adminLayout, /usePathname\(\)/);
  assert.match(adminLayout, /bypass=\{pathname === '\/admin\/login'\}/);
  assert.match(adminLayout, /RoleGate allowedRoles=\{\["admin"\]\}/);
  assert.match(managerLayout, /usePathname\(\)/);
  assert.match(managerLayout, /bypass=\{pathname === '\/manager\/login'\}/);
  assert.match(managerLayout, /RoleGate allowedRoles=\{\["manager"\]\}/);
  assert.match(managerLogin, /Redirect href="\/login"/);
  assert.doesNotMatch(managerLogin, /PrivilegedLogin/);
  assert.equal((adminLayout.match(/<Stack /g) || []).length, 1);
  assert.equal((managerLayout.match(/<Stack /g) || []).length, 1);
});

test('required password change routes every account through a fresh role-based session', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const passwordChangePage = readFileSync(resolve(root, 'app/required-password-change.jsx'), 'utf8');
  assert.match(passwordChangePage, /signInWithEmailAndPassword\(auth, accountEmail, password\)/);
  assert.match(passwordChangePage, /router\.replace\(getPostAuthenticationDestination\(profile\)\)/);
  assert.match(passwordChangePage, /getRoleLoginPath\(completedRole\)/);
});

test('privileged login refreshes its token before reading the Firestore profile', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const login = readFileSync(resolve(root, 'components/PrivilegedLogin.jsx'), 'utf8');
  const refreshIndex = login.indexOf('await user.getIdTokenResult(true)');
  const profileReadIndex = login.indexOf("await getDocFromServer(doc(db, 'users', user.uid))");
  assert.ok(refreshIndex >= 0);
  assert.ok(profileReadIndex > refreshIndex);
  assert.match(login, /ADMIN_TOKEN_REFRESH_FAILED/);
  assert.doesNotMatch(login, /await user\.getIdToken\(true\)[\s\S]*await user\.getIdTokenResult/);
  assert.doesNotMatch(login, /Promise\.all\(\[\s*credential\.user\.getIdTokenResult\(true\)/);
});

test('privileged login replaces stale shared Auth state before authenticating submitted credentials', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const login = readFileSync(resolve(root, 'components/PrivilegedLogin.jsx'), 'utf8');
  const submitIndex = login.indexOf('const submit = async () =>');
  const staleSessionIndex = login.indexOf('if (auth.currentUser)', submitIndex);
  const staleSignOutIndex = login.indexOf('await signOut(auth)', staleSessionIndex);
  const emailSignInIndex = login.indexOf('signInWithEmailAndPassword(auth, normalized, password)', submitIndex);
  const submittedUserIndex = login.indexOf('finishAuthenticatedLogin(credential.user)', submitIndex);
  assert.ok(staleSessionIndex > submitIndex);
  assert.ok(staleSignOutIndex > staleSessionIndex);
  assert.ok(emailSignInIndex > staleSignOutIndex);
  assert.ok(submittedUserIndex > emailSignInIndex);
});

test('privileged login emits only safe authentication stages and preserves Firebase SDK error codes', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const login = readFileSync(resolve(root, 'components/PrivilegedLogin.jsx'), 'utf8');
  for (const stage of [
    'SIGNIN_STARTED', 'SIGNIN_SUCCESS', 'TOKEN_REFRESH_STARTED',
    'TOKEN_REFRESH_FAILED', 'CLAIM_CHECK_STARTED', 'CLAIM_MISSING',
    'PROFILE_CHECK_STARTED', 'PROFILE_CHECK_FAILED', 'ACCESS_GRANTED',
    'STALE_SESSION_CLEAR_FAILED',
  ]) assert.match(login, new RegExp(`'${stage}'`));
  assert.match(login, /safeFirebaseAuthCode\(refreshError/);
  assert.match(login, /code === 'auth\/user-disabled'/);
  assert.match(login, /code === 'auth\/network-request-failed'/);
  assert.match(login, /code === 'auth\/quota-exceeded'/);
  assert.doesNotMatch(login, /console\.(?:log|info|warn|error)\([^\n]*(?:password|idToken|refreshToken)/i);
});

test('privileged route guard validates claims without forcing a second token refresh', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const authSession = readFileSync(resolve(root, 'services/authSession.js'), 'utf8');
  const login = readFileSync(resolve(root, 'components/PrivilegedLogin.jsx'), 'utf8');
  const refreshIndex = authSession.indexOf('await currentUser.getIdTokenResult()');
  const profileReadIndex = authSession.indexOf('profile = await fetchFirestoreUserProfile(currentUser)');
  assert.ok(refreshIndex >= 0);
  assert.ok(profileReadIndex > refreshIndex);
  assert.doesNotMatch(authSession, /currentUser\.getIdTokenResult\(true\)/);
  assert.match(authSession, /getCachedPrivilegedAccess\(currentUser, expected\)/);
  assert.match(login, /cacheValidatedPrivilegedAccess\(profile\)/);
});

test('Manager context uses the current token after privileged validation', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const managerAccess = readFileSync(resolve(root, 'services/managerAccess.js'), 'utf8');
  assert.match(managerAccess, /getIdToken\(\)/);
  assert.doesNotMatch(managerAccess, /getIdToken\(true\)/);
});

test('Admin routes use one canonical dashboard and never redirect into Manager analytics', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const analytics = readFileSync(resolve(root, 'app/admin/analytics.jsx'), 'utf8');
  const authSession = readFileSync(resolve(root, 'services/authSession.js'), 'utf8');
  assert.match(analytics, /Redirect href="\/admin\/dashboard"/);
  assert.doesNotMatch(analytics, /\/manager\/analytics/);
  assert.match(authSession, /admin: '\/admin\/dashboard'/);
});

test('RoleGate validates from Firebase auth once and does not recursively validate its own session writes', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const gate = readFileSync(resolve(root, 'components/RoleGate.jsx'), 'utf8');
  assert.match(gate, /onAuthStateChanged\(auth/);
  assert.doesNotMatch(gate, /subscribeAuthSessionChanges/);
  assert.match(gate, /if \(bypass\) return children/);
  assert.match(gate, /routerRef\.current\.replace/);
  assert.doesNotMatch(gate, /\[allowedRolesKey, router\]/);
});

test('PrivilegedLogin keeps listener completion outside render-scoped effect variables', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const login = readFileSync(resolve(root, 'components/PrivilegedLogin.jsx'), 'utf8');
  assert.doesNotMatch(login, /let checkedExistingSession = false/);
  assert.match(login, /shouldValidateExistingSession\(role, user, submitting\.current\)/);
  assert.match(login, /runPrivilegedLoginValidation\(role, credential\.user/);
  assert.match(login, /completePrivilegedLoginValidation\(role, user\.uid\)[\s\S]*ACCESS_GRANTED/);
  assert.match(login, /VALIDATION_CALLED_FROM_AUTH_LISTENER/);
  assert.match(login, /VALIDATION_CALLED_FROM_LOGIN/);
  assert.match(login, /const routerRef = React\.useRef\(router\)/);
  assert.match(login, /setPendingDestination\('\/admin\/dashboard'\)/);
  assert.doesNotMatch(login, /\}, \[role, router\]\)/);
  assert.doesNotMatch(login, /MANAGER_|Manager Sign In|getManagerContext|\/manager\/dashboard/);
});

test('Admin failures return to Admin login while Manager and public sessions return to public login', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const authSession = readFileSync(resolve(root, 'services/authSession.js'), 'utf8');
  const sessionGuard = readFileSync(resolve(root, 'components/SessionSecurityGuard.jsx'), 'utf8');
  assert.match(authSession, /normalizeRole\(role\) === 'admin' \? '\/admin\/login' : '\/login'/);
  assert.doesNotMatch(authSession, /\/manager\/login/);
  assert.match(sessionGuard, /getRoleLoginPath\(role\)/);
  assert.doesNotMatch(sessionGuard, /\/manager\/login/);
  assert.match(authSession, /status: 'token-refresh-failed'/);
});

test('trusted Admin bootstrap revokes stale refresh tokens after updating claims', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const bootstrap = readFileSync(resolve(root, 'scripts/bootstrap-admin.js'), 'utf8');
  assert.match(bootstrap, /setCustomUserClaims/);
  assert.match(bootstrap, /role: 'admin'/);
  assert.match(bootstrap, /revokeRefreshTokens\(user\.uid\)/);
});
