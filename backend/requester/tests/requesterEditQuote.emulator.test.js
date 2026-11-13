const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp: initAdmin, deleteApp: deleteAdmin } = require('firebase-admin/app');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: initClient, deleteApp: deleteClient } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { createRequesterOrdersHandler } = require('../orderingHandler');

const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099';
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, token, body) { const res = response(); await handler({ method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body }, res); return res; }

test('Requester quotes are revision-bound, explicit, and idempotent on real Auth and Firestore emulators', { skip: !enabled, timeout: 60000 }, async () => {
  const suffix = randomUUID(); const projectId = 'demo-bluetap';
  const app = initAdmin({ projectId }, `edit-quote-${suffix}`); const db = getFirestore(app); const adminAuth = getAdminAuth(app);
  const client = initClient({ projectId, apiKey: 'synthetic-local-key' }, `edit-quote-client-${suffix}`); const auth = getAuth(client);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const uid = `requester-${suffix}`; const otherUid = `other-${suffix}`; const branch = `branch-${suffix}`; const product = `product-${suffix}`; const otherProduct = `other-product-${suffix}`;
  const password = `Test-${suffix}-aA1!`; const email = `${uid}@example.test`; const otherEmail = `${otherUid}@example.test`;
  try {
    await adminAuth.createUser({ uid, email, password });
    await adminAuth.createUser({ uid: otherUid, email: otherEmail, password });
    await Promise.all([
      db.doc(`users/${uid}`).set({ role: 'requester', accountStatus: 'active' }),
      db.doc(`users/${otherUid}`).set({ role: 'requester', accountStatus: 'active' }),
      db.doc(`branches/${branch}`).set({ name: 'Test Branch', status: 'active', latitude: 10.267, longitude: 123.584, baseDeliveryFee: 7 }),
      db.doc(`products/${product}`).set({ product_name: 'Water', price: 35, active: true, branchIds: [branch] }),
      db.doc(`products/${otherProduct}`).set({ product_name: 'Other water', price: 35, active: true, branchIds: [branch] }),
    ]);
    const token = await (await signInWithEmailAndPassword(auth, email, password)).user.getIdToken(true);
    const otherToken = await (await signInWithEmailAndPassword(auth, otherEmail, password)).user.getIdToken(true);
    const handler = createRequesterOrdersHandler(() => ({ auth: adminAuth, db }));
    const newOrder = async () => {
      const ref = db.collection('requests').doc();
      await ref.set({ requesterUid: uid, requester_id: uid, status: 'Pending', branchId: branch, currentBranchId: branch, container: 'Exchange', quantity: 1, items: [{ productId: product, productNameSnapshot: 'Water', unitPriceAtOrder: 35, totalAtOrder: 35, quantity: 1 }], subtotalAtOrder: 35, deliveryFeeAtOrder: 7, totalAtOrder: 42, total_cost: 42 });
      return ref;
    };
    const quoteFor = (orderId, items, container = 'Exchange') => ({ orderId, action: 'quote-edit', items, container, notes: 'Leave at gate' });
    const confirm = (intent, quoteId) => ({ ...intent, action: 'edit-order', quoteId });

    const order = await newOrder(); const intent = quoteFor(order.id, [{ productId: product, quantity: 3 }]);
    assert.equal((await call(handler, token, { ...intent, action: 'edit-order' })).body.error.reason, 'EDIT_QUOTE_REQUIRED');
    assert.equal((await call(handler, otherToken, intent)).statusCode, 404);
    const initial = (await order.get()).data();
    const quote = await call(handler, token, intent);
    assert.equal(quote.statusCode, 200, JSON.stringify(quote.body));
    assert.equal(quote.body.before.totalAtOrder, 42); assert.equal(quote.body.after.totalAtOrder, 112);
    assert.deepEqual((await order.get()).data(), initial); // Keep Editing produces no order write.
    assert.equal((await call(handler, token, confirm(intent, 'missing_quote'))).body.error.reason, 'INVALID_EDIT_QUOTE');
    assert.equal((await call(handler, token, { ...confirm(intent, quote.body.quoteId), notes: 'Changed' })).body.error.reason, 'INVALID_EDIT_QUOTE');
    const results = await Promise.all([call(handler, token, confirm(intent, quote.body.quoteId)), call(handler, token, confirm(intent, quote.body.quoteId))]);
    assert.deepEqual(results.map((result) => result.statusCode), [200, 200]);
    const persisted = (await order.get()).data();
    assert.equal(persisted.totalAtOrder, 112); assert.equal(persisted.editHistory.length, 1);
    assert.equal(persisted.editHistory[0].previousPricing.totalAtOrder, 42); assert.equal(persisted.editHistory[0].newPricing.totalAtOrder, 112);

    for (const scenario of ['order', 'product', 'branch', 'expired']) {
      const ref = await newOrder(); const proposal = quoteFor(ref.id, [{ productId: product, quantity: 2 }]);
      const offered = await call(handler, token, proposal); assert.equal(offered.statusCode, 200, JSON.stringify(offered.body));
      if (scenario === 'order') await ref.update({ notes: 'Concurrent change' });
      if (scenario === 'product') await db.doc(`products/${product}`).update({ price: 36 });
      if (scenario === 'branch') await db.doc(`branches/${branch}`).update({ baseDeliveryFee: 9 });
      if (scenario === 'expired') await db.doc(`requesterEditQuotes/${offered.body.quoteId}`).update({ expiresAt: new Date(0) });
      const rejected = await call(handler, token, confirm(proposal, offered.body.quoteId));
      assert.equal(rejected.statusCode, 409, scenario); assert.equal(rejected.body.error.reason, 'EDIT_QUOTE_STALE');
      assert.equal((await ref.get()).data().totalAtOrder, 42);
      if (scenario === 'product') await db.doc(`products/${product}`).update({ price: 35 });
      if (scenario === 'branch') await db.doc(`branches/${branch}`).update({ baseDeliveryFee: 7 });
    }
    for (const [items, container] of [[[{ productId: product, quantity: 1 }], 'New Container'], [[{ productId: otherProduct, quantity: 1 }], 'Exchange']]) {
      const ref = await newOrder(); const proposal = quoteFor(ref.id, items, container);
      const offered = await call(handler, token, proposal); assert.equal(offered.body.requiresConfirmation, true);
      assert.equal(offered.body.before.totalAtOrder, offered.body.after.totalAtOrder);
      assert.equal((await call(handler, token, confirm(proposal, offered.body.quoteId))).statusCode, 200);
    }
    const notesOrder = await newOrder();
    const notes = await call(handler, token, { orderId: notesOrder.id, action: 'edit-order', items: [{ productId: product, quantity: 1 }], container: 'Exchange', notes: 'Only notes' });
    assert.equal(notes.statusCode, 200); assert.equal(notes.body.order.totalAtOrder, 42);
  } finally { await deleteClient(client); await deleteAdmin(app); }
});
