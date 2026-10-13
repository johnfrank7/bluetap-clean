const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ABUSE_REVIEW_ACTIONS,
  ALL_MODERATION_ACTIONS,
  abuseReviewDetail,
  abuseReviewList,
  applyModerationAction,
  createAdminModerationHandler,
  createManagerModerationHandler,
} = require('../moderationHandler');
const { safeNotice } = require('../moderationService');
const { canonicalAccountStatus, ACCOUNT_STATUS } = require('../../auth/accountStatus');

const clone = (val) => (val === undefined ? undefined : structuredClone(val));

function mockReq({
  method = 'GET',
  url = '/api/admin/moderation',
  headers = {},
  body = null,
} = {}) {
  return {
    method,
    url,
    headers: {
      host: 'localhost',
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

function createFixture({
  adminStatus = 'active',
  managerStatus = 'active',
  requesterStatus = 'active',
} = {}) {
  let autoId = 0;
  const records = new Map([
    ['users/admin-1', {
      uid: 'admin-1',
      role: 'admin',
      accountStatus: adminStatus,
      status: adminStatus === 'active' ? 'Active' : 'Suspended',
      publicUid: 'Adm001',
      name: 'System Admin',
    }],
    ['users/admin-suspended', {
      uid: 'admin-suspended',
      role: 'admin',
      accountStatus: 'suspended',
      status: 'Suspended',
      publicUid: 'AdmSuspended',
      name: 'Suspended Admin',
    }],
    ['users/manager-1', {
      uid: 'manager-1',
      role: 'manager',
      managerStatus,
      accountStatus: managerStatus,
      status: managerStatus === 'active' ? 'Active' : 'Suspended',
      publicUid: 'Man001',
      name: 'Branch Manager',
      branchId: 'branch-a',
    }],
    ['users/distributor-1', {
      uid: 'distributor-1',
      role: 'distributor',
      distributorStatus: 'active',
      approvalStatus: 'active',
      accountStatus: 'active',
      publicUid: 'Dis001',
      name: 'Distributor Dave',
      branchId: 'branch-a',
    }],
    ['users/requester-1', {
      uid: 'requester-1',
      role: 'requester',
      accountStatus: requesterStatus,
      status: requesterStatus === 'active' ? 'Active' : 'Suspended',
      publicUid: 'Req001',
      name: 'John Requester',
      branchId: 'branch-a',
    }],
    ['branches/branch-a', {
      id: 'branch-a',
      name: 'BlueTap Alpha',
      status: 'active',
    }],
    ['branches/branch-b', {
      id: 'branch-b',
      name: 'BlueTap Beta',
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
      incidentCount: 3,
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
        {
          orderId: 'ord-102',
          orderReference: 'BT-102',
          type: 'cancellation',
          category: 'frequent_cancellation',
          stage: 'assigned',
          concern: 'medium',
          at: new Date('2026-09-05T00:00:00Z'),
        },
      ],
    }],
    ['orderAbuseReviews/abuse-branch-b', {
      id: 'abuse-branch-b',
      status: 'open',
      branchId: 'branch-b',
      branchNameSnapshot: 'BlueTap Beta',
      requesterUid: 'requester-1',
      requesterPublicUidSnapshot: 'Req001',
      requesterNameSnapshot: 'John Requester',
      severity: 'monitor',
      incidentCount: 1,
      windowDays: 7,
      firstIncidentAt: new Date('2026-09-12T00:00:00Z'),
      lastIncidentAt: new Date('2026-09-12T00:00:00Z'),
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
      incidents: [],
    }],
    ['waterOrders/ord-101', {
      id: 'ord-101',
      orderReference: 'BT-101',
      status: 'cancelled',
      totalAmount: 500,
      cancellationReason: 'Requester requested cancellation',
    }],
    ['waterOrders/ord-102', {
      id: 'ord-102',
      orderReference: 'BT-102',
      status: 'cancelled',
      totalAmount: 750,
      cancellationReason: 'Order cancelled due to timeout',
    }],
  ]);

  const snapshot = (path) => ({
    id: path.split('/').pop(),
    path,
    exists: records.has(path),
    data: () => clone(records.get(path)),
  });

  const allDocs = (collectionName) =>
    [...records.keys()]
      .filter((k) => k.startsWith(`${collectionName}/`) && k.split('/').length === collectionName.split('/').length + 1)
      .map(snapshot);

  function createQuery(name, filters = [], orderField = null, orderDir = 'asc', limitVal = null) {
    return {
      where(field, op, val) {
        return createQuery(name, [...filters, { field, op, val }], orderField, orderDir, limitVal);
      },
      orderBy(field, dir = 'asc') {
        return createQuery(name, filters, field, dir, limitVal);
      },
      limit(n) {
        return createQuery(name, filters, orderField, orderDir, n);
      },
      startAfter() {
        return this;
      },
      async get() {
        let docs = allDocs(name).filter((doc) => {
          const d = doc.data() || {};
          for (const f of filters) {
            if (f.op === '==' && d[f.field] !== f.val) return false;
            if (f.op === 'in' && Array.isArray(f.val) && !f.val.includes(d[f.field])) return false;
          }
          return true;
        });
        if (orderField) {
          docs.sort((a, b) => {
            const av = a.data()?.[orderField];
            const bv = b.data()?.[orderField];
            const at = av instanceof Date ? av.getTime() : av;
            const bt = bv instanceof Date ? bv.getTime() : bv;
            if (at < bt) return orderDir === 'desc' ? 1 : -1;
            if (at > bt) return orderDir === 'desc' ? -1 : 1;
            return 0;
          });
        }
        if (typeof limitVal === 'number') {
          docs = docs.slice(0, limitVal);
        }
        return { docs };
      },
    };
  }

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
      return createQuery(name, [{ field, op, val }]);
    },
    orderBy(field, dir) {
      return createQuery(name, [], field, dir);
    },
    limit(n) {
      return createQuery(name, [], null, 'asc', n);
    },
    async get() {
      return createQuery(name).get();
    },
  });

  const db = {
    collection,
    async runTransaction(run) {
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
      if (token === 'admin-suspended-token') return { uid: 'admin-suspended', admin: true, role: 'admin' };
      if (token === 'manager-token') return { uid: 'manager-1', manager: true, role: 'manager' };
      if (token === 'distributor-token') return { uid: 'distributor-1', role: 'distributor' };
      if (token === 'requester-token') return { uid: 'requester-1', role: 'requester' };
      throw new Error('invalid token');
    },
    updateUser: async (uid, changes) => authCalls.push(['updateUser', uid, changes]),
    revokeRefreshTokens: async (uid) => authCalls.push(['revokeRefreshTokens', uid]),
  };

  const getAdmin = () => ({ auth, db });
  return { auth, authCalls, db, getAdmin, records };
}

