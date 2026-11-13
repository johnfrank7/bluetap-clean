const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { initializeApp: adminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getAuth: adminAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createPasswordChangeOtpHandler } = require('../passwordChangeOtpHandler');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'
  && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099'
  && process.env.GCLOUD_PROJECT === 'demo-bluetap';

test('isolated Auth and Firestore enforce the password-change OTP before updating the emulator account', { skip: !enabled }, async () => {
  const id = randomUUID();
  const uid = `password-test-${id}`;
  const email = `${uid}@example.test`;
  const admin = adminApp({ projectId: 'demo-bluetap' }, `password-admin-${id}`);
  const client = initializeApp({ projectId: 'demo-bluetap', apiKey: 'demo-key' }, `password-client-${id}`);
  const auth = getAuth(client);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const serverAuth = adminAuth(admin);
  const db = getFirestore(admin);
  try {
    await serverAuth.createUser({ uid, email, emailVerified: true, password: 'OldTestPassword123' });
    await db.doc(`users/${uid}`).set({ uid, role: 'requester', email, accountStatus: 'active' });
    await assert.rejects(signInWithEmailAndPassword(auth, email, 'WrongTestPassword123'));
    const signedIn = await signInWithEmailAndPassword(auth, email, 'OldTestPassword123');
    const token = await signedIn.user.getIdToken(true);
    let code = '';
    const handler = createPasswordChangeOtpHandler(() => ({ auth: serverAuth, db }), { secret: () => 'emulator-only-key', checkTransport: () => {}, send: async ({ text }) => { code = /\b\d{6}\b/.exec(text)[0]; } });
    const call = async (body) => {
      const res = { statusCode: 200, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
      await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res);
      return res;
    };
    assert.equal((await call({ action: 'request' })).statusCode, 200);
    const wrong = code === '000000' ? '111111' : '000000';
    assert.notEqual((await call({ action: 'confirm', code: wrong, newPassword: 'NewTestPassword123' })).statusCode, 200);
    assert.equal((await call({ action: 'confirm', code, newPassword: 'NewTestPassword123' })).body.changed, true);
    assert.notEqual((await call({ action: 'confirm', code, newPassword: 'AnotherTestPassword123' })).statusCode, 200);
    await assert.rejects(signInWithEmailAndPassword(auth, email, 'OldTestPassword123'));
    assert.equal((await signInWithEmailAndPassword(auth, email, 'NewTestPassword123')).user.uid, uid);
  } finally {
    await deleteApp(client);
    await deleteAdminApp(admin);
  }
});
