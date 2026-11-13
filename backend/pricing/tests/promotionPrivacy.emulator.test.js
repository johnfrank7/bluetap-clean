const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: initializeClient, deleteApp: deleteClient } = require('firebase/app');
const { getAuth: getClientAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore: getClientFirestore, connectFirestoreEmulator, getDocFromServer, doc } = require('firebase/firestore');
const { createManagerWorkspaceHandler } = require('../../manager/workspaceHandler');

const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099';
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });

test('draft product metadata is Admin-only; Managers receive a sanitized branch catalog', { skip: !enabled, timeout: 60000 }, async () => {
  const id = randomUUID(); const projectId = 'demo-bluetap'; const app = initializeApp({ projectId }, `privacy-${id}`);
  const db = getFirestore(app); const auth = getAuth(app);
  const client = initializeClient({ projectId, apiKey: 'synthetic-local-key' }, `privacy-client-${id}`);
  const clientAuth = getClientAuth(client); const clientDb = getClientFirestore(client);
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(clientDb, '127.0.0.1', 8080);
  const branch = `branch-${id}`; const otherBranch = `other-${id}`; const product = `product-${id}`; const otherProduct = `private-${id}`;
  const password = `Test-${id}-aA1!`;
  const identities = ['requester', 'manager', 'admin'].map((role) => ({ role, uid: `${role}-${id}`, email: `${role}-${id}@example.test` }));
  try {
    for (const identity of identities) {
      await auth.createUser({ uid: identity.uid, email: identity.email, password });
      if (identity.role !== 'requester') await auth.setCustomUserClaims(identity.uid, { role: identity.role, [identity.role]: true });
      await db.doc(`users/${identity.uid}`).set({ role: identity.role, accountStatus: 'active', ...(identity.role === 'manager' ? { managerStatus: 'active', branchId: branch } : {}) });
    }
    await Promise.all([
      db.doc(`branches/${branch}`).set({ name: 'Branch', status: 'active', latitude: 10.267, longitude: 123.584 }),
      db.doc(`branches/${otherBranch}`).set({ name: 'Other', status: 'active', latitude: 10.267, longitude: 123.584 }),
      db.doc(`products/${product}`).set({ product_name: 'Refill', price: 20, active: true, branchIds: [branch], bundlePromotion: { title: 'Private draft', active: false } }),
      db.doc(`products/${otherProduct}`).set({ product_name: 'Other Refill', price: 20, active: true, branchIds: [otherBranch] }),
    ]);
    const signIn = async (role) => { const identity = identities.find((item) => item.role === role); return (await signInWithEmailAndPassword(clientAuth, identity.email, password)).user.getIdToken(true); };
    await signIn('requester');
    await assert.rejects(getDocFromServer(doc(clientDb, 'products', product)), (error) => error.code === 'permission-denied');
    const managerToken = await signIn('manager');
    await assert.rejects(getDocFromServer(doc(clientDb, 'products', product)), (error) => error.code === 'permission-denied');
    const res = response();
    await createManagerWorkspaceHandler(() => ({ auth, db }))({ method: 'GET', headers: { authorization: `Bearer ${managerToken}` } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(res.body.products.some((item) => item.id === product));
    assert.equal(res.body.products.some((item) => item.id === otherProduct), false);
    assert.equal(JSON.stringify(res.body.products).includes('Private draft'), false);
    await signIn('admin');
    assert.equal((await getDocFromServer(doc(clientDb, 'products', product))).data().bundlePromotion.title, 'Private draft');
  } finally { await deleteClient(client); await deleteApp(app); }
});
