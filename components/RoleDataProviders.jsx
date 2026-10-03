import React from 'react';
import { subscribeRequesterRequests } from '../services/requests';
import { useAssignedDistributorOrders } from '../services/distributorOrders';
import { useDistributorProfile } from '../services/distributorProfile';
import { useProtectedReadSession } from '../services/useProtectedReadSession';
import { getActiveBranches } from '../services/requesterOrdering';

const RequesterDataContext = React.createContext({ orders: [], branches: [], loading: true, error: '' });
const DistributorDataContext = React.createContext({ orders: [], profile: null, loading: true, error: '' });

export function RequesterDataProvider({ children }) {
  const session = useProtectedReadSession('requester');
  const [state, setState] = React.useState({ orders: [], loading: true, error: '' });
  const [branches, setBranches] = React.useState([]);
  React.useEffect(() => {
    if (session.readiness !== 'READY') {
      setState({ orders: [], loading: session.readiness !== 'GENUINE_DENIED', error: session.readiness === 'GENUINE_DENIED' ? session.error || 'Your order access could not be verified.' : '' });
      return undefined;
    }
    const subscribe = (uid) => {
      setState((current) => ({ ...current, uid, orders: current.uid === uid ? current.orders : [], loading: current.uid !== uid || !current.orders.length, error: '' }));
      return subscribeRequesterRequests(
        uid,
        (orders) => setState({ uid, orders, loading: false, error: '' }),
        (error) => setState((current) => ({ ...current, loading: false, error: error?.message || 'Orders are temporarily unavailable.' }))
      );
    };
    return subscribe(session.uid);
  }, [session.readiness, session.uid, session.error]);

  React.useEffect(() => {
    if (session.readiness !== 'READY') {
      setBranches([]);
      return undefined;
    }
    let active = true;
    getActiveBranches()
      .then((items) => { if (active) setBranches(Array.isArray(items) ? items : []); })
      .catch(() => { if (active) setBranches([]); });
    return () => { active = false; };
  }, [session.readiness, session.uid]);

  const sameUser = session.readiness === 'READY' && state.uid === session.uid;
  return <RequesterDataContext.Provider value={{ ...state, ...session, branches, orders: sameUser ? state.orders : [], loading: session.readiness.endsWith('_PENDING') || (session.readiness === 'READY' && (!sameUser || state.loading)), error: state.error }}>{children}</RequesterDataContext.Provider>;
}

export function DistributorDataProvider({ children }) {
  const session = useProtectedReadSession('distributor');
  const profileState = useDistributorProfile();
  const orderState = useAssignedDistributorOrders();
  const value = React.useMemo(() => ({
    ...session,
    orders: orderState.orders,
    profile: profileState.profile,
    loading: profileState.loading || orderState.loading,
    profileLoading: profileState.loading,
    error: profileState.error || orderState.error,
    profileError: profileState.error,
  }), [session, orderState.error, orderState.loading, orderState.orders, profileState.error, profileState.loading, profileState.profile]);
  return <DistributorDataContext.Provider value={value}>{children}</DistributorDataContext.Provider>;
}

export const useRequesterData = () => React.useContext(RequesterDataContext);
export const useDistributorData = () => React.useContext(DistributorDataContext);
