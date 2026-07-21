import { getApp, getApps, initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: 'AIzaSyC51lebYaIK8j1GgfchVXik97Ya9BDRPsM',
  authDomain: 'bluetap-cce88.firebaseapp.com',
  projectId: 'bluetap-cce88',
  storageBucket: 'bluetap-cce88.firebasestorage.app',
  messagingSenderId: '839019297596',
  appId: '1:839019297596:web:717876951a4b39a1aa7c39',
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
