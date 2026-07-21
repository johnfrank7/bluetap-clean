import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

import { app } from './firebaseApp';
import { auth } from './firebaseAuth';

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
export const storage = getStorage(app);
export { app, auth };
