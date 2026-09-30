import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';

import { db } from '../firebase';

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

  const summaries = query(
    collection(db, 'chatConversations'),
    where(participantField, 'array-contains', principalId),
    orderBy('updatedAt', 'desc'),
    limit(CHAT_SUMMARY_LIMIT)
  );

  return onSnapshot(
    summaries,
    (snapshot) => onData?.(snapshot.docs.map(withId)),
    (error) => onError?.(error)
  );
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
