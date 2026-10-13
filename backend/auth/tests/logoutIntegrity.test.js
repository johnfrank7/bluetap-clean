const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const filename = resolve(__dirname, '../../../services/authSession.js');
const code = babel.transformSync(readFileSync(filename, 'utf8'), {
  filename, configFile: false, babelrc: false,
  plugins: ['@babel/plugin-transform-modules-commonjs'],
}).code;

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function fixture(role = 'requester', options = {}) {
  const storage = options.storage || new Map();
  const profile = {
    role, accountStatus: 'active', registrationCompleted: true,
    distributorStatus: 'active', branchId: 'branch-a',
    faceVerification: { status: 'not_required', required: false },
    ...options.profile,
  };
  const user = {
    uid: 'user-1', email: 'user@example.test', emailVerified: true,
    getIdTokenResult: async () => ({ claims: { [role]: true, role } }),
  };
  const auth = { currentUser: options.signedOut ? null : user, authStateReady: async () => {} };
  const counts = { signOut: 0, cleared: 0, removed: [], removedProfiles: [], cached: 0 };
  const exports = {};
  const sandbox = {
    exports, console, Date, Map, Event,
    __bluetapClearRequesterProfileCache: (uid) => counts.removedProfiles.push(uid),
    ...(options.broadcastBus ? { BroadcastChannel: class {
      constructor(name) { this.name = name; options.broadcastBus.push(this); }
      postMessage(data) {
        for (const channel of options.broadcastBus) {
          if (channel !== this && channel.name === this.name) channel.onmessage?.({ data });
        }
      }
    } } : {}),
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    require(name) {
      if (name === 'firebase/auth') return { signOut: async () => {
        counts.signOut++;
        if (options.signOutGate) await options.signOutGate.promise;
        if (options.signOutError) throw options.signOutError;
        auth.currentUser = null;
      } };
      if (name === 'firebase/firestore') return {
        doc: (_, collection, uid) => `${collection}/${uid}`,
        getDocFromServer: async () => {
          if (options.profileGate) await options.profileGate.promise;
          return { exists: () => true, data: () => profile };
        },
      };
      if (name === '../firebase') return { auth, db: {} };
      if (name === '../localUsers') return { saveLocalUser: () => {}, removeLocalUser: (uid) => counts.removed.push(uid) };
      if (name === './faceVerification') return { isFaceVerified: () => true, normalizeFaceVerification: (data) => data.faceVerification };
      if (name === './managerAccess') return { getManagerContext: async () => ({ manager: { branchId: 'branch-a' }, branch: { name: 'Branch A' } }) };
      if (name === './adminDataCache') return { clearAdminDataCache: () => counts.cleared++ };
      if (name === './requests') return { clearRequesterRequestCache: () => counts.cached++ };
      if (name === './distributorOrders') return { clearAssignedDistributorOrdersCache: () => counts.cached++ };
      if (name === './distributorProfile') return { clearDistributorProfileCache: () => counts.cached++ };
      if (name === './performanceLog') return { logDevelopmentTiming: () => {} };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(code, sandbox, { filename });
  return { service: exports, auth, user, profile, counts, storage };
}

for (const role of ['requester', 'distributor', 'manager', 'admin']) {
  test(`${role} logout clears Firebase identity, role session, and account caches`, async () => {
    const f = fixture(role);
    assert.equal((await f.service.validateRoleAccess(role)).status, 'authorized');
    assert.equal(f.service.getModuleSession(role).uid, f.user.uid);
    await f.service.signOutAndClearSessions();
    assert.equal(f.auth.currentUser, null);
    assert.equal(f.service.getModuleSession(role), null);
    assert.equal((await f.service.validateRoleAccess(role)).status, 'unauthenticated');
    assert.equal(f.counts.signOut, 1);
    assert.deepEqual(f.counts.removed, ['user-1']);
    assert.deepEqual(f.counts.removedProfiles, ['user-1']);
    assert.equal(f.counts.cached, 3);
  });
}

test('duplicate logout shares one Firebase sign-out and browser Back cannot authorize', async () => {
  const gate = deferred();
  const f = fixture('requester', { signOutGate: gate });
  const first = f.service.signOutAndClearSessions();
  const second = f.service.signOutAndClearSessions();
  assert.equal(first, second);
  assert.equal(f.counts.signOut, 1);
  assert.equal(f.service.isLogoutInProgress(), true);
  gate.resolve();
  await first;
  assert.equal((await f.service.validateRoleAccess('requester')).status, 'unauthenticated');
});

test('refresh after logout does not restore a local role session', async () => {
  const f = fixture('distributor');
  await f.service.validateRoleAccess('distributor');
  await f.service.signOutAndClearSessions();
  const refreshed = fixture('distributor', { storage: f.storage, signedOut: true });
  assert.equal(refreshed.service.getModuleSession('distributor'), null);
  assert.equal((await refreshed.service.validateRoleAccess('distributor')).status, 'unauthenticated');
});

test('valid session remains authorized, wrong role preserves it, and a new Firebase sign-in is accepted', async () => {
  const f = fixture('manager');
  assert.equal((await f.service.validateRoleAccess('manager')).status, 'authorized');
  const mismatch = await f.service.validateRoleAccess('requester');
  assert.equal(mismatch.status, 'role-mismatch');
  assert.equal(mismatch.shouldSignOut, false);
  assert.equal(f.auth.currentUser.uid, f.user.uid);
  await f.service.signOutAndClearSessions();
  f.auth.currentUser = f.user; // A new Firebase credential sign-in establishes this identity.
  assert.equal((await f.service.validateRoleAccess('manager')).status, 'authorized');
});

test('disabled account is denied despite a valid Firebase identity', async () => {
  const f = fixture('requester', { profile: { accountStatus: 'suspended' } });
  const result = await f.service.validateRoleAccess('requester');
  assert.equal(result.status, 'account-suspended');
  assert.equal(result.shouldSignOut, true);
  assert.equal(f.service.getModuleSession('requester'), null);
});

test('late profile validation cannot recreate an explicitly logged-out session', async () => {
  const profileGate = deferred();
  const f = fixture('requester', { profileGate });
  const validation = f.service.validateRoleAccess('requester');
  await f.service.signOutAndClearSessions();
  profileGate.resolve();
  assert.equal((await validation).status, 'unauthenticated');
  assert.equal(f.service.getModuleSession('requester'), null);
});

test('failed Firebase sign-out rejects and never reports logout success', async () => {
  const f = fixture('admin', { signOutError: new Error('persistence unavailable') });
  await assert.rejects(f.service.signOutAndClearSessions(), /persistence unavailable/);
  assert.equal(f.auth.currentUser.uid, f.user.uid);
  assert.equal(f.service.isLogoutInProgress(), false);
});

test('logout propagates to an already open tab with the same Firebase account', async () => {
  const bus = [];
  const first = fixture('requester', { broadcastBus: bus });
  const second = fixture('requester', { broadcastBus: bus });
  await first.service.signOutAndClearSessions();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(first.auth.currentUser, null);
  assert.equal(second.auth.currentUser, null);
  assert.equal(first.counts.signOut, 1);
  assert.equal(second.counts.signOut, 1);
});
