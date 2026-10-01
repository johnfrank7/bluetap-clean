import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';

import { useDistributorData, useRequesterData } from './RoleDataProviders';
import { useChat } from './chat/ChatContext';
const { getChatFollowupNotifications, getDistributorAttentionCounts, getRoleOrderNotifications } = require('../services/orderNotifications');

const RoleNotificationContext = React.createContext({
  events: [], unseenCount: 0, attentionCounts: { requests: 0, schedule: 0 },
  markSeen: () => {}, markAllSeen: () => {}, ready: false,
});
const memorySeen = new Map();
const subscribers = new Map();
const storageKey = (role, uid) => `bluetap_${role}_notification_seen_${uid}`;

async function readSeen(key) {
  if (!key) return new Set();
  try {
    const stored = await AsyncStorage.getItem(key);
    if (stored) return new Set(JSON.parse(stored));
  } catch {}
  return new Set(memorySeen.get(key) || []);
}

async function writeSeen(key, values) {
  if (!key) return;
  const bounded = [...values].slice(-500);
  memorySeen.set(key, bounded);
  try { await AsyncStorage.setItem(key, JSON.stringify(bounded)); } catch {}
  (subscribers.get(key) || new Set()).forEach((listener) => listener(new Set(bounded)));
}

export function RoleNotificationProvider({ role, children }) {
  const requester = useRequesterData();
  const distributor = useDistributorData();
  const chat = useChat();
  const roleData = role === 'requester' ? requester : distributor;
  const uid = roleData.uid || roleData.profile?.uid || '';
  const key = uid ? storageKey(role, uid) : '';
  const [seen, setSeen] = React.useState(new Set());
  const seenRef = React.useRef(seen);
  seenRef.current = seen;
  const [ready, setReady] = React.useState(false);
  const events = React.useMemo(() => [
    ...getRoleOrderNotifications(roleData.orders || [], role),
    ...getChatFollowupNotifications(chat.conversations || [], role),
  ].sort((left, right) => right.at.getTime() - left.at.getTime()).slice(0, 150), [chat.conversations, role, roleData.orders]);

  React.useEffect(() => {
    let active = true;
    setReady(false);
    readSeen(key).then((stored) => { if (active) { seenRef.current = stored; setSeen(stored); setReady(true); } });
    if (!key) return () => { active = false; };
    const roleSubscribers = subscribers.get(key) || new Set();
    const sync = (next) => { if (active) { seenRef.current = next; setSeen(next); } };
    roleSubscribers.add(sync);
    subscribers.set(key, roleSubscribers);
    return () => { active = false; roleSubscribers.delete(sync); };
  }, [key]);

  const markSeen = React.useCallback((ids) => {
    const next = new Set([...seenRef.current, ...(Array.isArray(ids) ? ids : [ids]).filter(Boolean)]);
    seenRef.current = next;
    setSeen(next);
    writeSeen(key, next);
  }, [key]);
  const markAllSeen = React.useCallback(() => markSeen(events.map((event) => event.id)), [events, markSeen]);
  const unseenCount = ready ? events.filter((event) => !seen.has(event.id)).length : 0;
  const attentionCounts = React.useMemo(() => role === 'distributor' ? getDistributorAttentionCounts(roleData.orders || []) : { requests: 0, schedule: 0 }, [role, roleData.orders]);
  const value = React.useMemo(() => ({ events, unseenCount, attentionCounts, markSeen, markAllSeen, ready }), [attentionCounts, events, markAllSeen, markSeen, ready, unseenCount]);
  return <RoleNotificationContext.Provider value={value}>{children}</RoleNotificationContext.Provider>;
}

export const useRoleNotifications = () => React.useContext(RoleNotificationContext);
