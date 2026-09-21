import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import { adminApiRequest } from './adminApi';
import { ADMIN_CACHE_KEYS, invalidateAdminData } from './adminDataCache';
import { invalidateRequesterCatalog } from './requesterOrdering';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const cleanFileName = (name = 'product-image') => name.replace(/[^a-zA-Z0-9._-]/g, '-');

export const getAdminProducts = async () => (await adminApiRequest('/api/admin/products')).products || [];

export async function uploadAdminProductImage(file, productKey = 'new') {
  if (!file) return null;
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('Use a JPG, PNG, or WebP product image.');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('Product images must be 5 MB or smaller.');
  const imageRef = ref(storage, `products/admin/${productKey}/${Date.now()}-${cleanFileName(file.name)}`);
  await uploadBytes(imageRef, file, { contentType: file.type });
  return { image: await getDownloadURL(imageRef), imagePath: imageRef.fullPath };
}

const invalidate = () => {
  invalidateAdminData(ADMIN_CACHE_KEYS.products);
  invalidateRequesterCatalog();
};

export async function createAdminProduct(product, file) {
  const uploaded = await uploadAdminProductImage(file);
  try {
    const result = await adminApiRequest('/api/admin/products', { method: 'POST', body: { ...product, ...(uploaded || {}) } });
    invalidate();
    return result.product;
  } catch (error) {
    if (uploaded?.imagePath) deleteObject(ref(storage, uploaded.imagePath)).catch(() => {});
    throw error;
  }
}

export async function updateAdminProduct(productId, changes, file, previous = {}) {
  const uploaded = await uploadAdminProductImage(file, productId);
  try {
    const result = await adminApiRequest('/api/admin/products', { method: 'PATCH', body: { productId, ...changes, ...(uploaded || {}) } });
    invalidate();
    if (uploaded?.imagePath && previous.imagePath && previous.imagePath !== uploaded.imagePath) deleteObject(ref(storage, previous.imagePath)).catch(() => {});
    return result.product;
  } catch (error) {
    if (uploaded?.imagePath) deleteObject(ref(storage, uploaded.imagePath)).catch(() => {});
    throw error;
  }
}
