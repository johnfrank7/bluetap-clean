const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { OtpError } = require('../utils/otpError');
const { applyCors } = require('../utils/cors');
const { bearerToken, requireAdmin } = require('../auth/authorization');
const {
  CONFIG_PATH,
  PUBLIC_CONFIG_PATH,
  loadRegistrationSecurity,
  normalizeRegistrationSecurity,
  publicRegistrationPolicy,
  validateRegistrationSecurity,
} = require('../registration/registrationSecurity');

const sanitized = (config) => ({
  faceVerificationEnabled: config.faceVerificationEnabled,
  emailOtpEnabled: config.emailOtpEnabled,
  maxAccountsPerDevice: config.maxAccountsPerDevice,
  maxAccountsPerIp: config.maxAccountsPerIp,
  sessionSecurity: config.sessionSecurity,
  version: config.version,
});

function createAdminRegistrationSecurityHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'PATCH', 'POST'].includes(req.method)) {
      return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or PATCH.' } });
    }
    try {
      const { auth, db } = getAdmin();
      const admin = await requireAdmin(req, auth, db);
      if (req.method === 'GET') {
        return res.status(200).json(sanitized(await loadRegistrationSecurity(db)));
      }
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body || '{}'); }
        catch { throw new OtpError(400, 'INVALID_REGISTRATION_SECURITY_CONFIG', 'Registration security settings are invalid.'); }
      }
      if (body && typeof body === 'object' && body.action) {
        const action = String(body.action).trim();
        if (action === 'revokeOtherSessions' || action === 'signOutOtherDevices') {
          throw new OtpError(
            400,
            'SELECTIVE_REVOCATION_UNSUPPORTED',
            'Selective other-session revocation is not supported. Use signOutAllSessions to revoke all active sessions.'
          );
        }
        if (['signOutAllSessions', 'revokeAllSessions', 'revokeAdminSessions'].includes(action)) {
          const targetUid = String(body.targetUid || body.uid || '').trim();
          if (targetUid && targetUid !== admin.uid) {
            throw new OtpError(
              403,
              'UNAUTHORIZED_TARGET',
              'You can only revoke sessions for your own administrator account.'
            );
          }

          const clientRequestId = body.clientRequestId ? String(body.clientRequestId).trim() : null;
          if (clientRequestId) {
            const auditDocs = await db.collection('adminAuditLogs')
              .where('actorUid', '==', admin.uid)
              .where('clientRequestId', '==', clientRequestId)
              .limit(1)
              .get();
            if (auditDocs && !auditDocs.empty) {
              const prev = auditDocs.docs[0].data();
              return res.status(200).json({
                ok: true,
                action: 'signOutAllSessions',
                revoked: true,
                uid: admin.uid,
                revokedAt: prev.createdAt?.toISOString?.() || new Date().toISOString(),
                deduplicated: true,
              });
            }
          }

          await auth.revokeRefreshTokens(admin.uid);

          const now = new Date();
          const auditRef = db.collection('adminAuditLogs').doc();
          await auditRef.set({
            action: 'ADMIN_SESSIONS_REVOKED',
            actorUid: admin.uid,
            actorRole: 'admin',
            targetUid: admin.uid,
            targetRole: 'admin',
            clientRequestId,
            reason: body.reason ? String(body.reason).trim().slice(0, 240) : 'Administrator requested all sessions revocation from Security Settings',
            createdAt: now,
          });

          return res.status(200).json({
            ok: true,
            action: 'signOutAllSessions',
            revoked: true,
            uid: admin.uid,
            revokedAt: now.toISOString(),
          });
        }
        throw new OtpError(400, 'INVALID_SECURITY_ACTION', 'Unsupported security action.');
      }
      const next = validateRegistrationSecurity(body);
      const configRef = db.collection(CONFIG_PATH[0]).doc(CONFIG_PATH[1]);
      const publicConfigRef = db.collection(PUBLIC_CONFIG_PATH[0]).doc(PUBLIC_CONFIG_PATH[1]);
      const auditRef = db.collection('adminAuditLogs').doc();
      const savedConfig = await db.runTransaction(async (tx) => {
        const currentSnapshot = await tx.get(configRef);
        const before = currentSnapshot.exists
          ? normalizeRegistrationSecurity(currentSnapshot.data())
          : normalizeRegistrationSecurity(null);
        const saved = { ...next, version: before.version + 1, updatedAt: new Date(), updatedBy: admin.uid };
        tx.set(configRef, saved);
        tx.set(publicConfigRef, { ...publicRegistrationPolicy(saved), updatedAt: saved.updatedAt });
        tx.set(auditRef, {
          action: 'REGISTRATION_SECURITY_UPDATED',
          actorUid: admin.uid,
          previousFaceVerificationEnabled: before.faceVerificationEnabled,
          newFaceVerificationEnabled: saved.faceVerificationEnabled,
          previousEmailOtpEnabled: before.emailOtpEnabled,
          newEmailOtpEnabled: saved.emailOtpEnabled,
          previousMaxAccountsPerDevice: before.maxAccountsPerDevice,
          newMaxAccountsPerDevice: saved.maxAccountsPerDevice,
          previousMaxAccountsPerIp: before.maxAccountsPerIp,
          newMaxAccountsPerIp: saved.maxAccountsPerIp,
          previousSessionSecurity: before.sessionSecurity,
          newSessionSecurity: saved.sessionSecurity,
          createdAt: new Date(),
        });
        return saved;
      });
      return res.status(200).json(sanitized(savedConfig));
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 500).json({ error: {
        reason: known ? error.reason : 'service-unavailable',
        message: known ? error.message : 'Registration security settings are temporarily unavailable.',
      } });
    }
  };
}

module.exports = { bearerToken, createAdminRegistrationSecurityHandler, requireAdmin };
