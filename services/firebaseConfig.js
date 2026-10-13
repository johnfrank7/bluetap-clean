// Client-side Firebase web configuration resolver with staging isolation.
import { getAppEnv, isKnownProductionFirebaseProject, APP_ENVIRONMENTS } from './appEnv.js';

export function resolveFirebaseWebConfig(env = null, fallbackConfig = null) {
  const currentEnv = getAppEnv(env);

  if (currentEnv === APP_ENVIRONMENTS.STAGING) {
    const apiKey = (env && env.EXPO_PUBLIC_FIREBASE_API_KEY !== undefined)
      ? env.EXPO_PUBLIC_FIREBASE_API_KEY
      : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_API_KEY : undefined);

    const authDomain = (env && env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN !== undefined)
      ? env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
      : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN : undefined);

    const projectId = (env && env.EXPO_PUBLIC_FIREBASE_PROJECT_ID !== undefined)
      ? env.EXPO_PUBLIC_FIREBASE_PROJECT_ID
      : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID : undefined);

    const storageBucket = (env && env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET !== undefined)
      ? env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET
      : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET : undefined);

    const messagingSenderId = (env && env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID !== undefined)
      ? env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
      : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID : undefined);

    const appId = (env && env.EXPO_PUBLIC_FIREBASE_APP_ID !== undefined)
      ? env.EXPO_PUBLIC_FIREBASE_APP_ID
      : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_APP_ID : undefined);

    const measurementId = (env && env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID !== undefined)
      ? env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID
      : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID : undefined);

    if (!apiKey || !projectId) {
      throw new Error(
        '[BlueTap] Staging Firebase web configuration is missing required environment variables (EXPO_PUBLIC_FIREBASE_API_KEY, EXPO_PUBLIC_FIREBASE_PROJECT_ID).'
      );
    }

    if (isKnownProductionFirebaseProject(projectId)) {
      throw new Error(
        `[BlueTap] Security violation: Staging cannot initialize with production Firebase project "${projectId}".`
      );
    }

    return {
      apiKey,
      authDomain: authDomain || `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: storageBucket || `${projectId}.firebasestorage.app`,
      messagingSenderId,
      appId,
      measurementId,
    };
  }

  // Development with explicit custom project override
  const customDevProject = (env && env.EXPO_PUBLIC_FIREBASE_PROJECT_ID !== undefined)
    ? env.EXPO_PUBLIC_FIREBASE_PROJECT_ID
    : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID : undefined);

  if (currentEnv === APP_ENVIRONMENTS.DEVELOPMENT && customDevProject) {
    const projectId = customDevProject;
    const apiKey = (env && env.EXPO_PUBLIC_FIREBASE_API_KEY !== undefined)
      ? env.EXPO_PUBLIC_FIREBASE_API_KEY
      : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_API_KEY : fallbackConfig?.apiKey);
    const authDomain = (env && env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN !== undefined)
      ? env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
      : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN : `${projectId}.firebaseapp.com`);
    const storageBucket = (env && env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET !== undefined)
      ? env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET
      : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET : fallbackConfig?.storageBucket);
    const messagingSenderId = (env && env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID !== undefined)
      ? env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
      : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID : fallbackConfig?.messagingSenderId);
    const appId = (env && env.EXPO_PUBLIC_FIREBASE_APP_ID !== undefined)
      ? env.EXPO_PUBLIC_FIREBASE_APP_ID
      : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_APP_ID : fallbackConfig?.appId);
    const measurementId = (env && env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID !== undefined)
      ? env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID
      : (typeof process !== 'undefined' && process.env ? process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID : fallbackConfig?.measurementId);

    return {
      apiKey: apiKey || fallbackConfig?.apiKey,
      authDomain: authDomain || `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: storageBucket || fallbackConfig?.storageBucket || `${projectId}.firebasestorage.app`,
      messagingSenderId: messagingSenderId || fallbackConfig?.messagingSenderId,
      appId: appId || fallbackConfig?.appId,
      measurementId: measurementId || fallbackConfig?.measurementId,
    };
  }

  // Explicit production or standard local dev fallback
  return fallbackConfig || {
    projectId: 'bluetap-8c98d',
    authDomain: 'bluetap-8c98d.firebaseapp.com',
  };
}
