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

test('Admin and Manager login routes bypass only their login screen while dashboards retain RoleGate', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const adminLayout = readFileSync(resolve(root, 'app/admin/_layout.jsx'), 'utf8');
  const managerLayout = readFileSync(resolve(root, 'app/manager/_layout.jsx'), 'utf8');
  assert.match(adminLayout, /segments\[segments\.length - 1\] === 'login'/);
  assert.match(adminLayout, /RoleGate allowedRoles=\{\["admin"\]\}/);
  assert.match(managerLayout, /segments\[segments\.length - 1\] === 'login'/);
  assert.match(managerLayout, /RoleGate allowedRoles=\{\["manager"\]\}/);
});

test('required Admin password change returns to Admin authentication and never the public login', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const passwordChangePage = readFileSync(resolve(root, 'app/required-password-change.jsx'), 'utf8');
  assert.match(passwordChangePage, /signInWithEmailAndPassword\(auth, adminEmail, password\)/);
  assert.match(passwordChangePage, /router\.replace\('\/admin\/dashboard'\)/);
  assert.match(passwordChangePage, /router\.replace\('\/admin\/login\?passwordChanged=true'\)/);
  assert.doesNotMatch(passwordChangePage, /router\.replace\('\/login\?passwordChanged=true'\)/);
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

test('privileged route guard refreshes and validates claims before profile access', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const authSession = readFileSync(resolve(root, 'services/authSession.js'), 'utf8');
  const refreshIndex = authSession.indexOf('await currentUser.getIdTokenResult(true)');
  const profileReadIndex = authSession.indexOf('profile = await fetchFirestoreUserProfile(currentUser)');
  assert.ok(refreshIndex >= 0);
  assert.ok(profileReadIndex > refreshIndex);
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
});

test('privileged auth failures return to their own portal without a cross-role loop', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const authSession = readFileSync(resolve(root, 'services/authSession.js'), 'utf8');
  assert.match(authSession, /expected === 'admin' \? '\/admin\/login' : expected === 'manager' \? '\/manager\/login' : '\/login'/);
  assert.match(authSession, /status: 'token-refresh-failed'/);
});

test('trusted Admin bootstrap revokes stale refresh tokens after updating claims', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const bootstrap = readFileSync(resolve(root, 'scripts/bootstrap-admin.js'), 'utf8');
  assert.match(bootstrap, /setCustomUserClaims/);
  assert.match(bootstrap, /role: 'admin'/);
  assert.match(bootstrap, /revokeRefreshTokens\(user\.uid\)/);
});
