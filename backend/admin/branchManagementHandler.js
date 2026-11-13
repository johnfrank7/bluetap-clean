const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { DEFAULT_SERVICE_RADIUS_KM, TOLEDO_BARANGAYS, TOLEDO_CITY } = require('../../constants/toledoBarangays.json');
const { normalizeBranchDeliveryPricing } = require('../pricing/deliveryPricingService');
const { createHash, randomUUID } = require('node:crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { canonicalAccountStatus } = require('../auth/accountStatus');

const BRANCH_STATUS = new Set(['active', 'inactive']);
const MANAGER_STATUS = new Set(['active', 'inactive']);
const TOLEDO_BARANGAY_SET = new Set(TOLEDO_BARANGAYS);

const clean = (value, max = 160) => String(value || '').trim().slice(0, max);
const finiteCoordinate = (value, minimum, maximum) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
};
const branchIdForCode = (code) => clean(code, 24).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
const safeBranch = (id, data = {}) => {
  const pricing = normalizeBranchDeliveryPricing(data);
  return {
    id,
    name: clean(data.name), code: clean(data.code, 24), barangay: clean(data.barangay),
    city: clean(data.city) || TOLEDO_CITY, address: clean(data.address, 240), status: data.status === 'inactive' ? 'inactive' : 'active',
    active: data.status === 'inactive' ? false : data.active !== false,
    latitude: finiteCoordinate(data.latitude, -90, 90), longitude: finiteCoordinate(data.longitude, -180, 180),
    serviceRadiusKm: pricing.serviceRadiusKm,
    baseDeliveryFee: pricing.baseDeliveryFee,
    includedRadiusKm: pricing.includedRadiusKm,
    outsideRadiusFeePerKm: pricing.outsideRadiusFeePerKm,
    deliveryPricing: pricing,
    createdAt: data.createdAt || null, createdBy: data.createdBy || '', updatedAt: data.updatedAt || null, updatedBy: data.updatedBy || '',
  };
};
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
  for (const [field, max] of [['name', 120], ['barangay', 120], ['address', 240]]) {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) result[field] = clean(body[field], max);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'city')) {
    const requestedCity = clean(body.city, 120);
    if (requestedCity && requestedCity !== TOLEDO_CITY) {
      throw new OtpError(400, 'UNSUPPORTED_BRANCH_CITY', `BlueTap branches are currently limited to ${TOLEDO_CITY}.`);
    }
    result.city = TOLEDO_CITY;
  }
  if (result.barangay && !TOLEDO_BARANGAY_SET.has(result.barangay)) {
    throw new OtpError(400, 'INVALID_TOLEDO_BARANGAY', 'Choose a barangay from the approved Toledo City list.');
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = clean(body.status || 'active').toLowerCase();
    if (!BRANCH_STATUS.has(status)) throw new OtpError(400, 'INVALID_BRANCH_STATUS', 'Branch status must be active or inactive.');
    result.status = status;
    result.active = status === 'active';
  }
  if (!partial && (!result.name || !result.barangay || !result.city || !result.address)) {
    throw new OtpError(400, 'INVALID_BRANCH', 'Branch name and location details are required.');
  }
  const hasLatitude = Object.prototype.hasOwnProperty.call(body, 'latitude');
  const hasLongitude = Object.prototype.hasOwnProperty.call(body, 'longitude');
  if (!partial || hasLatitude || hasLongitude) {
    const latitude = finiteCoordinate(body.latitude, -90, 90);
    const longitude = finiteCoordinate(body.longitude, -180, 180);
    if (latitude === null || longitude === null) {
      throw new OtpError(400, 'INVALID_BRANCH_COORDINATES', 'Choose a valid branch location on the map.');
    }
    result.latitude = latitude;
    result.longitude = longitude;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'serviceRadiusKm')) {
    const radius = body.serviceRadiusKm === '' || body.serviceRadiusKm == null ? DEFAULT_SERVICE_RADIUS_KM : Number(body.serviceRadiusKm);
    if (!Number.isFinite(radius) || radius <= 0 || radius > 500) {
      throw new OtpError(400, 'INVALID_SERVICE_RADIUS', 'Service radius must be between 0 and 500 km.');
    }
    result.serviceRadiusKm = radius;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'baseDeliveryFee')) {
    const fee = body.baseDeliveryFee === '' || body.baseDeliveryFee == null ? 0 : Number(body.baseDeliveryFee);
    if (!Number.isFinite(fee) || fee < 0 || fee > 10000) {
      throw new OtpError(400, 'INVALID_DELIVERY_FEE', 'Base delivery fee must be a valid non-negative number.');
    }
    result.baseDeliveryFee = fee;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'includedRadiusKm')) {
    const included = body.includedRadiusKm === '' || body.includedRadiusKm == null ? (result.serviceRadiusKm || DEFAULT_SERVICE_RADIUS_KM) : Number(body.includedRadiusKm);
    if (!Number.isFinite(included) || included <= 0 || included > 500) {
      throw new OtpError(400, 'INVALID_INCLUDED_RADIUS', 'Included radius must be between 0 and 500 km.');
    }
    result.includedRadiusKm = included;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'outsideRadiusFeePerKm')) {
    const perKm = body.outsideRadiusFeePerKm === '' || body.outsideRadiusFeePerKm == null ? 10 : Number(body.outsideRadiusFeePerKm);
    if (!Number.isFinite(perKm) || perKm < 0 || perKm > 10000) {
      throw new OtpError(400, 'INVALID_OUTSIDE_RADIUS_FEE', 'Outside radius fee per km must be a valid non-negative number.');
    }
    result.outsideRadiusFeePerKm = perKm;
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

// Explicit, one-time Admin attestation. Raw physical identifiers are never
// stored or returned; claims prevent registering the same resource twice.
async function verifyDeliveryResources(db, admin, body) {
  const branchId = clean(body.branchId, 80);
  if (!branchId || branchId.includes('/') || body.branchId !== branchId) throw new OtpError(400, 'BRANCH_ID_REQUIRED', 'Choose a valid branch.');
  if (body.confirmedPhysicalInspection !== true || !Array.isArray(body.resourceIdentifiers) || body.resourceIdentifiers.length !== 2) throw new OtpError(400, 'RESOURCE_CONFIRMATION_REQUIRED', 'Confirm two inspected, distinct physical resources.');
  const identifiers = body.resourceIdentifiers.map((value) => typeof value === 'string' ? value.normalize('NFKC').trim().toUpperCase() : '');
  if (identifiers.some((value) => value.length < 3 || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) || identifiers[0] === identifiers[1]) throw new OtpError(400, 'INVALID_RESOURCE_IDENTITIES', 'Provide two distinct physical resource identifiers.');
  const fingerprints = identifiers.map((value) => createHash('sha256').update(`bluetap-delivery-resource-v1:${value}`).digest('hex'));
  const resourceIds = [randomUUID(), randomUUID()];
  const guardRef = db.collection('branchDeliveryResources').doc(branchId);
  const branchRef = db.collection('branches').doc(branchId);
  const adminRef = db.collection('users').doc(admin.uid);
  const claims = fingerprints.map((id) => db.collection('deliveryResourceClaims').doc(id));
  return db.runTransaction(async (tx) => {
    const [branch, actor, guard, ...claimSnapshots] = await Promise.all([tx.get(branchRef), tx.get(adminRef), tx.get(guardRef), ...claims.map((ref) => tx.get(ref))]);
    const profile = actor.data() || {};
    if (!actor.exists || profile.role !== 'admin' || profile.mustChangePassword === true || profile.accountActionHoldIntentId || canonicalAccountStatus(profile) !== 'active') throw new OtpError(403, 'ADMIN_REQUIRED', 'Administrator access has changed.');
    if (!branch.exists || branch.data()?.status !== 'active') throw new OtpError(409, 'BRANCH_INACTIVE', 'The selected branch is unavailable.');
    if (guard.exists) {
      const data = guard.data() || {}; const resources = data.resources;
      const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value && !value.includes('/');
      const occupied = Array.isArray(resources) ? resources.filter((item) => item?.tripId !== null) : [];
      if (data.schemaVersion !== 1 || data.initialized !== true || data.branchId !== branchId || !Number.isSafeInteger(data.revision) || data.revision < 0 || data.revision >= Number.MAX_SAFE_INTEGER - 1 || !Array.isArray(resources) || resources.length !== 2 || new Set(resources.map((item) => item?.id)).size !== 2 || new Set(resources.map((item) => item?.fingerprint)).size !== 2 || new Set(occupied.map((item) => item?.tripId)).size !== occupied.length || new Set(occupied.map((item) => item?.distributorUid)).size !== occupied.length || resources.some((item) => !item || !validId(item.id) || item.verified !== true || !fingerprints.includes(item.fingerprint) || !((item.tripId === null && item.distributorUid === null) || (validId(item.tripId) && validId(item.distributorUid)))) || claimSnapshots.some((snap, i) => !snap.exists || snap.data()?.branchId !== branchId || snap.data()?.resourceId !== resources.find((item) => item.fingerprint === fingerprints[i])?.id)) throw new OtpError(409, 'RESOURCE_RECONCILIATION_REQUIRED', 'Delivery resource records require reconciliation.');
      return { resources: resources.map((item) => ({ id: item.id, status: item.tripId === null ? 'available' : 'occupied' })), unchanged: true };
    }
    if (body.confirmedResourcesUnoccupied !== true) throw new OtpError(400, 'RESOURCE_CONFIRMATION_REQUIRED', 'Confirm that both resources are currently unoccupied.');
    if (claimSnapshots.some((snap) => snap.exists)) throw new OtpError(409, 'RESOURCE_ALREADY_REGISTERED', 'A delivery resource is already registered or needs reconciliation.');
    const resources = fingerprints.map((fingerprint, index) => ({ id: resourceIds[index], fingerprint, verified: true, tripId: null, distributorUid: null }));
    tx.create(guardRef, { schemaVersion: 1, initialized: true, branchId, revision: 0, resources, verifiedBy: admin.uid, verifiedAt: FieldValue.serverTimestamp() });
    claims.forEach((ref, index) => tx.create(ref, { branchId, resourceId: resourceIds[index], verifiedBy: admin.uid, verifiedAt: FieldValue.serverTimestamp() }));
    tx.create(db.collection('adminAuditLogs').doc(), { action: 'DELIVERY_RESOURCES_VERIFIED', branchId, adminUid: admin.uid, resourceIds, createdAt: FieldValue.serverTimestamp() });
    return { resources: resources.map((item) => ({ id: item.id, status: 'available' })), unchanged: false };
  });
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
      if (req.method === 'PATCH' && body.action === 'verify-delivery-resources') {
        const result = await verifyDeliveryResources(db, admin, body);
        return res.status(200).json(result);
      }
      if (req.method === 'POST') {
        const code = clean(body.code, 24).toUpperCase();
        const branchId = branchIdForCode(code);
        if (!branchId || !/^[A-Z0-9_-]{2,24}$/.test(code)) throw new OtpError(400, 'INVALID_BRANCH_CODE', 'Use 2-24 letters, numbers, underscores, or hyphens for the branch code.');
        const ref = db.collection('branches').doc(branchId);
        const existing = await ref.get();
        if (existing.exists) throw new OtpError(409, 'BRANCH_CODE_EXISTS', 'That branch code is already in use.');
        const now = new Date();
        const saved = { ...branchInput(body), code, createdAt: now, createdBy: admin.uid, updatedAt: now, updatedBy: admin.uid };
        const canonicalPricing = normalizeBranchDeliveryPricing(saved);
        canonicalPricing.updatedAt = now;
        canonicalPricing.updatedBy = admin.uid;
        saved.deliveryPricing = canonicalPricing;
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
      const pricingKeys = ['baseDeliveryFee', 'includedRadiusKm', 'outsideRadiusFeePerKm', 'serviceRadiusKm'];
      if (pricingKeys.some((k) => Object.prototype.hasOwnProperty.call(changes, k))) {
        const canonicalPricing = normalizeBranchDeliveryPricing({
          ...current.data(),
          ...changes,
        });
        canonicalPricing.updatedAt = now;
        canonicalPricing.updatedBy = admin.uid;
        changes.deliveryPricing = canonicalPricing;
      }
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
