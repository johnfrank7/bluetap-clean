const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: clientApp, deleteApp: deleteClient } = require('firebase/app');
const { getAuth: clientAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { createRequesterOrdersHandler } = require('../../requester/orderingHandler');
const { createManagerDispatchHandler } = require('../../manager/dispatchHandler');
const { calculateBundlePricing } = require('../bundlePricing');
const firestoreHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:18080' : '127.0.0.1:8080';
const authHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:19099' : '127.0.0.1:9099';
const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.FIRESTORE_EMULATOR_HOST === firestoreHost && process.env.FIREBASE_AUTH_EMULATOR_HOST === authHost;
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, token, body) { const res = response(); await handler({ method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body }, res); return res; }

test('Requester and Manager promotional edits preserve snapshots, reject stale quotes and apply once', { skip: !enabled, timeout: 120000 }, async () => {
  const id = randomUUID(); const projectId = 'demo-bluetap'; const app = initializeApp({ projectId }, `promo-edit-${id}`); const db = getFirestore(app); const auth = getAuth(app);
  const client = clientApp({ projectId, apiKey: 'synthetic-local-key' }, `promo-edit-client-${id}`); const authClient = clientAuth(client); connectAuthEmulator(authClient, `http://${authHost}`, { disableWarnings: true });
  const requester = `requester-${id}`; const manager = `manager-${id}`; const other = `other-${id}`; const branch = `branch-${id}`; const otherBranch = `other-branch-${id}`; const product = `product-${id}`; const otherProduct = `other-product-${id}`;
  const password = `Test-${id}-aA1!`; const email = (uid) => `${uid}@example.test`;
  const promo = { id: 'test-promo', version: 1, title: 'Bundle', productId: product, commercialEligibility: 'refill_verified', active: true, branchIds: [branch], containerChoices: ['Exchange'], tiers: [{ quantity: 3, bundlePriceCentavos: 5500 }, { quantity: 5, bundlePriceCentavos: 9000 }] };
  try {
    for (const uid of [requester, manager, other]) await auth.createUser({ uid, email: email(uid), password });
    for (const uid of [manager, other]) await auth.setCustomUserClaims(uid, { manager: true, role: 'manager' });
    await Promise.all([
      db.doc(`users/${requester}`).set({ role: 'requester', accountStatus: 'active', fullName: 'Test Requester', contactNumber: '09170000000', address: 'Test address' }),
      db.doc(`users/${manager}`).set({ role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: branch }), db.doc(`users/${other}`).set({ role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: otherBranch }),
      db.doc(`branches/${branch}`).set({ name: 'Test Branch', status: 'active', latitude: 10.267, longitude: 123.584, baseDeliveryFee: 7 }), db.doc(`branches/${otherBranch}`).set({ name: 'Other', status: 'active', latitude: 10.3, longitude: 123.6 }),
      db.doc(`products/${product}`).set({ product_name: 'Refill', price: 20, active: true, branchIds: [branch], bundlePromotion: promo }), db.doc(`products/${otherProduct}`).set({ product_name: 'Other', price: 20, active: true, branchIds: [branch] }),
    ]);
    const tokens = {}; for (const uid of [requester, manager, other]) tokens[uid] = await (await signInWithEmailAndPassword(authClient, email(uid), password)).user.getIdToken(true);
    const requesterHandler = createRequesterOrdersHandler(() => ({ auth, db }), { emulatorPromotionPricing: true }); const managerHandler = createManagerDispatchHandler(() => ({ auth, db }), { emulatorPromotionPricing: true });
    const newOrder = async (role) => {
      const ref = db.collection('requests').doc(); const item = { productId: product, productNameSnapshot: 'Refill', unitPriceAtOrder: 20, quantity: 3, totalAtOrder: 55 };
      const pricingSnapshot = calculateBundlePricing({ items: [{ ...item, promotions: [promo] }], branchId: branch, container: 'Exchange', deliveryFee: 7 });
      await ref.set({ requesterUid: requester, requester_id: requester, status: role === 'requester' ? 'Pending' : 'awaiting_distributor_assignment', branchId: branch, currentBranchId: branch, initialBranchId: branch, container: 'Exchange', quantity: 3, items: [item], subtotalAtOrder: 60, discountAmount: 5, deliveryFeeAtOrder: 7, totalAtOrder: 62, total_cost: 62, pricingSnapshot }); return ref;
    };
    for (const role of ['requester', 'manager']) {
      const handler = role === 'requester' ? requesterHandler : managerHandler; const token = tokens[role === 'requester' ? requester : manager];
      const intent = (ref, quantity, extra = {}) => ({ orderId: ref.id, action: 'quote-edit', items: [{ productId: product, quantity }], container: 'Exchange', notes: 'Test', ...extra });
      const confirm = (draft, quoteId) => ({ ...draft, action: 'edit-order', quoteId });
      const disabledHandler = role === 'requester' ? createRequesterOrdersHandler(() => ({ auth, db })) : createManagerDispatchHandler(() => ({ auth, db }));
      const rollbackRef = await newOrder(role); const rollbackDraft = intent(rollbackRef, 5); const beforeRollback = await call(handler, token, rollbackDraft);
      assert.equal(beforeRollback.statusCode, 200); assert.equal(beforeRollback.body.after.discountAmount, 10);
      assert.equal((await call(disabledHandler, token, confirm(rollbackDraft, beforeRollback.body.quoteId))).body.error.reason, 'EDIT_QUOTE_STALE');
      assert.equal((await rollbackRef.get()).data().totalAtOrder, 62);
      const afterRollback = await call(disabledHandler, token, rollbackDraft);
      assert.equal(afterRollback.statusCode, 200); assert.equal(afterRollback.body.after.discountAmount, 0); assert.equal(afterRollback.body.after.totalAtOrder, 107);
      assert.equal((await call(disabledHandler, token, confirm(rollbackDraft, afterRollback.body.quoteId))).statusCode, 200);
      const ref = await newOrder(role); const draft = intent(ref, 5); const quote = await call(handler, token, draft);
      assert.equal(quote.statusCode, 200, JSON.stringify(quote.body)); assert.equal(quote.body.before.discountAmount, 5); assert.equal(quote.body.after.discountAmount, 10); assert.equal(quote.body.before.totalAtOrder, 62); assert.equal(quote.body.after.totalAtOrder, 97);
      assert.equal((await call(handler, token, { ...confirm(draft, quote.body.quoteId), notes: 'tampered' })).body.error.reason, 'INVALID_EDIT_QUOTE');
      const confirmed = await Promise.all([call(handler, token, confirm(draft, quote.body.quoteId)), call(handler, token, confirm(draft, quote.body.quoteId))]); assert.deepEqual(confirmed.map((r) => r.statusCode), [200, 200]);
      const saved = (await ref.get()).data(); assert.equal(saved.totalAtOrder, 97); assert.equal(saved.editHistory.length, 1); assert.equal(saved.editHistory[0].previousPricing.pricingSnapshot.items[0].promotion.tierQuantity, 3); assert.equal(saved.editHistory[0].newPricing.pricingSnapshot.items[0].promotion.tierQuantity, 5);
      const note = await call(handler, token, { ...intent(ref, 5), action: 'edit-order', notes: 'Only notes' }); assert.equal(note.statusCode, 200, JSON.stringify(note.body)); assert.equal((await ref.get()).data().discountAmount, 10);
      for (const [extra, expected, discount] of [[{}, 87, 0], [{ container: 'New Container' }, 87, 0], [{ items: [{ productId: otherProduct, quantity: 4 }] }, 87, 0]]) {
        const order = await newOrder(role); const offered = await call(handler, token, intent(order, 4, extra)); assert.equal(offered.statusCode, 200, JSON.stringify(offered.body)); assert.equal(offered.body.after.totalAtOrder, expected); assert.equal(offered.body.after.discountAmount, discount); assert.equal((await call(handler, token, confirm(intent(order, 4, extra), offered.body.quoteId))).statusCode, 200);
      }
      await db.doc(`products/${otherProduct}`).update({ price: 55 });
      const sameRef = await newOrder(role); const sameDraft = intent(sameRef, 1, { items: [{ productId: otherProduct, quantity: 1 }] }); const sameQuote = await call(handler, token, sameDraft);
      assert.equal(sameQuote.statusCode, 200, JSON.stringify(sameQuote.body)); assert.equal(sameQuote.body.before.totalAtOrder, sameQuote.body.after.totalAtOrder); assert.equal(sameQuote.body.requiresConfirmation, true);
      assert.equal((await call(handler, token, { ...sameDraft, action: 'edit-order' })).body.error.reason, 'EDIT_QUOTE_REQUIRED'); assert.equal((await call(handler, token, confirm(sameDraft, sameQuote.body.quoteId))).statusCode, 200);
      await db.doc(`products/${otherProduct}`).update({ price: 20 });
      const staleRef = await newOrder(role); const staleDraft = intent(staleRef, 5); const staleQuote = await call(handler, token, staleDraft); await db.doc(`products/${product}`).update({ bundlePromotion: { ...promo, version: 2, active: false } });
      assert.equal((await call(handler, token, confirm(staleDraft, staleQuote.body.quoteId))).body.error.reason, 'EDIT_QUOTE_STALE'); assert.equal((await staleRef.get()).data().totalAtOrder, 62);
      const disabled = await call(handler, token, staleDraft); assert.equal(disabled.statusCode, 200, JSON.stringify(disabled.body)); assert.equal(disabled.body.before.discountAmount, 5); assert.equal(disabled.body.after.discountAmount, 0); assert.equal(disabled.body.after.totalAtOrder, 107);
      await db.doc(`products/${product}`).update({ bundlePromotion: { ...promo, endsAt: '2000-01-01T00:00:00Z' } });
      const expired = await call(handler, token, staleDraft); assert.equal(expired.statusCode, 200); assert.equal(expired.body.before.discountAmount, 5); assert.equal(expired.body.after.discountAmount, 0);
      await db.doc(`products/${product}`).update({ bundlePromotion: promo });
      const timedRef = await newOrder(role); const timedDraft = intent(timedRef, 5);
      await db.doc(`products/${product}`).update({ bundlePromotion: { ...promo, endsAt: new Date(Date.now() + 5000).toISOString() } });
      const timedQuote = await call(handler, token, timedDraft); assert.equal(timedQuote.statusCode, 200, JSON.stringify(timedQuote.body)); assert.equal(timedQuote.body.after.discountAmount, 10);
      await new Promise((resolve) => setTimeout(resolve, 5500));
      assert.equal((await call(handler, token, confirm(timedDraft, timedQuote.body.quoteId))).body.error.reason, 'EDIT_QUOTE_STALE'); assert.equal((await timedRef.get()).data().totalAtOrder, 62);
      await db.doc(`products/${product}`).update({ bundlePromotion: promo });
      const changedRef = await newOrder(role); const changedDraft = intent(changedRef, 5); const changedQuote = await call(handler, token, changedDraft); await db.doc(`products/${product}`).update({ price: 21 });
      assert.equal((await call(handler, token, confirm(changedDraft, changedQuote.body.quoteId))).body.error.reason, 'EDIT_QUOTE_STALE'); await db.doc(`products/${product}`).update({ price: 20 });
      const revisionRef = await newOrder(role); const revisionDraft = intent(revisionRef, 5); const revisionQuote = await call(handler, token, revisionDraft); await revisionRef.update({ notes: 'Changed concurrently' });
      assert.equal((await call(handler, token, confirm(revisionDraft, revisionQuote.body.quoteId))).body.error.reason, 'EDIT_QUOTE_STALE');
      const alteredRef = await newOrder(role); const alteredDraft = intent(alteredRef, 5); const alteredQuote = await call(handler, token, alteredDraft);
      const quotePath = role === 'requester' ? `requesterEditQuotes/${alteredQuote.body.quoteId}` : `managerEditQuotes/${alteredQuote.body.quoteId}`;
      await db.doc(quotePath).update(role === 'requester' ? { 'updates.totalAtOrder': 1 } : { totalAtOrder: 1 });
      assert.equal((await call(handler, token, confirm(alteredDraft, alteredQuote.body.quoteId))).body.error.reason, 'EDIT_QUOTE_STALE'); assert.equal((await alteredRef.get()).data().totalAtOrder, 62);
      const legacy = await newOrder(role); await legacy.update({ 'pricingSnapshot.payableCentavos': 1 }); assert.equal((await call(handler, token, intent(legacy, 5))).body.error.reason, 'EDIT_PRICING_UNAVAILABLE');
      const incomplete = await newOrder(role); await incomplete.update({ items: [{ productId: product, productNameSnapshot: 'Refill', quantity: 3, totalAtOrder: 55 }] }); assert.equal((await call(handler, token, intent(incomplete, 5))).body.error.reason, 'EDIT_PRICING_UNAVAILABLE');
      const legacyIncomplete = await newOrder(role); await legacyIncomplete.set({ requesterUid: requester, requester_id: requester, status: role === 'requester' ? 'Pending' : 'awaiting_distributor_assignment', branchId: branch, currentBranchId: branch, initialBranchId: branch, container: 'Exchange', items: [{ productId: product, quantity: 3 }], deliveryFeeAtOrder: 7, totalAtOrder: 67 }); assert.equal((await call(handler, token, intent(legacyIncomplete, 5))).body.error.reason, 'EDIT_PRICING_UNAVAILABLE');
      const transferred = await newOrder(role); await transferred.update({ initialBranchId: otherBranch }); assert.equal((await call(handler, token, intent(transferred, 5))).body.error.reason, 'EDIT_TRANSFER_PRICING_REVIEW_REQUIRED');
      if (role === 'manager') assert.equal((await call(handler, tokens[other], intent(await newOrder(role), 5))).statusCode, 403);
      if (role === 'requester') assert.notEqual((await call(handler, tokens[other], intent(await newOrder(role), 5))).statusCode, 200);
    }
  } finally { await deleteClient(client); await deleteApp(app); }
});
