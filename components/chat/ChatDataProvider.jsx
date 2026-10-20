import React from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Platform, StyleSheet, View } from 'react-native';

import { auth } from '../../firebase';
import { deleteMessage as deleteChatMessage, editMessage as editChatMessage, loadConversationHistory, loadMessageHistory, markRead, resolveConversation, sendMessage } from '../../services/chatApi';
import { subscribeConversationSummaries, subscribeOpenConversationMessages } from '../../services/chatRealtime';
import { useAdminTheme } from '../AdminTheme';
import { useBlueTapTheme } from '../BlueTapTheme';
import { useManagerRealtimeData } from '../ManagerRealtimeData';
import { useDistributorData, useRequesterData } from '../RoleDataProviders';
import { ChatContext } from './ChatContext';
import ChatFloatingLauncher from './ChatFloatingLauncher';
import { useModerationNotices } from '../ModerationNotices';
import { playIncomingMessageSound } from '../../services/uiSound';

const chatModel = require('./chatModel');
const historyCache = require('./chatHistoryCache');
const { chatAccessReadiness } = require('./chatAccessReadiness');
const { avatarForConversation, conversationAllowedForRole, meaningfulName } = require('./chatPresentation');
const { createClientMutationId, formatBadge, isOwnMessage, mapResolveError, mergeMessages, principalStateFor, receiptFor, sendContextOrderId, shouldNotifyIncomingSummary, totalUnread, unreadForConversation } = chatModel;

const clean = (value) => String(value || '').trim();

export { mapResolveError };
const orderIdOf = (order) => clean(order?.id || order?.sourceId || order?.requestId || order?.request_id);
const orderReferenceOf = (order) => clean(order?.requestId || order?.request_id || order?.publicOrderReference);
const orderIdsForConversation = (conversation = {}) => {
  const ids = [conversation.orderId];
  Object.values(conversation.authorityReasons || {}).forEach((reason) => ids.push(...(reason?.orderIds || [])));
  return ids.map(clean).filter(Boolean);
};

export function presentationFor(conversation, role, roleData) {
  const orders = roleData.orders || [];
  const orderIds = new Set(orderIdsForConversation(conversation));
  const serverOrderId = orderIdOf(conversation.orderContext);
  const activeBranchOrder = conversation.type === 'requester_branch' && !conversation.historyId;
  const matchingOrder = orders.find((candidate) => orderIds.has(orderIdOf(candidate)) || orderIds.has(orderReferenceOf(candidate)));
  const order = conversation.historyId
    ? (conversation.orderContext || null)
    : activeBranchOrder
      ? (serverOrderId ? { ...(orders.find((candidate) => orderIdOf(candidate) === serverOrderId) || {}), ...conversation.orderContext } : null)
      : (conversation.orderContext ? { ...(matchingOrder || {}), ...conversation.orderContext } :
        (matchingOrder || conversation.orderContextLocal || null));
  const users = roleData.users || [];
  const userById = (uid) => users.find((user) => clean(user.uid || user.id) === clean(uid));
  let displayName = 'BlueTap conversation';
  let contextLabel = 'BlueTap messages';

  if (conversation.type === 'requester_branch') {
    const requesterBranchOrderReference = orderReferenceOf(order);
    displayName = role === 'manager'
      ? meaningfulName(conversation.requesterDisplayName, userById(conversation.requesterUid)?.fullName, order?.requesterNameSnapshot, order?.requesterName) || 'Requester'
      : clean(conversation.branchNameSnapshot || order?.currentBranchName || order?.currentBranchNameSnapshot || order?.branchNameSnapshot || order?.branchDisplayName || order?.water_station) || 'BlueTap Station';
    contextLabel = requesterBranchOrderReference ? `Order ${requesterBranchOrderReference}` : 'General inquiry';
  } else if (conversation.type === 'requester_distributor') {
    displayName = role === 'distributor'
      ? meaningfulName(conversation.requesterDisplayName, order?.requesterNameSnapshot, order?.requesterName, order?.customerName) || 'Requester'
      : meaningfulName(conversation.distributorDisplayName, order?.assignedDistributorNameSnapshot, order?.assignedDistributorName, order?.distributorName) || 'Assigned Distributor';
    contextLabel = orderReferenceOf(order) ? `Order ${orderReferenceOf(order)}` : 'Assigned order';
  } else if (conversation.type === 'distributor_branch') {
    displayName = role === 'manager'
      ? meaningfulName(conversation.distributorDisplayName, userById(conversation.distributorUid)?.fullName, userById(conversation.distributorUid)?.displayName) || 'Branch Distributor'
      : clean(roleData.profile?.branchName || roleData.branch?.name) || 'Your BlueTap Station';
    contextLabel = role === 'manager' ? 'Distributor · Your branch' : 'Branch operations';
  } else if (conversation.type === 'branch_coordination') {
    const ownBranchId = clean(roleData.branchId || roleData.branch?.id);
    const otherBranchId = (conversation.branchIds || conversation.participantBranchIds || []).find((id) => clean(id) !== ownBranchId);
    displayName = clean(conversation.branchNameSnapshots?.[otherBranchId]) || 'Partner BlueTap Station';
    contextLabel = 'Branch coordination';
  }

  const orderReference = orderReferenceOf(order);
  const orderStatus = clean(order?.status || order?.finalStatus);
  const presented = { ...conversation, displayName, contextLabel, orderReference, orderStatus, orderContextLocal: order };
  return { ...presented, ...avatarForConversation(presented, role) };
}

