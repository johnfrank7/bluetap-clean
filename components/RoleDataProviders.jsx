import React from 'react';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '../firebase';
import { subscribeRequesterRequests } from '../services/requests';
import { useAssignedDistributorOrders } from '../services/distributorOrders';
import { useDistributorProfile } from '../services/distributorProfile';

export function RequesterDataProvider({ children }) {
  React.useEffect(() => {
    let unsubscribeRequests = subscribeRequesterRequests(auth.currentUser?.uid, () => {}, () => {});
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeRequests?.();
      unsubscribeRequests = subscribeRequesterRequests(user?.uid, () => {}, () => {});
    });

    return () => {
      unsubscribeAuth();
      unsubscribeRequests?.();
    };
  }, []);

  return children;
}

export function DistributorDataProvider({ children }) {
  useDistributorProfile();
  useAssignedDistributorOrders();
  return children;
}
