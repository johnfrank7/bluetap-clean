const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { requireActiveAccount } = require('../auth/accountStatus');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { createSupabaseProductImageStorage, decodeProductImage } = require('../services/supabaseStorage');
const { WEEKDAYS, productLimit, productDeliveryDays } = require('../../services/productOrderPolicy');
const { classifyProduct } = require('../utils/deliveryTripFoundation');
const { validateBundlePromotion } = require('../pricing/bundlePromotionConfig');
const { cents } = require('../pricing/bundlePricing');
const { promotionCapability } = require('../pricing/promotionCapability');
const { safeBranch } = require('./branchManagementHandler');
const { resolveEffectiveProductPolicy } = require('../utils/effectiveProductPolicy');

const firestoreWriteFailed = () => new OtpError(503, 'PRODUCT_FIRESTORE_WRITE_FAILED', 'The product record could not be saved. Please try again.', { stage: 'PRODUCT_FIRESTORE_WRITE_STARTED' });

const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const priceFor = (value) => {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000) {
    throw new OtpError(400, 'INVALID_PRODUCT_PRICE', 'Enter a valid product price.', { field: 'price' });
  }
  return Math.round(price * 100) / 100;
};
const branchIdsFor = (value) => Array.isArray(value)
  ? [...new Set(value.map((item) => clean(item, 80)).filter(Boolean))].slice(0, 100)
  : [];
const safePrice = (value) => {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : null;
};
function assertPromotionOrderLimits(productId, product, branches, promotion) {
  const safe = safeProduct(productId, product);
  for (const branch of branches) {
    const limit = resolveEffectiveProductPolicy(safe, branch.data() || {}).maxQuantityPerRequester;
    if (limit !== null && promotion.tiers.some((tier) => tier.quantity > limit)) {
      throw new OtpError(400, 'INVALID_BUNDLE_PROMOTION', `A bundle quantity exceeds the order limit of ${limit} for ${clean(branch.data()?.name, 120) || 'a selected branch'}.`);
    }
  }
}
function requireCurrentPromotionAdmin(snapshot) {
  const profile = snapshot?.data() || {};
  if (!snapshot?.exists || profile.role !== 'admin') throw new OtpError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
  if (profile.mustChangePassword === true) throw new OtpError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your temporary password before using Admin features.');
  requireActiveAccount(profile);
}
const safeProduct = (id, data = {}) => {
  const imageUrl = clean(data.imageUrl || data.image, 1000);
  return {
  id,
  product_name: clean(data.product_name || data.name, 120),
  description: clean(data.description, 500),
  price: safePrice(data.price),
  image: imageUrl,
  imageUrl,
  imagePath: clean(data.imagePath, 500),
  imageStorageProvider: clean(data.imageStorageProvider, 40),
  containerType: clean(data.containerType || data.capacity, 80),
  size: clean(data.size, 80),
  deliveryLoadClassification: ({ standard_5_gallon: 'STANDARD_5_GALLON', other: 'OTHER_CARGO' })[classifyProduct(data)] || 'UNKNOWN',
  active: data.active !== false,
  branchIds: branchIdsFor(data.branchIds || (data.branchId ? [data.branchId] : [])),
  maxQuantityPerRequester: productLimit(data.maxQuantityPerRequester),
  deliveryDays: productDeliveryDays(data.deliveryDays),
  createdAt: data.createdAt || data.created_at || null,
  updatedAt: data.updatedAt || data.updated_at || null,
};
};

// Re-read classifications inside the order transaction so a concurrent Admin
// edit cannot leave a trusted-looking snapshot from before that edit.
async function refreshLoadSnapshots(tx, db, items) {
  const ids = [...new Set(items.map((item) => item.productId))];
  const snapshots = await Promise.all(ids.map((id) => tx.get(db.collection('products').doc(id))));
  const products = new Map(ids.map((id, index) => [id, snapshots[index].exists ? safeProduct(id, snapshots[index].data()) : null]));
  return items.map((item) => {
    const product = products.get(item.productId);
    const matches = product && item.productNameSnapshot === product.product_name && item.containerTypeSnapshot === product.containerType && item.sizeSnapshot === product.size;
    return { ...item, loadClassificationSnapshot: matches ? product.deliveryLoadClassification : 'UNKNOWN' };
  });
}

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); }
}