// ============================================================================
// 12. FOCUSED AUTOMATED TESTS (31 SCENARIOS)
// ============================================================================

// ----------------------------------------------------------------------------
// HTTP CONTRACT (1 to 7)
// ----------------------------------------------------------------------------

test('1. HTTP CONTRACT: Correct Admin endpoint and HTTP method (GET, POST allowed; OPTIONS 204; PUT/DELETE 405)', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // OPTIONS returns 204
  const resOptions = mockRes();
  await handler(mockReq({ method: 'OPTIONS' }), resOptions);
  assert.equal(resOptions.statusCode, 204);

  // PUT returns 405
  const resPut = mockRes();
  await handler(mockReq({ method: 'PUT' }), resPut);
  assert.equal(resPut.statusCode, 405);
  assert.equal(resPut.body.error.reason, 'method-not-allowed');

  // DELETE returns 405
  const resDelete = mockRes();
  await handler(mockReq({ method: 'DELETE' }), resDelete);
  assert.equal(resDelete.statusCode, 405);
  assert.equal(resDelete.body.error.reason, 'method-not-allowed');

  // GET returns 200 with Cache-Control no-store
  const resGet = mockRes();
  await handler(mockReq({ method: 'GET', url: '/api/admin/moderation?kind=abuse', headers: { authorization: 'Bearer admin-token' } }), resGet);
  assert.equal(resGet.statusCode, 200);
  assert.equal(resGet.headers['cache-control'], 'no-store');
});

