const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { promotionTestCapability } = require('./promotionTestCapability');

// Server configuration only. A missing flag always means ordinary checkout.
// The emulator capability remains a separate, explicitly injected path.
function productionPromotionCapability(getAdmin = getFirebaseAdmin, env = process.env) {
  const flag = String(env.BLUETAP_PROMOTIONS_ENABLED || '').trim();
  if (!flag || flag === '0') return false;
  const project = env.APP_ENV === 'production' ? 'bluetap-8c98d' : env.APP_ENV === 'staging' ? 'bluetap-staging' : '';
  if (flag !== '1' || getAdmin !== getFirebaseAdmin || env.NODE_ENV !== 'production' || !project ||
      env.FIREBASE_PROJECT_ID !== project ||
      !String(env.FIREBASE_CLIENT_EMAIL || '').trim().toLowerCase().endsWith(`@${project}.iam.gserviceaccount.com`) ||
      !String(env.FIREBASE_PRIVATE_KEY || '').trim() || env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST ||
      env.EXPO_PUBLIC_AUTH_EMULATOR_URL || env.EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST || env.GOOGLE_APPLICATION_CREDENTIALS ||
      env.LOCAL_QA_EMULATORS === '1' || env.EXPO_PUBLIC_LOCAL_QA === '1' || env.BLUETAP_TRIP_EMULATOR_MODE === '1' ||
      env.BLUETAP_PROMOTION_ISOLATED_TEST === '1' ||
      (env.EXPO_PUBLIC_APP_ENV && env.EXPO_PUBLIC_APP_ENV !== env.APP_ENV) ||
      [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT, env.EXPO_PUBLIC_FIREBASE_PROJECT_ID].some((id) => id && id !== project)) {
    throw new Error('Promotion activation requires an approved server and matching Firebase configuration.');
  }
  return true;
}

function promotionCapability(getAdmin = getFirebaseAdmin, options = {}) {
  const test = promotionTestCapability(getAdmin, options);
  if (test && !['', '0'].includes(String(process.env.BLUETAP_PROMOTIONS_ENABLED || '').trim())) {
    throw new Error('Production and emulator promotion capabilities cannot be combined.');
  }
  const production = !test && productionPromotionCapability(getAdmin);
  if (production) {
    const { auth, db } = getAdmin();
    const project = process.env.FIREBASE_PROJECT_ID;
    if (auth?.app?.options?.projectId !== project || db?.projectId !== project) {
      throw new Error('Promotion activation requires matching Firebase clients.');
    }
  }
  return { enabled: test || production, test };
}

module.exports = { productionPromotionCapability, promotionCapability };
