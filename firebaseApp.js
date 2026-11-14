import { getApp, getApps, initializeApp } from 'firebase/app';
import productionWebConfig from './firebase-web-config.json';

const isStaging = process.env.EXPO_PUBLIC_APP_ENV === 'staging' || process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID === 'bluetap-staging';

export const firebaseConfig = isStaging
  ? {
      apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyBfuRta5kl-ryk1MNVurafmEJdw2EBv_Qg',
      authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'bluetap-staging.firebaseapp.com',
      projectId: 'bluetap-staging',
      storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'bluetap-staging.firebasestorage.app',
      messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '452379686635',
      appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:452379686635:web:e6e8deaa6bc5a03a8a70ae',
      measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-VHGJKMVRVV',
    }
  : productionWebConfig;

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
