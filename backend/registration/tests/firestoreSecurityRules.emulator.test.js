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
  updateDoc,
  deleteDoc,
  terminate,
} = require('firebase/firestore');

const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = 'demo-bluetap';
const apps = [];

function client(uid, claims = {}) {
  const name = uid ? `${uid}-${apps.length}` : `anon-${apps.length}`;
  const app = initializeApp({ projectId: project }, name);
  const db = getFirestore(app);
  const [hostname, port] = host.split(':');
  if (uid) {
    connectFirestoreEmulator(db, hostname, Number(port), {
      mockUserToken: { sub: uid, user_id: uid, ...claims },
    });
  } else {
    connectFirestoreEmulator(db, hostname, Number(port));
  }
  apps.push({ app, db });
  return db;
}

function value(input) {
  if (input === null || input === undefined) return { nullValue: null };
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
  return { stringValue: String(input) };
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

test('Firestore Security Rules full authorization suite (Emulator)', { skip: !host }, async (t) => {
  t.after(async () => {
    for (const { app, db } of apps) {
      await terminate(db).catch(() => {});
      await deleteApp(app).catch(() => {});
    }
  });

  // Seed baseline test fixtures via emulator REST API
  await seed('branches/branch_a', { name: 'Branch Alpha', status: 'active' });
  await seed('branches/branch_b', { name: 'Branch Beta', status: 'active' });
  await seed('branches/branch_inactive', { name: 'Branch Inactive', status: 'inactive' });

  await seed('users/req_1', { role: 'requester', accountStatus: 'active', email: 'req1@test.com', displayName: 'Requester One' });
  await seed('users/req_2', { role: 'requester', accountStatus: 'active', email: 'req2@test.com', displayName: 'Requester Two' });
  await seed('users/dist_1', { role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch_a', email: 'dist1@test.com' });
  await seed('users/dist_2', { role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch_b', email: 'dist2@test.com' });
  await seed('users/dist_pending', { role: 'distributor', accountStatus: 'active', distributorStatus: 'pending', requestedBranchId: 'branch_a', email: 'dist_pend@test.com' });
  await seed('users/mgr_a', { role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId: 'branch_a', email: 'mgra@test.com' });
  await seed('users/mgr_b', { role: 'manager', accountStatus: 'active', managerStatus: 'active', branchId: 'branch_b', email: 'mgrb@test.com' });
  await seed('users/adm_1', { role: 'admin', accountStatus: 'active', email: 'admin1@test.com' });
  await seed('users/req_suspended', { role: 'requester', accountStatus: 'suspended', email: 'req_susp@test.com' });
  await seed('users/req_terminated', { role: 'requester', accountStatus: 'terminated', email: 'req_term@test.com' });

  await seed('products/prod_1', { name: '5-Gallon Round', price: 40, status: 'active' });

  await seed('requests/req_order_1', { requester_id: 'req_1', branchId: 'branch_a', status: 'pending', total: 80 });
  await seed('requests/req_order_2', { requester_id: 'req_2', branchId: 'branch_b', status: 'pending', total: 120 });
  await seed('requests/req_order_assigned_d1', { requester_id: 'req_1', branchId: 'branch_a', assignedDistributorUid: 'dist_1', status: 'assigned', total: 80 });
  await seed('requests/req_order_transfer_to_a', { requester_id: 'req_2', branchId: 'branch_b', transferToBranchId: 'branch_a', status: 'branch_transfer_pending', total: 100 });

  await seed('publicConfig/registrationPolicy', {
    faceVerificationRequired: true,
    emailOtpRequired: true,
    policyVersion: 1,
    updatedAt: new Date(),
  });

  await seed('registrationSessions/session_secret_1', { stage: 'otp_pending', email: 'secret@test.com' });
  await seed('registrationEmailReservations/hash_secret_1', { email: 'reserved@test.com' });
  await seed('adminAuditLogs/audit_log_1', { action: 'ACCOUNT_SUSPENDED', actorUid: 'adm_1' });

  await t.test('1. Requester access: allows own permitted data, denies cross-requester records', async () => {
    const db = client('req_1');
    const ownDoc = await getDoc(doc(db, 'users', 'req_1'));
    assert.equal(ownDoc.exists(), true);
    assert.equal(ownDoc.data()?.displayName, 'Requester One');

    const ownOrder = await getDoc(doc(db, 'requests', 'req_order_1'));
    assert.equal(ownOrder.exists(), true);
    assert.equal(ownOrder.data()?.total, 80);

    const product = await getDoc(doc(db, 'products', 'prod_1'));
    assert.equal(product.exists(), true);

    await denied(getDoc(doc(db, 'requests', 'req_order_2')));
    await denied(getDoc(doc(db, 'users', 'req_2')));
    await denied(getDocs(collection(db, 'users')));
  });

  await t.test('2. Distributor access: allows assigned orders and own branch, denies unassigned and cross-branch', async () => {
    const dbDist1 = client('dist_1', { role: 'distributor' });
    const assignedOrder = await getDoc(doc(dbDist1, 'requests', 'req_order_assigned_d1'));
    assert.equal(assignedOrder.exists(), true);

    const branch = await getDoc(doc(dbDist1, 'branches', 'branch_a'));
    assert.equal(branch.exists(), true);
    assert.equal(branch.data()?.name, 'Branch Alpha');

    await denied(getDoc(doc(dbDist1, 'requests', 'req_order_1')));
    await denied(getDoc(doc(dbDist1, 'requests', 'req_order_2')));
    await denied(getDoc(doc(dbDist1, 'branches', 'branch_b')));

    const dbPending = client('dist_pending', { role: 'distributor' });
    await denied(getDoc(doc(dbPending, 'branches', 'branch_a')));
    await denied(getDoc(doc(dbPending, 'requests', 'req_order_assigned_d1')));
  });

  await t.test('3. Manager access: strictly branch-scoped, denies cross-branch orders and branches', async () => {
    const dbMgrA = client('mgr_a', { manager: true, role: 'manager' });
    const branchOrder = await getDoc(doc(dbMgrA, 'requests', 'req_order_1'));
    assert.equal(branchOrder.exists(), true);

    const ownBranch = await getDoc(doc(dbMgrA, 'branches', 'branch_a'));
    assert.equal(ownBranch.exists(), true);

    const incomingTransfer = await getDoc(doc(dbMgrA, 'requests', 'req_order_transfer_to_a'));
    assert.equal(incomingTransfer.exists(), true);

    await denied(getDoc(doc(dbMgrA, 'requests', 'req_order_2')));
    await denied(getDoc(doc(dbMgrA, 'branches', 'branch_b')));
    await denied(getDoc(doc(dbMgrA, 'users', 'dist_2')));
  });

  await t.test('4. Admin access: allows global reads, but completely rejects direct client-side mutations', async () => {
    const dbAdmin = client('adm_1', { admin: true, role: 'admin' });
    const order1 = await getDoc(doc(dbAdmin, 'requests', 'req_order_1'));
    const order2 = await getDoc(doc(dbAdmin, 'requests', 'req_order_2'));
    assert.equal(order1.exists(), true);
    assert.equal(order2.exists(), true);

    await denied(setDoc(doc(dbAdmin, 'requests', 'hacked_order'), { total: 0 }));
    await denied(updateDoc(doc(dbAdmin, 'requests', 'req_order_1'), { total: 999 }));
    await denied(deleteDoc(doc(dbAdmin, 'requests', 'req_order_1')));

    await denied(setDoc(doc(dbAdmin, 'products', 'new_product'), { name: 'Free Water' }));
    await denied(setDoc(doc(dbAdmin, 'branches', 'branch_hack'), { name: 'Rogue Branch' }));
  });

  await t.test('5. Account security: suspended and terminated accounts blocked from operational data', async () => {
    const dbSuspended = client('req_suspended');
    await denied(getDoc(doc(dbSuspended, 'requests', 'req_order_1')));
    await denied(getDoc(doc(dbSuspended, 'products', 'prod_1')));

    const dbTerminated = client('req_terminated');
    await denied(getDoc(doc(dbTerminated, 'requests', 'req_order_1')));
    await denied(getDoc(doc(dbTerminated, 'products', 'prod_1')));

    const ownProfile = await getDoc(doc(dbSuspended, 'users', 'req_suspended'));
    assert.equal(ownProfile.exists(), true);
    assert.equal(ownProfile.data()?.accountStatus, 'suspended');
  });

  await t.test('6. Profile privilege immutability: ordinary users cannot elevate roles, status, or branch', async () => {
    const dbReq = client('req_1');
    await denied(updateDoc(doc(dbReq, 'users', 'req_1'), { accountStatus: 'terminated' }));
    await denied(updateDoc(doc(dbReq, 'users', 'req_1'), { role: 'admin' }));
    await denied(updateDoc(doc(dbReq, 'users', 'req_1'), { branchId: 'branch_a' }));
    await denied(updateDoc(doc(dbReq, 'users', 'req_1'), { admin: true }));
    await denied(updateDoc(doc(dbReq, 'users', 'req_1'), { emailVerified: true }));

    await updateDoc(doc(dbReq, 'users', 'req_1'), { displayName: 'Updated Name', address: '123 Test St' });
    const updated = await getDoc(doc(dbReq, 'users', 'req_1'));
    assert.equal(updated.data()?.displayName, 'Updated Name');
    assert.equal(updated.data()?.address, '123 Test St');
  });

  await t.test('7. Registration protection: client access to backend reservations and sessions is denied', async () => {
    const dbAnon = client(null);
    const dbReq = client('req_1');

    await denied(getDoc(doc(dbAnon, 'registrationSessions', 'session_secret_1')));
    await denied(getDoc(doc(dbReq, 'registrationSessions', 'session_secret_1')));
    await denied(setDoc(doc(dbReq, 'registrationSessions', 'new_session'), { dummy: true }));

    await denied(getDoc(doc(dbAnon, 'registrationEmailReservations', 'hash_secret_1')));
    await denied(getDoc(doc(dbReq, 'registrationEmailReservations', 'hash_secret_1')));

    await denied(getDoc(doc(dbAnon, 'adminAuditLogs', 'audit_log_1')));
    await denied(getDoc(doc(dbReq, 'adminAuditLogs', 'audit_log_1')));

    const policy = await getDoc(doc(dbAnon, 'publicConfig', 'registrationPolicy'));
    assert.equal(policy.exists(), true);
    assert.equal(policy.data()?.policyVersion, 1);
    await denied(setDoc(doc(dbAnon, 'publicConfig', 'registrationPolicy'), { hacked: true }));
  });

  await t.test('8. Order and pricing integrity: client-side order creations, price updates, and deletes are denied', async () => {
    const dbReq = client('req_1');
    await denied(setDoc(doc(dbReq, 'requests', 'client_forged_order'), {
      requester_id: 'req_1',
      branchId: 'branch_a',
      total: 1,
    }));
    await denied(updateDoc(doc(dbReq, 'requests', 'req_order_1'), {
      total: 5,
    }));
    await denied(updateDoc(doc(dbReq, 'requests', 'req_order_1'), {
      status: 'cancelled',
    }));
    await denied(deleteDoc(doc(dbReq, 'requests', 'req_order_1')));

    const dbDist = client('dist_1', { role: 'distributor' });
    await denied(updateDoc(doc(dbDist, 'requests', 'req_order_assigned_d1'), {
      status: 'delivered',
    }));
  });
});
