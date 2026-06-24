import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';

export const PRODUCTS_COLLECTION = 'products';
export const PRODUCT_SCHEMA_FIELDS = [
  'id',
  'product_name',
  'price',
  'image',
  'created_at',
  'updated_at',
];

const LOCAL_PRODUCTS_KEY = 'bluetapLocalProducts';
const LOCAL_PRODUCTS_CHANGED_EVENT = 'bluetapLocalProductsChanged';
const FIREBASE_OPERATION_TIMEOUT_MS = 12000;

const withFirebaseTimeout = (operationPromise, operationName) => {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(
        `${operationName} is taking too long. Please check your Firebase connection.`
      );
      error.code = 'operation-timeout';
      reject(error);
    }, FIREBASE_OPERATION_TIMEOUT_MS);
  });

  return Promise.race([operationPromise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
};

const normalizePrice = (price) => {
  const parsedPrice = Number(price);
  return Number.isFinite(parsedPrice) ? parsedPrice : 0;
};

const timestampToMillis = (timestamp) => {
  if (!timestamp) return 0;
  if (typeof timestamp === 'string') return new Date(timestamp).getTime() || 0;
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
  if (timestamp.seconds) return timestamp.seconds * 1000;
  return 0;
};

const normalizeProduct = (id, data = {}) => ({
  id,
  product_name: data.product_name || data.productName || '',
  price: normalizePrice(data.price),
  image: data.image || '',
  imagePath: data.imagePath || '',
  capacity: data.capacity || data.subtext || '',
  created_at: data.created_at || data.createdAt || null,
  updated_at: data.updated_at || data.updatedAt || null,
  isLocal: !!data.isLocal,
});

const sortProducts = (products) =>
  [...products].sort((left, right) => {
    const leftCreatedAt = timestampToMillis(left.created_at);
    const rightCreatedAt = timestampToMillis(right.created_at);

    if (leftCreatedAt === rightCreatedAt) {
      return left.product_name.localeCompare(right.product_name);
    }

    return leftCreatedAt - rightCreatedAt;
  });

const dedupeProductsById = (products) => {
  const productsById = new Map();

  products.forEach((product) => {
    if (product?.id) {
      productsById.set(product.id, normalizeProduct(product.id, product));
    }
  });

  return Array.from(productsById.values());
};

const getMemoryProducts = () => {
  if (!globalThis.__bluetapLocalProducts) {
    globalThis.__bluetapLocalProducts = [];
  }

  return globalThis.__bluetapLocalProducts;
};

export const getLocalProducts = () => {
  let storedProducts = [];

  try {
    if (globalThis.localStorage) {
      const parsedProducts = JSON.parse(
        globalThis.localStorage.getItem(LOCAL_PRODUCTS_KEY) || '[]'
      );
      storedProducts = Array.isArray(parsedProducts)
        ? parsedProducts.map((product) => normalizeProduct(product.id, product))
        : [];
    }
  } catch (error) {
    console.log('Local products read error:', error.message);
  }

  return dedupeProductsById([...storedProducts, ...getMemoryProducts()]);
};

const saveLocalProducts = (products) => {
  const normalizedProducts = products.map((product) =>
    normalizeProduct(product.id, product)
  );
  globalThis.__bluetapLocalProducts = normalizedProducts;

  try {
    if (globalThis.localStorage) {
      globalThis.localStorage.setItem(
        LOCAL_PRODUCTS_KEY,
        JSON.stringify(normalizedProducts)
      );
    }
  } catch (error) {
    console.log('Local products save error:', error.message);
  }

  try {
    globalThis.dispatchEvent?.(new Event(LOCAL_PRODUCTS_CHANGED_EVENT));
  } catch (error) {
    console.log('Local products event error:', error.message);
  }

  return normalizedProducts;
};

export const upsertLocalProduct = (product) => {
  const products = getLocalProducts();
  const normalizedProduct = normalizeProduct(product.id, {
    ...product,
    isLocal: true,
  });

  return saveLocalProducts([
    ...products.filter((item) => item.id !== normalizedProduct.id),
    normalizedProduct,
  ]);
};

export const removeLocalProduct = (productId) =>
  saveLocalProducts(getLocalProducts().filter((product) => product.id !== productId));

const subscribeLocalProducts = (listener) => {
  if (!globalThis.addEventListener) {
    return () => {};
  }

  const handleStorage = (event) => {
    if (!event || event.key === LOCAL_PRODUCTS_KEY) {
      listener();
    }
  };

  globalThis.addEventListener(LOCAL_PRODUCTS_CHANGED_EVENT, listener);
  globalThis.addEventListener('storage', handleStorage);

  return () => {
    globalThis.removeEventListener?.(LOCAL_PRODUCTS_CHANGED_EVENT, listener);
    globalThis.removeEventListener?.('storage', handleStorage);
  };
};

const mergeProducts = (firestoreProducts, localProducts) => {
  const productsById = new Map();

  firestoreProducts.forEach((product) => {
    productsById.set(product.id, product);
  });

  localProducts.forEach((product) => {
    productsById.set(product.id, {
      ...productsById.get(product.id),
      ...product,
    });
  });

  return sortProducts(Array.from(productsById.values()));
};

export const subscribeProducts = (listener, onError) => {
  let firestoreProducts = [];

  const emitProducts = () => {
    listener(mergeProducts(firestoreProducts, getLocalProducts()));
  };

  emitProducts();
  const unsubscribeLocalProducts = subscribeLocalProducts(emitProducts);
  const productsQuery = query(
    collection(db, PRODUCTS_COLLECTION),
    orderBy('created_at', 'asc')
  );

  const unsubscribeFirestore = onSnapshot(
    productsQuery,
    (snapshot) => {
      firestoreProducts = snapshot.docs.map((item) =>
        normalizeProduct(item.id, item.data())
      );
      emitProducts();
    },
    (error) => {
      console.log('Products Firestore subscription error:', error.message);
      onError?.(error);
      emitProducts();
    }
  );

  return () => {
    unsubscribeFirestore();
    unsubscribeLocalProducts();
  };
};

const sanitizeFileName = (fileName = 'product-image') =>
  fileName.replace(/[^a-zA-Z0-9._-]/g, '-');

const uploadProductImage = async (imageFile, productId) => {
  if (!imageFile) {
    return {};
  }

  const fileName = sanitizeFileName(imageFile.name || 'product-image');
  const imageRef = ref(storage, `products/${productId}/${Date.now()}-${fileName}`);

  await withFirebaseTimeout(
    uploadBytes(imageRef, imageFile),
    'Product image upload'
  );

  return {
    image: await withFirebaseTimeout(
      getDownloadURL(imageRef),
      'Product image URL lookup'
    ),
    imagePath: imageRef.fullPath,
  };
};

const buildLocalProduct = (id, payload, existingProduct = {}) => {
  const now = new Date().toISOString();
  const existingCreatedAt = timestampToMillis(existingProduct.created_at);
  const createdAt = existingCreatedAt
    ? new Date(existingCreatedAt).toISOString()
    : now;

  return normalizeProduct(id, {
    ...existingProduct,
    ...payload,
    id,
    created_at: createdAt,
    updated_at: now,
    isLocal: true,
  });
};

const syncCreatedProductToFirebase = async ({
  productRef,
  localProduct,
  imageFile,
  imageDataUrl,
}) => {
  let imagePayload = {
    image: imageDataUrl || localProduct.image || '',
    imagePath: localProduct.imagePath || '',
  };

  if (imageFile) {
    try {
      imagePayload = await uploadProductImage(imageFile, productRef.id);
      upsertLocalProduct({
        ...localProduct,
        image: imagePayload.image,
        imagePath: imagePayload.imagePath,
      });
    } catch (error) {
      console.log('Product image upload fallback:', error.message);
    }
  }

  const firestorePayload = {
    product_name: localProduct.product_name,
    price: normalizePrice(localProduct.price),
    image: imagePayload.image,
    imagePath: imagePayload.imagePath,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };

  try {
    await withFirebaseTimeout(
      setDoc(productRef, firestorePayload),
      'Product save'
    );
  } catch (error) {
    console.log('Product Firebase background save error:', error.message);
  }
};

const syncUpdatedProductToFirebase = async ({
  productId,
  localProduct,
  imageFile,
  imageDataUrl,
  existingProduct = {},
}) => {
  let imagePayload = {
    image: localProduct.image || imageDataUrl || existingProduct.image || '',
    imagePath: localProduct.imagePath || existingProduct.imagePath || '',
  };

  if (imageFile) {
    try {
      imagePayload = await uploadProductImage(imageFile, productId);
      upsertLocalProduct({
        ...localProduct,
        image: imagePayload.image,
        imagePath: imagePayload.imagePath,
      });
    } catch (error) {
      console.log('Product image upload fallback:', error.message);
    }
  }

  const firestorePayload = {
    product_name: localProduct.product_name,
    price: normalizePrice(localProduct.price),
    image: imagePayload.image,
    imagePath: imagePayload.imagePath,
    created_at: existingProduct.created_at || serverTimestamp(),
    updated_at: serverTimestamp(),
  };

  try {
    await withFirebaseTimeout(
      setDoc(doc(db, PRODUCTS_COLLECTION, productId), firestorePayload, {
        merge: true,
      }),
      'Product update'
    );

    if (
      imagePayload.imagePath &&
      existingProduct.imagePath &&
      imagePayload.imagePath !== existingProduct.imagePath
    ) {
      deleteObject(ref(storage, existingProduct.imagePath)).catch((error) => {
        console.log('Previous product image delete error:', error.message);
      });
    }
  } catch (error) {
    console.log('Product Firebase background update error:', error.message);
  }
};

export const createProduct = async ({
  product_name,
  price,
  imageFile,
  imageDataUrl,
}) => {
  const productRef = doc(collection(db, PRODUCTS_COLLECTION));
  const localProduct = buildLocalProduct(productRef.id, {
    product_name: product_name.trim(),
    price: normalizePrice(price),
    image: imageDataUrl || '',
    imagePath: '',
  });

  upsertLocalProduct(localProduct);

  void syncCreatedProductToFirebase({
    productRef,
    localProduct,
    imageFile,
    imageDataUrl,
  });

  return localProduct;
};

export const updateProduct = async (
  productId,
  { product_name, price, imageFile, imageDataUrl, existingProduct = {} }
) => {
  const localProduct = buildLocalProduct(
    productId,
    {
      ...existingProduct,
      product_name: product_name.trim(),
      price: normalizePrice(price),
      image: imageDataUrl || existingProduct.image || '',
      imagePath: existingProduct.imagePath || '',
    },
    existingProduct
  );

  upsertLocalProduct(localProduct);

  void syncUpdatedProductToFirebase({
    productId,
    localProduct,
    imageFile,
    imageDataUrl,
    existingProduct,
  });

  return localProduct;
};

export const deleteProduct = async (product) => {
  if (product.isLocal) {
    removeLocalProduct(product.id);
    return;
  }

  await withFirebaseTimeout(
    deleteDoc(doc(db, PRODUCTS_COLLECTION, product.id)),
    'Product delete'
  );
  removeLocalProduct(product.id);

  if (product.imagePath) {
    deleteObject(ref(storage, product.imagePath)).catch((error) => {
      console.log('Product image delete error:', error.message);
    });
  }
};
