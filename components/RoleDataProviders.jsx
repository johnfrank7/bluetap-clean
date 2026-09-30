import React from 'react';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '../firebase';
import { subscribeRequesterRequests } from '../services/requests';
import { useAssignedDistributorOrders } from '../services/distributorOrders';
import { useDistributorProfile } from '../services/distributorProfile';

const RequesterDataContext = React.createContext({ orders: [], loading: true, error: '' });
const DistributorDataContext = React.createContext({ orders: [], profile: null, loading: true, error: '' });

export function RequesterDataProvider({ children }) {
  const [state, setState] = React.useState({ orders: [], loading: true, error: '' });
  React.useEffect(() => {
    const subscribe = (uid) => {
      setState((current) => ({ ...current, loading: !current.orders.length, error: '' }));
      return subscribeRequesterRequests(
        uid,
        (orders) => setState({ orders, loading: false, error: '' }),
        (error) => setState((current) => ({ ...current, loading: false, error: error?.message || 'Orders are temporarily unavailable.' }))
      );
    };
    let unsubscribeRequests = null;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeRequests?.();
      unsubscribeRequests = subscribe(user?.uid);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeRequests?.();
    };
  }, []);

  return <RequesterDataContext.Provider value={state}>{children}</RequesterDataContext.Provider>;
}

export function DistributorDataProvider({ children }) {
  const profileState = useDistributorProfile();
  const orderState = useAssignedDistributorOrders();
  const value = React.useMemo(() => ({
    orders: orderState.orders,
    profile: profileState.profile,
    loading: profileState.loading || orderState.loading,
    profileLoading: profileState.loading,
    error: profileState.error || orderState.error,
    profileError: profileState.error,
  }), [orderState.error, orderState.loading, orderState.orders, profileState.error, profileState.loading, profileState.profile]);
  return <DistributorDataContext.Provider value={value}>{children}</DistributorDataContext.Provider>;
}

export const useRequesterData = () => React.useContext(RequesterDataContext);
export const useDistributorData = () => React.useContext(DistributorDataContext);
