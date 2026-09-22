import { adminApiRequest } from './adminApi';
import { ADMIN_CACHE_KEYS, invalidateAdminData } from './adminDataCache';
import { invalidateRequesterCatalog } from './requesterOrdering';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const getAdminProducts = async () => (await adminApiRequest('/api/admin/products')).products || [];

const imagePayload = async (file) => {
  if (!file) return null;
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('Use a JPG, PNG, or WebP product image.');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('Product images must be 5 MB or smaller.');
  if (!globalThis.FileReader) throw new Error('Product image upload is available in the web Admin portal.');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new globalThis.FileReader();
    reader.onerror = () => reject(new Error('The selected image could not be read.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
  const prefix = `data:${file.type};base64,`;
  if (!dataUrl.startsWith(prefix)) throw new Error('The selected image could not be read.');
  return { contentType: file.type, dataBase64: dataUrl.slice(prefix.length) };
};

const invalidate = () => {
  invalidateAdminData(ADMIN_CACHE_KEYS.products);
  invalidateRequesterCatalog();
};

export async function createAdminProduct(product, file) {
  const imageUpload = await imagePayload(file);
  const result = await adminApiRequest('/api/admin/products', { method: 'POST', body: { ...product, ...(imageUpload ? { imageUpload } : {}) } });
  invalidate();
  return result.product;
}

export async function updateAdminProduct(productId, changes, file) {
  const imageUpload = await imagePayload(file);
  const result = await adminApiRequest('/api/admin/products', { method: 'PATCH', body: { productId, ...changes, ...(imageUpload ? { imageUpload } : {}) } });
  invalidate();
  return result.product;
}
