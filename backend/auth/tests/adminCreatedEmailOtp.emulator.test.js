const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const { initializeApp: initializeClientApp, deleteApp: deleteClientApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut, reload } = require('firebase/auth');
const { createEmailOtpService } = require('../emailOtp');
const { requireRequester } = require('../authorization');

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = 'demo-bluetap';

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
        accountSource: 'admin_created', emailVerificationRequired: true, email });
      const credential = await signInWithEmailAndPassword(clientAuth, email, 'SafePassword2026');
      const request = async () => ({ headers: { authorization: `Bearer ${await credential.user.getIdToken(true)}` } });
      await assert.rejects(requireRequester(await request(), auth, db),
        (error) => error.reason === 'EMAIL_VERIFICATION_REQUIRED');

      let sentCode = '';
      const service = createEmailOtpService({ auth, db, hashSecret: 'emulator-only-otp-secret',
        sendEmailOtp: async ({ recipient, code }) => { assert.equal(recipient, email); sentCode = code; } });
      const issued = await service.request(uid);
      assert.ok(issued.expiresAt);
      assert.match(sentCode, /^\d{6}$/);
      assert.equal((await auth.getUser(uid)).emailVerified, false);
      assert.deepEqual(await service.verify(uid, sentCode), { verified: true });
      assert.equal((await auth.getUser(uid)).emailVerified, true);
      await reload(credential.user);
      const authorized = await requireRequester(await request(), auth, db);
      assert.equal(authorized.profile.uid, uid);
      await signOut(clientAuth);
    } finally {
      await deleteClientApp(clientApp);
      await deleteAdminApp(app);
    }
  });
