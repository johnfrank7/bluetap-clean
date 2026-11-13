const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createEmailOtpService } = require('../emailOtp');

const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap'
  && /^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
  && /^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '');

test('emulators reconcile OTP profiles and enforce first-password-change for each role', { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: 'demo-bluetap' }, `otp-compat-${randomUUID()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  try {
    for (const role of ['requester', 'distributor', 'manager']) {
      const uid = `compat-${role}-${randomUUID()}`;
      const email = `${uid}@example.test`;
      await auth.createUser({ uid, email, password: 'isolated-emulator-password', emailVerified: false });
      const ref = db.collection('users').doc(uid);
      await ref.set({ uid, email, role, accountSource: 'admin_created', accountStatus: 'active',
        emailVerificationRequired: true, emailVerified: false, mustChangePassword: role !== 'requester',
        distributorStatus: 'active', managerStatus: 'active', branchId: 'test-branch',
        emailOtpVerification: { required: true, status: 'reconciliation-failed', profileSynced: false } });
      let sentCode;
      const service = createEmailOtpService({ auth, db, hashSecret: 'emulator-test-only-key',
        sendEmailOtp: async ({ code }) => { sentCode = code; } });
      if (role !== 'requester') {
        await assert.rejects(service.request(uid), (error) => error.reason === 'PASSWORD_CHANGE_REQUIRED');
        assert.equal(sentCode, undefined);
        await ref.update({ mustChangePassword: false });
      }
      await service.request(uid);
      await assert.rejects(service.verify(uid, '000000'), (error) => error.reason === 'incorrect-code');
      assert.equal((await auth.getUser(uid)).emailVerified, false);
      assert.deepEqual(await service.verify(uid, sentCode), { verified: true });
      assert.equal((await auth.getUser(uid)).emailVerified, true);
      const profile = (await ref.get()).data();
      assert.equal(profile.emailVerified, true);
      assert.equal(profile.emailOtpVerification.status, 'verified');
      assert.equal(profile.emailOtpVerification.profileSynced, true);
      assert.equal((await db.collection('emailOtpVerifications').doc(uid).get()).data().profileSynced, true);
      sentCode = undefined;
      assert.deepEqual(await service.request(uid), { alreadyVerified: true });
      assert.equal(sentCode, undefined);
    }
  } finally {
    await deleteApp(app);
  }
});
