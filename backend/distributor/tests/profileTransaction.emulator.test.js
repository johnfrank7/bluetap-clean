const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, runTransaction, doc, terminate } = require('firebase/firestore');
const { initializeApp: adminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getAuth: adminAuth } = require('firebase-admin/auth');
const { getFirestore: adminFirestore } = require('firebase-admin/firestore');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'
  && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099'
  && process.env.GCLOUD_PROJECT === 'demo-bluetap';

test('Distributor profile saves use emulator rules and retain edits on stale, invalid, and forbidden writes', { skip: !enabled }, async () => {
  const suffix = randomUUID();
  const uid = `dist-${suffix}`;
  const email = `${uid}@example.test`;
  const admin = adminApp({ projectId: 'demo-bluetap' }, `dist-admin-${suffix}`);
  const client = initializeApp({ projectId: 'demo-bluetap', apiKey: 'demo-key' }, `dist-client-${suffix}`);
  const auth = getAuth(client);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(client);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const serverDb = adminFirestore(admin);
  try {
    await adminAuth(admin).createUser({ uid, email, emailVerified: true, password: 'Test-only-Password-123' });
    const profile = { uid, email, role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch-a', firstName: 'Sample', lastName: 'User', phone: '+639171234567', address: 'Old Road' };
    await serverDb.doc(`users/${uid}`).set(profile);
    await signInWithEmailAndPassword(auth, email, 'Test-only-Password-123');
    const source = fs.readFileSync(path.resolve(__dirname, '../../../app/distributor/d_profile.jsx'), 'utf8');
    const helpers = source.slice(source.indexOf('const getProfileObject ='), source.indexOf('const ProfileField ='));
    const body = source.slice(source.indexOf('  async function saveProfileChanges()'), source.indexOf('\n  const handleLogout ='));
    assert.ok(body.includes('await runTransaction'));
    const baseline = { fullName: 'Sample User', contactNumber: '+639171234567', address: 'Old Road' };
    const invoke = async ({ original = baseline, address = 'New Road', forbidden = false } = {}) => {
      const state = { editing: true, saved: false };
      const wrappedTransaction = forbidden ? (database, callback) => runTransaction(database, (tx) => callback({
        get: (ref) => tx.get(ref), set: (ref, changes, options) => tx.set(ref, { ...changes, role: 'admin' }, options),
      })) : runTransaction;
      const bindings = {
        auth, db, doc, runTransaction: wrappedTransaction, userData: profile, profileDraft: { ...baseline, address },
        profileDisplay: { email }, editBaseline: { current: original }, saveInFlight: { current: false },
        normalizePhilippinePhone: (value) => /^\+639\d{9}$/.test(value) ? value : null,
        Alert: { alert: () => {} }, setSavingProfile: () => {}, saveLocalUser: () => { state.saved = true; },
        setUserData: () => {}, setProfileDraft: () => {}, setEditingProfile: (value) => { state.editing = value; },
        setToast: () => {}, console: { log: () => {} },
      };
      const save = new Function(...Object.keys(bindings), `${helpers}\n${body}\nreturn saveProfileChanges;`)(...Object.values(bindings));
      state.result = await save();
      return state;
    };
    assert.deepEqual(await invoke(), { result: true, editing: false, saved: true });
    assert.equal((await serverDb.doc(`users/${uid}`).get()).data().address, 'New Road');
    assert.deepEqual(await invoke(), { result: false, editing: true, saved: false });
    assert.deepEqual(await invoke({ original: { ...baseline, address: 'New Road' }, address: '' }), { result: false, editing: true, saved: false });
    assert.deepEqual(await invoke({ original: { ...baseline, address: 'New Road' }, address: 'Forbidden Road', forbidden: true }), { result: false, editing: true, saved: false });
    const after = (await serverDb.doc(`users/${uid}`).get()).data();
    assert.equal(after.role, 'distributor');
    assert.equal(after.address, 'New Road');
  } finally {
    await terminate(db);
    await deleteApp(client);
    await deleteAdminApp(admin);
  }
});
