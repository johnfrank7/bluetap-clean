const { randomUUID, createHash } = require('node:crypto');
const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { promotionCapability } = require('../pricing/promotionCapability');
const { requireRequester, requireVerifiedOperationalEmail } = require('../auth/authorization');
const { requireActiveAccount } = require('../auth/accountStatus');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { safeProduct, refreshLoadSnapshots } = require('../admin/productManagementHandler');
const { readOrderLoadEpoch, createOrderLoadSnapshot } = require('../utils/orderLoadSnapshot');
const { safeBranch } = require('../admin/branchManagementHandler');
const { DEFAULT_SERVICE_RADIUS_KM } = require('../../constants/toledoBarangays.json');
const { isActiveRequesterOrderStatus } = require('../../constants/requesterOrderStatus');
const { effectiveDeliveryDays, limitViolations } = require('../../services/productOrderPolicy');
const { requestedDateNeedsApproval, resolveEffectiveProductPolicy } = require('../utils/effectiveProductPolicy');
const { RELATIONSHIP_VERSION_BASELINE } = require('../utils/relationshipEpochs');
const { reconcileOrderLifecycleInTransaction } = require('../chat/conversationLifecycleService');
const { assertOrderingAllowed, recordOrderAbuseIncidentInTransaction } = require('../moderation/moderationService');
const { isMaterialEdit, savedPricingSnapshot, validateLegacyEditPricing, validateSavedPromotion, pricePromotionalEdit, assertPromotionalQuote } = require('../pricing/orderEditPricing');
const { calculateBundlePricing, cents } = require('../pricing/bundlePricing');
const {
  normalizeBranchDeliveryPricing,
  calculateDeliveryFee,
  calculateOrderTotal,
} = require('../pricing/deliveryPricingService');

const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const coordinate = (value, minimum, maximum) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
};
const validBranchLocation = (branch = {}) =>
  coordinate(branch.latitude, -90, 90) !== null && coordinate(branch.longitude, -180, 180) !== null;
const serviceRadiusKm = (branch = {}) => {
  const radius = Number(branch.serviceRadiusKm);
  return Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_SERVICE_RADIUS_KM;
};
const radians = (degrees) => degrees * (Math.PI / 180);
const distanceKm = (from, to) => {
  const earthRadiusKm = 6371;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  const bounded = Math.min(1, Math.max(0, a));
  return Math.round(earthRadiusKm * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded)) * 10) / 10;
};
const fullNameFor = (profile = {}) => clean(profile.fullName || `${profile.firstName || ''} ${profile.lastName || ''}`, 160);
const profileAddressFor = (profile = {}) => clean(
  profile.completeAddress || [profile.address, profile.barangay, profile.city].filter(Boolean).join(', '),
  300
);
const profileContactFor = (profile = {}) => clean(profile.phone || profile.contactNumber, 40);
const profileSummary = (profile = {}) => {
  const fullName = fullNameFor(profile);
  const contactNumber = profileContactFor(profile);
  const address = profileAddressFor(profile);
  return {
    fullName,
    contactNumber,
    address,
    email: clean(profile.email, 240).toLowerCase(),
    uniqueId: clean(profile.publicUid || profile.displayUid || profile.unique_id || profile.uniqueId, 80),
    complete: Boolean(fullName && contactNumber && address),
    defaultDeliveryLocation: profile.defaultDeliveryLocation || null,
  };
};
const productAvailableAtBranch = (product, branchId) => {
  const branchIds = Array.isArray(product.branchIds)
    ? product.branchIds
    : product.branchId ? [product.branchId] : [];
  return branchIds.length === 0 || branchIds.includes(branchId);
};
const safeOrder = (id, data = {}) => ({ id, ...data });
async function requireCurrentRequester(tx, db, requester) {
  const snapshot = await tx.get(db.collection('users').doc(requester.decoded.uid));
  const profile = snapshot.data() || {};
  if (!snapshot.exists || profile.role !== 'requester') throw new OtpError(403, 'REQUESTER_REQUIRED', 'Requester access is required.');
  if (profile.mustChangePassword === true) throw new OtpError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your temporary password before placing an order.');
  requireActiveAccount(profile, { inactiveMessage: 'This Requester account is inactive.' });
  await requireVerifiedOperationalEmail(profile, requester.decoded, { collection: (name) => ({ doc: (id) => ({ get: () => tx.get(db.collection(name).doc(id)) }) }) });
}
const editRevision = (snapshot) => {
  if (!snapshot?.exists) return null;
  const stamp = snapshot.updateTime;
  return stamp && Number.isInteger(stamp.seconds) && Number.isInteger(stamp.nanoseconds)
    ? `${stamp.seconds}:${stamp.nanoseconds}`
    : createHash('sha256').update(JSON.stringify(snapshot.data())).digest('hex');
};
const editIntent = (body) => ({
  items: requestItems(body),
  container: body.container === undefined ? null : clean(body.container, 80),
  notes: body.notes === undefined ? null : clean(body.notes, 500),
  expectedDeliveryDate: body.expectedDeliveryDate === undefined ? null : clean(body.expectedDeliveryDate, 40),
});
const editIntentHash = (body) => createHash('sha256').update(JSON.stringify(editIntent(body))).digest('hex');
const createIntentHash = (body) => createHash('sha256').update(JSON.stringify({
  branchId: clean(body.branchId, 128),
  deliveryLocation: {
    latitude: coordinate(body.deliveryLocation?.latitude, -90, 90),
    longitude: coordinate(body.deliveryLocation?.longitude, -180, 180),
    accuracy: coordinate(body.deliveryLocation?.accuracy, 0, 10000000),
  },
  container: clean(body.container, 80),
  expectedDeliveryDate: clean(body.expectedDeliveryDate, 40),
  items: requestItems(body),
})).digest('hex');
const comparablePricing = (snapshot) => {
  const { pricedAt, ...pricing } = snapshot || {};
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(pricing));
};
const editEligible = (snapshot, uid, branchId) => {
  const order = snapshot?.data() || {};
  return snapshot?.exists && (order.requesterUid || order.requester_id) === uid
    && ['pending', 'outside_radius_pending_approval', 'manager_approval_pending'].includes(String(order.status).toLowerCase())
    && !(order.assignedDistributorUid || order.distributor_id)
    && (order.branchId || order.currentBranchId) === branchId;
};

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); }
}

