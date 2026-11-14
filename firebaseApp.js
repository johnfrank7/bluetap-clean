import { getApp, getApps, initializeApp } from 'firebase/app';
import { resolveFirebaseWebConfig } from './services/stagingConfig';

export const firebaseConfig = resolveFirebaseWebConfig();
if (getApps().length && getApp().options.projectId !== firebaseConfig.projectId) {
  throw new Error('Firebase application project does not match the active environment.');
}
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
