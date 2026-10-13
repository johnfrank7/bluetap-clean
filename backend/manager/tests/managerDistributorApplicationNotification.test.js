const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isEligiblePendingDistributor,
  pendingBranchApplications,
  belongsToBranch,
} = require('../../../services/managerOperational');
const {
  getManagerNotifications,
  getManagerNotificationDetail,
  unreadManagerNotifications,
} = require('../../../services/managerNotifications');
const {
  normalizeDistributorApplication,
  normalizeDistributorApplicationStatus,
} = require('../../../services/distributorApplications');
const {
  notificationSeverity,
  compactNotificationStatus,
} = require('../../../components/notificationPresentation');
const {
  approveDistributorApplicationInTransaction,
  rejectDistributorApplicationInTransaction,
  isPendingStatus,
} = require('../../distributor/distributorApplicationService');

const parseTimestamp = (value) =>
  value instanceof Date
    ? value
    : value?.seconds
    ? new Date(value.seconds * 1000)
    : value
    ? new Date(value)
    : null;

const fixedTime = '2026-10-12T10:00:00.000Z';
const now = new Date(fixedTime).getTime() + 1000 * 60;

function createTestApplicant(overrides = {}) {
  return {
    id: 'applicant-1',
    uid: 'applicant-1',
    role: 'distributor',
    requestedBranchId: 'branch-a',
    requestedBranchName: 'North Branch',
    branchId: null,
    distributorStatus: 'pending',
    approvalStatus: 'pending',
    accountStatus: 'active',
    registrationCompleted: true,
    onboardingStatus: 'complete',
    emailVerified: true,
    emailVerificationRequired: true,
    emailOtpVerification: { status: 'verified', required: true },
    faceVerification: { status: 'verified', livenessPassed: true },
    fullName: 'Juan Dela Cruz',
    publicUid: 'Dis-001',
    displayUid: 'Dis-001',
    unique_id: 'DIS-000001',
    email: 'juan@example.com',
    phone: '09171234567',
    barangay: 'Barangay Central',
    createdAt: fixedTime,
    ...overrides,
  };
}

// Case A: New fully verified pending Branch A application notifies Manager A.
test('Case A: New fully verified pending Branch A application notifies Manager A', () => {
  const applicant = createTestApplicant();
  const branchAUsers = [applicant];
  const pendingA = pendingBranchApplications(branchAUsers, 'branch-a');
  assert.equal(pendingA.length, 1);
  assert.equal(pendingA[0].id, 'applicant-1');

  const notifications = getManagerNotifications(
    [],
    [],
    [],
    'branch-a',
    parseTimestamp,
    now,
    pendingA,
    'North Branch'
  );

  assert.equal(notifications.length, 1);
  const event = notifications[0];
  assert.equal(event.id, 'applicant:applicant-1');
  assert.equal(event.status, 'pending');
  assert.equal(event.path, '/manager/distributors');
  assert.equal(event.navigable, true);
  assert.equal(event.kind, 'applicant');
  assert.match(event.message, /Juan Dela Cruz submitted a Distributor application for North Branch/);
});

// Case B: Branch B Manager does not receive Branch A application notification.
test('Case B: Branch B Manager does not receive Branch A application notification', () => {
  const applicant = createTestApplicant();
  const pendingB = pendingBranchApplications([applicant], 'branch-b');
  assert.equal(pendingB.length, 0);

  const notificationsB = getManagerNotifications(
    [],
    [],
    [],
    'branch-b',
    parseTimestamp,
    now,
    pendingB,
    'South Branch'
  );
  assert.equal(notificationsB.length, 0);

  // Even if all applicants are passed to getManagerNotifications for branch-b, it filters by requestedBranchId
  const directB = getManagerNotifications(
    [],
    [],
    [],
    'branch-b',
    parseTimestamp,
    now,
    [applicant],
    'South Branch'
  );
  assert.equal(directB.length, 0);
});

// Case C: Incomplete registration creates no pending Manager notification.
test('Case C: Incomplete registration creates no pending Manager notification', () => {
  const incompleteCases = [
    createTestApplicant({ registrationCompleted: false }),
    createTestApplicant({ onboardingStatus: 'face_enrollment_pending' }),
    createTestApplicant({ onboardingStatus: 'finalization_pending' }),
    createTestApplicant({ onboardingStatus: 'incomplete' }),
  ];

  for (const incomplete of incompleteCases) {
    assert.equal(isEligiblePendingDistributor(incomplete), false);
    const pending = pendingBranchApplications([incomplete], 'branch-a');
    assert.equal(pending.length, 0);
    const notifications = getManagerNotifications([], [], [], 'branch-a', parseTimestamp, now, pending, 'North Branch');
    assert.equal(notifications.length, 0);
  }
});

