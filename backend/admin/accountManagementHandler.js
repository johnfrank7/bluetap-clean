const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { normalizeUsername } = require('../username/username');

const ROLES = new Set(['requester', 'distributor', 'manager']);
const ACTIONS = new Set(['deactivate', 'reactivate', 'resetPassword', 'updateProfile', 'reassignManager', 'signOutAllSessions']);
const clean = (value, max = 160) => String(value || '').trim().slice(0, max);
const emailFor = (value) => { const email = clean(value, 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OtpError(400, 'INVALID_EMAIL', 'Enter a valid email address.'); return email; };
const passwordFor = (value) => { const password = typeof value === 'string' ? value : ''; if (password.length < 12 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) throw new OtpError(400, 'WEAK_PASSWORD', 'Use 12-128 characters with uppercase, lowercase, and a number.'); return password; };
function bodyOf(req) { if (req.body && typeof req.body === 'object') return req.body; try { return JSON.parse(String(req.body || '{}')); } catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); } }
const statusOf = (data = {}) => { const raw = data.role === 'manager' ? (data.managerStatus || 'inactive') : data.role === 'distributor' ? (data.approvalStatus || data.status || 'pending') : (data.accountStatus || data.status || 'active'); const status = clean(raw, 30).toLowerCase(); return status === 'approved' ? 'active' : status; };
function safeAccount(uid, data = {}, branchNames = new Map(), authData = {}) { return {
  uid, fullName: clean(data.fullName || `${data.firstName || ''} ${data.lastName || ''}`), email: clean(data.email || authData.email).toLowerCase(), role: clean(data.role, 30),
  username: clean(data.username || data.usernameNormalized, 40), branchId: clean(data.branchId, 80), branchName: branchNames.get(data.branchId) || '',
  status: clean(statusOf(data), 30).toLowerCase(), mustChangePassword: data.mustChangePassword === true, accountSource: clean(data.accountSource || 'public_registration', 40),
  createdAt: data.createdAt || authData.metadata?.creationTime || null, updatedAt: data.updatedAt || null, lastSignInAt: authData.metadata?.lastSignInTime || null,
}; }
function safeAudit(id, data = {}) { return { id, action: clean(data.action, 80), actorUid: clean(data.actorUid || data.adminUid, 128), targetUid: clean(data.targetUid || data.managerUid, 128), role: clean(data.role || data.after?.role, 30), branchId: clean(data.branchId, 80), previousStatus: clean(data.previousStatus || data.before?.status || data.before?.managerStatus, 30), newStatus: clean(data.newStatus || data.after?.status || data.after?.managerStatus, 30), rejectionReason: clean(data.rejectionReason, 240), createdAt: data.createdAt || data.timestamp || null }; }
async function activeBranch(db, branchId) { const id = clean(branchId, 80); const snapshot = id && await db.collection('branches').doc(id).get(); if (!snapshot?.exists) throw new OtpError(404, 'BRANCH_NOT_FOUND', 'The selected branch does not exist.'); if (snapshot.data()?.status !== 'active') throw new OtpError(409, 'BRANCH_INACTIVE', 'The selected branch is inactive.'); return { id, ...snapshot.data() }; }
async function emailIsAttached(db, email) { return (await db.collection('users').where('email', '==', email).limit(1).get()).docs?.[0] || null; }
async function listWorkspace(auth, db) {
  const [users, branches, createdAudits, timestampAudits, authPage] = await Promise.all([
    db.collection('users').get(), db.collection('branches').get(),
    db.collection('adminAuditLogs').orderBy('createdAt', 'desc').limit(100).get(),
    db.collection('adminAuditLogs').orderBy('timestamp', 'desc').limit(100).get(),
    typeof auth.listUsers === 'function' ? auth.listUsers(1000) : { users: [] },
  ]);
  const branchNames = new Map(branches.docs.map((doc) => [doc.id, clean(doc.data()?.name)]));
  const authUsers = new Map((authPage.users || []).map((user) => [user.uid, user]));
  const accounts = users.docs.filter((doc) => ROLES.has(doc.data()?.role)).map((doc) => safeAccount(doc.id, doc.data(), branchNames, authUsers.get(doc.id))).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const auditById = new Map([...createdAudits.docs, ...timestampAudits.docs].map((doc) => [doc.id, safeAudit(doc.id, doc.data())]));
  const activity = [...auditById.values()].sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || ''))).slice(0, 100);
  return { accounts, activity };
}
function statusChanges(role, status) { if (role === 'manager') return { managerStatus: status }; if (role === 'distributor') return { approvalStatus: status, status: status[0].toUpperCase() + status.slice(1) }; return { accountStatus: status, status: status[0].toUpperCase() + status.slice(1) }; }

