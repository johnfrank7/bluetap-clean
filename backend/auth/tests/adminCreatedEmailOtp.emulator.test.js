const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const { initializeApp: initializeClientApp, deleteApp: deleteClientApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut, reload } = require('firebase/auth');
const {
  getFirestore: getClientFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  updateDoc,
  terminate,
} = require('firebase/firestore');
const { createEmailOtpService } = require('../emailOtp');
const { requireRequester, requireActiveDistributor, requireActiveManager } = require('../authorization');

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = 'demo-bluetap';
const repoRoot = resolve(__dirname, '../../..');

function loadAuthSessionHarness(context) {
  const source = readFileSync(resolve(repoRoot, 'services/authSession.js'), 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace(/export const /g, 'const ')
    .replace(/^export \{[^}]+\};\r?\n/gm, '');
  return vm.runInNewContext(
    `${source}\n({ getPostAuthenticationDestination, validateRoleAccess, isOperationalEmailVerificationPending })`,
    { reload, ...context }
  );
}

test('Admin-created account completes real Auth emulator email verification before Requester access',
  { skip: !firestoreHost || !authHost || process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId }, async () => {
    const suffix = randomUUID();
    const uid = `created-otp-${suffix}`;
    const email = `${uid}@example.test`;
    const app = initializeAdminApp({ projectId }, `otp-admin-${suffix}`);
    const clientApp = initializeClientApp({ apiKey: 'demo-key', authDomain: 'demo-bluetap.firebaseapp.com', projectId }, `otp-client-${suffix}`);
    const auth = getAdminAuth(app);
    const db = getFirestore(app);
    const clientAuth = getAuth(clientApp);
    connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });
    try {
      await auth.createUser({ uid, email, emailVerified: false, password: 'SafePassword2026' });
      await db.collection('users').doc(uid).set({ role: 'requester', accountStatus: 'active',
        accountSource: 'admin_created', emailVerificationRequired: true, emailVerified: false, email,
        emailOtpVerification: { status: 'reconciliation-failed', profileSynced: false } });
      const credential = await signInWithEmailAndPassword(clientAuth, email, 'SafePassword2026');
      const request = async () => ({ headers: { authorization: `Bearer ${await credential.user.getIdToken(true)}` } });
      await assert.rejects(requireRequester(await request(), auth, db),
        (error) => error.reason === 'EMAIL_VERIFICATION_REQUIRED');

      let sentCode = '';
      let nowMs = Date.now();
      const service = createEmailOtpService({ auth, db, hashSecret: 'emulator-only-otp-secret',
        now: () => nowMs,
        sendEmailOtp: async ({ recipient, code }) => { assert.equal(recipient, email); sentCode = code; } });
      const issued = await service.request(uid);
      assert.ok(issued.expiresAt);
      assert.match(sentCode, /^\d{6}$/);
      assert.equal((await auth.getUser(uid)).emailVerified, false);
      assert.deepEqual(await service.verify(uid, sentCode), { verified: true });
      assert.equal((await auth.getUser(uid)).emailVerified, true);
      const syncedProfile = (await db.collection('users').doc(uid).get()).data();
      assert.equal(syncedProfile.emailVerified, true);
      assert.equal(syncedProfile.emailOtpVerification?.status, 'verified');
      assert.equal(syncedProfile.emailOtpVerification?.profileSynced, true);
      const syncedOtp = (await db.collection('emailOtpVerifications').doc(uid).get()).data();
      assert.equal(syncedOtp.profileSynced, true);
      await reload(credential.user);
      const authorized = await requireRequester(await request(), auth, db);
      assert.equal(authorized.profile.uid, uid);

      // Existing successful OTP verification does not cause unnecessary subsequent verification.
      assert.deepEqual(await service.request(uid), { alreadyVerified: true });
      assert.deepEqual(await service.verify(uid, sentCode), { verified: true, alreadyVerified: true });

      // Historical/consumed OTP evidence must NOT automatically re-verify an account after an
      // administrative verification reset or email change (A -> B -> A); fresh OTP is required.
      await auth.updateUser(uid, { emailVerified: false });
      await db.collection('users').doc(uid).update({ emailVerified: false });
      nowMs += 61_000;
      sentCode = '';
      const reissued = await service.request(uid);
      assert.equal(Boolean(reissued.alreadyVerified), false);
      assert.ok(reissued.expiresAt);
      assert.match(sentCode, /^\d{6}$/);
      assert.equal((await auth.getUser(uid)).emailVerified, false);
      assert.equal((await db.collection('users').doc(uid).get()).data().emailVerified, false);
      assert.deepEqual(await service.verify(uid, sentCode), { verified: true });
      assert.equal((await auth.getUser(uid)).emailVerified, true);
      assert.equal((await db.collection('users').doc(uid).get()).data().emailVerified, true);
      await signOut(clientAuth);
    } finally {
      await deleteClientApp(clientApp);
      await deleteAdminApp(app);
    }
  });

