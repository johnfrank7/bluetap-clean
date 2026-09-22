// Server-only product-image storage. Never import this module from Expo code.
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { OtpError } = require('../utils/otpError');

const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const storageUnavailable = () => new OtpError(503, 'PRODUCT_IMAGE_STORAGE_UNAVAILABLE', 'Product image storage is temporarily unavailable.', { stage: 'PRODUCT_IMAGE_STORAGE_CONFIGURATION' });
const bucketNotFound = () => new OtpError(503, 'SUPABASE_BUCKET_NOT_FOUND', 'The product image bucket is unavailable.', { stage: 'PRODUCT_IMAGE_BUCKET_CHECK' });
const bucketNotPublic = () => new OtpError(503, 'SUPABASE_BUCKET_NOT_PUBLIC', 'The product image bucket is not configured for public reads.', { stage: 'PRODUCT_IMAGE_BUCKET_CHECK' });
const authFailed = (stage = 'PRODUCT_IMAGE_BUCKET_CHECK') => new OtpError(502, 'SUPABASE_AUTH_FAILED', 'Product image storage authorization failed.', { stage });
const uploadFailed = () => new OtpError(502, 'PRODUCT_IMAGE_UPLOAD_FAILED', 'Product image upload could not finish. Please try again.', { stage: 'PRODUCT_IMAGE_UPLOAD_STARTED' });
const publicUrlFailed = () => new OtpError(502, 'PRODUCT_IMAGE_PUBLIC_URL_FAILED', 'The product image public URL could not be created.', { stage: 'PRODUCT_IMAGE_PUBLIC_URL' });
const deleteFailed = () => new OtpError(502, 'PRODUCT_IMAGE_DELETE_FAILED', 'Product image cleanup could not finish.');

function imageTypeFor(bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.subarray(0, 4).equals(Buffer.from('RIFF')) && bytes.subarray(8, 12).equals(Buffer.from('WEBP'))) return 'image/webp';
  return null;
}

function decodeProductImage(value) {
  if (!value || typeof value !== 'object') return null;
  const contentType = String(value.contentType || '').toLowerCase().trim();
  const encoded = String(value.dataBase64 || '');
  if (!IMAGE_TYPES.has(contentType)) throw new OtpError(422, 'PRODUCT_IMAGE_TYPE_INVALID', 'Use a JPG, PNG, or WebP product image.', { field: 'imageUpload' });
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new OtpError(400, 'PRODUCT_IMAGE_TYPE_INVALID', 'Use a valid JPG, PNG, or WebP product image.', { field: 'imageUpload' });
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.toString('base64') !== encoded) throw new OtpError(400, 'PRODUCT_IMAGE_TYPE_INVALID', 'Use a valid JPG, PNG, or WebP product image.', { field: 'imageUpload' });
  if (bytes.length > MAX_PRODUCT_IMAGE_BYTES) throw new OtpError(413, 'PRODUCT_IMAGE_TOO_LARGE', 'Product images must be 5 MB or smaller.');
  if (imageTypeFor(bytes) !== contentType) throw new OtpError(422, 'PRODUCT_IMAGE_TYPE_INVALID', 'The uploaded file does not match its image type.', { field: 'imageUpload' });
  const fileName = String(value.fileName || 'product-image')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '-')
    .slice(0, 120);
  return { bytes, contentType, fileName };
}

function storageConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = String(env.SUPABASE_STORAGE_BUCKET || '').trim();
  if (!url.startsWith('https://') || !serviceRoleKey || !/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(bucket)) throw storageUnavailable();
  return { url, serviceRoleKey, bucket };
}

function storageConfigStatus(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = String(env.SUPABASE_STORAGE_BUCKET || '').trim();
  return {
    url: !url ? 'missing' : url.startsWith('https://') ? 'present' : 'malformed',
    serviceRoleKey: serviceRoleKey ? 'present' : 'missing',
    bucket: !bucket ? 'missing' : /^[a-z0-9][a-z0-9_-]{0,62}$/i.test(bucket) ? 'present' : 'malformed',
  };
}

function storageProviderError(error, fallback, stage = 'PRODUCT_IMAGE_BUCKET_CHECK') {
  if (error instanceof OtpError) return error;
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || error?.error || error?.statusCode || '').toLowerCase();
  if (status === 404 || code === 'nosuchbucket') return bucketNotFound();
  if (status === 401 || status === 403 || ['accessdenied', 'unauthorized'].includes(code)) return authFailed(stage);
  return fallback();
}

