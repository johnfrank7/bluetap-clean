const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: clientApp, deleteApp: deleteClient } = require('firebase/app');
const { getAuth: clientAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { createRequesterCatalogHandler } = require('../../requester/orderingHandler');
const firestoreHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:18080' : '127.0.0.1:8080';
const authHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:19099' : '127.0.0.1:9099';
const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.FIRESTORE_EMULATOR_HOST === firestoreHost && process.env.FIREBASE_AUTH_EMULATOR_HOST === authHost;
const response = () => ({ statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, token) { const res = response(); await handler({ method: 'GET', headers: { authorization: `Bearer ${token}` } }, res); return res; }

test('only isolated injected catalog advertises sanitized active eligible fixtures', { skip: !enabled, timeout: 60000 }, async () => {
  const id = randomUUID(); const projectId = 'demo-bluetap'; const app = initializeApp({ projectId }, `preview-${id}`); const db = getFirestore(app); const auth = getAuth(app);
  const client = clientApp({ projectId, apiKey: 'synthetic-local-key' }, `preview-client-${id}`); const authClient = clientAuth(client); connectAuthEmulator(authClient, `http://${authHost}`, { disableWarnings: true });
  const uid = `requester-${id}`; const branch = `branch-${id}`; const product = `product-${id}`; const password = `Test-${id}-aA1!`; const email = `${uid}@example.test`;
  const promo = { id: `promo-${id}`, version: 1, title: 'Bundle', productId: product, active: true, commercialEligibility: 'refill_verified', branchIds: [branch], containerChoices: ['Exchange'], tiers: [{ quantity: 3, bundlePriceCentavos: 5500 }, { quantity: 5, bundlePriceCentavos: 9000 }], updatedBy: 'private-admin' };
  try {
    await auth.createUser({ uid, email, password });
    await Promise.all([db.doc(`users/${uid}`).set({ role: 'requester', accountStatus: 'active', fullName: 'Test', contactNumber: '09170000000', address: 'Test address' }), db.doc(`branches/${branch}`).set({ name: 'Branch', status: 'active', latitude: 10.267, longitude: 123.584 }), db.doc(`products/${product}`).set({ product_name: 'Refill', price: 20, active: true, branchIds: [branch], bundlePromotion: promo })]);
    const token = await (await signInWithEmailAndPassword(authClient, email, password)).user.getIdToken(true); const getAdmin = () => ({ auth, db });
    const ordinary = await call(createRequesterCatalogHandler(getAdmin), token); assert.equal(ordinary.statusCode, 200); assert.equal(ordinary.body.promotionPreviews, undefined); assert.equal(JSON.stringify(ordinary.body).includes('private-admin'), false);
    const preview = createRequesterCatalogHandler(getAdmin, { emulatorPromotionPricing: true });
    const active = await call(preview, token); assert.equal(active.statusCode, 200); assert.equal(active.headers['Cache-Control'], 'no-store'); assert.equal(active.body.promotionPreviewOnly, true); const ownOffers = active.body.promotionPreviews.filter((offer) => offer.id === promo.id); assert.equal(ownOffers.length, 1); assert.deepEqual(ownOffers[0].tiers.map((tier) => tier.savingsCentavos), [500, 1000]); assert.equal(JSON.stringify(active.body).includes('private-admin'), false);
    await db.doc(`orderingRestrictions/${uid}`).set({ branches: { [branch]: { scope: 'branch_ordering', branchId: branch, endsAt: new Date(Date.now() + 60000) } } });
    assert.equal((await call(preview, token)).body.promotionPreviews.some((offer) => offer.id === promo.id), false);
    await db.doc(`orderingRestrictions/${uid}`).delete();
    await db.doc(`products/${product}`).update({ bundlePromotion: { ...promo, active: false } }); assert.equal((await call(preview, token)).body.promotionPreviews.some((offer) => offer.id === promo.id), false);
    assert.notEqual((await call(preview, 'invalid')).statusCode, 200);
  } finally { await deleteClient(client); await deleteApp(app); }
});
