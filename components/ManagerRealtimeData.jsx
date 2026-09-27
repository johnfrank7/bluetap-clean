import React from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import { getModuleSession } from '../services/authSession';
const { getManagerQueues, pendingBranchApplications } = require('../services/managerOperational');

const emptyState = {
  branch: null,
  users: [],
  requests: [],
  incomingTransfers: [],
  applicants: [],
  pendingApplications: [],
  sourceDecisionEvents: [],
  requestsCount: 0,
  dispatchCount: 0,
  loading: true,
  error: '',
  revision: '',
  branchId: '',
  managerUid: '',
};

const ManagerRealtimeContext = React.createContext(emptyState);

const revisionFor = (requests, incomingTransfers, users) => ['ready',
  ...requests,
  ...incomingTransfers,
  ...users,
].map((item) => `${item.id}|${item.status || item.role || ''}|${item.updatedAt?.seconds || item.updated_at?.seconds || ''}`).join('::');

export function ManagerRealtimeDataProvider({ children }) {
  const session = getModuleSession('manager');
  const branchId = session?.branchId || '';
  const managerUid = session?.uid || '';
  const [state, setState] = React.useState(emptyState);

  React.useEffect(() => {
    if (!branchId) {
      setState({ ...emptyState, loading: false });
      return undefined;
    }

    const current = { branch: null, users: [], requests: [], incomingTransfers: [], applicants: [], sourceDecisionEvents: [] };
    const ready = { branch: false, users: false, requests: false, incomingTransfers: false, applicants: false, sourceDecisionEvents: false };
    const listenerErrors = {};
    let active = true;

    const publish = () => {
      if (!active) return;
      const loading = !(ready.branch && ready.users && ready.requests);
      const queues = getManagerQueues(current.requests, current.incomingTransfers, branchId);
      setState({
        ...current,
        branchId,
        managerUid,
        pendingApplications: pendingBranchApplications(current.applicants, branchId),
        requestsCount: queues.requestsCount,
        dispatchCount: queues.dispatchCount,
        loading,
        error: Object.values(listenerErrors).find(Boolean) || '',
        revision: revisionFor(current.requests, current.incomingTransfers, current.users),
      });
    };

    const watch = (source, key, mapSnapshot) => onSnapshot(
      source,
      (snapshot) => {
        current[key] = mapSnapshot(snapshot);
        ready[key] = true;
        delete listenerErrors[key];
        publish();
      },
      (error) => {
        ready[key] = true;
        listenerErrors[key] = 'Branch data is temporarily unavailable.';
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[ManagerRealtimeData] listener failed', {
            source: key,
            code: error?.code || 'unknown',
          });
        }
        publish();
      }
    );

    const unsubscribers = [
      watch(doc(db, 'branches', branchId), 'branch', (snapshot) =>
        snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null
      ),
      watch(query(collection(db, 'users'), where('branchId', '==', branchId)), 'users', (snapshot) =>
        snapshot.docs.map((item) => ({ id: item.id, uid: item.id, ...item.data() }))
      ),
      watch(query(collection(db, 'users'),
        where('requestedBranchId', '==', branchId),
        where('role', '==', 'distributor'),
        where('distributorStatus', '==', 'pending')), 'applicants', (snapshot) =>
        snapshot.docs.map((item) => ({ id: item.id, uid: item.id, ...item.data() }))
      ),
      watch(query(collection(db, 'requests'), where('branchId', '==', branchId)), 'requests', (snapshot) =>
        snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      ),
      watch(
        query(
          collection(db, 'requests'),
          where('transferToBranchId', '==', branchId),
          where('status', '==', 'branch_transfer_pending')
        ),
        'incomingTransfers',
        (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      ),
      watch(query(collection(db, 'managerOperationalEvents'), where('sourceBranchId', '==', branchId)), 'sourceDecisionEvents', (snapshot) =>
        snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      ),
    ];

    return () => {
      active = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [branchId, managerUid]);

  return (
      <ManagerRealtimeContext.Provider value={state.branchId === branchId && state.managerUid === managerUid ? state : { ...emptyState, branchId, managerUid }}>
      {children}
    </ManagerRealtimeContext.Provider>
  );
}

export const useManagerRealtimeData = () => React.useContext(ManagerRealtimeContext);