test('real Auth and Firestore emulators reject OTP bypasses across password-change, status holds, email mismatch, and partial sync or rollback failures',
  { skip: !firestoreHost || !authHost || process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId }, async () => {
    const suffix = randomUUID();
    const uid = `security-otp-${suffix}`;
    const email = `${uid}@example.test`;
    const app = initializeAdminApp({ projectId }, `sec-otp-admin-${suffix}`);
    const auth = getAdminAuth(app);
    const db = getFirestore(app);
    try {
      await auth.createUser({ uid, email, emailVerified: false, password: 'SafePassword2026' });
      const userRef = db.collection('users').doc(uid);

      let sentCode = '';
      let nowMs = Date.now();
      const service = createEmailOtpService({
        auth, db, hashSecret: 'emulator-only-otp-secret', now: () => nowMs,
        sendEmailOtp: async ({ code }) => { sentCode = code; },
      });

      // 0. Missing Firestore profile fails closed
      await assert.rejects(service.request(uid), (err) => err.status === 403 && err.reason === 'PROFILE_MISSING');

      await userRef.set({
        uid, email, role: 'manager', accountStatus: 'active', managerStatus: 'active',
        accountSource: 'admin_created', emailVerificationRequired: true, emailVerified: false,
        mustChangePassword: true,
      });

      // 1. First-login mustChangePassword blocks OTP request before password change
      await assert.rejects(service.request(uid), (err) => err.status === 403 && err.reason === 'PASSWORD_CHANGE_REQUIRED');

      // 2. Pending account action hold and inactive/suspended statuses block OTP request
      await userRef.update({ mustChangePassword: false, accountActionHoldIntentId: 'a'.repeat(64) });
      await assert.rejects(service.request(uid), (err) => err.status === 403 && err.reason === 'ACCOUNT_ACTION_PENDING');

      await userRef.update({ accountActionHoldIntentId: null, accountStatus: 'suspended' });
      await assert.rejects(service.request(uid), (err) => err.status === 403 && err.reason === 'ACCOUNT_NOT_ACTIVE');

      await userRef.update({ accountStatus: 'active', managerStatus: 'inactive' });
      await assert.rejects(service.request(uid), (err) => err.status === 403 && err.reason === 'MANAGER_INACTIVE');

      // 3. Contradictory profile email fails closed
      await userRef.update({ managerStatus: 'active', email: `different-${email}` });
      await assert.rejects(service.request(uid), (err) => err.status === 409 && err.reason === 'EMAIL_MISMATCH');

      // 4. Restore eligible profile, issue OTP, then simulate concurrent suspension before syncVerifiedProfile completes
      await userRef.update({ email });
      await service.request(uid);
      assert.match(sentCode, /^\d{6}$/);

      const realUpdateUser = auth.updateUser.bind(auth);
      auth.updateUser = async (targetUid, props) => {
        const res = await realUpdateUser(targetUid, props);
        if (props.emailVerified === true) {
          // Simulate concurrent account suspension right before Firestore profile sync runs
          await userRef.update({ accountStatus: 'suspended' });
        }
        return res;
      };
      try {
        await assert.rejects(service.verify(uid, sentCode), (err) => err.status === 403 && err.reason === 'ACCOUNT_NOT_ACTIVE');
      } finally {
        auth.updateUser = realUpdateUser;
      }
      // Auth emailVerified must be rolled back to false so partial failure never grants access
      assert.equal((await auth.getUser(uid)).emailVerified, false);
      assert.equal((await userRef.get()).data().emailVerified, false);

      // 5. Simulate failed rollback (both syncVerifiedProfile AND auth.updateUser({ emailVerified: false }) fail)
      await userRef.update({ accountStatus: 'active' });
      nowMs += 61_000;
      sentCode = '';
      await service.request(uid);
      assert.match(sentCode, /^\d{6}$/);

      auth.updateUser = async (targetUid, props) => {
        if (props.emailVerified === false) {
          throw new Error('Simulated Auth rollback failure');
        }
        const res = await realUpdateUser(targetUid, props);
        if (props.emailVerified === true) {
          await userRef.update({ accountStatus: 'suspended' });
        }
        return res;
      };
      try {
        await assert.rejects(
          service.verify(uid, sentCode),
          (err) => err.status === 503
            && err.reason === 'EMAIL_VERIFICATION_RECONCILIATION_FAILED'
            && err.details?.reconciled === false
            && err.details?.rollbackFailed === true
        );
      } finally {
        auth.updateUser = realUpdateUser;
      }

      // Even though Auth rollback failed transiently (leaving Auth emailVerified === true while
      // emailOtpVerifications/{uid} has status: 'reconciliation-failed' and profileSynced: false),
      // subsequent verify() or request() must NOT mistake the account for alreadyVerified, and
      // must complete the deferred rollback to emailVerified: false before allowing fresh OTP recovery.
      await userRef.update({ accountStatus: 'active' });
      assert.equal((await auth.getUser(uid)).emailVerified, true);
      await assert.rejects(
        service.verify(uid, sentCode),
        (err) => err.status === 400 && err.reason === 'no-active-code'
      );
      assert.equal((await auth.getUser(uid)).emailVerified, false);
      assert.equal((await userRef.get()).data().emailVerified, false);

      // Also verify that if request() is called directly while Auth is still in reconciliation-failed state,
      // it repairs Auth emailVerified to false and issues a fresh OTP instead of returning alreadyVerified.
      await realUpdateUser(uid, { emailVerified: true });
      await db.collection('emailOtpVerifications').doc(uid).set({
        status: 'reconciliation-failed',
        profileSynced: false,
      }, { merge: true });
      nowMs += 61_000;
      sentCode = '';
      const recovered = await service.request(uid);
      assert.equal(Boolean(recovered.alreadyVerified), false);
      assert.match(sentCode, /^\d{6}$/);
      assert.equal((await auth.getUser(uid)).emailVerified, false);
      assert.deepEqual(await service.verify(uid, sentCode), { verified: true });
      assert.equal((await auth.getUser(uid)).emailVerified, true);
      assert.equal((await userRef.get()).data().emailVerified, true);
    } finally {
      await deleteAdminApp(app);
    }
  });

