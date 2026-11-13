const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createRequesterOrdersHandler } = require('../orderingHandler');
const { createManagerDispatchHandler } = require('../../manager/dispatchHandler');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.GCLOUD_PROJECT === 'demo-bluetap';
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, token, body) {
  const res = response();
  await handler({ method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

test('emulator rejects a pending Requester edit after Manager assignment commits', { skip: !enabled, timeout: 30000 }, async () => {
  const suffix = randomUUID();
  const app = initializeApp({ projectId: 'demo-bluetap' }, `pending-race-${suffix}`);
  const db = getFirestore(app);
  const requesterUid = `requester-${suffix}`; const managerUid = `manager-${suffix}`;
  const distributorUid = `distributor-${suffix}`; const branchId = `branch-${suffix}`;
  const productId = `product-${suffix}`; const orderId = `order-${suffix}`;
  const auth = {
    async verifyIdToken(token) {
      if (token === 'requester-test') return { uid: requesterUid, role: 'requester' };
      if (token === 'manager-test') return { uid: managerUid, role: 'manager', manager: true };
      throw new Error('Invalid test token');
    },
    async getUser(uid) { return { uid, disabled: false }; },
  };
  try {
    await Promise.all([
      db.doc(`users/${requesterUid}`).set({ role: 'requester', accountStatus: 'active' }),
      db.doc(`users/${managerUid}`).set({ role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId }),
      db.doc(`users/${distributorUid}`).set({ role: 'distributor', approvalStatus: 'active', accountStatus: 'active', branchId, fullName: 'Test Distributor' }),
      db.doc(`distributorDispatchGuards/${distributorUid}`).set({ schemaVersion: 1, initialized: true, distributorUid, revision: 0, reservations: [] }),
      db.doc(`branches/${branchId}`).set({ name: 'Test Branch', status: 'active', latitude: 10.267, longitude: 123.584 }),
      db.doc(`products/${productId}`).set({ product_name: 'Test Water', price: 35, active: true, branchIds: [branchId] }),
      db.doc(`requests/${orderId}`).set({ status: 'pending', requesterUid, requester_id: requesterUid, branchId, currentBranchId: branchId, quantity: 1, items: [{ productId, quantity: 1, totalAtOrder: 35 }], subtotalAtOrder: 35, deliveryFeeAtOrder: 0, totalAtOrder: 35 }),
    ]);
    const requester = createRequesterOrdersHandler(() => ({ auth, db }));
    const manager = createManagerDispatchHandler(() => ({ auth, db }));
    const intent = { orderId, items: [{ productId, quantity: 3 }] };
    const quote = await call(requester, 'requester-test', { ...intent, action: 'quote-edit' });
    assert.equal(quote.statusCode, 200, JSON.stringify(quote.body));
    assert.equal((await call(manager, 'manager-test', { orderId, action: 'accept-order' })).statusCode, 200);
    assert.equal((await call(manager, 'manager-test', { orderId, action: 'assign-distributor', distributorUid, scheduledAt: new Date(Date.now() + 86400000).toISOString() })).statusCode, 200);
    const result = await call(requester, 'requester-test', { ...intent, action: 'edit-order', quoteId: quote.body.quoteId });
    assert.equal(result.statusCode, 409);
    const persisted = (await db.doc(`requests/${orderId}`).get()).data();
    assert.equal(persisted.status, 'distributor_assigned');
    assert.equal(persisted.assignedDistributorUid, distributorUid);
    assert.equal(persisted.quantity, 1);
  } finally { await deleteApp(app); }
});
