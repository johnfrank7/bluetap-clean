const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Filter } = require('firebase-admin/firestore');
const { planDispatchTransition } = require('../../utils/distributorCapacityGuard');
const { createEmulatorReconciler } = require('../dispatchGuardReconciliation.emulator');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080'
  && process.env.GCLOUD_PROJECT === 'demo-bluetap' && process.env.BLUETAP_DISPATCH_PERF === '1';

test('emulator measures guard queries against growing synthetic delivered-order histories', { skip: !enabled, timeout: 180000 }, async () => {
  const suffix = randomUUID(); const app = initializeApp({ projectId: 'demo-bluetap' }, `dispatch-perf-${suffix}`);
  const db = getFirestore(app); const uid = `perf-${suffix}`; const branchId = `branch-${suffix}`;
  const reconciler = createEmulatorReconciler();
  const base = Date.now() + 86400000; const at = (minutes) => new Date(base + minutes * 60000);
  const add = async (start, end, other = false) => {
    for (let offset = start; offset < end; offset += 400) {
      const batch = db.batch();
      for (let i = offset; i < Math.min(offset + 400, end); i++) {
        const distributor = other ? `other-${suffix}` : uid;
        batch.set(db.doc(`requests/${other ? 'unrelated' : 'history'}-${suffix}-${i}`), { status: 'delivered', assignedDistributorUid: distributor, distributor_id: distributor, branchId });
      }
      await batch.commit();
    }
  };
  try {
    await db.doc(`users/${uid}`).set({ role: 'distributor', approvalStatus: 'active', branchId });
    const reservations = [];
    for (let i = 0; i < 4; i++) {
      const ref = db.doc(`requests/active-${suffix}-${i}`); const scheduledAt = at(i * 120);
      await ref.set({ status: 'scheduled', assignedDistributorUid: uid, distributor_id: uid, branchId, currentBranchId: branchId, scheduledAt });
      reservations.push({ orderId: ref.id, scheduledAt });
    }
    await db.doc(`distributorDispatchGuards/${uid}`).set({ schemaVersion: 1, initialized: true, distributorUid: uid, revision: 0, reservations });
    const pending = db.doc(`requests/pending-${suffix}`); await pending.set({ status: 'awaiting_distributor_assignment', branchId, currentBranchId: branchId });
    await add(0, 500, true);
    let previous = 0;
    for (const historyCount of [0, 100, 1000, 3000, 10000]) {
      await add(previous, historyCount); previous = historyCount;
      const startQuery = performance.now();
      const [canonical, legacy] = await Promise.all(['assignedDistributorUid', 'distributor_id'].map((field) => db.collection('requests').where(field, '==', uid).get()));
      const queryMs = performance.now() - startQuery;
      assert.equal(canonical.size, historyCount + 4); assert.equal(legacy.size, historyCount + 4);
      const filteredStart = performance.now();
      const filtered = await Promise.all(['assignedDistributorUid', 'distributor_id'].map((field) => db.collection('requests').where(field, '==', uid).where('status', '!=', 'delivered').get()));
      const filteredMs = performance.now() - filteredStart;
      assert.deepEqual(filtered.map((snapshot) => snapshot.size), [4, 4]);
      for (const snapshot of filtered) assert.deepEqual(new Set(snapshot.docs.map((doc) => doc.id)), new Set(reservations.map((entry) => entry.orderId)));
      const startUnion = performance.now();
      const union = await db.collection('requests').where(Filter.or(Filter.where('assignedDistributorUid', '==', uid), Filter.where('distributor_id', '==', uid))).get();
      const unionMs = performance.now() - startUnion;
      assert.deepEqual(new Set(union.docs.map((doc) => doc.id)), new Set([...canonical.docs, ...legacy.docs].map((doc) => doc.id)));
      const samples = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        await db.runTransaction(async (tx) => {
          const order = await tx.get(pending);
          return planDispatchTransition(tx, db, { orderId: pending.id, before: order.data(), after: { ...order.data(), status: 'scheduled', assignedDistributorUid: uid, scheduledAt: at(600) } });
        });
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      const scanCount = (await db.collection('requests').get()).size;
      const scanStart = performance.now(); const reconciliation = await reconciler.reconcile(uid); const reconciliationMs = performance.now() - scanStart;
      assert.equal(reconciliation.status, 'unchanged');
      console.log(`DISPATCH_PERF ${JSON.stringify({ historyCount, unrelatedCount: 500, baselineQuerySnapshots: canonical.size + legacy.size, filteredQuerySnapshots: filtered[0].size + filtered[1].size, candidateUnionSnapshots: union.size, baselineTransactionReads: 3 + canonical.size + legacy.size, filteredTransactionReads: 3 + filtered[0].size + filtered[1].size, candidateTransactionReads: 3 + union.size, baselineQueryMs: Math.round(queryMs), filteredQueryMs: Math.round(filteredMs), candidateUnionMs: Math.round(unionMs), filteredTransactionMs: samples.map(Math.round), reconciliationScannedOrders: scanCount, reconciliationMs: Math.round(reconciliationMs) })}`);
    }
  } finally { await reconciler.close(); await deleteApp(app); }
});
