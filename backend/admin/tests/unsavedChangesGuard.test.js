const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const guardHook = read('components/useUnsavedChangesGuard.js');
const unsavedModal = read('components/UnsavedChangesModal.jsx');
const requesterOrder = read('app/requester/requestform.jsx');
const requesterEditOrder = read('components/RequesterEditOrderModal.jsx');
const requesterProfile = read('app/requester/r_profile.jsx');
const distributorProfile = read('app/distributor/d_profile.jsx');
const adminManagers = read('app/admin/managers.jsx');
const adminBranches = read('app/admin/branches.jsx');
const adminProducts = read('app/admin/products.jsx');
const adminSecurity = read('app/admin/registration-security.jsx');
const managerProducts = read('app/manager/products.jsx');
const managerProfile = read('app/manager/profile.jsx');
const signup = read('app/signup.jsx');

test('useUnsavedChangesGuard and UnsavedChangesModal provide standardized actions and browser interception', () => {
  assert.match(unsavedModal, /Discard Changes and Leave/);
  assert.match(unsavedModal, /Keep Editing/);
  assert.match(guardHook, /popstate/);
  assert.match(guardHook, /isDirtyRef\.current = false/);
  assert.match(guardHook, /onContinueEditing/);
  assert.match(guardHook, /confirmLeave/);
});

test('Requester Order Form and Edit Order Modal protect against unsaved draft loss', () => {
  assert.match(requesterOrder, /useUnsavedChangesGuard/);
  assert.match(requesterOrder, /items\.length > 0/);
  assert.match(requesterOrder, /selectedBranchId/);
  assert.match(requesterOrder, /confirmLeave/);
  assert.match(requesterOrder, /<UnsavedModal \/>/);

  assert.match(requesterEditOrder, /useUnsavedChangesGuard/);
  assert.match(requesterEditOrder, /confirmLeave/);
  assert.match(requesterEditOrder, /<UnsavedModal \/>/);
});

test('Requester and Distributor Profiles guard unsaved profile edits without blocking clean navigation', () => {
  assert.match(requesterProfile, /useUnsavedChangesGuard/);
  assert.match(requesterProfile, /editingProfile/);
  assert.match(requesterProfile, /confirmLeave/);
  assert.match(requesterProfile, /<UnsavedModal \/>/);

  assert.match(distributorProfile, /useUnsavedChangesGuard/);
  assert.match(distributorProfile, /editingProfile/);
  assert.match(distributorProfile, /confirmLeave/);
  assert.match(distributorProfile, /<UnsavedModal \/>/);
});

test('Admin Accounts, Branches, and Products guard create and edit workflows', () => {
  assert.match(adminManagers, /useUnsavedChangesGuard/);
  assert.match(adminManagers, /confirmLeave/);
  assert.match(adminBranches, /useUnsavedChangesGuard/);
  assert.match(adminBranches, /confirmLeave/);
  assert.match(adminProducts, /useUnsavedChangesGuard/);
  assert.match(adminProducts, /confirmLeave/);
  assert.match(adminProducts, /<UnsavedModal \/>/);
});

test('Registration flow guards external exits without breaking internal wizard stepper navigation', () => {
  assert.match(signup, /useUnsavedChangesGuard/);
  assert.match(signup, /isDirty/);
  assert.match(signup, /if \(step === STEP\.account\) confirmLeave/);
  assert.match(signup, /transitionToStep\(adjacentRegistrationStep/);
  assert.match(signup, /<UnsavedModal \/>/);
});

test('Manager Pricing and Profile retain unsaved changes protection', () => {
  assert.match(managerProducts, /useUnsavedChangesGuard/);
  assert.match(managerProfile, /useUnsavedChangesGuard/);
  assert.match(adminSecurity, /useUnsavedChangesGuard/);
});
