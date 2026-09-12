import { getApp, getApps, initializeApp } from 'firebase/app';
import firebaseConfig from './firebase-web-config.json';

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
