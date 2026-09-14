#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const readline = require('node:readline/promises');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const EXPECTED_PROJECT = 'bluetap-8c98d';
const CANONICAL_USERNAME = 'bluetapadmin';
const CONFIRMATION = 'RESET BLUETAP SUPER ADMIN';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeUsername = (value) => String(value || '').trim().toLowerCase();
const hasAdminClaim = (user) => user?.customClaims?.admin === true || user?.customClaims?.role === 'admin';
const isProvenAdmin = (user, profile) => Boolean(user && profile?.role === 'admin' && hasAdminClaim(user));

function loadAdmin() {
  const path = String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  if (!path) throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH is required.');
  const account = JSON.parse(readFileSync(path, 'utf8'));
  if (account.project_id !== EXPECTED_PROJECT) {
    throw new Error(`Refusing reset: Firebase project must be exactly ${EXPECTED_PROJECT}.`);
  }
  const app = getApps().find((candidate) => candidate.name === 'bluetap-super-admin-reset') ||
    initializeApp({ credential: cert(account), projectId: account.project_id }, 'bluetap-super-admin-reset');
  if (app.options.projectId !== EXPECTED_PROJECT) throw new Error('Refusing reset: initialized Firebase project mismatch.');
  return { auth: getAuth(app), db: getFirestore(app) };
}

async function hiddenPassword(promptText) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('A local interactive TTY is required for hidden password entry.');
  }
  process.stdout.write(promptText);
  process.stdin.setEncoding('utf8');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let password = '';
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
      error ? reject(error) : resolve(password);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') return finish(new Error('Reset cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') password = password.slice(0, -1);
        else if (character >= ' ') password += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function getUserByEmailOrNull(auth, email) {
  try { return await auth.getUserByEmail(email); }
  catch (error) {
    if (error?.code === 'auth/user-not-found') return null;
    throw error;
  }
}

async function inspectResetTargets(auth, db, email) {
  const selectedUser = await getUserByEmailOrNull(auth, email);
  const selectedSnapshot = selectedUser ? await db.collection('users').doc(selectedUser.uid).get() : null;
  const selectedProfile = selectedSnapshot?.data() || null;
  if (selectedUser && !isProvenAdmin(selectedUser, selectedProfile)) {
    throw new Error('Refusing reset: the selected email belongs to an account not proven to be Admin by both claim and profile.');
  }

  const usernameSnapshot = await db.collection('usernames').doc(CANONICAL_USERNAME).get();
  const usernameOwnerUid = usernameSnapshot.data()?.uid || '';
  let staleOwner = null;
  let staleOwnerProfile = null;
  if (usernameOwnerUid && usernameOwnerUid !== selectedUser?.uid) {
    staleOwner = await auth.getUser(usernameOwnerUid).catch(() => null);
    const staleSnapshot = await db.collection('users').doc(usernameOwnerUid).get();
    staleOwnerProfile = staleSnapshot.data() || null;
    if (!isProvenAdmin(staleOwner, staleOwnerProfile) ||
        normalizeUsername(staleOwnerProfile.usernameNormalized || staleOwnerProfile.normalizedUsername || staleOwnerProfile.username) !== CANONICAL_USERNAME) {
      throw new Error('Refusing reset: bluetapadmin is owned by an identity that is not a safely identifiable prior Super Admin.');
    }
  }
  return { selectedUser, selectedProfile, usernameSnapshot, staleOwner, staleOwnerProfile };
}