function createSupabaseProductImageStorage({ env = process.env, createClientImpl = createClient, logger = console } = {}) {
  let client;
  let config;
  let bucketReady;
  const configured = () => {
    if (!config) {
      report('info', 'PRODUCT_IMAGE_STORAGE_CONFIGURATION', storageConfigStatus(env));
      config = storageConfig(env);
    }
    if (!client) client = createClientImpl(config.url, config.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    return config;
  };
  const report = (level, stage, details = {}) => logger[level]?.('[product-image]', { stage, ...details });

  const ensureBucket = async () => {
    if (!bucketReady) {
      bucketReady = (async () => {
        const { bucket } = configured();
        report('info', 'PRODUCT_IMAGE_BUCKET_CHECK_STARTED');
        const { data, error } = await client.storage.getBucket(bucket);
        if (error) throw storageProviderError(error, bucketNotFound);
        if (!data) throw bucketNotFound();
        if (data.public !== true) throw bucketNotPublic();
        report('info', 'PRODUCT_IMAGE_BUCKET_CHECK_FINISHED', { publicRead: true });
        return config;
      })().catch((error) => {
        bucketReady = null;
        throw error;
      });
    }
    return bucketReady;
  };

  return {
    async uploadProductImage(productId, image) {
      const safeProductId = String(productId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
      if (!safeProductId) throw new OtpError(400, 'PRODUCT_ID_REQUIRED', 'Product ID is required.');
      const extension = image.contentType === 'image/jpeg' ? 'jpg' : image.contentType.split('/')[1];
      const imagePath = `products/${safeProductId}/${randomUUID()}.${extension}`;
      let bucket = '';
      let objectUploaded = false;
      try {
        ({ bucket } = await ensureBucket());
        report('info', 'PRODUCT_IMAGE_UPLOAD_STARTED', { productId: safeProductId });
        const { error } = await client.storage.from(bucket).upload(imagePath, image.bytes, {
          contentType: image.contentType,
          cacheControl: '31536000',
          upsert: false,
        });
        if (error) throw storageProviderError(error, uploadFailed, 'PRODUCT_IMAGE_UPLOAD_STARTED');
        objectUploaded = true;
        const { data } = client.storage.from(bucket).getPublicUrl(imagePath);
        const expectedPath = `/storage/v1/object/public/${encodeURIComponent(bucket)}/`;
        if (!data?.publicUrl || !String(data.publicUrl).includes(expectedPath)) throw publicUrlFailed();
        report('info', 'PRODUCT_IMAGE_UPLOAD_FINISHED', { productId: safeProductId });
        return { imageUrl: data.publicUrl, imagePath, imageStorageProvider: 'supabase' };
      } catch (error) {
        const mapped = storageProviderError(error, uploadFailed);
        if (objectUploaded && bucket) {
          try {
            const { error: rollbackError } = await client.storage.from(bucket).remove([imagePath]);
            if (rollbackError) throw rollbackError;
            report('info', 'PRODUCT_IMAGE_UPLOAD_ROLLED_BACK', { productId: safeProductId });
          } catch { /* Preserve the original safe failure code. */ }
        }
        report('error', 'PRODUCT_IMAGE_UPLOAD_FAILED', { productId: safeProductId, reason: mapped.reason, failureStage: mapped.details?.stage });
        throw mapped;
      }
    },
    async deleteProductImage(imagePath, productId = '') {
      const path = String(imagePath || '');
      if (!/^products\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(path)) throw deleteFailed();
      try {
        const { bucket } = await ensureBucket();
        const { error } = await client.storage.from(bucket).remove([path]);
        if (error) throw error;
        report('info', 'PRODUCT_IMAGE_DELETE_COMPLETED', { productId: String(productId || '').slice(0, 128) });
      } catch (error) {
        report('error', 'PRODUCT_IMAGE_DELETE_FAILED', { productId: String(productId || '').slice(0, 128), reason: error?.name || 'storage-error' });
        throw deleteFailed();
      }
    },
  };
}

module.exports = { MAX_PRODUCT_IMAGE_BYTES, createSupabaseProductImageStorage, decodeProductImage, imageTypeFor, storageConfigStatus, storageProviderError };