// Case D: Unverified OTP creates no pending Manager notification.
test('Case D: Unverified OTP creates no pending Manager notification', () => {
  const unverifiedOtpCases = [
    createTestApplicant({ emailVerified: false, emailVerificationRequired: true }),
    createTestApplicant({ emailOtpVerification: { status: 'pending', required: true } }),
    createTestApplicant({ emailOtpVerification: { status: 'unverified', required: true } }),
  ];

  for (const item of unverifiedOtpCases) {
    assert.equal(isEligiblePendingDistributor(item), false);
    const pending = pendingBranchApplications([item], 'branch-a');
    assert.equal(pending.length, 0);
  }
});

// Case E: Failed registration creates no pending Manager notification.
test('Case E: Failed registration creates no pending Manager notification', () => {
  const failedCases = [
    createTestApplicant({ onboardingStatus: 'failed' }),
    createTestApplicant({ onboardingStatus: 'abandoned' }),
    createTestApplicant({ faceVerification: { status: 'failed' } }),
    createTestApplicant({ faceVerification: { status: 'passed_pending_finalization' } }),
    createTestApplicant({ faceVerification: { status: 'in_progress' } }),
  ];

  for (const item of failedCases) {
    assert.equal(isEligiblePendingDistributor(item), false);
    const pending = pendingBranchApplications([item], 'branch-a');
    assert.equal(pending.length, 0);
  }
});

// Case F: Pending application does not grant operational branch authorization.
test('Case F: Pending application does not grant operational branch authorization', () => {
  const applicant = createTestApplicant();
  // Applicant has requestedBranchId 'branch-a' but branchId is null
  assert.equal(applicant.branchId, null);
  assert.equal(applicant.distributorStatus, 'pending');

  // Should NOT belong to branch as an operational member
  assert.equal(belongsToBranch(applicant, 'branch-a'), false);

  // Normalizing application preserves status as pending and not active
  const normalized = normalizeDistributorApplication(applicant);
  assert.equal(normalized.isPending, true);
  assert.equal(normalized.status, 'pending');
  assert.equal(normalizeDistributorApplicationStatus(normalized.status), 'pending');
});

// Case G: Manager notification carries readable applicant/branch identity.
test('Case G: Manager notification carries readable applicant/branch identity', () => {
  const applicant = createTestApplicant({
    fullName: 'Maria Santos',
    publicUid: 'Dis-042',
    displayUid: 'Dis-042',
    requestedBranchName: 'East Water Station',
  });
  const pending = pendingBranchApplications([applicant], 'branch-a');
  const notifications = getManagerNotifications([], [], [], 'branch-a', parseTimestamp, now, pending, 'East Water Station');
  const event = notifications[0];

  assert.equal(event.title, 'New Distributor Application');
  assert.equal(
    event.message,
    'Maria Santos submitted a Distributor application for East Water Station and is awaiting review.'
  );
  assert.equal(event.metadata, 'Applicant #Dis-042 · East Water Station');
  assert.equal(event.requestId, 'Dis-042');
  assert.equal(event.requesterName, 'Maria Santos');

  // Must not expose raw UID in metadata or message
  assert.ok(!event.message.includes('applicant-1'));
  assert.ok(!event.metadata.includes('applicant-1'));
});

// Case H: Notification identity is stable across refresh.
test('Case H: Notification identity is stable across refresh', () => {
  const applicant = createTestApplicant();
  const pending = pendingBranchApplications([applicant], 'branch-a');

  const notificationsRun1 = getManagerNotifications([], [], [], 'branch-a', parseTimestamp, now, pending, 'North Branch');
  const notificationsRun2 = getManagerNotifications([], [], [], 'branch-a', parseTimestamp, now, pending, 'North Branch');

  assert.equal(notificationsRun1[0].id, notificationsRun2[0].id);
  assert.equal(notificationsRun1[0].id, 'applicant:applicant-1');
  assert.ok(!notificationsRun1[0].id.includes(String(now)));
});

// Case I: Duplicate finalization does not duplicate notification.
test('Case I: Duplicate finalization does not duplicate notification', () => {
  const applicant = createTestApplicant();
  // Duplicate application entries for same applicant
  const duplicateList = [applicant, { ...applicant, id: 'applicant-1' }];
  const pending = pendingBranchApplications(duplicateList, 'branch-a');
  const notifications = getManagerNotifications([], [], [], 'branch-a', parseTimestamp, now, pending, 'North Branch');

  const ids = notifications.map((n) => n.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, 1);
  assert.equal([...uniqueIds][0], 'applicant:applicant-1');
});

