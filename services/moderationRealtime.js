import { doc, onSnapshot } from 'firebase/firestore';

import { auth, db } from '../firebase';

const subscriptions = new Map();

export function subscribeModerationActivity({ role, branchId = '', onChange, onError }) {
  const uid = auth.currentUser?.uid || '';
  const documentId = role === 'admin'
    ? 'admin'
    : role === 'manager'
      ? (branchId ? `branch_${branchId}` : '')
      : (uid ? `user_${uid}` : '');
  if (!documentId) return () => {};
  const key = `${uid}:${documentId}`;
  const listener = { onChange, onError };
  let entry = subscriptions.get(key);
  if (!entry) {
    entry = { listeners: new Set([listener]), unsubscribe: null };
    subscriptions.set(key, entry);
    entry.unsubscribe = onSnapshot(doc(db, 'moderationActivity', documentId),
      (snapshot) => entry.listeners.forEach((listener) => listener.onChange?.({ id: snapshot.id, exists: snapshot.exists(), revision: snapshot.data()?.revision || '' })),
      (error) => entry.listeners.forEach((listener) => listener.onError?.(error)));
  } else entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      entry.unsubscribe?.();
      subscriptions.delete(key);
    }
  };
}
