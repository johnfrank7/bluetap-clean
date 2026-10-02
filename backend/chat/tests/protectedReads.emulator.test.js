const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase/app');
const {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  setDoc,
  terminate,
} = require('firebase/firestore');

const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = 'demo-bluetap';
const apps = [];

function client(uid, claims = {}) {
  const app = initializeApp({ projectId: project }, `${uid}-${apps.length}`);
  const db = getFirestore(app);
  const [hostname, port] = host.split(':');
  connectFirestoreEmulator(db, hostname, Number(port), {
    mockUserToken: { sub: uid, user_id: uid, ...claims },
  });
  apps.push({ app, db });
  return db;
}

function value(input) {
  if (input === null) return { nullValue: null };
  if (input instanceof Date) return { timestampValue: input.toISOString() };
  if (Array.isArray(input)) return { arrayValue: { values: input.map(value) } };
  if (typeof input === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(input).map(([key, item]) => [key, value(item)])),
      },
    };
  }
  if (typeof input === 'boolean') return { booleanValue: input };
  if (typeof input === 'number') return { integerValue: String(input) };
  return { stringValue: input };
}

async function seed(path, input) {
  const response = await fetch(
    `http://${host}/v1/projects/${project}/databases/(default)/documents/${path}`,
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify(value(input).mapValue),
    },
  );
  assert.equal(response.ok, true, await response.text());
}

const denied = (operation) => assert.rejects(operation, (error) => error.code === 'permission-denied');

