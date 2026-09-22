import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { getModuleSession } from './authSession';

export const PRODUCTS_COLLECTION = 'products';
export const PRODUCT_SCHEMA_FIELDS = ['id', 'product_name', 'description', 'price', 'image', 'imageUrl', 'imagePath', 'imageStorageProvider', 'containerType', 'size', 'active', 'branchIds', 'createdAt', 'updatedAt'];

const subscribers = new Set();
let sourceProducts = [];
let cachedProducts = null;
let unsubscribeFirestore = null;
let stopTimer = null;

const amount = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const millis = (value) => value?.toMillis?.() || (value?.seconds ? value.seconds * 1000 : new Date(value || 0).getTime() || 0);
const normalizeProduct = (id, data = {}) => ({
  id,
  product_name: data.product_name || data.productName || data.name || '',
  description: data.description || '',
  price: amount(data.price),
  image: data.imageUrl || data.image || '',
  imageUrl: data.imageUrl || data.image || '',
  imagePath: data.imagePath || '',
  imageStorageProvider: data.imageStorageProvider || '',
  containerType: data.containerType || data.capacity || '',
  capacity: data.capacity || data.containerType || '',
  size: data.size || '',
  active: data.active !== false,
  branchIds: Array.isArray(data.branchIds) ? data.branchIds.map(String) : data.branchId ? [String(data.branchId)] : [],
  branchId: String(data.branchId || ''),
  createdAt: data.createdAt || data.created_at || null,
  updatedAt: data.updatedAt || data.updated_at || null,
});

const visibleProducts = () => {
  const managerBranchId = getModuleSession('manager')?.branchId || '';
  return sourceProducts
    .filter((product) => product.active)
    .filter((product) => !managerBranchId || product.branchIds.length === 0 || product.branchIds.includes(managerBranchId))
    .sort((left, right) => millis(left.createdAt) - millis(right.createdAt) || left.product_name.localeCompare(right.product_name));
};

const emit = () => {
  cachedProducts = visibleProducts();
  subscribers.forEach(({ listener }) => listener(cachedProducts));
};

const start = () => {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  if (unsubscribeFirestore) return;
  unsubscribeFirestore = onSnapshot(collection(db, PRODUCTS_COLLECTION), (snapshot) => {
    sourceProducts = snapshot.docs.map((item) => normalizeProduct(item.id, item.data()));
    emit();
  }, (error) => {
    subscribers.forEach(({ onError }) => onError?.(error));
  });
};

export const subscribeProducts = (listener, onError) => {
  const subscriber = { listener, onError };
  subscribers.add(subscriber);
  start();
  if (sourceProducts.length || cachedProducts) emit();
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) stopTimer = setTimeout(() => {
      if (subscribers.size === 0) { unsubscribeFirestore?.(); unsubscribeFirestore = null; sourceProducts = []; cachedProducts = null; }
    }, 15_000);
  };
};

const adminOnly = () => { throw new Error('Product management is Administrator-only. Use the Admin Products page.'); };
export const createProduct = adminOnly;
export const updateProduct = adminOnly;
export const deleteProduct = adminOnly;
