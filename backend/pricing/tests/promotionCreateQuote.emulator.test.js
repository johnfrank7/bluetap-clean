const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: initClient, deleteApp: deleteClient } = require('firebase/app');
const { getAuth: clientAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { createRequesterOrdersHandler } = require('../../requester/orderingHandler');

const firestoreHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:18080' : '127.0.0.1:8080';
const authHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:19099' : '127.0.0.1:9099';
const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.FIRESTORE_EMULATOR_HOST === firestoreHost && process.env.FIREBASE_AUTH_EMULATOR_HOST === authHost;
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, token, body) { const res = response(); await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res); return res; }

test('guarded create quotes bind accepted pricing to the requester, intent and transaction dependencies', { skip: !enabled, timeout: 120000 }, async () => {
  const id = randomUUID(); const projectId = 'demo-bluetap';
  const app = initializeApp({ projectId }, `create-quote-${id}`); const db = getFirestore(app); const auth = getAuth(app);
  const client = initClient({ projectId, apiKey: 'synthetic-local-key' }, `create-quote-client-${id}`); const clientUser = clientAuth(client);
  connectAuthEmulator(clientUser, `http://${authHost}`, { disableWarnings: true });
  const uid = `quote-${id}`; const otherUid = `other-${id}`; const branchId = `branch-${id}`; const productId = `product-${id}`;
  const email = `${uid}@example.test`; const password = `Test-${id}-aA1!`;
  const promo = { id: `promo-${id}`, version: 1, title: 'Bundle', productId, active: true, commercialEligibility: 'refill_verified', branchIds: [branchId], containerChoices: ['Exchange'], tiers: [{ quantity: 3, bundlePriceCentavos: 5500 }] };
  try {
    await auth.createUser({ uid, email, password });
    await auth.createUser({ uid: otherUid, email: `${otherUid}@example.test`, password });
    await Promise.all([
      db.doc(`users/${uid}`).set({ role: 'requester', accountStatus: 'active', fullName: 'Test Requester', contactNumber: '09170000000', address: 'Test address' }),
      db.doc(`users/${otherUid}`).set({ role: 'requester', accountStatus: 'active', fullName: 'Other Requester', contactNumber: '09170000000', address: 'Test address' }),
      db.doc(`branches/${branchId}`).set({ name: 'Test Branch', status: 'active', latitude: 10.267, longitude: 123.584, baseDeliveryFee: 7 }),
      db.doc(`products/${productId}`).set({ product_name: 'Refill', price: 20, active: true, branchIds: [branchId], bundlePromotion: promo }),
    ]);
    const token = await (await signInWithEmailAndPassword(clientUser, email, password)).user.getIdToken(true);
    const handler = createRequesterOrdersHandler(() => ({ auth, db }), { emulatorPromotionPricing: true });
    const ordinary = createRequesterOrdersHandler(() => ({ auth, db }));
    const body = { branchId, container: 'Exchange', deliveryLocation: { latitude: 10.267, longitude: 123.584 }, items: [{ productId, quantity: 3 }] };
    const quote = async () => { const result = await call(handler, token, { ...body, action: 'quote-create' }); assert.equal(result.statusCode, 200, JSON.stringify(result.body)); return result.body; };
    assert.equal((await call(ordinary, token, { ...body, action: 'quote-create' })).body.error.reason, 'PROMOTIONS_UNAVAILABLE');
    assert.equal((await call(handler, token, body)).body.error.reason, 'CREATE_QUOTE_REQUIRED');
    const legacyRegular = await call(handler, token, { ...body, items: [{ productId, quantity: 4, unitPriceAtOrder: 0 }], totalAtOrder: 0 });
    assert.equal(legacyRegular.statusCode, 201);
    assert.equal(legacyRegular.body.order.totalAtOrder, 87);
    assert.equal(legacyRegular.body.order.pricingSnapshot.promotionalSavingsCentavos, 0);
    await db.doc(`requests/${legacyRegular.body.order.id}`).delete();
    await db.doc(`requesterActiveOrders/${uid}`).delete();
    const first = await quote();
    assert.equal(first.pricingSnapshot.regularSubtotalCentavos, 6000);
    assert.equal(first.pricingSnapshot.promotionalSavingsCentavos, 500);
    assert.equal(first.pricingSnapshot.deliveryFeeCentavos, 700);
    assert.equal(first.pricingSnapshot.payableCentavos, 6200);
    assert.equal((await call(ordinary, token, { ...body, quoteId: first.quoteId })).body.error.reason, 'PROMOTIONS_UNAVAILABLE');
    const otherToken = await (await signInWithEmailAndPassword(clientUser, `${otherUid}@example.test`, password)).user.getIdToken(true);
    assert.equal((await call(handler, otherToken, { ...body, quoteId: first.quoteId })).body.error.reason, 'CREATE_QUOTE_STALE');
    assert.equal((await call(handler, token, { ...body, items: [{ productId, quantity: 5 }], quoteId: first.quoteId })).body.error.reason, 'CREATE_QUOTE_STALE');
    await db.doc(`products/${productId}`).update({ price: 21 });
    assert.equal((await call(handler, token, { ...body, quoteId: first.quoteId })).body.error.reason, 'CREATE_QUOTE_STALE');
    await db.doc(`products/${productId}`).update({ price: 20 });
    const second = await quote();
    await db.doc(`branches/${branchId}`).update({ baseDeliveryFee: 8 });
    assert.equal((await call(handler, token, { ...body, quoteId: second.quoteId })).body.error.reason, 'CREATE_QUOTE_STALE');
    await db.doc(`branches/${branchId}`).update({ baseDeliveryFee: 7 });
    const third = await quote();
    await db.doc(`products/${productId}`).update({ bundlePromotion: { ...promo, active: false, version: 2 } });
    assert.equal((await call(handler, token, { ...body, quoteId: third.quoteId })).body.error.reason, 'CREATE_QUOTE_STALE');
    const withoutOffer = await quote();
    assert.equal(withoutOffer.pricingSnapshot.promotionalSavingsCentavos, 0);
    await db.doc(`products/${productId}`).update({ bundlePromotion: promo });
    const expired = await quote();
    await db.doc(`requesterCreateQuotes/${expired.quoteId}`).update({ expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await call(handler, token, { ...body, quoteId: expired.quoteId })).body.error.reason, 'CREATE_QUOTE_STALE');
    assert.equal((await db.collection('requests').where('requesterUid', '==', uid).get()).empty, true);
    const final = await quote();
    const created = await call(handler, token, { ...body, quoteId: final.quoteId });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    assert.equal(created.body.order.pricingSnapshot.payableCentavos, 6200);
    assert.equal((await db.doc(`requests/${created.body.order.id}`).get()).data().totalAtOrder, 62);
    await db.doc(`products/${productId}`).update({ bundlePromotion: { ...promo, active: false, version: 2 } });
    assert.equal((await db.doc(`requests/${created.body.order.id}`).get()).data().totalAtOrder, 62);
    assert.equal((await call(handler, token, { ...body, quoteId: final.quoteId })).body.error.reason, 'ACTIVE_ORDER_EXISTS');
  } finally { await deleteClient(client); await deleteApp(app); }
});
