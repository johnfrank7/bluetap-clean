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
