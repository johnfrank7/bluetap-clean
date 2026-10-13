const { ACCOUNT_STATUS, canonicalAccountStatus } = require('./accountStatus');
const { OtpError } = require('../utils/otpError');

/**
 * Firebase Auth / Firestore account-state consistency.
 *
 * Firebase Auth and Firestore cannot be committed atomically. BlueTap therefore
 * treats Firestore `users/{uid}.accountStatus` as the single authoritative
 * commit point and Firebase Auth `disabled` as a follow-up side effect:
 *
 * 1. Status transitions commit to Firestore first (inside a transaction that
 *    re-checks the current status).
 * 2. Firebase Auth is then converged to a FRESH authoritative read.
 *
 * Every intermediate state is fail-closed:
 * - Firestore non-active + Auth still enabled: every backend guard and every
 *   Firestore rule denies access because both read canonical accountStatus.
 * - Firestore active + Auth still disabled: the user cannot obtain a token.
 *
 * Firebase Auth is never enabled unless a fresh authoritative read says the
 * account is active, and the only compensation ever applied is restrictive
 * (disable + revoke). There is no automatic re-enablement in error paths.
 */

const authShouldBeDisabled = (status) => status !== ACCOUNT_STATUS.ACTIVE;

function describeAuthConsistency(profile = {}, authUser = null) {
  const accountStatus = canonicalAccountStatus(profile);
  if (!authUser || typeof authUser !== 'object') return { accountStatus, authDisabled: null, consistent: null };
  const authDisabled = authUser.disabled === true;
  return { accountStatus, authDisabled, consistent: authDisabled === authShouldBeDisabled(accountStatus) };
}

async function readAuthoritativeAccountStatus(db, uid) {
  const snapshot = await db.collection('users').doc(uid).get();
  if (!snapshot.exists) throw new OtpError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
  const data = typeof snapshot.data === 'function' ? snapshot.data() : (snapshot.data || {});
  return canonicalAccountStatus(data);
}

function authSyncFailure(committedAccountStatus, stage) {
  const message = committedAccountStatus === ACCOUNT_STATUS.ACTIVE
    ? 'The account is saved as active, but Firebase sign-in could not be re-enabled. The user still cannot sign in. Retry Reactivate to finish.'
    : `The account is saved as ${committedAccountStatus} and BlueTap access is blocked, but Firebase sign-in could not be fully disabled. Retry the same action to finish.`;
  return new OtpError(502, 'ACCOUNT_AUTH_SYNC_FAILED', message, { committedAccountStatus, stage, authSynced: false });
}

function stateChanged(committedAccountStatus, authSynced) {
  return new OtpError(
    409,
    'ACCOUNT_STATE_CHANGED',
    'This account was changed by another action while your request was processing. Refresh to review its current status.',
    { committedAccountStatus, authSynced },
  );
}

async function step(committedAccountStatus, stage, run) {
  try {
    return await run();
  } catch {
    throw authSyncFailure(committedAccountStatus, stage);
  }
}

async function disableAndRevoke(auth, uid, committedAccountStatus) {
  await step(committedAccountStatus, 'auth_disable', () => auth.updateUser(uid, { disabled: true }));
  await step(committedAccountStatus, 'auth_revoke', () => auth.revokeRefreshTokens(uid));
}

/**
 * Converges Firebase Auth to the authoritative Firestore status, but only when
 * that status still equals `expectedStatus`. If another action changed the
 * account in the meantime, Auth is left to that action and 409 is returned.
 */
async function syncAuthWithAccountStatus({ auth, db, uid, expectedStatus }) {
  let status;
  try {
    status = await readAuthoritativeAccountStatus(db, uid);
  } catch (error) {
    if (error instanceof OtpError) throw error;
    throw authSyncFailure(expectedStatus, 'verify');
  }
  if (status !== expectedStatus) throw stateChanged(status, false);

  if (authShouldBeDisabled(status)) {
    await disableAndRevoke(auth, uid, status);
    return { accountStatus: status, authDisabled: true };
  }

  await step(status, 'auth_enable', () => auth.updateUser(uid, { disabled: false }));
  let verified;
  try {
    verified = await readAuthoritativeAccountStatus(db, uid);
  } catch {
    // Auth was enabled from a fresh active read; every protected path still
    // re-checks Firestore, so an unverifiable read remains fail-closed.
    throw authSyncFailure(status, 'verify');
  }
  if (verified !== ACCOUNT_STATUS.ACTIVE) {
    // A restriction committed concurrently. Restrictive compensation only.
    await disableAndRevoke(auth, uid, verified);
    throw stateChanged(verified, true);
  }
  return { accountStatus: ACCOUNT_STATUS.ACTIVE, authDisabled: false };
}

/**
 * Retry-time repair: reads Firebase Auth, and only when it disagrees with an
 * authoritative status that still equals `expectedStatus`, converges it.
 * Returns whether drift was found. Requires `auth.getUser`.
 */
async function repairAuthDriftIfPresent({ auth, db, uid, expectedStatus }) {
  if (typeof auth.getUser !== 'function') return { checked: false, repaired: false };
  const [profileSnapshot, authUser] = await Promise.all([
    db.collection('users').doc(uid).get(),
    auth.getUser(uid).catch(() => null),
  ]);
  if (!profileSnapshot.exists || !authUser) return { checked: false, repaired: false };
  const profileData = typeof profileSnapshot.data === 'function' ? profileSnapshot.data() : (profileSnapshot.data || {});
  const state = describeAuthConsistency(profileData, authUser);
  if (state.consistent !== false || state.accountStatus !== expectedStatus) return { checked: true, repaired: false };
  await syncAuthWithAccountStatus({ auth, db, uid, expectedStatus });
  return { checked: true, repaired: true };
}

module.exports = {
  authShouldBeDisabled,
  describeAuthConsistency,
  readAuthoritativeAccountStatus,
  repairAuthDriftIfPresent,
  syncAuthWithAccountStatus,
};
