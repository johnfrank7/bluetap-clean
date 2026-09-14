#!/usr/bin/env node
// Trusted operator-only bootstrap. Never expose this through a public API.
const { readFileSync } = require('node:fs');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ''; };
const uidArgument = value('--uid');
const email = value('--email').trim().toLowerCase();
const username = value('--username').trim();
const usernameNormalized = username.toLowerCase();
const create = args.includes('--create');
const resetExistingAdmin = args.includes('--reset-existing-admin');

function usage() {
  return 'Usage:\n' +
    '  Promote existing: node scripts/bootstrap-admin.js --uid <firebase-uid> --apply --confirm BOOTSTRAP_BLUETAP_ADMIN\n' +
    '  Create new:       node scripts/bootstrap-admin.js --create --email <email> --username <username> --password-stdin --apply --confirm BOOTSTRAP_BLUETAP_ADMIN\n' +
    '  Reset Admin:      node scripts/bootstrap-admin.js --reset-existing-admin --email <email> --username <username> --password-stdin --apply --confirm BOOTSTRAP_BLUETAP_ADMIN';
}

if (!args.includes('--apply') || value('--confirm') !== 'BOOTSTRAP_BLUETAP_ADMIN') throw new Error(usage());
if (!process.env.FIREBASE_SERVICE_ACCOUNT_PATH) throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH is required.');
if (create && resetExistingAdmin) throw new Error(usage());
if ((create || resetExistingAdmin) && (!/^\S+@\S+\.\S+$/.test(email) || !/^[a-z0-9._-]{3,20}$/.test(usernameNormalized) || !args.includes('--password-stdin'))) {
  throw new Error(usage());
}
if (!create && !resetExistingAdmin && !/^[A-Za-z0-9_-]{1,128}$/.test(uidArgument)) throw new Error(usage());

async function readPassword() {
  const password = await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      process.stdin.pause();
      resolve(String(chunk).replace(/[\r\n]+$/, ''));
    };
    process.stdin.once('data', onData);
    process.stdin.once('error', reject);
    process.stdin.resume();
  });
  if (password.length < 12 || password.length > 128) throw new Error('Admin password must be 12 to 128 characters.');
  return password;
}

const account = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
if (account.project_id !== 'bluetap-8c98d') throw new Error('Refusing to bootstrap against an unexpected Firebase project.');
const app = getApps()[0] || initializeApp({ credential: cert(account), projectId: account.project_id });

(async () => {
  const auth = getAuth(app);
  const db = getFirestore(app);
  let user;
  let created = false;
  let temporaryPassword = '';

  if (create) {
    try {
      await auth.getUserByEmail(email);
      throw new Error('An Auth account already uses this email; refusing to promote it implicitly. Use the UID-based command after verifying its owner.');
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
    const usernameSnapshot = await db.collection('usernames').doc(usernameNormalized).get();
    if (usernameSnapshot.exists) throw new Error('The requested username is already claimed; no account was created.');
    const password = await readPassword();
    user = await auth.createUser({ email, password, emailVerified: true, displayName: username });
    created = true;
  } else if (resetExistingAdmin) {
    user = await auth.getUserByEmail(email);
    const existingProfile = await db.collection('users').doc(user.uid).get();
    if (!existingProfile.exists || existingProfile.data()?.role !== 'admin' || !(user.customClaims?.admin === true || user.customClaims?.role === 'admin')) {
      throw new Error('Refusing to reset an account that is not already proven to be an Admin by both Auth claims and Firestore profile.');
    }
    const existingUsername = String(existingProfile.data()?.usernameNormalized || '').trim().toLowerCase();
    if (existingUsername && existingUsername !== usernameNormalized) throw new Error('The supplied username does not match this Admin profile.');
    const usernameSnapshot = await db.collection('usernames').doc(usernameNormalized).get();
    if (usernameSnapshot.exists && usernameSnapshot.data()?.uid !== user.uid) throw new Error('The requested username belongs to another account.');
    temporaryPassword = await readPassword();
  } else {
    user = await auth.getUser(uidArgument);
  }

  try {
    await auth.setCustomUserClaims(user.uid, {
      ...(user.customClaims || {}),
      role: 'admin',
      admin: true,
      manager: false,
    });
    await db.runTransaction(async (tx) => {
      if (create || resetExistingAdmin) {
        const usernameRef = db.collection('usernames').doc(usernameNormalized);
        const claimed = await tx.get(usernameRef);
        if (claimed.exists && claimed.data()?.uid !== user.uid) throw new Error('The requested username was claimed concurrently.');
        tx.set(usernameRef, { uid: user.uid, createdAt: new Date() });
      }
      const profile = {
        uid: user.uid,
        email: user.email || email,
        role: 'admin',
        emailVerified: create || resetExistingAdmin ? true : user.emailVerified === true,
        registrationCompleted: true,
        onboardingStatus: 'complete',
        approvalStatus: 'approved',
        status: 'Approved',
        mustChangePassword: create || resetExistingAdmin ? true : undefined,
        updatedAt: new Date(),
      };
      if (!create && !resetExistingAdmin) delete profile.mustChangePassword;
      if (create || resetExistingAdmin) Object.assign(profile, { username, usernameNormalized });
      if (create) profile.createdAt = new Date();
      tx.set(db.collection('users').doc(user.uid), profile, { merge: true });
    });
    if (resetExistingAdmin) await auth.updateUser(user.uid, { password: temporaryPassword, emailVerified: true, displayName: username });
    // Claims are authoritative only after the client obtains a new token.
    // Revoking existing refresh tokens prevents a pre-bootstrap browser
    // session from continuing with stale privilege state.
    await auth.revokeRefreshTokens(user.uid);
  } catch (error) {
    if (created) {
      try { await auth.deleteUser(user.uid); } catch { /* report the original failure */ }
    }
    throw error;
  }

  console.log(`Admin bootstrap completed for uid ${user.uid}. Existing sessions were revoked; sign out and sign in again.`);
})().catch((error) => { console.error('Admin bootstrap failed:', error.message); process.exitCode = 1; });
