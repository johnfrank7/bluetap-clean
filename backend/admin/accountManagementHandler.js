const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { normalizeUsername } = require('../username/username');
const { loadRegistrationSecurity, SESSION_ROLES } = require('../registration/registrationSecurity');
const { generateNextPublicUid, formatPublicUid, parsePublicUidNumber } = require('../utils/publicUidGenerator');
const { normalizePhilippinePhone } = require('../utils/phoneUtils');

const ROLES = new Set(SESSION_ROLES);
const ACTIONS = new Set(['deactivate', 'reactivate', 'resetPassword', 'updateProfile', 'reassignManager', 'signOutAllSessions', 'updateAccount', 'backfillUids']);
const IDLE_TIMEOUTS = new Set([5, 10, 15, 30, 60, 120]);
const clean = (value, max = 160) => String(value || '').trim().slice(0, max);
const emailFor = (value) => { const email = clean(value, 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OtpError(400, 'INVALID_EMAIL', 'Enter a valid email address.'); return email; };
const passwordFor = (value) => { const password = typeof value === 'string' ? value : ''; if (password.length < 12 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) throw new OtpError(400, 'WEAK_PASSWORD', 'Use 12-128 characters with uppercase, lowercase, and a number.'); return password; };
function bodyOf(req) { if (req.body && typeof req.body === 'object') return req.body; try { return JSON.parse(String(req.body || '{}')); } catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); } }
const statusOf = (data = {}) => { const raw = data.role === 'manager' ? (data.managerStatus || 'inactive') : data.role === 'distributor' ? (data.distributorStatus || data.approvalStatus || data.status || 'pending') : (data.accountStatus || data.status || 'active'); const status = clean(raw, 30).toLowerCase(); return status === 'approved' ? 'active' : status; };
const onboardingOf = (data = {}) => ({ profile: data.registrationCompleted === false || data.onboardingStatus === 'face_enrollment_pending' ? 'incomplete' : 'complete', emailVerification: data.emailVerified === true ? 'otp_verified' : data.accountSource === 'admin_created' ? 'admin_provisioned' : 'not_verified', identity: data.faceVerification?.status === 'verified' ? 'verified' : data.faceVerification?.required === false || data.faceVerification?.status === 'not_required' ? 'not_required' : 'required' });
function safeAccount(uid, data = {}, branchNames = new Map(), authData = {}, rolePolicy = null) {
  const onboarding = onboardingOf(data);
  const role = clean(data.role, 30);
  const status = clean(statusOf(data), 30).toLowerCase();
  const requestedBranchId = clean(data.requestedBranchId, 80);
  const assignedBranchName = branchNames.get(data.branchId) || clean(data.branchNameSnapshot);
  const requestedBranchName = branchNames.get(requestedBranchId) || clean(data.requestedBranchNameSnapshot);
  const branchName = assignedBranchName || (role === 'distributor' && status === 'pending' ? (requestedBranchName ? `Requested: ${requestedBranchName}` : 'Requested branch unavailable') : role === 'distributor' ? 'Branch assignment required' : '');
  const publicUid = clean(data.publicUid || data.displayUid || data.unique_id, 80);
  return { uid, publicUid: publicUid || null, displayUid: publicUid || null, uniqueId: publicUid || null, fullName: clean(data.fullName || `${data.firstName || ''} ${data.lastName || ''}`), email: clean(data.email || authData.email).toLowerCase(), role, username: clean(data.username || data.usernameNormalized, 40), branchId: clean(data.branchId, 80), branchName, requestedBranchId, requestedBranchName, status, mustChangePassword: data.mustChangePassword === true, accountSource: clean(data.accountSource || 'public_registration', 40), createdAt: data.createdAt || authData.metadata?.creationTime || null, updatedAt: data.updatedAt || null, lastSignInAt: authData.metadata?.lastSignInTime || null, onboarding, sessionIdleTimeoutOverrideMinutes: Number.isInteger(data.sessionIdleTimeoutOverrideMinutes) ? data.sessionIdleTimeoutOverrideMinutes : null, sessionPolicy: rolePolicy ? { idleTimeoutMinutes: rolePolicy.idleTimeoutMinutes, absoluteSessionHours: rolePolicy.absoluteSessionHours } : null };
}
function safeAuditMetadata(data = {}) { return { role: clean(data.role, 30), status: clean(data.distributorStatus || data.status || data.accountStatus || data.approvalStatus || data.managerStatus, 30), branchId: clean(data.branchId, 80), requestedBranchId: clean(data.requestedBranchId, 80), sessionIdleTimeoutOverrideMinutes: Number.isInteger(data.sessionIdleTimeoutOverrideMinutes) ? data.sessionIdleTimeoutOverrideMinutes : null, mustChangePassword: data.mustChangePassword === true }; }
function safeAudit(id, data = {}) { return { id, action: clean(data.action, 80), actorUid: clean(data.actorUid || data.adminUid, 128), targetUid: clean(data.targetUid || data.managerUid, 128), role: clean(data.role || data.after?.role, 30), branchId: clean(data.branchId, 80), previousBranchId: clean(data.previousBranchId, 80), newBranchId: clean(data.newBranchId, 80), previousStatus: clean(data.previousStatus || data.before?.distributorStatus || data.before?.status || data.before?.managerStatus, 30), newStatus: clean(data.newStatus || data.after?.distributorStatus || data.after?.status || data.after?.managerStatus, 30), rejectionReason: clean(data.rejectionReason, 240), before: data.before && safeAuditMetadata(data.before), after: data.after && safeAuditMetadata(data.after), createdAt: data.createdAt || data.timestamp || null }; }
async function activeBranch(db, branchId) { const id = clean(branchId, 80); const snapshot = id && await db.collection('branches').doc(id).get(); if (!snapshot?.exists) throw new OtpError(404, 'BRANCH_NOT_FOUND', 'The selected branch does not exist.'); if (snapshot.data()?.status !== 'active') throw new OtpError(409, 'BRANCH_INACTIVE', 'The selected branch is inactive.'); return { id, ...snapshot.data() }; }
async function emailIsAttached(db, email, exceptUid = '') { return (await db.collection('users').where('email', '==', email).limit(2).get()).docs?.find((doc) => doc.id !== exceptUid) || null; }
async function listWorkspace(auth, db) { const [users, branches, createdAudits, timestampAudits, authPage, security] = await Promise.all([db.collection('users').get(), db.collection('branches').get(), db.collection('adminAuditLogs').orderBy('createdAt', 'desc').limit(100).get(), db.collection('adminAuditLogs').orderBy('timestamp', 'desc').limit(100).get(), typeof auth.listUsers === 'function' ? auth.listUsers(1000) : { users: [] }, loadRegistrationSecurity(db)]); const branchNames = new Map(branches.docs.map((doc) => [doc.id, clean(doc.data()?.name)])); const authUsers = new Map((authPage.users || []).map((user) => [user.uid, user])); const accounts = users.docs.filter((doc) => ROLES.has(doc.data()?.role)).map((doc) => safeAccount(doc.id, doc.data(), branchNames, authUsers.get(doc.id), security.sessionSecurity[doc.data()?.role])).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))); const auditById = new Map([...createdAudits.docs, ...timestampAudits.docs].map((doc) => [doc.id, safeAudit(doc.id, doc.data())])); return { accounts, activity: [...auditById.values()].sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || ''))).slice(0, 100) }; }
function statusChanges(role, status) { if (role === 'manager') return { managerStatus: status }; if (role === 'distributor') return { distributorStatus: status, approvalStatus: status, status: status[0].toUpperCase() + status.slice(1) }; return { accountStatus: status, status: status[0].toUpperCase() + status.slice(1) }; }
function nameChanges(fullName) { const [firstName, ...rest] = fullName.split(/\s+/); return { fullName, firstName, lastName: rest.join(' ') }; }
function timeoutOverride(value) { if (value === null || value === undefined || value === '') return null; const parsed = Number(value); if (!Number.isInteger(parsed) || !IDLE_TIMEOUTS.has(parsed)) throw new OtpError(400, 'INVALID_SESSION_TIMEOUT_OVERRIDE', 'Choose a supported idle timeout or use the role default.'); return parsed; }
function auditRecord(action, admin, uid, role, before, after, now, branchId = null, extra = {}) { return { action, actorUid: admin.uid, targetUid: uid, role, branchId, previousStatus: statusOf(before), newStatus: statusOf(after), before: safeAuditMetadata(before), after: safeAuditMetadata(after), createdAt: now, ...extra }; }
const ACTIVE_DELIVERY_STATUSES = new Set(['distributor_assigned', 'accepted', 'scheduled', 'out_for_delivery']);
async function distributorHasActiveDeliveries(db, uid) { const snapshot = await db.collection('requests').where('assignedDistributorUid', '==', uid).get(); return (snapshot.docs || []).some((doc) => ACTIVE_DELIVERY_STATUSES.has(clean(doc.data()?.status, 60).toLowerCase())); }