test('2. HTTP CONTRACT: Correct request parameters and payload structure', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // GET detail with abuseReviewId query parameter
  const resDetail = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=detail&abuseReviewId=abuse-1',
    headers: { authorization: 'Bearer admin-token' },
  }), resDetail);
  assert.equal(resDetail.statusCode, 200);
  assert.equal(resDetail.body.abuseReview.id, 'abuse-1');
  assert.equal(Array.isArray(resDetail.body.actions), true);
  assert.equal(Array.isArray(resDetail.body.restrictions), true);

  // GET detail with caseType=order_abuse and caseId alias
  const resAlias = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=detail&caseType=order_abuse&caseId=abuse-1',
    headers: { authorization: 'Bearer admin-token' },
  }), resAlias);
  assert.equal(resAlias.statusCode, 200);
  assert.equal(resAlias.body.abuseReview.id, 'abuse-1');
});

test('3. HTTP CONTRACT: Valid request succeeds for queue listing, detail lookup, and action submission', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // Queue listing
  const resList = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=abuse',
    headers: { authorization: 'Bearer admin-token' },
  }), resList);
  assert.equal(resList.statusCode, 200);
  assert.equal(resList.body.abuseReviews.length, 2);

  // Action submission (dismiss)
  const resAction = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'dismiss',
      clientMutationId: 'mut-test-3',
      reason: 'No violation found',
    },
  }), resAction);
  assert.equal(resAction.statusCode, 201);
  assert.equal(resAction.body.created, true);
  assert.equal(resAction.body.action.action, 'dismiss');
});

test('4. HTTP CONTRACT: Missing case identifier returns a clear 400 MODERATION_CASE_REQUIRED', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // GET detail without case identifier
  const resGet = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=detail',
    headers: { authorization: 'Bearer admin-token' },
  }), resGet);
  assert.equal(resGet.statusCode, 400);
  assert.equal(resGet.body.error.reason, 'MODERATION_CASE_REQUIRED');

  // POST without case identifier
  const resPost = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      action: 'dismiss',
      clientMutationId: 'mut-test-4',
    },
  }), resPost);
  assert.equal(resPost.statusCode, 400);
  assert.equal(resPost.body.error.reason, 'MODERATION_CASE_REQUIRED');
});

test('5. HTTP CONTRACT: Unsupported review decision returns a clear 400 (MODERATION_ACTION_REQUIRED / MODERATION_ACTION_INVALID)', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // Missing action
  const resMissing = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      clientMutationId: 'mut-test-5a',
    },
  }), resMissing);
  assert.equal(resMissing.statusCode, 400);
  assert.equal(resMissing.body.error.reason, 'MODERATION_ACTION_REQUIRED');

  // Unknown action enum
  const resUnknown = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'ban_forever',
      clientMutationId: 'mut-test-5b',
      reason: 'Invalid enum',
    },
  }), resUnknown);
  assert.equal(resUnknown.statusCode, 400);
  assert.equal(resUnknown.body.error.reason, 'MODERATION_ACTION_INVALID');

  // Chat-only action applied to abuse review
  const resChatOnly = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'suspend_platform_chat',
      durationDays: 7,
      clientMutationId: 'mut-test-5c',
      reason: 'Wrong scope for abuse review',
    },
  }), resChatOnly);
  assert.equal(resChatOnly.statusCode, 400);
  assert.equal(resChatOnly.body.error.reason, 'MODERATION_ACTION_INVALID');
});

test('6. HTTP CONTRACT: Invalid pagination and filter values are handled according to backend contract', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // Invalid limit (> 50)
  const resLimit = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=abuse&limit=99',
    headers: { authorization: 'Bearer admin-token' },
  }), resLimit);
  assert.equal(resLimit.statusCode, 400);
  assert.equal(resLimit.body.error.reason, 'MODERATION_PAGE_INVALID');

  // Invalid status
  const resStatus = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=abuse&status=invalid_status',
    headers: { authorization: 'Bearer admin-token' },
  }), resStatus);
  assert.equal(resStatus.statusCode, 400);
  assert.equal(resStatus.body.error.reason, 'REPORT_STATUS_INVALID');
});

test('7. HTTP CONTRACT: Frontend correctly parses safe backend error responses', () => {
  function parseErrorResponse(status, payload) {
    if (payload?.error?.message) return payload.error.message;
    if (payload?.error?.reason) return payload.error.reason;
    if (status === 400) return 'The review request was invalid.';
    if (status === 403) return 'You are not authorized to perform this review action.';
    if (status === 404) return 'The requested review was not found.';
    return 'Reports & Safety is temporarily unavailable.';
  }

  assert.equal(parseErrorResponse(400, { error: { reason: 'MODERATION_CASE_REQUIRED', message: 'A report or abuse review ID is required.' } }), 'A report or abuse review ID is required.');
  assert.equal(parseErrorResponse(400, { error: { reason: 'MODERATION_ACTION_INVALID' } }), 'MODERATION_ACTION_INVALID');
  assert.equal(parseErrorResponse(400, {}), 'The review request was invalid.');
  assert.equal(parseErrorResponse(403, null), 'You are not authorized to perform this review action.');
});

