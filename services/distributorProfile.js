import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';

export function isDistributorProfileComplete(profile = {}) {
  if (!profile || typeof profile !== 'object') return false;
  const fullName = String(profile.fullName || profile.full_name || `${profile.firstName || ''} ${profile.lastName || ''}`).trim();
  const phone = String(profile.phone || profile.contactNumber || profile.contact_number || profile.phoneNumber || '').trim();
  const address = typeof profile.completeAddress === 'string'
    ? profile.completeAddress.trim()
    : typeof profile.address === 'string'
      ? profile.address.trim()
      : typeof profile.barangay === 'string'
        ? profile.barangay.trim()
        : '';
  const branchId = String(profile.branchId || profile.assignedBranchId || '').trim();
  const status = String(profile.distributorStatus || profile.approvalStatus || profile.status || '').trim().toLowerCase();
  const isActive = status === 'active' || status === 'approved';
  return Boolean(fullName && phone && address && branchId && isActive);
}

const profileEntries = new Map();

const getProfileEntry = (uid) => {
  if (!profileEntries.has(uid)) {
    profileEntries.set(uid, {
      profile: null,
      loaded: false,
      error: '',
      subscribers: new Set(),
      unsubscribe: null,
      stopTimer: null,
    });
  }
  return profileEntries.get(uid);
};

const emitProfile = (entry) => {
  const state = { profile: entry.profile, loading: !entry.loaded, error: entry.error };
  entry.subscribers.forEach((listener) => listener(state));
};

const startProfileListener = (uid, entry) => {
  if (entry.stopTimer) {
    clearTimeout(entry.stopTimer);
    entry.stopTimer = null;
  }
  if (entry.unsubscribe) return;

  entry.unsubscribe = onSnapshot(
    doc(db, 'users', uid),
    (snapshot) => {
      entry.profile = snapshot.exists() ? { uid: snapshot.id, ...snapshot.data() } : null;
      entry.loaded = true;
      entry.error = '';
      emitProfile(entry);
    },
    (error) => {
      entry.loaded = true;
      entry.error = error.message || 'Failed to load profile';
      emitProfile(entry);
    }
  );
};

export const subscribeDistributorProfile = (uid, listener) => {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) {
    listener({ profile: null, loading: false, error: '' });
    return () => {};
  }

  const entry = getProfileEntry(normalizedUid);
  entry.subscribers.add(listener);
  listener({ profile: entry.profile, loading: !entry.loaded, error: entry.error });
  startProfileListener(normalizedUid, entry);

  return () => {
    entry.subscribers.delete(listener);
    if (entry.subscribers.size > 0) return;
    entry.unsubscribe?.();
    profileEntries.delete(normalizedUid);
  };
};

export const clearDistributorProfileCache = (uid) => {
  const normalizedUid = String(uid || '').trim();
  const entries = normalizedUid
    ? [[normalizedUid, profileEntries.get(normalizedUid)]]
    : [...profileEntries.entries()];
  entries.forEach(([key, entry]) => {
    if (!entry) return;
    if (entry.stopTimer) clearTimeout(entry.stopTimer);
    entry.unsubscribe?.();
    profileEntries.delete(key);
  });
};

export function useDistributorProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let unsubscribeProfile = subscribeDistributorProfile(auth.currentUser?.uid, (state) => {
      setProfile(state.profile);
      setLoading(state.loading);
      setError(state.error);
    });

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeProfile?.();
      unsubscribeProfile = subscribeDistributorProfile(user?.uid, (state) => {
        setProfile(state.profile);
        setLoading(state.loading);
        setError(state.error);
      });
    });

    return () => {
      if (typeof unsubscribeAuth === 'function') unsubscribeAuth();
      unsubscribeProfile?.();
    };
  }, []);

  const isComplete = profile ? isDistributorProfileComplete(profile) : false;

  return { profile, isComplete, loading, error };
}
