const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirebaseAdmin } = require('../../firebase/firebaseAdmin');
const { assertLocalQaServerEnvironment } = require('../../config/localQaIsolation');
const { createPasswordChangeOtpHandler } = require('../passwordChangeOtpHandler');
const { loadRegistrationSecurity } = require('../../registration/registrationSecurity');

const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap-local-qa'
  && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'
  && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099'
  && process.env.LOCAL_QA_EMULATORS === '1';

for (const role of ['requester', 'manager', 'distributor']) {
  test(`local-QA ${role} password change enforces OTP and saved revocation policy`, { skip: !enabled, timeout: 60000 }, async () => {
    assertLocalQaServerEnvironment();
    const { auth: serverAuth, db } = getFirebaseAdmin();
    assert.equal(db.projectId, 'demo-bluetap-local-qa');
    assert.equal(db._settings.servicePath, '127.0.0.1');
    assert.equal(db._settings.port, 8080);
    assert.equal(db._settings.ssl, false);
    const id = randomUUID(); const uid = `pw-local-${role}-${id}`; const branch = `pw-local-branch-${id}`;
    const email = `${uid}@example.test`; const oldPassword = 'SyntheticOldPass123'; const newPassword = 'SyntheticNewPass456';
    const client = initializeApp({ projectId: 'demo-bluetap-local-qa', apiKey: 'fake-local-qa-key' }, `pw-local-${id}`);
    const auth = getAuth(client); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    try {
      await serverAuth.createUser({ uid, email, password: oldPassword, emailVerified: true });
      if (role === 'manager') await serverAuth.setCustomUserClaims(uid, { role: 'manager', manager: true });
      await Promise.all([db.doc(`branches/${branch}`).create({ status: 'active' }), db.doc(`users/${uid}`).create({ uid, email, role, accountStatus: 'active', ...(role === 'manager' ? { managerStatus: 'active', branchId: branch } : {}), ...(role === 'distributor' ? { distributorStatus: 'active', branchId: branch } : {}) })]);
      await assert.rejects(signInWithEmailAndPassword(auth, email, 'SyntheticWrongPass123'));
      const user = (await signInWithEmailAndPassword(auth, email, oldPassword)).user;
      const token = await user.getIdToken(true);
      let capturedCode = ''; let acceptedByTestTransport = false;
      const handler = createPasswordChangeOtpHandler(() => ({ auth: serverAuth, db }), { secret: () => 'synthetic-test-secret', checkTransport: () => {}, send: async ({ to, text }) => { assert.equal(to, email); capturedCode = /\b\d{6}\b/.exec(text)?.[0] || ''; acceptedByTestTransport = true; } });
      const call = async (body) => { const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } }; await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res); return res; };
      assert.equal((await call({ action: 'request' })).statusCode, 200);
      assert.equal(acceptedByTestTransport, true);
      assert.match(capturedCode, /^\d{6}$/);
      assert.equal((await call({ action: 'request' })).statusCode, 429);
      const wrong = capturedCode === '000000' ? '111111' : '000000';
      assert.notEqual((await call({ action: 'confirm', code: wrong, newPassword })).statusCode, 200);
      assert.notEqual((await call({ action: 'confirm', code: capturedCode, newPassword: 'weak' })).statusCode, 200);
      const result = await call({ action: 'confirm', code: capturedCode, newPassword });
      assert.equal(result.body.changed, true, JSON.stringify(result.body));
      const policy = await loadRegistrationSecurity(db);
      assert.equal(result.body.signOutRequired, policy.sessionSecurity[role].forceLogoutAfterPasswordChange !== false);
      assert.notEqual((await call({ action: 'confirm', code: capturedCode, newPassword })).statusCode, 200);
      await assert.rejects(signInWithEmailAndPassword(auth, email, oldPassword));
      assert.equal((await signInWithEmailAndPassword(auth, email, newPassword)).user.uid, uid);
      assert.ok((await db.doc(`users/${uid}`).get()).data().passwordChangedAt);
    } finally {
      await deleteApp(client);
      const logs = await db.collection('securityAuditLogs').where('uid', '==', uid).get();
      await Promise.all([db.doc(`users/${uid}`).delete(), db.doc(`branches/${branch}`).delete(), db.doc(`passwordChangeOtpSessions/${uid}`).delete(), serverAuth.deleteUser(uid).catch(() => {}), ...logs.docs.map((doc) => doc.ref.delete())]);
    }
  });
}
