const test = require('node:test');
const assert = require('node:assert/strict');
const { getFirebaseAdmin } = require('../../firebase/firebaseAdmin');
const { productionPromotionCapability } = require('../promotionCapability');

const configured = {
  BLUETAP_PROMOTIONS_ENABLED: '1', NODE_ENV: 'production', APP_ENV: 'production',
  FIREBASE_PROJECT_ID: 'bluetap-8c98d',
  FIREBASE_CLIENT_EMAIL: 'synthetic@bluetap-8c98d.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: 'synthetic',
};

test('production promotion capability is closed by default and validates server identity', () => {
  assert.equal(productionPromotionCapability(getFirebaseAdmin, {}), false);
  assert.equal(productionPromotionCapability(getFirebaseAdmin, { ...configured, BLUETAP_PROMOTIONS_ENABLED: '0' }), false);
  assert.equal(productionPromotionCapability(getFirebaseAdmin, configured), true);
  assert.equal(productionPromotionCapability(getFirebaseAdmin, { ...configured, APP_ENV: 'staging', FIREBASE_PROJECT_ID: 'bluetap-staging', FIREBASE_CLIENT_EMAIL: 'synthetic@bluetap-staging.iam.gserviceaccount.com' }), true);
  for (const override of [
    { BLUETAP_PROMOTIONS_ENABLED: 'true' }, { NODE_ENV: 'test' }, { APP_ENV: 'staging' },
    { FIREBASE_PROJECT_ID: 'demo-bluetap' }, { FIREBASE_CLIENT_EMAIL: 'synthetic@example.test' },
    { FIREBASE_PRIVATE_KEY: '' }, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, { LOCAL_QA_EMULATORS: '1' },
    { EXPO_PUBLIC_LOCAL_QA: '1' }, { BLUETAP_TRIP_EMULATOR_MODE: '1' },
    { BLUETAP_PROMOTION_ISOLATED_TEST: '1' }, { GOOGLE_CLOUD_PROJECT: 'other-project' },
    { EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-bluetap' }, { EXPO_PUBLIC_APP_ENV: 'development' },
    { EXPO_PUBLIC_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099' }, { GOOGLE_APPLICATION_CREDENTIALS: 'other.json' },
  ]) assert.throws(() => productionPromotionCapability(getFirebaseAdmin, { ...configured, ...override }));
  assert.throws(() => productionPromotionCapability(() => ({}), configured));
});
