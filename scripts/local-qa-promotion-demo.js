// Explicit, disposable local-QA fixture. Never mounted by ordinary routes.
const { randomUUID, randomBytes } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { assertLocalQaServerEnvironment } = require('../backend/config/localQaIsolation');
const { promotionTestCapability } = require('../backend/pricing/promotionTestCapability');
const { getFirebaseAdmin } = require('../backend/firebase/firebaseAdmin');
const { createAdminProductsHandler } = require('../backend/admin/productManagementHandler');
const { createRequesterCatalogHandler } = require('../backend/requester/orderingHandler');
const { routes } = require('../backend/routes');
const { createAppServer } = require('../backend/app');

const getAdmin = () => getFirebaseAdmin();
const capability = { emulatorPromotionPricing: true };
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });

async function main() {
  if (process.env.BLUETAP_PROMO_QA_DEMO !== '1' || process.env.GCLOUD_PROJECT !== 'demo-bluetap-local-qa' || !assertLocalQaServerEnvironment()) throw new Error('Explicit isolated local-QA enablement is required.');
  promotionTestCapability(getAdmin, capability);
  const email = String(process.env.BLUETAP_QA_REQUESTER_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.BLUETAP_QA_REQUESTER_PASSWORD || '');
  if (!/^[a-z0-9._%+-]+@example\.test$/.test(email) || password.length < 12) throw new Error('Set a disposable @example.test Requester email and password of at least 12 characters.');
  const { auth, db } = getAdmin();
  const suffix = randomUUID();
  const requesterUid = `promo-demo-requester-${suffix}`;
  const adminUid = `promo-demo-admin-${suffix}`;
  const adminEmail = `${adminUid}@example.test`;
  const adminPassword = randomBytes(24).toString('base64url');
  const branchId = `promo-demo-branch-${suffix}`;
  const productId = `promo-demo-product-${suffix}`;

  // createUser fails instead of overwriting an existing account.
  await auth.createUser({ uid: requesterUid, email, password, emailVerified: true });
  await auth.createUser({ uid: adminUid, email: adminEmail, password: adminPassword, emailVerified: true });
  await auth.setCustomUserClaims(adminUid, { admin: true, role: 'admin' });
  await Promise.all([
    db.doc(`users/${requesterUid}`).set({ uid: requesterUid, role: 'requester', accountStatus: 'active', fullName: 'Local QA Requester', firstName: 'Local QA', lastName: 'Requester', contactNumber: '09170000000', address: 'Local QA address', email, emailVerified: true, onboardingCompleted: true, faceVerification: { status: 'not_required', required: false }, defaultDeliveryLocation: { latitude: 10.267, longitude: 123.584 } }),
    db.doc(`users/${adminUid}`).set({ role: 'admin', accountStatus: 'active' }),
    db.doc(`branches/${branchId}`).set({ name: 'Local QA Branch', status: 'active', latitude: 10.267, longitude: 123.584, baseDeliveryFee: 7 }),
    db.doc(`products/${productId}`).set({ product_name: 'Local QA Refill', price: 20, active: true, branchIds: [branchId] }),
  ]);
  const client = initializeApp({ projectId: 'demo-bluetap-local-qa', apiKey: 'fake-local-qa-key' }, `promo-demo-${suffix}`);
  try {
    const clientAuth = getAuth(client);
    connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const token = await (await signInWithEmailAndPassword(clientAuth, adminEmail, adminPassword)).user.getIdToken(true);
    const handler = createAdminProductsHandler(getAdmin, { ...capability, logger: {} });
    const call = async (body) => {
      const res = response();
      await handler({ method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body }, res);
      if (res.statusCode !== 200) throw new Error(`Local QA promotion setup failed: ${res.body?.error?.reason || res.statusCode}`);
      return res.body;
    };
    await call({ productId, bundlePromotion: { expectedVersion: 0, title: 'Local QA Bundle', commercialEligibility: 'refill_verified', active: false, branchIds: [branchId], containerChoices: ['Exchange', 'New Container'], tiers: [{ quantity: 3, bundlePriceCentavos: 5500 }], startsAt: null, endsAt: null } });
    await call({ productId, bundlePromotionAction: 'publish', expectedVersion: 1 });
  } finally { await deleteApp(client); }

  // This cloned route map exists only in this loopback-only process. The
  // regular order and Admin HTTP routes retain their default closed gates.
  const qaRoutes = new Map(routes);
  qaRoutes.set('/api/requester/catalog', createRequesterCatalogHandler(getAdmin, capability));
  createAppServer(qaRoutes).listen(3000, '127.0.0.1', () => {
    console.log('Local QA promotion preview is ready on 127.0.0.1:3000.');
    console.log('Sign in with the disposable Requester credentials supplied in your terminal. The offer is a preview; ordinary checkout remains unchanged.');
  });
}

main().catch((error) => { console.error(error.message || 'Unable to start isolated local QA.'); process.exitCode = 1; });
