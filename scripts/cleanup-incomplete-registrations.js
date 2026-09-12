#!/usr/bin/env node
/*
 * Conservative one-time cleanup for the pre-OTP registration bug.
 * It is dry-run by default and always requires a bounded --from period.
 *
 * node scripts/cleanup-incomplete-registrations.js --from 2026-09-01
 * node scripts/cleanup-incomplete-registrations.js --from 2026-09-01 --to 2026-09-12 --apply
 */
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name) => args.includes(name);
const millis = (value) => value?.toMillis?.() || (value instanceof Date ? value.getTime() : Number(value) || 0);

function dateOption(name) {
  const input = option(name);
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new Error(`${name} must use YYYY-MM-DD.`);
  const date = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} is invalid.`);
  return date;
}

function getAdmin() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY before running cleanup.');
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, 'bluetap-cleanup');
  }
  return { auth: getAuth(), db: getFirestore() };
}

async function hasRequestActivity(db, uid) {
  const snapshots = await Promise.all([
    db.collection('requests').where('requester_id', '==', uid).limit(1).get(),
    db.collection('requests').where('distributor_id', '==', uid).limit(1).get(),
  ]);
  return snapshots.some((snapshot) => !snapshot.empty);
}

async function run() {
  if (has('--help')) {
    console.log('Usage: node scripts/cleanup-incomplete-registrations.js --from YYYY-MM-DD [--to YYYY-MM-DD] [--apply]');
    return;
  }
  const from = dateOption('--from');
  const to = option('--to') ? dateOption('--to') : new Date();
  if (to <= from) throw new Error('--to must be after --from.');
  const apply = has('--apply');
  const { auth, db } = getAdmin();
  const now = Date.now();
  const within = (value) => {
    const time = millis(value);
    return time >= from.getTime() && time < to.getTime();
  };
  const authUsers = new Set();
  const profileRefs = [];
  const sessionRefs = [];
  const otpRefs = [];
  const reservationRefs = [];
  const manualReview = [];

  // A profile is eligible only if it is explicitly incomplete, contains no
  // role/approval/unique-ID state, has no activity, and belongs to an unverified
  // enabled Auth user created during the chosen broken-flow period.
  const profiles = await db.collection('users')
    .where('createdAt', '>=', Timestamp.fromDate(from))
    .where('createdAt', '<', Timestamp.fromDate(to)).get();
  for (const snapshot of profiles.docs) {
    const profile = snapshot.data();
    if (profile.registrationCompleted === true || profile.emailVerified === true) continue;
    if (profile.role || profile.approvalStatus || profile.status || profile.unique_id || profile.rejectionReason) {
      manualReview.push(`users/${snapshot.id}: role, approval, or identity state exists`);
      continue;
    }
    let user;
    try { user = await auth.getUser(snapshot.id); } catch { manualReview.push(`users/${snapshot.id}: Auth user is missing`); continue; }
    if (user.disabled || user.emailVerified || !within(new Date(user.metadata.creationTime)) || await hasRequestActivity(db, user.uid)) {
      manualReview.push(`users/${snapshot.id}: Auth state or request activity is ambiguous`);
      continue;
    }
    profileRefs.push(snapshot.ref);
    authUsers.add(user.uid);
  }

  // Auth-only orphan accounts are safe only with no profile or request activity.
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      if (user.disabled || user.emailVerified || !within(new Date(user.metadata.creationTime)) || authUsers.has(user.uid)) continue;
      const profile = await db.collection('users').doc(user.uid).get();
      if (profile.exists || await hasRequestActivity(db, user.uid)) {
        manualReview.push(`Auth user ${user.uid}: profile or request activity exists`);
        continue;
      }
      authUsers.add(user.uid);
    }
    pageToken = page.pageToken;
  } while (pageToken);

  const sessions = await db.collection('registrationSessions')
    .where('createdAt', '>=', Timestamp.fromDate(from))
    .where('createdAt', '<', Timestamp.fromDate(to)).get();
  for (const snapshot of sessions.docs) {
    const session = snapshot.data();
    if (session.completed === true || session.emailVerified === true || session.userUid || millis(session.expiresAt) > now) continue;
    if (session.faceEnrollmentPending === true) {
      manualReview.push(`registrationSessions/${snapshot.id}: face enrollment may be pending`);
      continue;
    }
    sessionRefs.push(snapshot.ref);
  }

  const otps = await db.collection('emailOtpVerifications')
    .where('createdAt', '>=', Timestamp.fromDate(from))
    .where('createdAt', '<', Timestamp.fromDate(to)).get();
  for (const snapshot of otps.docs) {
    const otp = snapshot.data();
    if (snapshot.id.startsWith('registration-') && millis(otp.expiresAt) <= now && otp.status !== 'active') otpRefs.push(snapshot.ref);
  }

  const reservations = await db.collection('usernameReservations')
    .where('createdAt', '>=', Timestamp.fromDate(from))
    .where('createdAt', '<', Timestamp.fromDate(to)).get();
  for (const snapshot of reservations.docs) {
    if (millis(snapshot.data().expiresAt) <= now) reservationRefs.push(snapshot.ref);
  }

  for (const uid of authUsers) console.log(`Would delete Auth user: ${uid}`);
  for (const ref of profileRefs) console.log(`Would delete users document: ${ref.path}`);
  for (const ref of sessionRefs) console.log(`Would delete registration session: ${ref.path}`);
  for (const ref of otpRefs) console.log(`Would delete registration OTP: ${ref.path}`);
  for (const ref of reservationRefs) console.log(`Would release username: ${ref.path}`);
  for (const item of manualReview) console.log(`Manual review required: ${item}`);
  if (!apply) {
    console.log('Dry run only. No data was deleted. Re-run with --apply after reviewing this output.');
    return;
  }

  // Manual-review records are never deleted. Batches stay below Firestore's limit.
  for (const uid of authUsers) await auth.deleteUser(uid);
  const deletes = [...profileRefs, ...sessionRefs, ...otpRefs, ...reservationRefs];
  while (deletes.length) {
    const batch = db.batch();
    deletes.splice(0, 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  console.log('Cleanup applied only to the records listed above.');
}

run().catch((error) => {
  console.error('Cleanup did not run:', error.message);
  process.exitCode = 1;
});
