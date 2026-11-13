const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { createDistributorAssignedOrdersHandler } = require('../../distributor/assignedOrdersHandler');
const { createManagerDispatchHandler } = require('../dispatchHandler');
const { authorizeRequesterDistributor, CONVERSATION_TYPES, FAILED_DELIVERY_CHAT_GRACE_MS } = require('../../chat/chatAuthorization');
const { authorityKeyHash, buildConversationFoundation } = require('../../chat/conversationService');
const { manilaScheduleDate, scheduledWeekday } = require('../../../services/productOrderPolicy');
const { getRoleOrderNotifications } = require('../../../services/orderNotifications');
const { seedDispatchGuards } = require('./dispatchGuardFixture');
const {
  canManagerResolveFailedOrder,
  createManagerFailedDeliveryResolutionFlow,
  getEligibleBranchDistributors,
  validateRescheduleReason,
} = require('../../../services/managerFailedDeliveryResolution');

function createFixture() {
  const records = new Map([
    ['branches/branch-a', { name: 'Branch A', status: 'active', latitude: 10.267, longitude: 123.584, serviceRadiusKm: 5 }],
    ['branches/branch-b', { name: 'Branch B', status: 'active', latitude: 10.31, longitude: 123.63, serviceRadiusKm: 10 }],
    ['users/manager-a', { role: 'manager', managerStatus: 'active', branchId: 'branch-a', fullName: 'Manager A' }],
    ['users/manager-b', { role: 'manager', managerStatus: 'active', branchId: 'branch-b', fullName: 'Manager B' }],
    ['users/distributor-a', { role: 'distributor', approvalStatus: 'active', branchId: 'branch-a', fullName: 'Distributor A', phone: '09123456789', completeAddress: 'Barangay Poblacion, Toledo City' }],
    ['users/distributor-a2', { role: 'distributor', approvalStatus: 'active', branchId: 'branch-a', fullName: 'Distributor A2', phone: '09123456789', completeAddress: 'Barangay Luray II, Toledo City' }],
    ['users/distributor-b', { role: 'distributor', approvalStatus: 'active', branchId: 'branch-b', fullName: 'Distributor B', phone: '09123456789', completeAddress: 'Barangay Sangi, Toledo City' }],
    ['users/distributor-inactive', { role: 'distributor', approvalStatus: 'inactive', branchId: 'branch-a', fullName: 'Inactive Distributor' }],
    ['users/requester-1', { role: 'requester', accountStatus: 'active', fullName: 'Requester One' }],
    [
      'requests/order-failed',
      {
        requestId: 'BT-FAIL-01',
        requesterUid: 'requester-1',
        requester_id: 'requester-1',
        requesterNameSnapshot: 'Requester One',
        requesterUniqueIdSnapshot: 'REQ-001',
        contactNumberSnapshot: '09123456789',
        branchId: 'branch-a',
        currentBranchId: 'branch-a',
        initialBranchId: 'branch-a',
        branchNameSnapshot: 'Branch A',
        status: 'accepted',
        assignedDistributorUid: 'distributor-a',
        assignedDistributorNameSnapshot: 'Distributor A',
        assignmentVersion: 2,
        paymentMethod: 'cash_on_delivery',
        items: [{ productId: 'product-1', productNameSnapshot: '5-Gallon Purified Refill', quantity: 2, totalAtOrder: 70 }],
        totalAtOrder: 70,
        assignmentHistory: [
          {
            event: 'DISTRIBUTOR_ASSIGNED',
            branchId: 'branch-a',
            distributorUid: 'distributor-a',
            distributorName: 'Distributor A',
            assignedByManagerUid: 'manager-a',
            scheduledAt: new Date(Date.now() - 3600000).toISOString(),
            at: new Date(Date.now() - 7200000).toISOString(),
          },
        ],
        distributorDeliveryHistory: [
          {
            event: 'ASSIGNMENT_ACCEPTED',
            distributorUid: 'distributor-a',
            branchId: 'branch-a',
            at: new Date(Date.now() - 5400000).toISOString(),
          },
        ],
      },
    ],
    ['products/product-1', { name: '5-Gallon Purified Refill', active: true, price: 35, branchIds: ['branch-a', 'branch-b'] }],
    ['requesterActiveOrders/requester-1', { orderId: 'order-failed', requesterUid: 'requester-1' }],
  ]);

  const authUsers = new Map([
    ['manager-a', { disabled: false }],
    ['manager-b', { disabled: false }],
    ['distributor-a', { disabled: false }],
    ['distributor-a2', { disabled: false }],
    ['distributor-b', { disabled: false }],
    ['distributor-inactive', { disabled: true }],
    ['requester-1', { disabled: false }],
  ]);

  const snapshot = (docPath) => ({
    id: docPath.split('/').pop(),
    exists: records.has(docPath),
    data: () => records.get(docPath),
  });

  const collection = (name) => ({
    doc(id) {
      const docPath = `${name}/${id}`;
      return {
        id,
        path: docPath,
        get: async () => snapshot(docPath),
        set: async (data) => records.set(docPath, data),
        update: async (data) => records.set(docPath, { ...records.get(docPath), ...data }),
        delete: async () => records.delete(docPath),
      };
    },
    where(field, operator, value) {
      const filters = [[field, operator, value]];
      const docs = () =>
        [...records.entries()]
          .filter(([docPath, data]) => docPath.startsWith(`${name}/`) && filters.every(([key, op, expected]) => op === '!=' ? data[key] != null && data[key] !== expected : data[key] === expected))
          .map(([docPath]) => snapshot(docPath));
      return {
        where(key, op, expected) {
          filters.push([key, op, expected]);
          return this;
        },
        async get() {
          return { docs: docs() };
        },
        limit(count) {
          return {
            async get() {
              return { docs: docs().slice(0, count) };
            },
          };
        },
      };
    },
    async get() {
      return {
        docs: [...records.keys()].filter((docPath) => docPath.startsWith(`${name}/`)).map(snapshot),
      };
    },
  });

  let transactionQueue = Promise.resolve();
  const db = {
    collection,
    async runTransaction(run) {
      const previous = transactionQueue;
      let release;
      transactionQueue = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        const writes = [];
        const stage = (method, ref, data) => writes.push({ method, ref, data });
        const result = await run({
          get: async (ref) => {
            if (writes.length) {
              throw new Error('Firestore transactions require all reads to be executed before all writes.');
            }
            return ref.get();
          },
          set(ref, data) {
            stage('set', ref, data);
          },
          update(ref, data) {
            stage('update', ref, data);
          },
          create(ref, data) {
            stage('create', ref, data);
          },
          delete(ref) {
            stage('delete', ref);
          },
        });
        for (const { method, ref } of writes) {
          if (method === 'create' && records.has(ref.path)) {
            throw new Error('Document already exists.');
          }
        }
        for (const { method, ref, data } of writes) {
          if (method === 'delete') records.delete(ref.path);
          else if (method === 'update') records.set(ref.path, { ...records.get(ref.path), ...data });
          else records.set(ref.path, data);
        }
        return result;
      } finally {
        release();
      }
    },
  };

  const auth = {
    async verifyIdToken(token) {
      const mapping = {
        'manager-a-token': 'manager-a',
        'manager-b-token': 'manager-b',
        'distributor-a-token': 'distributor-a',
        'distributor-a2-token': 'distributor-a2',
        'distributor-b-token': 'distributor-b',
      };
      const uid = mapping[token];
      if (!uid) throw new Error('bad token');
      return {
        uid,
        role: uid.startsWith('manager') ? 'manager' : 'distributor',
        ...(uid.startsWith('manager') ? { manager: true } : {}),
      };
    },
    async getUser(uid) {
      return authUsers.get(uid) || { disabled: true };
    },
  };

  return { records, authUsers, getAdmin: () => { seedDispatchGuards(records); return { auth, db }; } };
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
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    },
  };
}

