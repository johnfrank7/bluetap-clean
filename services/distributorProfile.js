import React, { useEffect, useState, useCallback } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
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

export function useDistributorProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let unsubscribeSnapshot = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }

      if (!user?.uid) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const userRef = doc(db, 'users', user.uid);
        unsubscribeSnapshot = onSnapshot(
          userRef,
          (snap) => {
            if (snap.exists()) {
              setProfile({ uid: snap.id, ...snap.data() });
            } else {
              setProfile(null);
            }
            setLoading(false);
          },
          (err) => {
            setError(err.message || 'Failed to load profile');
            setLoading(false);
          }
        );
      } catch (err) {
        setError(err.message || 'Failed to listen to profile');
        setLoading(false);
      }
    });

    return () => {
      if (typeof unsubscribeAuth === 'function') unsubscribeAuth();
      if (unsubscribeSnapshot) unsubscribeSnapshot();
    };
  }, []);

  const isComplete = profile ? isDistributorProfileComplete(profile) : false;

  return { profile, isComplete, loading, error };
}