export default function ChatDataProvider({ children, role }) {
  const portalTheme = useBlueTapTheme();
  const managerTheme = useAdminTheme();
  const requesterData = useRequesterData();
  const distributorData = useDistributorData();
  const managerData = useManagerRealtimeData();
  const moderation = useModerationNotices();
  const roleData = role === 'requester' ? requesterData : role === 'distributor' ? distributorData : managerData;
  const colors = role === 'manager' ? managerTheme.colors : portalTheme.colors;
  const isDark = role === 'manager' ? managerTheme.resolvedTheme === 'dark' : Boolean(portalTheme.isDark);
  const [uid, setUid] = React.useState('');
  const [authReady, setAuthReady] = React.useState(false);
  const branchId = role === 'manager' ? clean(managerData.branchId) : '';
  const [summaries, setSummaries] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [retryVersion, setRetryVersion] = React.useState(0);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [chatListTab, setChatListTab] = React.useState('active');
  const [selectedSeed, setSelectedSeed] = React.useState(null);
  const [liveMessages, setLiveMessages] = React.useState([]);
  const [olderMessages, setOlderMessages] = React.useState([]);
  const [localMessages, setLocalMessages] = React.useState([]);
  const [hasEarlierMessages, setHasEarlierMessages] = React.useState(false);
  const [loadingEarlier, setLoadingEarlier] = React.useState(false);
  const [threadError, setThreadError] = React.useState('');
  const [messageActionError, setMessageActionError] = React.useState('');
  const [resolvingConversation, setResolvingConversation] = React.useState(false);
  const resolveInFlightRef = React.useRef(null);
  const [resolveError, setResolveError] = React.useState('');
  const requesterBranches = role === 'requester' ? requesterData.branches || [] : [];
  const [threadVersion, setThreadVersion] = React.useState(0);
  const [summaryVersion, setSummaryVersion] = React.useState(0);
  const [historyState, setHistoryState] = React.useState({ scope: '', items: [], cursor: null, loaded: false, loading: false, loadingMore: false, error: '', refreshedAt: 0, summaryVersion: 0 });
  const historyInFlightRef = React.useRef(null);
  const [historyClock, setHistoryClock] = React.useState(Date.now);
  const [backendBeforeSeq, setBackendBeforeSeq] = React.useState(null);
  const [clock, setClock] = React.useState(Date.now);
  const summaryUnsubscribeRef = React.useRef(null);
  const threadUnsubscribeRef = React.useRef(null);
  const readCursorRef = React.useRef(new Map());

  React.useEffect(() => onAuthStateChanged(auth, (user) => {
    setUid(user?.uid || '');
    setAuthReady(true);
  }), []);

  const hydratedSummariesRef = React.useRef(false);
  const summaryIncomingSeqsRef = React.useRef(new Map());
  const hydratedOpenThreadRef = React.useRef(false);
  const lastOpenThreadSeqRef = React.useRef(0);

  React.useEffect(() => {
    setSelectedSeed(null);
    setPanelOpen(false);
    setSummaries([]);
    readCursorRef.current.clear();
    hydratedSummariesRef.current = false;
    summaryIncomingSeqsRef.current.clear();
  }, [uid, branchId, role]);

  const accessReadiness = chatAccessReadiness({ authReady, branchId, role, roleData, uid });
  const historyBranchId = role === 'distributor' ? clean(distributorData.profile?.branchId || distributorData.branch?.id) : branchId;
  const historyScope = accessReadiness === 'ready' ? JSON.stringify([role, uid, historyBranchId]) : '';
  const historyScopeRef = React.useRef(historyScope);
  historyScopeRef.current = historyScope;
  React.useEffect(() => {
    historyInFlightRef.current = null;
    setHistoryState({ scope: historyScope, items: [], cursor: null, loaded: false, loading: false, loadingMore: false, error: '', refreshedAt: 0, summaryVersion: 0 });
  }, [historyScope]);

  const refreshHistory = React.useCallback(() => {
    if (!historyScope) return Promise.resolve();
    if (historyInFlightRef.current?.scope === historyScope) return historyInFlightRef.current.promise;
    setHistoryState((previous) => ({ ...(previous.scope === historyScope ? previous : { scope: historyScope, items: [], cursor: null, loaded: false }), loading: true, error: '' }));
    return historyCache.runScopedHistoryRequest(historyInFlightRef, historyScope, () => loadConversationHistory().then((page) => {
      if (historyScopeRef.current !== historyScope) return;
      const verifiedPage = historyCache.verifiedHistoryPage(page);
      setHistoryState((previous) => previous.scope === historyScope ? {
        ...previous, items: verifiedPage.conversations, cursor: verifiedPage.nextCursor || null,
        loaded: true, loading: false, error: '', refreshedAt: Date.now(), summaryVersion,
      } : previous);
    }).catch((loadError) => {
      if (historyScopeRef.current === historyScope) setHistoryState((previous) => previous.scope === historyScope ? { ...previous, loading: false, summaryVersion, error: loadError?.message || 'History could not be loaded.' } : previous);
    }));
  }, [historyScope, summaryVersion]);

  const loadMoreHistory = React.useCallback(() => {
    if (!historyScope || historyState.scope !== historyScope || !historyState.cursor) return Promise.resolve();
    if (historyInFlightRef.current?.scope === historyScope) return historyInFlightRef.current.promise;
    const cursor = historyState.cursor;
    setHistoryState((previous) => previous.scope === historyScope ? { ...previous, loadingMore: true, error: '' } : previous);
    return historyCache.runScopedHistoryRequest(historyInFlightRef, historyScope, () => loadConversationHistory({ cursor }).then((page) => {
      if (historyScopeRef.current !== historyScope) return;
      const verifiedPage = historyCache.verifiedHistoryPage(page);
      setHistoryState((previous) => {
        if (previous.scope !== historyScope || previous.cursor !== cursor) return previous;
        return { ...previous, items: historyCache.appendHistoryPage(previous.items, verifiedPage.conversations), cursor: verifiedPage.nextCursor || null, loadingMore: false, error: '' };
      });
    }).catch((loadError) => {
      if (historyScopeRef.current === historyScope) setHistoryState((previous) => previous.scope === historyScope ? { ...previous, loadingMore: false, error: loadError?.message || 'More history could not be loaded.' } : previous);
    }));
  }, [historyScope, historyState.cursor, historyState.scope]);

  React.useEffect(() => {
    if (chatListTab !== 'history' || !historyScope || historyState.scope !== historyScope) return;
    if (historyCache.shouldRefreshHistory(historyState, summaryVersion)) refreshHistory();
  }, [chatListTab, historyScope, historyState, refreshHistory, summaryVersion]);

  React.useEffect(() => {
    if (historyState.scope !== historyScope) return undefined;
    const deadlines = historyState.items.map((item) => historyCache.timeOf(item.readAccessEndsAt || item.accessEndsAt)).filter((deadline) => deadline > Date.now());
    if (!deadlines.length) return undefined;
    const timer = setTimeout(() => setHistoryClock(Date.now()), Math.min(2147483647, Math.min(...deadlines) - Date.now() + 25));
    return () => clearTimeout(timer);
  }, [historyScope, historyState, historyClock]);
  const history = historyState.scope === historyScope && historyScope
    ? historyCache.visibleHistory(historyState.items, Math.max(historyClock, Date.now()))
    : [];

  React.useEffect(() => {
    summaryUnsubscribeRef.current?.();
    summaryUnsubscribeRef.current = null;
    if (accessReadiness === 'pending') {
      setLoading(true);
      setError('');
      return undefined;
    }
    if (accessReadiness !== 'ready') {
      setSummaries([]);
      setLoading(false);
      setError(uid && role !== 'admin' ? 'Your message access could not be verified.' : '');
      return undefined;
    }
    setLoading(true);
    setError('');
    const unsubscribe = subscribeConversationSummaries({
      role,
      uid,
      branchId,
      onData: (items) => {
        if (!hydratedSummariesRef.current) {
          hydratedSummariesRef.current = true;
          (items || []).forEach((c) => {
            const pState = principalStateFor(c, role, uid, branchId);
            summaryIncomingSeqsRef.current.set(c.id, Number(pState?.lastIncomingSeq || 0));
          });
        } else {
          let hasNewIncoming = false;
          (items || []).forEach((c) => {
            const pState = principalStateFor(c, role, uid, branchId);
            const incomingSeq = Number(pState?.lastIncomingSeq || 0);
            const previouslySeen = summaryIncomingSeqsRef.current.has(c.id);
            const previous = summaryIncomingSeqsRef.current.get(c.id) || 0;
            if (!previouslySeen) summaryIncomingSeqsRef.current.set(c.id, incomingSeq);
            if (incomingSeq > previous) {
              summaryIncomingSeqsRef.current.set(c.id, incomingSeq);
              if (shouldNotifyIncomingSummary(previouslySeen, previous, incomingSeq, panelOpen && currentConversation?.id === c.id)) {
                hasNewIncoming = true;
              }
            }
          });
          if (hasNewIncoming) {
            playIncomingMessageSound({ subtle: false });
          }
        }
        setSummaries(items);
        setSummaryVersion((version) => version + 1);
        setLoading(false);
        setError('');
      },
      onError: (listenerError) => {
        setLoading(false);
        setError(listenerError?.code === 'permission-denied' ? 'Your message access could not be verified.' : 'Messages are temporarily unavailable.');
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[BlueTapChat] summary listener failed', { code: listenerError?.code || 'unknown', role });
      },
    });
    summaryUnsubscribeRef.current = unsubscribe;
    return () => {
      if (summaryUnsubscribeRef.current === unsubscribe) summaryUnsubscribeRef.current = null;
      unsubscribe?.();
    };
  }, [accessReadiness, branchId, retryVersion, role, uid]);

  const conversations = React.useMemo(() => summaries.filter((conversation) => conversationAllowedForRole(conversation, role)).map((conversation) => {
    const presented = presentationFor(conversation, role, roleData);
    const unreadCount = unreadForConversation(presented, role, uid, branchId);
    const principalState = principalStateFor(presented, role, uid, branchId);
    const notificationEpoch = Math.max(1, Number(principalState?.lastIncomingSeq || 0) - unreadCount + 1);
    return { ...presented, unreadCount, unreadLabel: formatBadge(unreadCount), notificationEpoch };
  }), [branchId, role, roleData, summaries, uid]);

  React.useEffect(() => {
    if (!panelOpen || !selectedSeed?.id || selectedSeed.historyId || loading || accessReadiness !== 'ready') return;
    if (conversations.some((conversation) => conversation.id === selectedSeed.id)) return;
    setSelectedSeed(null);
    setChatListTab('history');
  }, [accessReadiness, conversations, loading, panelOpen, selectedSeed]);

  const currentConversation = React.useMemo(() => {
    if (!selectedSeed?.id) return null;
    if (selectedSeed.historyId && selectedSeed.historyScope !== historyScope) return null;
    if (selectedSeed.historyId) return presentationFor(selectedSeed, role, roleData);
    const live = conversations.find((conversation) => conversation.id === selectedSeed.id);
    return presentationFor({ ...selectedSeed, ...(live || {}), orderContextLocal: live?.orderContextLocal || selectedSeed.orderContextLocal }, role, roleData);
  }, [conversations, historyScope, role, roleData, selectedSeed]);

  const availability = chatModel.conversationAvailability(currentConversation, role, uid, branchId, clock);
  const conversationNotice = currentConversation?.historyId
    ? { state: 'closed', title: 'Completed delivery', body: 'Read-only history for this order. Messaging for this delivery has ended.' }
    : chatModel.conversationLifecycleNotice(currentConversation, clock);
  const chatRestriction = role === 'manager' ? null : moderation.activeRestrictions.find((notice) => {
    if (notice.scope === 'platform_chat') return true;
    if (notice.scope !== 'branch_chat') return false;
    const orderBranchName = clean(currentConversation?.orderContextLocal?.currentBranchName || currentConversation?.orderContextLocal?.currentBranchNameSnapshot || currentConversation?.orderContextLocal?.branchNameSnapshot || currentConversation?.orderContextLocal?.water_station);
    const ownBranchName = clean(roleData.branch?.name || roleData.profile?.branchName || roleData.profile?.branchNameSnapshot);
    return Boolean(notice.branchName && (notice.branchName === orderBranchName || notice.branchName === ownBranchName));
  });
  React.useEffect(() => {
    setClock(Date.now());
    const deadline = chatModel.timeOf(currentConversation?.accessEndsAt);
    if (!deadline || deadline <= Date.now()) return undefined;
    const expiryTimer = setTimeout(() => setClock(Date.now()), Math.min(2147483647, deadline - Date.now() + 25));
    const minuteTimer = setInterval(() => setClock(Date.now()), 30_000);
    return () => { clearTimeout(expiryTimer); clearInterval(minuteTimer); };
  }, [currentConversation?.accessEndsAt]);

  React.useEffect(() => {
    threadUnsubscribeRef.current?.();
    threadUnsubscribeRef.current = null;
    setLiveMessages([]);
    setOlderMessages([]);
    setLocalMessages([]);
    setBackendBeforeSeq(null);
    setThreadError('');
    setMessageActionError('');
    hydratedOpenThreadRef.current = false;
    lastOpenThreadSeqRef.current = 0;
    if (!panelOpen || !currentConversation?.id || accessReadiness !== 'ready' || !availability.readable || currentConversation.historyId || currentConversation.type === 'requester_branch') return undefined;
    const unsubscribe = subscribeOpenConversationMessages({
      conversationId: currentConversation.id,
      onData: (items) => {
        if (!hydratedOpenThreadRef.current) {
          hydratedOpenThreadRef.current = true;
          const maxSeq = (items || []).reduce((max, m) => Math.max(max, Number(m.seq || 0)), 0);
          lastOpenThreadSeqRef.current = maxSeq;
        } else {
          const maxSeq = (items || []).reduce((max, m) => Math.max(max, Number(m.seq || 0)), 0);
          if (maxSeq > lastOpenThreadSeqRef.current) {
            const newMessages = (items || []).filter((m) => Number(m.seq) > lastOpenThreadSeqRef.current);
            const hasNewIncoming = newMessages.some((m) => !isOwnMessage(m, role, uid, branchId));
            lastOpenThreadSeqRef.current = maxSeq;
            if (hasNewIncoming) {
              playIncomingMessageSound({ subtle: true });
            }
          }
        }
        setLiveMessages(items);
        setHasEarlierMessages(items.length === 40);
        setThreadError('');
      },
      onError: (listenerError) => {
        setThreadError(listenerError?.code === 'permission-denied' ? 'This conversation is no longer available.' : 'New messages could not be loaded.');
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[BlueTapChat] thread listener failed', { code: listenerError?.code || 'unknown' });
      },
    });
    threadUnsubscribeRef.current = unsubscribe;
    return () => {
      if (threadUnsubscribeRef.current === unsubscribe) threadUnsubscribeRef.current = null;
      unsubscribe?.();
    };
  }, [accessReadiness, availability.readable, currentConversation?.id, currentConversation?.historyId, currentConversation?.type, panelOpen, threadVersion]);

  React.useEffect(() => {
    if (!panelOpen || !currentConversation?.id || accessReadiness !== 'ready' || !availability.readable ||
      (!currentConversation.historyId && currentConversation.type !== 'requester_branch')) return undefined;
    let cancelled = false;
    loadMessageHistory({ conversationId: currentConversation.id, historyId: currentConversation.historyId, limit: 40 })
      .then((page) => {
        if (cancelled) return;
        setLiveMessages(page.messages || []);
        setBackendBeforeSeq(page.nextBeforeSeq || null);
        setHasEarlierMessages(Boolean(page.nextBeforeSeq));
        setThreadError('');
      })
      .catch((loadError) => {
        if (!cancelled) setThreadError(loadError?.message || 'Messages could not be loaded.');
      });
    return () => { cancelled = true; };
  }, [accessReadiness, availability.readable, currentConversation?.id, currentConversation?.historyId, currentConversation?.type, panelOpen, summaryVersion, threadVersion]);

  const messages = React.useMemo(() => mergeMessages(olderMessages, liveMessages, localMessages), [liveMessages, localMessages, olderMessages]);

  React.useEffect(() => {
    if (!panelOpen || !currentConversation?.id || currentConversation.historyId || messages.length === 0 || accessReadiness !== 'ready' || !availability.readable) return undefined;
    const incoming = messages.filter((message) => Number.isSafeInteger(Number(message.seq)) && !isOwnMessage(message, role, uid, branchId));
    const newestIncomingSeq = incoming.reduce((maximum, message) => Math.max(maximum, Number(message.seq)), 0);
    const existingRead = Number(principalStateFor(currentConversation, role, uid, branchId)?.lastReadSeq || 0);
    const requestedRead = Number(readCursorRef.current.get(currentConversation.id) || 0);
    if (!newestIncomingSeq || newestIncomingSeq <= existingRead || newestIncomingSeq <= requestedRead) return undefined;
    const timer = setTimeout(async () => {
      readCursorRef.current.set(currentConversation.id, newestIncomingSeq);
      try {
        const updated = await markRead({ conversationId: currentConversation.id, lastReadSeq: newestIncomingSeq });
        setSummaries((items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
        setSelectedSeed((item) => item?.id === updated.id ? { ...item, ...updated } : item);
      } catch (readError) {
        readCursorRef.current.set(currentConversation.id, existingRead);
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[BlueTapChat] read cursor failed', { code: readError?.code || 'unknown' });
      }
    }, 260);
    return () => clearTimeout(timer);
  }, [accessReadiness, availability.readable, branchId, currentConversation, messages, panelOpen, role, uid]);

  const openConversation = React.useCallback((conversation) => {
    setResolveError('');
    setThreadError('');
    setSelectedSeed(conversation.historyId ? { ...conversation, historyScope } : conversation);
    setThreadVersion((version) => version + 1);
    setPanelOpen(true);
  }, [historyScope]);
  const resolveAndOpen = React.useCallback((rawIntent, orderContextLocal = null) => {
    if (resolveInFlightRef.current) return resolveInFlightRef.current;
    const intent = chatModel.normalizeChatIntent(rawIntent);
    const effectiveOrderContext = orderContextLocal || rawIntent?.order || null;
    let attempt;
    attempt = (async () => {
      setThreadError('');
      setResolveError('');
      setResolvingConversation(true);
      setSelectedSeed(null);
      setPanelOpen(true);
      try {
        const conversation = await resolveConversation(intent);
        const inquiryBranch = intent?.type === 'requester_branch' && intent?.intent === 'inquiry'
          ? requesterBranches.find((branch) => clean(branch.id || branch.branchId) === clean(intent.branchId))
          : null;
        const presentationLocal = inquiryBranch ? { branchNameSnapshot: clean(inquiryBranch.name) } : null;
        const next = { ...conversation, ...(presentationLocal || {}), ...(effectiveOrderContext ? { orderContextLocal: effectiveOrderContext } : {}) };
        setSummaries((items) => [conversation, ...items.filter((item) => item.id !== conversation.id)]);
        setSelectedSeed(next);
        setThreadVersion((version) => version + 1);
        return conversation;
      } catch (resolveError) {
        setResolveError(mapResolveError(resolveError));
        throw resolveError;
      } finally {
        if (resolveInFlightRef.current === attempt) resolveInFlightRef.current = null;
        setResolvingConversation(false);
      }
    })();
    resolveInFlightRef.current = attempt;
    return attempt;
  }, [requesterBranches]);

  const openBlueTapConversation = React.useCallback((options = {}) => {
    const normalizedIntent = chatModel.normalizeChatIntent(options);
    return resolveAndOpen(normalizedIntent, options.order || null);
  }, [resolveAndOpen]);

  const commitMessage = React.useCallback(async (optimistic) => {
    try {
      const committed = await sendMessage({
        conversationId: currentConversation.id,
        clientMutationId: optimistic.clientMutationId,
        body: optimistic.body,
        orderId: sendContextOrderId(currentConversation),
        replyToMessageId: optimistic.replyToMessageId || optimistic.replyTo?.messageId,
      });
      setLocalMessages((items) => mergeMessages(items.filter((item) => item.clientMutationId !== optimistic.clientMutationId), committed));
      setSummaries((items) => items.map((item) => item.id === currentConversation.id ? { ...item, lastMessagePreview: committed.body, lastMessageAt: committed.createdAt, updatedAt: committed.createdAt, lastMessageSeq: committed.seq } : item));
    } catch (sendError) {
      setLocalMessages((items) => items.map((item) => item.clientMutationId === optimistic.clientMutationId ? { ...item, pending: false, failed: true, errorCode: sendError.code } : item));
    }
  }, [currentConversation]);

  const sendCurrentMessage = React.useCallback((body, options = {}) => {
    if (!currentConversation?.id || !availability.sendable || accessReadiness !== 'ready') return;
    const clientMutationId = createClientMutationId();
    const replyToMessageId = options.replyToMessageId || options.replyTo?.id || options.replyTo?.messageId;
    const optimistic = {
      id: '', clientMutationId, body, createdAt: new Date(), pending: true, failed: false,
      senderUid: uid, senderPrincipalType: role === 'manager' ? 'branch' : 'user', ...(role === 'manager' ? { senderBranchId: branchId } : {}),
      ...(replyToMessageId ? {
        replyToMessageId,
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      } : {}),
    };
    setLocalMessages((items) => mergeMessages(items, optimistic));
    commitMessage(optimistic);
  }, [accessReadiness, availability.sendable, branchId, commitMessage, currentConversation?.id, role, uid]);

  const retryMessage = React.useCallback((message) => {
    if (!message?.clientMutationId || !message?.failed) return;
    const retry = { ...message, pending: true, failed: false };
    setLocalMessages((items) => items.map((item) => item.clientMutationId === retry.clientMutationId ? retry : item));
    commitMessage(retry);
  }, [commitMessage]);

  const replaceCommittedMessage = React.useCallback((updated) => {
    const replace = (items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
    setLiveMessages(replace);
    setOlderMessages(replace);
    setLocalMessages(replace);
    if (Number(updated.seq) === Number(currentConversation?.lastMessageSeq)) {
      const preview = updated.deletedAt ? 'Message deleted' : updated.body;
      setSummaries((items) => items.map((item) => item.id === currentConversation?.id ? { ...item, lastMessagePreview: preview } : item));
    }
  }, [currentConversation?.id, currentConversation?.lastMessageSeq]);

  const editCurrentMessage = React.useCallback(async (message, body) => {
    if (!currentConversation?.id || !message?.id) return null;
    setMessageActionError('');
    try {
      const updated = await editChatMessage({ conversationId: currentConversation.id, messageId: message.id, clientMutationId: createClientMutationId(), body });
      replaceCommittedMessage(updated);
      return updated;
    } catch (mutationError) {
      setMessageActionError(mutationError.message || 'The message could not be edited.');
      throw mutationError;
    }
  }, [currentConversation?.id, replaceCommittedMessage]);

  const deleteCurrentMessage = React.useCallback(async (message) => {
    if (!currentConversation?.id || !message?.id) return null;
    setMessageActionError('');
    try {
      const updated = await deleteChatMessage({ conversationId: currentConversation.id, messageId: message.id, clientMutationId: createClientMutationId() });
      replaceCommittedMessage(updated);
      return updated;
    } catch (mutationError) {
      const isExpired = mutationError?.code === 'CHAT_MESSAGE_MUTATION_WINDOW_EXPIRED'
        || mutationError?.code === 'CHAT_MUTATION_EXPIRED'
        || String(mutationError?.message || '').toLowerCase().includes('15 minutes');
      const friendlyMessage = isExpired
        ? 'This message can no longer be deleted.'
        : (mutationError.message || 'The message could not be deleted.');
      setMessageActionError(friendlyMessage);
      throw mutationError;
    }
  }, [currentConversation?.id, replaceCommittedMessage]);

  const loadEarlierMessages = React.useCallback(async () => {
    if (!currentConversation?.id || loadingEarlier) return;
    const committed = messages.filter((message) => Number.isSafeInteger(Number(message.seq)));
    const backendThread = Boolean(currentConversation.historyId || currentConversation.type === 'requester_branch');
    const beforeSeq = backendThread ? backendBeforeSeq : committed.reduce((minimum, message) => Math.min(minimum, Number(message.seq)), Number.MAX_SAFE_INTEGER);
    if (!Number.isFinite(beforeSeq)) return;
    setLoadingEarlier(true);
    try {
      const page = await loadMessageHistory({ conversationId: currentConversation.id, historyId: currentConversation.historyId, beforeSeq, limit: 40 });
      setOlderMessages((items) => mergeMessages(items, page.messages || []));
      setHasEarlierMessages(Boolean(page.nextBeforeSeq));
      if (backendThread) setBackendBeforeSeq(page.nextBeforeSeq || null);
    } catch (historyError) {
      setThreadError(historyError.message || 'Earlier messages could not be loaded.');
    } finally {
      setLoadingEarlier(false);
    }
  }, [backendBeforeSeq, currentConversation?.id, currentConversation?.historyId, currentConversation?.type, loadingEarlier, messages]);

  const openChat = React.useCallback(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined' && document.activeElement?.blur) {
      document.activeElement.blur();
    }
    setPanelOpen(true);
  }, []);

  const closeChat = React.useCallback(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined' && document.activeElement?.blur) {
      document.activeElement.blur();
    }
    setPanelOpen(false);
  }, []);

  const openStationChat = React.useCallback(async () => {
    if (role === 'distributor') {
      const existing = (summaries || []).find((c) => c.type === 'distributor_branch');
      if (existing) {
        openConversation(existing);
        return existing;
      }
      return resolveAndOpen({ type: 'distributor_branch' });
    }
  }, [openConversation, resolveAndOpen, role, summaries]);

  const value = React.useMemo(() => ({
    branchDistributors: role === 'manager' && accessReadiness === 'ready' ? (roleData.users || []).filter((user) => user.role === 'distributor' && user.branchId === branchId && ['active', 'approved'].includes(String(user.distributorStatus || user.approvalStatus || user.status || '').toLowerCase()) && (!user.accountStatus || user.accountStatus === 'active') && user.mustChangePassword !== true) : [],
    distributorOrders: role === 'distributor' ? (roleData.orders || []) : [],
    stationName: clean(roleData.branch?.name || roleData.profile?.branchName || roleData.profile?.branchNameSnapshot) || 'Your BlueTap Station',
    requesterBranches,
    role, colors, isDark, conversations, loading, error, summaryVersion, panelOpen, chatListTab, setChatListTab, currentConversation, messages,
    history, historyLoaded: historyState.scope === historyScope && historyState.loaded, historyCursor: historyState.scope === historyScope ? historyState.cursor : null,
    historyLoading: historyState.scope === historyScope && historyState.loading, historyLoadingMore: historyState.scope === historyScope && historyState.loadingMore,
    historyError: historyState.scope === historyScope ? historyState.error : '', refreshHistory, loadMoreHistory,
    canSend: !currentConversation?.historyId && availability.sendable && accessReadiness === 'ready' && !threadError && !chatRestriction,
    sendUnavailableReason: chatRestriction
      ? `${chatRestriction.title}${chatRestriction.branchName ? ` for ${chatRestriction.branchName}` : ''}.`
      : conversationNotice?.state === 'closed'
        ? conversationNotice.body
        : '',
    conversationNotice,
    hasEarlierMessages, loadingEarlier, threadError, messageActionError, resolvingConversation, resolveError,
    totalUnread: totalUnread(conversations, role, uid, branchId),
    totalUnreadLabel: formatBadge(totalUnread(conversations, role, uid, branchId)),
    openChat,
    closeChat,
    openStationChat,
    backToList: () => { setSelectedSeed(null); setThreadError(''); },
    openConversation,
    openBlueTapConversation,
    resolveAndOpen,
    retrySummaries: () => setRetryVersion((version) => version + 1),
    sendCurrentMessage,
    retryMessage,
    editCurrentMessage,
    deleteCurrentMessage,
    loadEarlierMessages,
    isOwnMessage: (message) => isOwnMessage(message, role, uid, branchId),
    receiptForMessage: (message) => receiptFor(message, currentConversation, role, uid, branchId),
  }), [accessReadiness, roleData.users, roleData.orders, branchId, chatRestriction, chatListTab, colors, isDark, conversationNotice, conversations, currentConversation, deleteCurrentMessage, editCurrentMessage, error, hasEarlierMessages, history, historyState, historyScope, loading, loadingEarlier, loadMoreHistory, messageActionError, messages, openChat, closeChat, openStationChat, openConversation, openBlueTapConversation, panelOpen, refreshHistory, requesterBranches, resolveAndOpen, resolveError, resolvingConversation, retryMessage, role, sendCurrentMessage, summaryVersion, threadError, uid, loadEarlierMessages]);

  return (
    <ChatContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        <ChatFloatingLauncher />
      </View>
    </ChatContext.Provider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, minWidth: 0 } });
