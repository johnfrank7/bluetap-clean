#!/usr/bin/env node
/*
 * One-time repair for legacy username mappings created before registration
 * finalization completed. Dry-run is the default.
 *
 * node scripts/cleanup-orphan-usernames.js
 * node scripts/cleanup-orphan-usernames.js --apply --confirm "DELETE ORPHAN BLUETAP USERNAMES"
 */
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { normalizeUsername } = require('../backend/username/username');

const TARGET_PROJECT = 'bluetap-8c98d';
const CONFIRMATION = 'DELETE ORPHAN BLUETAP USERNAMES';
const SAFE_UID = /^[A-Za-z0-9_-]{1,128}$/;
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

function authErrorCode(error) {
  return String(error?.code || '');
}

function profileIsFinalized(profile) {
  return profile?.registrationCompleted === true && profile?.onboardingStatus === 'complete';
}

async function classifyUsernameMapping({ db, auth, id, mapping }) {
  let normalized;
  try {
    normalized = normalizeUsername(id);
  } catch {
    return { kind: 'orphan', reason: 'malformed-username-key' };
  }
  if (normalized !== id || !SAFE_UID.test(String(mapping?.uid || ''))) {
    return { kind: 'orphan', reason: 'malformed-mapping-owner' };
  }
  const uid = mapping.uid;
  let user;
  try {
    user = await auth.getUser(uid);
  } catch (error) {
    if (authErrorCode(error) === 'auth/user-not-found' || authErrorCode(error) === 'auth/invalid-uid') {
      return { kind: 'orphan', reason: 'firebase-auth-user-missing' };
    }
    return { kind: 'manual-review', reason: 'firebase-auth-lookup-failed' };
  }
  const profileSnapshot = await db.collection('users').doc(uid).get();
  if (!profileSnapshot.exists) return { kind: 'orphan', reason: 'profile-missing' };
  const profile = profileSnapshot.data();
  if (profile.uid && profile.uid !== uid) return { kind: 'manual-review', reason: 'profile-uid-mismatch' };
  if (profile.usernameNormalized !== normalized) return { kind: 'manual-review', reason: 'profile-username-mismatch' };
  if (!profileIsFinalized(profile)) return { kind: 'orphan', reason: 'registration-not-finalized' };
  // A username mapping intentionally contains no email. Verify identity from
  // the linked Auth/profile records only when both sides supply an email.
  if (profile.email && user.email && String(profile.email).trim().toLowerCase() !== String(user.email).trim().toLowerCase()) {
    return { kind: 'manual-review', reason: 'profile-auth-email-mismatch' };
  }
  return { kind: 'valid', reason: 'finalized-uid-auth-profile-chain' };
}

function getAdmin() {
  if (process.env.FIREBASE_PROJECT_ID !== TARGET_PROJECT) {
    throw new Error(`Refusing to inspect any project except ${TARGET_PROJECT}.`);
  }
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) throw new Error('Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY before running cleanup.');
  const app = getApps().find((item) => item.name === 'bluetap-orphan-username-cleanup') || initializeApp({
    credential: cert({ projectId: TARGET_PROJECT, clientEmail, privateKey }), projectId: TARGET_PROJECT,
  }, 'bluetap-orphan-username-cleanup');
  if (app.options.projectId !== TARGET_PROJECT) throw new Error(`Refusing to inspect any project except ${TARGET_PROJECT}.`);
  return { auth: getAuth(app), db: getFirestore(app) };
}

async function run({ auth, db, log = console.log, applying = args.includes('--apply'), confirmation = option('--confirm') } = getAdmin()) {
  if (applying && confirmation !== CONFIRMATION) {
    throw new Error(`Deletion requires --apply --confirm "${CONFIRMATION}".`);
  }
  const snapshot = await db.collection('usernames').get();
  const counts = { total: snapshot.size, valid: 0, orphan: 0, manualReview: 0 };
  const candidates = [];
  for (const item of snapshot.docs) {
    const result = await classifyUsernameMapping({ db, auth, id: item.id, mapping: item.data() });
    if (result.kind === 'valid') counts.valid += 1;
    else if (result.kind === 'orphan') {
      counts.orphan += 1;
      candidates.push(item.ref);
      log(`Would delete usernames/${item.id}: ${result.reason}`);
    } else {
      counts.manualReview += 1;
      log(`Manual review usernames/${item.id}: ${result.reason}`);
    }
  }
  log(`Total username mappings: ${counts.total}`);
  log(`Valid mappings: ${counts.valid}`);
  log(`Orphan mappings: ${counts.orphan}`);
  log(`Manual review mappings: ${counts.manualReview}`);
  log(`Would delete: ${candidates.length}`);
  if (!applying) {
    log('Dry run only. No data was deleted.');
    return counts;
  }
  for (const ref of candidates) await ref.delete();
  log(`Deleted orphan username mappings: ${candidates.length}`);
  return counts;
}

if (require.main === module) {
  run().catch((error) => {
    console.error('Orphan username cleanup did not run:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { TARGET_PROJECT, CONFIRMATION, classifyUsernameMapping, profileIsFinalized, run };
