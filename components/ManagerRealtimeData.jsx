import React from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import { getModuleSession } from '../services/authSession';

const emptyState = {
  branch: null,
  users: [],
  requests: [],
  incomingTransfers: [],
  loading: true,
  error: '',
  revision: '',
};

const ManagerRealtimeContext = React.createContext(emptyState);

const revisionFor = (requests, incomingTransfers, users) => ['ready',
  ...requests,
  ...incomingTransfers,
  ...users,
].map((item) => `${item.id}|${item.status || item.role || ''}|${item.updatedAt?.seconds || item.updated_at?.seconds || ''}`).join('::');

export function ManagerRealtimeDataProvider({ children }) {
  const branchId = getModuleSession('manager')?.branchId || '';
  const [state, setState] = React.useState(emptyState);

  React.useEffect(() => {
    if (!branchId) {
      setState({ ...emptyState, loading: false });
      return undefined;
    }

    const current = { branch: null, users: [], requests: [], incomingTransfers: [] };
    const ready = { branch: false, users: false, requests: false, incomingTransfers: false };
    let active = true;

    const publish = (error = '') => {
      if (!active) return;
      const loading = !Object.values(ready).every(Boolean);
      setState({
        ...current,
        loading,
        error,
        revision: loading ? '' : revisionFor(current.requests, current.incomingTransfers, current.users),
      });
    };

    const watch = (source, key, mapSnapshot) => onSnapshot(
      source,
      (snapshot) => {
        current[key] = mapSnapshot(snapshot);
        ready[key] = true;
        publish();
      },
      (error) => {
        ready[key] = true;
        publish(error.message || 'Branch data is temporarily unavailable.');
      }
    );

    const unsubscribers = [
      watch(doc(db, 'branches', branchId), 'branch', (snapshot) =>
        snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null
      ),
      watch(query(collection(db, 'users'), where('branchId', '==', branchId)), 'users', (snapshot) =>
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
    ];

    return () => {
      active = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [branchId]);

  return (
    <ManagerRealtimeContext.Provider value={{ ...state, branchId }}>
      {children}
    </ManagerRealtimeContext.Provider>
  );
}

export const useManagerRealtimeData = () => React.useContext(ManagerRealtimeContext);
