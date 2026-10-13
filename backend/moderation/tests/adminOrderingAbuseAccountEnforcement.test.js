const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyModerationAction,
  createAdminModerationHandler,
  createManagerModerationHandler,
} = require('../moderationHandler');
const { ACCOUNT_STATUS, canonicalAccountStatus } = require('../../auth/accountStatus');
const { requireActiveAccount } = require('../../auth/accountStatus');

const clone = (val) => (val === undefined ? undefined : structuredClone(val));

function mockReq({
  method = 'POST',
  url = '/api/admin/moderation',
  headers = {},
  body = null,
} = {}) {
  return {
    method,
    url,
    headers: {
      host: 'localhost',
      authorization: 'Bearer admin-token',
      ...headers,
    },
    body,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    ended: false,
    body: null,
    setHeader(key, val) {
      res.headers[key.toLowerCase()] = val;
      return res;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.body = data;
      res.ended = true;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
  };
  return res;
}

function createEnforcementFixture({
  targetAccountStatus = 'active',
  authFailOnUpdate = false,
  authFailOnRevoke = false,
  txFailOnUserUpdate = false,
} = {}) {
  let autoId = 0;
  const records = new Map([
    ['users/admin-1', {
      uid: 'admin-1',
      role: 'admin',
      accountStatus: 'active',
      publicUid: 'Adm001',
      name: 'System Admin',
    }],
    ['users/admin-2', {
      uid: 'admin-2',
      role: 'admin',
      accountStatus: 'active',
      publicUid: 'Adm002',
      name: 'Second Admin',
    }],
    ['users/manager-1', {
      uid: 'manager-1',
      role: 'manager',
      managerStatus: 'active',
      accountStatus: 'active',
      publicUid: 'Man001',
      name: 'Branch Manager',
      branchId: 'branch-a',
    }],
    ['users/requester-1', {
      uid: 'requester-1',
      role: 'requester',
      accountStatus: targetAccountStatus,
      status: targetAccountStatus === 'active' ? 'Active' : 'Suspended',
      publicUid: 'Req001',
      name: 'John Requester',
      branchId: 'branch-a',
    }],
    ['users/distributor-1', {
      uid: 'distributor-1',
      role: 'distributor',
      accountStatus: 'active',
      distributorStatus: 'active',
      publicUid: 'Dis001',
      name: 'Dave Distributor',
      branchId: 'branch-a',
    }],
    ['branches/branch-a', {
      id: 'branch-a',
      name: 'BlueTap Alpha',
      status: 'active',
    }],
    ['orderAbuseReviews/abuse-1', {
      id: 'abuse-1',
      status: 'open',
      branchId: 'branch-a',
      branchNameSnapshot: 'BlueTap Alpha',
      requesterUid: 'requester-1',
      requesterPublicUidSnapshot: 'Req001',
      requesterNameSnapshot: 'John Requester',
      severity: 'review',
      incidentCount: 2,
      windowDays: 14,
      firstIncidentAt: new Date('2026-09-01T00:00:00Z'),
      lastIncidentAt: new Date('2026-09-10T00:00:00Z'),
      createdAt: new Date('2026-09-01T00:00:00Z'),
      updatedAt: new Date('2026-09-10T00:00:00Z'),
      incidents: [
        {
          orderId: 'ord-101',
          orderReference: 'BT-101',
          type: 'cancellation',
          category: 'frequent_cancellation',
          stage: 'dispatch',
          concern: 'high',
          at: new Date('2026-09-02T00:00:00Z'),
        },
      ],
    }],
    ['waterOrders/ord-101', {
      id: 'ord-101',
      orderReference: 'BT-101',
      status: 'cancelled',
      totalAmount: 500,
    }],
  ]);

  const snapshot = (path) => ({
    id: path.split('/').pop(),
    path,
    exists: records.has(path),
    data: () => clone(records.get(path)),
  });

  const collection = (name) => ({
    doc(id = `auto-${++autoId}`) {
      const path = `${name}/${id}`;
      return {
        id,
        path,
        get: async () => snapshot(path),
        update: async (data) => {
          records.set(path, { ...(records.get(path) || {}), ...clone(data) });
        },
        set: async (data, opts) => {
          records.set(path, opts?.merge ? { ...(records.get(path) || {}), ...clone(data) } : clone(data));
        },
        collection: (sub) => collection(`${path}/${sub}`),
      };
    },
    where(field, op, val) {
      return {
        orderBy() { return this; },
        limit() { return this; },
        async get() {
          const docs = [...records.keys()]
            .filter((k) => k.startsWith(`${name}/`))
            .map(snapshot)
            .filter((d) => {
              const data = d.data() || {};
              if (op === '==') return data[field] === val;
              return true;
            });
          return { docs };
        },
      };
    },
    orderBy() {
      return {
        limit() { return this; },
        async get() {
          return {
            docs: [...records.keys()]
              .filter((k) => k.startsWith(`${name}/`))
              .map(snapshot),
          };
        },
      };
    },
  });

  const db = {
    collection,
    async runTransaction(run) {
      if (txFailOnUserUpdate) {
        throw new Error('Database transaction aborted due to contention');
      }
      const working = new Map([...records.entries()].map(([k, v]) => [k, clone(v)]));
      const workingSnapshot = (path) => ({
        id: path.split('/').pop(),
        path,
        exists: working.has(path),
        data: () => clone(working.get(path)),
      });
      const tx = {
        get: async (ref) => workingSnapshot(ref.path),
        create(ref, data) {
          if (working.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
          working.set(ref.path, clone(data));
        },
        set(ref, data, options) {
          working.set(ref.path, options?.merge ? { ...(working.get(ref.path) || {}), ...clone(data) } : clone(data));
        },
        update(ref, data) {
          if (!working.has(ref.path)) throw new Error(`missing: ${ref.path}`);
          working.set(ref.path, { ...(working.get(ref.path) || {}), ...clone(data) });
        },
      };
      const result = await run(tx);
      records.clear();
      for (const [k, v] of working) records.set(k, v);
      return result;
    },
  };

  const authCalls = [];
  const auth = {
    verifyIdToken: async (token) => {
      if (token === 'admin-token') return { uid: 'admin-1', admin: true, role: 'admin' };
      if (token === 'admin-2-token') return { uid: 'admin-2', admin: true, role: 'admin' };
      if (token === 'manager-token') return { uid: 'manager-1', manager: true, role: 'manager' };
      if (token === 'requester-token') return { uid: 'requester-1', role: 'requester' };
      throw new Error('invalid token');
    },
    updateUser: async (uid, changes) => {
      if (authFailOnUpdate) throw new Error('Firebase Auth connection timed out');
      authCalls.push(['updateUser', uid, changes]);
    },
    revokeRefreshTokens: async (uid) => {
      if (authFailOnRevoke) throw new Error('Firebase Auth token revocation failed');
      authCalls.push(['revokeRefreshTokens', uid]);
    },
  };

  const getAdmin = () => ({ auth, db });
  return { auth, authCalls, db, getAdmin, records };
}

// ============================================================================
// PHASE 08.1 SECURITY INVARIANTS & CONCURRENCY TESTS
// ============================================================================

test('A. Moderation suspend_account commits Firestore first, disables Auth, and revokes tokens', async () => {
  const f = createEnforcementFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  const res = mockRes();
  await handler(mockReq({
    body: {
      abuseReviewId: 'abuse-1',
      action: 'suspend_account',
      reason: 'Repeated abusive cancellations confirmed',
      clientMutationId: 'mut-sec-A',
    },
  }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.created, true);

  // Firestore status updated authoritatively
  const user = f.records.get('users/requester-1');
  assert.equal(user.accountStatus, 'suspended');
  assert.equal(user.status, 'Suspended');

  // Firebase Auth disabled and refresh tokens revoked
  assert.deepEqual(f.authCalls, [
    ['updateUser', 'requester-1', { disabled: true }],
    ['revokeRefreshTokens', 'requester-1'],
  ]);

  // Review resolved
  const review = f.records.get('orderAbuseReviews/abuse-1');
  assert.equal(review.status, 'resolved');
  assert.equal(review.actionTaken, 'suspend_account');

  // Admin audit log created
  const auditKey = [...f.records.keys()].find((k) => k.startsWith('adminAuditLogs/'));
  assert.ok(auditKey);
  const audit = f.records.get(auditKey);
  assert.equal(audit.action, 'ACCOUNT_SUSPENDED');
  assert.equal(audit.targetUid, 'requester-1');
  assert.equal(audit.before.accountStatus, 'active');
  assert.equal(audit.after.accountStatus, 'suspended');
});

test('B. Partial failure 1: Moderation transaction succeeds but Auth sync fails -> 502, fail-closed, recoverable on replay', async () => {
  const f = createEnforcementFixture({ authFailOnUpdate: true });
  const handler = createAdminModerationHandler(f.getAdmin);

  const res = mockRes();
  await handler(mockReq({
    body: {
      abuseReviewId: 'abuse-1',
      action: 'suspend_account',
      reason: 'Abuse confirmed',
      clientMutationId: 'mut-sec-partial-1',
    },
  }), res);

  // Fails with 502 ACCOUNT_AUTH_SYNC_FAILED
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error.reason, 'ACCOUNT_AUTH_SYNC_FAILED');

  // Firestore transaction committed (fail-closed)
  const user = f.records.get('users/requester-1');
  assert.equal(user.accountStatus, 'suspended');

  // Review marked resolved in Firestore
  const review = f.records.get('orderAbuseReviews/abuse-1');
  assert.equal(review.status, 'resolved');

  // Mutation record stored authSynced: false
  const mutationKey = [...f.records.keys()].find((k) => k.startsWith('moderationMutationIds/'));
  assert.ok(mutationKey);
  assert.equal(f.records.get(mutationKey).authSynced, false);

  // Now restore Auth service and replay with same mutation ID
  f.auth.updateUser = async (uid, changes) => f.authCalls.push(['updateUser', uid, changes]);
  const replayRes = mockRes();
  await handler(mockReq({
    body: {
      abuseReviewId: 'abuse-1',
      action: 'suspend_account',
      reason: 'Abuse confirmed',
      clientMutationId: 'mut-sec-partial-1',
    },
  }), replayRes);

  assert.equal(replayRes.statusCode, 200);
  assert.equal(replayRes.body.created, false);
  assert.equal(f.records.get(mutationKey).authSynced, true);
  assert.deepEqual(f.authCalls, [
    ['updateUser', 'requester-1', { disabled: true }],
    ['revokeRefreshTokens', 'requester-1'],
  ]);
});

test('C. Partial failure 2: Firestore transaction aborts -> Auth untouched, no partial state', async () => {
  const f = createEnforcementFixture({ txFailOnUserUpdate: true });
  const handler = createAdminModerationHandler(f.getAdmin);

  const res = mockRes();
  await handler(mockReq({
    body: {
      abuseReviewId: 'abuse-1',
      action: 'suspend_account',
      reason: 'Should abort',
      clientMutationId: 'mut-sec-partial-2',
    },
  }), res);

  assert.equal(res.statusCode, 500);

  // Auth was NEVER called
  assert.equal(f.authCalls.length, 0);

  // User remains active
  assert.equal(f.records.get('users/requester-1').accountStatus, 'active');

  // Review remains open
  assert.equal(f.records.get('orderAbuseReviews/abuse-1').status, 'open');
});

test('D. Authoritative Firestore accountStatus blocks existing tokens fail-closed', () => {
  // If Firestore accountStatus is suspended, backend requireActiveAccount immediately denies
  assert.throws(
    () => requireActiveAccount({ accountStatus: 'suspended', role: 'requester' }),
    (error) => error.reason === 'ACCOUNT_SUSPENDED' && error.status === 403
  );

  // Terminated also immediately denied
  assert.throws(
    () => requireActiveAccount({ accountStatus: 'terminated', role: 'requester' }),
    (error) => error.reason === 'ACCOUNT_TERMINATED' && error.status === 403
  );

  // Active succeeds
  assert.doesNotThrow(
    () => requireActiveAccount({ accountStatus: 'active', role: 'requester' })
  );
});

test('E. Concurrent Admin collision: Target accountStatus changed during request -> 409 ACCOUNT_STATE_CHANGED', async () => {
  const f = createEnforcementFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // Admin 2 suspends or alters user concurrently in Firestore right before transaction executes
  const originalRunTx = f.db.runTransaction;
  f.db.runTransaction = async (run) => {
    // Simulate concurrent modification to target user
    f.records.set('users/requester-1', {
      ...f.records.get('users/requester-1'),
      accountStatus: 'suspended',
      status: 'Suspended',
      updatedBy: 'admin-2',
    });
    return originalRunTx(run);
  };

  const res = mockRes();
  await handler(mockReq({
    body: {
      abuseReviewId: 'abuse-1',
      action: 'suspend_account',
      reason: 'Concurrent collision check',
      clientMutationId: 'mut-sec-collision',
    },
  }), res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.reason, 'ACCOUNT_STATE_CHANGED');
});

test('F. Policy: Cannot suspend already terminated or inactive account', async () => {
  const fTerminated = createEnforcementFixture({ targetAccountStatus: 'terminated' });
  const handlerTerminated = createAdminModerationHandler(fTerminated.getAdmin);

  const resTerminated = mockRes();
  await handlerTerminated(mockReq({
    body: {
      abuseReviewId: 'abuse-1',
      action: 'suspend_account',
      reason: 'Cannot suspend terminated',
      clientMutationId: 'mut-sec-term',
    },
  }), resTerminated);

  assert.equal(resTerminated.statusCode, 409);
  assert.equal(resTerminated.body.error.reason, 'ACCOUNT_NOT_ACTIVE');

  // Reactivate is not an allowed action for order abuse reviews
  const resReactivateAbuse = mockRes();
  await handlerTerminated(mockReq({
    body: {
      abuseReviewId: 'abuse-1',
      action: 'reactivate',
      reason: 'Cannot reactivate in abuse review',
      clientMutationId: 'mut-sec-react-abuse',
    },
  }), resReactivateAbuse);
  assert.equal(resReactivateAbuse.statusCode, 400);
  assert.equal(resReactivateAbuse.body.error.reason, 'MODERATION_ACTION_INVALID');

  // Terminated account also cannot be reactivated via chat reports
  fTerminated.records.set('chatReports/report-1', {
    id: 'report-1',
    status: 'open',
    category: 'HARASSMENT',
    reportedUid: 'requester-1',
    reportedRole: 'requester',
    jurisdictionBranchId: 'branch-a',
  });
  const resReactivateReport = mockRes();
  await handlerTerminated(mockReq({
    body: {
      reportId: 'report-1',
      action: 'reactivate',
      reason: 'Cannot reactivate terminated',
      clientMutationId: 'mut-sec-react-term',
    },
  }), resReactivateReport);

  assert.equal(resReactivateReport.statusCode, 409);
  assert.equal(resReactivateReport.body.error.reason, 'ACCOUNT_NOT_REACTIVATABLE');
});

test('G. Self-action and wrong-role target protection', async () => {
  const f = createEnforcementFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // Moderation review targeting self (admin-1)
  f.records.set('orderAbuseReviews/abuse-self', {
    id: 'abuse-self',
    status: 'open',
    requesterUid: 'admin-1',
    branchId: 'branch-a',
    severity: 'review',
    incidents: [],
  });

  const resSelf = mockRes();
  await handler(mockReq({
    body: {
      abuseReviewId: 'abuse-self',
      action: 'suspend_account',
      reason: 'Admin cannot suspend self',
      clientMutationId: 'mut-sec-self',
    },
  }), resSelf);

  // Rejected as wrong target role or self action denied
  assert.equal([403].includes(resSelf.statusCode), true);
  assert.equal(['MODERATION_TARGET_DENIED', 'SELF_ACTION_DENIED'].includes(resSelf.body.error.reason), true);
});

test('H. Manager cannot invoke global suspend_account or terminate_account', async () => {
  const f = createEnforcementFixture();
  const managerHandler = createManagerModerationHandler(f.getAdmin);

  // Manager calling Manager moderation endpoint with suspend_account
  const resManager = mockRes();
  await managerHandler(mockReq({
    headers: { authorization: 'Bearer manager-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'suspend_account',
      reason: 'Manager attempting global suspension',
      clientMutationId: 'mut-sec-mgr-global',
    },
  }), resManager);

  assert.equal(resManager.statusCode, 403);
  assert.equal(resManager.body.error.reason, 'MODERATION_ACTION_DENIED');

  // User account status untouched
  assert.equal(f.records.get('users/requester-1').accountStatus, 'active');
  assert.equal(f.authCalls.length, 0);
});

test('I. Non-punitive actions (Dismiss and Warn) never modify accountStatus or call Auth', async () => {
  const f = createEnforcementFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // Dismiss
  await handler(mockReq({
    body: {
      abuseReviewId: 'abuse-1',
      action: 'dismiss',
      clientMutationId: 'mut-sec-dismiss',
    },
  }), mockRes());

  assert.equal(f.records.get('users/requester-1').accountStatus, 'active');
  assert.equal(f.authCalls.length, 0);

  // Reset review to open for warning check
  f.records.set('orderAbuseReviews/abuse-1', {
    ...f.records.get('orderAbuseReviews/abuse-1'),
    status: 'open',
  });

  // Warn
  await handler(mockReq({
    body: {
      abuseReviewId: 'abuse-1',
      action: 'warn',
      reason: 'Informational warning without suspension',
      clientMutationId: 'mut-sec-warn',
    },
  }), mockRes());

  assert.equal(f.records.get('users/requester-1').accountStatus, 'active');
  assert.equal(f.authCalls.length, 0);
});

test('J. Historical water order data and requester profile fields remain intact', async () => {
  const f = createEnforcementFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  const orderBefore = clone(f.records.get('waterOrders/ord-101'));
  const userBefore = clone(f.records.get('users/requester-1'));

  await handler(mockReq({
    body: {
      abuseReviewId: 'abuse-1',
      action: 'suspend_account',
      reason: 'Verification of immutable history',
      clientMutationId: 'mut-sec-history',
    },
  }), mockRes());

  const orderAfter = f.records.get('waterOrders/ord-101');
  const userAfter = f.records.get('users/requester-1');

  // Historical water orders untouched
  assert.deepEqual(orderBefore, orderAfter);

  // Requester identity, branch, public UID, role preserved
  assert.equal(userAfter.publicUid, userBefore.publicUid);
  assert.equal(userAfter.role, userBefore.role);
  assert.equal(userAfter.branchId, userBefore.branchId);
  assert.equal(userAfter.name, userBefore.name);
});
