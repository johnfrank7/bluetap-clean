const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const {
  CANONICAL_USERNAME,
  EXPECTED_PROJECT,
  isProvenAdmin,
  normalizeEmail,
  normalizeUsername,
} = require('../../../scripts/reset-super-admin');

test('Super Admin reset is pinned to the BlueTap project and canonical username', () => {
  assert.equal(EXPECTED_PROJECT, 'bluetap-8c98d');
  assert.equal(CANONICAL_USERNAME, 'bluetapadmin');
  assert.equal(normalizeEmail(' Admin@Example.COM '), 'admin@example.com');
  assert.equal(normalizeUsername(' BlueTapAdmin '), 'bluetapadmin');
});

test('only matching Auth claims and an Admin profile prove a resettable Admin identity', () => {
  assert.equal(isProvenAdmin({ customClaims: { admin: true } }, { role: 'admin' }), true);
  assert.equal(isProvenAdmin({ customClaims: { role: 'admin' } }, { role: 'admin' }), true);
  assert.equal(isProvenAdmin({ customClaims: { manager: true } }, { role: 'manager' }), false);
  assert.equal(isProvenAdmin({ customClaims: {} }, { role: 'requester' }), false);
  assert.equal(isProvenAdmin({ customClaims: { admin: true } }, { role: 'distributor' }), false);
});

test('reset script is interactive, password-safe, narrowly scoped, and verifies convergence', () => {
  const script = readFileSync(resolve(__dirname, '../../../scripts/reset-super-admin.js'), 'utf8');
  assert.match(script, /FIREBASE_SERVICE_ACCOUNT_PATH/);
  assert.match(script, /project_id !== EXPECTED_PROJECT/);
  assert.match(script, /setRawMode\(true\)/);
  assert.match(script, /setCustomUserClaims\(adminUser\.uid, \{ role: 'admin', admin: true \}\)/);
  assert.match(script, /verifiedUsername\.data\(\)\?\.uid !== adminUser\.uid/);
  assert.match(script, /Refusing reset: the selected email belongs to an account not proven to be Admin/);
  assert.doesNotMatch(script, /branches|products|requests|registrationLimits/);
  assert.doesNotMatch(script, /const\s+(?:email|password)\s*=\s*['"][^'"]+['"]/);
});

test('successful Admin navigation has one forced refresh and a cached canonical landing route', () => {
  const root = resolve(__dirname, '../../..');
  const login = readFileSync(resolve(root, 'components/PrivilegedLogin.jsx'), 'utf8');
  const sessions = readFileSync(resolve(root, 'services/authSession.js'), 'utf8');
  const forcedRefreshes = `${login}\n${sessions}`.match(/await\s+\w+\.getIdTokenResult\(true\)/g) || [];
  assert.equal(forcedRefreshes.length, 1);
  assert.match(login, /router\.replace\(admin \? '\/admin\/dashboard'/);
  assert.match(sessions, /admin: '\/admin\/dashboard'/);
  assert.match(sessions, /return \{ status: 'authorized', profile: cachedPrivilegedProfile, cached: true \}/);
});
