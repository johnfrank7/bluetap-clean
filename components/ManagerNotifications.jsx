import React from 'react';
import { getModuleSession } from '../services/authSession';
import { parseTimestamp } from '../services/notificationTimestamp';
import { useManagerRealtimeData } from './ManagerRealtimeData';
const { getManagerNotifications, unreadManagerNotifications } = require('../services/managerNotifications');

const memorySeen = new Map();
const listeners = new Set();
const keyFor = (uid, branchId) => `bluetap_manager_notification_seen_${uid}_${branchId}`;
const readSeen = (key) => {
  if (!key) return new Set();
  try {
    const stored = globalThis.localStorage?.getItem(key);
    if (stored) return new Set(JSON.parse(stored));
  } catch {}
  return new Set(memorySeen.get(key) || []);
};
const writeSeen = (key, ids) => {
  if (!key) return;
  const values = [...ids].slice(-500);
  memorySeen.set(key, values);
  try { globalThis.localStorage?.setItem(key, JSON.stringify(values)); } catch {}
  listeners.forEach((listener) => listener());
};

export function useManagerNotifications() {
  const realtime = useManagerRealtimeData();
  const session = getModuleSession('manager');
  const key = session?.uid && realtime.branchId ? keyFor(session.uid, realtime.branchId) : '';
  const [seen, setSeen] = React.useState(() => readSeen(key));
  React.useEffect(() => {
    const sync = () => setSeen(readSeen(key));
    sync();
    listeners.add(sync);
    globalThis.addEventListener?.('storage', sync);
    return () => { listeners.delete(sync); globalThis.removeEventListener?.('storage', sync); };
  }, [key]);
  const events = React.useMemo(() => getManagerNotifications(realtime.requests, realtime.incomingTransfers,
    realtime.sourceDecisionEvents, realtime.branchId, parseTimestamp),
  [realtime.requests, realtime.incomingTransfers, realtime.sourceDecisionEvents, realtime.branchId]);
  const unread = React.useMemo(() => unreadManagerNotifications(events, seen), [events, seen]);
  const markRead = React.useCallback((ids) => {
    const next = new Set([...readSeen(key), ...ids]);
    writeSeen(key, next);
    setSeen(next);
  }, [key]);
  return { events, unreadCount: unread.length, markRead, loading: realtime.loading, error: realtime.error };
}
