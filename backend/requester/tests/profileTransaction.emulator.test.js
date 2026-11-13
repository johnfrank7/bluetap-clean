const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, runTransaction, doc, serverTimestamp, terminate } = require('firebase/firestore');
const { initializeApp: adminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getAuth: adminAuth } = require('firebase-admin/auth');
const { getFirestore: adminFirestore } = require('firebase-admin/firestore');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'
  && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099'
  && process.env.GCLOUD_PROJECT === 'demo-bluetap';

test('Requester profile transaction obeys real emulator rules and rejects stale and forbidden updates', { skip: !enabled }, async () => {
  const suffix = randomUUID();
  const uid = `profile-${suffix}`;
  const email = `${uid}@example.test`;
  const admin = adminApp({ projectId: 'demo-bluetap' }, `admin-${suffix}`);
  const client = initializeApp({ projectId: 'demo-bluetap', apiKey: 'demo-key' }, `client-${suffix}`);
  const auth = getAuth(client);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(client);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const serverDb = adminFirestore(admin);
  try {
    await adminAuth(admin).createUser({ uid, email, emailVerified: true, password: 'Test-only-Password-123' });
    await serverDb.doc(`users/${uid}`).set({ uid, email, role: 'requester', accountStatus: 'active', firstName: 'Sample', lastName: 'User', phone: '+639171234567', address: 'Old Road' });
    await signInWithEmailAndPassword(auth, email, 'Test-only-Password-123');
    const source = fs.readFileSync(path.resolve(__dirname, '../../../app/requester/r_profile.jsx'), 'utf8');
    const start = source.indexOf('await runTransaction(db, async (transaction) => {');
    const end = source.indexOf('\n      saveLocalUser(nextProfile);', start);
    assert.ok(start >= 0 && end > start);
    const getName = source.slice(source.indexOf('const getFullName ='), source.indexOf('const splitFullName ='));
    const transactionSource = source.slice(start, end);
    const runProfileTransaction = new Function('runTransaction', 'db', 'doc', 'serverTimestamp', 'uid', 'editBaseline', 'profileUpdate', `return (async () => { ${getName} ${transactionSource} })();`);
    const invoke = (baseline, profileUpdate) => runProfileTransaction(runTransaction, db, doc, serverTimestamp, uid, { current: baseline }, profileUpdate);
    const baseline = { fullName: 'Sample User', phone: '+639171234567', address: 'Old Road' };
    await invoke(baseline, { firstName: 'Sample', lastName: 'User', phone: '+639171234567', address: 'New Road' });
    assert.equal((await serverDb.doc(`users/${uid}`).get()).data().address, 'New Road');
    await assert.rejects(invoke(baseline, { address: 'Stale Road' }), /changed elsewhere/);
    assert.equal((await serverDb.doc(`users/${uid}`).get()).data().address, 'New Road');
    await assert.rejects(invoke({ ...baseline, address: 'New Road' }, { role: 'admin' }), (error) => error.code === 'permission-denied');
    assert.equal((await serverDb.doc(`users/${uid}`).get()).data().role, 'requester');
  } finally {
    await terminate(db);
    await deleteApp(client);
    await deleteAdminApp(admin);
  }
});
