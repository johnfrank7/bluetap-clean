const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const {
  CONFIG_PATH,
  loadMaintenanceOverview,
  loadRetentionPolicy,
  normalizeRetentionPolicy,
  previewCleanup,
  runCleanup,
  validateRetentionPolicy,
} = require('./systemMaintenance');

function bodyOf(req) {
  if (typeof req.body !== 'string') return req.body || {};
  try { return JSON.parse(req.body || '{}'); }
  catch { throw new OtpError(400, 'INVALID_MAINTENANCE_REQUEST', 'System Maintenance request is invalid.'); }
}

function sanitizedPolicy(policy) {
  return {
    notificationRetentionDays: policy.notificationRetentionDays,
    incompleteRegistrationRetentionHours: policy.incompleteRegistrationRetentionHours,
    verificationRetentionHours: policy.verificationRetentionHours,
    rateLimitRetentionDays: policy.rateLimitRetentionDays,
    completedOrderArchiveDays: policy.completedOrderArchiveDays,
    version: policy.version,
  };
}

async function saveRetentionPolicy(db, actorUid, input) {
  const validated = validateRetentionPolicy(input);
  const configRef = db.collection(CONFIG_PATH[0]).doc(CONFIG_PATH[1]);
  const auditRef = db.collection('adminAuditLogs').doc();
  return db.runTransaction(async (tx) => {
    const currentSnapshot = await tx.get(configRef);
    const currentDocument = currentSnapshot.exists ? currentSnapshot.data() || {} : {};
    const previous = normalizeRetentionPolicy(currentDocument);
    const saved = {
      ...validated,
      version: previous.version + 1,
      updatedAt: new Date(),
      updatedBy: actorUid,
    };
    tx.set(configRef, { ...saved, ...(currentDocument.lastCleanup ? { lastCleanup: currentDocument.lastCleanup } : {}) });
    tx.set(auditRef, {
      action: 'DATA_RETENTION_POLICY_UPDATED',
      actorUid,
      previousPolicy: sanitizedPolicy(previous),
      newPolicy: sanitizedPolicy(saved),
      createdAt: new Date(),
    });
    return saved;
  });
}

function rejectUnsupportedScope(body) {
  if ('categories' in body || 'category' in body || 'collection' in body) {
    throw new OtpError(400, 'UNSUPPORTED_CLEANUP_CATEGORY', 'Cleanup categories are selected by the server.');
  }
}

function createAdminSystemMaintenanceHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'PATCH', 'POST'].includes(req.method)) {
      return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET, PATCH, or POST.' } });
    }
    try {
      const { auth, db } = getAdmin();
      const admin = await requireAdmin(req, auth, db);
      if (req.method === 'GET') return res.status(200).json(await loadMaintenanceOverview(db));

      const body = bodyOf(req);
      rejectUnsupportedScope(body);
      const action = req.method === 'PATCH' ? 'save-policy' : String(body.action || '');
      if (action === 'save-policy') {
        return res.status(200).json({ policy: sanitizedPolicy(await saveRetentionPolicy(db, admin.uid, body.policy || body)) });
      }
      if (action === 'preview') {
        const policy = await loadRetentionPolicy(db);
        return res.status(200).json(await previewCleanup(db, policy));
      }
      if (action === 'run') {
        const policy = await loadRetentionPolicy(db);
        return res.status(200).json(await runCleanup(db, policy, admin.uid));
      }
      throw new OtpError(400, 'INVALID_MAINTENANCE_ACTION', 'Choose a supported System Maintenance action.');
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 500).json({ error: {
        reason: known ? error.reason : 'service-unavailable',
        message: known ? error.message : 'System Maintenance is temporarily unavailable.',
      } });
    }
  };
}

module.exports = { createAdminSystemMaintenanceHandler, saveRetentionPolicy };
