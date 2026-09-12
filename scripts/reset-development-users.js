#!/usr/bin/env node
/*
 * Controlled BlueTap development-user reset. Dry-run is the default.
 * Apply requires both: --apply --confirm RESET_BLUETAP_USERS
 */
const { readFileSync } = require('node:fs');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const EXPECTED_PROJECT = 'bluetap-8c98d';
const CONFIRMATION = 'RESET_BLUETAP_USERS';
const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const requestedApply = argv.includes('--apply') || argv.includes('--confirm');
const apply = argv.includes('--apply') && option('--confirm') === CONFIRMATION;

const fullResetCollections = new Set([
  'registrationSessions',
  'emailOtpVerifications',
  'registrationOtpVerifications',
  'usernameReservations',
  'authRateLimits',
]);
const ownedCollections = new Map([
  ['requests', ['requester_id', 'distributor_id', 'uid', 'userUid']],
  ['orders', ['requester_id', 'distributor_id', 'uid', 'userUid']],
  ['notifications', ['uid', 'userUid', 'user_id', 'recipientUid']],
  ['history', ['uid', 'userUid', 'requester_id', 'distributor_id']],
  ['distributorApprovals', ['uid', 'userUid', 'distributor_id']],
  ['distributorApplications', ['uid', 'userUid', 'distributor_id']],
  ['stations', ['uid', 'userUid', 'ownerUid', 'distributor_id']],
]);
const alwaysPreservedCollections = new Set([
  'products',
  'counters',
  'faceServiceLocks',
]);

const faceResetErrorDetails = new Map([
  ['Development face reset is disabled.', ['FACE_RESET_DISABLED', 'Development face reset is disabled on the face API.']],
  ['Face storage is not declared as development-only.', ['FACE_DATA_ENVIRONMENT_NOT_DEVELOPMENT', 'Face storage is not declared as development-only.']],
  ['Exact development reset confirmation is required.', ['FACE_RESET_CONFIRMATION_INVALID', 'The destructive face reset confirmation was rejected.']],
]);

function safeFaceResetError(response, result, dryRun) {
  let code = 'FACE_RESET_REQUEST_FAILED';
  let message = 'The face API rejected the development reset request.';
  if (response.status === 401 ||
      (response.status === 403 && result?.detail === 'Invalid API key.')) {
    code = 'INVALID_API_KEY';
    message = 'The face API rejected the server authentication key.';
  } else if (faceResetErrorDetails.has(result?.detail)) {
    [code, message] = faceResetErrorDetails.get(result.detail);
  } else if (response.status === 404) {
    code = 'FACE_RESET_ENDPOINT_NOT_FOUND';
    message = 'The development face reset endpoint is not deployed.';
  }
  return new Error(
    `Development face ${dryRun ? 'preflight' : 'reset'} failed ` +
    `(HTTP ${response.status}, ${code}): ${message}`
  );
}

function credentials() {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (serviceAccountPath) {
    const account = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    return {
      projectId: account.project_id,
      clientEmail: account.client_email,
      privateKey: account.private_key,
    };
  }
  return {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };
}

function admin() {
  const { projectId, clientEmail, privateKey } = credentials();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Set FIREBASE_SERVICE_ACCOUNT_PATH or the three Firebase Admin environment variables.');
  }
  if (projectId !== EXPECTED_PROJECT) {
    throw new Error(`Refusing reset: expected project ${EXPECTED_PROJECT}, received ${projectId || '(missing)'}.`);
  }
  const app = getApps().find((candidate) => candidate.name === 'bluetap-development-user-reset') ||
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, 'bluetap-development-user-reset');
  if (app.options.projectId !== EXPECTED_PROJECT) throw new Error('Refusing reset: Firebase app project mismatch.');
  return { auth: getAuth(app), db: getFirestore(app) };
}

