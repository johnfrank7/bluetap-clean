const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFirebaseAdmin } = require('../../firebase/firebaseAdmin');
const { assertLocalQaServerEnvironment } = require('../../config/localQaIsolation');
const { createManagerProfileHandler } = require('../profileHandler');

const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap-local-qa'
  && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'
  && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099'
  && process.env.LOCAL_QA_EMULATORS === '1';

test('local-QA Manager photo uses the authorized own-profile transaction', { skip: !enabled, timeout: 60000 }, async () => {
  assertLocalQaServerEnvironment();
  const { auth: serverAuth, db } = getFirebaseAdmin();
  assert.equal(db.projectId, 'demo-bluetap-local-qa');
  assert.equal(db._settings.servicePath, '127.0.0.1'); assert.equal(db._settings.port, 8080); assert.equal(db._settings.ssl, false);
  const id = randomUUID(); const uid = `photo-local-${id}`; const other = `photo-local-other-${id}`; const branch = `photo-local-branch-${id}`;
  const email = `${uid}@example.test`; const password = 'SyntheticPhotoPass123';
  const client = initializeApp({ projectId: 'demo-bluetap-local-qa', apiKey: 'fake-local-qa-key' }, `photo-local-${id}`);
  const auth = getAuth(client); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  let uploads = 0;
  try {
    await serverAuth.createUser({ uid, email, password, emailVerified: true });
    await serverAuth.setCustomUserClaims(uid, { manager: true, role: 'manager' });
    const profile = { uid, email, role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: branch, fullName: 'QA Manager', phone: '+639171234567', address: 'QA Road', publicUid: 'Man001' };
    await Promise.all([db.doc(`branches/${branch}`).create({ status: 'active' }), db.doc(`users/${uid}`).create(profile), db.doc(`users/${other}`).create({ ...profile, uid: other, email: `${other}@example.test` })]);
    const token = await (await signInWithEmailAndPassword(auth, email, password)).user.getIdToken(true);
    const storage = { uploadAvatar: async (owner) => { assert.equal(owner, uid); uploads++; return { profilePhotoUrl: 'https://example.test/synthetic-photo.png', profilePhotoPath: `avatars/${uid}/synthetic.png` }; }, deleteAvatar: async () => true };
    const handler = createManagerProfileHandler(() => ({ auth: serverAuth, db }), { avatarStorage: storage });
    const call = async (body, bearer = token) => { const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } }; await handler({ method: 'PATCH', headers: { authorization: `Bearer ${bearer}` }, body }, res); return res; };
    const baseline = { fullName: profile.fullName, phone: profile.phone, address: profile.address, profilePhotoPath: '' };
    const imageUpload = { contentType: 'image/png', dataBase64: readFileSync(resolve(__dirname, '../../../assets/icons/home.png')).toString('base64') };
    assert.equal((await call({ uid: other, imageUpload, expectedProfile: baseline })).body.error.reason, 'PROFILE_FIELDS_NOT_ALLOWED');
    assert.equal((await call({ role: 'admin', expectedProfile: baseline })).body.error.reason, 'PROFILE_FIELDS_NOT_ALLOWED');
    assert.notEqual((await call({ imageUpload: { contentType: 'image/png', dataBase64: 'invalid' }, expectedProfile: baseline })).statusCode, 200);
    assert.equal(uploads, 0);
    const saved = await call({ imageUpload, expectedProfile: baseline });
    assert.equal(saved.statusCode, 200, JSON.stringify(saved.body)); assert.equal(uploads, 1);
    assert.equal((await db.doc(`users/${uid}`).get()).data().profilePhotoUrl, 'https://example.test/synthetic-photo.png');
    assert.equal((await db.doc(`users/${other}`).get()).data().profilePhotoUrl, undefined);
    await signOut(auth); assert.equal((await signInWithEmailAndPassword(auth, email, password)).user.uid, uid);
    const persisted = (await db.doc(`users/${uid}`).get()).data();
    assert.equal(persisted.fullName, profile.fullName); assert.equal(persisted.branchId, branch); assert.equal(persisted.role, 'manager');
    assert.equal(persisted.profilePhotoUrl, 'https://example.test/synthetic-photo.png');
  } finally {
    await deleteApp(client);
    await Promise.all([db.doc(`users/${uid}`).delete(), db.doc(`users/${other}`).delete(), db.doc(`branches/${branch}`).delete(), serverAuth.deleteUser(uid).catch(() => {})]);
  }
});
