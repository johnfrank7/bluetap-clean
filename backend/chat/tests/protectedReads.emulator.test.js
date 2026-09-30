const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, query, where, terminate } = require('firebase/firestore');

const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = 'demo-bluetap';
const apps = [];
function client(uid, claims = {}) {
  const app = initializeApp({ projectId: project }, `${uid}-${apps.length}`);
  const db = getFirestore(app);
  const [hostname, port] = host.split(':');
  connectFirestoreEmulator(db, hostname, Number(port), { mockUserToken: { sub: uid, user_id: uid, ...claims } });
  apps.push({ app, db });
  return db;
}
function value(input) {
  if (input === null) return { nullValue: null };
  if (input instanceof Date) return { timestampValue: input.toISOString() };
  if (Array.isArray(input)) return { arrayValue: { values: input.map(value) } };
  if (typeof input === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(input).map(([key, item]) => [key, value(item)])) } };
  if (typeof input === 'boolean') return { booleanValue: input };
  if (typeof input === 'number') return { integerValue: String(input) };
  return { stringValue: input };
}
async function seed(path, input) {
  const response = await fetch(`http://${host}/v1/projects/${project}/databases/(default)/documents/${path}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify(value(input).mapValue) });
  assert.equal(response.ok, true, await response.text());
}
const denied = (operation) => assert.rejects(operation, (error) => error.code === 'permission-denied');

test('emulator: optional profile fields, own order queries, private chat signals and lifecycle rules', { skip: !host }, async () => {
  try {
    await seed('branches/a', { status: 'active' });
    await seed('branches/b', { status: 'active' });
    await seed('users/r1', { role: 'requester', accountStatus: 'active' });
    await seed('users/r2', { role: 'requester', accountStatus: 'active' });
    await seed('users/d1', { role: 'distributor', approvalStatus: 'approved', branchId: 'a' });
    await seed('users/m1', { role: 'manager', managerStatus: 'active', branchId: 'a' });
    await seed('users/m2', { role: 'manager', managerStatus: 'active', branchId: 'b' });
    await seed('requests/o1', { requester_id: 'r1', branchId: 'a', assignedDistributorUid: 'd1', status: 'out_for_delivery', deliveryLocation: { latitude: 10, longitude: 123 } });
    const r1 = client('r1'), r2 = client('r2'), d1 = client('d1'), m1 = client('m1', { role: 'manager' }), m2 = client('m2', { manager: true });
    assert.equal((await getDocs(query(collection(r1, 'requests'), where('requester_id', '==', 'r1')))).size, 1);
    await denied(getDoc(doc(r2, 'requests/o1')));
    assert.equal((await getDoc(doc(d1, 'requests/o1'))).exists(), true);
    await denied(getDocs(collection(r1, 'requests')));
    await getDoc(doc(r1, 'chatUserActivity/r1'));
    await denied(getDoc(doc(r2, 'chatUserActivity/r1')));
    await getDoc(doc(m1, 'chatBranchActivity/a'));
    await denied(getDoc(doc(m2, 'chatBranchActivity/a')));
    const conversation = { status: 'active', participantUserUids: ['r1', 'd1'], participantUserAccess: { r1: 'active', d1: 'active' }, participantBranchIds: ['a'], participantBranchAccess: { a: 'active' }, updatedAt: new Date() };
    await seed('chatConversations/c1', conversation);
    await seed('chatConversations/c1/messages/msg', { seq: 1, body: 'test message' });
    await getDoc(doc(m1, 'chatConversations/c1'));
    await denied(getDoc(doc(m2, 'chatConversations/c1')));
    assert.equal((await getDocs(collection(d1, 'chatConversations/c1/messages'))).size, 1);
    // Demonstrates why the old membership-only query cannot prove lifecycle authority.
    await denied(getDocs(query(collection(r1, 'chatConversations'), where('participantUserUids', 'array-contains', 'r1'))));
    await seed('chatConversations/c1', { ...conversation, accessEndsAt: new Date(1) });
    await denied(getDocs(collection(d1, 'chatConversations/c1/messages')));
    for (const change of [{ managerStatus: 'inactive' }, { accountStatus: 'terminated' }, { branchId: 'b' }]) {
      await seed('users/m1', { role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId: 'a', ...change });
      await denied(getDoc(doc(m1, 'chatBranchActivity/a')));
    }
  } finally {
    for (const { app, db } of apps) { await terminate(db); await deleteApp(app); }
  }
});