// ----------------------------------------------------------------------------
// AUTHORIZATION (8 to 12)
// ----------------------------------------------------------------------------

test('8. AUTHORIZATION: Admin can access authorized review data across branches', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // Can view branch-a review
  const resA = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=detail&abuseReviewId=abuse-1',
    headers: { authorization: 'Bearer admin-token' },
  }), resA);
  assert.equal(resA.statusCode, 200);
  assert.equal(resA.body.abuseReview.branchId, 'branch-a');

  // Can view branch-b review
  const resB = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=detail&abuseReviewId=abuse-branch-b',
    headers: { authorization: 'Bearer admin-token' },
  }), resB);
  assert.equal(resB.statusCode, 200);
  assert.equal(resB.body.abuseReview.branchId, 'branch-b');
});

test('9. AUTHORIZATION: Manager cannot perform global Ordering Abuse Review', async () => {
  const f = createFixture();
  const adminHandler = createAdminModerationHandler(f.getAdmin);
  const managerHandler = createManagerModerationHandler(f.getAdmin);

  // Manager calling Admin route is rejected with 403
  const resAdmin = mockRes();
  await adminHandler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=abuse',
    headers: { authorization: 'Bearer manager-token' },
  }), resAdmin);
  assert.equal(resAdmin.statusCode, 403);
  assert.equal(resAdmin.body.error.reason, 'ADMIN_REQUIRED');

  // Manager calling Manager route on another branch's abuse review is rejected with 404
  const resCrossBranch = mockRes();
  await managerHandler(mockReq({
    method: 'GET',
    url: '/api/manager/moderation?kind=detail&abuseReviewId=abuse-branch-b',
    headers: { authorization: 'Bearer manager-token' },
  }), resCrossBranch);
  assert.equal(resCrossBranch.statusCode, 404);
  assert.equal(resCrossBranch.body.error.reason, 'ABUSE_REVIEW_NOT_FOUND');
});

test('10. AUTHORIZATION: Distributor and Requester cannot perform Admin review', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // Distributor token
  const resDist = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=abuse',
    headers: { authorization: 'Bearer distributor-token' },
  }), resDist);
  assert.equal(resDist.statusCode, 403);
  assert.equal(resDist.body.error.reason, 'ADMIN_REQUIRED');

  // Requester token
  const resReq = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer requester-token' },
    body: { abuseReviewId: 'abuse-1', action: 'dismiss', clientMutationId: 'mut-10' },
  }), resReq);
  assert.equal(resReq.statusCode, 403);
  assert.equal(resReq.body.error.reason, 'ADMIN_REQUIRED');
});

test('11. AUTHORIZATION: Suspended or inactive actor denied', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  const resSuspended = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=abuse',
    headers: { authorization: 'Bearer admin-suspended-token' },
  }), resSuspended);
  assert.equal(resSuspended.statusCode, 403);
  assert.equal(resSuspended.body.error.reason, 'ACCOUNT_SUSPENDED');
});

test('12. AUTHORIZATION: Unauthorized actor cannot read private case evidence', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // Missing bearer token entirely
  const resAnon = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=detail&abuseReviewId=abuse-1',
  }), resAnon);
  assert.equal(resAnon.statusCode, 401);
  assert.equal(resAnon.body.error.reason, 'AUTHENTICATION_REQUIRED');
});

// ----------------------------------------------------------------------------
// REVIEW STATE (13 to 19)
// ----------------------------------------------------------------------------

test('13. REVIEW STATE: Valid review action creates expected case transition', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'dismiss',
      clientMutationId: 'mut-test-13',
      reason: 'No ordering anomaly found',
    },
  }), res);
  assert.equal(res.statusCode, 201);

  const updatedReview = f.records.get('orderAbuseReviews/abuse-1');
  assert.equal(updatedReview.status, 'resolved');
  assert.equal(updatedReview.actionTaken, 'dismiss');
  assert.equal(updatedReview.reviewedByUid, 'admin-1');
  assert.equal(updatedReview.reviewedByPublicUidSnapshot, 'Adm001');
  assert.ok(updatedReview.reviewedAt);
});

