const assert = require('node:assert/strict');
const test = require('node:test');

const {
  RELATIONSHIP_VERSION_BASELINE,
  assignmentVersionForTransition,
  branchMembershipVersionForTransition,
  getAssignmentVersion,
  getBranchMembershipVersion,
} = require('../relationshipEpochs');

test('missing relationship epochs use the deterministic legacy baseline', () => {
  assert.equal(getAssignmentVersion({ assignedDistributorUid: 'distributor-a' }), RELATIONSHIP_VERSION_BASELINE);
  assert.equal(getBranchMembershipVersion({ role: 'distributor', branchId: 'branch-a' }), RELATIONSHIP_VERSION_BASELINE);
});

test('explicit invalid relationship epochs fail closed', () => {
  for (const value of [null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => getAssignmentVersion({ assignmentVersion: value }), (error) => error.reason === 'INVALID_ASSIGNMENT_VERSION');
    assert.throws(() => getBranchMembershipVersion({ branchMembershipVersion: value }), (error) => error.reason === 'INVALID_BRANCH_MEMBERSHIP_VERSION');
  }
});

test('assignment version changes iff the authoritative Distributor identity changes', () => {
  const unassigned = { assignmentVersion: 1, assignedDistributorUid: null };
  const first = assignmentVersionForTransition(unassigned, 'distributor-a');
  assert.equal(first.changed, true);
  assert.equal(first.assignmentVersion, 2);

  const same = assignmentVersionForTransition({ assignmentVersion: 2, assignedDistributorUid: 'distributor-a' }, 'distributor-a');
  assert.equal(same.changed, false);
  assert.equal(same.assignmentVersion, 2);

  const reassigned = assignmentVersionForTransition({ assignmentVersion: 2, assignedDistributorUid: 'distributor-a' }, 'distributor-b');
  assert.equal(reassigned.assignmentVersion, 3);

  const cleared = assignmentVersionForTransition({ assignmentVersion: 3, assignedDistributorUid: 'distributor-b' }, '');
  assert.equal(cleared.assignmentVersion, 4);

  const retriedClear = assignmentVersionForTransition({ assignmentVersion: 4, assignedDistributorUid: null }, '');
  assert.equal(retriedClear.changed, false);
  assert.equal(retriedClear.assignmentVersion, 4);
});

test('legacy assigned orders advance away from their fallback epoch on the first transition', () => {
  assert.equal(assignmentVersionForTransition({ assignedDistributorUid: 'distributor-a' }, 'distributor-b').assignmentVersion, 2);
  assert.equal(assignmentVersionForTransition({ assignedDistributorUid: 'distributor-a' }, '').assignmentVersion, 2);
});

test('branch membership version tracks continuous Distributor-to-branch membership only', () => {
  const initial = branchMembershipVersionForTransition(
    { role: 'distributor', branchId: null, branchMembershipVersion: 1 },
    { role: 'distributor', branchId: 'branch-a' }
  );
  assert.equal(initial.branchMembershipVersion, 2);

  const profileEdit = branchMembershipVersionForTransition(
    { role: 'distributor', branchId: 'branch-a', branchMembershipVersion: 2, phone: 'old' },
    { role: 'distributor', branchId: 'branch-a', phone: 'new' }
  );
  assert.equal(profileEdit.changed, false);
  assert.equal(profileEdit.branchMembershipVersion, 2);

  const moved = branchMembershipVersionForTransition(
    { role: 'distributor', branchId: 'branch-a', branchMembershipVersion: 2 },
    { role: 'distributor', branchId: 'branch-b' }
  );
  assert.equal(moved.branchMembershipVersion, 3);

  const removed = branchMembershipVersionForTransition(
    { role: 'distributor', branchId: 'branch-b', branchMembershipVersion: 3 },
    { role: 'requester', branchId: 'branch-b' }
  );
  assert.equal(removed.branchMembershipVersion, 4);

  const restored = branchMembershipVersionForTransition(
    { role: 'requester', branchId: 'branch-b', branchMembershipVersion: 4 },
    { role: 'distributor', branchId: 'branch-b' }
  );
  assert.equal(restored.branchMembershipVersion, 5);
});
