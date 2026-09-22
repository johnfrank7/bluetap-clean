const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { createSupabaseProductImageStorage, decodeProductImage } = require('../services/supabaseStorage');

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
  active: data.active !== false,
  branchIds: branchIdsFor(data.branchIds || (data.branchId ? [data.branchId] : [])),
  createdAt: data.createdAt || data.created_at || null,
  updatedAt: data.updatedAt || data.updated_at || null,
};
};

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
      hasDataUrlPrefix: /^data:/i.test(String(image.dataBase64 || '')),
    } : null,
  };
}

function responseError(res, error) {
  const known = error instanceof OtpError;
  const field = known ? clean(error.details?.field, 80) : '';
  return res.status(known ? error.status : 500).json({ error: {
    reason: known ? error.reason : 'service-unavailable',
    message: known ? error.message : 'Product management is temporarily unavailable.',
    ...(field ? { fieldErrors: { [field]: error.message } } : {}),
  } });
}

async function cleanupUploadedImage(storage, uploaded, productId) {
  if (!uploaded?.imagePath) return;
  try { await storage.deleteProductImage(uploaded.imagePath, productId); }
  catch { /* Storage service emits a safe cleanup failure log. */ }
}

function createAdminProductsHandler(getAdmin = getFirebaseAdmin, { imageStorage = null, logger = console } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
      return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET, POST, or PATCH.' } });
    }
    try {
      const { auth, db } = getAdmin();
      const admin = await requireAdmin(req, auth, db);
      if (req.method === 'GET') {
        const snapshot = await db.collection('products').get();
        const products = snapshot.docs.map((item) => safeProduct(item.id, item.data()))
          .sort((left, right) => left.product_name.localeCompare(right.product_name));
        return res.status(200).json({ products });
      }
      const startedAt = Date.now();
      const contentType = requireJsonProductRequest(req);
      logger.info?.('[product-create]', { stage: 'PRODUCT_CREATE_REQUEST_RECEIVED', method: req.method });
      logger.info?.('[product-create]', { stage: 'PRODUCT_CREATE_CONTENT_TYPE', contentType });
      const body = bodyOf(req);
      logger.info?.('[product-create]', { stage: 'PRODUCT_CREATE_PAYLOAD_RECEIVED', ...safeRequestMetadata(body) });
      if (req.method === 'POST') {
        const input = productInput(body);
        await validateBranches(db, input.branchIds);
        const now = new Date();
        const ref = db.collection('products').doc();
        const image = decodeProductImage(body.imageUpload);
        if (image) logger.info?.('[product-create]', { stage: 'PRODUCT_IMAGE_DECODED', imageMime: image.contentType, decodedByteCount: image.bytes.length });
        const storage = image ? (imageStorage || createSupabaseProductImageStorage()) : null;
        let uploaded;
        try {
          uploaded = image ? await storage.uploadProductImage(ref.id, image) : null;
          const saved = { ...input, ...(uploaded || {}), createdAt: now, createdBy: admin.uid, updatedAt: now, updatedBy: admin.uid };
          await db.runTransaction(async (tx) => {
            tx.create(ref, saved);
            tx.set(db.collection('adminAuditLogs').doc(), { action: 'PRODUCT_CREATED', adminUid: admin.uid, productId: ref.id, before: null, after: safeProduct(ref.id, saved), createdAt: now });
          });
          logger.info?.('[product-create]', { stage: 'PRODUCT_CREATE_COMPLETED', productId: ref.id, status: 201, durationMs: Date.now() - startedAt });
          return res.status(201).json({ product: safeProduct(ref.id, saved) });
        } catch (error) {
          await cleanupUploadedImage(storage, uploaded, ref.id);
          throw error;
        }
      }
      const productId = clean(body.productId, 128);
      if (!productId) throw new OtpError(400, 'PRODUCT_ID_REQUIRED', 'Product ID is required.');
      const ref = db.collection('products').doc(productId);
      const snapshot = await ref.get();
      if (!snapshot.exists) throw new OtpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
      const previous = snapshot.data() || {};
      const changes = productInput(body, { partial: true });
      if (!Object.keys(changes).length && !body.imageUpload) throw new OtpError(400, 'NO_PRODUCT_CHANGES', 'No product changes were provided.');
      if (changes.branchIds) await validateBranches(db, changes.branchIds);
      const now = new Date();
      const image = decodeProductImage(body.imageUpload);
      if (image) logger.info?.('[product-create]', { stage: 'PRODUCT_IMAGE_DECODED', imageMime: image.contentType, decodedByteCount: image.bytes.length });
      const storage = image ? (imageStorage || createSupabaseProductImageStorage()) : null;
      let uploaded;
      try { uploaded = image ? await storage.uploadProductImage(productId, image) : null; }
      catch (error) { throw error; }
      const saved = { ...previous, ...changes, ...(uploaded || {}), updatedAt: now, updatedBy: admin.uid };
      const action = previous.active !== false && saved.active === false ? 'PRODUCT_DEACTIVATED' : 'PRODUCT_UPDATED';
      try {
        await db.runTransaction(async (tx) => {
          tx.update(ref, { ...changes, ...(uploaded || {}), updatedAt: now, updatedBy: admin.uid });
          tx.set(db.collection('adminAuditLogs').doc(), { action, adminUid: admin.uid, productId, before: safeProduct(productId, previous), after: safeProduct(productId, saved), createdAt: now });
        });
      } catch (error) {
        await cleanupUploadedImage(storage, uploaded, productId);
        throw error;
      }
      if (uploaded && previous.imageStorageProvider === 'supabase' && previous.imagePath && previous.imagePath !== uploaded.imagePath) {
        try {
          await storage.deleteProductImage(previous.imagePath, productId);
          console.info('[product-image]', { stage: 'PRODUCT_IMAGE_REPLACED', productId });
        }
        catch { /* The new product record is valid; preserve it if cleanup has a transient failure. */ }
      }
      logger.info?.('[product-create]', { stage: 'PRODUCT_CREATE_COMPLETED', productId, status: 200, durationMs: Date.now() - startedAt });
      return res.status(200).json({ product: safeProduct(productId, saved) });
    } catch (error) { return responseError(res, error); }
  };
}

module.exports = { createAdminProductsHandler, safeProduct, requestContentType, safeRequestMetadata };
