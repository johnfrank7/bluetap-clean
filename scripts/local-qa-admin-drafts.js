// Disposable local-QA data. Promotion preview is explicitly opt-in and emulator-only.
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { assertLocalQaServerEnvironment } = require('../backend/config/localQaIsolation');
const { getFirebaseAdmin } = require('../backend/firebase/firebaseAdmin');
const { createAppServer } = require('../backend/app');
const { routes } = require('../backend/routes');
const { promotionTestCapability } = require('../backend/pricing/promotionTestCapability');
const { createAdminProductsHandler } = require('../backend/admin/productManagementHandler');
const { createRequesterCatalogHandler } = require('../backend/requester/orderingHandler');
const { SECURE_DEFAULTS, validateRegistrationSecurity, publicRegistrationPolicy } = require('../backend/registration/registrationSecurity');

function credentials(role) {
  const email = String(process.env[`BLUETAP_QA_${role}_EMAIL`] || '').trim().toLowerCase();
  const password = String(process.env[`BLUETAP_QA_${role}_PASSWORD`] || '');
  const uid = String(process.env[`BLUETAP_QA_${role}_UID`] || '');
  if (!/^[a-z0-9._%+-]+@example\.test$/.test(email) || password.length < 12) throw new Error(`Provide a disposable ${role.toLowerCase()} @example.test email and password of at least 12 characters.`);
  if (process.env.BLUETAP_QA_REUSABLE_ACCOUNTS === '1' &&
      !new RegExp(`^(?:draft-qa|qa)-${role.toLowerCase()}-[0-9a-f-]{36}$`, 'i').test(uid)) {
    throw new Error('Reusable local-QA account identity is invalid.');
  }
  return { email, password, uid };
}

