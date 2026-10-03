import React from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { StyleSheet, View } from 'react-native';

import { auth } from '../../firebase';
import { deleteMessage as deleteChatMessage, editMessage as editChatMessage, loadMessageHistory, markRead, resolveConversation, sendMessage } from '../../services/chatApi';
import { subscribeConversationSummaries, subscribeOpenConversationMessages } from '../../services/chatRealtime';
import { useAdminTheme } from '../AdminTheme';
import { useBlueTapTheme } from '../BlueTapTheme';
import { useManagerRealtimeData } from '../ManagerRealtimeData';
import { useDistributorData, useRequesterData } from '../RoleDataProviders';
import { ChatContext } from './ChatContext';
import ChatFloatingLauncher from './ChatFloatingLauncher';
import { useModerationNotices } from '../ModerationNotices';

const chatModel = require('./chatModel');
const { chatAccessReadiness } = require('./chatAccessReadiness');
const { avatarForConversation, conversationAllowedForRole } = require('./chatPresentation');
const { createClientMutationId, formatBadge, isOwnMessage, mergeMessages, principalStateFor, receiptFor, totalUnread, unreadForConversation } = chatModel;

const clean = (value) => String(value || '').trim();
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
  const order = orders.find((candidate) => orderIds.has(orderIdOf(candidate)) || orderIds.has(orderReferenceOf(candidate)))
    || conversation.orderContextLocal
    || conversation.orderContext
    || null;
  const users = roleData.users || [];
  const userById = (uid) => users.find((user) => clean(user.uid || user.id) === clean(uid));
  let displayName = 'BlueTap conversation';
  let contextLabel = 'BlueTap messages';

  if (conversation.type === 'requester_branch') {
    const requesterBranchOrderReference = orderReferenceOf(order);
    displayName = role === 'manager'
      ? clean(conversation.requesterDisplayName || order?.requesterNameSnapshot || order?.requesterName || userById(conversation.requesterUid)?.fullName) || 'Requester'
      : clean(conversation.branchNameSnapshot || order?.currentBranchName || order?.currentBranchNameSnapshot || order?.branchNameSnapshot || order?.branchDisplayName || order?.water_station) || 'BlueTap Station';
    contextLabel = requesterBranchOrderReference ? `Order ${requesterBranchOrderReference}` : 'General inquiry';
  } else if (conversation.type === 'requester_distributor') {
    displayName = role === 'distributor'
      ? clean(conversation.requesterDisplayName || order?.requesterNameSnapshot || order?.requesterName || order?.customerName) || 'Requester'
      : clean(conversation.distributorDisplayName || order?.assignedDistributorNameSnapshot || order?.assignedDistributorName || order?.distributorName) || 'Assigned Distributor';
    contextLabel = orderReferenceOf(order) ? `Order ${orderReferenceOf(order)}` : 'Assigned order';
  } else if (conversation.type === 'distributor_branch') {
    displayName = role === 'manager'
      ? clean(userById(conversation.distributorUid)?.fullName) || 'Branch Distributor'
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
  const [uid, setUid] = React.useState('');
  const [authReady, setAuthReady] = React.useState(false);
  const branchId = role === 'manager' ? clean(managerData.branchId) : '';
  const [summaries, setSummaries] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [retryVersion, setRetryVersion] = React.useState(0);
  const [panelOpen, setPanelOpen] = React.useState(false);
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
  const [clock, setClock] = React.useState(Date.now);
  const summaryUnsubscribeRef = React.useRef(null);
  const threadUnsubscribeRef = React.useRef(null);
  const readCursorRef = React.useRef(new Map());

  React.useEffect(() => onAuthStateChanged(auth, (user) => {
    setUid(user?.uid || '');
    setAuthReady(true);
  }), []);

  React.useEffect(() => {
    setSelectedSeed(null);
    setPanelOpen(false);
    setSummaries([]);
    readCursorRef.current.clear();
  }, [uid, branchId]);

  const accessReadiness = chatAccessReadiness({ authReady, branchId, role, roleData, uid });

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
      onData: (items) => { setSummaries(items); setLoading(false); setError(''); },
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

  const currentConversation = React.useMemo(() => {
    if (!selectedSeed?.id) return null;
    const live = conversations.find((conversation) => conversation.id === selectedSeed.id);
    return presentationFor({ ...selectedSeed, ...(live || {}), orderContextLocal: selectedSeed.orderContextLocal || live?.orderContextLocal }, role, roleData);
  }, [conversations, role, roleData, selectedSeed]);

  const availability = chatModel.conversationAvailability(currentConversation, role, uid, branchId, clock);
  const conversationNotice = chatModel.conversationLifecycleNotice(currentConversation, clock);
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
    setThreadError('');
    setMessageActionError('');
    if (!panelOpen || !currentConversation?.id || accessReadiness !== 'ready' || !availability.readable) return undefined;
    const unsubscribe = subscribeOpenConversationMessages({
      conversationId: currentConversation.id,
      onData: (items) => {
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
  }, [accessReadiness, availability.readable, currentConversation?.id, panelOpen, threadVersion]);

  const messages = React.useMemo(() => mergeMessages(olderMessages, liveMessages, localMessages), [liveMessages, localMessages, olderMessages]);

  React.useEffect(() => {
    if (!panelOpen || !currentConversation?.id || messages.length === 0 || accessReadiness !== 'ready' || !availability.readable) return undefined;
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
    setSelectedSeed(conversation);
    setThreadVersion((version) => version + 1);
    setPanelOpen(true);
  }, []);
  const resolveAndOpen = React.useCallback((intent, orderContextLocal = null) => {
    if (resolveInFlightRef.current) return resolveInFlightRef.current;
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
        const next = { ...conversation, ...(presentationLocal || {}), ...(orderContextLocal ? { orderContextLocal } : {}) };
        setSummaries((items) => [conversation, ...items.filter((item) => item.id !== conversation.id)]);
        setSelectedSeed(next);
        setThreadVersion((version) => version + 1);
        return conversation;
      } catch (resolveError) {
        setResolveError('Unable to open conversation. Please try again.');
        throw resolveError;
      } finally {
        if (resolveInFlightRef.current === attempt) resolveInFlightRef.current = null;
        setResolvingConversation(false);
      }
    })();
    resolveInFlightRef.current = attempt;
    return attempt;
  }, [requesterBranches]);

  const commitMessage = React.useCallback(async (optimistic) => {
    try {
      const committed = await sendMessage({
        conversationId: currentConversation.id,
        clientMutationId: optimistic.clientMutationId,
        body: optimistic.body,
        orderId: orderIdOf(currentConversation.orderContextLocal) || currentConversation.orderId,
      });
      setLocalMessages((items) => mergeMessages(items.filter((item) => item.clientMutationId !== optimistic.clientMutationId), committed));
      setSummaries((items) => items.map((item) => item.id === currentConversation.id ? { ...item, lastMessagePreview: committed.body, lastMessageAt: committed.createdAt, updatedAt: committed.createdAt, lastMessageSeq: committed.seq } : item));
    } catch (sendError) {
      setLocalMessages((items) => items.map((item) => item.clientMutationId === optimistic.clientMutationId ? { ...item, pending: false, failed: true, errorCode: sendError.code } : item));
    }
  }, [currentConversation]);

  const sendCurrentMessage = React.useCallback((body) => {
    if (!currentConversation?.id || !availability.sendable || accessReadiness !== 'ready') return;
    const clientMutationId = createClientMutationId();
    const optimistic = {
      id: '', clientMutationId, body, createdAt: new Date(), pending: true, failed: false,
      senderUid: uid, senderPrincipalType: role === 'manager' ? 'branch' : 'user', ...(role === 'manager' ? { senderBranchId: branchId } : {}),
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
      setMessageActionError(mutationError.message || 'The message could not be deleted.');
      throw mutationError;
    }
  }, [currentConversation?.id, replaceCommittedMessage]);

  const loadEarlierMessages = React.useCallback(async () => {
    if (!currentConversation?.id || loadingEarlier) return;
    const committed = messages.filter((message) => Number.isSafeInteger(Number(message.seq)));
    const beforeSeq = committed.reduce((minimum, message) => Math.min(minimum, Number(message.seq)), Number.MAX_SAFE_INTEGER);
    if (!Number.isFinite(beforeSeq)) return;
    setLoadingEarlier(true);
    try {
      const page = await loadMessageHistory({ conversationId: currentConversation.id, beforeSeq, limit: 40 });
      setOlderMessages((items) => mergeMessages(items, page.messages || []));
      setHasEarlierMessages(Boolean(page.nextBeforeSeq));
    } catch (historyError) {
      setThreadError(historyError.message || 'Earlier messages could not be loaded.');
    } finally {
      setLoadingEarlier(false);
    }
  }, [currentConversation?.id, loadingEarlier, messages]);

  const value = React.useMemo(() => ({
    branchDistributors: role === 'manager' && accessReadiness === 'ready' ? (roleData.users || []).filter((user) => user.role === 'distributor' && user.branchId === branchId && ['active', 'approved'].includes(String(user.distributorStatus || user.approvalStatus || user.status || '').toLowerCase()) && (!user.accountStatus || user.accountStatus === 'active') && user.mustChangePassword !== true) : [],
    stationName: clean(roleData.branch?.name || roleData.profile?.branchName || roleData.profile?.branchNameSnapshot) || 'Your BlueTap Station',
    requesterBranches,
    role, colors, conversations, loading, error, panelOpen, currentConversation, messages,
    canSend: availability.sendable && accessReadiness === 'ready' && !threadError && !chatRestriction,
    sendUnavailableReason: chatRestriction
      ? `${chatRestriction.title}${chatRestriction.branchName ? ` for ${chatRestriction.branchName}` : ''}.`
      : conversationNotice?.state === 'closed'
        ? conversationNotice.body
        : '',
    conversationNotice,
    hasEarlierMessages, loadingEarlier, threadError, messageActionError, resolvingConversation, resolveError,
    totalUnread: totalUnread(conversations, role, uid, branchId),
    totalUnreadLabel: formatBadge(totalUnread(conversations, role, uid, branchId)),
    openChat: () => setPanelOpen(true),
    closeChat: () => setPanelOpen(false),
    backToList: () => { setSelectedSeed(null); setThreadError(''); },
    openConversation,
    resolveAndOpen,
    retrySummaries: () => setRetryVersion((version) => version + 1),
    sendCurrentMessage,
    retryMessage,
    editCurrentMessage,
    deleteCurrentMessage,
    loadEarlierMessages,
    isOwnMessage: (message) => isOwnMessage(message, role, uid, branchId),
    receiptForMessage: (message) => receiptFor(message, currentConversation, role, uid, branchId),
  }), [accessReadiness, roleData.users, branchId, chatRestriction, colors, conversationNotice, conversations, currentConversation, deleteCurrentMessage, editCurrentMessage, error, hasEarlierMessages, loading, loadingEarlier, messageActionError, messages, openConversation, panelOpen, requesterBranches, resolveAndOpen, resolveError, resolvingConversation, retryMessage, role, sendCurrentMessage, threadError, uid, loadEarlierMessages]);

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
