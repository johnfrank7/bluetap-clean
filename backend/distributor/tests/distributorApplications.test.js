const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isPendingStatus,
  normalizeDistributorStatus,
  approveDistributorApplicationInTransaction,
  rejectDistributorApplicationInTransaction,
  statusOf,
} = require('../distributorApplicationService');

const {
  isPendingDistributorApplication,
  normalizeDistributorApplication,
  normalizeDistributorApplicationStatus,
} = require('../../../services/distributorApplications');

// Mock Firestore Transaction and Database
function createMockDb(initialUsers = {}, initialBranches = {}) {
  const users = new Map(Object.entries(initialUsers));
  const branches = new Map(Object.entries(initialBranches));
  const auditLogs = [];
  const moderationNotices = [];

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
              doc: () => ({
                id: `notice-${Date.now()}`,
                set: (data) => moderationNotices.push({ targetId, ...data }),
              }),
            }),
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
      _updates: updates,
    };
  };

  return { db, createTx, users, branches, auditLogs, moderationNotices };
}

test('distributorApplications client normalizer handles variations of pending status and hides raw UIDs', () => {
  assert.equal(normalizeDistributorApplicationStatus('pending'), 'pending');
  assert.equal(normalizeDistributorApplicationStatus('pending_branch_review'), 'pending');
  assert.equal(normalizeDistributorApplicationStatus('Pending_Review'), 'pending');
  assert.equal(normalizeDistributorApplicationStatus('Submitted'), 'pending');
  assert.equal(normalizeDistributorApplicationStatus('Active'), 'active');
  assert.equal(normalizeDistributorApplicationStatus('Approved'), 'active');
  assert.equal(normalizeDistributorApplicationStatus('Rejected'), 'rejected');

  const applicant = {
    uid: 'firebase-internal-uid-1234567890',
    publicUid: 'DIST-TOLEDO-001',
    firstName: 'Juan',
    lastName: 'Dela Cruz',
    email: 'juan@example.com',
    requestedBranchId: 'branch-toledo',
    distributorStatus: 'pending_branch_review',
  };

  assert.equal(isPendingDistributorApplication(applicant), true);

  const normalized = normalizeDistributorApplication(applicant);
  assert.equal(normalized.fullName, 'Juan Dela Cruz');
  assert.equal(normalized.displayUid, 'DIST-TOLEDO-001');
  assert.equal(normalized.status, 'pending');
  assert.equal(normalized.isPending, true);
});

test('approveDistributorApplicationInTransaction approves pending applicant without failing on accountStatus', async () => {
  const { db, createTx, auditLogs, moderationNotices } = createMockDb(
    {
      'dist-1': {
        role: 'distributor',
        fullName: 'Maria Santos',
        email: 'maria@example.com',
        requestedBranchId: 'branch-a',
        distributorStatus: 'pending',
        accountStatus: 'pending', // Must NOT trigger ACCOUNT_INACTIVE!
      },
    },
    {
      'branch-a': {
        name: 'Branch Alpha',
        status: 'active',
      },
    }
  );

  const tx = createTx();
  const targetRef = db.collection('users').doc('dist-1');

  const result = await approveDistributorApplicationInTransaction({
    actorRole: 'manager',
    actorUid: 'mgr-1',
    actorPublicUid: 'MGR-001',
    branchId: 'branch-a',
    db,
    enforceRequestedBranch: true,
    idempotent: true,
    targetRef,
    tx,
  });

  assert.equal(result.idempotent, false);
  assert.equal(result.changes.distributorStatus, 'active');
  assert.equal(result.changes.accountStatus, 'active');
  assert.equal(result.changes.branchId, 'branch-a');
  assert.equal(result.changes.branchNameSnapshot, 'Branch Alpha');
  assert.equal(result.changes.approvedBy, 'mgr-1');

  // Verify Audit Log
  const log = auditLogs.find((l) => l.action === 'MANAGER_DISTRIBUTOR_APPROVED');
  assert.ok(log, 'Audit log must record MANAGER_DISTRIBUTOR_APPROVED');
  assert.equal(log.actorRole, 'manager');
  assert.equal(log.targetUid, 'dist-1');
  assert.equal(log.newStatus, 'active');

  // Verify Applicant Moderation Notice
  const notice = moderationNotices.find((n) => n.targetId === 'dist-1');
  assert.ok(notice, 'Applicant must receive approval notice');
  assert.equal(notice.type, 'distributor_application_approved');
  assert.equal(notice.branchId, 'branch-a');
});

