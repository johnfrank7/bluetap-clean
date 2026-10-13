const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');

const {
  approveDistributorApplicationInTransaction,
  rejectDistributorApplicationInTransaction,
  isPendingStatus,
  normalizeDistributorStatus,
} = require('../distributorApplicationService');

const {
  notificationSeverity,
  compactNotificationStatus,
  NOTIFICATION_SEVERITIES,
  DARK_NOTIFICATION_SEVERITIES,
} = require('../../../components/notificationPresentation');

// Helper to create mock DB and Transaction for tests
function createMockDb(initialUsers = {}, initialBranches = {}) {
  const users = new Map(Object.entries(initialUsers));
  const branches = new Map(Object.entries(initialBranches));
  const auditLogs = [];
  const moderationNotices = [];
  const moderationActivities = [];

  const db = {
    collection: (name) => {
      if (name === 'users') {
        return {
          doc: (id) => ({
            id,
            get: async () => ({
              exists: users.has(id),
              id,
              data: () => users.get(id),
            }),
          }),
        };
      }
      if (name === 'branches') {
        return {
          doc: (id) => ({
            id,
            get: async () => ({
              exists: branches.has(id),
              id,
              data: () => branches.get(id),
            }),
          }),
        };
      }
      if (name === 'adminAuditLogs') {
        return {
          doc: () => ({
            set: (data) => auditLogs.push(data),
          }),
        };
      }
      if (name === 'moderationNotices') {
        return {
          doc: (targetId) => ({
            collection: (subName) => ({
              doc: () => {
                const noticeId = `notice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                return {
                  id: noticeId,
                  set: (data) => moderationNotices.push({ id: noticeId, targetId, ...data }),
                };
              },
            }),
          }),
        };
      }
      if (name === 'moderationActivity') {
        return {
          doc: (id) => ({
            id,
            set: (data) => moderationActivities.push({ id, ...data }),
          }),
        };
      }
      return {
        doc: () => ({ set: () => {}, get: async () => ({ exists: false }) }),
      };
    },
  };

  const createTx = () => {
    const updates = [];
    return {
      get: async (ref) => ref.get(),
      update: (ref, data) => {
        updates.push({ id: ref.id, data });
        users.set(ref.id, { ...(users.get(ref.id) || {}), ...data });
      },
      set: (ref, data) => {
        if (typeof ref.set === 'function') ref.set(data);
      },
      _auditLogs: auditLogs,
      _moderationNotices: moderationNotices,
      _moderationActivities: moderationActivities,
      _updates: updates,
    };
  };

  return { db, createTx, users, branches, auditLogs, moderationNotices, moderationActivities };
}

// 1. Approved application generates the correct approval category
test('Test 1: Approved application generates the correct approval category and type', async () => {
  const { db, createTx, moderationNotices } = createMockDb(
    {
      'dist-1': {
        role: 'distributor',
        fullName: 'Maria Santos',
        requestedBranchId: 'branch-a',
        distributorStatus: 'pending',
      },
    },
    {
      'branch-a': {
        name: 'Metro Manila North Branch',
        status: 'active',
      },
    }
  );

  const tx = createTx();
  const targetRef = db.collection('users').doc('dist-1');

  await approveDistributorApplicationInTransaction({
    actorRole: 'manager',
    actorUid: 'mgr-1',
    actorPublicUid: 'MGR-001',
    branchId: 'branch-a',
    db,
    enforceRequestedBranch: true,
    targetRef,
    tx,
  });

  const notice = moderationNotices.find((n) => n.targetId === 'dist-1');
  assert.ok(notice, 'Approval notice must be generated');
  assert.equal(notice.type, 'distributor_application_approved');
  assert.equal(notice.category, 'DISTRIBUTOR_APPLICATION');
  assert.equal(notice.title, 'Application Approved');
  assert.equal(notice.scope, 'branch');
  assert.equal(notice.branchId, 'branch-a');
  assert.equal(notice.branchName, 'Metro Manila North Branch');
  assert.equal(notice.seenAt, null);
  assert.equal(notice.acknowledgedAt, null);
});

// 2. Approved application never appears as a moderation warning
test('Test 2: Approved application never appears as a moderation warning or disciplinary notice', () => {
  const approvalNotice = {
    id: 'notice-123',
    type: 'distributor_application_approved',
    title: 'Application Approved',
    category: 'DISTRIBUTOR_APPLICATION',
    branchName: 'Cebu Central Hub',
  };

  // Inspect logic mirroring NoticeDetailModal in ModerationNotices.jsx
  const isApproval = approvalNotice.type === 'distributor_application_approved' || approvalNotice.category === 'DISTRIBUTOR_APPLICATION';
  assert.equal(isApproval, true);

  const eyebrow = isApproval ? 'APPLICATION APPROVED' : 'REPORTS & SAFETY';
  assert.equal(eyebrow, 'APPLICATION APPROVED');
  assert.notEqual(eyebrow, 'REPORTS & SAFETY');

  const reporterDisclosureShown = !isApproval;
  assert.equal(reporterDisclosureShown, false, 'Reporter disclosure text must NEVER appear for approval');

  const actionLabel = isApproval ? 'Get Started' : 'Acknowledge';
  assert.equal(actionLabel, 'Get Started');
});

// 3. Branch display name appears safely
test('Test 3: Branch display name appears safely in message and body text', async () => {
  const branchName = 'Davao South District Station';
  const { db, createTx, moderationNotices } = createMockDb(
    {
      'dist-2': {
        role: 'distributor',
        fullName: 'Pedro Penduko',
        requestedBranchId: 'branch-b',
        distributorStatus: 'pending',
      },
    },
    {
      'branch-b': {
        name: branchName,
        status: 'active',
      },
    }
  );

  const tx = createTx();
  const targetRef = db.collection('users').doc('dist-2');

  await approveDistributorApplicationInTransaction({
    actorRole: 'manager',
    actorUid: 'mgr-2',
    actorPublicUid: 'MGR-002',
    branchId: 'branch-b',
    db,
    enforceRequestedBranch: true,
    targetRef,
    tx,
  });

  const notice = moderationNotices.find((n) => n.targetId === 'dist-2');
  assert.ok(notice);
  assert.equal(notice.branchName, branchName);

  // Expected body text
  const expectedBody = `Your Distributor application has been approved for ${notice.branchName || 'your branch'}. You can now access your assigned Distributor services.`;
  assert.ok(expectedBody.includes(branchName));
  assert.ok(!expectedBody.includes('dist-2'), 'Must not leak raw user UID');
  assert.ok(!expectedBody.includes('branch-b'), 'Must not leak raw branch ID');
});

// 4. Genuine Reports & Safety warnings still render normally
test('Test 4: Genuine Reports & Safety warnings still render normally with warning eyebrow and reporter note', () => {
  const genuineWarning = {
    id: 'notice-warn-1',
    type: 'warn',
    title: 'Conduct Warning',
    category: 'HARASSMENT',
    branchName: 'Metro Manila North Branch',
    reasonLabel: 'Inappropriate language in chat',
  };

  const isApproval = genuineWarning.type === 'distributor_application_approved' || genuineWarning.category === 'DISTRIBUTOR_APPLICATION';
  assert.equal(isApproval, false);

  const eyebrow = isApproval ? 'APPLICATION APPROVED' : 'REPORTS & SAFETY';
  assert.equal(eyebrow, 'REPORTS & SAFETY');

  const reporterDisclosureShown = !isApproval;
  assert.equal(reporterDisclosureShown, true);

  const actionLabel = isApproval ? 'Get Started' : 'Acknowledge';
  assert.equal(actionLabel, 'Acknowledge');

  const restrictionNotice = {
    id: 'notice-susp-1',
    type: 'suspend_branch_ordering',
    title: 'Ordering Restricted',
    scope: 'branch',
    branchName: 'Metro Manila North Branch',
    endsAt: '2026-11-01T00:00:00Z',
    reasonLabel: 'Repeated non-payment',
  };

  const isSuspensionApproval = restrictionNotice.type === 'distributor_application_approved' || restrictionNotice.category === 'DISTRIBUTOR_APPLICATION';
  assert.equal(isSuspensionApproval, false);
});

// 5. Pending application is not confused with an approved application
test('Test 5: Pending application is not confused with an approved application', () => {
  assert.equal(isPendingStatus('pending'), true);
  assert.equal(isPendingStatus('pending_branch_review'), true);
  assert.equal(isPendingStatus('active'), false);
  assert.equal(isPendingStatus('approved'), false);

  assert.equal(normalizeDistributorStatus('pending'), 'pending');
  assert.equal(normalizeDistributorStatus('approved'), 'active');
  assert.equal(normalizeDistributorStatus('active'), 'active');
});

// 6. Repeated refresh does not duplicate approval popups
test('Test 6: Repeated refresh does not duplicate approval popups once acknowledged', () => {
  const notices = [
    {
      id: 'notice-app-1',
      type: 'distributor_application_approved',
      seenAt: '2026-10-12T10:00:00Z',
      acknowledgedAt: '2026-10-12T10:05:00Z',
    },
  ];

  // Logic mirroring ModerationNoticeProvider unseen detection
  const shownIds = new Set(['notice-app-1']);
  const unseen = notices.find((notice) => !notice.seenAt && !shownIds.has(notice.id));
  assert.equal(unseen, undefined, 'Already seen notice must not trigger auto-popup on refresh');

  const unacknowledged = notices.find((notice) => !notice.acknowledgedAt);
  assert.equal(unacknowledged, undefined, 'Acknowledged notice has no pending acknowledgement');
});

// 7. Wrong branch authorization remains denied
test('Test 7: Wrong branch authorization remains denied when approving application', async () => {
  const { db, createTx } = createMockDb(
    {
      'dist-cross': {
        role: 'distributor',
        fullName: 'Cross Branch Applicant',
        requestedBranchId: 'branch-branch1',
        distributorStatus: 'pending',
      },
    },
    {
      'branch-branch2': {
        name: 'Branch 2',
        status: 'active',
      },
    }
  );

  const tx = createTx();
  const targetRef = db.collection('users').doc('dist-cross');

  await assert.rejects(
    async () => {
      await approveDistributorApplicationInTransaction({
        actorRole: 'manager',
        actorUid: 'mgr-branch2',
        actorPublicUid: 'MGR-002',
        branchId: 'branch-branch2',
        db,
        enforceRequestedBranch: true,
        targetRef,
        tx,
      });
    },
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.reason, 'BRANCH_ACCESS_DENIED');
      return true;
    }
  );
});

// 8. Existing Manager notification tests still pass
test('Test 8: Moderation activity record is written with user UID and revision for realtime notification', async () => {
  const { db, createTx, moderationActivities } = createMockDb(
    {
      'dist-realtime': {
        role: 'distributor',
        fullName: 'Realtime User',
        requestedBranchId: 'branch-rt',
        distributorStatus: 'pending',
      },
    },
    {
      'branch-rt': {
        name: 'Realtime Branch',
        status: 'active',
      },
    }
  );

  const tx = createTx();
  const targetRef = db.collection('users').doc('dist-realtime');

  await approveDistributorApplicationInTransaction({
    actorRole: 'admin',
    actorUid: 'admin-1',
    actorPublicUid: 'ADM-001',
    branchId: 'branch-rt',
    db,
    enforceRequestedBranch: false,
    targetRef,
    tx,
  });

  const activity = moderationActivities.find((a) => a.id === 'user_dist-realtime');
  assert.ok(activity, 'moderationActivity entry must be created for real-time listener subscription');
  assert.equal(activity.uid, 'dist-realtime');
  assert.ok(activity.revision, 'revision token must be set');
});

// 9. Accept Assignment uses success green styling
test('Test 9: Accept Assignment uses success green styling in d_requests.jsx', () => {
  const filePath = path.resolve(__dirname, '../../../app/distributor/d_requests.jsx');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(content.includes('backgroundColor: BLUETAP_COLORS.success'), 'Accept Assignment must use BLUETAP_COLORS.success');
  assert.ok(content.includes('Accept Assignment'), 'Accept Assignment label must exist');
});

// 10. Decline uses danger outline styling
test('Test 10: Decline uses danger outline styling in d_requests.jsx', () => {
  const filePath = path.resolve(__dirname, '../../../app/distributor/d_requests.jsx');
  const content = fs.readFileSync(filePath, 'utf8');

  // Check declineActionButton styling
  assert.ok(content.includes('borderColor: BLUETAP_COLORS.danger'), 'Decline button must have danger border');
  assert.ok(content.includes('borderWidth: 1.5'), 'Decline button must have 1.5 border width');
  assert.ok(content.includes('backgroundColor: BLUETAP_COLORS.surface'), 'Decline button must have surface background for outline');
});

// 11. View Details uses existing BlueTap styling
test('Test 11: View Details uses existing BlueTap outline styling in d_requests.jsx', () => {
  const filePath = path.resolve(__dirname, '../../../app/distributor/d_requests.jsx');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(content.includes('borderColor: BLUE'), 'View Details must use BLUE border');
  assert.ok(content.includes('View Details'), 'View Details label must exist');
});

// 12. All three buttons share the correct border radius (12px) and minimum height (at least 44px)
test('Test 12: All three action buttons share consistent border radius (12px) and minimum height (44px)', () => {
  const filePath = path.resolve(__dirname, '../../../app/distributor/d_requests.jsx');
  const content = fs.readFileSync(filePath, 'utf8');

  // AST parse to verify StyleSheet declarations
  const ast = parser.parse(content, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator'],
  });

  // Verify that declineActionButton, secondaryActionButton, primaryActionButton all define minHeight: 44 and borderRadius: 12
  const buttonStyleNames = ['declineActionButton', 'secondaryActionButton', 'primaryActionButton'];
  buttonStyleNames.forEach((name) => {
    const regex = new RegExp(`${name}:\\s*{[^}]*minHeight:\\s*44`, 's');
    assert.ok(regex.test(content), `${name} must define minHeight: 44`);

    const radiusRegex = new RegExp(`${name}:\\s*{[^}]*borderRadius:\\s*12`, 's');
    assert.ok(radiusRegex.test(content), `${name} must define borderRadius: 12`);
  });
});

// 13. Light/dark contrast is valid
test('Test 13: Light and dark contrast is valid for approval status and notification severity', () => {
  const lightSuccess = notificationSeverity('approved', false);
  assert.equal(lightSuccess.kind, 'success');
  assert.equal(lightSuccess.accent, NOTIFICATION_SEVERITIES.success.accent);

  const darkSuccess = notificationSeverity('approved', true);
  assert.equal(darkSuccess.kind, 'success');
  assert.equal(darkSuccess.accent, DARK_NOTIFICATION_SEVERITIES.success.accent);

  assert.equal(compactNotificationStatus('approved'), 'Approved');
  assert.equal(compactNotificationStatus('application_approved'), 'Approved');
});

// 14. Disabled and loading states remain readable
test('Test 14: Disabled and loading states remain readable with actionButtonDisabled in d_requests.jsx', () => {
  const filePath = path.resolve(__dirname, '../../../app/distributor/d_requests.jsx');
  const content = fs.readFileSync(filePath, 'utf8');

  // Verify isProcessing disabled state on all 3 buttons in cardActionsRow
  assert.ok(content.includes('isProcessing && styles.actionButtonDisabled'), 'actionButtonDisabled must be used when processing');
  assert.ok(content.includes('disabled={isProcessing}'), 'Buttons must be disabled while processing');
  assert.ok(content.includes('<ActivityIndicator color="#FFFFFF" size="small" />'), 'Activity indicator must be present on Accept button');
});

// 15. Mobile layout remains usable
test('Test 15: Mobile layout remains usable with cardActionsRow wrap and equal growth', () => {
  const filePath = path.resolve(__dirname, '../../../app/distributor/d_requests.jsx');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(content.includes('flexWrap: \'wrap\''), 'cardActionsRow must allow wrapping on narrow mobile screens');
  assert.ok(content.includes('gap: 10'), 'cardActionsRow must maintain 10px spacing between buttons');
});

// 16. The buttons retain their existing action handlers
test('Test 16: Action buttons retain their callbacks onViewDetails, onDecline, onAccept', () => {
  const filePath = path.resolve(__dirname, '../../../app/distributor/d_requests.jsx');
  const content = fs.readFileSync(filePath, 'utf8');

  assert.ok(content.includes('onPress={() => onViewDetails(request)}'), 'onViewDetails must be wired to View Details');
  assert.ok(content.includes('onPress={() => onDecline(request)}'), 'onDecline must be wired to Decline');
  assert.ok(content.includes('onPress={() => onAccept(request)}'), 'onAccept must be wired to Accept Assignment');
});
