import React from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import { useProtectedReadSession } from '../services/useProtectedReadSession';
import { ensureManagerProfile } from '../services/managerProfile';
const { getManagerQueues, pendingBranchApplications } = require('../services/managerOperational');

const emptyState = {
  branch: null,
  profile: null,
  users: [],
  requests: [],
  incomingTransfers: [],
  applicants: [],
  pendingApplications: [],
  sourceDecisionEvents: [],
  requestsCount: 0,
  dispatchCount: 0,
  loading: true,
  branchLoading: true,
  profileLoading: true,
  error: '',
  errors: {},
  revision: '',
  branchId: '',
  managerUid: '',
  retry: () => {},
  primeProfile: () => {},
};

const ManagerRealtimeContext = React.createContext(emptyState);

const revisionFor = (requests, incomingTransfers, users) => ['ready',
  ...requests,
  ...incomingTransfers,
  ...users,
].map((item) => `${item.id}|${item.status || item.role || ''}|${item.updatedAt?.seconds || item.updated_at?.seconds || ''}`).join('::');

export function ManagerRealtimeDataProvider({ children }) {
  const session = useProtectedReadSession('manager');
  const branchId = session.readiness === 'READY' ? session.profile.branchId : '';
  const managerUid = session.uid;
  const [state, setState] = React.useState(emptyState);
  const stateRef = React.useRef(emptyState);
  const [retryVersion, setRetryVersion] = React.useState(0);
  const ensuredUid = React.useRef('');
  React.useEffect(() => {
    const publicUid = String(session.profile?.publicUid || session.profile?.displayUid || session.profile?.unique_id || '');
    if (session.readiness !== 'READY' || /^(?:Man|Mgr)-?\d+$/i.test(publicUid) || ensuredUid.current === managerUid) return;
    ensuredUid.current = managerUid;
    let active = true;
    ensureManagerProfile().catch(() => {
      if (active) setState((value) => ({ ...value, error: 'Your public UID could not be loaded. Please try again.' }));
    });
    return () => { active = false; };
  }, [session.readiness, session.profile, managerUid]);
  const retry = React.useCallback(() => setRetryVersion((value) => value + 1), []);
  const primeProfile = React.useCallback((profile) => {
    if (!profile || typeof profile !== 'object') return;
    setState((previous) => {
      const next = { ...previous, profile: { ...(previous.profile || {}), ...profile } };
      stateRef.current = next;
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!branchId || !managerUid) {
      const next = { ...emptyState, loading: false, branchLoading: false, profileLoading: false, retry, primeProfile };
      stateRef.current = next;
      setState(next);
      return undefined;
    }

    const cached = stateRef.current.branchId === branchId && stateRef.current.managerUid === managerUid ? stateRef.current : emptyState;
    const current = {
      branch: session.branch,
      profile: session.profile,
      users: cached.users,
      requests: cached.requests,
      incomingTransfers: cached.incomingTransfers,
      applicants: cached.applicants,
      sourceDecisionEvents: cached.sourceDecisionEvents,
    };
    const ready = { branch: true, profile: true, users: false, requests: false, incomingTransfers: false, applicants: false, sourceDecisionEvents: false };
    const listenerErrors = {};
    let active = true;

    const publish = () => {
      if (!active) return;
      const loading = !(ready.branch && ready.users && ready.requests);
      const queues = getManagerQueues(current.requests, current.incomingTransfers, branchId);
      const next = {
        ...current,
        branchId,
        managerUid,
        pendingApplications: pendingBranchApplications(current.applicants, branchId),
        requestsCount: queues.requestsCount,
        dispatchCount: queues.dispatchCount,
        loading,
        branchLoading: !ready.branch && !current.branch,
        profileLoading: !ready.profile && !current.profile,
        error: Object.values(listenerErrors).find(Boolean) || '',
        errors: { ...listenerErrors },
        revision: revisionFor(current.requests, current.incomingTransfers, current.users),
        retry,
        primeProfile,
      };
      stateRef.current = next;
      setState(next);
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
  }, [branchId, managerUid, primeProfile, retry, retryVersion]);

  return (
      <ManagerRealtimeContext.Provider value={{ ...(state.branchId === branchId && state.managerUid === managerUid ? state : { ...emptyState, branchId, managerUid, retry, primeProfile }), profile: session.profile, branch: session.branch, profileLoading: session.profileLoading, branchLoading: session.branchLoading, readiness: session.readiness, authReady: session.authReady, uid: session.uid }}>
      {children}
    </ManagerRealtimeContext.Provider>
  );
}

export const useManagerRealtimeData = () => React.useContext(ManagerRealtimeContext);
