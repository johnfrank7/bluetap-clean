const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp: initAdmin, deleteApp: deleteAdmin } = require('firebase-admin/app');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: initClient, deleteApp: deleteClient } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { createManagerDispatchHandler } = require('../dispatchHandler');

const firestoreHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:18080' : '127.0.0.1:8080';
const authHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:19099' : '127.0.0.1:9099';
const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.FIRESTORE_EMULATOR_HOST === firestoreHost && process.env.FIREBASE_AUTH_EMULATOR_HOST === authHost;
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, token, body) { const res = response(); await handler({ method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body }, res); return res; }

test('Manager material quotes enforce branch, revisions, confirmation and idempotency on real emulators', { skip: !enabled, timeout: 90000 }, async () => {
  const suffix = randomUUID(); const projectId = 'demo-bluetap';
  const app = initAdmin({ projectId }, `manager-edit-${suffix}`); const db = getFirestore(app); const adminAuth = getAdminAuth(app);
  const client = initClient({ projectId, apiKey: 'synthetic-local-key' }, `manager-edit-client-${suffix}`); const auth = getAuth(client);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const uid = `manager-${suffix}`; const otherUid = `other-${suffix}`; const branch = `branch-${suffix}`; const otherBranch = `other-branch-${suffix}`; const product = `product-${suffix}`; const otherProduct = `other-product-${suffix}`;
  const password = `Test-${suffix}-aA1!`; const email = `${uid}@example.test`; const otherEmail = `${otherUid}@example.test`;
  try {
    await adminAuth.createUser({ uid, email, password }); await adminAuth.createUser({ uid: otherUid, email: otherEmail, password });
    await adminAuth.setCustomUserClaims(uid, { role: 'manager', manager: true }); await adminAuth.setCustomUserClaims(otherUid, { role: 'manager', manager: true });
    await Promise.all([
      db.doc(`users/${uid}`).set({ role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: branch }),
      db.doc(`users/${otherUid}`).set({ role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: otherBranch }),
      db.doc(`branches/${branch}`).set({ name: 'Test Branch', status: 'active', latitude: 10.267, longitude: 123.584, baseDeliveryFee: 7 }),
      db.doc(`branches/${otherBranch}`).set({ name: 'Other Branch', status: 'active', latitude: 10.3, longitude: 123.6 }),
      db.doc(`products/${product}`).set({ product_name: 'Water', price: 35, active: true, branchIds: [branch] }),
      db.doc(`products/${otherProduct}`).set({ product_name: 'Other water', price: 35, active: true, branchIds: [branch] }),
    ]);
    const token = await (await signInWithEmailAndPassword(auth, email, password)).user.getIdToken(true);
    const otherToken = await (await signInWithEmailAndPassword(auth, otherEmail, password)).user.getIdToken(true);
    const handler = createManagerDispatchHandler(() => ({ auth: adminAuth, db }));
    const newOrder = async () => { const ref = db.collection('requests').doc(); await ref.set({ requesterUid: `requester-${suffix}`, requester_id: `requester-${suffix}`, status: 'awaiting_distributor_assignment', branchId: branch, currentBranchId: branch, initialBranchId: branch, container: 'Exchange', quantity: 1, items: [{ productId: product, productNameSnapshot: 'Water', unitPriceAtOrder: 35, totalAtOrder: 35, quantity: 1 }], subtotalAtOrder: 35, deliveryFeeAtOrder: 7, totalAtOrder: 42, total_cost: 42 }); return ref; };
    const proposal = (orderId, items, container = 'Exchange') => ({ orderId, action: 'quote-edit', items, container, notes: 'Call first' });
    const confirm = (intent, quoteId) => ({ ...intent, action: 'edit-order', quoteId });
    const order = await newOrder(); const intent = proposal(order.id, [{ productId: product, quantity: 3 }]);
    assert.equal((await call(handler, token, { ...intent, action: 'edit-order' })).body.error.reason, 'EDIT_QUOTE_REQUIRED');
    assert.equal((await call(handler, otherToken, intent)).statusCode, 403);
    const before = (await order.get()).data(); const quote = await call(handler, token, intent);
    assert.equal(quote.statusCode, 200, JSON.stringify(quote.body)); assert.equal(quote.body.before.totalAtOrder, 42); assert.equal(quote.body.after.totalAtOrder, 112);
    assert.deepEqual((await order.get()).data(), before);
    assert.equal((await call(handler, token, confirm(intent, 'missing_quote'))).body.error.reason, 'INVALID_EDIT_QUOTE');
    assert.equal((await call(handler, token, { ...confirm(intent, quote.body.quoteId), notes: 'Changed' })).body.error.reason, 'INVALID_EDIT_QUOTE');
    const results = await Promise.all([call(handler, token, confirm(intent, quote.body.quoteId)), call(handler, token, confirm(intent, quote.body.quoteId))]);
    assert.deepEqual(results.map((result) => result.statusCode), [200, 200]);
    const persisted = (await order.get()).data(); assert.equal(persisted.totalAtOrder, 112); assert.equal(persisted.editHistory.length, 1); assert.equal(persisted.editHistory[0].previousPricing.totalAtOrder, 42); assert.equal(persisted.editHistory[0].newPricing.totalAtOrder, 112);
    for (const scenario of ['order', 'product', 'branch', 'expired']) {
      const ref = await newOrder(); const draft = proposal(ref.id, [{ productId: product, quantity: 2 }]); const offered = await call(handler, token, draft); assert.equal(offered.statusCode, 200, JSON.stringify(offered.body));
      if (scenario === 'order') await ref.update({ notes: 'Concurrent change' });
      if (scenario === 'product') await db.doc(`products/${product}`).update({ price: 36 });
      if (scenario === 'branch') await db.doc(`branches/${branch}`).update({ baseDeliveryFee: 9 });
      if (scenario === 'expired') await db.doc(`managerEditQuotes/${offered.body.quoteId}`).update({ expiresAt: new Date(0) });
      const denied = await call(handler, token, confirm(draft, offered.body.quoteId)); assert.equal(denied.statusCode, 409, scenario); assert.equal(denied.body.error.reason, 'EDIT_QUOTE_STALE'); assert.equal((await ref.get()).data().totalAtOrder, 42);
      if (scenario === 'product') await db.doc(`products/${product}`).update({ price: 35 });
      if (scenario === 'branch') await db.doc(`branches/${branch}`).update({ baseDeliveryFee: 7 });
    }
    for (const [items, container] of [[[{ productId: product, quantity: 1 }], 'New Container'], [[{ productId: otherProduct, quantity: 1 }], 'Exchange']]) {
      const ref = await newOrder(); const draft = proposal(ref.id, items, container); const offered = await call(handler, token, draft); assert.equal(offered.body.requiresConfirmation, true); assert.equal(offered.body.before.totalAtOrder, offered.body.after.totalAtOrder); assert.equal((await call(handler, token, confirm(draft, offered.body.quoteId))).statusCode, 200);
    }
    const noteRef = await newOrder(); await db.doc(`products/${product}`).update({ price: 90 });
    const note = await call(handler, token, { orderId: noteRef.id, action: 'edit-order', items: [{ productId: product, quantity: 1 }], container: 'Exchange', notes: 'Only notes' });
    assert.equal(note.statusCode, 200); assert.equal((await noteRef.get()).data().totalAtOrder, 42);
    const transferred = await newOrder(); await transferred.update({ initialBranchId: otherBranch });
    assert.equal((await call(handler, token, proposal(transferred.id, [{ productId: product, quantity: 2 }]))).body.error.reason, 'EDIT_TRANSFER_PRICING_REVIEW_REQUIRED');
  } finally { await deleteClient(client); await deleteAdmin(app); }
});
