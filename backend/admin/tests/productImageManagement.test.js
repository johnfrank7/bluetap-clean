const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const { createAdminProductsHandler, safeProduct, safeRequestMetadata } = require('../productManagementHandler');
const { createSupabaseProductImageStorage, decodeProductImage, storageConfigStatus } = require('../../services/supabaseStorage');
const { createRequesterCatalogHandler } = require('../../requester/orderingHandler');
const { OtpError } = require('../../utils/otpError');

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const webp = Buffer.from('524946460400000057454250', 'hex');
const imagePayload = (contentType = 'image/jpeg', bytes = jpeg) => ({ contentType, dataBase64: bytes.toString('base64') });

function fixture() {
  const records = new Map([
    ['users/admin-1', { role: 'admin' }],
    ['users/manager-1', { role: 'manager' }],
    ['users/requester-1', { role: 'requester' }],
    ['branches/central', { name: 'Central', status: 'active' }],
    ['branches/bluetap-a', { name: 'bluetap A', status: 'active' }],
    ['branches/bluetap-b', { name: 'bluetap B', status: 'active' }],
    ['products/refill', { product_name: 'Refill', price: 35, active: true, branchIds: ['central'], imageUrl: 'https://example.supabase.co/storage/v1/object/public/products-images/products/refill/old.webp', imagePath: 'products/refill/old.webp', imageStorageProvider: 'supabase' }],
  ]);
  let auto = 0;
  let failTransaction = false;
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const collection = (name) => ({
    doc(id = `product-${++auto}`) { const path = `${name}/${id}`; return { id, path, get: async () => snapshot(path) }; },
    async get() { return { docs: [...records.keys()].filter((path) => path.startsWith(`${name}/`)).map(snapshot) }; },
  });
  const db = {
    collection,
    async runTransaction(run) {
      if (failTransaction) throw new Error('Firestore unavailable');
      return run({
        create(ref, data) { records.set(ref.path, data); },
        update(ref, data) { records.set(ref.path, { ...records.get(ref.path), ...data }); },
        set(ref, data) { records.set(ref.path, data); },
      });
    },
  };
  const auth = {
    async verifyIdToken(token) {
      if (token === 'admin-token') return { uid: 'admin-1', admin: true, role: 'admin' };
      if (token === 'manager-token') return { uid: 'manager-1', manager: true, role: 'manager' };
      if (token === 'requester-token') return { uid: 'requester-1', role: 'requester' };
      throw new Error('bad token');
    },
  };
  return { records, getAdmin: () => ({ auth, db }), failTransactions(value) { failTransaction = value; } };
}

function storage() {
  const calls = [];
  let next = 0;
  return {
    calls,
    async uploadProductImage(productId, image) {
      calls.push({ type: 'upload', productId, contentType: image.contentType });
      next += 1;
      const imagePath = `products/${productId}/new-${next}.${image.contentType === 'image/jpeg' ? 'jpg' : image.contentType.split('/')[1]}`;
      return { imageUrl: `https://example.supabase.co/storage/v1/object/public/products-images/${imagePath}`, imagePath, imageStorageProvider: 'supabase' };
    },
    async deleteProductImage(imagePath, productId) { calls.push({ type: 'delete', imagePath, productId }); },
  };
}

function response() {
  return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}
async function call(handler, method, token, body, contentType = 'application/json') {
  const res = response();
  await handler({ method, headers: token ? { authorization: `Bearer ${token}`, 'content-type': contentType } : { 'content-type': contentType }, body }, res);
  return res;
}

test('server validates JPEG, PNG, WebP, size, and actual image signatures', () => {
  assert.equal(decodeProductImage(imagePayload('image/jpeg')).bytes.length, jpeg.length);
  assert.equal(decodeProductImage(imagePayload('image/png', png)).contentType, 'image/png');
  assert.equal(decodeProductImage(imagePayload('image/webp', webp)).contentType, 'image/webp');
  assert.throws(() => decodeProductImage(imagePayload('image/gif', jpeg)), (error) => error.reason === 'PRODUCT_IMAGE_TYPE_INVALID');
  assert.throws(() => decodeProductImage(imagePayload('image/gif', jpeg)), (error) => error.status === 422 && error.reason === 'PRODUCT_IMAGE_TYPE_INVALID');
  assert.throws(() => decodeProductImage(imagePayload('image/png', jpeg)), (error) => error.reason === 'PRODUCT_IMAGE_TYPE_INVALID');
  assert.throws(() => decodeProductImage(imagePayload('image/jpeg', Buffer.concat([jpeg, Buffer.alloc(5 * 1024 * 1024)]))), (error) => error.reason === 'PRODUCT_IMAGE_TOO_LARGE');
});