async function activeCatalog(db) {
  const [branchSnapshot, productSnapshot] = await Promise.all([
    db.collection('branches').get(),
    db.collection('products').get(),
  ]);
  const products = productSnapshot.docs
    .map((item) => safeProduct(item.id, item.data()))
    .filter((product) => product.active && product.product_name && product.price !== null);
  const branches = branchSnapshot.docs
    .map((item) => {
      const data = item.data() || {};
      return {
        ...safeBranch(item.id, data),
        productPolicies: Object.fromEntries(products.map((product) => {
          const policy = resolveEffectiveProductPolicy(product, data);
          return [product.id, { deliveryDays: policy.deliveryDays, maxQuantityPerRequester: policy.maxQuantityPerRequester, source: policy.source }];
        })),
      };
    })
    .filter((branch) => branch.status === 'active' && validBranchLocation(branch));
  return { branches, products };
}

function responseError(res, error) {
  const known = error instanceof OtpError;
  const details = known && error.details && typeof error.details === 'object' ? error.details : {};
  return res.status(known ? error.status : 500).json({ error: {
    reason: known ? error.reason : 'service-unavailable',
    message: known ? error.message : 'Ordering is temporarily unavailable.',
    ...(details.scope ? { scope: details.scope } : {}),
    ...(details.branchName ? { branchName: details.branchName } : {}),
    ...(details.endsAt ? { endsAt: details.endsAt } : {}),
  } });
}

function createRequesterCatalogHandler(getAdmin = getFirebaseAdmin, options = {}) {
  const capability = promotionCapability(getAdmin, options);
  const includePromotionPreview = capability.enabled;
  if (options.emulatorPromotionCheckout === true && !capability.test) throw new Error('Promotion checkout requires the isolated test capability.');
  return async (req, res) => {
    res.setHeader('Cache-Control', includePromotionPreview ? 'no-store' : 'private, max-age=30');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET.' } });
    try {
      const { auth, db } = getAdmin();
      const { profile, decoded } = await requireRequester(req, auth, db);
      const catalog = await activeCatalog(db);
      if (includePromotionPreview) {
        const { promotionPreviews } = require('../pricing/promotionPreview');
        const snapshot = await db.collection('products').get();
        const offers = promotionPreviews(snapshot.docs, catalog);
        const branchIds = [...new Set(offers.map((offer) => offer.branchId))];
        const allowed = await Promise.all(branchIds.map(async (branchId) => {
          try { await assertOrderingAllowed({ get: (ref) => ref.get() }, db, decoded.uid, branchId); return branchId; }
          catch { return null; }
        }));
        catalog.promotionPreviews = offers.filter((offer) => allowed.includes(offer.branchId));
        catalog.promotionPreviewOnly = capability.test;
        if (!capability.test || options.emulatorPromotionCheckout === true) catalog.promotionCheckoutEnabled = true;
      }
      return res.status(200).json({ ...catalog, profile: profileSummary(profile) });
    } catch (error) { return responseError(res, error); }
  };
}

function requestItems(body) {
  const source = Array.isArray(body.items) && body.items.length
    ? body.items
    : [{ productId: body.productId || body.product_id, quantity: body.quantity }];
  if (source.length > 20) throw new OtpError(400, 'TOO_MANY_ORDER_ITEMS', 'Choose no more than 20 products.');
  return source.map((item) => {
    const productId = clean(item.productId || item.product_id, 128);
    const quantity = Number(item.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new OtpError(400, 'INVALID_ORDER_ITEM', 'Each product needs a quantity between 1 and 100.');
    }
    return { productId, quantity };
  });
}

