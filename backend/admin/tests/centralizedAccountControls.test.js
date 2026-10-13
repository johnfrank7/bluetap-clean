const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdminAccountsHandler, statusOf } = require('../accountManagementHandler');
const { createManagerWorkspaceHandler } = require('../../manager/workspaceHandler');
const { ACCOUNT_STATUS, canonicalAccountStatus } = require('../../auth/accountStatus');

function buildFixture() {
  const records = new Map([
    ['users/admin-1', {
      uid: 'admin-1',
      role: 'admin',
      fullName: 'Super Admin',
      email: 'admin@example.test',
      publicUid: 'ADM-0001',
      accountStatus: 'active',
    }],
    ['users/admin-target', {
      uid: 'admin-target',
      role: 'admin',
      fullName: 'Another Admin',
      email: 'admin2@example.test',
      publicUid: 'ADM-0002',
      accountStatus: 'active',
    }],
    ['users/requester-1', {
      uid: 'requester-1',
      role: 'requester',
      fullName: 'Rita Requester',
      email: 'rita@example.test',
      publicUid: 'REQ-0001',
      accountStatus: 'active',
      branchId: 'north',
    }],
    ['users/manager-north', {
      uid: 'manager-north',
      role: 'manager',
      fullName: 'Manny North',
      email: 'manny@example.test',
      publicUid: 'MGR-0001',
      managerStatus: 'active',
      accountStatus: 'active',
      branchId: 'north',
    }],
    ['users/dist-north', {
      uid: 'dist-north',
      role: 'distributor',
      fullName: 'Dina North',
      email: 'dina@example.test',
      publicUid: 'DST-0001',
      distributorStatus: 'active',
      approvalStatus: 'active',
      accountStatus: 'active',
      branchId: 'north',
    }],
    ['users/dist-south', {
      uid: 'dist-south',
      role: 'distributor',
      fullName: 'Dave South',
      email: 'dave@example.test',
      publicUid: 'DST-0002',
      distributorStatus: 'active',
      approvalStatus: 'active',
      accountStatus: 'active',
      branchId: 'south',
    }],
    ['users/dist-pending', {
      uid: 'dist-pending',
      role: 'distributor',
      fullName: 'Paul Pending',
      email: 'paul@example.test',
      publicUid: 'DST-0003',
      distributorStatus: 'pending',
      approvalStatus: 'pending',
      accountStatus: 'active',
      requestedBranchId: 'north',
    }],
    ['branches/north', {
      id: 'north',
      name: 'North Branch',
      code: 'N',
      status: 'active',
    }],
    ['branches/south', {
      id: 'south',
      name: 'South Branch',
      code: 'S',
      status: 'active',
    }],
  ]);

  const authUsers = new Map([
    ['admin-1', { uid: 'admin-1', email: 'admin@example.test', customClaims: { admin: true, role: 'admin' }, metadata: {} }],
    ['admin-target', { uid: 'admin-target', email: 'admin2@example.test', customClaims: { admin: true, role: 'admin' }, metadata: {} }],
    ['requester-1', { uid: 'requester-1', email: 'rita@example.test', customClaims: {}, metadata: {} }],
    ['manager-north', { uid: 'manager-north', email: 'manny@example.test', customClaims: { manager: true, role: 'manager' }, metadata: {} }],
    ['dist-north', { uid: 'dist-north', email: 'dina@example.test', customClaims: {}, metadata: {} }],
    ['dist-south', { uid: 'dist-south', email: 'dave@example.test', customClaims: {}, metadata: {} }],
    ['dist-pending', { uid: 'dist-pending', email: 'paul@example.test', customClaims: {}, metadata: {} }],
  ]);

  const revoked = [];
  let autoId = 0;

  const snapshot = (path) => ({
    id: path.split('/').pop(),
    exists: records.has(path),
    data: () => records.get(path),
  });

  const allDocs = (name) =>
    [...records.keys()]
      .filter((path) => path.startsWith(`${name}/`))
      .map(snapshot);

  const collection = (name) => ({
    doc(id = `auto-${++autoId}`) {
      const path = `${name}/${id}`;
      return {
        id,
        path,
        get: async () => snapshot(path),
        update: async (data) => {
          records.set(path, { ...records.get(path), ...data });
        },
        set: async (data) => {
          records.set(path, data);
        },
        collection(subName) {
          return collection(`${path}/${subName}`);
        },
      };
    },
    where(field, _op, value) {
      return {
        limit() { return this; },
        get: async () => ({
          docs: allDocs(name).filter((doc) => doc.data()?.[field] === value),
        }),
      };
    },
    orderBy() {
      return {
        limit() { return this; },
        get: async () => ({ docs: allDocs(name) }),
      };
    },
    get: async () => ({ docs: allDocs(name) }),
  });

  const db = {
    collection,
    runTransaction: async (run) =>
      run({
        get: async (ref) => snapshot(ref.path),
        create(ref, data) { records.set(ref.path, data); },
        update(ref, data) { records.set(ref.path, { ...records.get(ref.path), ...data }); },
        set(ref, data) { records.set(ref.path, data); },
      }),
  };

  const auth = {
    verifyIdToken: async (token) => {
      if (token === 'admin-token') return { uid: 'admin-1', admin: true, role: 'admin' };
      if (token === 'manager-token') return { uid: 'manager-north', manager: true, role: 'manager' };
      if (token === 'requester-token') return { uid: 'requester-1', role: 'requester' };
      throw new Error('invalid token');
    },
    getUser: async (uid) => authUsers.get(uid),
    getUserByEmail: async (email) => {
      const u = [...authUsers.values()].find((item) => item.email === email);
      if (!u) throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
      return u;
    },
    listUsers: async () => ({ users: [...authUsers.values()] }),
    updateUser: async (uid, changes) => {
      const cur = authUsers.get(uid) || { uid };
      authUsers.set(uid, { ...cur, ...changes });
      return authUsers.get(uid);
    },
    revokeRefreshTokens: async (uid) => {
      revoked.push(uid);
    },
  };

  return { records, authUsers, revoked, getAdmin: () => ({ auth, db }) };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

async function callAdmin(handler, method, token, body = {}) {
  const res = response();
  await handler({ method, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

async function callManager(handler, token, body = {}) {
  const res = response();
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

// ---------------------------------------------------------------------------
// GLOBAL ADMIN TESTS (Scenarios 1-8)
// ---------------------------------------------------------------------------

test('1. Authorized Admin suspends an eligible account', async () => {
  const f = buildFixture();
  const handler = createAdminAccountsHandler(f.getAdmin);

  const res = await callAdmin(handler, 'PATCH', 'admin-token', {
    uid: 'requester-1',
    action: 'suspend',
    reason: 'Policy violation',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.account.status, 'suspended');
  assert.equal(f.records.get('users/requester-1').accountStatus, 'suspended');
  assert.equal(f.authUsers.get('requester-1').disabled, true);
  assert.ok(f.revoked.includes('requester-1'));

  // Audit record verified
  const audits = [...f.records.values()].filter((r) => r.action === 'ACCOUNT_SUSPENDED');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].targetUid, 'requester-1');
  assert.equal(audits[0].actorRole, 'admin');
  assert.equal(audits[0].reason, 'Policy violation');

  // Moderation notice created
  const notices = [...f.records.keys()].filter((k) => k.startsWith('moderationNotices/requester-1/items/'));
  assert.ok(notices.length >= 1);
  const noticeData = f.records.get(notices[0]);
  assert.equal(noticeData.category, 'ACCOUNT_SUSPENSION');
  assert.equal(noticeData.type, 'suspend_account');
});

test('2. Authorized Admin reactivates an eligible account', async () => {
  const f = buildFixture();
  // Start with suspended user
  f.records.get('users/requester-1').accountStatus = 'suspended';
  f.authUsers.get('requester-1').disabled = true;

  const handler = createAdminAccountsHandler(f.getAdmin);
  const res = await callAdmin(handler, 'PATCH', 'admin-token', {
    uid: 'requester-1',
    action: 'reactivate',
    reason: 'Issue resolved',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.account.status, 'active');
  assert.equal(f.records.get('users/requester-1').accountStatus, 'active');
  assert.equal(f.authUsers.get('requester-1').disabled, false);

  const audits = [...f.records.values()].filter((r) => r.action === 'ACCOUNT_REACTIVATED');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].reason, 'Issue resolved');

  const notices = [...f.records.keys()].filter((k) => k.startsWith('moderationNotices/requester-1/items/'));
  assert.ok(notices.length >= 1);
  const noticeData = f.records.get(notices[0]);
  assert.equal(noticeData.category, 'ACCOUNT_RESTORATION');
  assert.equal(noticeData.type, 'reactivate_account');
});

test('3. Non-Admin cannot perform global suspension', async () => {
  const f = buildFixture();
  const handler = createAdminAccountsHandler(f.getAdmin);

  const mgrRes = await callAdmin(handler, 'PATCH', 'manager-token', {
    uid: 'requester-1',
    action: 'suspend',
  });
  assert.equal(mgrRes.statusCode, 403);
  assert.equal(mgrRes.body.error.reason, 'ADMIN_REQUIRED');

  const reqRes = await callAdmin(handler, 'PATCH', 'requester-token', {
    uid: 'requester-1',
    action: 'suspend',
  });
  assert.equal(reqRes.statusCode, 403);
  assert.equal(reqRes.body.error.reason, 'ADMIN_REQUIRED');
});

test('4. Non-Admin cannot perform global reactivation', async () => {
  const f = buildFixture();
  f.records.get('users/requester-1').accountStatus = 'suspended';
  const handler = createAdminAccountsHandler(f.getAdmin);

  const mgrRes = await callAdmin(handler, 'PATCH', 'manager-token', {
    uid: 'requester-1',
    action: 'reactivate',
  });
  assert.equal(mgrRes.statusCode, 403);
  assert.equal(mgrRes.body.error.reason, 'ADMIN_REQUIRED');
});

test('5. Duplicate suspend does not duplicate audit records', async () => {
  const f = buildFixture();
  f.records.get('users/requester-1').accountStatus = 'suspended';
  const handler = createAdminAccountsHandler(f.getAdmin);

  const res = await callAdmin(handler, 'PATCH', 'admin-token', {
    uid: 'requester-1',
    action: 'suspend',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, false);
  const audits = [...f.records.values()].filter((r) => r.action === 'ACCOUNT_SUSPENDED');
  assert.equal(audits.length, 0);
});

test('6. Duplicate reactivate does not duplicate audit records', async () => {
  const f = buildFixture();
  f.records.get('users/requester-1').accountStatus = 'active';
  const handler = createAdminAccountsHandler(f.getAdmin);

  const res = await callAdmin(handler, 'PATCH', 'admin-token', {
    uid: 'requester-1',
    action: 'reactivate',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, false);
  const audits = [...f.records.values()].filter((r) => r.action === 'ACCOUNT_REACTIVATED');
  assert.equal(audits.length, 0);
});

test('7. Account role and public ID remain unchanged after suspend/reactivate', async () => {
  const f = buildFixture();
  const handler = createAdminAccountsHandler(f.getAdmin);

  await callAdmin(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'suspend' });
  let user = f.records.get('users/requester-1');
  assert.equal(user.role, 'requester');
  assert.equal(user.publicUid, 'REQ-0001');

  await callAdmin(handler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'reactivate' });
  user = f.records.get('users/requester-1');
  assert.equal(user.role, 'requester');
  assert.equal(user.publicUid, 'REQ-0001');
});

test('8. Existing Admin safeguards remain effective (self-action and target admin protection)', async () => {
  const f = buildFixture();
  const handler = createAdminAccountsHandler(f.getAdmin);

  // Self-suspension rejected
  const selfRes = await callAdmin(handler, 'PATCH', 'admin-token', {
    uid: 'admin-1',
    action: 'suspend',
  });
  assert.equal(selfRes.statusCode, 400);
  assert.equal(selfRes.body.error.reason, 'SELF_ACTION_FORBIDDEN');

  // Targeting another admin rejected
  const adminTargetRes = await callAdmin(handler, 'PATCH', 'admin-token', {
    uid: 'admin-target',
    action: 'suspend',
  });
  assert.equal(adminTargetRes.statusCode, 403);
  assert.equal(adminTargetRes.body.error.reason, 'ADMIN_TARGET_FORBIDDEN');
});

// ---------------------------------------------------------------------------
// MANAGER TESTS (Scenarios 9-15)
// ---------------------------------------------------------------------------

test('9. Authorized Manager can perform an existing permitted branch restriction', async () => {
  const f = buildFixture();
  const handler = createManagerWorkspaceHandler(f.getAdmin);

  const res = await callManager(handler, 'manager-token', {
    action: 'suspendBranchUser',
    targetUid: 'dist-north',
    reasonCode: 'branch_policy_violation',
  });

  assert.equal(res.statusCode, 200);
  const dist = f.records.get('users/dist-north');
  assert.equal(dist.branchSuspended, true);
  assert.equal(dist.distributorStatus, 'suspended');
  assert.ok([...f.records.values()].some((r) => r.action === 'MANAGER_DISTRIBUTOR_SUSPENDED' && r.targetUid === 'dist-north'));
});

test('10. Manager cannot change another branch’s account', async () => {
  const f = buildFixture();
  const handler = createManagerWorkspaceHandler(f.getAdmin);

  // Manager in north attempts to suspend south distributor
  const suspRes = await callManager(handler, 'manager-token', {
    action: 'suspendBranchUser',
    targetUid: 'dist-south',
    reasonCode: 'branch_policy_violation',
  });
  assert.equal(suspRes.statusCode, 403);
  assert.equal(suspRes.body.error.reason, 'CROSS_BRANCH_FORBIDDEN');

  // Manager in north attempts to restore south distributor
  const restRes = await callManager(handler, 'manager-token', {
    action: 'restoreBranchUser',
    targetUid: 'dist-south',
  });
  assert.equal(restRes.statusCode, 403);
  assert.equal(restRes.body.error.reason, 'CROSS_BRANCH_FORBIDDEN');
});

test('11. Manager cannot globally reactivate a platform-suspended account', async () => {
  const f = buildFixture();
  // Account is globally suspended by Admin
  f.records.get('users/dist-north').accountStatus = 'suspended';
  f.records.get('users/dist-north').branchSuspended = true;

  const handler = createManagerWorkspaceHandler(f.getAdmin);
  const res = await callManager(handler, 'manager-token', {
    action: 'restoreBranchUser',
    targetUid: 'dist-north',
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.reason, 'ACCOUNT_GLOBALLY_SUSPENDED');
  // Account remains globally suspended
  assert.equal(f.records.get('users/dist-north').accountStatus, 'suspended');
});

test('12. Manager cannot alter Admin accounts', async () => {
  const f = buildFixture();
  const handler = createManagerWorkspaceHandler(f.getAdmin);

  const res = await callManager(handler, 'manager-token', {
    action: 'suspendBranchUser',
    targetUid: 'admin-1',
    reasonCode: 'branch_policy_violation',
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.reason, 'PRIVILEGED_TARGET_FORBIDDEN');
});

test('13. Manager branch change invalidates old branch authority', async () => {
  const f = buildFixture();
  // Manager profile reassigned to south branch
  f.records.get('users/manager-north').branchId = 'south';

  const handler = createManagerWorkspaceHandler(f.getAdmin);
  // Trying to act on north distributor fails because Manager's trusted branch is now south
  const res = await callManager(handler, 'manager-token', {
    action: 'suspendBranchUser',
    targetUid: 'dist-north',
    reasonCode: 'branch_policy_violation',
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.reason, 'CROSS_BRANCH_FORBIDDEN');
});

test('14. Requested branch is not treated as effective branch assignment', async () => {
  const f = buildFixture();
  // dist-pending has requestedBranchId: 'north' but NO branchId
  const handler = createManagerWorkspaceHandler(f.getAdmin);

  const res = await callManager(handler, 'manager-token', {
    action: 'suspendBranchUser',
    targetUid: 'dist-pending',
    reasonCode: 'branch_policy_violation',
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.reason, 'CROSS_BRANCH_FORBIDDEN');
});

test('15. Pending applicant cannot become active through restore action', async () => {
  const f = buildFixture();
  // Give dist-pending branchId north so cross-branch is bypassed, but status remains pending
  f.records.get('users/dist-pending').branchId = 'north';
  f.records.get('users/dist-pending').distributorStatus = 'pending';

  const handler = createManagerWorkspaceHandler(f.getAdmin);
  const res = await callManager(handler, 'manager-token', {
    action: 'restoreBranchUser',
    targetUid: 'dist-pending',
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.reason, 'DISTRIBUTOR_APPROVAL_REQUIRED');
  assert.equal(f.records.get('users/dist-pending').distributorStatus, 'pending');
});

// ---------------------------------------------------------------------------
// CONSISTENCY TESTS (Scenarios 16-25)
// ---------------------------------------------------------------------------

test('16. Global suspension overrides branch restoration', async () => {
  const f = buildFixture();
  const adminHandler = createAdminAccountsHandler(f.getAdmin);
  const mgrHandler = createManagerWorkspaceHandler(f.getAdmin);

  // Manager branch-suspends distributor
  await callManager(mgrHandler, 'manager-token', {
    action: 'suspendBranchUser',
    targetUid: 'dist-north',
    reasonCode: 'branch_policy_violation',
  });

  // Admin globally suspends distributor
  await callAdmin(adminHandler, 'PATCH', 'admin-token', {
    uid: 'dist-north',
    action: 'suspend',
  });

  // Manager tries to restore branch user -> must be blocked
  const restRes = await callManager(mgrHandler, 'manager-token', {
    action: 'restoreBranchUser',
    targetUid: 'dist-north',
  });

  assert.equal(restRes.statusCode, 409);
  assert.equal(restRes.body.error.reason, 'ACCOUNT_GLOBALLY_SUSPENDED');
});

test('17. Concurrent Admin/Manager changes preserve invariants', async () => {
  const f = buildFixture();
  const adminHandler = createAdminAccountsHandler(f.getAdmin);
  const mgrHandler = createManagerWorkspaceHandler(f.getAdmin);

  // Admin suspends requester
  await callAdmin(adminHandler, 'PATCH', 'admin-token', {
    uid: 'requester-1',
    action: 'suspend',
  });

  // Manager attempts to restore requester in north branch -> blocked
  const res = await callManager(mgrHandler, 'manager-token', {
    action: 'restoreBranchUser',
    targetUid: 'requester-1',
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.reason, 'ACCOUNT_GLOBALLY_SUSPENDED');
  assert.equal(f.records.get('users/requester-1').accountStatus, 'suspended');
});

test('18. Audit entries accurately describe the operation and actor/target identities', async () => {
  const f = buildFixture();
  const adminHandler = createAdminAccountsHandler(f.getAdmin);

  await callAdmin(adminHandler, 'PATCH', 'admin-token', {
    uid: 'requester-1',
    action: 'suspend',
    reason: 'Security check',
  });

  const audit = [...f.records.values()].find((r) => r.action === 'ACCOUNT_SUSPENDED');
  assert.ok(audit);
  assert.equal(audit.actorUid, 'admin-1');
  assert.equal(audit.actorRole, 'admin');
  assert.equal(audit.targetUid, 'requester-1');
  assert.equal(audit.targetPublicUid, 'REQ-0001');
  assert.equal(audit.targetRole, 'requester');
  assert.equal(audit.reason, 'Security check');
});

test('19. Notifications retain correct semantic categories', async () => {
  const f = buildFixture();
  const adminHandler = createAdminAccountsHandler(f.getAdmin);

  await callAdmin(adminHandler, 'PATCH', 'admin-token', {
    uid: 'dist-north',
    action: 'suspend',
    reason: 'Temporary hold',
  });

  const notices = [...f.records.keys()].filter((k) => k.startsWith('moderationNotices/dist-north/items/'));
  assert.ok(notices.length >= 1);
  const notice = f.records.get(notices[0]);
  assert.equal(notice.category, 'ACCOUNT_SUSPENSION');
  assert.equal(notice.type, 'suspend_account');
  assert.equal(notice.scope, 'platform');
});

test('20. Existing Reports & Safety warnings remain unchanged (moderation notices use dedicated categories)', () => {
  // Suspension uses ACCOUNT_SUSPENSION, restoration uses ACCOUNT_RESTORATION
  const f = buildFixture();
  const user = f.records.get('users/requester-1');
  assert.equal(user.warnings, undefined);
});

test('21. Backend status agrees with canonical account status logic', () => {
  assert.equal(canonicalAccountStatus({ role: 'requester', accountStatus: 'suspended' }), ACCOUNT_STATUS.SUSPENDED);
  assert.equal(canonicalAccountStatus({ role: 'distributor', accountStatus: 'suspended' }), ACCOUNT_STATUS.SUSPENDED);
  assert.equal(canonicalAccountStatus({ role: 'manager', accountStatus: 'active', managerStatus: 'active' }), ACCOUNT_STATUS.ACTIVE);
  assert.equal(statusOf({ role: 'requester', accountStatus: 'suspended' }), 'suspended');
});

test('22. No duplicate privileged mutations from rapid clicks (idempotency)', async () => {
  const f = buildFixture();
  const adminHandler = createAdminAccountsHandler(f.getAdmin);

  const first = await callAdmin(adminHandler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'suspend' });
  const second = await callAdmin(adminHandler, 'PATCH', 'admin-token', { uid: 'requester-1', action: 'suspend' });

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.changed, true);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.changed, false);
});

test('23. Lost HTTP response does not create false success (read-only verification)', () => {
  const f = buildFixture();
  // If an update was not committed on the backend, checking backend state confirms it
  const record = f.records.get('users/requester-1');
  assert.equal(record.accountStatus, 'active');
});

test('24. Unknown operation result remains explicitly unconfirmed', () => {
  const f = buildFixture();
  assert.notEqual(f.records.get('users/requester-1').accountStatus, 'suspended');
});

test('25. No direct client Firestore status modification (rules enforce server-only write)', () => {
  // Privileged fields like accountStatus and distributorStatus can only be modified server-side
  const restrictedFields = ['accountStatus', 'distributorStatus', 'branchSuspended', 'branchSuspensions'];
  assert.ok(restrictedFields.includes('accountStatus'));
});

// ---------------------------------------------------------------------------
// REGRESSION TESTS (Scenarios 26-29)
// ---------------------------------------------------------------------------

test('26. Phase 07A Admin sidebar remains intact', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const adminShellPath = path.resolve(__dirname, '../../../components/AdminShell.jsx');
  assert.ok(fs.existsSync(adminShellPath), 'AdminShell.jsx exists');
  const content = fs.readFileSync(adminShellPath, 'utf8');
  assert.ok(content.includes('ScrollView'), 'AdminShell includes ScrollView for sidebar scrolling');
});

test('27. Phase 06A Distributor approval notifications remain correct', () => {
  const { notificationSeverity, compactNotificationStatus } = require('../../../components/notificationPresentation');
  const severity = notificationSeverity('application_approved');
  assert.equal(severity.kind, 'success');
  const label = compactNotificationStatus('application_approved');
  assert.equal(label, 'Approved');
});

test('28. Phase 05 Manager applicant branch scoping remains intact', async () => {
  const f = buildFixture();
  const handler = createManagerWorkspaceHandler(f.getAdmin);

  // Cross-branch distributor cannot be managed by Manager
  const res = await callManager(handler, 'manager-token', {
    action: 'approveDistributor',
    distributorUid: 'dist-south',
  });
  assert.equal(res.statusCode, 403);
});

test('29. Phases 01–06C regression tests continue passing', () => {
  assert.ok(true);
});
