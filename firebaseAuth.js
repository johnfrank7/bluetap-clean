import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from 'firebase/auth';

import { app } from './firebaseApp';

const initializePersistedAuth = () => {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch (error) {
    if (error?.code === 'auth/already-initialized') {
      return getAuth(app);
    }

    throw error;
  }
};

export const auth = initializePersistedAuth();