function createAdminAccountsHandler(getAdmin = getFirebaseAdmin) { return async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); if (!applyCors(req, res)) return; if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET, POST, or PATCH.' } });
  try {
    const { auth, db } = getAdmin(); const admin = await requireAdmin(req, auth, db);
    if (req.method === 'GET') return res.status(200).json(await listWorkspace(auth, db));
    const body = bodyOf(req);
    if (req.method === 'POST') {
      const role = clean(body.role, 30).toLowerCase(); if (!ROLES.has(role)) throw new OtpError(400, 'INVALID_ROLE', 'Choose requester, distributor, or manager.');
      const fullName = clean(body.fullName, 160); if (!fullName) throw new OtpError(400, 'FULL_NAME_REQUIRED', 'Full name is required.');
      const email = emailFor(body.email); const password = passwordFor(body.temporaryPassword); if (body.requirePasswordChange === false && role === 'manager') throw new OtpError(400, 'PASSWORD_CHANGE_REQUIRED', 'Managers must change their temporary password on first sign-in.');
      const mustChangePassword = body.requirePasswordChange !== false; let username = ''; let usernameNormalized = '';
      if (role !== 'manager') { username = clean(body.username, 20); usernameNormalized = normalizeUsername(username); }
      const branch = role === 'manager' ? await activeBranch(db, body.branchId) : null;
      try { await auth.getUserByEmail(email); throw new OtpError(409, 'EMAIL_ALREADY_IN_USE', 'This email is already in use.'); } catch (error) { if (error instanceof OtpError) throw error; if (error.code && error.code !== 'auth/user-not-found') throw error; }
      if (await emailIsAttached(db, email)) throw new OtpError(409, 'EMAIL_ALREADY_IN_USE', 'This email is already in use.');
      if (usernameNormalized && (await db.collection('usernames').doc(usernameNormalized).get()).exists) throw new OtpError(409, 'USERNAME_ALREADY_IN_USE', 'This username is already in use.');
      let user = null;
      try {
        user = await auth.createUser({ email, password, displayName: fullName, emailVerified: false }); if (role === 'manager') await auth.setCustomUserClaims(user.uid, { role: 'manager', manager: true });
        const now = new Date(); const [firstName, ...rest] = fullName.split(/\s+/); const profile = { uid: user.uid, email, fullName, firstName, lastName: rest.join(' '), role, accountSource: 'admin_created', verificationSource: 'admin_created', mustChangePassword, createdAt: now, updatedAt: now, createdBy: admin.uid, emailVerificationRequired: false, emailVerified: false, faceVerification: { required: false, status: 'not_required', verificationSource: 'admin_created' }, registrationCompleted: true, onboardingStatus: 'complete', ...(role === 'manager' ? { branchId: branch.id, managerStatus: 'active' } : { username, usernameNormalized, ...statusChanges(role, 'active') }) };
        await db.runTransaction(async (tx) => { if (usernameNormalized) { const ref = db.collection('usernames').doc(usernameNormalized); const existing = await tx.get(ref); if (existing.exists) throw new OtpError(409, 'USERNAME_ALREADY_IN_USE', 'This username is already in use.'); tx.create(ref, { uid: user.uid, createdAt: now }); } tx.create(db.collection('users').doc(user.uid), profile); tx.set(db.collection('adminAuditLogs').doc(), { action: role === 'manager' ? 'MANAGER_ACCOUNT_CREATED' : 'ADMIN_ACCOUNT_CREATED', actorUid: admin.uid, targetUid: user.uid, role, branchId: branch?.id || null, createdAt: now }); if (role === 'manager') tx.set(db.collection('adminAuditLogs').doc(), { action: 'MANAGER_BRANCH_ASSIGNED', actorUid: admin.uid, targetUid: user.uid, role, branchId: branch.id, createdAt: now }); });
        return res.status(201).json({ account: safeAccount(user.uid, profile, new Map([[branch?.id, branch?.name]]), user) });
      } catch (error) { if (user?.uid) try { await auth.deleteUser(user.uid); } catch {} throw error; }
    }
    const uid = clean(body.uid, 128); const action = clean(body.action, 40); if (!uid || !ACTIONS.has(action)) throw new OtpError(400, 'INVALID_ACCOUNT_ACTION', 'Choose a valid account action.');
    const ref = db.collection('users').doc(uid); const snapshot = await ref.get(); if (!snapshot.exists || !ROLES.has(snapshot.data()?.role)) throw new OtpError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
    const before = snapshot.data(); const now = new Date(); let changes = {}; let auditAction = 'ACCOUNT_UPDATED'; let authChanges = {};
    if (action === 'deactivate') { if (statusOf(before) !== 'active') throw new OtpError(409, 'ACCOUNT_NOT_ACTIVE', 'Only active accounts can be deactivated.'); changes = statusChanges(before.role, 'inactive'); authChanges.disabled = true; auditAction = 'ACCOUNT_DEACTIVATED'; }
    if (action === 'reactivate') { if (statusOf(before) !== 'inactive') throw new OtpError(409, 'ACCOUNT_NOT_INACTIVE', 'Only inactive accounts can be reactivated.'); if (before.role === 'manager') await activeBranch(db, before.branchId); changes = statusChanges(before.role, 'active'); authChanges.disabled = false; auditAction = 'ACCOUNT_REACTIVATED'; }
    if (action === 'resetPassword') { authChanges.password = passwordFor(body.temporaryPassword); changes.mustChangePassword = true; auditAction = 'TEMP_PASSWORD_RESET'; }
    if (action === 'signOutAllSessions') { auditAction = 'ACCOUNT_SESSIONS_REVOKED'; }
    if (action === 'updateProfile') { const fullName = clean(body.fullName, 160); if (!fullName) throw new OtpError(400, 'FULL_NAME_REQUIRED', 'Full name is required.'); const [firstName, ...rest] = fullName.split(/\s+/); changes = { fullName, firstName, lastName: rest.join(' ') }; authChanges.displayName = fullName; auditAction = 'ACCOUNT_UPDATED'; }
    let branch = null; if (action === 'reassignManager') { if (before.role !== 'manager') throw new OtpError(409, 'MANAGER_REQUIRED', 'Only Managers can be assigned to a branch.'); branch = await activeBranch(db, body.branchId); changes = { branchId: branch.id, managerStatus: 'active' }; auditAction = before.branchId === branch.id ? 'MANAGER_BRANCH_ASSIGNED' : 'MANAGER_BRANCH_REASSIGNED'; }
    if (Object.keys(authChanges).length) await auth.updateUser(uid, authChanges); changes = { ...changes, updatedAt: now, updatedBy: admin.uid };
    if (['deactivate', 'resetPassword', 'signOutAllSessions'].includes(action)) await auth.revokeRefreshTokens(uid);
    await db.runTransaction(async (tx) => { tx.update(ref, changes); tx.set(db.collection('adminAuditLogs').doc(), { action: auditAction, actorUid: admin.uid, targetUid: uid, role: before.role, branchId: branch?.id || before.branchId || null, previousStatus: statusOf(before), newStatus: statusOf({ ...before, ...changes }), createdAt: now }); });
    const branches = new Map(); if (branch) branches.set(branch.id, branch.name); return res.status(200).json({ account: safeAccount(uid, { ...before, ...changes }, branches, await auth.getUser(uid)) });
  } catch (error) { const known = error instanceof OtpError; return res.status(known ? error.status : 500).json({ error: { reason: known ? error.reason : 'ACCOUNT_MANAGEMENT_FAILED', message: known ? error.message : 'Account management is temporarily unavailable.' } }); }
}; }

module.exports = { createAdminAccountsHandler, emailFor, passwordFor, safeAccount, safeAudit, statusOf };
