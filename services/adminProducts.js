import { adminApiRequest } from './adminApi';
import { ADMIN_CACHE_KEYS, invalidateAdminData } from './adminDataCache';
import { invalidateRequesterCatalog } from './requesterOrdering';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const getAdminProducts = async () => (await adminApiRequest('/api/admin/products')).products || [];

const signatureType = (bytes) => {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return '';
};

const fileSignature = async (file) => {
  const chunk = file.slice(0, 12);
  if (typeof chunk.arrayBuffer === 'function') return new Uint8Array(await chunk.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new globalThis.FileReader();
    reader.onerror = () => reject(new Error('The selected image could not be read.'));
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.readAsArrayBuffer(chunk);
  });
};

const imagePayload = async (file) => {
  if (!file) return null;
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('Product images must be 5 MB or smaller.');
  if (!globalThis.FileReader) throw new Error('Product image upload is available in the web Admin portal.');
  const contentType = signatureType(await fileSignature(file));
  if (!ALLOWED_TYPES.has(contentType)) throw new Error('Use a valid JPG, PNG, or WebP product image.');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new globalThis.FileReader();
    reader.onerror = () => reject(new Error('The selected image could not be read.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
  const separator = dataUrl.indexOf(',');
  if (separator < 0 || !/^data:[^;,]+;base64$/i.test(dataUrl.slice(0, separator))) throw new Error('The selected image could not be read.');
  return { contentType, dataBase64: dataUrl.slice(separator + 1) };
};

export const safeProductPayloadMetadata = (payload = {}) => {
  const image = payload.imageUpload && typeof payload.imageUpload === 'object' ? payload.imageUpload : null;
  return {
    propertyNames: Object.keys(payload).sort(),
    valueTypes: Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'imageUpload').map(([key, value]) => [key, Array.isArray(value) ? 'array' : typeof value])),
    branchIds: Array.isArray(payload.branchIds) ? payload.branchIds.map(String) : [],
    priceType: typeof payload.price,
    image: image ? {
      propertyNames: Object.keys(image).sort(),
      contentType: String(image.contentType || ''),
      hasDataUrlPrefix: /^data:/i.test(String(image.dataBase64 || '')),
    } : null,
  };
};

export const adminProductErrorMessage = (error) => {
  const fieldMessage = error?.fieldErrors && Object.values(error.fieldErrors)[0];
  if (fieldMessage) return fieldMessage;
  if (error?.code === 'PRODUCT_IMAGE_TYPE_INVALID') return 'Product image: use a valid JPG, PNG, or WebP file whose contents match its image type.';
  if (error?.code === 'INVALID_PRODUCT_BRANCH') return 'Branch availability: refresh the page and select existing branches again.';
  if (error?.code === 'INVALID_PRODUCT_PRICE') return 'Price: enter a finite amount from 0 to 1,000,000.';
  return error?.message || 'Product could not be saved.';
};

const invalidate = () => {
  invalidateAdminData(ADMIN_CACHE_KEYS.products);
  invalidateRequesterCatalog();
};

export async function createAdminProduct(product, file) {
  const imageUpload = await imagePayload(file);
  const body = { ...product, ...(imageUpload ? { imageUpload } : {}) };
  console.info('[admin-product]', { stage: 'PRODUCT_CREATE_PAYLOAD_READY', ...safeProductPayloadMetadata(body) });
  const result = await adminApiRequest('/api/admin/products', { method: 'POST', body });
  invalidate();
  return result.product;
}

export async function updateAdminProduct(productId, changes, file) {
  const imageUpload = await imagePayload(file);
  const body = { productId, ...changes, ...(imageUpload ? { imageUpload } : {}) };
  console.info('[admin-product]', { stage: 'PRODUCT_UPDATE_PAYLOAD_READY', ...safeProductPayloadMetadata(body) });
  const result = await adminApiRequest('/api/admin/products', { method: 'PATCH', body });
  invalidate();
  return result.product;
}
