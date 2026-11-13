import { auth } from '../firebase';
import { getModuleSession } from './authSession';
import { getManagerWorkspace } from './managerWorkspace';

export const PRODUCTS_COLLECTION = 'products';
export const PRODUCT_SCHEMA_FIELDS = ['id', 'product_name', 'description', 'price', 'image', 'imageUrl', 'imagePath', 'imageStorageProvider', 'containerType', 'size', 'active', 'branchIds', 'createdAt', 'updatedAt'];

const subscribers = new Set();
let sourceProducts = [];
let cachedProducts = null;
let refreshTimer = null;
let stopTimer = null;
let sourceUid = '';
let generation = 0;
let refreshPromise = null;

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
  const uid = auth.currentUser?.uid || '';
  if (sourceUid !== uid) {
    generation += 1;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    refreshPromise = null;
    sourceUid = uid;
    sourceProducts = [];
    cachedProducts = null;
  }
  if (refreshTimer) return;
  const currentGeneration = generation;
  const refresh = () => {
    if (refreshPromise) return;
    const request = getManagerWorkspace().then((workspace) => {
      if (currentGeneration !== generation || auth.currentUser?.uid !== sourceUid) return;
      sourceProducts = (Array.isArray(workspace.products) ? workspace.products : []).map((item) => normalizeProduct(item.id, item));
      emit();
    }).catch((error) => {
      if (currentGeneration !== generation) return;
      sourceProducts = [];
      emit();
      subscribers.forEach(({ onError }) => onError?.(error));
    }).finally(() => { if (refreshPromise === request) refreshPromise = null; });
    refreshPromise = request;
  };
  refresh();
  refreshTimer = setInterval(refresh, 15000);
};

export const subscribeProducts = (listener, onError) => {
  const subscriber = { listener, onError };
  subscribers.add(subscriber);
  start();
  if (sourceProducts.length || cachedProducts) emit();
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) stopTimer = setTimeout(() => {
      if (subscribers.size === 0) { generation += 1; clearInterval(refreshTimer); refreshTimer = null; refreshPromise = null; sourceUid = ''; sourceProducts = []; cachedProducts = null; }
    }, 15_000);
  };
};

const adminOnly = () => { throw new Error('Product management is Administrator-only. Use the Admin Products page.'); };
export const createProduct = adminOnly;
export const updateProduct = adminOnly;
export const deleteProduct = adminOnly;
