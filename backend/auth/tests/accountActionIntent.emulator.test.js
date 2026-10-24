const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getFirestore: getAdminFirestore } = require('firebase-admin/firestore');
const { initializeApp: initializeClientApp, deleteApp: deleteClientApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, collection, getDoc, getDocs,
  setDoc, updateDoc, deleteDoc, terminate } = require('firebase/firestore');
const { authorizeAccountActionIntent, claimIntentLease, renewIntentLease } = require('../accountActionIntentService');

const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = 'demo-bluetap';
const now = new Date('2026-10-25T00:00:00Z');
const request = (targetUid, action, clientMutationId) =>
  ({ source: 'admin_account', targetUid, action, clientMutationId });

function adminAuth() {
  const calls = [];
  return { calls, auth: {
    async verifyIdToken(token, checkRevoked) {
      calls.push(['verify', token, checkRevoked]);
      if (token === 'admin-token') return { uid: 'admin-test', admin: true };
      if (token === 'forged-token') return { uid: 'forged-test', admin: true };
      throw Error('invalid');
    },
    async updateUser() { throw Error('Unexpected Firebase Auth mutation'); },
    async revokeRefreshTokens() { throw Error('Unexpected Firebase Auth mutation'); },
  } };
}

test('real Firestore serializes competing reservations, preserves replay and requires reconciliation after lease loss',
  { skip: !host }, async () => {
    const app = initializeAdminApp({ projectId }, `account-intent-${randomUUID()}`);
    const db = getAdminFirestore(app);
    const targetUid = `target-${randomUUID()}`;
    const otherUid = `other-${randomUUID()}`;
    const { auth, calls } = adminAuth();
    try {
      await Promise.all([
        db.collection('users').doc('admin-test').set({ role: 'admin', accountStatus: 'active' }),
        db.collection('users').doc(targetUid).set({ role: 'requester', accountStatus: 'active' }),
        db.collection('users').doc(otherUid).set({ role: 'requester', accountStatus: 'active' }),
        db.collection('users').doc('forged-test').set({ role: 'requester', accountStatus: 'active' }),
      ]);
      const create = (action, mutation, uid = targetUid, token = 'admin-token') =>
        authorizeAccountActionIntent({ db, auth, idToken: token, request: request(uid, action, mutation), now });
      await assert.rejects(create('suspend', 'forged-mutation', targetUid, 'forged-token'),
        (error) => error.reason === 'ADMIN_REQUIRED');
      await assert.rejects(create('suspend', 'missing-target', 'missing-user'),
        (error) => error.reason === 'ACCOUNT_NOT_FOUND');
      assert.equal((await db.collection('accountActionReservations').doc(targetUid).get()).exists, false);
      const abortedIntent = db.collection('accountActionIntents').doc(`aborted-${randomUUID()}`);
      const abortedReservation = db.collection('accountActionReservations').doc(otherUid);
      await assert.rejects(db.runTransaction(async (tx) => {
        await tx.get(abortedReservation);
        tx.create(abortedIntent, { probe: true });
        tx.create(abortedReservation, { probe: true });
        throw Error('forced abort');
      }), /forced abort/);
      assert.equal((await abortedIntent.get()).exists, false);
      assert.equal((await abortedReservation.get()).exists, false);

      const results = await Promise.allSettled([
        create('suspend', 'first-mutation'), create('terminate', 'second-mutation'),
      ]);
      assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1);
      const winner = results.find((entry) => entry.status === 'fulfilled').value;
      const loser = results.find((entry) => entry.status === 'rejected').reason;
      assert.ok(['ACCOUNT_ACTION_RESERVED', 10, 'aborted'].includes(loser.reason || loser.code));
      const intentId = winner.intent.id;
      const reservation = (await db.collection('accountActionReservations').doc(targetUid).get()).data();
      assert.equal(reservation.intentId, intentId);
      assert.equal((await db.collection('accountActionIntents').doc(intentId).get()).data().state, 'authorized');
      assert.equal((await create(winner.intent.action, winner.intent.action === 'suspend'
        ? 'first-mutation' : 'second-mutation')).created, false);
      await assert.rejects(create(winner.intent.action === 'suspend' ? 'terminate' : 'suspend',
        winner.intent.action === 'suspend' ? 'first-mutation' : 'second-mutation'),
      (error) => error.reason === 'ACCOUNT_ACTION_MUTATION_CONFLICT');

      const first = await claimIntentLease({ db, intentId, ownerId: 'executor-a', now, leaseMs: 1000 });
      assert.equal(first.state, 'applying');
      const later = new Date(now.getTime() + 1001);
      const second = await claimIntentLease({ db, intentId, ownerId: 'executor-b', now: later });
      assert.equal(second.state, 'reconcile_required');
      await assert.rejects(renewIntentLease({ db, intentId, ownerId: 'executor-a', generation: 1, now: later }),
        (error) => error.reason === 'ACCOUNT_ACTION_LEASE_STALE');
      assert.equal((await db.collection('accountActionReservations').doc(targetUid).get()).data().intentId, intentId);
      assert.equal((await db.collection('users').doc(targetUid).get()).data().accountStatus, 'active');
      assert.equal(calls.every((call) => call[0] === 'verify' && call[2] === true), true);
      assert.equal((await db.collection('accountActionIntents').where('targetUid', '==', otherUid).get()).empty, true);
    } finally { await deleteAdminApp(app); }
  });

test('real rules deny authenticated Admin and Requester direct access to both action collections',
  { skip: !host }, async () => {
    const app = initializeAdminApp({ projectId }, `account-rules-seed-${randomUUID()}`);
    const db = getAdminFirestore(app);
    const suffix = randomUUID();
    const adminUid = `admin-${suffix}`;
    const requesterUid = `requester-${suffix}`;
    const clients = [];
    const client = (uid, claims = {}) => {
      const clientApp = initializeClientApp({ projectId }, `account-rules-${randomUUID()}`);
      const clientDb = getFirestore(clientApp);
      const [hostname, port] = host.split(':');
      connectFirestoreEmulator(clientDb, hostname, Number(port),
        { mockUserToken: { sub: uid, user_id: uid, ...claims } });
      clients.push({ clientApp, clientDb });
      return clientDb;
    };
    const denied = (promise) => assert.rejects(promise, (error) => error.code === 'permission-denied');
    try {
      await Promise.all([
        db.collection('users').doc(adminUid).set({ role: 'admin', accountStatus: 'active' }),
        db.collection('users').doc(requesterUid).set({ role: 'requester', accountStatus: 'active' }),
      ]);
      for (const collectionName of ['accountActionIntents', 'accountActionReservations']) {
        const id = `private-${suffix}`;
        await db.collection(collectionName).doc(id).set({ private: true });
        for (const clientDb of [client(adminUid, { admin: true }), client(requesterUid)]) {
          const ref = doc(clientDb, collectionName, id);
          await denied(getDoc(ref));
          await denied(getDocs(collection(clientDb, collectionName)));
          await denied(setDoc(doc(clientDb, collectionName, `new-${suffix}`), { private: false }));
          await denied(updateDoc(ref, { private: false }));
          await denied(deleteDoc(ref));
        }
      }
    } finally {
      for (const item of clients) { await terminate(item.clientDb); await deleteClientApp(item.clientApp); }
      await deleteAdminApp(app);
    }
  });