function requestContentType(req) {
  return String(req.headers?.['content-type'] || req.headers?.['Content-Type'] || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function requireJsonProductRequest(req) {
  const contentType = requestContentType(req);
  if (contentType !== 'application/json') {
    throw new OtpError(415, 'UNSUPPORTED_PRODUCT_MEDIA_TYPE', 'Use application/json for product changes.');
  }
  return contentType;
}

async function validateBranches(db, branchIds) {
  await Promise.all(branchIds.map(async (branchId) => {
    const snapshot = await db.collection('branches').doc(branchId).get();
    if (!snapshot.exists) throw new OtpError(400, 'INVALID_PRODUCT_BRANCH', 'A selected product branch does not exist.', { field: 'branchIds' });
  }));
}

function productInput(body, { partial = false } = {}) {
  const result = {};
  if (Object.prototype.hasOwnProperty.call(body, 'deliveryLoad')) throw new OtpError(400, 'INVALID_DELIVERY_LOAD', 'Use the product load classification field.', { field: 'deliveryLoadClassification' });
  if (Object.prototype.hasOwnProperty.call(body, 'deliveryLoadClassification')) {
    const classes = { STANDARD_5_GALLON: { verified: true, classification: 'standard_5_gallon' }, OTHER_CARGO: { verified: true, classification: 'other' }, UNKNOWN: { verified: false, classification: 'unknown' } };
    if (!Object.prototype.hasOwnProperty.call(classes, body.deliveryLoadClassification)) throw new OtpError(400, 'INVALID_DELIVERY_LOAD', 'Choose a valid product load classification.', { field: 'deliveryLoadClassification' });
    result.deliveryLoad = classes[body.deliveryLoadClassification];
  }
  const copy = (field, value, max) => {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) result[field] = clean(value, max);
  };
  copy('product_name', body.product_name || body.name, 120);
  copy('description', body.description, 500);
  copy('containerType', body.containerType || body.capacity, 80);
  copy('size', body.size, 80);
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'price')) result.price = priceFor(body.price);
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'active')) result.active = body.active !== false;
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'branchIds')) result.branchIds = branchIdsFor(body.branchIds);
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'maxQuantityPerRequester')) {
    const value = body.maxQuantityPerRequester;
    if (value !== null && value !== undefined && value !== '' && productLimit(value) === null) {
      throw new OtpError(400, 'INVALID_PRODUCT_ORDER_LIMIT', 'Requester order limit must be an integer from 1 to 100.', { field: 'maxQuantityPerRequester' });
    }
    result.maxQuantityPerRequester = productLimit(value);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'deliveryDays')) {
    const days = body.deliveryDays === undefined && !partial ? [] : body.deliveryDays;
    if (!Array.isArray(days) || days.some((day) => !WEEKDAYS.includes(day))) {
      throw new OtpError(400, 'INVALID_PRODUCT_DELIVERY_DAYS', 'Choose valid delivery weekdays.', { field: 'deliveryDays' });
    }
    result.deliveryDays = productDeliveryDays(days);
  }
  if (!partial && !result.product_name) throw new OtpError(400, 'INVALID_PRODUCT', 'Product name is required.', { field: 'product_name' });
  return result;
}

function safeRequestMetadata(body = {}) {
  const image = body.imageUpload && typeof body.imageUpload === 'object' ? body.imageUpload : null;
  return {
    propertyNames: Object.keys(body).sort(),
    valueTypes: Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'imageUpload').map(([key, value]) => [key, Array.isArray(value) ? 'array' : typeof value])),
    branchIds: branchIdsFor(body.branchIds),
    priceType: typeof body.price,
    image: image ? {
      propertyNames: Object.keys(image).sort(),
      contentType: clean(image.contentType, 80),
      hasFileName: Boolean(image.fileName),
      hasDataUrlPrefix: /^data:/i.test(String(image.dataBase64 || '')),
    } : null,
  };
}

