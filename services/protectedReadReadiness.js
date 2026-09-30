const clean = (value) => String(value || '').trim();
const normalized = (value) => clean(value).toLowerCase();

function activeAccount(profile) {
  const explicit = normalized(profile.accountStatus);
  if (explicit) return explicit === 'active';
  return ![profile.status, profile.managerStatus, profile.distributorStatus, profile.approvalStatus]
    .some((value) => ['inactive', 'disabled', 'suspended', 'terminated'].includes(normalized(value)));
}

function protectedReadReadiness({ authReady, tokenReady, uid, role, profileLoading, profile, branchLoading, branch, claims = {}, error }) {
  if (!authReady) return 'AUTH_PENDING';
  if (!uid) return 'GENUINE_DENIED';
  if (error) return 'GENUINE_DENIED';
  if (!tokenReady) return 'ROLE_PENDING';
  if (profileLoading) return 'PROFILE_PENDING';
  if (!profile || clean(profile.uid || profile.id) !== uid || normalized(profile.role) !== role
    || !activeAccount(profile) || profile.mustChangePassword === true) return 'GENUINE_DENIED';
  if (role === 'requester') return 'READY';
  if (role === 'manager' && (normalized(profile.managerStatus) !== 'active' || !(claims.manager === true || claims.role === 'manager'))) return 'GENUINE_DENIED';
  if (role === 'distributor' && !['active', 'approved'].includes(normalized(profile.distributorStatus || profile.approvalStatus || profile.status))) return 'GENUINE_DENIED';
  if (!['manager', 'distributor'].includes(role) || !clean(profile.branchId)) return 'GENUINE_DENIED';
  if (branchLoading) return 'BRANCH_PENDING';
  return branch && clean(branch.id) === clean(profile.branchId) && normalized(branch.status) === 'active' ? 'READY' : 'GENUINE_DENIED';
}

module.exports = { activeAccount, protectedReadReadiness };
