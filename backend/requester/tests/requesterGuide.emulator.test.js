const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, updateDoc, getDocFromServer, terminate } = require('firebase/firestore');
const { initializeApp: adminApp, deleteApp: deleteAdmin } = require('firebase-admin/app');
const { getAuth: adminAuth } = require('firebase-admin/auth');
const { getFirestore: adminFirestore } = require('firebase-admin/firestore');

const project = process.env.GCLOUD_PROJECT;
const enabled = ['demo-bluetap', 'demo-bluetap-local-qa'].includes(project)
  && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'
  && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099';

test('guide completion persists per requester without granting access to another account or protected fields', { skip: !enabled, timeout: 60000 }, async () => {
  const id = randomUUID(); const uid = `guide-test-${id}`; const other = `guide-other-${id}`;
  const email = `${uid}@example.test`; const password = 'Synthetic-guide-test-9845';
  const admin = adminApp({ projectId: project }, `guide-admin-${id}`);
  const client = initializeApp({ projectId: project, apiKey: 'fake-local-key' }, `guide-client-${id}`);
  const auth = getAuth(client); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(client); connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const server = adminFirestore(admin);
  try {
    await adminAuth(admin).createUser({ uid, email, password, emailVerified: true });
    await Promise.all([server.doc(`users/${uid}`).create({ uid, role: 'requester', accountStatus: 'active' }), server.doc(`users/${other}`).create({ uid: other, role: 'requester', accountStatus: 'active' })]);
    await signInWithEmailAndPassword(auth, email, password);
    await updateDoc(doc(db, 'users', uid), { requesterGuideCompleted: true });
    assert.equal((await getDocFromServer(doc(db, 'users', uid))).data().requesterGuideCompleted, true);
    await assert.rejects(updateDoc(doc(db, 'users', other), { requesterGuideCompleted: true }), (error) => error.code === 'permission-denied');
    await assert.rejects(updateDoc(doc(db, 'users', uid), { role: 'admin' }), (error) => error.code === 'permission-denied');
    assert.equal((await server.doc(`users/${other}`).get()).data().requesterGuideCompleted, undefined);
  } finally {
    await terminate(db); await deleteApp(client);
    await Promise.all([server.doc(`users/${uid}`).delete(), server.doc(`users/${other}`).delete(), adminAuth(admin).deleteUser(uid).catch(() => {})]);
    await deleteAdmin(admin);
  }
});
