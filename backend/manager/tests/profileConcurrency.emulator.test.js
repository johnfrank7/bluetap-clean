const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore: clientFirestore, connectFirestoreEmulator, doc, updateDoc, terminate } = require('firebase/firestore');
const { initializeApp: adminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getAuth: adminAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createManagerProfileHandler } = require('../profileHandler');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'
  && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099'
  && process.env.GCLOUD_PROJECT === 'demo-bluetap';

test('real Manager transactions reject concurrent stale and unauthorized profile edits', { skip: !enabled }, async () => {
  const suffix = randomUUID();
  const uid = `manager-${suffix}`;
  const branchId = `branch-${suffix}`;
  const email = `${uid}@example.test`;
  const admin = adminApp({ projectId: 'demo-bluetap' }, `manager-admin-${suffix}`);
  const client = initializeApp({ projectId: 'demo-bluetap', apiKey: 'demo-key' }, `manager-client-${suffix}`);
  const auth = getAuth(client);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const clientDb = clientFirestore(client);
  connectFirestoreEmulator(clientDb, '127.0.0.1', 8080);
  const privilegedAuth = adminAuth(admin);
  const db = getFirestore(admin);
  try {
    await privilegedAuth.createUser({ uid, email, emailVerified: true, password: 'Test-only-Password-123' });
    await privilegedAuth.setCustomUserClaims(uid, { manager: true, role: 'manager' });
    await db.doc(`branches/${branchId}`).set({ status: 'active' });
    await db.doc(`users/${uid}`).set({ uid, email, role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId, fullName: 'Manager One', phone: '+639171234567', address: 'Original Road', publicUid: 'Man001' });
    const credential = await signInWithEmailAndPassword(auth, email, 'Test-only-Password-123');
    const token = await credential.user.getIdToken(true);
    const handler = createManagerProfileHandler(() => ({ auth: privilegedAuth, db }));
    const baseline = { fullName: 'Manager One', phone: '+639171234567', address: 'Original Road', profilePhotoPath: '' };
    const call = async (address, authorization = `Bearer ${token}`) => {
      const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
      await handler({ method: 'PATCH', headers: { authorization }, body: { address, expectedProfile: baseline } }, res);
      return res;
    };
    const results = await Promise.all([call('First Road'), call('Second Road')]);
    assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
    assert.equal(results.find((result) => result.statusCode === 409).body.error.reason, 'PROFILE_CONFLICT');
    const persisted = (await db.doc(`users/${uid}`).get()).data();
    assert.ok(['First Road', 'Second Road'].includes(persisted.address));
    assert.equal(persisted.branchId, branchId);
    assert.equal(persisted.role, 'manager');
    for (const field of ['profilePhotoUrl', 'profilePhotoPath', 'profilePhotoStorageProvider', 'profilePhotoRemoved', 'photoURL', 'avatarUrl']) {
      await assert.rejects(updateDoc(doc(clientDb, 'users', uid), { [field]: 'forged' }), (error) => error.code === 'permission-denied');
    }
    assert.equal((await call('Unauthorized Road', '')).statusCode, 401);
    const oldPath = `avatars/${uid}/old.png`;
    await db.doc(`users/${uid}`).update({ profilePhotoPath: oldPath, profilePhotoUrl: 'https://example.test/avatar.png' });
    let deleted = false;
    const storage = { deleteAvatar: async (path, owner) => { assert.equal(path, oldPath); assert.equal(owner, uid); deleted = true; } };
    const removalHandler = createManagerProfileHandler(() => ({ auth: privilegedAuth, db }), { avatarStorage: storage });
    const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
    await removalHandler({ method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body: { removeImage: true, expectedProfile: { ...baseline, address: persisted.address, profilePhotoPath: oldPath } } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal((await db.doc(`users/${uid}`).get()).data().profilePhotoRemoved, true);
    assert.equal(deleted, true);
    let uploadedFor = '';
    const uploadHandler = createManagerProfileHandler(() => ({ auth: privilegedAuth, db }), { avatarStorage: {
      uploadAvatar: async (owner) => { uploadedFor = owner; return { profilePhotoPath: `avatars-v2/owner/new.png`, profilePhotoUrl: 'https://example.test/new.png' }; },
      deleteAvatar: async () => { throw new Error('nothing should be deleted'); },
    } });
    const uploadRes = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
    const imageUpload = { contentType: 'image/png', dataBase64: readFileSync(resolve(__dirname, '../../../assets/icons/home.png')).toString('base64') };
    await uploadHandler({ method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body: { imageUpload, expectedProfile: { ...baseline, address: persisted.address, profilePhotoPath: '' } } }, uploadRes);
    assert.equal(uploadRes.statusCode, 200);
    assert.equal(uploadedFor, uid);
    const uploaded = (await db.doc(`users/${uid}`).get()).data();
    assert.equal(uploaded.profilePhotoUrl, 'https://example.test/new.png');
    assert.equal(uploaded.profilePhotoRemoved, false);
    assert.equal(uploaded.imageUpload, undefined);
  } finally {
    await terminate(clientDb);
    await deleteApp(client);
    await deleteAdminApp(admin);
  }
});