async function buildTrustedOrder(db, requester, body, read = (ref) => ref.get(), { promotionPricing = false } = {}) {
  const branchId = clean(body.branchId, 128);
  const latitude = coordinate(body.deliveryLocation?.latitude, -90, 90);
  const longitude = coordinate(body.deliveryLocation?.longitude, -180, 180);
  const accuracyNum = Number(body.deliveryLocation?.accuracy);
  const accuracy = Number.isFinite(accuracyNum) && accuracyNum >= 0 ? Math.round(accuracyNum * 10) / 10 : null;
  if (!branchId) throw new OtpError(400, 'BRANCH_REQUIRED', 'Select a provider branch.');
  if (latitude === null || longitude === null) throw new OtpError(400, 'DELIVERY_LOCATION_REQUIRED', 'Choose a valid delivery location.');
  const summary = profileSummary(requester.profile);
  if (!summary.complete) throw new OtpError(409, 'PROFILE_INCOMPLETE', 'Complete your profile before placing an order.');
  const branchSnapshot = await read(db.collection('branches').doc(branchId));
  const branchData = branchSnapshot.exists ? branchSnapshot.data() || {} : null;
  const branch = branchData ? safeBranch(branchId, branchData) : null;
  if (!branch) throw new OtpError(404, 'BRANCH_NOT_FOUND', 'The selected provider branch no longer exists.');
  if (branch.status !== 'active' || !validBranchLocation(branch)) {
    throw new OtpError(409, 'BRANCH_UNAVAILABLE', 'The selected provider branch is unavailable.');
  }
  const submittedItems = requestItems(body);
  if (new Set(submittedItems.map((item) => item.productId)).size !== submittedItems.length) throw new OtpError(400, 'DUPLICATE_ORDER_PRODUCT', 'Combine each product into a single order line.');
  const promotionsByProduct = new Map();
  const items = await Promise.all(submittedItems.map(async (item) => {
    const snapshot = await read(db.collection('products').doc(item.productId));
    if (!snapshot.exists) throw new OtpError(404, 'PRODUCT_NOT_FOUND', 'A selected product no longer exists.');
    const productData = snapshot.data();
    const product = safeProduct(snapshot.id, productData);
    if (promotionPricing) {
      cents(productData.price);
      const configured = productData.bundlePromotion;
      promotionsByProduct.set(product.id, configured == null ? [] : (Array.isArray(configured) ? configured : [configured]));
    }
    if (!product.active || product.price === null || !productAvailableAtBranch(product, branchId)) {
      throw new OtpError(409, 'PRODUCT_UNAVAILABLE', `${product.product_name || 'A selected product'} is not available from this branch.`);
    }
    const lineTotal = Math.round(product.price * item.quantity * 100) / 100;
    const effectivePolicy = resolveEffectiveProductPolicy(product, branchData);
    return {
      productId: product.id,
      productNameSnapshot: product.product_name,
      unitPriceAtOrder: product.price,
      quantity: item.quantity,
      totalAtOrder: lineTotal,
      containerTypeSnapshot: product.containerType || '',
      sizeSnapshot: product.size || '',
      loadClassificationSnapshot: product.deliveryLoadClassification,
      maxQuantityPerRequesterSnapshot: effectivePolicy.maxQuantityPerRequester,
      deliveryDaysSnapshot: effectivePolicy.deliveryDays,
      productPolicySourceSnapshot: effectivePolicy.source,
    };
  }));
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  let subtotalAtOrder = Math.round(items.reduce((sum, item) => sum + item.totalAtOrder, 0) * 100) / 100;
  const deliveryLocation = { latitude, longitude, ...(accuracy !== null ? { accuracy } : {}) };
  const distanceKmSnapshot = distanceKm(deliveryLocation, branch);
  const serviceRadiusKmSnapshot = serviceRadiusKm(branch);
  const outsideServiceArea = distanceKmSnapshot > serviceRadiusKmSnapshot;
  const productLimitViolations = limitViolations(items);
  const effectiveDeliveryDaysSnapshot = effectiveDeliveryDays(items);
  const deliveryDayApprovalRequired = requestedDateNeedsApproval(body.expectedDeliveryDate, effectiveDeliveryDaysSnapshot);
  const approvalReasons = [
    ...(outsideServiceArea ? ['OUTSIDE_RADIUS'] : []),
    ...(productLimitViolations.length ? ['PRODUCT_LIMIT_EXCEEDED'] : []),
    ...(deliveryDayApprovalRequired ? ['NON_STANDARD_DELIVERY_DAY'] : []),
  ];
  const branchPricing = normalizeBranchDeliveryPricing(branch);
  const deliveryFeeAtOrder = calculateDeliveryFee(distanceKmSnapshot, branchPricing);
  let totalAtOrder = calculateOrderTotal(subtotalAtOrder, deliveryFeeAtOrder);
  let pricingSnapshot;
  if (promotionPricing) {
    pricingSnapshot = calculateBundlePricing({ items: items.map((item) => ({ ...item, promotions: promotionsByProduct.get(item.productId) })), branchId, container: clean(body.container, 80), deliveryFee: deliveryFeeAtOrder });
    subtotalAtOrder = pricingSnapshot.regularSubtotalCentavos / 100;
    totalAtOrder = pricingSnapshot.payableCentavos / 100;
    for (let i = 0; i < items.length; i += 1) items[i].totalAtOrder = (pricingSnapshot.items[i].regularLineCentavos - (pricingSnapshot.items[i].promotion?.savingsCentavos || 0)) / 100;
  }
  const deliveryFeePolicy = {
    baseDeliveryFee: branchPricing.baseDeliveryFee,
    includedRadiusKm: branchPricing.includedRadiusKm,
    outsideRadiusFeePerKm: branchPricing.outsideRadiusFeePerKm,
    serviceRadiusKm: branchPricing.serviceRadiusKm,
  };
  return {
    requesterUid: requester.decoded.uid,
    requester_id: requester.decoded.uid,
    requesterNameSnapshot: summary.fullName,
    requester_name: summary.fullName,
    requesterUniqueIdSnapshot: summary.uniqueId,
    requester_unique_id: summary.uniqueId,
    contactNumberSnapshot: summary.contactNumber,
    contact_number: summary.contactNumber,
    addressSnapshot: summary.address,
    address: summary.address,
    branchId,
    initialBranchId: branchId,
    currentBranchId: branchId,
    branchNameSnapshot: branch.name,
    initialBranchNameSnapshot: branch.name,
    branchAddressSnapshot: [branch.address, branch.barangay, branch.city].filter(Boolean).join(', '),
    branchLocation: { latitude: branch.latitude, longitude: branch.longitude },
    water_station: branch.name,
    deliveryLocation,
    distanceKmSnapshot,
    distanceKmAtOrder: distanceKmSnapshot,
    serviceRadiusKmSnapshot,
    outsideServiceArea,
    approvalReasons,
    productLimitViolations,
    effectiveDeliveryDaysSnapshot,
    deliveryDayApprovalRequired,
    items,
    productId: items[0]?.productId || '',
    product_id: items[0]?.productId || '',
    productNameSnapshot: items.map((item) => item.productNameSnapshot).join(', '),
    product_name: items.map((item) => item.productNameSnapshot).join(', '),
    unitPriceAtOrder: items[0]?.unitPriceAtOrder || 0,
    product_price: items[0]?.unitPriceAtOrder || 0,
    quantity,
    subtotalAtOrder,
    deliveryFeeAtOrder,
    ...(pricingSnapshot ? { pricingSnapshot, discountAmount: pricingSnapshot.promotionalSavingsCentavos / 100 } : {}),
    deliveryFeePolicy,
    totalAtOrder,
    total_cost: totalAtOrder,
    paymentMethod: 'cash_on_delivery',
    payment_method: 'cash_on_delivery',
    container: clean(body.container, 80),
    expectedDeliveryDate: body.expectedDeliveryDate ? clean(body.expectedDeliveryDate, 40) : '',
    delivery_date: body.expectedDeliveryDate ? clean(body.expectedDeliveryDate, 40) : '',
    status: productLimitViolations.length || deliveryDayApprovalRequired ? 'manager_approval_pending' : outsideServiceArea ? 'outside_radius_pending_approval' : 'Pending',
  };
}

