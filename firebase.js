import { connectFirestoreEmulator, getFirestore, initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

import { app } from './firebaseApp';
import { auth } from './firebaseAuth';
import { resolveLocalQaClient } from './services/stagingConfig';

const getConfiguredFirestore = () => {
  try {
    return initializeFirestore(app, {
      experimentalForceLongPolling: true,
    });
  } catch (error) {
    if (error?.code === 'failed-precondition') {
      return getFirestore(app);
    }

    throw error;
  }
};

export const db = getConfiguredFirestore();
const localQa = resolveLocalQaClient();
if (localQa) {
  const target = `${localQa.firestoreHost}:${localQa.firestorePort}`;
  const connections = globalThis.__bluetapLocalQaFirestoreConnections ||= new WeakMap();
  const existing = connections.get(db);
  if (existing && existing !== target) throw new Error('Local QA Firestore emulator target changed.');
  if (!existing) {
    connectFirestoreEmulator(db, localQa.firestoreHost, localQa.firestorePort);
    connections.set(db, target);
  }
}
export const storage = getStorage(app);
export { app, auth };
