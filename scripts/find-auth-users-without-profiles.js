#!/usr/bin/env node
/*
 * Report Auth users missing users/{uid}. Dry-run by default.
 * Deletion additionally requires --apply, a bounded date range, and a test
 * email domain. Ambiguous users are always retained.
 */
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name) => args.includes(name);
const date = (name) => {
  const value = option(name);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must use YYYY-MM-DD.`);
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime())) throw new Error(`${name} is invalid.`);
  return result;
};
function admin() {
  if (!getApps().length) {
    const { FIREBASE_PROJECT_ID: projectId, FIREBASE_CLIENT_EMAIL: clientEmail, FIREBASE_PRIVATE_KEY: key } = process.env;
    if (!projectId || !clientEmail || !key) throw new Error('Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.');
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey: key.replace(/\\n/g, '\n') }), projectId }, 'bluetap-auth-profile-audit');
  }
  return { auth: getAuth(), db: getFirestore() };
}
async function hasActivity(db, uid) {
  const checks = [
    ['requests', 'requester_id'], ['requests', 'distributor_id'], ['orders', 'requester_id'],
    ['orders', 'distributor_id'], ['history', 'uid'], ['distributorApprovals', 'uid'],
  ];
  const results = await Promise.all(checks.map(([collection, field]) => db.collection(collection).where(field, '==', uid).limit(1).get()));
  return results.some((snapshot) => !snapshot.empty);
}
async function run() {
  const apply = has('--apply');
  const testDomain = option('--test-domain');
  const from = option('--from') ? date('--from') : null;
  const to = option('--to') ? date('--to') : new Date();
  if (apply && (!from || !testDomain || !testDomain.startsWith('@'))) {
    throw new Error('--apply requires --from YYYY-MM-DD and --test-domain @example.test.');
  }
  const { auth, db } = admin();
  const candidates = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      const profile = await db.collection('users').doc(user.uid).get();
      if (profile.exists) continue;
      console.log(`Auth user:\nuid: ${user.uid}\nemail: ${user.email || '(none)'}\nemailVerified: ${user.emailVerified}\nprofile: missing\ncreatedAt: ${user.metadata.creationTime}`);
      const createdAt = new Date(user.metadata.creationTime);
      const sessions = await db.collection('registrationSessions').where('userUid', '==', user.uid).get();
      const completedSession = sessions.docs.some((snapshot) => snapshot.data().completed === true);
      const activity = await hasActivity(db, user.uid);
      const eligible = !user.disabled && !user.emailVerified && !completedSession && !activity &&
        from && createdAt >= from && createdAt < to && user.email?.toLowerCase().endsWith(testDomain.toLowerCase());
      if (eligible) candidates.push(user.uid);
      else console.log('cleanup: manual review required; retained');
    }
    pageToken = page.pageToken;
  } while (pageToken);
  if (!apply) return console.log('Dry run only. No Auth users were deleted. Use --apply with a bounded test domain only after review.');
  for (const uid of candidates) {
    await auth.deleteUser(uid);
    console.log(`Deleted clearly incomplete test Auth user: ${uid}`);
  }
}
run().catch((error) => { console.error('Audit did not run:', error.message); process.exitCode = 1; });
