#!/usr/bin/env node
/*
 * Controlled BlueTap development reset. It is deliberately dry-run by default.
 * This script never contacts the face service: the deployed face API currently
 * has no authenticated bulk-reset contract, so guessing a delete endpoint would
 * be unsafe. It also never touches Gmail accounts, messages, or SMTP settings.
 */
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply') && args.has('--confirm') && process.argv.includes('RESET_BLUETAP_DEV');
const requestedApply = args.has('--apply') || args.has('--confirm');
const expectedProject = 'bluetap-8c98d';
const fullResetCollections = new Set([
  'registrationSessions', 'emailOtpVerifications', 'registrationOtpVerifications',
  'pendingRegistrations', 'faceVerificationSessions', 'onboardingSessions',
  'usernameReservations', 'requests', 'orders', 'notifications',
]);
const accountCollections = new Set(['users', 'usernames']);
const preservedByDesign = new Set(['products', 'counters', 'authRateLimits', 'faceServiceLocks']);

function admin() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) throw new Error('Set Firebase Admin environment variables before running this script.');
  if (projectId !== expectedProject) throw new Error(`Refusing reset: expected project ${expectedProject}, received ${projectId}.`);
  if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, 'bluetap-development-reset');
  return { auth: getAuth(), db: getFirestore() };
}

async function docs(collection) {
  return (await collection.get()).docs;
}
async function deleteRefs(db, refs) {
  for (let index = 0; index < refs.length; index += 400) {
    const batch = db.batch();
    refs.slice(index, index + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}
async function allAuthUsers(auth) {
  const users = []; let pageToken;
  do { const page = await auth.listUsers(1000, pageToken); users.push(...page.users); pageToken = page.pageToken; } while (pageToken);
  return users;
}
function isSystemIdentity(user, profile) {
  return user.customClaims?.admin === true || user.customClaims?.role === 'admin' || profile?.role === 'admin';
}

async function run() {
  if (requestedApply && !apply) throw new Error('Refusing reset: actual deletion requires --apply --confirm RESET_BLUETAP_DEV together.');
  const { auth, db } = admin();
  const root = await db.listCollections();
  const names = root.map((collection) => collection.id).sort();
  const users = await allAuthUsers(auth);
  const profiles = new Map((await docs(db.collection('users'))).map((snapshot) => [snapshot.id, snapshot.data()]));
  const protectedUids = new Set(users.filter((user) => isSystemIdentity(user, profiles.get(user.uid))).map((user) => user.uid));
  const authTargets = users.filter((user) => !protectedUids.has(user.uid));

  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}\nProject: ${expectedProject}`);
  console.log(`Discovered root collections: ${names.join(', ') || '(none)'}`);
  console.log(`Firebase Auth users targeted: ${authTargets.length}; preserved system/admin identities: ${protectedUids.size}`);

  const deletions = [];
  for (const name of names) {
    const snapshots = await docs(db.collection(name));
    if (fullResetCollections.has(name)) {
      console.log(`Would delete ${snapshots.length} documents from ${name}.`);
      deletions.push(...snapshots.map((snapshot) => snapshot.ref));
    } else if (name === 'users') {
      const targets = snapshots.filter((snapshot) => !protectedUids.has(snapshot.id));
      console.log(`Would delete ${targets.length} non-system user profiles from users.`);
      deletions.push(...targets.map((snapshot) => snapshot.ref));
    } else if (name === 'usernames') {
      const targets = snapshots.filter((snapshot) => !protectedUids.has(snapshot.data()?.uid));
      console.log(`Would delete ${targets.length} non-system username claims from usernames.`);
      deletions.push(...targets.map((snapshot) => snapshot.ref));
    } else if (accountCollections.has(name) || preservedByDesign.has(name)) {
      console.log(`Preserved ${name}: ${snapshots.length} documents.`);
    } else {
      console.log(`Preserved unrecognized collection ${name}: ${snapshots.length} documents (no silent deletion).`);
    }
  }
  console.log('External face enrollment reset: NOT RUN. The Render API has no verified server-only bulk reset endpoint in this repository.');
  console.log('Gmail accounts/messages and SMTP configuration: preserved; this script never accesses them.');
  if (!apply) {
    console.log('Dry run complete. To delete only the listed Firebase development data: node scripts/reset-development-data.js --apply --confirm RESET_BLUETAP_DEV');
    return;
  }
  await deleteRefs(db, deletions);
  for (const user of authTargets) await auth.deleteUser(user.uid);
  console.log(`Deleted ${deletions.length} Firestore documents and ${authTargets.length} non-system Firebase Auth users.`);
}
run().catch((error) => { console.error('Development reset did not run:', error.message); process.exitCode = 1; });