async function updateAccount({ auth, db, admin, uid, before, body }) {
  const now = new Date(); const requestedRole = clean(body.role || before.role, 30).toLowerCase(); if (!ROLES.has(requestedRole)) throw new OtpError(400, 'INVALID_ROLE', 'Choose requester, distributor, or manager.');
  const changes = {}; const authChanges = {}; const audits = []; let branch = null; let revoke = false;
  const fullName = clean(body.fullName ?? before.fullName, 160); if (!fullName) throw new OtpError(400, 'FULL_NAME_REQUIRED', 'Full name is required.'); if (fullName !== clean(before.fullName, 160)) { Object.assign(changes, nameChanges(fullName)); authChanges.displayName = fullName; }
  const email = emailFor(body.email ?? before.email); if (email !== clean(before.email, 254).toLowerCase()) { const authUser = await auth.getUserByEmail(email).catch((error) => error?.code === 'auth/user-not-found' ? null : Promise.reject(error)); if ((authUser && authUser.uid !== uid) || await emailIsAttached(db, email, uid)) throw new OtpError(409, 'EMAIL_ALREADY_IN_USE', 'This email is already in use.'); changes.email = email; authChanges.email = email; }
  if (requestedRole !== before.role) { if (['manager', 'distributor'].includes(requestedRole)) branch = await activeBranch(db, body.branchId); if (before.role === 'manager' && requestedRole !== 'manager') { const username = clean(body.username, 20); const normalized = normalizeUsername(username); const usernameDoc = await db.collection('usernames').doc(normalized).get(); if (usernameDoc.exists && usernameDoc.data()?.uid !== uid) throw new OtpError(409, 'USERNAME_ALREADY_IN_USE', 'This username is already in use.'); changes.username = username; changes.usernameNormalized = normalized; } changes.role = requestedRole; if (requestedRole === 'manager') Object.assign(changes, { branchId: branch.id, branchNameSnapshot: clean(branch.name), managerStatus: 'active' }); if (requestedRole === 'requester') Object.assign(changes, statusChanges('requester', 'active')); if (requestedRole === 'distributor') Object.assign(changes, { branchId: branch.id, branchNameSnapshot: clean(branch.name), ...statusChanges('distributor', 'active') }); if (typeof auth.setCustomUserClaims === 'function') await auth.setCustomUserClaims(uid, requestedRole === 'manager' ? { role: 'manager', manager: true } : {}); }
  const effectiveRole = requestedRole;
  if (effectiveRole === 'manager' && body.branchId && (!branch || branch.id !== clean(before.branchId, 80))) { branch = await activeBranch(db, body.branchId); if (branch.id !== before.branchId) { changes.branchId = branch.id; changes.managerStatus = 'active'; } }
  if (effectiveRole === 'distributor' && Object.prototype.hasOwnProperty.call(body, 'branchId')) { if (before.role === 'distributor' && !['active', 'inactive'].includes(statusOf(before))) throw new OtpError(409, 'DISTRIBUTOR_WORKFLOW_REQUIRED', 'Pending and rejected distributors must be approved in Distributor Management.'); branch = await activeBranch(db, body.branchId); if (branch.id !== clean(before.branchId, 80)) { if (clean(before.branchId, 80) && await distributorHasActiveDeliveries(db, uid)) throw new OtpError(409, 'DISTRIBUTOR_ACTIVE_DELIVERIES', 'This Distributor has active deliveries. Reassign those deliveries before changing branches.'); Object.assign(changes, { branchId: branch.id, branchNameSnapshot: clean(branch.name), distributorStatus: 'active', approvalStatus: 'active', status: 'Active' }); audits.push('DISTRIBUTOR_BRANCH_CHANGED'); } }
  if (Object.prototype.hasOwnProperty.call(body, 'sessionIdleTimeoutOverrideMinutes')) { const override = timeoutOverride(body.sessionIdleTimeoutOverrideMinutes); const existing = Number.isInteger(before.sessionIdleTimeoutOverrideMinutes) ? before.sessionIdleTimeoutOverrideMinutes : null; if (override !== existing) changes.sessionIdleTimeoutOverrideMinutes = override; }
  if (Object.prototype.hasOwnProperty.call(body, 'requirePasswordChange') && typeof body.requirePasswordChange === 'boolean' && body.requirePasswordChange !== (before.mustChangePassword === true)) changes.mustChangePassword = body.requirePasswordChange;
  if (clean(body.temporaryPassword, 128)) { authChanges.password = passwordFor(body.temporaryPassword); changes.mustChangePassword = true; revoke = true; audits.push('TEMP_PASSWORD_RESET'); }
  if (Object.prototype.hasOwnProperty.call(body, 'active') && typeof body.active === 'boolean') { const beforeStatus = statusOf(before); const currentStatus = statusOf({ ...before, ...changes, role: effectiveRole }); const active = body.active; if (before.role === 'distributor' && !['active', 'inactive'].includes(beforeStatus)) throw new OtpError(409, 'DISTRIBUTOR_WORKFLOW_REQUIRED', 'Pending and rejected distributors must be updated in Distributor Management.'); if (!active && currentStatus === 'active') { Object.assign(changes, statusChanges(effectiveRole, 'inactive')); authChanges.disabled = true; revoke = true; audits.push('ACCOUNT_DEACTIVATED'); } if (active && currentStatus === 'inactive') { if (['manager', 'distributor'].includes(effectiveRole)) await activeBranch(db, changes.branchId || before.branchId); Object.assign(changes, statusChanges(effectiveRole, 'active')); authChanges.disabled = false; audits.push('ACCOUNT_REACTIVATED'); } }
  if (!Object.keys(changes).length && !Object.keys(authChanges).length) { const security = await loadRegistrationSecurity(db); return { account: safeAccount(uid, before, new Map(), await auth.getUser(uid), security.sessionSecurity[effectiveRole]), changed: false }; }
  if (Object.keys(authChanges).length) await auth.updateUser(uid, authChanges); if (revoke) await auth.revokeRefreshTokens(uid);
  const after = { ...before, ...changes, role: effectiveRole }; changes.updatedAt = now; changes.updatedBy = admin.uid;
  if (requestedRole !== before.role) audits.push('ACCOUNT_ROLE_CHANGED'); if (branch && branch.id !== before.branchId && effectiveRole === 'manager') audits.push('MANAGER_BRANCH_REASSIGNED'); if (Object.prototype.hasOwnProperty.call(changes, 'sessionIdleTimeoutOverrideMinutes')) audits.push('ACCOUNT_SESSION_POLICY_CHANGED'); if (Object.prototype.hasOwnProperty.call(changes, 'mustChangePassword') && !audits.includes('TEMP_PASSWORD_RESET')) audits.push('PASSWORD_CHANGE_REQUIRED'); if (Object.keys(changes).some((key) => !['updatedAt', 'updatedBy'].includes(key))) audits.unshift('ACCOUNT_UPDATED');
  await db.runTransaction(async (tx) => { tx.update(db.collection('users').doc(uid), changes); audits.forEach((action) => tx.set(db.collection('adminAuditLogs').doc(), auditRecord(action, admin, uid, effectiveRole, before, after, now, branch?.id || after.branchId || null, action === 'DISTRIBUTOR_BRANCH_CHANGED' ? { previousBranchId: clean(before.branchId, 80), newBranchId: clean(after.branchId, 80), changedByAdminUid: admin.uid, changedAt: now } : {}))); });
  const security = await loadRegistrationSecurity(db); return { account: safeAccount(uid, after, new Map(branch ? [[branch.id, branch.name]] : []), await auth.getUser(uid), security.sessionSecurity[effectiveRole]), changed: true };
}

