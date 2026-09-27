const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireActiveManager } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { generateNextPublicUid, formatPublicUid, parsePublicUidNumber } = require('../utils/publicUidGenerator');
const { normalizePhilippinePhone } = require('../utils/phoneUtils');
const { createSupabaseAvatarStorage, decodeAvatarImage } = require('../services/supabaseAvatarStorage');

const ALLOWED_PROFILE_FIELDS = new Set(['fullName', 'phone', 'address', 'imageUpload']);
const clean = (value, max = 160) => String(value || '').trim().slice(0, max);

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); } catch {
    throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.');
  }
}

function safeManagerProfile(uid, data = {}) {
  const publicUid = clean(data.publicUid || data.displayUid || data.unique_id, 80);
  return {
    uid,
    role: 'manager',
    publicUid: publicUid || null,
    displayUid: publicUid || null,
    fullName: clean(data.fullName || `${data.firstName || ''} ${data.lastName || ''}`),
    email: clean(data.email, 254).toLowerCase(),
    phone: clean(data.phone || data.contactNumber, 40),
    address: clean(data.address || data.location || data.completeAddress, 300),
    profilePhotoUrl: clean(data.profilePhotoUrl, 2048),
    profilePhotoPath: clean(data.profilePhotoPath, 300),
    branchId: clean(data.branchId, 80),
    managerStatus: clean(data.managerStatus, 30),
  };
}

async function ensureManagerPublicUid(db, uid) {
  const userRef = db.collection('users').doc(uid);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(userRef);
    if (!snapshot.exists || snapshot.data()?.role !== 'manager') {
      throw new OtpError(403, 'MANAGER_REQUIRED', 'Manager access is required.');
    }
    const profile = snapshot.data() || {};
    const existing = profile.publicUid || profile.displayUid || profile.unique_id || '';
    const existingNumber = parsePublicUidNumber('manager', existing);
    const publicUid = existingNumber > 0
      ? formatPublicUid('manager', existingNumber)
      : await generateNextPublicUid(tx, db, 'manager');
    const needsUpdate = profile.publicUid !== publicUid || profile.displayUid !== publicUid;
    if (needsUpdate) {
      tx.set(userRef, {
        publicUid,
        displayUid: publicUid,
        ...(!profile.unique_id ? { unique_id: publicUid } : {}),
        updatedAt: new Date(),
      }, { merge: true });
    }
    return { ...profile, publicUid, displayUid: publicUid };
  });
}

function validateProfileChanges(body) {
  const keys = Object.keys(body || {});
  const forbidden = keys.filter((key) => !ALLOWED_PROFILE_FIELDS.has(key));
  if (forbidden.length) {
    throw new OtpError(400, 'PROFILE_FIELDS_NOT_ALLOWED', 'Only personal profile fields can be changed.');
  }
  const changes = {};
  if (Object.prototype.hasOwnProperty.call(body, 'fullName')) {
    const fullName = clean(body.fullName, 160);
    if (!fullName) throw new OtpError(400, 'FULL_NAME_REQUIRED', 'Full name is required.');
    const [firstName, ...lastName] = fullName.split(/\s+/);
    Object.assign(changes, { fullName, firstName, lastName: lastName.join(' ') });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    const phone = normalizePhilippinePhone(body.phone);
    if (!phone) throw new OtpError(400, 'INVALID_PHONE', 'Enter a valid Philippine mobile number.');
    changes.phone = phone;
    changes.contactNumber = phone;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'address')) {
    const address = clean(body.address, 300);
    if (!address) throw new OtpError(400, 'ADDRESS_REQUIRED', 'Complete address is required.');
    changes.address = address;
  }
  return changes;
}

function responseError(res, error) {
  const known = error instanceof OtpError;
  return res.status(known ? error.status : 500).json({ error: {
    reason: known ? error.reason : 'service-unavailable',
    message: known ? error.message : 'Manager profile is temporarily unavailable.',
    ...(known && error.details?.field ? { fieldErrors: { [error.details.field]: error.message } } : {}),
  } });
}

function createManagerProfileHandler(getAdmin = getFirebaseAdmin, { avatarStorage = createSupabaseAvatarStorage() } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'PATCH'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or PATCH.' } });
    try {
      const { auth, db } = getAdmin();
      const manager = await requireActiveManager(req, auth, db);
      let profile = await ensureManagerPublicUid(db, manager.decoded.uid);
      if (req.method === 'GET') return res.status(200).json({ profile: safeManagerProfile(manager.decoded.uid, profile) });

      const body = bodyOf(req);
      const changes = validateProfileChanges(body);
      const image = body.imageUpload ? decodeAvatarImage(body.imageUpload) : null;
      if (!Object.keys(changes).length && !image) throw new OtpError(400, 'NO_PROFILE_CHANGES', 'No profile changes were provided.');

      let uploaded = null;
      try {
        if (image) uploaded = await avatarStorage.uploadAvatar(manager.decoded.uid, image);
        const nextChanges = {
          ...changes,
          ...(uploaded ? {
            profilePhotoUrl: uploaded.profilePhotoUrl,
            profilePhotoPath: uploaded.profilePhotoPath,
            profilePhotoStorageProvider: 'supabase',
          } : {}),
          updatedAt: new Date(),
        };
        await db.collection('users').doc(manager.decoded.uid).set(nextChanges, { merge: true });
        if (uploaded && profile.profilePhotoPath) {
          await avatarStorage.deleteAvatar(profile.profilePhotoPath, manager.decoded.uid).catch(() => {});
        }
        profile = { ...profile, ...nextChanges };
      } catch (error) {
        if (uploaded) await avatarStorage.deleteAvatar(uploaded.profilePhotoPath, manager.decoded.uid).catch(() => {});
        throw error;
      }
      return res.status(200).json({ profile: safeManagerProfile(manager.decoded.uid, profile) });
    } catch (error) { return responseError(res, error); }
  };
}

module.exports = {
  ALLOWED_PROFILE_FIELDS,
  createManagerProfileHandler,
  ensureManagerPublicUid,
  safeManagerProfile,
  validateProfileChanges,
};
