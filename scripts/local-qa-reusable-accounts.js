// Invoked only by the local account helper; never exposed as an HTTP route.
const { assertLocalQaServerEnvironment } = require('../backend/config/localQaIsolation');
const { getFirebaseAdmin } = require('../backend/firebase/firebaseAdmin');

const roles = ['requester', 'distributor', 'manager', 'admin'];

async function main() {
  if (process.env.BLUETAP_QA_ACCOUNT_SETUP !== '1' || !assertLocalQaServerEnvironment()) {
    throw new Error('Explicit isolated local-QA account setup is required.');
  }
  const { auth, db } = getFirebaseAdmin();
  if (auth?.app?.options?.projectId !== 'demo-bluetap-local-qa' ||
      db?.projectId !== 'demo-bluetap-local-qa' || db?._settings?.servicePath !== '127.0.0.1' ||
      db?._settings?.port !== 8080 || db?._settings?.ssl !== false ||
      auth?.app?.options?.credential?.constructor?.name !== 'ApplicationDefaultCredential') {
    throw new Error('Account setup requires the matching local emulators.');
  }
  if (process.argv[2] === 'discover') {
    const result = {};
    let pageToken;
    do {
      const page = await auth.listUsers(1000, pageToken);
      for (const user of page.users) {
        const match = /^qa-(requester|distributor|manager|admin)-([0-9a-f-]{36})@example\.test$/i.exec(user.email || '');
        if (!match) continue;
        const role = match[1].toLowerCase();
        const profile = (await db.doc(`users/${user.uid}`).get()).data();
        if (result[role] || profile?.role !== role || profile?.accountStatus !== 'active' ||
            !user.emailVerified || (role === 'admin' && user.customClaims?.admin !== true) ||
            (['manager', 'distributor'].includes(role) && !profile.branchId)) {
          throw new Error('Existing disposable account metadata is inconsistent.');
        }
        result[role] = { uid: user.uid, email: user.email.toLowerCase(), group: match[2].toLowerCase() };
      }
      pageToken = page.pageToken;
    } while (pageToken);
    if (roles.some((role) => !result[role]) || new Set(roles.map((role) => result[role].group)).size !== 1) {
      throw new Error('A single matching four-role disposable fixture was not found.');
    }
    for (const role of roles) delete result[role].group;
    process.stdout.write(JSON.stringify(result));
    return;
  }
  if (!['apply', 'repair-profile'].includes(process.argv[2])) throw new Error('Invalid local account operation.');
  let fixture;
  try { fixture = JSON.parse(process.env.BLUETAP_QA_ACCOUNT_DATA || ''); } catch { throw new Error('Local account data is unavailable.'); }
  const policy = (await db.doc('systemConfig/registrationSecurity').get()).data();
  if (policy?.faceVerificationEnabled !== false) throw new Error('The local registration policy does not allow this fixture.');
  // Validate every target before changing any password. Existing accounts and
  // profiles are retained; a different emulator state is never adopted.
  for (const role of roles) {
    const entry = fixture[role];
    if (!entry || typeof entry.password !== 'string' || entry.password.length < 16 ||
        !new RegExp(`^qa-${role}-[0-9a-f-]{36}@example\\.test$`, 'i').test(entry.email || '')) {
      throw new Error('Local account data is invalid.');
    }
    const user = await auth.getUser(entry.uid);
    const profile = (await db.doc(`users/${entry.uid}`).get()).data();
    if (user.email?.toLowerCase() !== entry.email || profile?.role !== role || profile?.accountStatus !== 'active') {
      throw new Error('Disposable account state changed; no account was modified.');
    }
    if (role === 'distributor' && profile.faceVerification &&
        (profile.faceVerification.required !== false || profile.faceVerification.status !== 'not_required')) {
      throw new Error('The distributor verification state cannot be replaced.');
    }
  }
  const distributorRef = db.doc(`users/${fixture.distributor.uid}`);
  await db.runTransaction(async (tx) => {
    const [profile, registration] = await Promise.all([tx.get(distributorRef), tx.get(db.doc('systemConfig/registrationSecurity'))]);
    if (registration.data()?.faceVerificationEnabled !== false || profile.data()?.role !== 'distributor') {
      throw new Error('The local fixture policy changed.');
    }
    if (!profile.data()?.faceVerification) tx.update(distributorRef, { faceVerification: {
      required: false, status: 'not_required', verifiedAt: null, livenessPassed: null,
      duplicateCheck: 'not_required', verificationMode: 'not_required', providerVerified: false,
    } });
  });
  if (process.argv[2] === 'apply') {
    for (const role of roles) await auth.updateUser(fixture[role].uid, { password: fixture[role].password });
    console.log('Reusable passwords were applied to the existing local emulator accounts.');
  } else console.log('The local distributor profile follows the existing verification policy.');
}

main().catch(() => { console.error('Local account setup failed; check the isolated fixture and retry.'); process.exitCode = 1; });