const activeConversation = {
  status: 'active',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function requesterBranch(overrides = {}) {
  return {
    ...activeConversation,
    type: 'requester_branch',
    requesterUid: 'r1',
    branchIds: ['a'],
    participantUserUids: ['r1'],
    participantUserAccess: { r1: 'active' },
    participantBranchIds: ['a'],
    participantBranchAccess: { a: 'active' },
    ...overrides,
  };
}

function requesterDistributor(overrides = {}) {
  return {
    ...activeConversation,
    type: 'requester_distributor',
    requesterUid: 'r1',
    distributorUid: 'd1',
    branchIds: ['a'],
    participantUserUids: ['r1', 'd1'],
    participantUserAccess: { r1: 'active', d1: 'active' },
    participantBranchIds: [],
    participantBranchAccess: {},
    ...overrides,
  };
}

function distributorBranch(overrides = {}) {
  return {
    ...activeConversation,
    type: 'distributor_branch',
    distributorUid: 'd1',
    branchIds: ['a'],
    participantUserUids: ['d1'],
    participantUserAccess: { d1: 'active' },
    participantBranchIds: ['a'],
    participantBranchAccess: { a: 'active' },
    ...overrides,
  };
}

function branchCoordination(overrides = {}) {
  return {
    ...activeConversation,
    type: 'branch_coordination',
    branchIds: ['a', 'b'],
    participantUserUids: [],
    participantUserAccess: {},
    participantBranchIds: ['a', 'b'],
    participantBranchAccess: { a: 'active', b: 'active' },
    ...overrides,
  };
}

async function seedConversation(id, conversation, body = 'test message') {
  await seed(`chatConversations/${id}`, conversation);
  await seed(`chatConversations/${id}/messages/msg`, { seq: 1, body });
}

test('Firestore authorization enforces canonical chat relationships', { skip: !host }, async (t) => {
  try {
    await seed('branches/a', { status: 'active' });
    await seed('branches/b', { status: 'active' });
    await seed('branches/c', { status: 'active' });
    await seed('users/r1', { role: 'requester', accountStatus: 'active' });
    await seed('users/r2', { role: 'requester', accountStatus: 'active' });
    await seed('users/d1', { role: 'distributor', approvalStatus: 'approved', branchId: 'a' });
    await seed('users/d2', { role: 'distributor', approvalStatus: 'approved', branchId: 'b' });
    await seed('users/m1', { role: 'manager', managerStatus: 'active', branchId: 'a' });
    await seed('users/m2', { role: 'manager', managerStatus: 'active', branchId: 'b' });
    await seed('users/m3', { role: 'manager', managerStatus: 'active', branchId: 'c' });
    await seed('users/a1', { role: 'admin', accountStatus: 'active' });
    await seed('requests/o1', {
      requester_id: 'r1',
      branchId: 'a',
      assignedDistributorUid: 'd1',
      status: 'out_for_delivery',
      deliveryLocation: { latitude: 10, longitude: 123 },
    });

    const r1 = client('r1');
    const r2 = client('r2');
    const d1 = client('d1');
    const d2 = client('d2');
    const m1 = client('m1', { role: 'manager' });
    const m2 = client('m2', { manager: true });
    const m3 = client('m3', { role: 'manager' });
    const a1 = client('a1', { admin: true });

    await t.test('private order, activity, and moderation reads remain scoped', async () => {
      assert.equal((await getDocs(query(collection(r1, 'requests'), where('requester_id', '==', 'r1')))).size, 1);
      await denied(getDoc(doc(r2, 'requests/o1')));
      assert.equal((await getDoc(doc(d1, 'requests/o1'))).exists(), true);
      await denied(getDocs(collection(r1, 'requests')));
      await getDoc(doc(r1, 'chatUserActivity/r1'));
      await denied(getDoc(doc(r2, 'chatUserActivity/r1')));
      await getDoc(doc(m1, 'chatBranchActivity/a'));
      await denied(getDoc(doc(m2, 'chatBranchActivity/a')));
      await getDoc(doc(r1, 'moderationActivity/user_r1'));
      await denied(getDoc(doc(r2, 'moderationActivity/user_r1')));
      await getDoc(doc(m1, 'moderationActivity/branch_a'));
      await denied(getDoc(doc(m2, 'moderationActivity/branch_a')));
      await getDoc(doc(a1, 'moderationActivity/admin'));
      await denied(getDoc(doc(a1, 'moderationActivity/branch_a')));
      await denied(getDocs(collection(a1, 'moderationActivity')));
    });

    await t.test('direct client mutation of protected chat and moderation data is denied', async () => {
      for (const path of [
        'chatReports/report',
        'moderationActions/action',
        'moderationMutationIds/mutation',
        'moderationNotices/r1/items/notice',
        'orderAbuseReviews/review',
        'chatMessageRevisions/revision',
        'chatRestrictions/r1',
        'orderingRestrictions/r1',
        'chatReportRateLimits/r1',
        'chatReportDuplicates/duplicate',
        'chatAuthorityRegistry/authority',
        'chatMutationIds/mutation',
        'chatRateLimits/r1',
      ]) {
        await denied(getDoc(doc(r1, path)));
        await denied(setDoc(doc(r1, path), { forged: true }));
        await denied(setDoc(doc(m1, path), { forged: true }));
      }
    });

    await t.test('valid requester_branch is allowed and cross-branch access is denied', async () => {
      await seedConversation('requester-branch-valid', requesterBranch());
      assert.equal((await getDoc(doc(r1, 'chatConversations/requester-branch-valid'))).exists(), true);
      assert.equal((await getDoc(doc(m1, 'chatConversations/requester-branch-valid'))).exists(), true);
      assert.equal((await getDocs(collection(r1, 'chatConversations/requester-branch-valid/messages'))).size, 1);
      await denied(getDoc(doc(m2, 'chatConversations/requester-branch-valid')));
      await denied(getDocs(collection(d1, 'chatConversations/requester-branch-valid/messages')));
    });

    await t.test('Requester-to-Requester conversation is denied', async () => {
      await seedConversation('requester-requester-denied', {
        ...activeConversation,
        type: 'requester_requester',
        requesterUid: 'r1',
        targetRequesterUid: 'r2',
        branchIds: [],
        participantUserUids: ['r1', 'r2'],
        participantUserAccess: { r1: 'active', r2: 'active' },
        participantBranchIds: [],
        participantBranchAccess: {},
      });
      await denied(getDoc(doc(r1, 'chatConversations/requester-requester-denied')));
      await denied(getDoc(doc(r2, 'chatConversations/requester-requester-denied')));
      await denied(getDocs(collection(r1, 'chatConversations/requester-requester-denied/messages')));
    });

    await t.test('unrelated Distributor is denied requester_distributor access', async () => {
      await seedConversation('requester-distributor-valid', requesterDistributor(), 'direct message');
      assert.equal((await getDoc(doc(r1, 'chatConversations/requester-distributor-valid'))).exists(), true);
      assert.equal((await getDocs(collection(d1, 'chatConversations/requester-distributor-valid/messages'))).size, 1);
      await denied(getDoc(doc(d2, 'chatConversations/requester-distributor-valid')));
      await denied(getDocs(collection(d2, 'chatConversations/requester-distributor-valid/messages')));
      await denied(getDoc(doc(m1, 'chatConversations/requester-distributor-valid')));
    });

    await t.test('forged requester_branch inquiry participants are denied', async () => {
      const forgeries = [
        ['extra-requester', requesterBranch({
          participantUserUids: ['r1', 'r2'],
          participantUserAccess: { r1: 'active', r2: 'active' },
        }), r1],
        ['wrong-branch-array', requesterBranch({
          branchIds: ['b'],
          participantBranchIds: ['a'],
        }), r1],
        ['unrelated-distributor', requesterBranch({
          participantUserUids: ['r1', 'd2'],
          participantUserAccess: { r1: 'active', d2: 'active' },
        }), r1],
        ['incorrect-branch-principal', requesterBranch({
          participantBranchIds: ['b'],
          participantBranchAccess: { b: 'active' },
        }), m2],
        ['forged-participant-access', requesterBranch({
          participantUserAccess: { r1: 'active', r2: 'active' },
        }), r1],
      ];

      for (const [suffix, conversation, actor] of forgeries) {
        const id = `forged-inquiry-${suffix}`;
        await seedConversation(id, conversation, 'forged inquiry');
        await denied(getDoc(doc(actor, `chatConversations/${id}`)));
        await denied(getDocs(collection(actor, `chatConversations/${id}/messages`)));
      }
    });

    await t.test('participant role mismatch is denied', async () => {
      await seedConversation('role-mismatch-requester-branch', requesterBranch({
        requesterUid: 'd1',
        participantUserUids: ['d1'],
        participantUserAccess: { d1: 'active' },
      }));
      await denied(getDoc(doc(d1, 'chatConversations/role-mismatch-requester-branch')));
      await denied(getDoc(doc(m1, 'chatConversations/role-mismatch-requester-branch')));

      await seedConversation('role-mismatch-requester-distributor', requesterDistributor({
        distributorUid: 'm1',
        participantUserUids: ['r1', 'm1'],
        participantUserAccess: { r1: 'active', m1: 'active' },
      }));
      await denied(getDoc(doc(r1, 'chatConversations/role-mismatch-requester-distributor')));
      await denied(getDoc(doc(m1, 'chatConversations/role-mismatch-requester-distributor')));
    });

    await t.test('unsupported conversation type is denied', async () => {
      await seedConversation('unsupported-type', {
        ...requesterBranch(),
        type: 'unsupported_relationship',
      });
      await denied(getDoc(doc(r1, 'chatConversations/unsupported-type')));
      await denied(getDoc(doc(m1, 'chatConversations/unsupported-type')));
    });

    await t.test('valid distributor_branch is allowed only to its Distributor and Branch principal', async () => {
      await seedConversation('distributor-branch-valid', distributorBranch(), 'station message');
      assert.equal((await getDoc(doc(d1, 'chatConversations/distributor-branch-valid'))).exists(), true);
      assert.equal((await getDoc(doc(m1, 'chatConversations/distributor-branch-valid'))).exists(), true);
      assert.equal((await getDocs(collection(d1, 'chatConversations/distributor-branch-valid/messages'))).size, 1);
      await denied(getDoc(doc(d2, 'chatConversations/distributor-branch-valid')));
      await denied(getDoc(doc(m2, 'chatConversations/distributor-branch-valid')));
    });

    await t.test('valid branch_coordination is allowed to participating Branch principals only', async () => {
      await seedConversation('branch-coordination-valid', branchCoordination(), 'branch coordination');
      assert.equal((await getDoc(doc(m1, 'chatConversations/branch-coordination-valid'))).exists(), true);
      assert.equal((await getDoc(doc(m2, 'chatConversations/branch-coordination-valid'))).exists(), true);
      assert.equal((await getDocs(collection(m1, 'chatConversations/branch-coordination-valid/messages'))).size, 1);
      await denied(getDoc(doc(m3, 'chatConversations/branch-coordination-valid')));
      await denied(getDoc(doc(r1, 'chatConversations/branch-coordination-valid')));
    });

    await t.test('malformed legacy conversation graphs are denied', async () => {
      const malformed = [
        ['missing-user', requesterDistributor({
          participantUserUids: ['r1'],
          participantUserAccess: { r1: 'active' },
        }), r1],
        ['extra-user', requesterDistributor({
          participantUserUids: ['r1', 'd1', 'r2'],
          participantUserAccess: { r1: 'active', d1: 'active', r2: 'active' },
        }), r1],
        ['branch-mismatch', distributorBranch({
          branchIds: ['b'],
          participantBranchIds: ['b'],
          participantBranchAccess: { b: 'active' },
        }), d1],
        ['participant-state-mismatch', requesterDistributor({
          participantUserAccess: { r1: 'active', d1: 'active', r2: 'active' },
        }), r1],
      ];

      for (const [suffix, conversation, actor] of malformed) {
        const id = `malformed-${suffix}`;
        await seedConversation(id, conversation, 'must stay hidden');
        await denied(getDoc(doc(actor, `chatConversations/${id}`)));
        await denied(getDocs(collection(actor, `chatConversations/${id}/messages`)));
      }
    });

    await t.test('membership-only query and expired lifecycle access remain denied', async () => {
      await denied(getDocs(query(
        collection(r1, 'chatConversations'),
        where('participantUserUids', 'array-contains', 'r1'),
      )));
      await seed('chatConversations/requester-branch-valid', {
        ...requesterBranch(),
        accessEndsAt: new Date(1),
      });
      await denied(getDocs(collection(r1, 'chatConversations/requester-branch-valid/messages')));
      for (const change of [
        { managerStatus: 'inactive' },
        { accountStatus: 'terminated' },
        { branchId: 'b' },
      ]) {
        await seed('users/m1', {
          role: 'manager',
          managerStatus: 'active',
          accountStatus: 'active',
          branchId: 'a',
          ...change,
        });
        await denied(getDoc(doc(m1, 'chatBranchActivity/a')));
      }
    });
  } finally {
    for (const { app, db } of apps) {
      await terminate(db);
      await deleteApp(app);
    }
  }
});
