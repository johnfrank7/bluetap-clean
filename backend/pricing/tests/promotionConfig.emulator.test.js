const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp: initAdmin, deleteApp: deleteAdmin } = require('firebase-admin/app');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: initClient, deleteApp: deleteClient } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { createAdminProductsHandler } = require('../../admin/productManagementHandler');
const { createRequesterOrdersHandler } = require('../../requester/orderingHandler');

const firestoreHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:18080' : '127.0.0.1:8080';
const authHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:19099' : '127.0.0.1:9099';
const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.FIRESTORE_EMULATOR_HOST === firestoreHost && process.env.FIREBASE_AUTH_EMULATOR_HOST === authHost;
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, method, token, body) { const res = response(); await handler({ method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body }, res); return res; }

test('real Auth and Firestore emulators enforce draft-only Admin configuration and authoritative order pricing', { skip: !enabled, timeout: 60000 }, async () => {
  const suffix = randomUUID(); const projectId = 'demo-bluetap';
  const app = initAdmin({ projectId }, `promotion-${suffix}`); const db = getFirestore(app); const adminAuth = getAdminAuth(app);
  const client = initClient({ projectId, apiKey: 'synthetic-local-key' }, `promotion-client-${suffix}`); const clientAuth = getAuth(client);
  connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });
  const adminUid = `admin-${suffix}`; const requesterUid = `requester-${suffix}`; const branchId = `branch-${suffix}`; const productId = `product-${suffix}`;
  const scheduledProductId = `scheduled-${suffix}`;
  const password = `Test-${suffix}-aA1!`; const adminEmail = `${adminUid}@example.test`; const requesterEmail = `${requesterUid}@example.test`;
  try {
    await adminAuth.createUser({ uid: adminUid, email: adminEmail, password });
    await adminAuth.createUser({ uid: requesterUid, email: requesterEmail, password });
    await adminAuth.setCustomUserClaims(adminUid, { admin: true, role: 'admin' });
    await Promise.all([
      db.doc(`users/${adminUid}`).set({ role: 'admin', accountStatus: 'active' }),
      db.doc(`users/${requesterUid}`).set({ role: 'requester', accountStatus: 'active', fullName: 'Test Requester', contactNumber: '09170000000', address: 'Test address' }),
      db.doc(`branches/${branchId}`).set({ name: 'Test Branch', status: 'active', latitude: 10.267, longitude: 123.584, baseDeliveryFee: 7 }),
      db.doc(`products/${productId}`).set({ product_name: 'Test Refill', price: 35, active: true, branchIds: [branchId] }),
      db.doc(`products/${scheduledProductId}`).set({ product_name: 'Scheduled Refill', price: 20, active: true, branchIds: [branchId] }),
    ]);
    const adminToken = await (await signInWithEmailAndPassword(clientAuth, adminEmail, password)).user.getIdToken(true);
    const requesterToken = await (await signInWithEmailAndPassword(clientAuth, requesterEmail, password)).user.getIdToken(true);
    const adminHandler = createAdminProductsHandler(() => ({ auth: adminAuth, db }), { logger: {} });
    const testAdmin = createAdminProductsHandler(() => ({ auth: adminAuth, db }), { logger: {}, emulatorPromotionPricing: true });
    const draft = { expectedVersion: 0, title: 'Test Bundle', commercialEligibility: 'refill_verified', active: false, branchIds: [branchId], containerChoices: ['Exchange'], tiers: [{ quantity: 3, bundlePriceCentavos: 9000 }] };
    const scheduled = { ...draft, title: 'Scheduled', tiers: [{ quantity: 3, bundlePriceCentavos: 5500 }], startsAt: '2099-01-01T08:30:00+08:00', endsAt: '2099-01-02T17:00:00+08:00' };
    assert.equal((await call(adminHandler, 'PATCH', adminToken, { productId: scheduledProductId, bundlePromotion: { ...scheduled, endsAt: '2098-01-01T00:00:00Z' } })).body.error.reason, 'INVALID_BUNDLE_PROMOTION');
    assert.equal((await call(adminHandler, 'PATCH', adminToken, { productId: scheduledProductId, bundlePromotion: scheduled })).statusCode, 200);
    let savedScheduled = (await db.doc(`products/${scheduledProductId}`).get()).data().bundlePromotion;
    assert.equal(savedScheduled.startsAt, '2099-01-01T00:30:00.000Z'); assert.equal(savedScheduled.endsAt, '2099-01-02T09:00:00.000Z');
    assert.equal((await call(adminHandler, 'PATCH', adminToken, { productId: scheduledProductId, bundlePromotion: { ...scheduled, expectedVersion: 1, title: 'Updated scheduled' } })).statusCode, 200);
    savedScheduled = (await db.doc(`products/${scheduledProductId}`).get()).data().bundlePromotion;
    assert.equal(savedScheduled.title, 'Updated scheduled'); assert.equal(savedScheduled.startsAt, '2099-01-01T00:30:00.000Z'); assert.equal(savedScheduled.endsAt, '2099-01-02T09:00:00.000Z');
    const scheduledPublished = await call(testAdmin, 'PATCH', adminToken, { productId: scheduledProductId, bundlePromotionAction: 'publish', expectedVersion: 2 });
    assert.equal(scheduledPublished.statusCode, 200); assert.equal(scheduledPublished.body.product.bundlePromotion.startsAt, savedScheduled.startsAt);
    assert.equal((await call(adminHandler, 'PATCH', adminToken, { productId: scheduledProductId, product_name: 'Reusable Container' })).statusCode, 200);
    const reset = (await db.doc(`products/${scheduledProductId}`).get()).data().bundlePromotion;
    assert.equal(reset.active, false); assert.equal(reset.commercialEligibility, ''); assert.equal(reset.version, 4);
    const resetAudit = await db.collection('adminAuditLogs').where('productId', '==', scheduledProductId).get();
    assert.ok(resetAudit.docs.some((entry) => entry.data().action === 'BUNDLE_PROMOTION_ELIGIBILITY_RESET'));
    assert.equal((await call(adminHandler, 'PATCH', requesterToken, { productId, bundlePromotion: draft })).statusCode, 403);
    await db.doc(`products/${productId}`).update({ maxQuantityPerRequester: 2 });
    assert.equal((await call(adminHandler, 'PATCH', adminToken, { productId, bundlePromotion: draft })).body.error.reason, 'INVALID_BUNDLE_PROMOTION');
    await db.doc(`branches/${branchId}`).update({ productPolicyOverrides: { [productId]: { maxQuantityPerRequester: 4 } } });
    assert.equal((await call(adminHandler, 'PATCH', adminToken, { productId, bundlePromotion: draft })).statusCode, 200);
    const catalog = await call(adminHandler, 'GET', adminToken);
    assert.equal(catalog.body.products.find((product) => product.id === productId).promotionBranchLimits[branchId], 4);
    assert.equal((await db.doc(`products/${productId}`).get()).data().bundlePromotion.endsAt, null);
    assert.equal((await call(adminHandler, 'PATCH', adminToken, { productId, bundlePromotion: { ...draft, expectedVersion: 1, active: true } })).body.error.reason, 'BUNDLE_PROMOTIONS_UNAVAILABLE');
    const publish = { productId, bundlePromotionAction: 'publish', expectedVersion: 1 };
    assert.equal((await call(adminHandler, 'PATCH', adminToken, publish)).body.error.reason, 'BUNDLE_PROMOTIONS_UNAVAILABLE');
    assert.equal((await call(testAdmin, 'PATCH', requesterToken, publish)).statusCode, 403);
    const published = await call(testAdmin, 'PATCH', adminToken, publish);
    assert.equal(published.statusCode, 200, JSON.stringify(published.body));
    assert.equal(published.body.product.bundlePromotion.active, true);
    assert.equal(published.body.product.bundlePromotion.version, 2);
    assert.equal(published.body.product.bundlePromotion.startsAt, published.body.product.bundlePromotion.updatedAt.toISOString());
    assert.equal((await call(testAdmin, 'PATCH', adminToken, publish)).body.error.reason, 'BUNDLE_PROMOTION_STALE');
    assert.equal((await call(testAdmin, 'PATCH', adminToken, { productId, bundlePromotionAction: 'disable', expectedVersion: 2 })).statusCode, 200);
    const disabled = (await db.doc(`products/${productId}`).get()).data().bundlePromotion;
    assert.equal(disabled.active, false);
    assert.ok(disabled.disabledAt);
    assert.equal(disabled.disabledBy, adminUid);
    assert.equal(disabled.version, 3);
    const audit = await db.collection('adminAuditLogs').where('productId', '==', productId).get();
    assert.deepEqual(new Set(audit.docs.map((doc) => doc.data().action)), new Set(['BUNDLE_PROMOTION_UPDATED', 'BUNDLE_PROMOTION_PUBLISHED', 'BUNDLE_PROMOTION_DISABLED']));
    await db.doc(`branches/${branchId}`).update({ status: 'inactive' });
    assert.equal((await call(testAdmin, 'PATCH', adminToken, { ...publish, expectedVersion: 3 })).body.error.reason, 'INVALID_PRODUCT_BRANCH');
    await db.doc(`branches/${branchId}`).update({ status: 'active' });
    await db.doc(`products/${productId}`).update({ price: 29 });
    assert.equal((await call(testAdmin, 'PATCH', adminToken, { ...publish, expectedVersion: 3 })).body.error.reason, 'INVALID_BUNDLE_PROMOTION');
    await db.doc(`products/${productId}`).update({ price: 35 });
    await db.doc(`products/${productId}`).update({ bundlePromotion: { ...disabled, active: true, tiers: [] } });
    assert.equal((await call(testAdmin, 'PATCH', adminToken, { productId, bundlePromotionAction: 'disable', expectedVersion: 3 })).statusCode, 200);
    const wrappedDb = {
      collection: (...args) => db.collection(...args),
      runTransaction: async (callback) => {
        // Change both trusted inputs after the preliminary reads and before the transaction.
        await db.doc(`products/${productId}`).update({ price: 40 });
        await db.doc(`branches/${branchId}`).update({ baseDeliveryFee: 9 });
        return db.runTransaction(callback);
      },
    };
    const order = await call(createRequesterOrdersHandler(() => ({ auth: adminAuth, db: wrappedDb })), 'POST', requesterToken, { branchId, container: 'Exchange', deliveryLocation: { latitude: 10.267, longitude: 123.584 }, items: [{ productId, quantity: 3 }], totalAtOrder: 1 });
    assert.equal(order.statusCode, 201, JSON.stringify(order.body));
    assert.equal(order.body.order.totalAtOrder, 129);
    assert.equal((await db.doc(`requests/${order.body.order.id}`).get()).data().totalAtOrder, 129);
  } finally { await deleteClient(client); await deleteAdmin(app); }
});