async function call(handler, method, token, body) {
  const res = response();
  await handler({ method, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

async function seedFailedDeliveryWithAttempt(f) {
  const distributorHandler = createDistributorAssignedOrdersHandler(f.getAdmin);
  const authority = {
    type: CONVERSATION_TYPES.REQUESTER_DISTRIBUTOR,
    orderId: 'order-failed',
    requesterUid: 'requester-1',
    distributorUid: 'distributor-a',
    assignmentVersion: 2,
  };
  const hash = authorityKeyHash(authority.type, authority);
  f.records.set(`chatAuthorityRegistry/${hash}`, {
    authorityKeyHash: hash,
    conversationId: 'conv-failed-1',
    type: authority.type,
  });
  f.records.set(
    'chatConversations/conv-failed-1',
    buildConversationFoundation({
      type: authority.type,
      authority,
      createdBy: { uid: 'manager-a', role: 'manager' },
      now: new Date(),
    })
  );

  const started = await call(distributorHandler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-failed',
    action: 'start-delivery',
  });
  assert.equal(started.statusCode, 200);
  const attemptId = f.records.get('requests/order-failed').activeDeliveryAttemptId;
  assert.ok(attemptId);

  const failed = await call(distributorHandler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-failed',
    action: 'fail-delivery',
    failureReasonCode: 'NO_RESPONSE',
    failureReasonNote: '',
    clientMutationId: 'report-mutation-001',
    reportFormat: 'structured-v1',
    reportEvidence: { contactAttempts: [{ method: 'PHONE_CALL', outcome: 'NO_ANSWER' }] },
  });
  assert.equal(failed.statusCode, 200);
  assert.equal(failed.body.order.status, 'delivery_failed');
  return { attemptId, distributorHandler };
}

const futureSchedule = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

test('1. Authorized Manager rescheduling updates failed order to scheduled, requires reason, and preserves Distributor and attempt evidence', async () => {
  const f = createFixture();
  const { attemptId } = await seedFailedDeliveryWithAttempt(f);
  const managerHandler = createManagerDispatchHandler(f.getAdmin);
  const scheduleIso = futureSchedule();

  const res = await call(managerHandler, 'PATCH', 'manager-a-token', {
    orderId: 'order-failed',
    action: 'reschedule-delivery',
    distributorUid: 'distributor-a',
    scheduledAt: scheduleIso,
    rescheduleReason: 'Confirmed afternoon window with Requester via branch chat.',
    expectedStatus: 'delivery_failed',
    clientMutationId: 'mgr-resched-01',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.order.status, 'scheduled');
  assert.equal(res.body.order.assignedDistributorUid, 'distributor-a');
  assert.equal(res.body.order.assignmentVersion, 2);
  assert.equal(res.body.order.rescheduleReason, 'Confirmed afternoon window with Requester via branch chat.');
  assert.equal(res.body.order.rescheduledByManagerUid, 'manager-a');
  assert.equal(res.body.order.rescheduledByRole, 'manager');
  assert.equal(new Date(res.body.order.scheduledAt).toISOString(), scheduleIso);
  assert.equal(res.body.order.expectedDeliveryDate, scheduleIso);

  const savedOrder = f.records.get('requests/order-failed');
  assert.equal(savedOrder.status, 'scheduled');
  assert.equal(savedOrder.assignedDistributorUid, 'distributor-a');
  assert.equal(savedOrder.assignmentVersion, 2);
  assert.equal(savedOrder.distributorChatGraceUntil, null);
  assert.equal(savedOrder.failureReasonCode, 'NO_RESPONSE');
  assert.equal(savedOrder.failureReasonLabel, 'Customer did not respond');
  assert.equal(savedOrder.assignmentHistory.at(-1).event, 'DELIVERY_RESCHEDULED_BY_MANAGER');
  assert.equal(savedOrder.assignmentHistory.at(-1).rescheduleReason, 'Confirmed afternoon window with Requester via branch chat.');

  // Historical deliveryAttempts and audit events remain intact
  const savedAttempt = f.records.get(`deliveryAttempts/${attemptId}`);
  assert.equal(savedAttempt.outcome, 'failed');
  assert.equal(savedAttempt.reviewState, 'reported');
  assert.deepEqual(savedAttempt.reportEvidence, { contactAttempts: [{ method: 'PHONE_CALL', outcome: 'NO_ANSWER' }] });
  assert.equal(f.records.get(`deliveryAttemptEvents/${attemptId}_outcome`).kind, 'ATTEMPT_FAILED');
});

test('2. Unauthorized Manager from another branch is rejected with 403 for both reschedule and reassign', async () => {
  const f = createFixture();
  await seedFailedDeliveryWithAttempt(f);
  const managerHandler = createManagerDispatchHandler(f.getAdmin);
  const scheduleIso = futureSchedule();

  const crossBranchReschedule = await call(managerHandler, 'PATCH', 'manager-b-token', {
    orderId: 'order-failed',
    action: 'reschedule-delivery',
    distributorUid: 'distributor-a',
    scheduledAt: scheduleIso,
    rescheduleReason: 'Cross-branch attempt',
  });
  assert.equal(crossBranchReschedule.statusCode, 403);
  assert.equal(f.records.get('requests/order-failed').status, 'delivery_failed');

  const crossBranchReassign = await call(managerHandler, 'PATCH', 'manager-b-token', {
    orderId: 'order-failed',
    action: 'reassign-distributor',
    distributorUid: 'distributor-a2',
    scheduledAt: scheduleIso,
  });
  assert.equal(crossBranchReassign.statusCode, 403);
  assert.equal(f.records.get('requests/order-failed').assignedDistributorUid, 'distributor-a');
});

test('3. Invalid or past schedule, disallowed weekday, and missing/short reschedule reason fail closed', async () => {
  const f = createFixture();
  await seedFailedDeliveryWithAttempt(f);
  const managerHandler = createManagerDispatchHandler(f.getAdmin);

  const pastRes = await call(managerHandler, 'PATCH', 'manager-a-token', {
    orderId: 'order-failed',
    action: 'reschedule-delivery',
    distributorUid: 'distributor-a',
    scheduledAt: new Date(Date.now() - 3600000).toISOString(),
    rescheduleReason: 'Valid reason text',
  });
  assert.equal(pastRes.statusCode, 400);
  assert.equal(pastRes.body.error.reason, 'INVALID_DELIVERY_SCHEDULE');

  const invalidDateRes = await call(managerHandler, 'PATCH', 'manager-a-token', {
    orderId: 'order-failed',
    action: 'reschedule-delivery',
    distributorUid: 'distributor-a',
    scheduledAt: 'not-a-timestamp',
    rescheduleReason: 'Valid reason text',
  });
  assert.equal(invalidDateRes.statusCode, 400);
  assert.equal(invalidDateRes.body.error.reason, 'INVALID_DELIVERY_SCHEDULE');

  const missingReasonRes = await call(managerHandler, 'PATCH', 'manager-a-token', {
    orderId: 'order-failed',
    action: 'reschedule-delivery',
    distributorUid: 'distributor-a',
    scheduledAt: futureSchedule(),
    rescheduleReason: '  ',
  });
  assert.equal(missingReasonRes.statusCode, 400);
  assert.equal(missingReasonRes.body.error.reason, 'RESCHEDULE_REASON_REQUIRED');

  const validDay = manilaScheduleDate(2, 13);
  const disallowedDay = manilaScheduleDate(3, 13);
  f.records.get('requests/order-failed').effectiveDeliveryDaysSnapshot = [scheduledWeekday(validDay)];

  const badWeekdayRes = await call(managerHandler, 'PATCH', 'manager-a-token', {
    orderId: 'order-failed',
    action: 'reschedule-delivery',
    distributorUid: 'distributor-a',
    scheduledAt: disallowedDay.toISOString(),
    rescheduleReason: 'Customer available tomorrow afternoon.',
  });
  assert.equal(badWeekdayRes.statusCode, 409);
  assert.equal(badWeekdayRes.body.error.reason, 'PRODUCT_DELIVERY_DAY_UNAVAILABLE');
  assert.equal(f.records.get('requests/order-failed').status, 'delivery_failed');
});

test('4. Stale order status is rejected with 409 ORDER_STATE_CHANGED or ORDER_NOT_RESCHEDULABLE', async () => {
  const f = createFixture();
  await seedFailedDeliveryWithAttempt(f);
  const managerHandler = createManagerDispatchHandler(f.getAdmin);
  const scheduleIso = futureSchedule();

  // Order transitions to out_for_delivery before Manager submits
  f.records.get('requests/order-failed').status = 'out_for_delivery';

  const staleExpectedStatus = await call(managerHandler, 'PATCH', 'manager-a-token', {
    orderId: 'order-failed',
    action: 'reschedule-delivery',
    distributorUid: 'distributor-a',
    scheduledAt: scheduleIso,
    rescheduleReason: 'Reschedule after customer call.',
    expectedStatus: 'delivery_failed',
  });
  assert.equal(staleExpectedStatus.statusCode, 409);
  assert.equal(staleExpectedStatus.body.error.reason, 'ORDER_STATE_CHANGED');

  const nonFailedStatus = await call(managerHandler, 'PATCH', 'manager-a-token', {
    orderId: 'order-failed',
    action: 'reschedule-delivery',
    distributorUid: 'distributor-a',
    scheduledAt: scheduleIso,
    rescheduleReason: 'Reschedule after customer call.',
  });
  assert.equal(nonFailedStatus.statusCode, 409);
  assert.equal(nonFailedStatus.body.error.reason, 'ORDER_NOT_RESCHEDULABLE');
});

test('5. Duplicate submissions are idempotent on backend and single-flight locked in UI controller', async () => {
  const f = createFixture();
  await seedFailedDeliveryWithAttempt(f);
  const managerHandler = createManagerDispatchHandler(f.getAdmin);
  const scheduleIso = futureSchedule();

  const payload = {
    orderId: 'order-failed',
    action: 'reschedule-delivery',
    distributorUid: 'distributor-a',
    scheduledAt: scheduleIso,
    rescheduleReason: 'Customer confirmed tomorrow morning slot.',
    expectedStatus: 'delivery_failed',
    clientMutationId: 'dup-mutation-100',
  };

  const first = await call(managerHandler, 'PATCH', 'manager-a-token', payload);
  assert.equal(first.statusCode, 200);
  const historyLenAfterFirst = f.records.get('requests/order-failed').assignmentHistory.length;
  const dispatchEventsAfterFirst = f.records.get('requests/order-failed').dispatchEventHistory.length;

  // Retry with identical clientMutationId
  const second = await call(managerHandler, 'PATCH', 'manager-a-token', payload);
  assert.equal(second.statusCode, 200);
  assert.equal(f.records.get('requests/order-failed').assignmentHistory.length, historyLenAfterFirst);
  assert.equal(f.records.get('requests/order-failed').dispatchEventHistory.length, dispatchEventsAfterFirst);

  // Test UI controller single-flight deduplication
  let apiCalls = 0;
  const flow = createManagerFailedDeliveryResolutionFlow(
    {
      dispatchOrder: async (orderId, action, body) => {
        apiCalls += 1;
        await new Promise((r) => setTimeout(r, 15));
        return { order: { id: orderId, action, ...body, status: 'scheduled' } };
      },
    },
    () => 'fixed-client-mutation-id'
  );
  flow.setScope('branch-a:manager-a', 'branch-a');
  flow.open(
    {
      id: 'order-failed',
      requestId: 'BT-FAIL-01',
      status: 'delivery_failed',
      branchId: 'branch-a',
      currentBranchId: 'branch-a',
      assignedDistributorUid: 'distributor-a',
      assignedDistributorName: 'Distributor A',
    },
    'reschedule',
    [{ uid: 'distributor-a', name: 'Distributor A' }]
  );
  flow.setReason('Customer requested 1:00 PM slot.');
  flow.requestConfirmation();
  assert.equal(flow.getState().confirming, true);

  const [sub1, sub2] = await Promise.all([flow.submit(), flow.submit()]);
  assert.equal(apiCalls, 1);
  assert.equal(sub1.ok, true);
  assert.equal(sub2, null);
});

test('6. Concurrent updates serialize and reject conflicting second mutation with 409', async () => {
  const f = createFixture();
  const { distributorHandler } = await seedFailedDeliveryWithAttempt(f);
  const managerHandler = createManagerDispatchHandler(f.getAdmin);
  const scheduleA = new Date(Date.now() + 24 * 3600000).toISOString();
  const scheduleB = new Date(Date.now() + 48 * 3600000).toISOString();

  // Concurrent Manager reschedule vs Distributor reschedule with different schedules
  const results = await Promise.all([
    call(managerHandler, 'PATCH', 'manager-a-token', {
      orderId: 'order-failed',
      action: 'reschedule-delivery',
      distributorUid: 'distributor-a',
      scheduledAt: scheduleA,
      rescheduleReason: 'Manager coordinated afternoon schedule.',
      expectedStatus: 'delivery_failed',
      clientMutationId: 'concurrent-mgr-1',
    }),
    call(distributorHandler, 'PATCH', 'distributor-a-token', {
      orderId: 'order-failed',
      action: 'reschedule-delivery',
      scheduledAt: scheduleB,
    }),
  ]);

  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(f.records.get('requests/order-failed').status, 'scheduled');
});

test('7 & 8. Manager reassignment on failed order requires different eligible same-branch Distributor, increments assignmentVersion, and revokes old Distributor access', async () => {
  const f = createFixture();
  const { attemptId, distributorHandler } = await seedFailedDeliveryWithAttempt(f);
  const managerHandler = createManagerDispatchHandler(f.getAdmin);
  const scheduleIso = futureSchedule();

  // Attempting to reassign to the SAME distributor on a failed order is rejected with 409 DISTRIBUTOR_UNCHANGED
  const sameDistributor = await call(managerHandler, 'PATCH', 'manager-a-token', {
    orderId: 'order-failed',
    action: 'reassign-distributor',
    distributorUid: 'distributor-a',
    scheduledAt: scheduleIso,
  });
  assert.equal(sameDistributor.statusCode, 409);
  assert.equal(sameDistributor.body.error.reason, 'DISTRIBUTOR_UNCHANGED');

  // Reassigning to cross-branch distributor is rejected
  const wrongBranchDistributor = await call(managerHandler, 'PATCH', 'manager-a-token', {
    orderId: 'order-failed',
    action: 'reassign-distributor',
    distributorUid: 'distributor-b',
    scheduledAt: scheduleIso,
  });
  assert.equal(wrongBranchDistributor.statusCode, 409);
  assert.equal(wrongBranchDistributor.body.error.reason, 'DISTRIBUTOR_NOT_ELIGIBLE');

  // Reassigning to eligible same-branch distributor-a2 succeeds
  const reassigned = await call(managerHandler, 'PATCH', 'manager-a-token', {
    orderId: 'order-failed',
    action: 'reassign-distributor',
    distributorUid: 'distributor-a2',
    scheduledAt: scheduleIso,
    reassignmentReason: 'Primary rider vehicle breakdown; reassigned to Rider A2.',
    expectedStatus: 'delivery_failed',
    clientMutationId: 'mgr-reassign-01',
  });
  assert.equal(reassigned.statusCode, 200);
  assert.equal(reassigned.body.order.status, 'distributor_assigned');
  assert.equal(reassigned.body.order.assignedDistributorUid, 'distributor-a2');
  assert.equal(reassigned.body.order.assignmentVersion, 3);
  assert.equal(reassigned.body.order.reassignmentReason, 'Primary rider vehicle breakdown; reassigned to Rider A2.');

  // Historical delivery attempt from distributor-a is preserved
  assert.equal(f.records.get(`deliveryAttempts/${attemptId}`).distributorUid, 'distributor-a');
  assert.equal(f.records.get(`deliveryAttempts/${attemptId}`).outcome, 'failed');

  // Old distributor-a can no longer act on the order
  const staleStart = await call(distributorHandler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-failed',
    action: 'start-delivery',
  });
  assert.equal(staleStart.statusCode, 404);

  // Old distributor-a chat access (both send and read) is immediately revoked with CHAT_ASSIGNMENT_MISMATCH / CHAT_ASSIGNMENT_VERSION_STALE
  const updatedOrder = f.records.get('requests/order-failed');
  assert.throws(
    () =>
      authorizeRequesterDistributor({
        requester: { uid: 'requester-1', role: 'requester', accountStatus: 'active' },
        distributor: { uid: 'distributor-a', role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch-a' },
        branch: { id: 'branch-a', status: 'active' },
        order: { id: 'order-failed', ...updatedOrder },
        assignmentVersion: 2,
        mode: 'read',
      }),
    (error) => error.reason === 'CHAT_ASSIGNMENT_MISMATCH' || error.reason === 'CHAT_ASSIGNMENT_VERSION_STALE'
  );
  assert.equal(f.records.get('chatConversations/conv-failed-1').status, 'read_only');

  // New distributor-a2 can accept assignment and proceed
  const accepted = await call(distributorHandler, 'PATCH', 'distributor-a2-token', {
    orderId: 'order-failed',
    action: 'accept-assignment',
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.order.status, 'scheduled');
});

test('9. Requester notifications reflect actual updated status and schedule for Manager reschedule and reassignment without duplicates on retry', async () => {
  const f = createFixture();
  await seedFailedDeliveryWithAttempt(f);
  const managerHandler = createManagerDispatchHandler(f.getAdmin);
  const scheduleIso = futureSchedule();

  const reschedRes = await call(managerHandler, 'PATCH', 'manager-a-token', {
    orderId: 'order-failed',
    action: 'reschedule-delivery',
    distributorUid: 'distributor-a',
    scheduledAt: scheduleIso,
    rescheduleReason: 'Confirmed morning delivery window.',
    clientMutationId: 'notif-resched-1',
  });
  assert.equal(reschedRes.statusCode, 200);

  // Replay same request
  const replayRes = await call(managerHandler, 'PATCH', 'manager-a-token', {
    orderId: 'order-failed',
    action: 'reschedule-delivery',
    distributorUid: 'distributor-a',
    scheduledAt: scheduleIso,
    rescheduleReason: 'Confirmed morning delivery window.',
    clientMutationId: 'notif-resched-1',
  });
  assert.equal(replayRes.statusCode, 200);

  const savedOrderAfterReschedule = { id: 'order-failed', ...f.records.get('requests/order-failed') };
  const rescheduleNotifications = getRoleOrderNotifications([savedOrderAfterReschedule], 'requester');
  assert.equal(rescheduleNotifications.length, 1);
  assert.equal(rescheduleNotifications[0].status, 'scheduled');
  assert.match(rescheduleNotifications[0].message, /rescheduled for delivery on/i);
  assert.match(rescheduleNotifications[0].message, /Confirmed morning delivery window/i);

  // Now fail again and test Manager reassignment notification
  const f2 = createFixture();
  await seedFailedDeliveryWithAttempt(f2);
  const managerHandler2 = createManagerDispatchHandler(f2.getAdmin);
  const reassignRes = await call(managerHandler2, 'PATCH', 'manager-a-token', {
    orderId: 'order-failed',
    action: 'reassign-distributor',
    distributorUid: 'distributor-a2',
    scheduledAt: scheduleIso,
    reassignmentReason: 'Assigned backup rider.',
    clientMutationId: 'notif-reassign-1',
  });
  assert.equal(reassignRes.statusCode, 200);

  const savedOrderAfterReassign = { id: 'order-failed', ...f2.records.get('requests/order-failed') };
  const reassignNotifications = getRoleOrderNotifications([savedOrderAfterReassign], 'requester');
  assert.equal(reassignNotifications.length, 1);
  assert.equal(reassignNotifications[0].status, 'distributor_assigned');
  assert.match(reassignNotifications[0].message, /new Distributor has been assigned/i);
  assert.match(reassignNotifications[0].message, /scheduled for delivery on/i);
});

test('10. Failed writes retain UI form state and surface error feedback in createManagerFailedDeliveryResolutionFlow', async () => {
  let shouldFail = true;
  const flow = createManagerFailedDeliveryResolutionFlow(
    {
      dispatchOrder: async (orderId, action, payload) => {
        if (shouldFail) {
          throw new Error('Selected distributor already has another delivery scheduled near this time.');
        }
        return { order: { id: orderId, action, ...payload, status: 'scheduled' } };
      },
    },
    () => 'mut-retained-1'
  );

  const distributors = [
    { uid: 'distributor-a', name: 'Distributor A', branchId: 'branch-a', role: 'distributor', distributorStatus: 'active', accountStatus: 'active' },
    { uid: 'distributor-a2', name: 'Distributor A2', branchId: 'branch-a', role: 'distributor', distributorStatus: 'active', accountStatus: 'active' },
  ];
  flow.setScope('branch-a:manager-a', 'branch-a');
  flow.open(
    {
      id: 'order-failed',
      requestId: 'BT-FAIL-01',
      status: 'delivery_failed',
      branchId: 'branch-a',
      currentBranchId: 'branch-a',
      assignedDistributorUid: 'distributor-a',
      assignedDistributorName: 'Distributor A',
    },
    'reschedule',
    distributors
  );
  flow.setDayOffset(1);
  flow.setSlotIndex(2);
  flow.setReason('Customer requested afternoon slot tomorrow.');
  flow.requestConfirmation();

  const failedAttempt = await flow.submit();
  assert.equal(failedAttempt.ok, false);

  const retained = flow.getState();
  assert.equal(retained.visible, true);
  assert.equal(retained.submitting, false);
  assert.equal(retained.selectedDayOffset, 1);
  assert.equal(retained.selectedSlotIndex, 2);
  assert.equal(retained.reason, 'Customer requested afternoon slot tomorrow.');
  assert.match(retained.error, /already has another delivery scheduled/);

  // Retry after resolving error succeeds
  shouldFail = false;
  flow.requestConfirmation();
  const successAttempt = await flow.submit();
  assert.equal(successAttempt.ok, true);
  assert.equal(flow.getState().visible, false);
});

test('11 & 12. Existing Distributor direct reschedule and Phase 5A failed-delivery chat deadline/read-only rules remain intact', async () => {
  const f = createFixture();
  const { distributorHandler } = await seedFailedDeliveryWithAttempt(f);

  const failedOrder = f.records.get('requests/order-failed');
  const failedAtMs = failedOrder.deliveryFailedAt.getTime();
  const requester = { uid: 'requester-1', role: 'requester', accountStatus: 'active' };
  const distributor = { uid: 'distributor-a', role: 'distributor', accountStatus: 'active', distributorStatus: 'active', branchId: 'branch-a' };
  const branchA = { id: 'branch-a', status: 'active' };

  // Within 1-hour grace window: SEND and READ allowed for assigned Distributor
  const withinGraceSend = authorizeRequesterDistributor({
    requester,
    distributor,
    branch: branchA,
    order: { id: 'order-failed', ...failedOrder },
    assignmentVersion: 2,
    now: new Date(failedAtMs + 30 * 60 * 1000),
  });
  assert.equal(withinGraceSend.distributorUid, 'distributor-a');
  assert.equal(withinGraceSend.sendExpired, undefined);

  // After 1-hour grace window (e.g. +2 hours): SEND blocked, READ allowed (sendExpired: true)
  assert.throws(
    () =>
      authorizeRequesterDistributor({
        requester,
        distributor,
        branch: branchA,
        order: { id: 'order-failed', ...failedOrder },
        assignmentVersion: 2,
        now: new Date(failedAtMs + 2 * 60 * 60 * 1000),
      }),
    (error) => error.reason === 'CHAT_ASSIGNMENT_NOT_WRITABLE'
  );

  const afterGraceRead = authorizeRequesterDistributor({
    requester,
    distributor,
    branch: branchA,
    order: { id: 'order-failed', ...failedOrder },
    assignmentVersion: 2,
    now: new Date(failedAtMs + 2 * 60 * 60 * 1000),
    mode: 'read',
  });
  assert.equal(afterGraceRead.distributorUid, 'distributor-a');
  assert.equal(afterGraceRead.sendExpired, true);

  // Distributor direct reschedule still works as before
  const directReschedule = await call(distributorHandler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-failed',
    action: 'reschedule-delivery',
    scheduledAt: futureSchedule(),
  });
  assert.equal(directReschedule.statusCode, 200);
  assert.equal(directReschedule.body.order.status, 'scheduled');
});

test('UI source contract: Manager Request and Distributors pages expose only supported failed-delivery actions and hide unsupported Transfer Branch', () => {
  const requestSrc = fs.readFileSync(path.resolve(__dirname, '../../../app/manager/request.jsx'), 'utf8');
  const distributorsSrc = fs.readFileSync(path.resolve(__dirname, '../../../app/manager/distributors.jsx'), 'utf8');
  const modalSrc = fs.readFileSync(path.resolve(__dirname, '../../../components/ManagerFailedDeliveryResolutionModal.jsx'), 'utf8');

  assert.match(requestSrc, /ManagerFailedDeliveryResolutionModal/);
  assert.match(requestSrc, /Reschedule Delivery/);
  assert.match(requestSrc, /Reassign Distributor/);
  assert.doesNotMatch(requestSrc, /Cancel Failed Order/i);

  assert.match(distributorsSrc, /order\.status === 'delivery_failed'/);
  assert.match(distributorsSrc, /Reschedule Delivery/);
  assert.match(modalSrc, /Confirm Schedule & Assignment Update/);
});

test('reassignment mutation ID binds action, distributor, schedule and reason', async () => {
  const f = createFixture();
  await seedFailedDeliveryWithAttempt(f);
  const handler = createManagerDispatchHandler(f.getAdmin);
  const payload = { orderId: 'order-failed', action: 'reassign-distributor', distributorUid: 'distributor-a2', scheduledAt: futureSchedule(), reassignmentReason: 'Backup rider', expectedStatus: 'delivery_failed', clientMutationId: 'bound-reassign-01' };
  assert.equal((await call(handler, 'PATCH', 'manager-a-token', payload)).statusCode, 200);
  const before = JSON.stringify(f.records.get('requests/order-failed'));
  assert.equal((await call(handler, 'PATCH', 'manager-a-token', payload)).statusCode, 200);
  for (const change of [
    { reassignmentReason: 'Different reason' },
    { distributorUid: 'distributor-a' },
    { scheduledAt: new Date(Date.parse(payload.scheduledAt) + 3600000).toISOString() },
    { action: 'reschedule-delivery', rescheduleReason: 'Different action' },
  ]) {
    assert.equal((await call(handler, 'PATCH', 'manager-a-token', { ...payload, ...change })).statusCode, 409);
    assert.equal(JSON.stringify(f.records.get('requests/order-failed')), before);
  }
  assert.equal((await call(handler, 'PATCH', 'manager-b-token', payload)).statusCode, 403);
});

test('malformed existing Distributor schedule blocks a conflicting assignment check', async () => {
  const f = createFixture();
  await seedFailedDeliveryWithAttempt(f);
  f.records.set('requests/invalid-schedule', { status: 'scheduled', assignedDistributorUid: 'distributor-a', scheduledAt: 'not-a-date' });
  const result = await call(createManagerDispatchHandler(f.getAdmin), 'PATCH', 'manager-a-token', {
    orderId: 'order-failed', action: 'reschedule-delivery', scheduledAt: futureSchedule(), rescheduleReason: 'Coordinated delivery', clientMutationId: 'bad-schedule-01',
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.reason, 'DISTRIBUTOR_SCHEDULE_INVALID');
  assert.equal(f.records.get('requests/order-failed').status, 'delivery_failed');
});

test('later Distributor reschedule replaces Manager notification reason without duplicating on replay', async () => {
  const f = createFixture();
  const { distributorHandler } = await seedFailedDeliveryWithAttempt(f);
  const manager = createManagerDispatchHandler(f.getAdmin);
  const managerPayload = { orderId: 'order-failed', action: 'reschedule-delivery', scheduledAt: futureSchedule(), rescheduleReason: 'Old manager note', clientMutationId: 'manager-old-note-1' };
  assert.equal((await call(manager, 'PATCH', 'manager-a-token', managerPayload)).statusCode, 200);
  const order = () => ({ id: 'order-failed', ...f.records.get('requests/order-failed') });
  const notification = () => getRoleOrderNotifications([order()], 'requester')[0];
  assert.match(notification().message, /Old manager note/);
  const firstId = notification().id;
  assert.equal((await call(manager, 'PATCH', 'manager-a-token', managerPayload)).statusCode, 200);
  assert.equal(notification().id, firstId);
  assert.equal((await call(distributorHandler, 'PATCH', 'distributor-a-token', { orderId: 'order-failed', action: 'start-delivery' })).statusCode, 200);
  assert.equal((await call(distributorHandler, 'PATCH', 'distributor-a-token', {
    orderId: 'order-failed', action: 'fail-delivery', failureReasonCode: 'NO_RESPONSE', clientMutationId: 'second-report-01',
    reportFormat: 'structured-v1', reportEvidence: { contactAttempts: [{ method: 'PHONE_CALL', outcome: 'NO_ANSWER' }] },
  })).statusCode, 200);
  assert.equal((await call(distributorHandler, 'PATCH', 'distributor-a-token', { orderId: 'order-failed', action: 'reschedule-delivery', scheduledAt: futureSchedule() })).statusCode, 200);
  assert.equal(order().latestSchedulingEvent.event, 'DELIVERY_RESCHEDULED');
  assert.doesNotMatch(notification().message, /Old manager note/);
  assert.notEqual(notification().id, firstId);
});

const emulatorEnabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test('Emulator: Manager reschedule and reassignment execute atomically on real Firestore transactions', { skip: !emulatorEnabled }, async () => {
  const { initializeApp: adminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');

  const suffix = randomUUID();
  const branchId = `branch-${suffix}`;
  const managerUid = `manager-${suffix}`;
  const dist1Uid = `dist1-${suffix}`;
  const dist2Uid = `dist2-${suffix}`;
  const orderId = `order-${suffix}`;

  const admin = adminApp({ projectId: 'demo-bluetap' }, `mgr-res-admin-${suffix}`);
  const db = getFirestore(admin);

  try {
    await db.doc(`branches/${branchId}`).set({ name: 'Emulator Branch', status: 'active', latitude: 10.267, longitude: 123.584, serviceRadiusKm: 5 });
    await db.doc(`users/${managerUid}`).set({
      uid: managerUid,
      role: 'manager',
      managerStatus: 'active',
      accountStatus: 'active',
      branchId,
      fullName: 'Emulator Manager',
    });
    await db.doc(`users/${dist1Uid}`).set({
      uid: dist1Uid,
      role: 'distributor',
      approvalStatus: 'active',
      accountStatus: 'active',
      branchId,
      fullName: 'Distributor One',
      phone: '09123456789',
      completeAddress: 'Barangay Poblacion, Toledo City',
    });
    await db.doc(`users/${dist2Uid}`).set({
      uid: dist2Uid,
      role: 'distributor',
      approvalStatus: 'active',
      accountStatus: 'active',
      branchId,
      fullName: 'Distributor Two',
      phone: '09123456789',
      completeAddress: 'Barangay Sangi, Toledo City',
    });
    await db.doc(`requests/${orderId}`).set({
      requestId: 'BT-EMU-5BA',
      requesterUid: `req-${suffix}`,
      branchId,
      currentBranchId: branchId,
      status: 'delivery_failed',
      assignedDistributorUid: dist1Uid,
      assignedDistributorNameSnapshot: 'Distributor One',
      assignmentVersion: 2,
      failureReasonCode: 'NO_RESPONSE',
      failureReasonLabel: 'Customer did not respond',
      failureReason: 'Customer did not respond',
      deliveryFailedAt: new Date(),
    });

    const authWrapper = {
      verifyIdToken: async (token) => {
        if (token === 'emu-mgr-token') return { uid: managerUid, role: 'manager', manager: true };
        throw new Error('Invalid token');
      },
      getUser: async (uid) => ({ uid, disabled: false }),
    };

    const handler = createManagerDispatchHandler(() => ({ auth: authWrapper, db }));
    const conflictIso = futureSchedule();
    await db.doc(`requests/conflict-${suffix}`).set({ branchId, currentBranchId: branchId, status: 'scheduled', assignedDistributorUid: dist1Uid, scheduledAt: new Date(conflictIso) });
    await Promise.all([
      db.doc(`distributorDispatchGuards/${dist1Uid}`).set({ schemaVersion: 1, initialized: true, distributorUid: dist1Uid, revision: 0, reservations: [{ orderId, scheduledAt: null }, { orderId: `conflict-${suffix}`, scheduledAt: new Date(conflictIso) }] }),
      db.doc(`distributorDispatchGuards/${dist2Uid}`).set({ schemaVersion: 1, initialized: true, distributorUid: dist2Uid, revision: 0, reservations: [] }),
    ]);
    const existing = await db.doc(`requests/conflict-${suffix}`).get();
    assert.equal(typeof existing.data().scheduledAt.toDate, 'function');
    const conflict = await call(handler, 'PATCH', 'emu-mgr-token', {
      orderId, action: 'reschedule-delivery', scheduledAt: conflictIso,
      rescheduleReason: 'Conflict test', expectedStatus: 'delivery_failed', clientMutationId: `emu-conflict-${suffix}`,
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.error.reason, 'DISTRIBUTOR_SCHEDULE_CONFLICT');
    assert.equal((await db.doc(`requests/${orderId}`).get()).data().status, 'delivery_failed');
    const scheduleIso = new Date(Date.parse(conflictIso) + 2 * 3600000).toISOString();

    const resched = await call(handler, 'PATCH', 'emu-mgr-token', {
      orderId,
      action: 'reschedule-delivery',
      distributorUid: dist1Uid,
      scheduledAt: scheduleIso,
      rescheduleReason: 'Confirmed afternoon delivery window in emulator.',
      expectedStatus: 'delivery_failed',
      clientMutationId: `emu-mut-${suffix}`,
    });
    assert.equal(resched.statusCode, 200);
    const snapAfterResched = await db.doc(`requests/${orderId}`).get();
    assert.equal(snapAfterResched.data().status, 'scheduled');
    assert.equal(snapAfterResched.data().assignedDistributorUid, dist1Uid);
    assert.equal(snapAfterResched.data().assignmentVersion, 2);

    // Reset to delivery_failed and test reassignment in emulator
    await db.doc(`requests/${orderId}`).update({ status: 'delivery_failed' });
    const reassign = await call(handler, 'PATCH', 'emu-mgr-token', {
      orderId,
      action: 'reassign-distributor',
      distributorUid: dist2Uid,
      scheduledAt: scheduleIso,
      reassignmentReason: 'Reassigned to Distributor Two in emulator.',
      expectedStatus: 'delivery_failed',
      clientMutationId: `emu-reassign-${suffix}`,
    });
    assert.equal(reassign.statusCode, 200);
    const snapAfterReassign = await db.doc(`requests/${orderId}`).get();
    assert.equal(snapAfterReassign.data().status, 'distributor_assigned');
    assert.equal(snapAfterReassign.data().assignedDistributorUid, dist2Uid);
    assert.equal(snapAfterReassign.data().assignmentVersion, 3);
  } finally {
    await deleteAdminApp(admin);
  }
});
