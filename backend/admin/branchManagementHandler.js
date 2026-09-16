const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');

const BRANCH_STATUS = new Set(['active', 'inactive']);
const MANAGER_STATUS = new Set(['active', 'inactive']);

const clean = (value, max = 160) => String(value || '').trim().slice(0, max);
const branchIdForCode = (code) => clean(code, 24).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
const safeBranch = (id, data = {}) => ({
  id,
  name: clean(data.name), code: clean(data.code, 24), barangay: clean(data.barangay),
  city: clean(data.city), address: clean(data.address, 240), status: data.status === 'inactive' ? 'inactive' : 'active',
  createdAt: data.createdAt || null, createdBy: data.createdBy || '', updatedAt: data.updatedAt || null, updatedBy: data.updatedBy || '',
});
const safeManager = (id, data = {}) => ({
  uid: id, email: clean(data.email).toLowerCase(), username: clean(data.username || data.usernameNormalized, 40),
  firstName: clean(data.firstName, 80), lastName: clean(data.lastName, 80), role: data.role,
  branchId: clean(data.branchId, 80), managerStatus: data.managerStatus === 'active' ? 'active' : 'inactive',
});

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); }
}

function branchInput(body, { partial = false } = {}) {
  const result = {};
  for (const [field, max] of [['name', 120], ['barangay', 120], ['city', 120], ['address', 240]]) {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) result[field] = clean(body[field], max);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = clean(body.status || 'active').toLowerCase();
    if (!BRANCH_STATUS.has(status)) throw new OtpError(400, 'INVALID_BRANCH_STATUS', 'Branch status must be active or inactive.');
    result.status = status;
  }
  if (!partial && (!result.name || !result.barangay || !result.city || !result.address)) {
    throw new OtpError(400, 'INVALID_BRANCH', 'Branch name and location details are required.');
  }
  return result;
}

async function activeBranch(db, branchId) {
  const id = clean(branchId, 80);
  const snapshot = id ? await db.collection('branches').doc(id).get() : null;
  if (!snapshot?.exists) throw new OtpError(404, 'BRANCH_NOT_FOUND', 'The selected branch does not exist.');
  if (snapshot.data()?.status !== 'active') throw new OtpError(409, 'BRANCH_INACTIVE', 'The selected branch is inactive.');
  return { id, ...snapshot.data() };
}

