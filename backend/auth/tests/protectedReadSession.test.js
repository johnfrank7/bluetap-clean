const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const readiness = require('../../../services/protectedReadReadiness');

function fixture() {
  let authCallback, profileCallback;
  const branchCallbacks = [];
  const auth = { currentUser: null };
  const counts = { auth: 0, profile: 0, branch: 0, stopped: 0 };
  const exports = {};
  const filename = path.resolve(__dirname, '../../../services/useProtectedReadSession.js');
  const source = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === './protectedReadReadiness') return readiness;
    if (name === '../firebase') return { auth, db: {} };
    if (name === 'firebase/auth') return { onIdTokenChanged(_, callback) { counts.auth++; authCallback = callback; return () => counts.stopped++; } };
    if (name === './distributorProfile') return { subscribeDistributorProfile(_, callback) { counts.profile++; profileCallback = callback; return () => counts.stopped++; } };
    if (name === 'firebase/firestore') return { doc: (_, collection, id) => `${collection}/${id}`, onSnapshot(ref, options, callback) { counts.branch++; branchCallbacks.push(callback); return () => counts.stopped++; } };
    return {};
  } });
  return { counts, exports, branchCallbacks, async signIn(uid) { auth.currentUser = uid ? { uid, getIdTokenResult: async () => ({ claims: { manager: true } }) } : null; await authCallback(auth.currentUser); }, profile(profile) { profileCallback({ profile, loading: false, error: '' }); } };
}

test('Requester cold session deduplicates consumers, waits for profile, and clears identity on logout', async () => {
  const f = fixture(); let state;
  const stopA = f.exports.subscribeProtectedReadSession('requester', (value) => { state = value; });
  const stopB = f.exports.subscribeProtectedReadSession('requester', () => {});
  assert.equal(f.counts.auth, 1);
  await f.signIn('r1');
  assert.equal(readiness.protectedReadReadiness({ ...state, role: 'requester' }), 'PROFILE_PENDING');
  f.profile({ uid: 'r1', role: 'requester' });
  assert.equal(readiness.protectedReadReadiness({ ...state, role: 'requester' }), 'READY');
  await f.signIn(null);
  assert.equal(state.profile, null);
  assert.equal(state.uid, '');
  stopA(); stopB();
  assert.ok(f.counts.stopped >= 2);
});

test('Manager branch changes ignore late old-branch snapshots and cached branch data', async () => {
  const f = fixture(); let state;
  const stop = f.exports.subscribeProtectedReadSession('manager', (value) => { state = value; });
  await f.signIn('m1');
  f.profile({ uid: 'm1', role: 'manager', managerStatus: 'active', branchId: 'a' });
  const snapshot = (id, fromCache = false) => ({ id, metadata: { fromCache }, exists: () => true, data: () => ({ status: 'active' }) });
  f.branchCallbacks[0](snapshot('a', true));
  assert.equal(readiness.protectedReadReadiness({ ...state, role: 'manager' }), 'BRANCH_PENDING');
  f.branchCallbacks[0](snapshot('a'));
  assert.equal(readiness.protectedReadReadiness({ ...state, role: 'manager' }), 'READY');
  f.profile({ uid: 'm1', role: 'manager', managerStatus: 'active', branchId: 'b' });
  f.branchCallbacks[0](snapshot('a'));
  assert.equal(state.branch, null);
  f.branchCallbacks[1](snapshot('b'));
  assert.equal(readiness.protectedReadReadiness({ ...state, role: 'manager' }), 'READY');
  stop();
});
