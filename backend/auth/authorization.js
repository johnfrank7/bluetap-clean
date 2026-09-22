const { OtpError } = require('../utils/otpError');

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization || '').trim());
  if (!match) throw new OtpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  return match[1];
}

async function verifiedIdentity(req, auth) {
  try {
    return await auth.verifyIdToken(bearerToken(req), true);
  } catch (error) {
    if (error instanceof OtpError) throw error;
    throw new OtpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  }
}

async function requireAdmin(req, auth, db) {
  const decoded = await verifiedIdentity(req, auth);
  const profile = await db.collection('users').doc(decoded.uid).get();
  if (!profile.exists || !(decoded.admin === true || decoded.role === 'admin') || profile.data()?.role !== 'admin') {
    throw new OtpError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
  }
  if (profile.data()?.mustChangePassword === true) {
    throw new OtpError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your temporary password before using Admin features.');
  }
  return decoded;
}

async function requireRequester(req, auth, db) {
  const decoded = await verifiedIdentity(req, auth);
  const profileSnapshot = await db.collection('users').doc(decoded.uid).get();
  const profile = profileSnapshot.data() || {};
  if (!profileSnapshot.exists || profile.role !== 'requester') {
    throw new OtpError(403, 'REQUESTER_REQUIRED', 'Requester access is required.');
  }
  if (profile.mustChangePassword === true) {
    throw new OtpError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your temporary password before placing an order.');
  }
  if (['inactive', 'disabled'].includes(String(profile.accountStatus || profile.status || '').toLowerCase())) {
    throw new OtpError(403, 'ACCOUNT_INACTIVE', 'This Requester account is inactive.');
  }
  return { decoded, profile: { ...profile, uid: decoded.uid } };
}

async function requireActiveDistributor(req, auth, db) {
  const decoded = await verifiedIdentity(req, auth);
  const profileSnapshot = await db.collection('users').doc(decoded.uid).get();
  const profile = profileSnapshot.data() || {};
  const distributorStatus = String(profile.distributorStatus || profile.approvalStatus || profile.status || '').trim().toLowerCase();
  if (!profileSnapshot.exists || profile.role !== 'distributor') {
    throw new OtpError(403, 'DISTRIBUTOR_REQUIRED', 'Distributor access is required.');
  }
  if (profile.mustChangePassword === true) throw new OtpError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your temporary password before accessing BlueTap.');
  if (!['active', 'approved'].includes(distributorStatus) || ['inactive', 'disabled'].includes(String(profile.accountStatus || '').toLowerCase())) {
    throw new OtpError(403, 'DISTRIBUTOR_INACTIVE', 'This Distributor account is not active.');
  }
  const branchId = String(profile.branchId || '').trim();
  if (!branchId) throw new OtpError(403, 'BRANCH_ACCESS_DENIED', 'This Distributor account is not assigned to a branch.');
  const branchSnapshot = await db.collection('branches').doc(branchId).get();
  if (!branchSnapshot.exists || branchSnapshot.data()?.status !== 'active') {
    throw new OtpError(403, 'BRANCH_INACTIVE', 'This branch is currently inactive. Please contact BlueTap.');
  }
  if (typeof auth.getUser === 'function') {
    const authUser = await auth.getUser(decoded.uid);
    if (authUser?.disabled === true) throw new OtpError(403, 'DISTRIBUTOR_INACTIVE', 'This Distributor account is not active.');
  }
  return { decoded, profile: { ...profile, uid: decoded.uid }, branch: { id: branchSnapshot.id, ...branchSnapshot.data() } };
}

async function requireActiveManager(req, auth, db) {
  const decoded = await verifiedIdentity(req, auth);
  const profileSnapshot = await db.collection('users').doc(decoded.uid).get();
  const profile = profileSnapshot.data() || {};
  if (!profileSnapshot.exists || !(decoded.manager === true || decoded.role === 'manager') || profile.role !== 'manager') {
    throw new OtpError(403, 'MANAGER_REQUIRED', 'Manager access is required.');
  }
  if (profile.mustChangePassword === true) throw new OtpError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your temporary password before accessing BlueTap.');
  if (profile.managerStatus !== 'active') {
    throw new OtpError(403, 'MANAGER_INACTIVE', 'This Manager account is inactive. Please contact the BlueTap administrator.');
  }
  const branchId = String(profile.branchId || '').trim();
  if (!branchId) throw new OtpError(403, 'BRANCH_ACCESS_DENIED', 'This Manager account is not assigned to a branch.');
  const branchSnapshot = await db.collection('branches').doc(branchId).get();
  if (!branchSnapshot.exists || branchSnapshot.data()?.status !== 'active') {
    throw new OtpError(403, 'BRANCH_INACTIVE', 'This branch is currently inactive. Please contact the BlueTap administrator.');
  }
  if (typeof auth.getUser === 'function') {
    const authUser = await auth.getUser(decoded.uid);
    if (authUser?.disabled === true) throw new OtpError(403, 'MANAGER_INACTIVE', 'This Manager account is inactive. Please contact the BlueTap administrator.');
  }
  return { decoded, profile: { ...profile, uid: decoded.uid }, branch: { id: branchSnapshot.id, ...branchSnapshot.data() } };
}

function requireManagerBranch(managerContext, requestedBranchId) {
  const assigned = String(managerContext?.branch?.id || managerContext?.profile?.branchId || '').trim();
  if (!assigned || String(requestedBranchId || '').trim() !== assigned) {
    throw new OtpError(403, 'BRANCH_ACCESS_DENIED', 'Manager access to this branch is denied.');
  }
  return assigned;
}

module.exports = { bearerToken, requireActiveDistributor, requireActiveManager, requireAdmin, requireManagerBranch, requireRequester, verifiedIdentity };
