#!/usr/bin/env node
/*
 * Reports legacy Render enrollments whose old subject_id was a registration
 * session that never completed. This is dry-run only unless the protected
 * Render service exposes a server-authenticated delete-by-subject endpoint.
 */
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const has = (name) => args.includes(name);
const millis = (value) => value?.toMillis?.() || (value instanceof Date ? value.getTime() : Number(value) || 0);

function requiredDate(name) {
  const value = option(name);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} is invalid.`);
  return date;
}
function db() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) throw new Error('Set Firebase Admin environment variables before running cleanup.');
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, 'bluetap-face-cleanup');
  }
  return getFirestore();
}

async function run() {
  if (has('--help')) {
    console.log('Usage: node scripts/cleanup-orphaned-faces.js --from YYYY-MM-DD [--to YYYY-MM-DD] [--apply]');
    return;
  }
  const from = requiredDate('--from');
  const to = option('--to') ? requiredDate('--to') : new Date();
  if (to <= from) throw new Error('--to must be after --from.');
  const firestore = db();
  const sessions = await firestore.collection('registrationSessions')
    .where('createdAt', '>=', Timestamp.fromDate(from))
    .where('createdAt', '<', Timestamp.fromDate(to)).get();
  const candidates = sessions.docs.filter((snapshot) => {
    const data = snapshot.data();
    // Old enrollment used registrationSessionId as Render subject_id. Completed
    // sessions and sessions bound to a final UID are never candidates.
    return data.completed !== true && !data.userUid && millis(data.expiresAt) <= Date.now() &&
      data.faceVerification?.verificationReference === snapshot.id;
  });
  for (const snapshot of candidates) {
    console.log(`Would delete temporary/orphan face: registrationSessionId=${snapshot.id} subject/reference=${snapshot.id}`);
  }
  if (!has('--apply')) {
    console.log('Dry run only. No Render data was changed. Re-run with --apply only after the protected Render delete-by-subject API is deployed.');
    return;
  }
  // The currently deployed Render contract intentionally has no list/delete
  // endpoint. Refuse rather than guessing files or issuing an invented request.
  throw new Error('Refusing to delete: deploy a protected Render delete-by-subject endpoint and update this utility with its verified contract first.');
}
run().catch((error) => { console.error('Face cleanup did not run:', error.message); process.exitCode = 1; });
