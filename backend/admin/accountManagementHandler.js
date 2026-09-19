const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { normalizeUsername } = require('../username/username');

const ROLES = new Set(['requester', 'distributor', 'manager']);
const clean = (value, max = 160) => String(value || '').trim().slice(0, max);
const emailFor = (value) => {
  const email = clean(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OtpError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  return email;
};
const passwordFor = (value) => {
  const password = typeof value === 'string' ? value : '';
  if (password.length < 12 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new OtpError(400, 'WEAK_PASSWORD', 'Use 12-128 characters with uppercase, lowercase, and a number.');
  }
  return password;
};
function bodyOf(req) { if (req.body && typeof req.body === 'object') return req.body; try { return JSON.parse(String(req.body || '{}')); } catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); } }
function safeAccount(uid, data = {}, branchNames = new Map()) {
  return { uid, fullName: clean(data.fullName || `${data.firstName || ''} ${data.lastName || ''}`), email: clean(data.email).toLowerCase(), role: data.role,
    username: clean(data.username), branchId: clean(data.branchId, 80), branchName: branchNames.get(data.branchId) || '',
    status: data.role === 'manager' ? (data.managerStatus || 'inactive') : (data.approvalStatus || data.status || 'active'),
    mustChangePassword: data.mustChangePassword === true, createdAt: data.createdAt || null }; }
async function activeBranch(db, branchId) {
  const id = clean(branchId, 80); const snapshot = id && await db.collection('branches').doc(id).get();
  if (!snapshot?.exists) throw new OtpError(404, 'BRANCH_NOT_FOUND', 'The selected branch does not exist.');
  if (snapshot.data()?.status !== 'active') throw new OtpError(409, 'BRANCH_INACTIVE', 'The selected branch is inactive.');
  return { id, ...snapshot.data() };
}
async function emailIsAttached(db, email) { return (await db.collection('users').where('email', '==', email).limit(1).get()).docs?.[0] || null; }
function createAdminAccountsHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); if (!applyCors(req, res)) return; if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or POST.' } });
    try {
      const { auth, db } = getAdmin(); const admin = await requireAdmin(req, auth, db);
      if (req.method === 'GET') {
        const [accounts, branches] = await Promise.all([db.collection('users').where('accountSource', '==', 'admin_created').get(), db.collection('branches').get()]);
        const names = new Map(branches.docs.map((doc) => [doc.id, clean(doc.data()?.name)]));
        return res.status(200).json({ accounts: accounts.docs.map((doc) => safeAccount(doc.id, doc.data(), names)).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))) });
      }
      const body = bodyOf(req); const role = clean(body.role, 30).toLowerCase();
      if (!ROLES.has(role)) throw new OtpError(400, 'INVALID_ROLE', 'Choose requester, distributor, or manager.');
      const fullName = clean(body.fullName, 160); if (!fullName) throw new OtpError(400, 'FULL_NAME_REQUIRED', 'Full name is required.');
      const email = emailFor(body.email); const password = passwordFor(body.temporaryPassword);
      if (body.requirePasswordChange === false && role === 'manager') throw new OtpError(400, 'PASSWORD_CHANGE_REQUIRED', 'Managers must change their temporary password on first sign-in.');
      const mustChangePassword = body.requirePasswordChange !== false;
      let username = ''; let usernameNormalized = '';
      if (role !== 'manager') { username = clean(body.username, 20); usernameNormalized = normalizeUsername(username); }
      const branch = role === 'manager' ? await activeBranch(db, body.branchId) : null;
      try { await auth.getUserByEmail(email); throw new OtpError(409, 'EMAIL_ALREADY_IN_USE', 'This email is already in use.'); }
      catch (error) { if (error instanceof OtpError) throw error; if (error.code && error.code !== 'auth/user-not-found') throw error; }
      if (await emailIsAttached(db, email)) throw new OtpError(409, 'EMAIL_ALREADY_IN_USE', 'This email is already in use.');
      if (usernameNormalized) { const claimed = await db.collection('usernames').doc(usernameNormalized).get(); if (claimed.exists) throw new OtpError(409, 'USERNAME_ALREADY_IN_USE', 'This username is already in use.'); }
      let user = null;
      try {
        user = await auth.createUser({ email, password, displayName: fullName, emailVerified: false });
        // Claims are established before the profile is made visible. If either
        // this or the Firestore transaction fails, the newly-created Auth user
        // is removed below; existing accounts are never touched.
        if (role === 'manager') await auth.setCustomUserClaims(user.uid, { role: 'manager', manager: true });
        const now = new Date(); const [firstName, ...rest] = fullName.split(/\s+/); const profile = {
          uid: user.uid, email, fullName, firstName, lastName: rest.join(' '), role, accountSource: 'admin_created', verificationSource: 'admin_created',
          mustChangePassword, createdAt: now, updatedAt: now, createdBy: admin.uid,
          emailVerificationRequired: false, emailVerified: false, faceVerification: { required: false, status: 'not_required', verificationSource: 'admin_created' },
          registrationCompleted: true, onboardingStatus: 'complete',
          ...(role === 'manager' ? { branchId: branch.id, managerStatus: 'active' } : { username, usernameNormalized, approvalStatus: 'active', status: 'Active' }),
        };
        await db.runTransaction(async (tx) => {
          if (usernameNormalized) { const ref = db.collection('usernames').doc(usernameNormalized); const existing = await tx.get(ref); if (existing.exists) throw new OtpError(409, 'USERNAME_ALREADY_IN_USE', 'This username is already in use.'); tx.create(ref, { uid: user.uid, createdAt: now }); }
          tx.create(db.collection('users').doc(user.uid), profile);
          tx.set(db.collection('adminAuditLogs').doc(), { action: role === 'manager' ? 'MANAGER_ACCOUNT_CREATED' : 'ADMIN_ACCOUNT_CREATED', actorUid: admin.uid, targetUid: user.uid, role, branchId: branch?.id || null, createdAt: now });
          if (role === 'manager') tx.set(db.collection('adminAuditLogs').doc(), { action: 'MANAGER_BRANCH_ASSIGNED', actorUid: admin.uid, targetUid: user.uid, role, branchId: branch.id, createdAt: now });
        });
        return res.status(201).json({ account: safeAccount(user.uid, profile, new Map([[branch?.id, branch?.name]])) });
      } catch (error) {
        if (user?.uid) { try { await auth.deleteUser(user.uid); } catch { /* no unrelated data is touched */ } }
        throw error;
      }
    } catch (error) { const known = error instanceof OtpError; return res.status(known ? error.status : 500).json({ error: { reason: known ? error.reason : 'ACCOUNT_CREATION_FAILED', message: known ? error.message : 'The account could not be created. Please try again.' } }); }
  };
}
module.exports = { createAdminAccountsHandler, emailFor, passwordFor };
