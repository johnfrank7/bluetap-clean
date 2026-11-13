const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp: initClient, deleteApp: deleteClient } = require('firebase/app');
const { getAuth: getClientAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { createAdminProductsHandler } = require('../../admin/productManagementHandler');
const { createRequesterCatalogHandler, createRequesterOrdersHandler } = require('../../requester/orderingHandler');
const { createManagerDispatchHandler } = require('../../manager/dispatchHandler');
const { createDistributorAssignedOrdersHandler } = require('../../distributor/assignedOrdersHandler');
const { createOrderDetailsHandler } = require('../../orders/orderDetailsHandler');
const { promotionStatus } = require('../../../services/adminPromotionDraft');
const { eligiblePromotionPreviews, promotionSessionKey, wasPromotionSeen, markPromotionSeen } = require('../../../services/promotionPresentation');
const { savedOrderPricing } = require('../../../services/savedOrderPricing');

const projectId = 'demo-bluetap';
const firestoreHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:18080' : '127.0.0.1:8080';
const authHost = process.env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ? '127.0.0.1:19099' : '127.0.0.1:9099';
const enabled = process.env.GCLOUD_PROJECT === 'demo-bluetap'
  && process.env.FIRESTORE_EMULATOR_HOST === firestoreHost
  && process.env.FIREBASE_AUTH_EMULATOR_HOST === authHost;

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

test('Phase F full isolated activation simulation across Admin, Requester, Manager and Distributor portals', { skip: !enabled, timeout: 120000 }, async () => {
  const id = randomUUID();
  const app = initializeApp({ projectId }, `phase-f-${id}`);
  const db = getFirestore(app);
  const auth = getAuth(app);
  const client = initClient({ projectId, apiKey: 'synthetic-local-key' }, `phase-f-client-${id}`);
  const clientAuth = getClientAuth(client);
  connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });

  const adminUid = `admin-${id}`;
  const managerUid = `manager-${id}`;
  const distributorUid = `distributor-${id}`;
  const requesterUid = `requester-${id}`;
  const branchId = `branch-${id}`;
  const productId = `product-${id}`;
  const password = `Test-${id}-aA1!`;

  try {
    for (const [uid, role] of [
      [adminUid, 'admin'],
      [managerUid, 'manager'],
      [distributorUid, 'distributor'],
      [requesterUid, 'requester'],
    ]) {
      await auth.createUser({ uid, email: `${uid}@example.test`, password, emailVerified: true });
      if (role !== 'requester') await auth.setCustomUserClaims(uid, { [role]: true, role });
    }

    await Promise.all([
      db.doc(`users/${adminUid}`).set({ role: 'admin', accountStatus: 'active', fullName: 'Test Admin' }),
      db.doc(`users/${managerUid}`).set({ role: 'manager', managerStatus: 'active', accountStatus: 'active', branchId, fullName: 'Test Manager' }),
      db.doc(`users/${distributorUid}`).set({
        role: 'distributor',
        distributorStatus: 'active',
        approvalStatus: 'approved',
        accountStatus: 'active',
        branchId,
        fullName: 'Test Distributor',
        phone: '09171112222',
        address: 'Distributor Address',
      }),
      db.doc(`distributorDispatchGuards/${distributorUid}`).set({
        schemaVersion: 1,
        initialized: true,
        distributorUid,
        revision: 0,
        reservations: [],
      }),
      db.doc(`users/${requesterUid}`).set({
        role: 'requester',
        accountStatus: 'active',
        fullName: 'Test Requester',
        contactNumber: '09170000000',
        address: 'Requester Address',
      }),
      db.doc(`branches/${branchId}`).set({
        name: 'Toledo Central Station',
        status: 'active',
        latitude: 10.267,
        longitude: 123.584,
        baseDeliveryFee: 7,
      }),
      db.doc(`products/${productId}`).set({
        product_name: '5-Gallon Purified Refill',
        price: 20,
        active: true,
        branchIds: [branchId],
        containerType: '5 Gallon',
        size: '5 Gallon',
      }),
    ]);

    const signIn = async (uid) => {
      const cred = await signInWithEmailAndPassword(clientAuth, `${uid}@example.test`, password);
      return { user: cred.user, token: await cred.user.getIdToken(true) };
    };
    const { token: adminToken } = await signIn(adminUid);
    const { token: managerToken } = await signIn(managerUid);
    const { token: distributorToken } = await signIn(distributorUid);
    const { user: requesterUser, token: requesterToken } = await signIn(requesterUid);

    const getAdmin = () => ({ auth, db });
    const draftHandler = createAdminProductsHandler(getAdmin, { promotionDraftOnly: true, logger: {} });
    const ordinaryAdminHandler = createAdminProductsHandler(getAdmin, { logger: {} });
    const testAdminHandler = createAdminProductsHandler(getAdmin, { emulatorPromotionPricing: true, logger: {} });
    const testCatalogHandler = createRequesterCatalogHandler(getAdmin, { emulatorPromotionPricing: true, emulatorPromotionCheckout: true });
    const testOrdersHandler = createRequesterOrdersHandler(getAdmin, { emulatorPromotionPricing: true });
    const managerDispatchHandler = createManagerDispatchHandler(getAdmin);
    const distributorOrdersHandler = createDistributorAssignedOrdersHandler(getAdmin);
    const orderDetailsHandler = createOrderDetailsHandler(getAdmin);

    // 1. Authorized Admin -> Save Draft
    const draftPayload = {
      expectedVersion: 0,
      title: 'Refill 3-Pack Saver',
      commercialEligibility: 'refill_verified',
      active: false,
      branchIds: [branchId],
      containerChoices: ['Exchange'],
      tiers: [{ quantity: 3, bundlePriceCentavos: 5500 }, { quantity: 5, bundlePriceCentavos: 9000 }],
      startMode: 'activation',
      startsAt: null,
      endsAt: null,
    };
    const draftRes = await call(draftHandler, 'PATCH', adminToken, { productId, bundlePromotion: draftPayload });
    assert.equal(draftRes.statusCode, 200);
    assert.equal(promotionStatus(draftRes.body.product.bundlePromotion), 'Draft');
    const blockedPublish = await call(ordinaryAdminHandler, 'PATCH', adminToken, { productId, bundlePromotionAction: 'publish', expectedVersion: 1 });
    assert.equal(blockedPublish.body.error.reason, 'BUNDLE_PROMOTIONS_UNAVAILABLE');

    // Draft must not appear in Requester catalog
    const catalogBeforePublish = await call(testCatalogHandler, 'GET', requesterToken);
    assert.equal(catalogBeforePublish.statusCode, 200);
    assert.equal(eligiblePromotionPreviews(catalogBeforePublish.body, branchId, 'Exchange').length, 0);

    // 2. Authorized Admin -> Publish through guarded test capability
    const publishRes = await call(testAdminHandler, 'PATCH', adminToken, {
      productId,
      bundlePromotionAction: 'publish',
      expectedVersion: 1,
    });
    assert.equal(publishRes.statusCode, 200);
    assert.equal(promotionStatus(publishRes.body.product.bundlePromotion), 'Active');

    // 3. Requester active offer, Popup and Banner eligibility
    const catalogAfterPublish = await call(testCatalogHandler, 'GET', requesterToken);
    assert.equal(catalogAfterPublish.statusCode, 200);
    assert.equal(catalogAfterPublish.body.promotionCheckoutEnabled, true);
    const activeOffers = eligiblePromotionPreviews(catalogAfterPublish.body, branchId, 'Exchange');
    assert.equal(activeOffers.length, 1);
    assert.equal(activeOffers[0].title, 'Refill 3-Pack Saver');
    const sessionKey = promotionSessionKey(requesterUser, activeOffers[0]);
    assert.equal(wasPromotionSeen(sessionKey), false);
    markPromotionSeen(sessionKey);
    assert.equal(wasPromotionSeen(sessionKey), true);

    // 4. Add Request -> Server-issued checkout quote -> Confirm promotional order
    const orderPayload = {
      branchId,
      container: 'Exchange',
      deliveryLocation: { latitude: 10.267, longitude: 123.584 },
      items: [{ productId, quantity: 3 }],
    };
    const quoteRes = await call(testOrdersHandler, 'POST', requesterToken, { ...orderPayload, action: 'quote-create' });
    assert.equal(quoteRes.statusCode, 200);
    assert.equal(quoteRes.body.pricingSnapshot.regularSubtotalCentavos, 6000);
    assert.equal(quoteRes.body.pricingSnapshot.promotionalSavingsCentavos, 500);
    assert.equal(quoteRes.body.pricingSnapshot.deliveryFeeCentavos, 700);
    assert.equal(quoteRes.body.pricingSnapshot.payableCentavos, 6200);

    const createRes = await call(testOrdersHandler, 'POST', requesterToken, {
      ...orderPayload,
      quoteId: quoteRes.body.quoteId,
    });
    assert.equal(createRes.statusCode, 201);
    const orderId = createRes.body.order.id;

    // 5. Verify saved prices in Requester, Manager, Distributor, and Admin View Details
    const { normalizeRequestDetails } = await import('../../../services/orderNormalizer.js');

    // Requester View Details
    const requesterOrdersRes = await call(testOrdersHandler, 'GET', requesterToken);
    assert.equal(requesterOrdersRes.statusCode, 200);
    const requesterOrder = requesterOrdersRes.body.orders.find((o) => o.id === orderId);
    assert.deepEqual(savedOrderPricing(requesterOrder), {
      items: [{
        name: '5-Gallon Purified Refill',
        quantity: 3,
        container: '5 Gallon',
        unitPrice: 20,
        regularAmount: 60,
        promotion: { title: 'Refill 3-Pack Saver', quantity: 3, savings: 5 },
      }],
      container: 'Exchange',
      subtotal: 60,
      savings: 5,
      discount: null,
      fee: 7,
      total: 62,
    });
    assert.equal(normalizeRequestDetails(requesterOrder).grandTotal, 62);

    // Manager accepts & assigns Distributor, then checks Manager View Details
    const acceptRes = await call(managerDispatchHandler, 'PATCH', managerToken, { orderId, action: 'accept-order' });
    assert.equal(acceptRes.statusCode, 200);
    const scheduledIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const assignRes = await call(managerDispatchHandler, 'PATCH', managerToken, {
      orderId,
      action: 'assign-distributor',
      distributorUid,
      scheduledAt: scheduledIso,
    });
    assert.equal(assignRes.statusCode, 200);
    const managerDispatchRes = await call(managerDispatchHandler, 'GET', managerToken);
    assert.equal(managerDispatchRes.statusCode, 200);
    const managerOrder = managerDispatchRes.body.orders.find((o) => o.id === orderId);
    assert.equal(savedOrderPricing(managerOrder).total, 62);
    assert.equal(savedOrderPricing(managerOrder).savings, 5);

    // Distributor View Details
    const distributorOrdersRes = await call(distributorOrdersHandler, 'GET', distributorToken);
    assert.equal(distributorOrdersRes.statusCode, 200);
    const distRawOrder = distributorOrdersRes.body.orders.find((o) => o.id === orderId);
    const distScreenOrder = { pricingDetailsSource: distRawOrder, id: distRawOrder.id };
    assert.equal(savedOrderPricing(distScreenOrder.pricingDetailsSource).total, 62);
    assert.equal(savedOrderPricing(distScreenOrder.pricingDetailsSource).savings, 5);

    // Admin View Details
    const adminDetailsRes = await call(orderDetailsHandler, 'GET', adminToken, undefined, { orderId });
    assert.equal(adminDetailsRes.statusCode, 200);
    assert.equal(savedOrderPricing(adminDetailsRes.body.order).total, 62);
    assert.equal(savedOrderPricing(adminDetailsRes.body.order).savings, 5);

    // 6. Authorized disable -> Verify status is Disabled, no new promotional orders, and existing order prices unchanged
    const disableRes = await call(ordinaryAdminHandler, 'PATCH', adminToken, {
      productId,
      bundlePromotionAction: 'disable',
      expectedVersion: 2,
    });
    assert.equal(disableRes.statusCode, 200);
    assert.equal(promotionStatus(disableRes.body.product.bundlePromotion), 'Disabled');

    const catalogAfterDisable = await call(testCatalogHandler, 'GET', requesterToken);
    assert.equal(eligiblePromotionPreviews(catalogAfterDisable.body, branchId, 'Exchange').length, 0);

    // Existing order retains its accepted historical pricing after promotion deactivation and product price change
    await db.doc(`products/${productId}`).update({ price: 30 });
    const storedFirstOrder = (await db.doc(`requests/${orderId}`).get()).data();
    assert.equal(storedFirstOrder.totalAtOrder, 62);
    assert.equal(storedFirstOrder.discountAmount, 5);
    assert.equal(savedOrderPricing(storedFirstOrder).total, 62);
    assert.equal(savedOrderPricing(storedFirstOrder).savings, 5);

    // Complete first order to release active-order guard, then place a new order and verify no discount is applied
    await db.doc(`requests/${orderId}`).update({ status: 'Delivered' });
    await db.doc(`requesterActiveOrders/${requesterUid}`).delete();
    await db.doc(`products/${productId}`).update({ price: 20 });

    const secondQuoteRes = await call(testOrdersHandler, 'POST', requesterToken, { ...orderPayload, action: 'quote-create' });
    assert.equal(secondQuoteRes.statusCode, 200);
    assert.equal(secondQuoteRes.body.pricingSnapshot.promotionalSavingsCentavos, 0);
    assert.equal(secondQuoteRes.body.pricingSnapshot.payableCentavos, 6700);
    const secondOrderRes = await call(testOrdersHandler, 'POST', requesterToken, {
      ...orderPayload,
      quoteId: secondQuoteRes.body.quoteId,
    });
    assert.equal(secondOrderRes.statusCode, 201);
    assert.equal(secondOrderRes.body.order.discountAmount, 0);
    assert.equal(secondOrderRes.body.order.totalAtOrder, 67);
  } finally {
    await deleteClient(client);
    await deleteApp(app);
  }
});
