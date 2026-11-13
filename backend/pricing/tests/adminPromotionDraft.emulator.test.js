const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: clientApp, deleteApp: deleteClient } = require('firebase/app');
const { getAuth: clientAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { createAdminProductsHandler } = require('../../admin/productManagementHandler');
const { createRequesterCatalogHandler } = require('../../requester/orderingHandler');

const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099';
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, method, token, body) { const res = response(); await handler({ method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body }, res); return res; }

test('draft-only endpoint persists authorized drafts without activating or exposing them', { skip: !enabled, timeout: 60000 }, async () => {
  const id = randomUUID(); const projectId = 'demo-bluetap'; const app = initializeApp({ projectId }, `draft-only-${id}`); const db = getFirestore(app); const auth = getAuth(app);
  const client = clientApp({ projectId, apiKey: 'synthetic-local-key' }, `draft-client-${id}`); const clientUser = clientAuth(client);
  connectAuthEmulator(clientUser, 'http://127.0.0.1:9099', { disableWarnings: true });
  const admin = `admin-${id}`; const requester = `requester-${id}`; const branch = `branch-${id}`; const product = `product-${id}`; const password = `Test-${id}-aA1!`;
  try {
    for (const [uid, role] of [[admin, 'admin'], [requester, 'requester']]) {
      await auth.createUser({ uid, email: `${uid}@example.test`, password });
      if (role === 'admin') await auth.setCustomUserClaims(uid, { admin: true, role: 'admin' });
      await db.doc(`users/${uid}`).set({ role, accountStatus: 'active', fullName: 'Test', contactNumber: '09170000000', address: 'Test address' });
    }
    await Promise.all([db.doc(`branches/${branch}`).set({ name: 'Branch', status: 'active', latitude: 10.267, longitude: 123.584 }), db.doc(`products/${product}`).set({ product_name: 'Refill', price: 25, active: true, branchIds: [branch] })]);
    const adminToken = await (await signInWithEmailAndPassword(clientUser, `${admin}@example.test`, password)).user.getIdToken(true);
    const requesterToken = await (await signInWithEmailAndPassword(clientUser, `${requester}@example.test`, password)).user.getIdToken(true);
    const getAdmin = () => ({ auth, db }); const handler = createAdminProductsHandler(getAdmin, { promotionDraftOnly: true, logger: {} });
    const draft = { expectedVersion: 0, title: 'Bundle', commercialEligibility: 'refill_verified', active: false, branchIds: [branch], containerChoices: ['Exchange'], tiers: [{ quantity: 3, bundlePriceCentavos: 7000 }], startMode: 'activation', startsAt: null, endsAt: null };
    assert.equal((await call(handler, 'GET', adminToken)).statusCode, 405);
    assert.equal((await call(handler, 'PATCH', adminToken, { productId: product, price: 5 })).body.error.reason, 'INVALID_BUNDLE_PROMOTION');
    assert.equal((await call(handler, 'PATCH', requesterToken, { productId: product, bundlePromotion: draft })).statusCode, 403);
    assert.equal((await call(handler, 'PATCH', adminToken, { productId: product, bundlePromotion: { ...draft, active: true } })).body.error.reason, 'BUNDLE_PROMOTIONS_UNAVAILABLE');
    assert.equal((await call(handler, 'PATCH', adminToken, { productId: product, bundlePromotion: { ...draft, tiers: [{ quantity: 3, bundlePriceCentavos: 0 }] } })).body.error.reason, 'INVALID_BUNDLE_PROMOTION');
    assert.equal((await call(handler, 'PATCH', adminToken, { productId: product, bundlePromotion: draft })).statusCode, 200);
    assert.equal((await db.doc(`products/${product}`).get()).data().bundlePromotion.version, 1);
    const updated = { ...draft, expectedVersion: 1, title: 'Updated', startsAt: '2099-01-01T00:00:00Z', endsAt: '2099-01-02T00:00:00Z', startMode: 'scheduled' };
    assert.equal((await call(handler, 'PATCH', adminToken, { productId: product, bundlePromotion: updated })).statusCode, 200);
    const saved = (await db.doc(`products/${product}`).get()).data().bundlePromotion;
    assert.equal(saved.title, 'Updated'); assert.equal(saved.active, false); assert.equal(saved.version, 2);
    assert.equal((await call(handler, 'PATCH', adminToken, { productId: product, bundlePromotion: updated })).body.error.reason, 'BUNDLE_PROMOTION_STALE');
    const catalog = await call(createRequesterCatalogHandler(getAdmin), 'GET', requesterToken);
    assert.equal(catalog.statusCode, 200); assert.equal(catalog.body.promotionPreviews, undefined); assert.equal(JSON.stringify(catalog.body).includes('Updated'), false);
  } finally { await deleteClient(client); await deleteApp(app); }
});