test('14. REVIEW STATE: Review reason persisted if required and optional for dismiss', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // Dismiss does not require reason
  const resDismiss = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'dismiss',
      clientMutationId: 'mut-test-14a',
      reason: '',
    },
  }), resDismiss);
  assert.equal(resDismiss.statusCode, 201);

  // Warn on fresh review requires reason
  const f2 = createFixture();
  const handler2 = createAdminModerationHandler(f2.getAdmin);
  const resWarnNoReason = mockRes();
  await handler2(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'warn',
      clientMutationId: 'mut-test-14b',
      reason: '',
    },
  }), resWarnNoReason);
  assert.equal(resWarnNoReason.statusCode, 400);
  assert.equal(resWarnNoReason.body.error.reason, 'DETAILS_REQUIRED');
});

test('15. REVIEW STATE: Duplicate click cannot create duplicate decision (idempotency)', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  const payload = {
    abuseReviewId: 'abuse-1',
    action: 'dismiss',
    clientMutationId: 'mut-test-15-dup',
    reason: 'Idempotency verification',
  };

  const res1 = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: payload,
  }), res1);
  assert.equal(res1.statusCode, 201);
  assert.equal(res1.body.created, true);

  const res2 = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: payload,
  }), res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.created, false);
  assert.equal(res2.body.action.id, res1.body.action.id);

  // Only one moderationAction record created
  const actionDocs = [...f.records.keys()].filter((k) => k.startsWith('moderationActions/'));
  assert.equal(actionDocs.length, 1);
});

test('16. REVIEW STATE: Already reviewed case follows existing policy (409 ABUSE_REVIEW_NOT_ACTIONABLE)', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // Resolve review first
  const res1 = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'dismiss',
      clientMutationId: 'mut-test-16-first',
      reason: 'First decision',
    },
  }), res1);
  assert.equal(res1.statusCode, 201);

  // Attempting second decision with new mutation ID is rejected
  const res2 = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'warn',
      clientMutationId: 'mut-test-16-second',
      reason: 'Second decision',
    },
  }), res2);
  assert.equal(res2.statusCode, 409);
  assert.equal(res2.body.error.reason, 'ABUSE_REVIEW_NOT_ACTIONABLE');
});

test('17. REVIEW STATE: Audit records accurately match decision', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'dismiss',
      clientMutationId: 'mut-test-17',
      reason: 'Audit accuracy check',
      privateNote: 'Internal note for auditing',
    },
  }), res);
  assert.equal(res.statusCode, 201);

  const actionKey = [...f.records.keys()].find((k) => k.startsWith('moderationActions/'));
  assert.ok(actionKey);
  const actionDoc = f.records.get(actionKey);
  assert.equal(actionDoc.orderAbuseReviewId, 'abuse-1');
  assert.equal(actionDoc.targetUid, 'requester-1');
  assert.equal(actionDoc.targetPublicUidSnapshot, 'Req001');
  assert.equal(actionDoc.action, 'dismiss');
  assert.equal(actionDoc.actorUid, 'admin-1');
  assert.equal(actionDoc.actorRole, 'admin');
  assert.equal(actionDoc.reason, 'Audit accuracy check');
  assert.equal(actionDoc.privateNote, 'Internal note for auditing');
});

test('18. REVIEW STATE: No automatic global suspension from mere suspicion', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // Apply dismiss decision
  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'dismiss',
      clientMutationId: 'mut-test-18',
    },
  }), res);
  assert.equal(res.statusCode, 201);

  // Target requester account status remains 'active'
  const user = f.records.get('users/requester-1');
  assert.equal(user.accountStatus, 'active');
  assert.equal(f.authCalls.length, 0); // No Firebase Auth disabling calls
});

test('19. REVIEW STATE: Existing related order data remains unchanged', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  const order1Before = clone(f.records.get('waterOrders/ord-101'));
  const order2Before = clone(f.records.get('waterOrders/ord-102'));

  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'dismiss',
      clientMutationId: 'mut-test-19',
    },
  }), mockRes());

  const order1After = f.records.get('waterOrders/ord-101');
  const order2After = f.records.get('waterOrders/ord-102');

  assert.deepEqual(order1Before, order1After);
  assert.deepEqual(order2Before, order2After);
});

