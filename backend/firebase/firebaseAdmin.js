// Server-only: never import this module from Expo screens or services.
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { assertStagingServerEnvironment } = require('../config/stagingIsolation');

function getFirebaseAdmin() {
  assertStagingServerEnvironment();
  const name = 'bluetap-vercel';
  let app = getApps().find((item) => item.name === name);
  if (app && app.options.projectId !== process.env.FIREBASE_PROJECT_ID &&
      process.env.APP_ENV === 'staging') {
    throw new Error('Staging Firebase Admin project does not match the active environment.');
  }
  if (!app) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) throw new Error('Missing server configuration');
    app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, name);
  }
  return { auth: getAuth(app), db: getFirestore(app) };
}
module.exports = { getFirebaseAdmin };
