const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

process.env.APP_ENV = 'local-qa';
process.env.LOCAL_QA_EMULATORS = '1';
process.env.GCLOUD_PROJECT = 'demo-bluetap-local-qa';
process.env.FIREBASE_PROJECT_ID = 'demo-bluetap-local-qa';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_WEB_API_KEY = 'fake-local-qa-key';
process.env.EMAIL_OTP_HASH_SECRET = 'local-qa-hash-secret-isolated-32';
process.env.NODE_ENV = 'test';

const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: initClient, deleteApp: deleteClient } = require('firebase/app');
const { getAuth: getClientAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { createAdminProductsHandler } = require('../../admin/productManagementHandler');
const { promotionStatus } = require('../../../services/adminPromotionDraft');
const { calculateBundlePricing } = require('../bundlePricing');

const projectId = 'demo-bluetap-local-qa';

const response = () => ({
  statusCode: 200,
  headers: {},
  setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  end() { return this; },
});

async function call(handler, method, token, body, query) {
  const res = response();
  const url = query ? `/?${new URLSearchParams(query).toString()}` : '/';
  await handler({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body,
    query,
  }, res);
  return res;
}

test('Comprehensive atomic Save & Publish lifecycle with concurrency, capability gates and rollback safety', { timeout: 60000 }, async () => {
  const id = randomUUID();
  const app = initializeApp({ projectId }, `atomic-pub-${id}`);
  const db = getFirestore(app);
  const auth = getAuth(app);
  const client = initClient({ projectId, apiKey: 'synthetic-test-key' }, `atomic-client-${id}`);
  const clientAuth = getClientAuth(client);
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true });

  const adminUid = `admin-${id}`;
  const requesterUid = `requester-${id}`;
  const branchActiveId = `branch-active-${id}`;
  const branchInactiveId = `branch-inactive-${id}`;
  const productId = `prod-${id}`;
  const password = `Test-${id}-aA1!`;

  try {
    for (const [uid, role] of [[adminUid, 'admin'], [requesterUid, 'requester']]) {
      await auth.createUser({ uid, email: `${uid}@example.test`, password, emailVerified: true });
      if (role === 'admin') await auth.setCustomUserClaims(uid, { admin: true, role: 'admin' });
      await db.doc(`users/${uid}`).set({ role, accountStatus: 'active', fullName: `User ${uid}`, contactNumber: '09170000000', address: 'Toledo City' });
    }

    await Promise.all([
      db.doc(`branches/${branchActiveId}`).set({ name: 'bluetap Active', status: 'active', latitude: 10.377, longitude: 123.637, baseDeliveryFee: 15 }),
      db.doc(`branches/${branchInactiveId}`).set({ name: 'bluetap Inactive', status: 'inactive', latitude: 10.373, longitude: 123.636, baseDeliveryFee: 15 }),
      db.doc(`products/${productId}`).set({
        product_name: 'BlueTap 5-Gallon Purified Water',
        price: 25,
        active: true,
        branchIds: [branchActiveId, branchInactiveId],
        maxQuantityPerRequester: 10,
        containerType: 'Gallon Container',
        size: '18.9 Liters',
      }),
    ]);

    const adminCred = await signInWithEmailAndPassword(clientAuth, `${adminUid}@example.test`, password);
    const adminToken = await adminCred.user.getIdToken(true);
    const requesterCred = await signInWithEmailAndPassword(clientAuth, `${requesterUid}@example.test`, password);
    const requesterToken = await requesterCred.user.getIdToken(true);

    const getAdmin = () => ({ auth, db });
    const draftOnlyHandler = createAdminProductsHandler(getAdmin, { promotionDraftOnly: true, logger: {} });
    const standardHandler = createAdminProductsHandler(getAdmin, { logger: {} });
    const enabledCapabilityHandler = createAdminProductsHandler(getAdmin, { emulatorPromotionPricing: true, logger: {} });

    const baseDraft = {
      expectedVersion: 0,
      title: 'BlueTap 5-Gallon Refill Bundles',
      commercialEligibility: 'refill_verified',
      branchIds: [branchActiveId],
      containerChoices: ['Exchange'],
      tiers: [
        { quantity: 3, bundlePriceCentavos: 7000 },
        { quantity: 5, bundlePriceCentavos: 11000 },
        { quantity: 10, bundlePriceCentavos: 22000 },
      ],
      startMode: 'activation',
      startsAt: null,
      endsAt: null,
    };

    // 1. Save Draft when publication capability is disabled
    const draftRes = await call(draftOnlyHandler, 'PATCH', adminToken, { productId, bundlePromotion: { ...baseDraft, active: false } });
    assert.equal(draftRes.statusCode, 200);
    assert.equal(draftRes.body.product.bundlePromotion.version, 1);
    assert.equal(draftRes.body.product.bundlePromotion.active, false);
    assert.equal(promotionStatus(draftRes.body.product.bundlePromotion), 'Draft');

    // 2. Save & Publish blocked when capability is disabled
    const blockedPublish = await call(standardHandler, 'PATCH', adminToken, {
      productId,
      bundlePromotionAction: 'saveAndPublish',
      bundlePromotion: { ...baseDraft, expectedVersion: 1 },
    });
    assert.equal(blockedPublish.statusCode, 409);
    assert.equal(blockedPublish.body.error.reason, 'BUNDLE_PROMOTIONS_UNAVAILABLE');

    // Verify Firestore was NOT modified by blocked attempt
    let productSnap = await db.doc(`products/${productId}`).get();
    assert.equal(productSnap.data().bundlePromotion.version, 1);
    assert.equal(productSnap.data().bundlePromotion.active, false);

    // 3. Unauthorized access denied
    const unauthRes = await call(enabledCapabilityHandler, 'PATCH', requesterToken, {
      productId,
      bundlePromotionAction: 'saveAndPublish',
      bundlePromotion: { ...baseDraft, expectedVersion: 1 },
    });
    assert.equal(unauthRes.statusCode, 403);

    // 4. Stale expectedVersion rejected
    const staleRes = await call(enabledCapabilityHandler, 'PATCH', adminToken, {
      productId,
      bundlePromotionAction: 'saveAndPublish',
      bundlePromotion: { ...baseDraft, expectedVersion: 0 },
    });
    assert.equal(staleRes.statusCode, 409);
    assert.equal(staleRes.body.error.reason, 'BUNDLE_PROMOTION_STALE');

    // 5. Inactive branch rejected
    const inactiveBranchRes = await call(enabledCapabilityHandler, 'PATCH', adminToken, {
      productId,
      bundlePromotionAction: 'saveAndPublish',
      bundlePromotion: { ...baseDraft, expectedVersion: 1, branchIds: [branchInactiveId] },
    });
    assert.equal(inactiveBranchRes.statusCode, 409);
    assert.equal(inactiveBranchRes.body.error.reason, 'INVALID_PRODUCT_BRANCH');

    // 6. Invalid pricing (tier price >= regular line) rejected
    const invalidPriceRes = await call(enabledCapabilityHandler, 'PATCH', adminToken, {
      productId,
      bundlePromotionAction: 'saveAndPublish',
      bundlePromotion: { ...baseDraft, expectedVersion: 1, tiers: [{ quantity: 3, bundlePriceCentavos: 8000 }] },
    });
    assert.equal(invalidPriceRes.statusCode, 400);
    assert.equal(invalidPriceRes.body.error.reason, 'INVALID_BUNDLE_PROMOTION');

    // 7. Atomic Save & Publish with unsaved edits succeeds
    const publishRes = await call(enabledCapabilityHandler, 'PATCH', adminToken, {
      productId,
      bundlePromotionAction: 'saveAndPublish',
      bundlePromotion: {
        ...baseDraft,
        expectedVersion: 1,
        title: 'BlueTap 5-Gallon Refill Bundles (Published)',
      },
    });
    assert.equal(publishRes.statusCode, 200);
    assert.equal(publishRes.body.product.bundlePromotion.version, 2);
    assert.equal(publishRes.body.product.bundlePromotion.active, true);
    assert.equal(publishRes.body.product.bundlePromotion.title, 'BlueTap 5-Gallon Refill Bundles (Published)');
    assert.ok(publishRes.body.product.bundlePromotion.startsAt);
    assert.equal(promotionStatus(publishRes.body.product.bundlePromotion), 'Active');

    // Verify Firestore was atomically updated
    productSnap = await db.doc(`products/${productId}`).get();
    const livePromo = productSnap.data().bundlePromotion;
    assert.equal(livePromo.version, 2);
    assert.equal(livePromo.active, true);
    assert.equal(livePromo.title, 'BlueTap 5-Gallon Refill Bundles (Published)');

    // Verify audit log entry
    const auditLogs = await db.collection('adminAuditLogs').where('productId', '==', productId).get();
    const actions = auditLogs.docs.map((d) => d.data().action);
    assert.ok(actions.includes('BUNDLE_PROMOTION_PUBLISHED'));

    // 8. Reject editing an already active promotion
    const editActiveRes = await call(enabledCapabilityHandler, 'PATCH', adminToken, {
      productId,
      bundlePromotionAction: 'saveAndPublish',
      bundlePromotion: { ...baseDraft, expectedVersion: 2 },
    });
    assert.equal(editActiveRes.statusCode, 409);
    assert.equal(editActiveRes.body.error.reason, 'BUNDLE_PROMOTION_ACTIVE');

    // 9. Disable promotion stops the active promotion
    const disableRes = await call(enabledCapabilityHandler, 'PATCH', adminToken, {
      productId,
      bundlePromotionAction: 'disable',
      expectedVersion: 2,
    });
    assert.equal(disableRes.statusCode, 200);
    assert.equal(disableRes.body.product.bundlePromotion.active, false);
    assert.equal(disableRes.body.product.bundlePromotion.version, 3);
    assert.equal(promotionStatus(disableRes.body.product.bundlePromotion), 'Disabled');

    // 10. Pricing math validation: Pure function check using the live saved promotion
    const exchangePricing3 = calculateBundlePricing({
      items: [{ productId, quantity: 3, unitPriceAtOrder: 25, promotions: [livePromo] }],
      branchId: branchActiveId,
      container: 'Exchange',
      deliveryFee: 15,
    });
    assert.equal(exchangePricing3.regularSubtotalCentavos, 7500);
    assert.equal(exchangePricing3.promotionalSavingsCentavos, 500);
    assert.equal(exchangePricing3.deliveryFeeCentavos, 1500);
    assert.equal(exchangePricing3.payableCentavos, 8500);

    const exchangePricing10 = calculateBundlePricing({
      items: [{ productId, quantity: 10, unitPriceAtOrder: 25, promotions: [livePromo] }],
      branchId: branchActiveId,
      container: 'Exchange',
      deliveryFee: 15,
    });
    assert.equal(exchangePricing10.regularSubtotalCentavos, 25000);
    assert.equal(exchangePricing10.promotionalSavingsCentavos, 3000);
    assert.equal(exchangePricing10.deliveryFeeCentavos, 1500);
    assert.equal(exchangePricing10.payableCentavos, 23500);

    // New Container receives 0 discount when promotion is Exchange-only
    const newContainerPricing = calculateBundlePricing({
      items: [{ productId, quantity: 3, unitPriceAtOrder: 25, promotions: [livePromo] }],
      branchId: branchActiveId,
      container: 'New Container',
      deliveryFee: 15,
    });
    assert.equal(newContainerPricing.promotionalSavingsCentavos, 0);
    assert.equal(newContainerPricing.payableCentavos, 9000);
  } finally {
    await deleteClient(client);
    await deleteApp(app);
  }
});