function responseError(res, error) {
  const known = error instanceof OtpError;
  const field = known ? clean(error.details?.field, 80) : '';
  const stage = known ? clean(error.details?.stage, 80) : '';
  return res.status(known ? error.status : 500).json({ error: {
    reason: known ? error.reason : 'service-unavailable',
    message: known ? error.message : 'Product management is temporarily unavailable.',
    ...(stage ? { stage } : {}),
    ...(field ? { fieldErrors: { [field]: error.message } } : {}),
  } });
}

async function cleanupUploadedImage(storage, uploaded, productId) {
  if (!uploaded?.imagePath) return;
  try { await storage.deleteProductImage(uploaded.imagePath, productId); }
  catch { /* Storage service emits a safe cleanup failure log. */ }
}

function createAdminProductsHandler(getAdmin = getFirebaseAdmin, options = {}) {
  const { imageStorage = null, logger = console } = options;
  const allowPublication = promotionCapability(getAdmin, options).enabled;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (options.promotionDraftOnly && req.method !== 'PATCH') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use PATCH.' } });
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
      return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET, POST, or PATCH.' } });
    }
    const startedAt = Date.now();
    if (req.method !== 'GET') logger.info?.('[product-create]', { stage: 'PRODUCT_CREATE_REQUEST_RECEIVED', method: req.method });
    try {
      const { auth, db } = getAdmin();
      const admin = await requireAdmin(req, auth, db);
      if (req.method === 'GET') {
        const [snapshot, branchSnapshot] = await Promise.all([db.collection('products').get(), db.collection('branches').get()]);
        const products = snapshot.docs.map((item) => {
          const product = safeProduct(item.id, item.data());
          const promotionBranchLimits = Object.fromEntries(branchSnapshot.docs.map((branch) => [branch.id, resolveEffectiveProductPolicy(product, branch.data() || {}).maxQuantityPerRequester]));
          return { ...product, bundlePromotion: item.data()?.bundlePromotion || null, promotionBranchLimits, promotionActivationAvailable: allowPublication, promotionDisableAvailable: true };
        })
          .sort((left, right) => left.product_name.localeCompare(right.product_name));
        return res.status(200).json({ products });
      }
      logger.info?.('[product-create]', { stage: 'PRODUCT_CREATE_AUTHORIZED', method: req.method });
      const contentType = requireJsonProductRequest(req);
      logger.info?.('[product-create]', { stage: 'PRODUCT_CREATE_CONTENT_TYPE', contentType });
      const body = bodyOf(req);
      if (options.promotionDraftOnly && !Object.prototype.hasOwnProperty.call(body, 'bundlePromotion')) throw new OtpError(400, 'INVALID_BUNDLE_PROMOTION', 'Provide a promotion draft.');
      logger.info?.('[product-create]', { stage: 'PRODUCT_CREATE_PAYLOAD_RECEIVED', ...safeRequestMetadata(body) });
      if (req.method === 'POST') {
        const input = productInput(body);
        await validateBranches(db, input.branchIds);
        logger.info?.('[product-create]', { stage: 'PRODUCT_CREATE_VALIDATED', branchScope: input.branchIds.length ? 'selected' : 'all-active', branchCount: input.branchIds.length });
        const now = new Date();
        const ref = db.collection('products').doc();
        const image = decodeProductImage(body.imageUpload);
        if (image) logger.info?.('[product-create]', { stage: 'PRODUCT_IMAGE_DECODED', imageMime: image.contentType, decodedByteCount: image.bytes.length });
        const storage = image ? (imageStorage || createSupabaseProductImageStorage()) : null;
        const uploaded = image ? await storage.uploadProductImage(ref.id, image) : null;
        const saved = { ...input, ...(uploaded || {}), createdAt: now, createdBy: admin.uid, updatedAt: now, updatedBy: admin.uid };
        logger.info?.('[product-create]', { stage: 'PRODUCT_FIRESTORE_WRITE_STARTED', productId: ref.id });
        try {
          await db.runTransaction(async (tx) => {
            tx.create(ref, saved);
            tx.set(db.collection('adminAuditLogs').doc(), { action: 'PRODUCT_CREATED', adminUid: admin.uid, productId: ref.id, before: null, after: safeProduct(ref.id, saved), createdAt: now });
          });
        } catch (error) {
          await cleanupUploadedImage(storage, uploaded, ref.id);
          throw firestoreWriteFailed();
        }
        logger.info?.('[product-create]', { stage: 'PRODUCT_FIRESTORE_WRITE_FINISHED', productId: ref.id });
        logger.info?.('[product-create]', { stage: 'PRODUCT_CREATE_COMPLETED', productId: ref.id, status: 201, durationMs: Date.now() - startedAt });
        return res.status(201).json({ product: safeProduct(ref.id, saved) });
      }
      const productId = clean(body.productId, 128);
      if (!productId) throw new OtpError(400, 'PRODUCT_ID_REQUIRED', 'Product ID is required.');
      const ref = db.collection('products').doc(productId);
      const snapshot = await ref.get();
      if (!snapshot.exists) throw new OtpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
      if (Object.prototype.hasOwnProperty.call(body, 'bundlePromotionAction')) {
        if (Object.keys(body).some((key) => !['productId', 'bundlePromotionAction', 'expectedVersion'].includes(key)) || !['publish', 'disable'].includes(body.bundlePromotionAction)) throw new OtpError(400, 'INVALID_BUNDLE_PROMOTION', 'Choose a valid promotion action.');
        if (!allowPublication && body.bundlePromotionAction === 'publish') throw new OtpError(409, 'BUNDLE_PROMOTIONS_UNAVAILABLE', 'Promotion activation is unavailable.');
        let savedPromotion;
        await db.runTransaction(async (tx) => {
          const now = new Date();
          const [latest, actor] = await Promise.all([tx.get(ref), tx.get(db.collection('users').doc(admin.uid))]);
          requireCurrentPromotionAdmin(actor);
          if (!latest.exists) throw new OtpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
          const product = latest.data() || {};
          const previous = product.bundlePromotion;
          if (!previous || Array.isArray(previous)) throw new OtpError(409, 'INVALID_BUNDLE_PROMOTION', 'A single saved promotion draft is required.');
          if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion !== previous.version || previous.version < 1 || !Number.isSafeInteger(previous.version + 1)) throw new OtpError(409, 'BUNDLE_PROMOTION_STALE', 'This promotion changed. Refresh before saving.');
          if (body.bundlePromotionAction === 'disable') {
            if (previous.active !== true) throw new OtpError(409, 'BUNDLE_PROMOTION_INACTIVE', 'This promotion is already inactive.');
            savedPromotion = { ...previous, active: false, disabledAt: now.toISOString(), disabledBy: admin.uid, version: previous.version + 1, updatedAt: now, updatedBy: admin.uid };
          } else {
            if (product.active === false) throw new OtpError(409, 'PRODUCT_UNAVAILABLE', 'An inactive product cannot have an active promotion.');
            cents(product.price);
            savedPromotion = validateBundlePromotion({ ...previous, startsAt: previous.startMode === 'activation' || !previous.startsAt ? now.toISOString() : previous.startsAt, expectedVersion: body.expectedVersion, active: true }, { productId, productPrice: product.price, allowedBranches: branchIdsFor(product.branchIds || (product.branchId ? [product.branchId] : [])), previous, actorUid: admin.uid, now, allowActivation: true });
            if (savedPromotion.endsAt && new Date(savedPromotion.endsAt).getTime() <= now.getTime()) throw new OtpError(409, 'INVALID_BUNDLE_PROMOTION', 'An expired promotion cannot be published.');
            const branches = await Promise.all(savedPromotion.branchIds.map((id) => tx.get(db.collection('branches').doc(id))));
            if (branches.some((branch) => !branch.exists || safeBranch(branch.id, branch.data()).status !== 'active')) throw new OtpError(409, 'INVALID_PRODUCT_BRANCH', 'An eligible branch is unavailable.');
            assertPromotionOrderLimits(productId, product, branches, savedPromotion);
          }
          tx.update(ref, { bundlePromotion: savedPromotion, updatedAt: now, updatedBy: admin.uid });
          tx.set(db.collection('adminAuditLogs').doc(), { action: savedPromotion.active ? 'BUNDLE_PROMOTION_PUBLISHED' : 'BUNDLE_PROMOTION_DISABLED', adminUid: admin.uid, productId, before: previous, after: savedPromotion, createdAt: now });
        });
        return res.status(200).json({ product: { ...safeProduct(productId, snapshot.data()), bundlePromotion: savedPromotion }, pricingApplicationAvailable: allowPublication });
      }
      if (Object.prototype.hasOwnProperty.call(body, 'bundlePromotion')) {
        if (Object.keys(body).some((key) => !['productId', 'bundlePromotion'].includes(key))) throw new OtpError(400, 'INVALID_BUNDLE_PROMOTION', 'Save promotion changes separately from product changes.');
        const now = new Date();
        let savedPromotion;
        await db.runTransaction(async (tx) => {
          const [latest, actor] = await Promise.all([tx.get(ref), tx.get(db.collection('users').doc(admin.uid))]);
          requireCurrentPromotionAdmin(actor);
          if (!latest.exists) throw new OtpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
          const product = latest.data() || {};
          if (Array.isArray(product.bundlePromotion)) throw new OtpError(409, 'PROMOTION_CONFLICT', 'Conflicting promotions must be resolved before saving a draft.');
          if (options.promotionDraftOnly && product.bundlePromotion?.active === true) throw new OtpError(409, 'BUNDLE_PROMOTION_ACTIVE', 'Active promotions cannot be changed from the draft editor.');
          savedPromotion = validateBundlePromotion(body.bundlePromotion, { productId, productPrice: safePrice(product.price), allowedBranches: branchIdsFor(product.branchIds || (product.branchId ? [product.branchId] : [])), previous: product.bundlePromotion, actorUid: admin.uid, now });
          const branches = await Promise.all(savedPromotion.branchIds.map((id) => tx.get(db.collection('branches').doc(id))));
          if (branches.some((branch) => !branch.exists)) throw new OtpError(400, 'INVALID_PRODUCT_BRANCH', 'A selected promotion branch does not exist.');
          assertPromotionOrderLimits(productId, product, branches, savedPromotion);
          tx.update(ref, { bundlePromotion: savedPromotion, updatedAt: now, updatedBy: admin.uid });
          tx.set(db.collection('adminAuditLogs').doc(), { action: 'BUNDLE_PROMOTION_UPDATED', adminUid: admin.uid, productId, before: product.bundlePromotion || null, after: savedPromotion, createdAt: now });
        });
        return res.status(200).json({ product: { ...safeProduct(productId, snapshot.data()), bundlePromotion: savedPromotion }, pricingApplicationAvailable: allowPublication });
      }
      const changes = productInput(body, { partial: true });
      if (!Object.keys(changes).length && !body.imageUpload) throw new OtpError(400, 'NO_PRODUCT_CHANGES', 'No product changes were provided.');
      if (changes.branchIds) await validateBranches(db, changes.branchIds);
      logger.info?.('[product-create]', { stage: 'PRODUCT_CREATE_VALIDATED', branchScope: changes.branchIds?.length ? 'selected' : 'unchanged-or-all-active', branchCount: changes.branchIds?.length || 0 });
      const now = new Date();
      const image = decodeProductImage(body.imageUpload);
      if (image) logger.info?.('[product-create]', { stage: 'PRODUCT_IMAGE_DECODED', imageMime: image.contentType, decodedByteCount: image.bytes.length });
      const storage = image ? (imageStorage || createSupabaseProductImageStorage()) : null;
      let uploaded;
      try { uploaded = image ? await storage.uploadProductImage(productId, image) : null; }
      catch (error) { throw error; }
      let saved;
      let committedPrevious;
      logger.info?.('[product-create]', { stage: 'PRODUCT_FIRESTORE_WRITE_STARTED', productId });
      try {
        await db.runTransaction(async (tx) => {
          const latest = await tx.get(ref);
          if (!latest.exists) throw new OtpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
          committedPrevious = latest.data() || {};
          if (Object.prototype.hasOwnProperty.call(changes, 'price') && committedPrevious.bundlePromotion?.active === true) {
            const unit = cents(changes.price);
            if (!Array.isArray(committedPrevious.bundlePromotion.tiers) || committedPrevious.bundlePromotion.tiers.some((tier) => !Number.isSafeInteger(tier.quantity) || !Number.isSafeInteger(tier.bundlePriceCentavos) || tier.bundlePriceCentavos >= unit * tier.quantity)) {
              throw new OtpError(409, 'BUNDLE_PRICE_INVALIDATED', 'Correct or disable the bundle promotion before changing this price.');
            }
          }
          if (changes.branchIds?.length && committedPrevious.bundlePromotion?.active === true && committedPrevious.bundlePromotion.branchIds?.some((id) => !changes.branchIds.includes(id))) {
            throw new OtpError(409, 'BUNDLE_BRANCH_INVALIDATED', 'Correct or disable the bundle promotion before changing product branches.');
          }
          const physicalChanged = ['product_name', 'size', 'containerType'].some((field) => Object.prototype.hasOwnProperty.call(changes, field) && changes[field] !== clean(committedPrevious[field], field === 'product_name' ? 120 : 80));
          const effectiveChanges = { ...changes };
          if (physicalChanged && !Object.prototype.hasOwnProperty.call(changes, 'deliveryLoad')) effectiveChanges.deliveryLoad = { verified: false, classification: 'unknown' };
          const previousPromotion = committedPrevious.bundlePromotion;
          if (physicalChanged && previousPromotion && !Array.isArray(previousPromotion) && (previousPromotion.active === true || previousPromotion.commercialEligibility === 'refill_verified')) {
            if (!Number.isSafeInteger(previousPromotion.version) || !Number.isSafeInteger(previousPromotion.version + 1)) throw new OtpError(409, 'BUNDLE_PROMOTION_STALE', 'Refresh the promotion before changing product details.');
            const { disabledAt, disabledBy, ...resetPromotion } = previousPromotion;
            effectiveChanges.bundlePromotion = { ...resetPromotion, active: false, commercialEligibility: '', version: previousPromotion.version + 1, updatedAt: now, updatedBy: admin.uid };
          }
          saved = { ...committedPrevious, ...effectiveChanges, ...(uploaded || {}), updatedAt: now, updatedBy: admin.uid };
          const action = committedPrevious.active !== false && saved.active === false ? 'PRODUCT_DEACTIVATED' : 'PRODUCT_UPDATED';
          tx.update(ref, { ...effectiveChanges, ...(uploaded || {}), updatedAt: now, updatedBy: admin.uid });
          tx.set(db.collection('adminAuditLogs').doc(), { action, adminUid: admin.uid, productId, before: safeProduct(productId, committedPrevious), after: safeProduct(productId, saved), createdAt: now });
          if (effectiveChanges.bundlePromotion) tx.set(db.collection('adminAuditLogs').doc(), { action: 'BUNDLE_PROMOTION_ELIGIBILITY_RESET', adminUid: admin.uid, productId, before: previousPromotion, after: effectiveChanges.bundlePromotion, createdAt: now });
        });
      } catch (error) {
        await cleanupUploadedImage(storage, uploaded, productId);
        if (error instanceof OtpError) throw error;
        throw firestoreWriteFailed();
      }
      logger.info?.('[product-create]', { stage: 'PRODUCT_FIRESTORE_WRITE_FINISHED', productId });
      if (uploaded && committedPrevious.imageStorageProvider === 'supabase' && committedPrevious.imagePath && committedPrevious.imagePath !== uploaded.imagePath) {
        try {
          await storage.deleteProductImage(committedPrevious.imagePath, productId);
          console.info('[product-image]', { stage: 'PRODUCT_IMAGE_REPLACED', productId });
        }
        catch { /* The new product record is valid; preserve it if cleanup has a transient failure. */ }
      }
      logger.info?.('[product-create]', { stage: 'PRODUCT_CREATE_COMPLETED', productId, status: 200, durationMs: Date.now() - startedAt });
      return res.status(200).json({ product: safeProduct(productId, saved) });
    } catch (error) {
      logger.error?.('[product-create]', {
        stage: 'PRODUCT_CREATE_FAILED',
        reason: error instanceof OtpError ? error.reason : 'service-unavailable',
        failureStage: error instanceof OtpError ? error.details?.stage || 'PRODUCT_CREATE_REQUEST_RECEIVED' : 'PRODUCT_CREATE_REQUEST_RECEIVED',
      });
      return responseError(res, error);
    }
  };
}

module.exports = { createAdminProductsHandler, safeProduct, refreshLoadSnapshots, requestContentType, safeRequestMetadata };
