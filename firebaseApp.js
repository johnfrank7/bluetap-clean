import { getApp, getApps, initializeApp } from 'firebase/app';
import productionWebConfig from './firebase-web-config.json';
import { resolveFirebaseWebConfig } from './services/firebaseConfig.js';

export const firebaseConfig = resolveFirebaseWebConfig(null, productionWebConfig);
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