test('split-state incomplete OTP reconciliation is denied across backend endpoints, Firestore rules, and client routing until fresh OTP completes',
  { skip: !firestoreHost || !authHost || process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId }, async () => {
    const suffix = randomUUID();
    const app = initializeAdminApp({ projectId }, `split-admin-${suffix}`);
    const clientApp = initializeClientApp({ apiKey: 'demo-key', authDomain: 'demo-bluetap.firebaseapp.com', projectId }, `split-client-${suffix}`);
    const auth = getAdminAuth(app);
    const db = getFirestore(app);
    const clientAuth = getAuth(clientApp);
    connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });
    const clientDb = getClientFirestore(clientApp);
    const [fsHostname, fsPort] = firestoreHost.split(':');
    connectFirestoreEmulator(clientDb, fsHostname, Number(fsPort));

    const branchId = `split-branch-${suffix}`;
    const productId = `split-product-${suffix}`;
    const password = `LocalOnly-${randomUUID()}-a1!`;

    try {
      await db.collection('branches').doc(branchId).set({ name: 'Split Test Branch', status: 'active' });
      await db.collection('products').doc(productId).set({ name: 'Purified 5 Gallon', price: 35, active: true });

      for (const [role, guard, expectedHome] of [
        ['requester', requireRequester, '/requester/r_dashboard'],
        ['distributor', requireActiveDistributor, '/distributor/d_dashboard'],
        ['manager', requireActiveManager, '/manager/dashboard'],
      ]) {
        const uid = `split-${role}-${suffix}`;
        const email = `${uid}@example.test`;
        const requestId = `split-req-${role}-${suffix}`;

        // 1. Seed split-state: Auth emailVerified = true, Firestore users/{uid}.emailVerified = false,
        //    emailOtpVerifications/{uid}.profileSynced = false, status = 'reconciliation-failed'
        await auth.createUser({ uid, email, emailVerified: true, password });
        if (role === 'manager') {
          await auth.setCustomUserClaims(uid, { manager: true, role: 'manager' });
        }
        await db.collection('users').doc(uid).set({
          uid,
          email,
          role,
          accountStatus: 'active',
          accountSource: 'admin_created',
          emailVerificationRequired: true,
          emailVerified: false,
          mustChangePassword: false,
          registrationCompleted: true,
          onboardingStatus: 'complete',
          faceVerification: { required: false, status: 'not_required', verificationSource: 'admin_created' },
          ...(role === 'distributor' ? { distributorStatus: 'active', approvalStatus: 'active', branchId } : {}),
          ...(role === 'manager' ? { managerStatus: 'active', branchId } : {}),
        });
        await db.collection('emailOtpVerifications').doc(uid).set({
          email,
          otpHash: null,
          status: 'reconciliation-failed',
          profileSynced: false,
        });
        await db.collection('requests').doc(requestId).set({
          requester_id: role === 'requester' ? uid : `other-req-${suffix}`,
          assignedDistributorUid: role === 'distributor' ? uid : `other-dist-${suffix}`,
          branchId,
          status: 'out_for_delivery',
        });
        if (role === 'manager') {
          await db.collection('chatBranchActivity').doc(branchId).set({ updatedAt: new Date() });
          await db.collection('moderationActivity').doc(`branch_${branchId}`).set({ updatedAt: new Date() });
        } else {
          await db.collection('chatUserActivity').doc(uid).set({ updatedAt: new Date() });
          await db.collection('moderationActivity').doc(`user_${uid}`).set({ updatedAt: new Date() });
        }

        const credential = await signInWithEmailAndPassword(clientAuth, email, password);
        await reload(credential.user);
        const freshToken = await credential.user.getIdToken(true);
        const tokenResult = await credential.user.getIdTokenResult();
        assert.equal(credential.user.emailVerified, true);
        assert.equal(tokenResult.claims.email_verified, true);

        // A. Backend protected endpoint MUST reject split-state with 403 EMAIL_VERIFICATION_REQUIRED
        const req = { headers: { authorization: `Bearer ${freshToken}` } };
        await assert.rejects(
          guard(req, auth, db),
          (error) => error.status === 403 && error.reason === 'EMAIL_VERIFICATION_REQUIRED',
          `${role} backend guard must deny split-state`
        );

        // B. Firestore protected operational reads and writes under current rules MUST be denied,
        //    while self-profile read remains allowed for OTP routing
        const ownProfileSnap = await getDoc(doc(clientDb, 'users', uid));
        assert.equal(ownProfileSnap.exists(), true);
        assert.equal(ownProfileSnap.data().emailVerified, false);

        await assert.rejects(
          getDoc(doc(clientDb, 'products', productId)),
          (err) => err.code === 'permission-denied',
          `${role} product read must be denied in split-state`
        );
        await assert.rejects(
          getDoc(doc(clientDb, 'requests', requestId)),
          (err) => err.code === 'permission-denied',
          `${role} request read must be denied in split-state`
        );
        if (role === 'distributor' || role === 'manager') {
          await assert.rejects(
            getDoc(doc(clientDb, 'branches', branchId)),
            (err) => err.code === 'permission-denied',
            `${role} branch read must be denied in split-state`
          );
        }
        if (role === 'manager') {
          await assert.rejects(
            getDoc(doc(clientDb, 'chatBranchActivity', branchId)),
            (err) => err.code === 'permission-denied',
            'manager chatBranchActivity read must be denied in split-state'
          );
          await assert.rejects(
            getDoc(doc(clientDb, 'moderationActivity', `branch_${branchId}`)),
            (err) => err.code === 'permission-denied',
            'manager moderationActivity read must be denied in split-state'
          );
        } else {
          await assert.rejects(
            getDoc(doc(clientDb, 'chatUserActivity', uid)),
            (err) => err.code === 'permission-denied',
            `${role} chatUserActivity read must be denied in split-state`
          );
          await assert.rejects(
            getDoc(doc(clientDb, 'moderationActivity', `user_${uid}`)),
            (err) => err.code === 'permission-denied',
            `${role} moderationActivity read must be denied in split-state`
          );
        }
        await assert.rejects(
          updateDoc(doc(clientDb, 'users', uid), { phone: '+639171234567' }),
          (err) => err.code === 'permission-denied',
          `${role} profile update must be denied in split-state`
        );

        // C. Client role routing and dashboard access MUST redirect to /email-verification
        const splitProfile = ownProfileSnap.data();
        const clientHarness = loadAuthSessionHarness({
          auth: { currentUser: credential.user },
          db: clientDb,
          doc: ( _db, _col, id) => id,
          getDocFromServer: async () => ({ exists: () => true, data: () => splitProfile }),
          saveLocalUser: () => {},
          isFaceVerified: () => true,
          normalizeFaceVerification: (d) => d.faceVerification || { required: false, status: 'not_required' },
          getManagerContext: async () => ({ manager: { managerStatus: 'active' }, branch: { id: branchId, name: 'Split Test Branch', status: 'active' } }),
          clearAdminDataCache: () => {},
          logDevelopmentTiming: () => {},
          signOut: async () => {},
        });
        assert.equal(clientHarness.isOperationalEmailVerificationPending(splitProfile, credential.user), true);
        assert.equal(clientHarness.getPostAuthenticationDestination(splitProfile), '/email-verification');
        const roleGateResult = await clientHarness.validateRoleAccess(role);
        assert.equal(roleGateResult.status, 'email-unverified');
        assert.equal(roleGateResult.redirectTo, '/email-verification');

        // D. Complete fresh OTP synchronization and verify all 5 layers grant access
        let sentCode = '';
        let nowMs = Date.now();
        const otpService = createEmailOtpService({
          auth,
          db,
          hashSecret: 'emulator-only-otp-secret',
          now: () => nowMs,
          sendEmailOtp: async ({ recipient, code }) => {
            assert.equal(recipient, email);
            sentCode = code;
          },
        });
        const issued = await otpService.request(uid);
        assert.equal(Boolean(issued.alreadyVerified), false);
        assert.match(sentCode, /^\d{6}$/);
        assert.deepEqual(await otpService.verify(uid, sentCode), { verified: true });

        await reload(credential.user);
        const reconciledToken = await credential.user.getIdToken(true);
        const authorizedBackend = await guard({ headers: { authorization: `Bearer ${reconciledToken}` } }, auth, db);
        assert.equal(authorizedBackend.profile.uid, uid);

        assert.equal((await getDoc(doc(clientDb, 'products', productId))).exists(), true);
        assert.equal((await getDoc(doc(clientDb, 'requests', requestId))).exists(), true);
        if (role === 'distributor' || role === 'manager') {
          assert.equal((await getDoc(doc(clientDb, 'branches', branchId))).exists(), true);
        }
        await updateDoc(doc(clientDb, 'users', uid), { phone: '+639171234567' });

        const reconciledProfile = (await getDoc(doc(clientDb, 'users', uid))).data();
        assert.equal(reconciledProfile.emailVerified, true);
        assert.equal(reconciledProfile.emailOtpVerification?.status, 'verified');

        const reconciledHarness = loadAuthSessionHarness({
          auth: { currentUser: credential.user },
          db: clientDb,
          doc: (_db, _col, id) => id,
          getDocFromServer: async () => ({ exists: () => true, data: () => reconciledProfile }),
          saveLocalUser: () => {},
          isFaceVerified: () => true,
          normalizeFaceVerification: (d) => d.faceVerification || { required: false, status: 'not_required' },
          getManagerContext: async () => ({ manager: { managerStatus: 'active' }, branch: { id: branchId, name: 'Split Test Branch', status: 'active' } }),
          clearAdminDataCache: () => {},
          logDevelopmentTiming: () => {},
          signOut: async () => {},
        });
        assert.equal(reconciledHarness.isOperationalEmailVerificationPending(reconciledProfile, credential.user), false);
        assert.equal(reconciledHarness.getPostAuthenticationDestination(reconciledProfile), expectedHome);
        const authorizedGate = await reconciledHarness.validateRoleAccess(role);
        assert.equal(authorizedGate.status, 'authorized');

        await signOut(clientAuth);
      }
    } finally {
      await terminate(clientDb).catch(() => {});
      await deleteClientApp(clientApp);
      await deleteAdminApp(app);
    }
  });