test('approveDistributorApplicationInTransaction is idempotent for already active distributor', async () => {
  const { db, createTx } = createMockDb(
    {
      'dist-2': {
        role: 'distributor',
        fullName: 'Jose Rizal',
        branchId: 'branch-a',
        requestedBranchId: 'branch-a',
        distributorStatus: 'active',
        accountStatus: 'active',
      },
    },
    {
      'branch-a': { name: 'Branch Alpha', status: 'active' },
    }
  );

  const tx = createTx();
  const targetRef = db.collection('users').doc('dist-2');

  const result = await approveDistributorApplicationInTransaction({
    actorRole: 'manager',
    actorUid: 'mgr-1',
    branchId: 'branch-a',
    db,
    enforceRequestedBranch: true,
    idempotent: true,
    targetRef,
    tx,
  });

  assert.equal(result.idempotent, true);
});

test('rejectDistributorApplicationInTransaction declines applicant and creates audit log and notice', async () => {
  const { db, createTx, auditLogs, moderationNotices } = createMockDb(
    {
      'dist-3': {
        role: 'distributor',
        fullName: 'Pedro Penduko',
        requestedBranchId: 'branch-a',
        distributorStatus: 'pending',
      },
    },
    {
      'branch-a': { name: 'Branch Alpha', status: 'active' },
    }
  );

  const tx = createTx();
  const targetRef = db.collection('users').doc('dist-3');

  const result = await rejectDistributorApplicationInTransaction({
    actorRole: 'manager',
    actorUid: 'mgr-1',
    actorPublicUid: 'MGR-001',
    branchId: 'branch-a',
    db,
    enforceRequestedBranch: true,
    rejectionReason: 'Applicant does not reside within branch distribution area.',
    targetRef,
    tx,
  });

  assert.equal(result.changes.distributorStatus, 'rejected');
  assert.equal(result.changes.rejectionReason, 'Applicant does not reside within branch distribution area.');
  assert.equal(result.changes.branchId, null);

  const log = auditLogs.find((l) => l.action === 'MANAGER_DISTRIBUTOR_REJECTED');
  assert.ok(log, 'Audit log must record MANAGER_DISTRIBUTOR_REJECTED');
  assert.equal(log.rejectionReason, 'Applicant does not reside within branch distribution area.');

  const notice = moderationNotices.find((n) => n.targetId === 'dist-3');
  assert.ok(notice, 'Applicant must receive rejection notice');
  assert.equal(notice.type, 'distributor_application_rejected');
});

test('Cross-branch protection: Manager cannot approve or decline applicants requesting other branches', async () => {
  const { db, createTx } = createMockDb(
    {
      'dist-cross': {
        role: 'distributor',
        fullName: 'Cross Applicant',
        requestedBranchId: 'branch-other',
        distributorStatus: 'pending',
      },
    },
    {
      'branch-other': { name: 'Other Branch', status: 'active' },
      'branch-mine': { name: 'My Branch', status: 'active' },
    }
  );

  const tx = createTx();
  const targetRef = db.collection('users').doc('dist-cross');

  await assert.rejects(
    async () => {
      await approveDistributorApplicationInTransaction({
        actorRole: 'manager',
        actorUid: 'mgr-mine',
        branchId: 'branch-mine',
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

  await assert.rejects(
    async () => {
      await rejectDistributorApplicationInTransaction({
        actorRole: 'manager',
        actorUid: 'mgr-mine',
        branchId: 'branch-mine',
        db,
        enforceRequestedBranch: true,
        rejectionReason: 'Declined',
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

test('Manager distributor applications UI has visible high-contrast 44px Approve button with loading text', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const fileContent = fs.readFileSync(path.resolve(__dirname, '../../../app/manager/distributors.jsx'), 'utf8');

  // Verify approve button styles
  assert.match(fileContent, /approveApplicationButton:\s*\{[^}]*minHeight:\s*44/);
  assert.match(fileContent, /approveApplicationButton:\s*\{[^}]*backgroundColor:\s*resolvedTheme === 'dark'/);
  assert.match(fileContent, /approveApplicationText:\s*\{[^}]*color:\s*['"]#FFFFFF['"]/);

  // Verify loading state renders "Approving…" with spinner
  assert.match(fileContent, /styles\.approveLoadingRow/);
  assert.match(fileContent, /Approving…/);
  assert.match(fileContent, /<ActivityIndicator size="small" color="#FFFFFF" \/>/);
});
