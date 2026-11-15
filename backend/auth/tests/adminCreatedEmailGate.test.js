const test = require('node:test');
const assert = require('node:assert/strict');
const { requireRequester, requireActiveDistributor, requireActiveManager } = require('../authorization');

function fixture(role, {
  emailVerified = false,
  tokenEmail = 'person@example.test',
  profileEmail = 'person@example.test',
  source = 'admin_created',
  profileOverrides = {},
  otpDoc = null,
} = {}) {
  const uid = 'account-1';
  const profile = {
    role, accountStatus: 'active', accountSource: source, email: profileEmail,
    ...(role === 'manager' ? { managerStatus: 'active', branchId: 'branch-1' } : {}),
    ...(role === 'distributor' ? { distributorStatus: 'active', branchId: 'branch-1' } : {}),
    ...profileOverrides,
  };
  const auth = {
    verifyIdToken: async () => ({ uid, role, manager: role === 'manager', email: tokenEmail, email_verified: emailVerified }),
    getUser: async () => ({ uid, disabled: false }),
  };
  const db = { collection(name) {
    return { doc: (id) => ({ id, get: async () => ({
      exists: name === 'emailOtpVerifications' ? Boolean(otpDoc) : true,
      id,
      data: () => name === 'users' ? profile : (name === 'emailOtpVerifications' ? otpDoc : { status: 'active' }),
    }) }) };
  } };
  return { req: { headers: { authorization: 'Bearer token' } }, auth, db };
}

test('Admin-created operational roles require verified Auth email matching their canonical profile', async () => {
  for (const [role, guard] of [
    ['requester', requireRequester],
    ['distributor', requireActiveDistributor],
    ['manager', requireActiveManager],
  ]) {
    for (const options of [
      { emailVerified: false },
      { emailVerified: true, tokenEmail: 'other@example.test' },
      { emailVerified: true, profileEmail: 'other@example.test' },
      { emailVerified: true, profileOverrides: { emailVerified: false } },
      { emailVerified: true, profileOverrides: { emailOtpVerification: { status: 'reconciliation-failed', profileSynced: false } } },
      { emailVerified: true, otpDoc: { status: 'reconciliation-failed', profileSynced: false } },
    ]) {
      await assert.rejects(guard(...Object.values(fixture(role, options))),
        (error) => error.reason === 'EMAIL_VERIFICATION_REQUIRED', `${role} should fail closed`);
    }
    const allowed = await guard(...Object.values(fixture(role, { emailVerified: true })));
    assert.equal(allowed.profile.role, role);
    const allowedSynced = await guard(...Object.values(fixture(role, {
      emailVerified: true,
      profileOverrides: { emailVerified: true, emailOtpVerification: { status: 'verified', profileSynced: true } },
      otpDoc: { status: 'consumed', profileSynced: true },
    })));
    assert.equal(allowedSynced.profile.role, role);
  }
});

test('legacy Admin-created profiles without the new verification flag remain protected', async () => {
  const f = fixture('requester');
  await assert.rejects(requireRequester(f.req, f.auth, f.db),
    (error) => error.reason === 'EMAIL_VERIFICATION_REQUIRED');
});
