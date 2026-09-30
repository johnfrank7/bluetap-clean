const clean = (value) => String(value || '').trim();
const normalized = (value) => clean(value).toLowerCase();
const activeAccount = (value) => !clean(value) || normalized(value) === 'active';

function chatAccessReadiness({ authReady, branchId, role, roleData = {}, uid }) {
  if (roleData.readiness) {
    if (!authReady || (roleData.uid && roleData.uid !== uid)) return 'pending';
    return roleData.readiness === 'READY' ? 'ready' : roleData.readiness === 'GENUINE_DENIED' ? 'denied' : 'pending';
  }
  if (!authReady) return 'pending';
  if (!uid || role === 'admin') return 'denied';
  if (role === 'requester') return 'ready';

  if (role === 'distributor') {
    if (roleData.profileLoading) return 'pending';
    const profile = roleData.profile;
    const status = normalized(profile?.distributorStatus || profile?.approvalStatus || profile?.status);
    const profileUid = clean(profile?.uid || profile?.id);
    return profile
      && (!profileUid || profileUid === uid)
      && normalized(profile.role) === 'distributor'
      && ['active', 'approved'].includes(status)
      && activeAccount(profile.accountStatus)
      && Boolean(clean(profile.branchId))
      ? 'ready'
      : 'denied';
  }

  if (role === 'manager') {
    if (roleData.profileLoading || roleData.branchLoading) return 'pending';
    const profile = roleData.profile;
    const branch = roleData.branch;
    const authoritativeBranchId = clean(profile?.branchId);
    const profileUid = clean(profile?.uid || profile?.id);
    return profile
      && branch
      && (!profileUid || profileUid === uid)
      && normalized(profile.role) === 'manager'
      && normalized(profile.managerStatus) === 'active'
      && activeAccount(profile.accountStatus)
      && authoritativeBranchId === clean(branchId)
      && clean(branch.id) === clean(branchId)
      && normalized(branch.status) === 'active'
      ? 'ready'
      : 'denied';
  }

  return 'denied';
}

module.exports = { chatAccessReadiness };
