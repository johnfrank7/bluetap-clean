// Server-only: never import this module from Expo screens or services.
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { assertStagingServerEnvironment } = require('../config/stagingIsolation');
const { assertLocalQaServerEnvironment } = require('../config/localQaIsolation');

function getFirebaseAdmin() {
  const localQa = assertLocalQaServerEnvironment();
  if (!localQa) assertStagingServerEnvironment();
  const name = 'bluetap-vercel';
  let app = getApps().find((item) => item.name === name);
  if (app && app.options.projectId !== process.env.FIREBASE_PROJECT_ID &&
      (localQa || process.env.APP_ENV === 'staging')) {
    throw new Error('Firebase Admin project does not match the active environment.');
  }
  if (!app) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const isolatedTripTest = process.env.BLUETAP_TRIP_EMULATOR_MODE === '1' && projectId === 'demo-bluetap';
    if (localQa || isolatedTripTest) {
      app = initializeApp({ projectId }, name);
    } else {
      if (!projectId || !clientEmail || !privateKey) throw new Error('Missing server configuration');
      app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, name);
    }
  }
  const auth = getAuth(app); const db = getFirestore(app);
  if (process.env.BLUETAP_TRIP_EMULATOR_MODE === '1') {
    require('../utils/deliveryTripFoundation').requireTripEmulator(db, auth);
  }
  return { auth, db };
}
module.exports = { getFirebaseAdmin };
