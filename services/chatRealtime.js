import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';

import { db } from '../firebase';
import { loadConversationSummaries } from './chatApi';

export const CHAT_SUMMARY_LIMIT = 50;
export const CHAT_REALTIME_MESSAGE_LIMIT = 40;

const withId = (snapshot) => ({ id: snapshot.id, ...snapshot.data() });

export function subscribeConversationSummaries({ role, uid, branchId, onData, onError }) {
  const participantField = role === 'manager'
    ? 'participantBranchIds'
    : ['requester', 'distributor'].includes(role)
      ? 'participantUserUids'
      : '';
  const principalId = role === 'manager' ? branchId : uid;

  if (!participantField || !principalId) {
    onData?.([]);
    return () => {};
  }

  let stopped = false;
  let running = false;
  let changed = false;
  let expiryTimer;
  const refresh = async () => {
    changed = true;
    if (running || stopped) return;
    running = true;
    try {
      do {
        changed = false;
        const items = await loadConversationSummaries();
        if (stopped) return;
        if (changed) continue;
        onData?.(items);
        clearTimeout(expiryTimer);
        const deadlines = items.map((item) => item.accessEndsAt?.toMillis?.() || Number(item.accessEndsAt?._seconds || item.accessEndsAt?.seconds || 0) * 1000 || Date.parse(item.accessEndsAt || '')).filter((value) => value > Date.now());
        if (deadlines.length) expiryTimer = setTimeout(refresh, Math.min(2147483647, Math.max(1, Math.min(...deadlines) - Date.now() + 25)));
      } while (changed && !stopped);
    } catch (error) {
      if (!stopped) onError?.(error);
    } finally { running = false; }
  };
  const unsubscribe = onSnapshot(
    doc(db, role === 'manager' ? 'chatBranchActivity' : 'chatUserActivity', principalId),
    refresh,
    (error) => { if (!stopped) onError?.(error); }
  );
  return () => { stopped = true; clearTimeout(expiryTimer); unsubscribe(); };
}
export function subscribeOpenConversationMessages({ conversationId, onData, onError }) {
  if (!conversationId) {
    onData?.([]);
    return () => {};
  }
  const messages = query(
    collection(db, 'chatConversations', conversationId, 'messages'),
    orderBy('seq', 'desc'),
    limit(CHAT_REALTIME_MESSAGE_LIMIT)
  );
  return onSnapshot(
    messages,
    (snapshot) => onData?.(snapshot.docs.map(withId)),
    (error) => onError?.(error)
  );
}
