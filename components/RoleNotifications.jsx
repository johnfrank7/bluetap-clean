import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { AppState, Platform } from 'react-native';

import { auth } from '../firebase';
import { fetchRequesterDeliveryReports, fetchRequesterReviewCompletions } from '../services/requesterDeliveryReports';
import { useDistributorData, useRequesterData } from './RoleDataProviders';
import { useChat } from './chat/ChatContext';
import { useModerationNotices } from './ModerationNotices';
const { getChatFollowupNotifications, getDistributorAttentionCounts, getRoleOrderNotifications } = require('../services/orderNotifications');
const { combineLoadedNotifications, countLoadedUnseen, createRequesterReportFeed, createRequesterReviewFeed } = require('../services/requesterReportNotificationFeed');
const { createRoleNotificationSeenStore } = require('../services/roleNotificationSeenStore');

const RoleNotificationContext = React.createContext({
  events: [], allEvents: [], unseenCount: 0, attentionCounts: { requests: 0, schedule: 0 },
  reportFeed: null, completionFeed: null, refreshReports: () => {}, loadOlderReports: () => {}, loadOlderCompletions: () => {},
  markSeen: () => {}, markAllSeen: () => {}, ready: false, unseenCountScope: 'loaded',
});
const seenStore = createRoleNotificationSeenStore(AsyncStorage);
const EMPTY_REPORT_FEED = { uid: '', events: [], nextCursor: null, hasMore: false,
  historyComplete: false, loaded: false, loading: false, loadingMore: false, error: '' };