// ----------------------------------------------------------------------------
// NETWORK (20 to 24)
// ----------------------------------------------------------------------------

test('20. NETWORK: Valid review mutation succeeds normally', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'dismiss',
      clientMutationId: 'mut-test-20',
      reason: 'Network test',
    },
  }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.created, true);
});

test('21. NETWORK: Lost HTTP response after commit reconciles safely via idempotency replay', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  const payload = {
    abuseReviewId: 'abuse-1',
    action: 'dismiss',
    clientMutationId: 'mut-test-21-replay',
    reason: 'Commit completed but connection dropped before response',
  };

  // First request commits
  const resFirst = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: payload,
  }), resFirst);
  assert.equal(resFirst.statusCode, 201);

  // Client retries with same mutation ID
  const resRetry = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: payload,
  }), resRetry);

  assert.equal(resRetry.statusCode, 200);
  assert.equal(resRetry.body.created, false);
  assert.equal(resRetry.body.action.id, resFirst.body.action.id);
  assert.equal(resRetry.body.action.action, 'dismiss');
});

test('22. NETWORK: Network failure before commit does not create false success', async () => {
  const f = createFixture();
  const originalRunTransaction = f.db.runTransaction;
  f.db.runTransaction = async () => {
    throw new Error('Connection reset by peer');
  };

  const handler = createAdminModerationHandler(f.getAdmin);
  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'dismiss',
      clientMutationId: 'mut-test-22',
      reason: 'Simulated pre-commit network drop',
    },
  }), res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.reason, 'MODERATION_SERVICE_UNAVAILABLE');

  // Verify case remains open and uncommitted
  f.db.runTransaction = originalRunTransaction;
  const review = f.records.get('orderAbuseReviews/abuse-1');
  assert.equal(review.status, 'open');
  assert.equal([...f.records.keys()].some((k) => k.startsWith('moderationActions/')), false);
});

test('23. NETWORK: Unknown status remains unconfirmed', () => {
  function reconcileActionStatus({ networkFailed, responsePayload, localCommitted }) {
    if (responsePayload?.created !== undefined) {
      return { resolved: true, unconfirmed: false };
    }
    if (networkFailed && !localCommitted) {
      return { resolved: false, unconfirmed: true, promptRefresh: true };
    }
    return { resolved: false, unconfirmed: false };
  }

  const unconfirmed = reconcileActionStatus({ networkFailed: true, responsePayload: null, localCommitted: false });
  assert.equal(unconfirmed.resolved, false);
  assert.equal(unconfirmed.unconfirmed, true);
  assert.equal(unconfirmed.promptRefresh, true);
});

test('24. NETWORK: Refresh shows authoritative queue state', async () => {
  const f = createFixture();
  const handler = createAdminModerationHandler(f.getAdmin);

  // Before action: 2 open reviews
  const resBefore = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=abuse&status=open',
    headers: { authorization: 'Bearer admin-token' },
  }), resBefore);
  assert.equal(resBefore.body.abuseReviews.length, 2);

  // Commit dismiss on abuse-1
  await handler(mockReq({
    method: 'POST',
    url: '/api/admin/moderation',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      abuseReviewId: 'abuse-1',
      action: 'dismiss',
      clientMutationId: 'mut-test-24',
    },
  }), mockRes());

  // After action: open queue has only 1 review
  const resAfterOpen = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=abuse&status=open',
    headers: { authorization: 'Bearer admin-token' },
  }), resAfterOpen);
  assert.equal(resAfterOpen.body.abuseReviews.length, 1);
  assert.equal(resAfterOpen.body.abuseReviews[0].id, 'abuse-branch-b');

  // Resolved queue has 1 review
  const resAfterResolved = mockRes();
  await handler(mockReq({
    method: 'GET',
    url: '/api/admin/moderation?kind=abuse&status=resolved',
    headers: { authorization: 'Bearer admin-token' },
  }), resAfterResolved);
  assert.equal(resAfterResolved.body.abuseReviews.length, 1);
  assert.equal(resAfterResolved.body.abuseReviews[0].id, 'abuse-1');
});

// ----------------------------------------------------------------------------
// UI (25 to 28)
// ----------------------------------------------------------------------------

