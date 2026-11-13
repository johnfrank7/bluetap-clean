const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequesterOrdersHandler, createRequesterCatalogHandler } = require('../../requester/orderingHandler');
const { createAdminProductsHandler } = require('../../admin/productManagementHandler');

test('promotion test injection rejects unsafe environment, clients and ordinary routes', () => {
  const names = ['APP_ENV', 'NODE_ENV', 'LOCAL_QA_EMULATORS', 'BLUETAP_PROMOTION_ISOLATED_TEST', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID', 'FIREBASE_CONFIG', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_APP_ENV', 'EXPO_PUBLIC_API_BASE_URL', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_WEB_API_KEY', 'EMAIL_OTP_HASH_SECRET', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'RENDER_EXTERNAL_HOSTNAME', 'RENDER_SERVICE_NAME', 'VERCEL_URL', 'EMAIL_PROVIDER', 'RESEND_API_KEY', 'VERCEL_MAIL_RELAY_URL', 'INTERNAL_MAIL_RELAY_SECRET', 'EMAIL_FROM_ADDRESS', 'DEEPFACE_API_URL', 'DEEPFACE_API_KEY', 'ALLOWED_ORIGINS'];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const project = 'demo-bluetap-local-qa';
  class ApplicationDefaultCredential {}
  const getAdmin = () => ({ auth: { app: { options: { projectId: project, credential: new ApplicationDefaultCredential() } } }, db: { projectId: project, _settings: { servicePath: '127.0.0.1', port: 8080, ssl: false } } });
  try {
    names.forEach((name) => delete process.env[name]);
    Object.assign(process.env, { APP_ENV: 'local-qa', LOCAL_QA_EMULATORS: '1', GCLOUD_PROJECT: project, FIREBASE_PROJECT_ID: project, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_WEB_API_KEY: 'fake-local-qa-key', EMAIL_OTP_HASH_SECRET: 'synthetic-isolated-only' });
    assert.equal(typeof createRequesterOrdersHandler(getAdmin, { emulatorPromotionPricing: true }), 'function');
    assert.equal(typeof createRequesterCatalogHandler(getAdmin, { emulatorPromotionPricing: true }), 'function');
    assert.equal(typeof createAdminProductsHandler(getAdmin, { emulatorPromotionPricing: true }), 'function');
    for (const [key, value] of [['GCLOUD_PROJECT', 'production-project'], ['FIREBASE_PROJECT_ID', 'demo-bluetap'], ['FIREBASE_CONFIG', '{"projectId":"other"}'], ['FIREBASE_CONFIG', 'credentials.json'], ['GOOGLE_CLOUD_PROJECT', 'other'], ['FIRESTORE_EMULATOR_HOST', 'example.test:8080'], ['FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9098'], ['NODE_ENV', 'production'], ['FIREBASE_PRIVATE_KEY', 'synthetic-key'], ['GOOGLE_APPLICATION_CREDENTIALS', 'synthetic.json'], ['LOCAL_QA_EMULATORS', '0']]) {
      const before = process.env[key]; process.env[key] = value;
      assert.throws(() => createRequesterOrdersHandler(getAdmin, { emulatorPromotionPricing: true }), /Promotion test capability|Local QA/, key);
      assert.throws(() => createAdminProductsHandler(getAdmin, { emulatorPromotionPricing: true }), /Promotion test capability|Local QA/, key);
      if (before === undefined) delete process.env[key]; else process.env[key] = before;
    }
    assert.throws(() => createRequesterOrdersHandler(() => ({ ...getAdmin(), db: { projectId: 'other' } }), { emulatorPromotionPricing: true }), /matching emulator clients/);
    assert.throws(() => createRequesterOrdersHandler(() => ({ ...getAdmin(), db: { projectId: project, _settings: { servicePath: 'example.test', port: 8080, ssl: false } } }), { emulatorPromotionPricing: true }), /matching emulator clients/);
    assert.throws(() => createRequesterOrdersHandler(() => ({ ...getAdmin(), auth: { app: { options: { projectId: 'other', credential: new ApplicationDefaultCredential() } } } }), { emulatorPromotionPricing: true }), /matching emulator clients/);
    assert.throws(() => createRequesterOrdersHandler(() => ({ ...getAdmin(), auth: { app: { options: { projectId: project, credential: {} } } } }), { emulatorPromotionPricing: true }), /without service-account/);
    assert.throws(() => createRequesterOrdersHandler(undefined, { emulatorPromotionPricing: true }), /isolated matching/);
    assert.throws(() => createRequesterCatalogHandler(undefined, { emulatorPromotionPricing: true }), /isolated matching/);
    assert.throws(() => createAdminProductsHandler(undefined, { emulatorPromotionPricing: true }), /isolated matching/);
    assert.match(readFileSync(require.resolve('../../routes/index'), 'utf8'), /\['\/api\/requester\/orders', createRequesterOrdersHandler\(\)\]/);
    assert.match(readFileSync(require.resolve('../../routes/index'), 'utf8'), /\['\/api\/requester\/catalog', createRequesterCatalogHandler\(\)\]/);
  } finally { for (const [name, value] of Object.entries(original)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});

test('separate promotion emulator ports require the approved demo project and explicit opt-in', () => {
  const { promotionTestCapability } = require('../promotionTestCapability');
  const keys = ['GCLOUD_PROJECT', 'FIREBASE_PROJECT_ID', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'BLUETAP_PROMOTION_ISOLATED_TEST'];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  class ApplicationDefaultCredential {}
  const getAdmin = () => ({ auth: { app: { options: { projectId: 'demo-bluetap', credential: new ApplicationDefaultCredential() } } }, db: { projectId: 'demo-bluetap', _settings: { servicePath: '127.0.0.1', port: 18080, ssl: false } } });
  try {
    Object.assign(process.env, { GCLOUD_PROJECT: 'demo-bluetap', FIREBASE_PROJECT_ID: 'demo-bluetap', FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099', BLUETAP_PROMOTION_ISOLATED_TEST: '1' });
    assert.equal(promotionTestCapability(getAdmin, { emulatorPromotionPricing: true }), true);
    delete process.env.BLUETAP_PROMOTION_ISOLATED_TEST;
    assert.throws(() => promotionTestCapability(getAdmin, { emulatorPromotionPricing: true }));
    process.env.BLUETAP_PROMOTION_ISOLATED_TEST = '1';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'example.test:19099';
    assert.throws(() => promotionTestCapability(getAdmin, { emulatorPromotionPricing: true }));
  } finally { for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } }
});