export function RoleNotificationProvider({ role, children }) {
  const requester = useRequesterData();
  const distributor = useDistributorData();
  const chat = useChat();
  const moderation = useModerationNotices();
  const roleData = role === 'requester' ? requester : distributor;
  const uid = roleData.uid || roleData.profile?.uid || '';
  const requesterUid = role === 'requester' && roleData.readiness === 'READY'
    && auth.currentUser?.uid === uid ? uid : '';
  const key = seenStore.keyFor(role, role === 'requester' ? requesterUid : uid);
  const reportFeedRef = React.useRef(null);
  if (!reportFeedRef.current) reportFeedRef.current = createRequesterReportFeed({
    fetchPage: async (ownerUid, options) => {
      if (auth.currentUser?.uid !== ownerUid) throw new Error('Your report session changed. Please retry.');
      const result = await fetchRequesterDeliveryReports(undefined, options);
      if (auth.currentUser?.uid !== ownerUid) throw new Error('Your report session changed. Please retry.');
      return result;
    },
  });
  const completionFeedRef = React.useRef(null);
  if (!completionFeedRef.current) completionFeedRef.current = createRequesterReviewFeed({
    fetchPage: async (ownerUid, options) => {
      if (auth.currentUser?.uid !== ownerUid) throw new Error('Your review session changed. Please retry.');
      const result = await fetchRequesterReviewCompletions(options);
      if (auth.currentUser?.uid !== ownerUid) throw new Error('Your review session changed. Please retry.');
      return result;
    },
  });
  const [reportFeedState, setReportFeedState] = React.useState(reportFeedRef.current.getState());
  const [completionFeedState, setCompletionFeedState] = React.useState(completionFeedRef.current.getState());
  const reportFeed = requesterUid && reportFeedState.uid === requesterUid ? reportFeedState : EMPTY_REPORT_FEED;
  const completionFeed = requesterUid && completionFeedState.uid === requesterUid ? completionFeedState : EMPTY_REPORT_FEED;
  const [seen, setSeen] = React.useState(new Set());
  const [seenKey, setSeenKey] = React.useState('');
  const seenRef = React.useRef(seen);
  seenRef.current = seen;
  const [ready, setReady] = React.useState(false);
  const baseEvents = React.useMemo(() => [
    ...getRoleOrderNotifications(roleData.orders || [], role),
    ...getChatFollowupNotifications(chat.conversations || [], role),
    ...moderation.notices.map((notice) => ({
      id: `moderation:${notice.id}`, kind: 'moderation', noticeId: notice.id,
      status: notice.type === 'warn' ? 'warning' : notice.type === 'restore_branch_access' ? 'restored' : 'restricted',
      at: notice.createdAt?.toDate?.() || new Date(notice.createdAt || Date.now()),
      message: notice.type === 'warn'
        ? `${notice.title}: review your BlueTap conduct notice.`
        : notice.type === 'restore_branch_access'
          ? `Branch access restored${notice.branchName ? ` for ${notice.branchName}` : ''}.`
          : `${notice.title}${notice.branchName ? ` for ${notice.branchName}` : ''}${notice.reasonLabel ? ` (${notice.reasonLabel})` : ''}.`,
    })),
  ].sort((left, right) => right.at.getTime() - left.at.getTime()).slice(0, 150), [chat.conversations, moderation.notices, role, roleData.orders]);
  const allEvents = React.useMemo(() => combineLoadedNotifications(baseEvents, reportFeed.events, completionFeed.events),
    [baseEvents, reportFeed.events, completionFeed.events]);
  const events = React.useMemo(() => allEvents.slice(0, 150), [allEvents]);

  React.useEffect(() => reportFeedRef.current.subscribe(setReportFeedState), []);
  React.useEffect(() => completionFeedRef.current.subscribe(setCompletionFeedState), []);
  React.useEffect(() => {
    reportFeedRef.current.setUid(requesterUid);
    completionFeedRef.current.setUid(requesterUid);
    if (requesterUid) {
      reportFeedRef.current.refresh();
      completionFeedRef.current.refresh();
    }
  }, [requesterUid]);
  React.useEffect(() => {
    if (!requesterUid) return undefined;
    let previous = AppState.currentState;
    const refresh = () => {
      reportFeedRef.current.refresh();
      completionFeedRef.current.refresh();
    };
    const subscription = AppState.addEventListener?.('change', (next) => {
      if (next === 'active' && previous !== 'active') refresh();
      previous = next;
    });
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      subscription?.remove?.();
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [requesterUid]);

  React.useEffect(() => {
    let active = true;
    setReady(false);
    setSeenKey('');
    seenRef.current = new Set();
    setSeen(seenRef.current);
    seenStore.read(key).then((stored) => { if (active) { seenRef.current = stored; setSeen(stored); setSeenKey(key); setReady(true); } });
    if (!key) return () => { active = false; };
    const sync = (next) => { if (active) { seenRef.current = next; setSeen(next); } };
    const unsubscribe = seenStore.subscribe(key, sync);
    return () => { active = false; unsubscribe(); };
  }, [key]);

  const seenReady = ready && seenKey === key;
  const markSeen = React.useCallback((ids) => {
    if (!key || !seenReady) return;
    const validIds = (Array.isArray(ids) ? ids : [ids]).filter((id) => id && !seenRef.current.has(id));
    if (!validIds.length) return;
    const next = new Set([...seenRef.current, ...validIds]);
    seenRef.current = next;
    setSeen(next);
    seenStore.write(key, next);
  }, [key, seenReady]);
  const markAllSeen = React.useCallback(() => markSeen(allEvents.map((event) => event.id)), [allEvents, markSeen]);
  const unseenCount = seenReady ? countLoadedUnseen(allEvents, seen) : 0;
  const attentionCounts = React.useMemo(() => role === 'distributor' ? getDistributorAttentionCounts(roleData.orders || []) : { requests: 0, schedule: 0 }, [role, roleData.orders]);
  const refreshReports = React.useCallback((options) => Promise.all([
    reportFeedRef.current.refresh(options), completionFeedRef.current.refresh(options),
  ]), []);
  const loadOlderReports = React.useCallback(() => reportFeedRef.current.loadOlder(), []);
  const loadOlderCompletions = React.useCallback(() => completionFeedRef.current.loadOlder(), []);
  const unseenCountScope = role === 'requester' ? 'loaded' : 'all';
  const value = React.useMemo(() => ({ events, allEvents, unseenCount, unseenCountScope, attentionCounts,
    reportFeed, completionFeed, refreshReports, loadOlderReports, loadOlderCompletions,
    markSeen, markAllSeen, ready: seenReady }),
  [allEvents, attentionCounts, events, loadOlderReports, loadOlderCompletions, markAllSeen, markSeen,
    seenReady, refreshReports, reportFeed, completionFeed, unseenCount, unseenCountScope]);
  return <RoleNotificationContext.Provider value={value}>{children}</RoleNotificationContext.Provider>;
}

export const useRoleNotifications = () => React.useContext(RoleNotificationContext);
