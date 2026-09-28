import React from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { auth, db } from '../firebase';
import { prefetchLikelyAdminDestinations } from '../services/adminPrefetch';

export const ADMIN_REQUEST_REALTIME_LIMIT = 500;
const ACTIONABLE_STATUSES = new Set([
  'pending',
  'outside_radius_pending_approval',
  'manager_approval_pending',
  'branch_transfer_pending',
]);

const AdminDataContext = React.createContext({
  requests: [],
  initialLoading: true,
  error: '',
  actionableRequestsCount: 0,
});

export function AdminDataProvider({ children }) {
  const [state, setState] = React.useState({ requests: [], initialLoading: true, error: '', uid: '' });

  React.useEffect(() => {
    let unsubscribeRequests = () => {};
    let cancelPrefetch = () => {};
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeRequests();
      unsubscribeRequests = () => {};
      cancelPrefetch();
      cancelPrefetch = () => {};
      const uid = user?.uid || '';
      setState((current) => uid === current.uid
        ? current
        : { requests: [], initialLoading: Boolean(uid), error: '', uid });
      if (!uid) return;

      cancelPrefetch = prefetchLikelyAdminDestinations();
      const requestQuery = query(
        collection(db, 'requests'),
        orderBy('createdAt', 'desc'),
        limit(ADMIN_REQUEST_REALTIME_LIMIT),
      );
      unsubscribeRequests = onSnapshot(
        requestQuery,
        (snapshot) => {
          const requests = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
          setState((current) => current.uid === uid
            ? { ...current, requests, initialLoading: false, error: '' }
            : current);
        },
        (error) => {
          setState((current) => current.uid === uid
            ? { ...current, initialLoading: false, error: error.message || 'Unable to subscribe to requests.' }
            : current);
        },
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeRequests();
      cancelPrefetch();
    };
  }, []);

  const value = React.useMemo(() => ({
    requests: state.requests,
    initialLoading: state.initialLoading,
    error: state.error,
    actionableRequestsCount: state.requests.reduce((count, request) =>
      count + (ACTIONABLE_STATUSES.has(String(request.status || '').toLowerCase()) ? 1 : 0), 0),
  }), [state.error, state.initialLoading, state.requests]);

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
}

export const useAdminRealtimeData = () => React.useContext(AdminDataContext);