async function allAuthUsers(auth) {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

const isSystemIdentity = (user, profile) =>
  user?.customClaims?.admin === true || user?.customClaims?.role === 'admin' || profile?.role === 'admin';
const ownsDocument = (data, fields, targetUids) => fields.some((field) => targetUids.has(data?.[field]));
const addTargets = (targets, snapshots) => snapshots.forEach((snapshot) => targets.set(snapshot.ref.path, snapshot.ref));
const faceIsFinalized = (profile = {}) => {
  const face = profile.faceVerification || {};
  return profile.registrationCompleted === true || face.status === 'verified' ||
    (typeof face.verificationReference === 'string' && face.verificationReference === profile.uid);
};
const temporaryFaceSession = (snapshot) => {
  const session = snapshot.data();
  const face = session.faceVerification || {};
  return session.completed !== true && face.status === 'passed_pending_finalization' &&
    face.verificationReference === snapshot.id;
};

async function resetDevelopmentFaces(dryRun) {
  const base = (process.env.DEEPFACE_API_URL || '').replace(/\/+$/, '');
  const key = process.env.DEEPFACE_API_KEY;
  if (!base.startsWith('https://') || !key) {
    throw new Error('Face reset requires server-only DEEPFACE_API_URL and DEEPFACE_API_KEY.');
  }
  const response = await fetch(`${base}/admin/reset-development-enrollments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(dryRun
      ? { dryRun: true }
      : { dryRun: false, confirm: 'RESET_BLUETAP_FACE_DEV' }),
    redirect: 'error',
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw safeFaceResetError(response, result, dryRun);
  }
  if (result?.scope !== 'development' || result?.dryRun !== dryRun ||
      !Number.isInteger(result?.totalEntries) || !Number.isInteger(result?.deletedEntries)) {
    throw new Error(
      `Development face ${dryRun ? 'preflight' : 'reset'} failed ` +
      `(HTTP ${response.status}, INVALID_FACE_RESET_RESPONSE): The face API returned an invalid response.`
    );
  }
  if (!dryRun && result.deletedEntries !== result.totalEntries) {
    throw new Error('Development face reset returned inconsistent deletion counts.');
  }
  return result;
}

async function deleteDocuments(db, refs) {
  const list = [...refs.values()];
  for (let index = 0; index < list.length; index += 400) {
    const batch = db.batch();
    list.slice(index, index + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

async function run() {
  if (requestedApply && !apply) {
    throw new Error(`Refusing reset: deletion requires --apply --confirm ${CONFIRMATION}.`);
  }
  const { auth, db } = admin();
  const [authUsers, rootCollections, userSnapshots] = await Promise.all([
    allAuthUsers(auth),
    db.listCollections(),
    db.collection('users').get(),
  ]);
  const profiles = new Map(userSnapshots.docs.map((snapshot) => [snapshot.id, snapshot.data()]));
  const protectedUids = new Set();
  authUsers.forEach((user) => {
    if (isSystemIdentity(user, profiles.get(user.uid))) protectedUids.add(user.uid);
  });
  userSnapshots.docs.forEach((snapshot) => {
    if (snapshot.data()?.role === 'admin') protectedUids.add(snapshot.id);
  });
  const authTargets = authUsers.filter((user) => !protectedUids.has(user.uid));
  const targetUids = new Set(authTargets.map((user) => user.uid));
  userSnapshots.docs.forEach((snapshot) => {
    if (!protectedUids.has(snapshot.id)) targetUids.add(snapshot.id);
  });

  const targets = new Map();
  const counts = new Map();
  const preserved = [];
  let registrationSessions = [];
  const names = rootCollections.map((collection) => collection.id).sort();
  for (const collection of rootCollections) {
    const snapshots = (await collection.get()).docs;
    let selected = [];
    if (collection.id === 'users') {
      selected = snapshots.filter((snapshot) => targetUids.has(snapshot.id));
    } else if (collection.id === 'usernames') {
      selected = snapshots.filter((snapshot) => targetUids.has(snapshot.data()?.uid));
    } else if (fullResetCollections.has(collection.id)) {
      selected = snapshots;
    } else if (ownedCollections.has(collection.id)) {
      selected = snapshots.filter((snapshot) => ownsDocument(snapshot.data(), ownedCollections.get(collection.id), targetUids));
    } else {
      preserved.push(`${collection.id}: ${snapshots.length}`);
    }
    if (collection.id === 'registrationSessions') registrationSessions = snapshots;
    if (selected.length) {
      counts.set(collection.id, selected.length);
      addTargets(targets, selected);
    } else if (!preserved.some((entry) => entry.startsWith(`${collection.id}:`))) {
      counts.set(collection.id, 0);
    }
  }

  const finalizedFaces = userSnapshots.docs.filter((snapshot) =>
    targetUids.has(snapshot.id) && faceIsFinalized({ uid: snapshot.id, ...snapshot.data() })
  );
  const temporaryFaces = registrationSessions.filter(temporaryFaceSession);
  const facePreflight = await resetDevelopmentFaces(true);

  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Project: ${EXPECTED_PROJECT}`);
  console.log(`Discovered root collections: ${names.join(', ') || '(none)'}`);
  console.log('\nFirebase Auth users that would be deleted:');
  authTargets.forEach((user) => console.log(`- uid=${user.uid} email=${user.email || '(none)'} created=${user.metadata.creationTime}`));
  if (!authTargets.length) console.log('- none');
  console.log('\nPreserved Firebase Auth/system users:');
  authUsers.filter((user) => protectedUids.has(user.uid)).forEach((user) =>
    console.log(`- uid=${user.uid} email=${user.email || '(none)'} reason=admin/system identity`)
  );
  if (!protectedUids.size) console.log('- none (BlueTap admin currently uses a separate local secret, not Firebase Auth)');
  console.log('\nFirestore documents that would be deleted:');
  [...counts].sort(([left], [right]) => left.localeCompare(right)).forEach(([name, count]) => console.log(`- ${name}: ${count}`));
  console.log(`- total unique documents: ${targets.size}`);
  console.log('\nFace enrollment plan:');
  console.log(`- API dry-run finalized enrollments: ${facePreflight.finalizedEnrollments}`);
  console.log(`- API dry-run orphaned enrollments: ${facePreflight.orphanedEnrollments}`);
  console.log(`- API dry-run temporary registrations: ${facePreflight.temporaryRegistrations}`);
  console.log(`- Firestore-inferred finalized profiles: ${finalizedFaces.length}`);
  console.log(`- Firestore-inferred temporary face sessions: ${temporaryFaces.length}`);
  console.log('\nPreserved data:');
  preserved.forEach((entry) => console.log(`- ${entry}`));
  alwaysPreservedCollections.forEach((name) => {
    if (!names.includes(name)) console.log(`- ${name}: collection not present`);
  });
  console.log('- Firebase/Vercel/Render projects, models, source, Gmail/SMTP, environment configuration, rules, indexes, and email messages');

  if (!apply) {
    console.log(`\nDRY RUN ONLY: nothing was deleted.`);
    console.log(`Apply command after review: node scripts/reset-development-users.js --apply --confirm ${CONFIRMATION}`);
    return;
  }

  const faceReset = await resetDevelopmentFaces(false);
  console.log(`Face reset complete: deleted ${faceReset.deletedEntries} development face entries.`);
  await deleteDocuments(db, targets);
  for (const user of authTargets) await auth.deleteUser(user.uid);
  console.log(`Reset complete: deleted ${targets.size} Firestore documents and ${authTargets.length} normal Firebase Auth users.`);
}

run().catch((error) => {
  console.error('Development user reset did not run:', error.message);
  process.exitCode = 1;
});