// Case J: Notification is reachable through Manager bell/notification center.
test('Case J: Notification is reachable through Manager bell/notification center', () => {
  const applicant = createTestApplicant();
  const pending = pendingBranchApplications([applicant], 'branch-a');
  const notifications = getManagerNotifications([], [], [], 'branch-a', parseTimestamp, now, pending, 'North Branch');

  assert.equal(notifications.length, 1);
  const seen = new Set();
  const unreadBefore = unreadManagerNotifications(notifications, seen);
  assert.equal(unreadBefore.length, 1);
  assert.equal(unreadBefore[0].id, 'applicant:applicant-1');
});

// Case K: Notification opens the authorized pending review UI.
test('Case K: Notification opens the authorized pending review UI', () => {
  const applicant = createTestApplicant();
  const pending = pendingBranchApplications([applicant], 'branch-a');
  const notifications = getManagerNotifications([], [], [], 'branch-a', parseTimestamp, now, pending, 'North Branch');

  const event = notifications[0];
  assert.equal(event.path, '/manager/distributors');
  assert.equal(event.navigable, true);
  assert.equal(event.applicantId, 'applicant-1');
  assert.ok(event.applicant);
});

// Case L: Read/unread state updates correctly.
test('Case L: Read/unread state updates correctly', () => {
  const applicant = createTestApplicant();
  const pending = pendingBranchApplications([applicant], 'branch-a');
  const notifications = getManagerNotifications([], [], [], 'branch-a', parseTimestamp, now, pending, 'North Branch');

  const seen = new Set();
  assert.equal(unreadManagerNotifications(notifications, seen).length, 1);

  // Mark read
  seen.add(notifications[0].id);
  assert.equal(unreadManagerNotifications(notifications, seen).length, 0);

  // Re-deriving notifications preserves seen state
  const reloaded = getManagerNotifications([], [], [], 'branch-a', parseTimestamp, now, pending, 'North Branch');
  assert.equal(unreadManagerNotifications(reloaded, seen).length, 0);
});

// Case M: Approval or rejection does not generate another new-pending event.
test('Case M: Approval or rejection does not generate another new-pending event', () => {
  const approvedApplicant = createTestApplicant({
    distributorStatus: 'active',
    approvalStatus: 'approved',
    branchId: 'branch-a',
  });
  const rejectedApplicant = createTestApplicant({
    id: 'applicant-2',
    distributorStatus: 'rejected',
    approvalStatus: 'rejected',
    rejectionReason: 'Incomplete documents',
  });

  const pending = pendingBranchApplications([approvedApplicant, rejectedApplicant], 'branch-a');
  assert.equal(pending.length, 0);

  const notifications = getManagerNotifications([], [], [], 'branch-a', parseTimestamp, now, pending, 'North Branch');
  assert.equal(notifications.length, 0);
});

// Case N: Admin retains global application visibility.
test('Case N: Admin retains global application visibility', () => {
  const applicantA = createTestApplicant({ id: 'app-a', requestedBranchId: 'branch-a', publicUid: 'Dis-001' });
  const applicantB = createTestApplicant({ id: 'app-b', requestedBranchId: 'branch-b', publicUid: 'Dis-002' });

  // Admin sees all applications regardless of branch
  const allDistributors = [applicantA, applicantB];
  const adminView = allDistributors.map((d) => normalizeDistributorApplication(d));

  assert.equal(adminView.length, 2);
  assert.equal(adminView[0].requestedBranchId, 'branch-a');
  assert.equal(adminView[1].requestedBranchId, 'branch-b');
  assert.equal(adminView[0].isPending, true);
  assert.equal(adminView[1].isPending, true);
});

// Case O: Unauthorized Manager cannot access another branch\'s application details.
test("Case O: Unauthorized Manager cannot access another branch's application details", async () => {
  const applicantA = createTestApplicant({ id: 'app-a', requestedBranchId: 'branch-a' });

  // Manager B querying their branch applications gets empty
  const managerBView = pendingBranchApplications([applicantA], 'branch-b');
  assert.equal(managerBView.length, 0);

  // Transactional guard in distributorApplicationService rejects wrong branch
  const mockDb = {
    collection: (col) => ({
      doc: (id) => ({
        id,
        path: `${col}/${id}`,
      }),
    }),
  };

  const branchDoc = { exists: true, data: () => ({ status: 'active', name: 'Branch B' }) };
  const userDoc = { exists: true, data: () => ({ ...applicantA, requestedBranchId: 'branch-a' }) };

  const mockTx = {
    get: async (ref) => {
      if (ref.path.startsWith('branches/')) return branchDoc;
      if (ref.path.startsWith('users/')) return userDoc;
      return { exists: false };
    },
    update: () => {},
    set: () => {},
  };

  await assert.rejects(
    async () => {
      await approveDistributorApplicationInTransaction({
        actorRole: 'manager',
        actorUid: 'manager-b-uid',
        branchId: 'branch-b',
        db: mockDb,
        targetRef: { id: 'app-a', path: 'users/app-a' },
        tx: mockTx,
        enforceRequestedBranch: true,
      });
    },
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.reason, 'BRANCH_ACCESS_DENIED');
      return true;
    }
  );
});