async function resetSuperAdmin({ auth, db, email, password, inspected }) {
  const now = Timestamp.now();
  const { selectedUser, selectedProfile, staleOwner, staleOwnerProfile } = inspected;

  if (staleOwner) {
    await auth.revokeRefreshTokens(staleOwner.uid);
    await auth.deleteUser(staleOwner.uid);
  }

  let adminUser = selectedUser;
  if (adminUser) {
    await auth.revokeRefreshTokens(adminUser.uid);
    adminUser = await auth.updateUser(adminUser.uid, {
      email,
      password,
      emailVerified: true,
      disabled: false,
      displayName: CANONICAL_USERNAME,
    });
  } else {
    adminUser = await auth.createUser({
      email,
      password,
      emailVerified: true,
      disabled: false,
      displayName: CANONICAL_USERNAME,
    });
  }

  // This is the canonical claim shape used by the current BlueTap guards.
  await auth.setCustomUserClaims(adminUser.uid, { role: 'admin', admin: true });

  const oldUsernameKeys = new Set([CANONICAL_USERNAME]);
  for (const profile of [selectedProfile, staleOwnerProfile]) {
    const oldName = normalizeUsername(profile?.usernameNormalized || profile?.normalizedUsername || profile?.username);
    if (oldName) oldUsernameKeys.add(oldName);
  }
  const retiredUids = new Set([selectedUser?.uid, staleOwner?.uid].filter(Boolean));

  await db.runTransaction(async (tx) => {
    const usernameRecords = [];
    for (const oldUsername of oldUsernameKeys) {
      const ref = db.collection('usernames').doc(oldUsername);
      const snapshot = await tx.get(ref);
      usernameRecords.push({ ref, snapshot });
    }
    for (const { ref, snapshot } of usernameRecords) {
      if (snapshot.exists && retiredUids.has(snapshot.data()?.uid)) tx.delete(ref);
    }
    if (staleOwner) tx.delete(db.collection('users').doc(staleOwner.uid));
    if (selectedUser && selectedUser.uid !== adminUser.uid) tx.delete(db.collection('users').doc(selectedUser.uid));

    tx.set(db.collection('users').doc(adminUser.uid), {
      uid: adminUser.uid,
      username: CANONICAL_USERNAME,
      usernameNormalized: CANONICAL_USERNAME,
      normalizedUsername: CANONICAL_USERNAME,
      email,
      role: 'admin',
      status: 'active',
      approvalStatus: 'approved',
      registrationCompleted: true,
      onboardingStatus: 'complete',
      emailVerified: true,
      mustChangePassword: false,
      createdAt: selectedProfile?.createdAt || now,
      updatedAt: now,
    });
    tx.set(db.collection('usernames').doc(CANONICAL_USERNAME), {
      uid: adminUser.uid,
      createdAt: inspected.usernameSnapshot.data()?.createdAt || now,
      updatedAt: now,
    });
  });

  // Revoke once after the final claim write. The next credential sign-in is
  // guaranteed to establish the only accepted fresh browser session.
  await auth.revokeRefreshTokens(adminUser.uid);

  const verifiedUser = await auth.getUser(adminUser.uid);
  const verifiedProfile = await db.collection('users').doc(adminUser.uid).get();
  const verifiedUsername = await db.collection('usernames').doc(CANONICAL_USERNAME).get();
  if (!isProvenAdmin(verifiedUser, verifiedProfile.data()) || verifiedUsername.data()?.uid !== adminUser.uid) {
    throw new Error('Reset verification failed: Admin Auth, claim, profile, and username mapping do not agree.');
  }
  return adminUser.uid;
}

async function main() {
  const { auth, db } = loadAdmin();
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  let email;
  let username;
  try {
    email = normalizeEmail(await prompt.question('Admin email: '));
    username = normalizeUsername(await prompt.question(`Admin username (${CANONICAL_USERNAME}): `) || CANONICAL_USERNAME);
  } finally {
    prompt.close();
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('A valid Admin email is required.');
  if (username !== CANONICAL_USERNAME) throw new Error(`The canonical Super Admin username must be ${CANONICAL_USERNAME}.`);

  const inspected = await inspectResetTargets(auth, db, email);
  console.log('Safe reset plan:');
  console.log(`- Firebase project: ${EXPECTED_PROJECT}`);
  console.log(`- Selected Admin exists: ${Boolean(inspected.selectedUser)}`);
  console.log(`- Prior bluetapadmin identity will be retired: ${Boolean(inspected.staleOwner)}`);
  console.log('- No requester, distributor, Manager, branch, product, request, or registration-security data will be touched.');

  const confirmationPrompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  let confirmation;
  try { confirmation = await confirmationPrompt.question(`Type "${CONFIRMATION}" to continue: `); }
  finally { confirmationPrompt.close(); }
  if (confirmation !== CONFIRMATION) throw new Error('Reset cancelled: confirmation did not match.');

  const password = await hiddenPassword('New Admin password (hidden): ');
  const passwordAgain = await hiddenPassword('Confirm new Admin password (hidden): ');
  if (password !== passwordAgain) throw new Error('Passwords do not match.');
  if (password.length < 12 || password.length > 128) throw new Error('Admin password must be 12 to 128 characters.');

  const uid = await resetSuperAdmin({ auth, db, email, password, inspected });
  console.log(`Super Admin reset completed and verified for uid ${uid}.`);
  console.log('All previous Admin sessions are revoked. Sign in again at /admin/login.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Super Admin reset did not run: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CANONICAL_USERNAME,
  EXPECTED_PROJECT,
  hasAdminClaim,
  inspectResetTargets,
  isProvenAdmin,
  normalizeEmail,
  normalizeUsername,
  resetSuperAdmin,
};