async function backfillLegacyUids({ auth, db, admin }) {
  const usersSnapshot = await db.collection('users').get();
  let backfilled = 0;
  let alreadyValid = 0;
  const unmatched = [];
  const now = new Date();

  for (const userDoc of usersSnapshot.docs) {
    const data = userDoc.data() || {};
    let resolvedUid = null;
    let needsAuthUidBackfill = !data.uid || !String(data.uid).trim();

    if (needsAuthUidBackfill) {
      try {
        if (typeof auth.getUser === 'function') {
          const authUser = await auth.getUser(userDoc.id);
          if (authUser?.uid === userDoc.id) {
            resolvedUid = userDoc.id;
          }
        }
      } catch {}

      if (!resolvedUid && data.email && typeof auth.getUserByEmail === 'function') {
        try {
          const authUser = await auth.getUserByEmail(data.email);
          if (authUser?.uid) {
            resolvedUid = authUser.uid;
          }
        } catch {}
      }
    } else {
      resolvedUid = data.uid;
      alreadyValid++;
    }

    // Check if publicUid needs backfilling
    let assignedPublicUid = data.publicUid || data.displayUid || null;
    let publicUidAssigned = false;
    if (!assignedPublicUid && data.role) {
      if (data.unique_id) {
        const parsedNum = parsePublicUidNumber(data.role, data.unique_id) || parseInt(String(data.unique_id).replace(/\D/g, ''), 10);
        if (Number.isFinite(parsedNum) && parsedNum > 0) {
          assignedPublicUid = formatPublicUid(data.role, parsedNum);
        }
      }
      if (!assignedPublicUid) {
        try {
          assignedPublicUid = await db.runTransaction((tx) => generateNextPublicUid(tx, db, data.role));
        } catch {}
      }
      if (assignedPublicUid) publicUidAssigned = true;
    }

    const updates = {};
    if (resolvedUid && needsAuthUidBackfill) updates.uid = resolvedUid;
    if (assignedPublicUid && publicUidAssigned) {
      updates.publicUid = assignedPublicUid;
      updates.displayUid = assignedPublicUid;
      if (!data.unique_id) updates.unique_id = assignedPublicUid;
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = now;
      updates.updatedBy = admin.uid;
      await db.collection('users').doc(userDoc.id).update(updates);
      if (needsAuthUidBackfill && resolvedUid) {
        await db.collection('adminAuditLogs').doc().set(
          auditRecord('LEGACY_UID_BACKFILLED', admin, resolvedUid, data.role || 'unknown', data, { ...data, ...updates }, now, data.branchId || null)
        );
        backfilled++;
      }
      if (publicUidAssigned) {
        await db.collection('adminAuditLogs').doc().set(
          auditRecord('PUBLIC_UID_BACKFILLED', admin, resolvedUid || userDoc.id, data.role || 'unknown', data, { ...data, ...updates }, now, data.branchId || null)
        );
      }
    } else if (needsAuthUidBackfill) {
      unmatched.push({ id: userDoc.id, email: data.email || null, role: data.role || null });
    }
  }

  return {
    total: usersSnapshot.size,
    backfilled,
    alreadyValid,
    unmatched,
  };
}

