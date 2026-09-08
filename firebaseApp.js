import { getApp, getApps, initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: 'AIzaSyBru23ErQof0OCkAQiVhkv2ae8V1sMR3_0',
  authDomain: 'bluetap-8c98d.firebaseapp.com',
  projectId: 'bluetap-8c98d',
  storageBucket: 'bluetap-8c98d.firebasestorage.app',
  messagingSenderId: '17869630531',
  appId: '1:17869630531:web:23344a86d4c889d4e3f8f6',
  measurementId: 'G-L9BMK67V4H',
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