async function listBranches(db) {
  const [branchesSnapshot, managersSnapshot] = await Promise.all([
    db.collection('branches').get(),
    db.collection('users').where('role', '==', 'manager').get(),
  ]);
  const managers = new Map();
  managersSnapshot.docs.forEach((doc) => {
    const branchId = doc.data()?.branchId;
    if (!branchId) return;
    managers.set(branchId, [...(managers.get(branchId) || []), safeManager(doc.id, doc.data())]);
  });
  return branchesSnapshot.docs.map((doc) => ({ ...safeBranch(doc.id, doc.data()), managers: managers.get(doc.id) || [] }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function listManagers(db) {
  const [managersSnapshot, branchesSnapshot] = await Promise.all([
    db.collection('users').where('role', '==', 'manager').get(), db.collection('branches').get(),
  ]);
  const branches = new Map(branchesSnapshot.docs.map((doc) => [doc.id, safeBranch(doc.id, doc.data())]));
  return managersSnapshot.docs.map((doc) => {
    const manager = safeManager(doc.id, doc.data());
    return { ...manager, branch: branches.get(manager.branchId) || null };
  }).sort((left, right) => (left.email || left.username).localeCompare(right.email || right.username));
}

function responseError(res, error) {
  const known = error instanceof OtpError;
  return res.status(known ? error.status : 500).json({ error: {
    reason: known ? error.reason : 'service-unavailable',
    message: known ? error.message : 'Branch management is temporarily unavailable.',
  } });
}

function createAdminBranchesHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET, POST, or PATCH.' } });
    try {
      const { auth, db } = getAdmin();
      const admin = await requireAdmin(req, auth, db);
      if (req.method === 'GET') return res.status(200).json({ branches: await listBranches(db) });
      const body = bodyOf(req);
      if (req.method === 'POST') {
        const code = clean(body.code, 24).toUpperCase();
        const branchId = branchIdForCode(code);
        if (!branchId || !/^[A-Z0-9_-]{2,24}$/.test(code)) throw new OtpError(400, 'INVALID_BRANCH_CODE', 'Use 2-24 letters, numbers, underscores, or hyphens for the branch code.');
        const ref = db.collection('branches').doc(branchId);
        const existing = await ref.get();
        if (existing.exists) throw new OtpError(409, 'BRANCH_CODE_EXISTS', 'That branch code is already in use.');
        const now = new Date();
        const saved = { ...branchInput(body), code, createdAt: now, createdBy: admin.uid, updatedAt: now, updatedBy: admin.uid };
        await db.runTransaction(async (tx) => {
          tx.create(ref, saved);
          tx.set(db.collection('adminAuditLogs').doc(), { action: 'BRANCH_CREATED', adminUid: admin.uid, branchId, before: null, after: safeBranch(branchId, saved), createdAt: now });
        });
        return res.status(201).json({ branch: safeBranch(branchId, saved) });
      }
      const branchId = clean(body.branchId, 80);
      if (!branchId) throw new OtpError(400, 'BRANCH_ID_REQUIRED', 'Branch ID is required.');
      const ref = db.collection('branches').doc(branchId);
      const current = await ref.get();
      if (!current.exists) throw new OtpError(404, 'BRANCH_NOT_FOUND', 'Branch not found.');
      const changes = branchInput(body, { partial: true });
      if (!Object.keys(changes).length) throw new OtpError(400, 'NO_BRANCH_CHANGES', 'No branch changes were provided.');
      const now = new Date();
      const saved = { ...current.data(), ...changes, updatedAt: now, updatedBy: admin.uid };
      const action = current.data()?.status === 'active' && saved.status === 'inactive' ? 'BRANCH_DEACTIVATED' : 'BRANCH_UPDATED';
      await db.runTransaction(async (tx) => {
        tx.update(ref, { ...changes, updatedAt: now, updatedBy: admin.uid });
        tx.set(db.collection('adminAuditLogs').doc(), { action, adminUid: admin.uid, branchId, before: safeBranch(branchId, current.data()), after: safeBranch(branchId, saved), createdAt: now });
      });
      return res.status(200).json({ branch: safeBranch(branchId, saved) });
    } catch (error) { return responseError(res, error); }
  };
}

function createAdminManagersHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'PATCH'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or PATCH.' } });
    try {
      const { auth, db } = getAdmin();
      const admin = await requireAdmin(req, auth, db);
      if (req.method === 'GET') return res.status(200).json({ managers: await listManagers(db) });
      const body = bodyOf(req);
      const candidate = { uid: clean(body.managerUid, 128), profile: null };
      if (!candidate.uid) throw new OtpError(400, 'MANAGER_ID_REQUIRED', 'Manager ID is required.');
      const managerRef = db.collection('users').doc(candidate.uid);
      const managerSnapshot = await managerRef.get();
      const before = candidate.profile || managerSnapshot.data();
      if (!managerSnapshot.exists || (req.method === 'PATCH' && before?.role !== 'manager')) throw new OtpError(404, 'MANAGER_NOT_FOUND', 'Manager not found.');
      const requestedStatus = clean(body.managerStatus || 'active').toLowerCase();
      if (!MANAGER_STATUS.has(requestedStatus)) throw new OtpError(400, 'INVALID_MANAGER_STATUS', 'Manager status must be active or inactive.');
      const branch = requestedStatus === 'active' ? await activeBranch(db, body.branchId) : null;
      const next = { role: 'manager', managerStatus: requestedStatus, branchId: branch?.id || null, updatedAt: new Date(), updatedBy: admin.uid };
      const authUser = await auth.getUser(candidate.uid);
      await auth.setCustomUserClaims(candidate.uid, { ...(authUser.customClaims || {}), role: 'manager', manager: true, admin: false });
      const wasManager = before?.role === 'manager';
      const action = requestedStatus === 'inactive' ? 'MANAGER_DEACTIVATED'
        : wasManager && before?.branchId && before.branchId !== branch.id ? 'MANAGER_REASSIGNED'
          : 'MANAGER_ASSIGNED_TO_BRANCH';
      await db.runTransaction(async (tx) => {
        tx.update(managerRef, next);
        tx.set(db.collection('adminAuditLogs').doc(), {
          action, adminUid: admin.uid, managerUid: candidate.uid, branchId: branch?.id || before?.branchId || null,
          before: safeManager(candidate.uid, before), after: safeManager(candidate.uid, { ...before, ...next }), createdAt: next.updatedAt,
        });
      });
      return res.status(200).json({ manager: safeManager(candidate.uid, { ...before, ...next }), claimsRefreshRequired: true });
    } catch (error) { return responseError(res, error); }
  };
}

module.exports = { branchIdForCode, createAdminBranchesHandler, createAdminManagersHandler, safeBranch, safeManager };