test('real Auth emulator preserves verified and OTP-disabled existing role access while gating required unverified email',
  { skip: !firestoreHost || !authHost || process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId }, async () => {
    const suffix = randomUUID();
    const app = initializeAdminApp({ projectId }, `policy-admin-${suffix}`);
    const clientApp = initializeClientApp({ apiKey: 'demo-key', authDomain: 'demo-bluetap.firebaseapp.com', projectId }, `policy-client-${suffix}`);
    const auth = getAdminAuth(app);
    const db = getFirestore(app);
    const clientAuth = getAuth(clientApp);
    connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });
    const branchId = `policy-branch-${suffix}`;
    const password = `LocalOnly-${randomUUID()}-a1!`;
    try {
      await db.collection('branches').doc(branchId).set({ status: 'active' });
      for (const [role, guard] of [
        ['requester', requireRequester],
        ['distributor', requireActiveDistributor],
        ['manager', requireActiveManager],
      ]) {
        for (const [caseName, required, verified, allowed, extraProfile] of [
          ['verified', true, true, true],
          ['otp-disabled', false, false, true],
          ['otp-required', true, false, false],
          ['incomplete-required-registration', true, false, false, { registrationCompleted: false }],
          ['completed-optional-registration', false, false, true,
            { registrationCompleted: true, emailOtpVerification: { required: false, status: 'not_required' } }],
          ['legacy-otp-record-auth-unverified', true, false, false,
            { emailVerified: true, emailOtpVerification: { required: true, status: 'verified' }, registrationCompleted: true }],
          ['legacy-flag-absent', undefined, false, true],
          ['legacy-flag-null', null, false, true],
          ['admin-created-legacy-flag', false, false, false, { accountSource: 'admin_created' }],
          ['auth-verified-profile-inconsistent', true, true, true,
            { emailVerified: false, emailOtpVerification: { required: true, status: 'not_required' } }],
        ]) {
          const uid = `${role}-${caseName}-${suffix}`;
          const email = `${uid}@example.test`;
          await auth.createUser({ uid, email, emailVerified: verified, password });
          if (role === 'manager') await auth.setCustomUserClaims(uid, { manager: true, role });
          await db.collection('users').doc(uid).set({ role, email, accountStatus: 'active',
            ...(required === undefined ? {} : { emailVerificationRequired: required }),
            ...(role === 'distributor' ? { distributorStatus: 'active', branchId } : {}),
            ...(role === 'manager' ? { managerStatus: 'active', branchId } : {}),
            ...extraProfile,
          });
          const credential = await signInWithEmailAndPassword(clientAuth, email, password);
          const req = { headers: { authorization: `Bearer ${await credential.user.getIdToken(true)}` } };
          if (allowed) assert.equal((await guard(req, auth, db)).profile.uid, uid);
          else await assert.rejects(guard(req, auth, db),
            (error) => error.reason === 'EMAIL_VERIFICATION_REQUIRED');
          await signOut(clientAuth);
        }
      }
    } finally {
      await deleteClientApp(clientApp);
      await deleteAdminApp(app);
    }
  });
