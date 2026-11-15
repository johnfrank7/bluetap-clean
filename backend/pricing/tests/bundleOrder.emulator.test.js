const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: clientApp, deleteApp: deleteClient } = require('firebase/app');
const { getAuth: clientAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { createRequesterOrdersHandler } = require('../../requester/orderingHandler');

const firestoreHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:18080' : '127.0.0.1:8080';
const authHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:19099' : '127.0.0.1:9099';
const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.FIRESTORE_EMULATOR_HOST === firestoreHost && process.env.FIREBASE_AUTH_EMULATOR_HOST === authHost;
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, token, body) { const res = response(); await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res); return res; }
async function callPromotional(handler, token, body) {
  const quote = await call(handler, token, { ...body, action: 'quote-create' });
  if (quote.statusCode !== 200) return quote;
  return call(handler, token, { ...body, quoteId: quote.body.quoteId });
}

test('emulator-only bundle pricing is atomic, exact-tiered and cannot activate ordinary checkout', { skip: !enabled, timeout: 120000 }, async () => {
  const suffix = randomUUID(); const projectId = 'demo-bluetap';
  const app = initializeApp({ projectId }, `bundle-order-${suffix}`); const db = getFirestore(app); const auth = getAuth(app);
  const client = clientApp({ projectId, apiKey: 'synthetic-local-key' }, `bundle-client-${suffix}`); const authClient = clientAuth(client);
  connectAuthEmulator(authClient, `http://${authHost}`, { disableWarnings: true });
  const uid = `bundle-${suffix}`; const branchId = `branch-${suffix}`; const otherBranch = `other-${suffix}`; const productId = `product-${suffix}`; const otherProduct = `other-product-${suffix}`;
  const email = `${uid}@example.test`; const password = `Test-${suffix}-aA1!`;
  const promotion = { id: 'test-promo', version: 1, title: 'Test bundle', productId, commercialEligibility: 'refill_verified', active: true, branchIds: [branchId], containerChoices: ['Exchange'], tiers: [{ quantity: 3, bundlePriceCentavos: 5500 }, { quantity: 5, bundlePriceCentavos: 9000 }, { quantity: 10, bundlePriceCentavos: 18000 }] };
  try {
    await auth.createUser({ uid, email, password });
    await Promise.all([
      db.doc(`users/${uid}`).set({ role: 'requester', accountStatus: 'active', fullName: 'Test Requester', contactNumber: '09170000000', address: 'Test address' }),
      db.doc(`branches/${branchId}`).set({ name: 'Test Branch', status: 'active', latitude: 10.267, longitude: 123.584, baseDeliveryFee: 7 }),
      db.doc(`branches/${otherBranch}`).set({ name: 'Other Branch', status: 'active', latitude: 10.267, longitude: 123.584, baseDeliveryFee: 7 }),
      db.doc(`products/${productId}`).set({ product_name: 'Refill', price: 20, active: true, bundlePromotion: promotion }),
      db.doc(`products/${otherProduct}`).set({ product_name: 'Other', price: 20, active: true }),
    ]);
    const token = await (await signInWithEmailAndPassword(authClient, email, password)).user.getIdToken(true);
    const handler = createRequesterOrdersHandler(() => ({ auth, db }), { emulatorPromotionPricing: true });
    const ordinary = createRequesterOrdersHandler(() => ({ auth, db }));
    const body = (quantity, extra = {}) => ({ branchId, container: 'Exchange', deliveryLocation: { latitude: 10.267, longitude: 123.584 }, items: [{ productId, quantity, unitPriceAtOrder: 0, totalAtOrder: 0 }], totalAtOrder: 0, ...extra });
    const clear = async (order) => { if (order?.id) await db.doc(`requests/${order.id}`).delete(); await db.doc(`requesterActiveOrders/${uid}`).delete(); };
    for (const [quantity, savings] of [[1, 0], [2, 0], [3, 5], [4, 0], [5, 10], [6, 0], [10, 20]]) {
      const res = await callPromotional(handler, token, body(quantity)); assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      const order = (await db.doc(`requests/${res.body.order.id}`).get()).data();
      assert.equal(order.subtotalAtOrder, 20 * quantity); assert.equal(order.discountAmount, savings); assert.equal(order.deliveryFeeAtOrder, 7); assert.equal(order.totalAtOrder, quantity * 20 - savings + 7); assert.equal(order.total_cost, order.totalAtOrder);
      assert.equal(order.pricingSnapshot.regularSubtotalCentavos, quantity * 2000); assert.equal(order.pricingSnapshot.promotionalSavingsCentavos, savings * 100); assert.equal(order.pricingSnapshot.payableCentavos, order.totalAtOrder * 100);
      if (savings) { assert.equal(order.pricingSnapshot.items[0].promotion.id, promotion.id); assert.equal(order.pricingSnapshot.items[0].promotion.version, 1); }
      await clear(res.body.order);
    }
    for (const extra of [{ container: 'New Container' }, { branchId: otherBranch }, { items: [{ productId: otherProduct, quantity: 3 }] }]) {
      const res = await callPromotional(handler, token, body(3, extra)); assert.equal(res.statusCode, 201); assert.equal(res.body.order.discountAmount, 0); await clear(res.body.order);
    }
    for (const change of [{ active: false }, { startsAt: '2099-01-01T00:00:00Z' }, { endsAt: '2000-01-01T00:00:00Z' }]) {
      await db.doc(`products/${productId}`).update({ bundlePromotion: { ...promotion, ...change } });
      const res = await callPromotional(handler, token, body(3)); assert.equal(res.statusCode, 201); assert.equal(res.body.order.discountAmount, 0); await clear(res.body.order);
    }
    await db.doc(`products/${productId}`).update({ bundlePromotion: [promotion, { ...promotion, id: 'conflict' }] });
    assert.equal((await callPromotional(handler, token, body(3))).body.error.reason, 'PROMOTION_CONFLICT');
    await db.doc(`products/${productId}`).update({ bundlePromotion: { ...promotion, tiers: [{ quantity: 5, bundlePriceCentavos: -1 }] } });
    assert.equal((await callPromotional(handler, token, body(3))).body.error.reason, 'INVALID_PRICING');
    await db.doc(`products/${productId}`).update({ bundlePromotion: promotion });
    assert.equal((await callPromotional(handler, token, body(3, { items: [{ productId, quantity: 1 }, { productId, quantity: 2 }] }))).body.error.reason, 'DUPLICATE_ORDER_PRODUCT');
    const normal = await call(ordinary, token, body(3)); assert.equal(normal.statusCode, 201); assert.equal(normal.body.order.totalAtOrder, 67); assert.equal(normal.body.order.pricingSnapshot, undefined); await clear(normal.body.order);
    let changed = false;
    const wrappedDb = { projectId: db.projectId, _settings: db._settings, collection: (...args) => db.collection(...args), runTransaction: async (fn) => { if (!changed) { changed = true; await db.doc(`products/${productId}`).update({ price: 25, bundlePromotion: { ...promotion, version: 2 } }); await db.doc(`branches/${branchId}`).update({ baseDeliveryFee: 9 }); } return db.runTransaction(fn); } };
    const updated = await callPromotional(createRequesterOrdersHandler(() => ({ auth, db: wrappedDb }), { emulatorPromotionPricing: true }), token, body(3));
    assert.equal(updated.statusCode, 201, JSON.stringify(updated.body)); assert.equal(updated.body.order.subtotalAtOrder, 75); assert.equal(updated.body.order.totalAtOrder, 64); assert.equal(updated.body.order.pricingSnapshot.items[0].promotion.version, 2);
    await db.doc(`products/${productId}`).update({ bundlePromotion: { ...promotion, active: false } });
    assert.equal((await db.doc(`requests/${updated.body.order.id}`).get()).data().totalAtOrder, 64);
    assert.equal((await callPromotional(handler, token, body(3))).body.error.reason, 'ACTIVE_ORDER_EXISTS');
    assert.notEqual((await callPromotional(handler, 'invalid', body(3))).statusCode, 201);
    await clear(updated.body.order);
    await db.doc(`products/${productId}`).update({ price: 20, bundlePromotion: promotion });
    let concurrentWrite;
    const concurrentDb = { projectId: db.projectId, _settings: db._settings, collection: (...args) => db.collection(...args), runTransaction: (fn) => db.runTransaction((tx) => fn(new Proxy(tx, { get(target, key) { if (key === 'get') return async (ref) => { const snapshot = await target.get(ref); if (ref.path === `products/${productId}` && !concurrentWrite) concurrentWrite = db.doc(ref.path).update({ price: 25, bundlePromotion: { ...promotion, version: 2 } }); return snapshot; }; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } }))) };
    const raced = await callPromotional(createRequesterOrdersHandler(() => ({ auth, db: concurrentDb }), { emulatorPromotionPricing: true }), token, body(3));
    await concurrentWrite;
    if (raced.statusCode === 201) {
      const priced = (await db.doc(`requests/${raced.body.order.id}`).get()).data().pricingSnapshot;
      assert.ok((priced.items[0].promotion.version === 1 && priced.regularSubtotalCentavos === 6000) || (priced.items[0].promotion.version === 2 && priced.regularSubtotalCentavos === 7500));
    } else {
      assert.equal(raced.statusCode, 409, JSON.stringify(raced.body));
      assert.equal(raced.body.error.reason, 'CREATE_QUOTE_STALE');
      assert.equal((await db.doc(`requesterActiveOrders/${uid}`).get()).exists, false);
    }
  } finally { await deleteClient(client); await deleteApp(app); }
});