async function main() {
  if (process.env.BLUETAP_TRIP_EMULATOR_MODE === '1') throw new Error('Experimental trip mode must remain disabled.');
  if (process.env.BLUETAP_DRAFT_QA !== '1' || process.env.GCLOUD_PROJECT !== 'demo-bluetap-local-qa' || !assertLocalQaServerEnvironment()) throw new Error('Explicit isolated local-QA enablement is required.');
  if (process.env.FIREBASE_CONFIG) {
    let project;
    try { project = JSON.parse(process.env.FIREBASE_CONFIG).projectId; } catch { throw new Error('Local QA requires a matching emulator project.'); }
    if (project !== 'demo-bluetap-local-qa') throw new Error('Local QA requires a matching emulator project.');
  }
  const admin = credentials('ADMIN'); const requester = credentials('REQUESTER');
  const reusable = process.env.BLUETAP_QA_REUSABLE_ACCOUNTS === '1';
  const manager = reusable ? credentials('MANAGER') : null;
  const distributor = reusable ? credentials('DISTRIBUTOR') : null;
  const emails = [admin, requester, manager, distributor].filter(Boolean).map((account) => account.email);
  if (new Set(emails).size !== emails.length) throw new Error('Use distinct disposable accounts for each role.');
  const { auth, db } = getFirebaseAdmin();
  if (auth?.app?.options?.projectId !== 'demo-bluetap-local-qa' || db?.projectId !== 'demo-bluetap-local-qa' || db?._settings?.servicePath !== '127.0.0.1' || db?._settings?.port !== 8080 || db?._settings?.ssl !== false || auth?.app?.options?.credential?.constructor?.name !== 'ApplicationDefaultCredential') throw new Error('Local QA requires matching emulator clients without service-account credentials.');
  const preview = process.env.BLUETAP_DRAFT_PROMO_PREVIEW === '1';
  const getAdmin = () => getFirebaseAdmin();
  const capability = { emulatorPromotionPricing: true };
  let qaRoutes = routes;
  if (preview) {
    promotionTestCapability(getAdmin, capability);
    qaRoutes = new Map(qaRoutes);
    qaRoutes.set('/api/requester/catalog', createRequesterCatalogHandler(getAdmin, capability));
  }
  if (process.env.BLUETAP_QA_PASSWORD_MAIL === '1') {
    const { createLocalQaPasswordMailHandler } = require('./local-qa-password-mail');
    if (qaRoutes === routes) qaRoutes = new Map(routes);
    qaRoutes.set('/api/auth/password-change-otp', createLocalQaPasswordMailHandler(getAdmin));
  }
  const server = createAppServer(qaRoutes);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3000, '127.0.0.1', resolve); });
  try {
    const suffix = randomUUID(); const adminUid = reusable ? admin.uid : `draft-qa-admin-${suffix}`; const requesterUid = reusable ? requester.uid : `draft-qa-requester-${suffix}`;
    const branch = `draft-qa-branch-${suffix}`; const product = `draft-qa-product-${suffix}`;
    // Initialize only an empty emulator; never replace an existing Admin policy.
    const localPolicy = validateRegistrationSecurity({ ...SECURE_DEFAULTS, faceVerificationEnabled: false });
    const policyRef = db.doc('systemConfig/registrationSecurity');
    const publicPolicyRef = db.doc('publicConfig/registrationPolicy');
    const assertInitialPolicy = (policy, publicPolicy) => {
      if (policy.exists) throw new Error('Local QA registration policy already exists; do not overwrite it.');
      const defaultPublic = publicRegistrationPolicy(SECURE_DEFAULTS);
      if (publicPolicy.exists && Object.entries(defaultPublic).some(([key, value]) => publicPolicy.data()[key] !== value)) {
        throw new Error('Local QA public registration policy differs from the defaults; do not overwrite it.');
      }
    };
    assertInitialPolicy(...await Promise.all([policyRef.get(), publicPolicyRef.get()]));
    // createUser fails rather than modifying an existing emulator account.
    await auth.createUser({ uid: adminUid, email: admin.email, password: admin.password, emailVerified: true });
    await auth.setCustomUserClaims(adminUid, { admin: true, role: 'admin' });
    await db.runTransaction(async (tx) => {
      const [policy, publicPolicy] = await Promise.all([tx.get(policyRef), tx.get(publicPolicyRef)]);
      assertInitialPolicy(policy, publicPolicy);
      const updatedAt = new Date();
      tx.create(policyRef, { ...localPolicy, updatedAt, updatedBy: adminUid });
      tx.set(publicPolicyRef, { ...publicRegistrationPolicy(localPolicy), updatedAt });
      tx.create(db.collection('adminAuditLogs').doc(), {
        action: 'REGISTRATION_SECURITY_UPDATED', actorUid: adminUid,
        previousFaceVerificationEnabled: SECURE_DEFAULTS.faceVerificationEnabled, newFaceVerificationEnabled: false,
        previousEmailOtpEnabled: SECURE_DEFAULTS.emailOtpEnabled, newEmailOtpEnabled: localPolicy.emailOtpEnabled,
        previousMaxAccountsPerDevice: SECURE_DEFAULTS.maxAccountsPerDevice, newMaxAccountsPerDevice: localPolicy.maxAccountsPerDevice,
        previousMaxAccountsPerIp: SECURE_DEFAULTS.maxAccountsPerIp, newMaxAccountsPerIp: localPolicy.maxAccountsPerIp,
        previousSessionSecurity: SECURE_DEFAULTS.sessionSecurity, newSessionSecurity: localPolicy.sessionSecurity, createdAt: updatedAt,
      });
    });
    await auth.createUser({ uid: requesterUid, email: requester.email, password: requester.password, emailVerified: true });
    await Promise.all([
      db.doc(`users/${adminUid}`).set({ uid: adminUid, role: 'admin', accountStatus: 'active', fullName: 'Local QA Admin', email: admin.email, emailVerified: true }),
      db.doc(`users/${requesterUid}`).set({ uid: requesterUid, role: 'requester', accountStatus: 'active', fullName: 'Local QA Requester', firstName: 'Local QA', lastName: 'Requester', contactNumber: '09170000000', address: 'Local QA address', email: requester.email, emailVerified: true, onboardingCompleted: true, faceVerification: { required: false, status: 'not_required', verifiedAt: null, livenessPassed: null, duplicateCheck: 'not_required', verificationMode: 'not_required', providerVerified: false }, defaultDeliveryLocation: { latitude: 10.267, longitude: 123.584 } }),
      db.doc(`branches/${branch}`).set({ name: 'Local QA Branch', status: 'active', latitude: 10.267, longitude: 123.584, baseDeliveryFee: 7 }),
      db.doc(`products/${product}`).set({ product_name: 'Local QA Refill', price: 25, active: true, branchIds: [branch] }),
    ]);
    if (reusable) {
      for (const [role, account] of [['manager', manager], ['distributor', distributor]]) {
        const uid = account.uid;
        await auth.createUser({ uid, email: account.email, password: account.password, emailVerified: true });
        if (role === 'manager') await auth.setCustomUserClaims(uid, { manager: true, role: 'manager' });
        await db.doc(`users/${uid}`).create({ uid, email: account.email, role, accountStatus: 'active',
          branchId: branch, fullName: `Local QA ${role}`, firstName: 'Local QA', lastName: role,
          ...(role === 'manager' ? { managerStatus: 'active' } : { distributorStatus: 'active', approvalStatus: 'active',
            faceVerification: { required: false, status: 'not_required', verifiedAt: null, livenessPassed: null,
              duplicateCheck: 'not_required', verificationMode: 'not_required', providerVerified: false } }) });
      }
    }
    if (preview) {
      // A separate product protects the owner's draft. Publication uses the
      // existing Admin-authorized, emulator-gated handler, never an HTTP bypass.
      const demoProduct = `draft-qa-demo-product-${suffix}`;
      await db.doc(`products/${demoProduct}`).create({ product_name: 'Local QA Demo Refill', price: 25, active: true, branchIds: [branch] });
      const client = initializeApp({ projectId: 'demo-bluetap-local-qa', apiKey: 'fake-local-qa-key' }, `draft-preview-${suffix}`);
      try {
        const clientAuth = getAuth(client);
        connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
        const token = await (await signInWithEmailAndPassword(clientAuth, admin.email, admin.password)).user.getIdToken(true);
        const handler = createAdminProductsHandler(getAdmin, capability);
        const call = async (body) => {
          const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
          await handler({ method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body }, res);
          if (res.statusCode !== 200) throw new Error(`Local QA promotion setup failed: ${res.body?.error?.reason || res.statusCode}`);
        };
        await call({ productId: demoProduct, bundlePromotion: { expectedVersion: 0, title: 'Local QA Bundle', commercialEligibility: 'refill_verified', active: false, branchIds: [branch], containerChoices: ['Exchange', 'New Container'], tiers: [{ quantity: 3, bundlePriceCentavos: 7000 }, { quantity: 5, bundlePriceCentavos: 11500 }], startMode: 'activation', startsAt: null, endsAt: null } });
        await call({ productId: demoProduct, bundlePromotionAction: 'publish', expectedVersion: 1 });
      } finally { await deleteApp(client); }
    }
    console.log('Local QA is ready: backend at http://127.0.0.1:3000 and demo Auth/Firestore emulators.');
    console.log(preview ? 'Emulator-only promotion preview is enabled. Checkout remains at regular prices.' : 'Use the disposable Admin and Requester accounts supplied in this terminal. Promotion activation is disabled.');
    console.log('The disposable emulator registration policy does not require face verification; no biometric verification is claimed.');
  } catch (error) {
    server.close();
    throw error;
  }
}

main().catch((error) => { console.error(error.message || 'Unable to start isolated local QA.'); process.exitCode = 1; });