function createAdminAccountsHandler(getAdmin = getFirebaseAdmin) { return async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); if (!applyCors(req, res)) return; if (req.method === 'OPTIONS') return res.status(204).end(); if (!['GET', 'POST', 'PATCH'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET, POST, or PATCH.' } });
  try { const { auth, db } = getAdmin(); const admin = await requireAdmin(req, auth, db); if (req.method === 'GET') return res.status(200).json(await listWorkspace(auth, db)); const body = bodyOf(req);
    if (body.action === 'backfillUids') {
      const result = await backfillLegacyUids({ auth, db, admin });
      return res.status(200).json(result);
    }
    if (req.method === 'POST') { const role = clean(body.role, 30).toLowerCase(); if (!ROLES.has(role)) throw new OtpError(400, 'INVALID_ROLE', 'Choose requester, distributor, or manager.'); const fullName = clean(body.fullName, 160); if (!fullName) throw new OtpError(400, 'FULL_NAME_REQUIRED', 'Full name is required.'); const email = emailFor(body.email); const password = passwordFor(body.temporaryPassword); if (body.requirePasswordChange === false && role === 'manager') throw new OtpError(400, 'PASSWORD_CHANGE_REQUIRED', 'Managers must change their temporary password on first sign-in.'); const mustChangePassword = body.requirePasswordChange !== false; let username = ''; let usernameNormalized = ''; if (role !== 'manager') { username = clean(body.username, 20); usernameNormalized = normalizeUsername(username); } const branch = ['manager', 'distributor'].includes(role) ? await activeBranch(db, body.branchId) : null; try { await auth.getUserByEmail(email); throw new OtpError(409, 'EMAIL_ALREADY_IN_USE', 'This email is already in use.'); } catch (error) { if (error instanceof OtpError) throw error; if (error.code && error.code !== 'auth/user-not-found') throw error; } if (await emailIsAttached(db, email)) throw new OtpError(409, 'EMAIL_ALREADY_IN_USE', 'This email is already in use.'); if (usernameNormalized && (await db.collection('usernames').doc(usernameNormalized).get()).exists) throw new OtpError(409, 'USERNAME_ALREADY_IN_USE', 'This username is already in use.'); let user = null;
      try {
        user = await auth.createUser({ email, password, displayName: fullName, emailVerified: false });
        if (role === 'manager') await auth.setCustomUserClaims(user.uid, { role: 'manager', manager: true });
        const now = new Date();
        const phone = normalizePhilippinePhone(body.phone || body.contactNumber || '');
        let publicUid = null;
        let createdProfile = null;
        await db.runTransaction(async (tx) => {
          publicUid = await generateNextPublicUid(tx, db, role);
          if (usernameNormalized) {
            const ref = db.collection('usernames').doc(usernameNormalized);
            const existing = await tx.get(ref);
            if (existing.exists) throw new OtpError(409, 'USERNAME_ALREADY_IN_USE', 'This username is already in use.');
            tx.create(ref, { uid: user.uid, createdAt: now });
          }
          createdProfile = {
            uid: user.uid, email, publicUid, displayUid: publicUid, unique_id: publicUid,
            ...(phone ? { phone, contactNumber: phone } : {}),
            ...nameChanges(fullName), role, accountSource: 'admin_created', verificationSource: 'admin_created',
            mustChangePassword, createdAt: now, updatedAt: now, createdBy: admin.uid,
            emailVerificationRequired: false, emailVerified: false,
            faceVerification: { required: false, status: 'not_required', verificationSource: 'admin_created' },
            registrationCompleted: true, onboardingStatus: 'complete',
            ...(role === 'manager' ? { branchId: branch.id, branchNameSnapshot: clean(branch.name), managerStatus: 'active' } : role === 'distributor' ? { username, usernameNormalized, branchId: branch.id, branchNameSnapshot: clean(branch.name), ...statusChanges(role, 'active') } : { username, usernameNormalized, ...statusChanges(role, 'active') })
          };
          tx.create(db.collection('users').doc(user.uid), createdProfile);
          tx.set(db.collection('adminAuditLogs').doc(), auditRecord(role === 'manager' ? 'MANAGER_ACCOUNT_CREATED' : 'ADMIN_ACCOUNT_CREATED', admin, user.uid, role, {}, createdProfile, now, branch?.id || null));
          if (role === 'manager') tx.set(db.collection('adminAuditLogs').doc(), auditRecord('MANAGER_BRANCH_ASSIGNED', admin, user.uid, role, {}, createdProfile, now, branch.id));
          if (role === 'distributor') tx.set(db.collection('adminAuditLogs').doc(), auditRecord('DISTRIBUTOR_BRANCH_ASSIGNED', admin, user.uid, role, {}, createdProfile, now, branch.id, { newBranchId: branch.id, changedByAdminUid: admin.uid, changedAt: now }));
        });
        const security = await loadRegistrationSecurity(db);
        return res.status(201).json({ account: safeAccount(user.uid, createdProfile, new Map([[branch?.id, branch?.name]]), user, security.sessionSecurity[role]) });
      } catch (error) { if (user?.uid) try { await auth.deleteUser(user.uid); } catch {} throw error; }
    }
    const uid = clean(body.uid, 128); const action = clean(body.action, 40); if (!uid || !ACTIONS.has(action)) throw new OtpError(400, 'INVALID_ACCOUNT_ACTION', 'Choose a valid account action.'); const ref = db.collection('users').doc(uid); const snapshot = await ref.get(); if (!snapshot.exists || !ROLES.has(snapshot.data()?.role)) throw new OtpError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.'); const before = snapshot.data(); if (action === 'updateAccount') return res.status(200).json(await updateAccount({ auth, db, admin, uid, before, body }));
    const now = new Date(); let changes = {}; let auditAction = 'ACCOUNT_UPDATED'; let authChanges = {}; if (action === 'deactivate') { if (statusOf(before) !== 'active') throw new OtpError(409, 'ACCOUNT_NOT_ACTIVE', 'Only active accounts can be deactivated.'); changes = statusChanges(before.role, 'inactive'); authChanges.disabled = true; auditAction = 'ACCOUNT_DEACTIVATED'; } if (action === 'reactivate') { if (statusOf(before) !== 'inactive') throw new OtpError(409, 'ACCOUNT_NOT_INACTIVE', 'Only inactive accounts can be reactivated.'); if (['manager', 'distributor'].includes(before.role)) await activeBranch(db, before.branchId); changes = statusChanges(before.role, 'active'); authChanges.disabled = false; auditAction = 'ACCOUNT_REACTIVATED'; } if (action === 'resetPassword') { authChanges.password = passwordFor(body.temporaryPassword); changes.mustChangePassword = true; auditAction = 'TEMP_PASSWORD_RESET'; } if (action === 'signOutAllSessions') auditAction = 'USER_SESSIONS_REVOKED'; if (action === 'updateProfile') { const fullName = clean(body.fullName, 160); if (!fullName) throw new OtpError(400, 'FULL_NAME_REQUIRED', 'Full name is required.'); changes = nameChanges(fullName); authChanges.displayName = fullName; } let branch = null; if (action === 'reassignManager') { if (before.role !== 'manager') throw new OtpError(409, 'MANAGER_REQUIRED', 'Only Managers can be assigned to a branch.'); branch = await activeBranch(db, body.branchId); changes = { branchId: branch.id, branchNameSnapshot: clean(branch.name), managerStatus: 'active' }; auditAction = before.branchId === branch.id ? 'MANAGER_BRANCH_ASSIGNED' : 'MANAGER_BRANCH_REASSIGNED'; } if (Object.keys(authChanges).length) await auth.updateUser(uid, authChanges); changes = { ...changes, updatedAt: now, updatedBy: admin.uid }; if (['deactivate', 'resetPassword', 'signOutAllSessions'].includes(action)) await auth.revokeRefreshTokens(uid); const after = { ...before, ...changes }; await db.runTransaction(async (tx) => { tx.update(ref, changes); tx.set(db.collection('adminAuditLogs').doc(), auditRecord(auditAction, admin, uid, before.role, before, after, now, branch?.id || before.branchId || null)); }); const security = await loadRegistrationSecurity(db); const branches = new Map(); if (branch) branches.set(branch.id, branch.name); return res.status(200).json({ account: safeAccount(uid, after, branches, await auth.getUser(uid), security.sessionSecurity[before.role]) });
  } catch (error) { const known = error instanceof OtpError; return res.status(known ? error.status : 500).json({ error: { reason: known ? error.reason : 'ACCOUNT_MANAGEMENT_FAILED', message: known ? error.message : 'Account management is temporarily unavailable.' } }); }
}; }

module.exports = { backfillLegacyUids, createAdminAccountsHandler, emailFor, passwordFor, safeAccount, safeAudit, statusOf, timeoutOverride };
