const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, updateProfile } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, updateDoc, terminate } = require('firebase/firestore');
const { initializeApp: adminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getAuth: adminAuth } = require('firebase-admin/auth');
const { getFirestore: adminFirestore } = require('firebase-admin/firestore');
const { createManagerProfileHandler } = require('../profileHandler');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'
  && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099'
  && process.env.GCLOUD_PROJECT === 'demo-bluetap';

test('Requester, Distributor and Admin cannot alter avatar metadata or use Manager avatar endpoint', { skip: !enabled }, async () => {
  const suffix = randomUUID();
  const admin = adminApp({ projectId: 'demo-bluetap' }, `avatar-role-admin-${suffix}`);
  const serverAuth = adminAuth(admin);
  const db = adminFirestore(admin);
  try {
    for (const role of ['requester', 'distributor', 'admin']) {
      const uid = `${role}-${suffix}`;
      const email = `${uid}@example.test`;
      const client = initializeApp({ projectId: 'demo-bluetap', apiKey: 'demo-key' }, `avatar-${role}-${suffix}`);
      const auth = getAuth(client);
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      const clientDb = getFirestore(client);
      connectFirestoreEmulator(clientDb, '127.0.0.1', 8080);
      try {
        await serverAuth.createUser({ uid, email, emailVerified: true, password: 'Test-only-Password-123' });
        if (role === 'admin') await serverAuth.setCustomUserClaims(uid, { admin: true, role: 'admin' });
        await db.doc(`users/${uid}`).set({ uid, email, role, accountStatus: 'active', distributorStatus: 'active', branchId: `branch-${suffix}` });
        const credential = await signInWithEmailAndPassword(auth, email, 'Test-only-Password-123');
        for (const field of ['profilePhotoUrl', 'profilePhotoPath', 'profilePhotoStorageProvider', 'profilePhotoRemoved', 'photoURL', 'avatarUrl']) {
          await assert.rejects(updateDoc(doc(clientDb, 'users', uid), { [field]: 'forged' }), (error) => error.code === 'permission-denied');
        }
        // Auth's separate profile field is not governed by Firestore rules and
        // is intentionally not used as the BlueTap avatar for these roles.
        await updateProfile(credential.user, { photoURL: 'https://example.test/auth-only.png' });
        assert.equal((await db.doc(`users/${uid}`).get()).data().photoURL, undefined);
        const token = await credential.user.getIdToken(true);
        const handler = createManagerProfileHandler(() => ({ auth: serverAuth, db }), { avatarStorage: { deleteAvatar: async () => { throw new Error('must not run'); } } });
        const res = { statusCode: 200, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
        await handler({ method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body: { removeImage: true, expectedProfile: {} } }, res);
        assert.equal(res.statusCode, 403);
        assert.equal((await db.doc(`users/${uid}`).get()).data().profilePhotoPath, undefined);
      } finally { await terminate(clientDb); await deleteApp(client); }
    }
  } finally { await deleteAdminApp(admin); }
});