const inFlightRequesterCreations = new Set();

function createRequesterOrdersHandler(getAdmin = getFirebaseAdmin, options = {}) {
  const promotionPricing = promotionCapability(getAdmin, options).enabled;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET, POST, or PATCH.' } });
    try {
      const { auth, db } = getAdmin();
      const requester = await requireRequester(req, auth, db);
      if (req.method === 'GET') {
        const snapshot = await db.collection('requests').where('requesterUid', '==', requester.decoded.uid).get();
        return res.status(200).json({ orders: snapshot.docs.map((item) => safeOrder(item.id, item.data())) });
      }
      const body = bodyOf(req);
      if (req.method === 'PATCH') {
        const orderId = clean(body.orderId, 128);
        const ref = db.collection('requests').doc(orderId);
        const snapshot = orderId ? await ref.get() : null;
        const current = snapshot?.data();
        if (!snapshot?.exists || (current.requesterUid || current.requester_id) !== requester.decoded.uid) throw new OtpError(404, 'ORDER_NOT_FOUND', 'Order not found.');
        const isPending = ['pending', 'outside_radius_pending_approval', 'manager_approval_pending'].includes(String(current.status).toLowerCase());

        if (body.action === 'edit-order' && body.quoteId) {
          if (typeof body.quoteId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.quoteId)) throw new OtpError(400, 'INVALID_EDIT_QUOTE', 'Request a new price quote.');
          const quoteRef = db.collection('requesterEditQuotes').doc(body.quoteId);
          const intentHash = editIntentHash(body);
          const saved = await db.runTransaction(async (tx) => {
            const [latestSnapshot, quoteSnapshot] = await Promise.all([tx.get(ref), tx.get(quoteRef)]);
            const latest = latestSnapshot.data() || {};
            const quote = quoteSnapshot.data() || {};
            if (!quoteSnapshot.exists || quote.orderId !== orderId || quote.requesterUid !== requester.decoded.uid || quote.intentHash !== intentHash || (latest.requesterUid || latest.requester_id) !== requester.decoded.uid) throw new OtpError(409, 'INVALID_EDIT_QUOTE', 'This quote does not match the proposed changes.');
            if (quote.applied === true) return latest;
            const expiry = typeof quote.expiresAt?.toMillis === 'function' ? quote.expiresAt.toMillis() : new Date(quote.expiresAt).getTime();
            if (!Number.isFinite(expiry) || Date.now() >= expiry || !editEligible(latestSnapshot, requester.decoded.uid, quote.branchId) || editRevision(latestSnapshot) !== quote.orderRevision) throw new OtpError(409, 'EDIT_QUOTE_STALE', 'The quote expired or the order changed. Request a new quote.');
            const dependencies = await Promise.all(quote.dependencies.map((item) => tx.get(db.collection(item.collection).doc(item.id))));
            if (dependencies.some((item, index) => editRevision(item) !== quote.dependencies[index].revision)) throw new OtpError(409, 'EDIT_QUOTE_STALE', 'Product or branch pricing changed. Request a new quote.');
            if (quote.updates.pricingSnapshot) {
              await requireCurrentRequester(tx, db, requester);
              if (quote.promotionPricing !== promotionPricing) throw new OtpError(409, 'EDIT_QUOTE_STALE', 'Promotional pricing changed. Request a new quote.');
              validateSavedPromotion(latest, quote.branchId);
              assertPromotionalQuote(quote.updates, dependencies.slice(1), quote.branchId, quote.updates.container, latest.deliveryFeeAtOrder, { promotionPricing });
            }
            const updatedItems = await refreshLoadSnapshots(tx, db, quote.updates.items);
            const epoch = await readOrderLoadEpoch(tx, db);
            const loadSnapshot = createOrderLoadSnapshot(orderId, updatedItems, epoch);
            const now = new Date();
            const updates = { ...quote.updates, items: updatedItems, updatedAt: now, updated_at: now };
            const previousPricing = savedPricingSnapshot(latest);
            const newPricing = savedPricingSnapshot({ ...latest, ...updates });
            updates.editHistory = [...(Array.isArray(latest.editHistory) ? latest.editHistory : []), { editedBy: requester.decoded.uid, role: 'requester', editedAt: now, quoteId: body.quoteId, previousPricing, newPricing }];
            tx.update(ref, updates);
            if (loadSnapshot) tx.set(db.collection('orderLoadSnapshots').doc(orderId), loadSnapshot);
            else tx.delete(db.collection('orderLoadSnapshots').doc(orderId));
            tx.update(quoteRef, { applied: true, appliedAt: now });
            return { ...latest, ...updates };
          });
          return res.status(200).json({ order: safeOrder(orderId, saved) });
        }

        if (body.action === 'edit-order' || body.action === 'quote-edit') {
          if (!isPending) {
            throw new OtpError(409, 'ORDER_NOT_EDITABLE', 'Only pending orders can be edited.');
          }

          const submittedItems = requestItems(body);
          if (new Set(submittedItems.map((item) => item.productId)).size !== submittedItems.length) throw new OtpError(400, 'DUPLICATE_ORDER_PRODUCT', 'Combine each product into a single order line.');
          const branchId = current.branchId || current.currentBranchId;
          if (!isMaterialEdit(current, submittedItems, body.container)) {
            if (body.action === 'quote-edit') return res.status(200).json({ requiresConfirmation: false });
            if (typeof db.runTransaction !== 'function') throw new OtpError(500, 'ORDER_TRANSACTION_REQUIRED', 'Order editing is temporarily unavailable.');
            const now = new Date();
            const saved = await db.runTransaction(async (tx) => {
              const latestSnapshot = await tx.get(ref);
              const latest = latestSnapshot.data() || {};
              const allowed = latestSnapshot.exists && (latest.requesterUid || latest.requester_id) === requester.decoded.uid
                && ['pending', 'outside_radius_pending_approval', 'manager_approval_pending'].includes(String(latest.status).toLowerCase())
                && !(latest.assignedDistributorUid || latest.distributor_id)
                && (latest.branchId || latest.currentBranchId) === branchId;
              const changed = snapshot.updateTime && latestSnapshot.updateTime && !snapshot.updateTime.isEqual(latestSnapshot.updateTime);
              if (!allowed || changed || isMaterialEdit(latest, submittedItems, body.container)) throw new OtpError(409, 'ORDER_NOT_EDITABLE', 'This order changed. Refresh before editing.');
              const note = body.notes !== undefined ? clean(body.notes, 500) : (latest.notes || '');
              const pricing = savedPricingSnapshot(latest);
              const update = { notes: note, specialInstructions: body.notes !== undefined ? note : (latest.specialInstructions || ''), updatedAt: now, updated_at: now,
                editHistory: [...(Array.isArray(latest.editHistory) ? latest.editHistory : []), { editedBy: requester.decoded.uid, role: 'requester', editedAt: now, previousPricing: pricing, newPricing: pricing }] };
              tx.update(ref, update);
              return { ...latest, ...update };
            });
            return res.status(200).json({ order: safeOrder(orderId, saved) });
          }
          if (body.action !== 'quote-edit') throw new OtpError(409, 'EDIT_QUOTE_REQUIRED', 'Review and confirm a current price quote before changing the order.');
          if (current.initialBranchId && current.initialBranchId !== branchId) throw new OtpError(409, 'EDIT_TRANSFER_PRICING_REVIEW_REQUIRED', 'Transferred order pricing requires review before changing its items.');
          const branchSnapshot = branchId ? await db.collection('branches').doc(branchId).get() : null;
          const branchData = branchSnapshot?.exists ? branchSnapshot.data() || {} : {};
          const productSnapshots = [];
          const items = await Promise.all(submittedItems.map(async (item) => {
            const productSnap = await db.collection('products').doc(item.productId).get();
            productSnapshots.push({ id: item.productId, snapshot: productSnap });
            if (!productSnap.exists) throw new OtpError(404, 'PRODUCT_NOT_FOUND', 'A selected product no longer exists.');
            const product = safeProduct(productSnap.id, productSnap.data());
            if (!product.active || product.price === null || !productAvailableAtBranch(product, branchId)) {
              throw new OtpError(409, 'PRODUCT_UNAVAILABLE', `${product.product_name || 'A selected product'} is not available.`);
            }
            const effectivePolicy = resolveEffectiveProductPolicy(product, branchData);
            const lineTotal = Math.round(product.price * item.quantity * 100) / 100;
            return {
              productId: product.id,
              productNameSnapshot: product.product_name,
              unitPriceAtOrder: product.price,
              quantity: item.quantity,
              totalAtOrder: lineTotal,
              containerTypeSnapshot: product.containerType || '',
              sizeSnapshot: product.size || '',
              loadClassificationSnapshot: product.deliveryLoadClassification,
              maxQuantityPerRequesterSnapshot: effectivePolicy.maxQuantityPerRequester,
              deliveryDaysSnapshot: effectivePolicy.deliveryDays,
              productPolicySourceSnapshot: effectivePolicy.source,
            };
          }));

          const subtotalAtOrder = Math.round(items.reduce((sum, item) => sum + item.totalAtOrder, 0) * 100) / 100;
          const deliveryFeeAtOrder = typeof current.deliveryFeeAtOrder === 'number' ? current.deliveryFeeAtOrder : (typeof current.deliveryFee === 'number' ? current.deliveryFee : 0);
          const totalAtOrder = calculateOrderTotal(subtotalAtOrder, deliveryFeeAtOrder);
          const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
          const now = new Date();
          const productLimitViolations = limitViolations(items);
          const nextExpectedDeliveryDate = body.expectedDeliveryDate || current.expectedDeliveryDate;
          const effectiveDeliveryDaysSnapshot = effectiveDeliveryDays(items);
          const deliveryDayApprovalRequired = requestedDateNeedsApproval(nextExpectedDeliveryDate, effectiveDeliveryDaysSnapshot);
          const approvalReasons = [
            ...(current.outsideServiceArea === true ? ['OUTSIDE_RADIUS'] : []),
            ...(productLimitViolations.length ? ['PRODUCT_LIMIT_EXCEEDED'] : []),
            ...(deliveryDayApprovalRequired ? ['NON_STANDARD_DELIVERY_DAY'] : []),
          ];

          const updates = {
            items,
            approvalReasons,
            productLimitViolations,
            deliveryDayApprovalRequired,
            effectiveDeliveryDaysSnapshot,
            status: productLimitViolations.length || deliveryDayApprovalRequired ? 'manager_approval_pending' : current.outsideServiceArea === true ? 'outside_radius_pending_approval' : 'Pending',
            productId: items[0]?.productId || '',
            product_id: items[0]?.productId || '',
            productNameSnapshot: items.map((item) => item.productNameSnapshot).join(', '),
            product_name: items.map((item) => item.productNameSnapshot).join(', '),
            unitPriceAtOrder: items[0]?.unitPriceAtOrder || 0,
            product_price: items[0]?.unitPriceAtOrder || 0,
            quantity,
            subtotalAtOrder,
            totalAtOrder,
            total_cost: totalAtOrder,
            container: body.container !== undefined ? clean(body.container, 80) : (current.container || ''),
            notes: body.notes !== undefined ? clean(body.notes, 500) : (current.notes || ''),
            specialInstructions: body.notes !== undefined ? clean(body.notes, 500) : (current.specialInstructions || ''),
            updatedAt: now,
            updated_at: now,
            editHistory: [
              ...(Array.isArray(current.editHistory) ? current.editHistory : []),
              {
                editedBy: requester.decoded.uid,
                role: 'requester',
                editedAt: now,
                previousSubtotal: current.subtotalAtOrder || current.totalAtOrder,
                newSubtotal: subtotalAtOrder,
                newTotal: totalAtOrder,
              },
            ],
          };

          const oldTotal = current.totalAtOrder ?? current.total_cost;
          const oldFee = current.deliveryFeeAtOrder ?? current.deliveryFee;
          const oldDiscount = current.discountAmount ?? current.discount;
          if (!branchSnapshot?.exists || oldTotal == null || oldFee == null || !Number.isFinite(Number(oldTotal)) || Number(oldTotal) < 0 || !Number.isFinite(Number(oldFee)) || Number(oldFee) < 0 || (!current.pricingSnapshot && oldDiscount != null && (!Number.isFinite(Number(oldDiscount)) || Number(oldDiscount) !== 0))) throw new OtpError(409, 'EDIT_PRICING_UNAVAILABLE', 'Saved order pricing requires branch review before changing this order.');
          if (current.pricingSnapshot) {
            validateSavedPromotion(current, branchId);
            Object.assign(updates, pricePromotionalEdit(items, productSnapshots.map(({ snapshot: productSnapshot }) => productSnapshot), branchId, updates.container, current.deliveryFeeAtOrder, { promotionPricing }));
            if (current.discount != null) updates.discount = updates.discountAmount;
            if (current.subtotal != null) updates.subtotal = updates.subtotalAtOrder;
          } else validateLegacyEditPricing(current);
          const quoteRef = db.collection('requesterEditQuotes').doc();
          const dependencies = [{ collection: 'branches', id: branchId, revision: editRevision(branchSnapshot) }, ...productSnapshots.map(({ id, snapshot: productSnapshot }) => ({ collection: 'products', id, revision: editRevision(productSnapshot) }))];
          const before = savedPricingSnapshot(current);
          const after = savedPricingSnapshot({ ...current, ...updates });
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
          await db.runTransaction(async (tx) => {
            const [latestSnapshot, ...latestDependencies] = await Promise.all([tx.get(ref), ...dependencies.map((item) => tx.get(db.collection(item.collection).doc(item.id)))]);
            if (!editEligible(latestSnapshot, requester.decoded.uid, branchId) || editRevision(latestSnapshot) !== editRevision(snapshot) || latestDependencies.some((item, index) => editRevision(item) !== dependencies[index].revision)) throw new OtpError(409, 'EDIT_QUOTE_STALE', 'The order or pricing changed. Request a new quote.');
            if (updates.pricingSnapshot) {
              await requireCurrentRequester(tx, db, requester);
              assertPromotionalQuote(updates, latestDependencies.slice(1), branchId, updates.container, current.deliveryFeeAtOrder, { promotionPricing });
            }
            const { editHistory, ...quotedUpdates } = updates;
            tx.set(quoteRef, { orderId, requesterUid: requester.decoded.uid, branchId, orderRevision: editRevision(latestSnapshot), dependencies, intentHash: editIntentHash(body), updates: quotedUpdates, promotionPricing, expiresAt, applied: false });
          });
          return res.status(200).json({ requiresConfirmation: true, quoteId: quoteRef.id, expiresAt: expiresAt.toISOString(), before, after });

        }

        if (!isPending) throw new OtpError(409, 'ORDER_NOT_CANCELLABLE', 'Only pending orders can be cancelled.');
        const now = new Date();
        if (typeof db.runTransaction !== 'function') throw new OtpError(500, 'CHAT_RECONCILIATION_REQUIRED', 'Order cancellation requires transactional chat reconciliation.');
        const cancelled = await db.runTransaction(async (tx) => {
          const latestSnapshot = await tx.get(ref);
          const latest = latestSnapshot.data() || {};
          const latestPending = latestSnapshot.exists
            && (latest.requesterUid || latest.requester_id) === requester.decoded.uid
            && ['pending', 'outside_radius_pending_approval', 'manager_approval_pending'].includes(String(latest.status).toLowerCase());
          if (!latestPending) throw new OtpError(409, 'ORDER_NOT_CANCELLABLE', 'Only pending orders can be cancelled.');
          const cancellationStage = String(latest.status || 'pending').trim().toLowerCase().replace(/[\s-]+/g, '_');
          const updates = {
            status: 'Cancelled',
            updatedAt: now,
            updated_at: now,
            cancelledAt: now,
            cancellationStageSnapshot: cancellationStage,
            cancellationActorRole: 'requester',
          };
          const guardRef = db.collection('requesterActiveOrders').doc(requester.decoded.uid);
          const guard = await tx.get(guardRef);
          await reconcileOrderLifecycleInTransaction({
            tx,
            db,
            before: { id: orderId, ...latest },
            after: { id: orderId, ...latest, ...updates },
            event: 'ORDER_CANCELLED',
            now,
          });
          await recordOrderAbuseIncidentInTransaction({
            tx,
            db,
            orderId,
            order: { ...latest, ...updates },
            incidentType: 'cancellation',
            category: 'REQUESTER_CANCELLED',
            stage: cancellationStage,
            now,
          });
          tx.update(ref, updates);
          if (guard.exists && guard.data()?.orderId === orderId) tx.delete(guardRef);
          return { ...latest, ...updates };
        });
        return res.status(200).json({ order: safeOrder(orderId, cancelled) });
      }

      if (body.action === 'quote-create') {
        if (!promotionPricing) throw new OtpError(409, 'PROMOTIONS_UNAVAILABLE', 'Promotional checkout is unavailable.');
        const active = await db.collection('requests').where('requesterUid', '==', requester.decoded.uid).get();
        if (active.docs.some((doc) => isActiveRequesterOrderStatus(doc.data()?.status))) throw new OtpError(409, 'ACTIVE_ORDER_EXISTS', 'You already have an active order in progress.');
        const quoteRef = db.collection('requesterCreateQuotes').doc();
        const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
        let pricingSnapshot;
        await db.runTransaction(async (tx) => {
          await requireCurrentRequester(tx, db, requester);
          await assertOrderingAllowed(tx, db, requester.decoded.uid, clean(body.branchId, 128), Date.now());
          const guard = await tx.get(db.collection('requesterActiveOrders').doc(requester.decoded.uid));
          if (guard.exists && guard.data()?.orderId) {
            const order = await tx.get(db.collection('requests').doc(guard.data().orderId));
            if (order.exists && isActiveRequesterOrderStatus(order.data()?.status)) throw new OtpError(409, 'ACTIVE_ORDER_EXISTS', 'You already have an active order in progress.');
          }
          const dependencies = [];
          const proposed = await buildTrustedOrder(db, requester, body, async (ref) => {
            const snapshot = await tx.get(ref);
            dependencies.push({ path: ref.path, revision: editRevision(snapshot) });
            return snapshot;
          }, { promotionPricing: true });
          pricingSnapshot = proposed.pricingSnapshot;
          tx.set(quoteRef, { requesterUid: requester.decoded.uid, intentHash: createIntentHash(body), dependencies, pricingSnapshot, expiresAt, applied: false });
        });
        return res.status(200).json({ quoteId: quoteRef.id, expiresAt: expiresAt.toISOString(), pricingSnapshot });
      }

      // A quote issued before a capability change must never be silently
      // converted into an unquoted, regular-price order after rollback.
      if (!promotionPricing && body.quoteId != null) {
        throw new OtpError(409, 'PROMOTIONS_UNAVAILABLE', 'The offer is unavailable. Review your request again.');
      }

      await assertOrderingAllowed({ get: (ref) => ref.get() }, db, requester.decoded.uid, clean(body.branchId || body.currentBranchId, 128), Date.now());

      // Check process-level in-flight creation (local optimization against rapid double-clicks)
      if (inFlightRequesterCreations.has(requester.decoded.uid)) {
        throw new OtpError(409, 'ACTIVE_ORDER_EXISTS', 'You already have an active order in progress. You can only place one order at a time.');
      }
      inFlightRequesterCreations.add(requester.decoded.uid);
      try {
        // 1. Check existing orders for active order (to quickly catch non-terminal orders)
        const existingSnapshot = await db.collection('requests').where('requesterUid', '==', requester.decoded.uid).get();
        const hasActive = existingSnapshot.docs.some((doc) => isActiveRequesterOrderStatus(doc.data()?.status));
        if (hasActive) {
          throw new OtpError(409, 'ACTIVE_ORDER_EXISTS', 'You already have an active order in progress. You can only place one order at a time.');
        }

        // 2. Build trusted order
        const trusted = await buildTrustedOrder(db, requester, body);
        const guardRef = db.collection('requesterActiveOrders').doc(requester.decoded.uid);
        const userRef = db.collection('users').doc(requester.decoded.uid);
        const ref = db.collection('requests').doc();
        const now = new Date();
        const requestNumber = `BT-${now.getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
        const saved = { ...trusted, assignmentVersion: RELATIONSHIP_VERSION_BASELINE, requestId: requestNumber, request_id: requestNumber, createdAt: now, created_at: now, updatedAt: now, updated_at: now };

        const shouldSaveDefault = !requester.profile.defaultDeliveryLocation || body.saveAsDefaultLocation === true;
        const defaultDeliveryLocation = shouldSaveDefault ? {
          latitude: trusted.deliveryLocation.latitude,
          longitude: trusted.deliveryLocation.longitude,
          ...(trusted.deliveryLocation.accuracy != null ? { accuracy: trusted.deliveryLocation.accuracy } : {}),
          formattedAddress: trusted.addressSnapshot,
          barangay: clean(requester.profile.barangay, 120),
          updatedAt: now,
        } : null;

        if (typeof db.runTransaction === 'function') {
          await db.runTransaction(async (tx) => {
            await assertOrderingAllowed(tx, db, requester.decoded.uid, trusted.branchId, now);
            let quoteRef;
            let quote;
            if (promotionPricing) {
              await requireCurrentRequester(tx, db, requester);
              if (body.quoteId != null) {
                if (typeof body.quoteId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.quoteId)) throw new OtpError(409, 'CREATE_QUOTE_REQUIRED', 'Review a current price quote before placing this order.');
                quoteRef = db.collection('requesterCreateQuotes').doc(body.quoteId);
                const quoteSnapshot = await tx.get(quoteRef);
                quote = quoteSnapshot.data() || {};
                const expiry = typeof quote.expiresAt?.toMillis === 'function' ? quote.expiresAt.toMillis() : new Date(quote.expiresAt).getTime();
                if (!quoteSnapshot.exists || quote.requesterUid !== requester.decoded.uid || quote.intentHash !== createIntentHash(body) || quote.applied === true || !Number.isFinite(expiry) || Date.now() >= expiry || !Array.isArray(quote.dependencies)) throw new OtpError(409, 'CREATE_QUOTE_STALE', 'The price quote changed or expired. Review your request again.');
                const revisions = await Promise.all(quote.dependencies.map((entry) => {
                  const [collection, id, extra] = String(entry.path || '').split('/');
                  if (!['branches', 'products'].includes(collection) || !id || extra) throw new OtpError(409, 'CREATE_QUOTE_STALE', 'The price quote is invalid. Review your request again.');
                  return tx.get(db.collection(collection).doc(id));
                }));
                if (revisions.some((entry, index) => editRevision(entry) !== quote.dependencies[index].revision)) throw new OtpError(409, 'CREATE_QUOTE_STALE', 'Product or branch pricing changed. Review your request again.');
              }
            }
            if (typeof tx.get === 'function') {
              const guardSnap = await tx.get(guardRef);
              if (guardSnap && guardSnap.exists) {
                const guardData = guardSnap.data() || {};
                if (guardData.orderId) {
                  const activeDocRef = db.collection('requests').doc(guardData.orderId);
                  const activeSnap = await tx.get(activeDocRef);
                  if (activeSnap && activeSnap.exists && isActiveRequesterOrderStatus(activeSnap.data()?.status)) {
                    throw new OtpError(409, 'ACTIVE_ORDER_EXISTS', 'You already have an active order in progress. You can only place one order at a time.');
                  }
                }
              }
            }
            // Rebuild from transaction reads so a concurrent catalog or branch
            // update retries the transaction instead of committing stale prices.
            Object.assign(saved, await buildTrustedOrder(db, requester, body, (productRef) => tx.get(productRef), { promotionPricing }));
            if (promotionPricing && !quote && saved.pricingSnapshot.promotionalSavingsCentavos > 0) throw new OtpError(409, 'CREATE_QUOTE_REQUIRED', 'Review a current price quote before placing this order.');
            if (quote && comparablePricing(saved.pricingSnapshot) !== comparablePricing(quote.pricingSnapshot)) throw new OtpError(409, 'CREATE_QUOTE_STALE', 'The offer changed. Review your request again.');
            saved.items = await refreshLoadSnapshots(tx, db, saved.items);
            const epoch = await readOrderLoadEpoch(tx, db);
            const loadSnapshot = createOrderLoadSnapshot(ref.id, saved.items, epoch);
            await reconcileOrderLifecycleInTransaction({
              tx,
              db,
              before: { id: ref.id },
              after: { id: ref.id, ...saved },
              event: 'ORDER_CREATED',
              now,
            });
            tx.set(ref, saved);
            if (quoteRef) tx.update(quoteRef, { applied: true, orderId: ref.id, appliedAt: now });
            if (loadSnapshot) tx.set(db.collection('orderLoadSnapshots').doc(ref.id), loadSnapshot);
            tx.set(guardRef, {
              orderId: ref.id,
              requestId: requestNumber,
              requesterUid: requester.decoded.uid,
              status: saved.status,
              createdAt: now,
            });
            if (defaultDeliveryLocation) {
              if (typeof tx.update === 'function') {
                tx.update(userRef, { defaultDeliveryLocation, updatedAt: now });
              } else if (typeof tx.set === 'function') {
                tx.set(userRef, { defaultDeliveryLocation, updatedAt: now });
              }
            }
          });
        } else {
          throw new OtpError(500, 'CHAT_RECONCILIATION_REQUIRED', 'Order creation requires transactional chat reconciliation.');
        }
        return res.status(201).json({ order: safeOrder(ref.id, saved) });
      } finally {
        inFlightRequesterCreations.delete(requester.decoded.uid);
      }
    } catch (error) { return responseError(res, error); }
  };
}

module.exports = { calculateDeliveryFee, createRequesterCatalogHandler, createRequesterOrdersHandler, distanceKm, productAvailableAtBranch, serviceRadiusKm };
