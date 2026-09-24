import React, { useEffect, useState, useCallback } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';

export function isDistributorProfileComplete(profile = {}) {
  if (!profile) return false;
  const fullName = String(profile.fullName || profile.full_name || `${profile.firstName || ''} ${profile.lastName || ''}`).trim();
  const phone = String(profile.phone || profile.contactNumber || profile.contact_number || profile.phoneNumber || '').trim();
  const address = String(profile.completeAddress || profile.address || profile.barangay || '').trim();
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
    const user = auth.currentUser;
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    try {
      const userRef = doc(db, 'users', user.uid);
      const unsubscribe = onSnapshot(
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
      return () => unsubscribe();
    } catch (err) {
      setError(err.message || 'Failed to listen to profile');
      setLoading(false);
    }
  }, []);

  const isComplete = profile ? isDistributorProfileComplete(profile) : false;

  return { profile, isComplete, loading, error };
}

