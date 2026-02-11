// firebase.js
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyC51lebYaIK8j1GgfchVXik97Ya9BDRPsM',
  authDomain: 'bluetap-cce88.firebaseapp.com',
  projectId: 'bluetap-cce88',
  storageBucket: 'bluetap-cce88.firebasestorage.app',
  messagingSenderId: '839019297596',
  appId: '1:839019297596:web:717876951a4b39a1aa7c39',
};

const app = initializeApp(firebaseConfig);

// ✅ Auth & Firestore (what you actually need)
export const auth = getAuth(app);
export const db = getFirestore(app);