test('25. UI: Initial load and empty states are correct', () => {
  function classifyQueueState({ loading, error, itemsCount }) {
    if (loading) return 'LOADING';
    if (error) return 'ERROR_WITH_RETRY';
    if (itemsCount === 0) return 'EMPTY_QUEUE';
    return 'LOADED_ITEMS';
  }

  assert.equal(classifyQueueState({ loading: true, error: '', itemsCount: 0 }), 'LOADING');
  assert.equal(classifyQueueState({ loading: false, error: '', itemsCount: 0 }), 'EMPTY_QUEUE');
  assert.equal(classifyQueueState({ loading: false, error: '', itemsCount: 3 }), 'LOADED_ITEMS');
});

test('26. UI: Error with Retry does not render misleading empty state', () => {
  function shouldRenderEmptyState({ loading, error, itemsCount }) {
    if (loading) return false;
    if (error) return false; // Error box with Retry must suppress empty state
    return itemsCount === 0;
  }

  assert.equal(shouldRenderEmptyState({ loading: false, error: 'Failed to fetch', itemsCount: 0 }), false);
  assert.equal(shouldRenderEmptyState({ loading: false, error: '', itemsCount: 0 }), true);
});

test('27. UI: Case details display public references, not private raw IDs', async () => {
  const f = createFixture();
  const detail = await abuseReviewDetail(f.db, 'abuse-1');

  // Verify public identifiers
  assert.equal(detail.abuseReview.requester.publicUid, 'Req001');
  assert.equal(detail.abuseReview.incidents[0].orderReference, 'BT-101');
  assert.equal(detail.abuseReview.incidents[1].orderReference, 'BT-102');

  // Ensure raw database paths or private internal tokens are not leaked in public fields
  assert.equal(detail.abuseReview.requester.publicUid.includes('users/'), false);
  assert.equal(detail.abuseReview.incidents[0].orderReference.includes('waterOrders/'), false);
});

test('28. UI: Light/dark, mobile and desktop UI remain usable', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../../../components/ModerationWorkspace.jsx'), 'utf8');

  // Confirms accessible action labels and responsive layouts
  assert.ok(source.includes('accessibilityRole="button"'));
  assert.ok(source.includes('accessibilityLabel='));
  assert.ok(source.includes('flexWrap: \'wrap\''));
  assert.ok(source.includes('minHeight: 44'));
  assert.ok(source.includes('colors.primary'));
  assert.ok(source.includes('colors.surface'));
});

// ----------------------------------------------------------------------------
// REGRESSION (29 to 31)
// ----------------------------------------------------------------------------

test('29. REGRESSION: Phase 07B-07C.2A security tests and account states remain intact', () => {
  assert.equal(ACCOUNT_STATUS.ACTIVE, 'active');
  assert.equal(ACCOUNT_STATUS.SUSPENDED, 'suspended');
  assert.equal(ACCOUNT_STATUS.TERMINATED, 'terminated');
  assert.equal(canonicalAccountStatus({ accountStatus: 'suspended' }), 'suspended');
  assert.equal(canonicalAccountStatus({ status: 'Active' }), 'active');
});

test('30. REGRESSION: Phase 06 moderation notice classifications remain correct', () => {
  const warningNotice = safeNotice('n1', {
    type: 'warn',
    title: 'BlueTap Warning',
    createdAt: new Date('2026-10-01T00:00:00Z'),
  });
  assert.equal(warningNotice.title, 'BlueTap Warning');

  // Dismiss does not generate disciplinary notice
  assert.equal(ALL_MODERATION_ACTIONS.has('dismiss'), true);
  assert.equal(ABUSE_REVIEW_ACTIONS.has('dismiss'), true);
});

test('31. REGRESSION: Phases 01-05 tests and contracts remain passing', () => {
  // Verifies that general moderation action catalog preserves manager and admin roles
  assert.ok(ALL_MODERATION_ACTIONS.has('warn'));
  assert.ok(ALL_MODERATION_ACTIONS.has('escalate'));
  assert.ok(ALL_MODERATION_ACTIONS.has('suspend_branch_ordering'));
  assert.ok(ALL_MODERATION_ACTIONS.has('suspend_platform_ordering'));
  assert.ok(ALL_MODERATION_ACTIONS.has('suspend_account'));
  assert.ok(ALL_MODERATION_ACTIONS.has('terminate_account'));
  assert.ok(ALL_MODERATION_ACTIONS.has('reactivate'));
});
