const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp: initAdmin, deleteApp: deleteAdmin } = require('firebase-admin/app');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: initClient, deleteApp: deleteClient } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { createRequesterOrdersHandler } = require('../../requester/orderingHandler');
const { createManagerDispatchHandler } = require('../../manager/dispatchHandler');

const firestoreHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:18080' : '127.0.0.1:8080';
const authHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:19099' : '127.0.0.1:9099';
const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.FIRESTORE_EMULATOR_HOST === firestoreHost && process.env.FIREBASE_AUTH_EMULATOR_HOST === authHost;
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, method, token, body) { const res = response(); await handler({ method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body }, res); return res; }

test('real emulators preserve saved pricing for Requester and Manager notes edits', { skip: !enabled, timeout: 60000 }, async () => {
  const suffix = randomUUID(); const projectId = 'demo-bluetap';
  const app = initAdmin({ projectId }, `notes-${suffix}`); const db = getFirestore(app); const adminAuth = getAdminAuth(app);
  const client = initClient({ projectId, apiKey: 'synthetic-local-key' }, `notes-client-${suffix}`); const auth = getAuth(client);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const requesterUid = `requester-${suffix}`; const managerUid = `manager-${suffix}`; const branchId = `branch-${suffix}`; const productId = `product-${suffix}`;
  const password = `Test-${suffix}-aA1!`; const requesterEmail = `${requesterUid}@example.test`; const managerEmail = `${managerUid}@example.test`;
  try {
    await adminAuth.createUser({ uid: requesterUid, email: requesterEmail, password });
    await adminAuth.createUser({ uid: managerUid, email: managerEmail, password });
    await adminAuth.setCustomUserClaims(managerUid, { manager: true, role: 'manager' });
    await Promise.all([
      db.doc(`users/${requesterUid}`).set({ role: 'requester', accountStatus: 'active', fullName: 'Test Requester', contactNumber: '09170000000', address: 'Test address' }),
      db.doc(`users/${managerUid}`).set({ role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId }),
      db.doc(`branches/${branchId}`).set({ name: 'Test Branch', status: 'active', latitude: 10.267, longitude: 123.584, baseDeliveryFee: 7 }),
      db.doc(`products/${productId}`).set({ product_name: 'Test Refill', price: 35, active: true, branchIds: [branchId] }),
    ]);
    const requesterToken = await (await signInWithEmailAndPassword(auth, requesterEmail, password)).user.getIdToken(true);
    const managerToken = await (await signInWithEmailAndPassword(auth, managerEmail, password)).user.getIdToken(true);
    const requester = createRequesterOrdersHandler(() => ({ auth: adminAuth, db }));
    const manager = createManagerDispatchHandler(() => ({ auth: adminAuth, db }));
    const created = await call(requester, 'POST', requesterToken, { branchId, container: 'Exchange', deliveryLocation: { latitude: 10.267, longitude: 123.584 }, items: [{ productId, quantity: 2 }] });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const orderId = created.body.order.id;
    await db.doc(`products/${productId}`).update({ price: 90 });
    const edited = await call(requester, 'PATCH', requesterToken, { orderId, action: 'edit-order', items: [{ productId, quantity: 2 }], container: 'Exchange', notes: 'Requester note' });
    assert.equal(edited.statusCode, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.order.totalAtOrder, 77);
    await db.doc(`requests/${orderId}`).update({ status: 'awaiting_distributor_assignment' });
    const managerEdit = await call(manager, 'PATCH', managerToken, { orderId, action: 'edit-order', items: [{ productId, quantity: 2 }], container: 'Exchange', notes: 'Manager note' });
    assert.equal(managerEdit.statusCode, 200, JSON.stringify(managerEdit.body));
    const stored = (await db.doc(`requests/${orderId}`).get()).data();
    assert.equal(stored.totalAtOrder, 77);
    assert.equal(stored.items[0].unitPriceAtOrder, 35);
    assert.equal(stored.editHistory.length, 2);
    assert.equal(stored.editHistory[1].previousPricing.totalAtOrder, 77);
    assert.equal(stored.editHistory[1].newPricing.totalAtOrder, 77);
  } finally { await deleteClient(client); await deleteAdmin(app); }
});