test('Supabase product storage uses a server-generated safe path and public URL', async () => {
  const uploads = []; const removed = []; const logs = []; let clientArgs;
  const imageStorage = createSupabaseProductImageStorage({
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only', SUPABASE_STORAGE_BUCKET: 'products-images' },
    createClientImpl(...args) {
      clientArgs = args;
      return { storage: { async getBucket(bucket) { return { data: { id: bucket, public: true }, error: null }; }, from(bucket) { return {
        async upload(path, bytes, options) { uploads.push({ bucket, path, bytes, options }); return { error: null }; },
        getPublicUrl(path) { return { data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}` } }; },
        async remove(paths) { removed.push({ bucket, paths }); return { error: null }; },
      }; } } };
    },
    logger: { info(...entry) { logs.push(entry); }, error(...entry) { logs.push(entry); } },
  });
  const uploaded = await imageStorage.uploadProductImage('product_42', decodeProductImage(imagePayload('image/webp', webp)));
  assert.equal(clientArgs[0], 'https://example.supabase.co');
  assert.equal(clientArgs[1], 'server-only');
  assert.match(uploaded.imagePath, /^products\/product_42\/[a-f0-9-]+\.webp$/);
  assert.equal(uploads[0].bucket, 'products-images');
  assert.equal(uploads[0].options.contentType, 'image/webp');
  await imageStorage.deleteProductImage(uploaded.imagePath, 'product_42');
  assert.deepEqual(removed[0].paths, [uploaded.imagePath]);
  assert.match(JSON.stringify(logs), /PRODUCT_IMAGE_UPLOAD_STARTED/);
  assert.match(JSON.stringify(logs), /PRODUCT_IMAGE_BUCKET_CHECK_FINISHED/);
  assert.match(JSON.stringify(logs), /PRODUCT_IMAGE_UPLOAD_FINISHED/);
  assert.match(JSON.stringify(logs), /PRODUCT_IMAGE_DELETE_COMPLETED/);
  assert.doesNotMatch(JSON.stringify(logs), /server-only/);
});

test('Supabase failures map to safe product-image error codes', async () => {
  const unavailable = createSupabaseProductImageStorage({ env: {}, logger: { info() {}, error() {} } });
  await assert.rejects(unavailable.uploadProductImage('product_42', decodeProductImage(imagePayload())), (error) => error.reason === 'PRODUCT_IMAGE_STORAGE_UNAVAILABLE');
  const failed = createSupabaseProductImageStorage({
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only', SUPABASE_STORAGE_BUCKET: 'products-images' },
    createClientImpl: () => ({ storage: { getBucket: async () => ({ data: { id: 'products-images', public: true }, error: null }), from: () => ({ upload: async () => ({ error: new Error('provider failure') }) }) } }),
    logger: { info() {}, error() {} },
  });
  await assert.rejects(failed.uploadProductImage('product_42', decodeProductImage(imagePayload())), (error) => error.reason === 'PRODUCT_IMAGE_UPLOAD_FAILED');
});

test('Supabase bucket, authorization, public-read and public-URL failures keep precise safe codes', async () => {
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only', SUPABASE_STORAGE_BUCKET: 'products-images' };
  const clientForBucket = (result) => ({ storage: { getBucket: async () => result } });
  await assert.rejects(
    createSupabaseProductImageStorage({ env, createClientImpl: () => clientForBucket({ data: null, error: { status: 404, code: 'NoSuchBucket' } }), logger: { info() {}, error() {} } }).uploadProductImage('p1', decodeProductImage(imagePayload())),
    (error) => error.reason === 'SUPABASE_BUCKET_NOT_FOUND' && error.details.stage === 'PRODUCT_IMAGE_BUCKET_CHECK',
  );
  await assert.rejects(
    createSupabaseProductImageStorage({ env, createClientImpl: () => clientForBucket({ data: null, error: { status: 403, code: 'AccessDenied' } }), logger: { info() {}, error() {} } }).uploadProductImage('p1', decodeProductImage(imagePayload())),
    (error) => error.reason === 'SUPABASE_AUTH_FAILED',
  );
  await assert.rejects(
    createSupabaseProductImageStorage({ env, createClientImpl: () => clientForBucket({ data: { id: 'products-images', public: false }, error: null }), logger: { info() {}, error() {} } }).uploadProductImage('p1', decodeProductImage(imagePayload())),
    (error) => error.reason === 'SUPABASE_BUCKET_NOT_PUBLIC',
  );

  const removed = [];
  const invalidUrl = createSupabaseProductImageStorage({
    env,
    createClientImpl: () => ({ storage: {
      getBucket: async () => ({ data: { id: 'products-images', public: true }, error: null }),
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://example.supabase.co/not-public' } }),
        remove: async (paths) => { removed.push(paths); return { error: null }; },
      }),
    } }),
    logger: { info() {}, error() {} },
  });
  await assert.rejects(invalidUrl.uploadProductImage('p1', decodeProductImage(imagePayload())), (error) => error.reason === 'PRODUCT_IMAGE_PUBLIC_URL_FAILED');
  assert.equal(removed.length, 1);
});

test('Supabase configuration diagnostics reveal presence only', () => {
  assert.deepEqual(storageConfigStatus({}), { url: 'missing', serviceRoleKey: 'missing', bucket: 'missing' });
  assert.deepEqual(storageConfigStatus({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'secret', SUPABASE_STORAGE_BUCKET: 'products-images' }), { url: 'present', serviceRoleKey: 'present', bucket: 'present' });
  assert.doesNotMatch(JSON.stringify(storageConfigStatus({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'secret', SUPABASE_STORAGE_BUCKET: 'products-images' })), /secret|example/);
});

test('product image logging records only safe lifecycle stages', () => {
  const storageSource = readFileSync(resolve(__dirname, '..', '..', 'services', 'supabaseStorage.js'), 'utf8');
  const handlerSource = readFileSync(resolve(__dirname, '..', 'productManagementHandler.js'), 'utf8');
  for (const stage of ['PRODUCT_CREATE_REQUEST_RECEIVED', 'PRODUCT_CREATE_AUTHORIZED', 'PRODUCT_CREATE_VALIDATED', 'PRODUCT_CREATE_CONTENT_TYPE', 'PRODUCT_IMAGE_DECODED', 'PRODUCT_IMAGE_UPLOAD_STARTED', 'PRODUCT_IMAGE_UPLOAD_FINISHED', 'PRODUCT_FIRESTORE_WRITE_STARTED', 'PRODUCT_FIRESTORE_WRITE_FINISHED', 'PRODUCT_CREATE_COMPLETED', 'PRODUCT_IMAGE_UPLOAD_FAILED', 'PRODUCT_IMAGE_DELETE_COMPLETED', 'PRODUCT_IMAGE_DELETE_FAILED', 'PRODUCT_IMAGE_REPLACED']) {
    assert.match(storageSource + handlerSource, new RegExp(stage));
  }
  assert.doesNotMatch(storageSource, /logger\[level\].*serviceRoleKey/);
});

test('Admin product client sends one JSON payload and preserves image MIME inside that payload', () => {
  const adminApi = readFileSync(resolve(__dirname, '..', '..', '..', 'services', 'adminApi.js'), 'utf8');
  const adminProducts = readFileSync(resolve(__dirname, '..', '..', '..', 'services', 'adminProducts.js'), 'utf8');
  assert.match(adminApi, /'Content-Type': 'application\/json'/);
  assert.match(adminApi, /body: JSON\.stringify\(body\)/);
  assert.match(adminProducts, /signatureType\(await fileSignature\(file\)\)/);
  assert.match(adminProducts, /return \{ contentType, fileName, dataBase64:/);
  assert.doesNotMatch(adminApi + adminProducts, /FormData|multipart\/form-data/);
});

test('safe product diagnostics report schema and types without image bytes', () => {
  const body = {
    product_name: 'BlueTap 1-Gallon Purified Water',
    price: 25,
    branchIds: ['bluetap-a', 'bluetap-b'],
    imageUpload: imagePayload('image/png', png),
  };
  const metadata = safeRequestMetadata(body);
  assert.deepEqual(metadata.propertyNames, ['branchIds', 'imageUpload', 'price', 'product_name']);
  assert.equal(metadata.valueTypes.price, 'number');
  assert.equal(metadata.valueTypes.branchIds, 'array');
  assert.deepEqual(metadata.branchIds, ['bluetap-a', 'bluetap-b']);
  assert.deepEqual(metadata.image.propertyNames, ['contentType', 'dataBase64']);
  assert.equal(metadata.image.contentType, 'image/png');
  assert.equal(metadata.image.hasFileName, false);
  assert.equal(metadata.image.hasDataUrlPrefix, false);
  assert.doesNotMatch(JSON.stringify(metadata), new RegExp(body.imageUpload.dataBase64));
});

test('Admin creates a product with a Supabase image metadata record', async () => {
  const f = fixture(); const imageStorage = storage();
  const result = await call(createAdminProductsHandler(f.getAdmin, { imageStorage }), 'POST', 'admin-token', { product_name: 'Premium', price: 42, branchIds: ['central'], imageUpload: imagePayload() });
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.product.imageStorageProvider, 'supabase');
  assert.match(result.body.product.imageUrl, /supabase\.co\/storage/);
  assert.equal(imageStorage.calls.filter((item) => item.type === 'upload').length, 1);
  const saved = f.records.get(`products/${result.body.product.id}`);
  assert.equal(saved.imageStorageProvider, 'supabase');
  assert.equal(saved.image, undefined);
  assert.equal(saved.imageUrl, result.body.product.imageUrl);
});

test('product creation has one JSON contract: JSON without an image succeeds and unsupported HTTP media is rejected', async () => {
  const f = fixture(); const imageStorage = storage(); const handler = createAdminProductsHandler(f.getAdmin, { imageStorage, logger: { info() {} } });
  const withoutImage = await call(handler, 'POST', 'admin-token', { product_name: 'No image', price: 12 });
  assert.equal(withoutImage.statusCode, 201);
  assert.equal(imageStorage.calls.length, 0);
  const withCharset = await call(handler, 'POST', 'admin-token', { product_name: 'Charset', price: 12 }, 'application/json; charset=utf-8');
  assert.equal(withCharset.statusCode, 201);
  const unsupported = await call(handler, 'POST', 'admin-token', { product_name: 'Plain text', price: 12 }, 'text/plain');
  assert.equal(unsupported.statusCode, 415);
  assert.equal(unsupported.body.error.reason, 'UNSUPPORTED_PRODUCT_MEDIA_TYPE');
});

test('valid JSON with an invalid image MIME returns product validation, not an HTTP media-type error', async () => {
  const f = fixture(); const result = await call(createAdminProductsHandler(f.getAdmin, { imageStorage: storage(), logger: { info() {} } }), 'POST', 'admin-token', { product_name: 'Bad image', price: 12, imageUpload: imagePayload('image/gif', jpeg) });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.error.reason, 'PRODUCT_IMAGE_TYPE_INVALID');
});

test('storage failures retain the exact safe 502 reason and stage and never reach Firestore', async () => {
  const f = fixture();
  const imageStorage = {
    async uploadProductImage() {
      throw new OtpError(502, 'SUPABASE_AUTH_FAILED', 'Product image storage authorization failed.', { stage: 'PRODUCT_IMAGE_UPLOAD_STARTED' });
    },
  };
  const result = await call(createAdminProductsHandler(f.getAdmin, { imageStorage, logger: { info() {}, error() {} } }), 'POST', 'admin-token', {
    product_name: 'bluetap', price: 25, branchIds: [], imageUpload: imagePayload('image/png', png),
  });
  assert.equal(result.statusCode, 502);
  assert.deepEqual(result.body, { error: {
    reason: 'SUPABASE_AUTH_FAILED',
    message: 'Product image storage authorization failed.',
    stage: 'PRODUCT_IMAGE_UPLOAD_STARTED',
  } });
  assert.equal([...f.records.keys()].some((key) => key.startsWith('products/product-')), false);
});

test('a declared image MIME that differs from its bytes returns the exact actionable 422 before storage', async () => {
  const f = fixture(); const imageStorage = storage(); const logs = [];
  const handler = createAdminProductsHandler(f.getAdmin, { imageStorage, logger: { info(...entry) { logs.push(entry); } } });
  const result = await call(handler, 'POST', 'admin-token', {
    product_name: 'Mismatched image',
    price: 25,
    imageUpload: imagePayload('image/png', jpeg),
  });
  assert.equal(result.statusCode, 422);
  assert.deepEqual(result.body, { error: {
    reason: 'PRODUCT_IMAGE_TYPE_INVALID',
    message: 'The uploaded file does not match its image type.',
    fieldErrors: { imageUpload: 'The uploaded file does not match its image type.' },
  } });
  assert.equal(imageStorage.calls.length, 0);
  assert.match(JSON.stringify(logs), /PRODUCT_CREATE_PAYLOAD_RECEIVED/);
  assert.doesNotMatch(JSON.stringify(logs), /PRODUCT_IMAGE_DECODED|PRODUCT_IMAGE_UPLOAD_STARTED/);
});

test('the reported two-branch product payload succeeds with a valid image', async () => {
  const f = fixture(); const imageStorage = storage();
  const handler = createAdminProductsHandler(f.getAdmin, { imageStorage, logger: { info() {} } });
  const payload = {
    product_name: 'BlueTap 1-Gallon Purified Water',
    price: 25,
    containerType: 'Gallon Container',
    size: '1 Gallon / 3.8 Liters',
    description: 'SAFAFA',
    active: true,
    branchIds: ['bluetap-a', 'bluetap-b'],
    imageUpload: imagePayload('image/png', png),
  };
  const result = await call(handler, 'POST', 'admin-token', payload);
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.product.product_name, payload.product_name);
  assert.equal(result.body.product.price, 25);
  assert.equal(result.body.product.containerType, payload.containerType);
  assert.equal(result.body.product.size, payload.size);
  assert.equal(result.body.product.description, payload.description);
  assert.deepEqual(result.body.product.branchIds, payload.branchIds);
  assert.deepEqual(imageStorage.calls.map(({ type, contentType }) => ({ type, contentType })), [{ type: 'upload', contentType: 'image/png' }]);
  const saved = f.records.get(`products/${result.body.product.id}`);
  assert.deepEqual(saved.branchIds, payload.branchIds);
  assert.equal(saved.price, 25);
  const catalog = await call(createRequesterCatalogHandler(f.getAdmin), 'GET', 'requester-token');
  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.body.products.some((product) => product.id === result.body.product.id), true);
});

test('the current empty-branch product payload completes upload, Firestore, and Requester catalog', async () => {
  const f = fixture(); const imageStorage = storage(); const logs = [];
  const handler = createAdminProductsHandler(f.getAdmin, { imageStorage, logger: { info(...entry) { logs.push(entry); }, error(...entry) { logs.push(entry); } } });
  const result = await call(handler, 'POST', 'admin-token', {
    product_name: 'bluetap',
    price: 25,
    containerType: 'Gallon Container',
    size: '1 Gallon / 3.8 Liters',
    description: 'testttt',
    active: true,
    branchIds: [],
    imageUpload: { ...imagePayload('image/png', png), fileName: 'water.png' },
  });
  assert.equal(result.statusCode, 201);
  assert.deepEqual(result.body.product.branchIds, []);
  assert.match(result.body.product.imageUrl, /\/storage\/v1\/object\/public\/products-images\//);
  assert.equal(f.records.has(`products/${result.body.product.id}`), true);
  const catalog = await call(createRequesterCatalogHandler(f.getAdmin), 'GET', 'requester-token');
  assert.equal(catalog.body.products.some((product) => product.id === result.body.product.id), true);
  const stages = JSON.stringify(logs);
  for (const stage of ['PRODUCT_CREATE_REQUEST_RECEIVED', 'PRODUCT_CREATE_AUTHORIZED', 'PRODUCT_CREATE_VALIDATED', 'PRODUCT_IMAGE_DECODED', 'PRODUCT_FIRESTORE_WRITE_STARTED', 'PRODUCT_FIRESTORE_WRITE_FINISHED', 'PRODUCT_CREATE_COMPLETED']) assert.match(stages, new RegExp(stage));
});

test('a valid JSON image just under the decoded 5 MB limit uploads through the Admin API', async () => {
  const f = fixture(); const imageStorage = storage();
  const bytes = Buffer.concat([jpeg, Buffer.alloc(5 * 1024 * 1024 - jpeg.length - 1)]);
  const result = await call(createAdminProductsHandler(f.getAdmin, { imageStorage, logger: { info() {} } }), 'POST', 'admin-token', { product_name: 'Large image', price: 12, imageUpload: imagePayload('image/jpeg', bytes) });
  assert.equal(result.statusCode, 201);
  assert.equal(imageStorage.calls.filter((item) => item.type === 'upload').length, 1);
});

test('Admin uploads PNG and WebP product images through the same Render authorization path', async () => {
  const f = fixture(); const imageStorage = storage(); const handler = createAdminProductsHandler(f.getAdmin, { imageStorage });
  for (const [name, contentType, bytes] of [['PNG product', 'image/png', png], ['WebP product', 'image/webp', webp]]) {
    const result = await call(handler, 'POST', 'admin-token', { product_name: name, price: 42, imageUpload: imagePayload(contentType, bytes) });
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.product.imageStorageProvider, 'supabase');
  }
  assert.deepEqual(imageStorage.calls.filter((item) => item.type === 'upload').map((item) => item.contentType), ['image/png', 'image/webp']);
});

test('Requester and Manager cannot upload a product image through the Admin API', async () => {
  const f = fixture(); const imageStorage = storage(); const handler = createAdminProductsHandler(f.getAdmin, { imageStorage });
  for (const token of ['requester-token', 'manager-token']) {
    const result = await call(handler, 'POST', token, { product_name: 'Blocked', price: 1, imageUpload: imagePayload() });
    assert.equal(result.statusCode, 403);
  }
  assert.equal(imageStorage.calls.length, 0);
});

test('failed product creation cleans up only the newly uploaded Supabase image', async () => {
  const f = fixture(); const imageStorage = storage(); f.failTransactions(true);
  const result = await call(createAdminProductsHandler(f.getAdmin, { imageStorage }), 'POST', 'admin-token', { product_name: 'Premium', price: 42, imageUpload: imagePayload() });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.error.reason, 'PRODUCT_FIRESTORE_WRITE_FAILED');
  assert.equal(result.body.error.stage, 'PRODUCT_FIRESTORE_WRITE_STARTED');
  assert.deepEqual(imageStorage.calls.map((item) => item.type), ['upload', 'delete']);
});

test('editing a product without a replacement preserves its existing image', async () => {
  const f = fixture(); const imageStorage = storage();
  const result = await call(createAdminProductsHandler(f.getAdmin, { imageStorage }), 'PATCH', 'admin-token', { productId: 'refill', price: 40 });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.product.imagePath, 'products/refill/old.webp');
  assert.equal(imageStorage.calls.length, 0);
});

test('replacement uploads first, saves Firestore, then deletes the previous Supabase image', async () => {
  const f = fixture(); const imageStorage = storage();
  const result = await call(createAdminProductsHandler(f.getAdmin, { imageStorage }), 'PATCH', 'admin-token', { productId: 'refill', imageUpload: imagePayload('image/webp', webp) });
  assert.equal(result.statusCode, 200);
  assert.match(result.body.product.imagePath, /^products\/refill\/new-1\.webp$/);
  assert.deepEqual(imageStorage.calls.map((item) => item.type), ['upload', 'delete']);
  assert.equal(imageStorage.calls[1].imagePath, 'products/refill/old.webp');
});

test('failed replacement preserves the old image and cleans up only the newly uploaded object', async () => {
  const f = fixture(); const imageStorage = storage(); f.failTransactions(true);
  const result = await call(createAdminProductsHandler(f.getAdmin, { imageStorage }), 'PATCH', 'admin-token', { productId: 'refill', imageUpload: imagePayload() });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.error.reason, 'PRODUCT_FIRESTORE_WRITE_FAILED');
  assert.equal(f.records.get('products/refill').imagePath, 'products/refill/old.webp');
  assert.deepEqual(imageStorage.calls.map((item) => item.type), ['upload', 'delete']);
  assert.notEqual(imageStorage.calls[1].imagePath, 'products/refill/old.webp');
});

test('legacy Firebase URLs remain displayable while new URLs use Supabase metadata', () => {
  const legacy = safeProduct('legacy', { product_name: 'Legacy', price: 30, image: 'https://firebasestorage.googleapis.com/v0/b/legacy/o/product.png' });
  assert.match(legacy.imageUrl, /firebasestorage\.googleapis\.com/);
  const productCard = readFileSync(resolve(__dirname, '..', '..', '..', 'components', 'ProductCard.jsx'), 'utf8');
  assert.match(productCard, /product\?\.imageUrl \|\| product\?\.image/);
  const adminProducts = readFileSync(resolve(__dirname, '..', '..', '..', 'services', 'adminProducts.js'), 'utf8');
  assert.match(adminProducts, /imageUpload/);
  assert.doesNotMatch(adminProducts, /firebase\/storage|uploadBytes|deleteObject|getDownloadURL/);
});

test('Requester catalog returns the server-supplied Supabase image URL', async () => {
  const f = fixture();
  const result = await call(createRequesterCatalogHandler(f.getAdmin), 'GET', 'requester-token');
  assert.equal(result.statusCode, 200);
  assert.match(result.body.products.find((product) => product.id === 'refill').imageUrl, /example\.supabase\.co/);
});