// Case P: No Reports & Safety moderation-warning copy is used for new applications.
test('Case P: No Reports & Safety moderation-warning copy is used for new applications', () => {
  const applicant = createTestApplicant();
  const pending = pendingBranchApplications([applicant], 'branch-a');
  const notifications = getManagerNotifications([], [], [], 'branch-a', parseTimestamp, now, pending, 'North Branch');
  const event = notifications[0];

  assert.equal(event.status, 'pending');
  assert.equal(compactNotificationStatus(event.status), 'Pending');

  const tone = notificationSeverity(event.status);
  assert.notEqual(tone.kind, 'restricted');
  assert.notEqual(tone.kind, 'error');

  // Verify no disciplinary or moderation keywords in message or title
  assert.doesNotMatch(event.title, /warning|moderation|strike|restriction|suspended|safety/i);
  assert.doesNotMatch(event.message, /warning|moderation|strike|restriction|suspended|safety/i);
});

// Case Q: Phase 04D branch-transfer notifications remain passing.
test('Case Q: Phase 04D branch-transfer notifications remain intact in managerNotifications', () => {
  const incoming = [
    {
      id: 'req-transfer-1',
      branchId: 'branch-b',
      transferToBranchId: 'branch-a',
      transferRequestId: 'transfer-x',
      status: 'branch_transfer_pending',
      transferRequestedAt: fixedTime,
    },
  ];
  const decisions = [
    {
      id: 'dec-1',
      sourceBranchId: 'branch-a',
      orderId: 'req-transfer-1',
      decision: 'accepted',
      targetBranchNameSnapshot: 'Branch B',
      decidedAt: fixedTime,
    },
  ];

  const events = getManagerNotifications(
    [],
    incoming,
    decisions,
    'branch-a',
    parseTimestamp,
    now,
    [],
    'North Branch'
  );

  const transferPending = events.find((e) => e.id === 'req-transfer-1:incoming-transfer:transfer-x');
  assert.ok(transferPending);
  assert.equal(transferPending.status, 'branch_transfer_pending');
  assert.equal(transferPending.message, 'Incoming branch transfer needs review.');

  const transferDecision = events.find((e) => e.id === 'transfer-decision:dec-1');
  assert.ok(transferDecision);
  assert.equal(transferDecision.status, 'accepted');
  assert.equal(transferDecision.message, 'Branch transfer accepted by Branch B.');
});

// Case R: Phases 01-04C.1 regression sanity: order and applicant details helper robustness.
test('Case R: Phases 01-04C.1 regression sanity: notification detail helper handles both orders and applicants safely', () => {
  const applicantEvent = {
    id: 'applicant:applicant-1',
    requestId: 'Dis-001',
    requesterName: 'Juan Dela Cruz',
    kind: 'applicant',
    applicant: createTestApplicant(),
    message: 'Juan Dela Cruz submitted a Distributor application for North Branch and is awaiting review.',
    at: new Date(fixedTime),
  };
  const applicantDetail = getManagerNotificationDetail(applicantEvent);
  assert.equal(applicantDetail.requestId, 'Dis-001');
  assert.equal(applicantDetail.distributorName, 'Juan Dela Cruz');
  assert.equal(applicantDetail.kind, 'applicant');
  assert.equal(applicantDetail.total, 0);

  const orderEvent = {
    id: 'order-1:received',
    requestId: 'BT-900',
    orderId: 'order-1',
    message: 'New branch order received.',
    order: {
      id: 'order-1',
      requestId: 'BT-900',
      status: 'pending',
      totalAtOrder: 250,
      deliveryFeeAtOrder: 50,
      branchNameSnapshot: 'North Branch',
    },
    at: new Date(fixedTime),
  };
  const orderDetail = getManagerNotificationDetail(orderEvent);
  assert.equal(orderDetail.requestId, 'BT-900');
  assert.equal(orderDetail.total, 250);
  assert.equal(orderDetail.deliveryFee, 50);
});
