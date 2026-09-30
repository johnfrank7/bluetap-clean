import React from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { subscribeDistributorProfile } from './distributorProfile';
const { protectedReadReadiness } = require('./protectedReadReadiness');

const initial = { uid: '', authReady: false, tokenReady: false, claims: {}, profile: null, profileLoading: true, branch: null, branchLoading: true, error: '' };

const stores = new Map();

function startSession(role, setState) {
    let generation = 0;
    let stopProfile;
    let stopBranch;
    let branchGeneration = 0;
    const stopAuth = onIdTokenChanged(auth, async (user) => {
      const current = ++generation;
      stopProfile?.(); stopBranch?.();
      stopProfile = null; stopBranch = null;
      setState({ ...initial, authReady: true, uid: user?.uid || '' });
      if (!user) return;
      try {
        const token = await user.getIdTokenResult();
        if (current !== generation || auth.currentUser?.uid !== user.uid) return;
        setState((value) => ({ ...value, tokenReady: true, claims: token.claims }));
        let watchedBranch = '';
        stopProfile = subscribeDistributorProfile(user.uid, ({ profile, loading, error }) => {
          if (current !== generation) return;
          const branchId = String(profile?.branchId || '').trim();
          setState((value) => ({ ...value, profile, profileLoading: loading, error, ...(branchId !== watchedBranch ? { branch: null, branchLoading: Boolean(branchId) } : {}) }));
          if (loading) return;
          if (role === 'requester') return;
          if (branchId === watchedBranch) return;
          stopBranch?.(); stopBranch = null; watchedBranch = branchId;
          const branchRun = ++branchGeneration;
          if (!branchId || error) return;
          stopBranch = onSnapshot(doc(db, 'branches', branchId), { includeMetadataChanges: true }, (snapshot) => {
            if (current !== generation || branchRun !== branchGeneration || snapshot.metadata.fromCache) return;
            setState((value) => ({ ...value, branch: snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null, branchLoading: false }));
          }, () => {
            if (current === generation && branchRun === branchGeneration) setState((value) => ({ ...value, branch: null, branchLoading: false, error: 'Your branch access could not be verified.' }));
          });
        });
      } catch {
        if (current === generation) setState((value) => ({ ...value, error: 'Your sign-in could not be verified.' }));
      }
    });
    return () => { generation++; stopAuth(); stopProfile?.(); stopBranch?.(); };
}

export function subscribeProtectedReadSession(role, listener) {
  let store = stores.get(role);
  if (!store) {
    store = { state: initial, listeners: new Set(), stop: null };
    stores.set(role, store);
  }
  store.listeners.add(listener);
  listener(store.state);
  if (!store.stop) store.stop = startSession(role, (update) => {
    store.state = typeof update === 'function' ? update(store.state) : update;
    store.listeners.forEach((notify) => notify(store.state));
  });
  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0) { store.stop?.(); stores.delete(role); }
  };
}

export function useProtectedReadSession(role) {
  const [state, setState] = React.useState(initial);
  React.useEffect(() => subscribeProtectedReadSession(role, setState), [role]);
  return { ...state, readiness: protectedReadReadiness({ ...state, role }) };
}
