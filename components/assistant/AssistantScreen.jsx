import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

import { useBlueTapTheme } from '../BlueTapTheme';
import { createShadow } from '../shadowStyles';
import { USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import { useChat } from '../chat/ChatContext';
import RequestDetailsModal from '../RequestDetailsModal';
import { useCurrentPageRequestDetails } from '../useCurrentPageRequestDetails';
import PageEnterTransition from '../PageEnterTransition';
import BlueTapBrandMark from '../BlueTapBrandMark';
import BlueTapIcon from '../BlueTapIcon';
import useSingleFlightNavigation from '../useSingleFlightNavigation';

import { defaultAssistantEngine } from '../../services/assistant/assistantEngine';
import { executeAssistantAction } from '../../services/assistant/assistantActions';

import AssistantMessageBubble from './AssistantMessageBubble';
import AssistantQuickActions from './AssistantQuickActions';
import AssistantComposer from './AssistantComposer';
import {
  loadDailyAssistantChat,
  saveDailyAssistantChat,
  clearDailyAssistantChat,
} from '../../services/assistant/assistantStorage';
import { auth } from '../../firebase';
import { cancelRequest, refreshRequesterRequests } from '../../services/requests';
import {
  isActiveRequesterOrderStatus,
  isCancellableRequesterOrderStatus,
} from '../../constants/requesterOrderStatus';

export function AssistantScreen({
  role = 'requester',
  safeContext = {},
  userId: propUserId,
  backRoute,
  title = 'BlueTap Assistant',
  subtitle: propSubtitle,
  placeholder: propPlaceholder,
  detailOrders = [],
  detailBranches = [],
}) {
  const { colors, isDark } = useBlueTapTheme();
  const router = useRouter();
  const { replaceOnce } = useSingleFlightNavigation();
  const chat = useChat();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isMobile = width < 600;

  const isDistributor = role === 'distributor';
  const effectiveBackRoute = backRoute || (isDistributor ? '/distributor/d_profile' : '/requester/r_profile');
  const effectiveSubtitle =
    propSubtitle ||
    (isDistributor ? 'Deliveries, schedule & route help' : 'Orders, delivery & account help');

  const composerBottomPadding = useMemo(() => {
    return (
      USER_PORTAL_LAYOUT.navHeight +
      USER_PORTAL_LAYOUT.navBottomOffset +
      (isMobile ? 12 : 14) +
      (insets.bottom || 0)
    );
  }, [isMobile, insets.bottom]);

  const effectiveUserId = useMemo(() => {
    if (propUserId) return propUserId;
    if (isDistributor) {
      return (
        safeContext?.distributor?.userId ||
        safeContext?.distributor?.publicId ||
        'anonymous'
      );
    }
    return (
      safeContext?.requester?.userId ||
      safeContext?.requester?.publicId ||
      'anonymous'
    );
  }, [propUserId, isDistributor, safeContext]);

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [animatingMessageId, setAnimatingMessageId] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [cancelConfirmationTarget, setCancelConfirmationTarget] = useState(null);
  const [cancellingInFlight, setCancellingInFlight] = useState(false);
  const [locallyCancelledIds, setLocallyCancelledIds] = useState(() => new Set());
  const scrollViewRef = useRef(null);
  const scrollTimeoutRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const lastScrollTickRef = useRef(0);
  const {
    selectedRequest,
    requestDetailsVisible,
    openRequestDetails,
    closeRequestDetails,
  } = useCurrentPageRequestDetails(detailOrders);

  const effectiveSafeContext = useMemo(() => {
    if (!locallyCancelledIds.size || !safeContext) return safeContext;
    const activeOrders = (safeContext.activeOrders || []).filter(
      (ord) => !locallyCancelledIds.has(ord.id)
    );
    const hasActiveOrder = activeOrders.length > 0;
    const activeOrder = hasActiveOrder ? activeOrders[0] : null;
    const historyOrders = [
      ...Array.from(locallyCancelledIds)
        .map((id) => {
          const match = (detailOrders || []).find((o) => o.id === id);
          return match
            ? {
                ...match,
                publicOrderId: match.publicOrderId || match.requestId || `ORD-${String(id).slice(-4).toUpperCase()}`,
                isCancelled: true,
                status: 'cancelled',
                statusLabel: 'Cancelled',
              }
            : null;
        })
        .filter(Boolean),
      ...(safeContext.historyOrders || []),
    ];
    return {
      ...safeContext,
      activeOrders,
      hasActiveOrder,
      activeOrder,
      canPlaceNewOrder: !hasActiveOrder && !safeContext.restrictions?.hasOrderingRestriction,
      historyOrders,
      recentOrders: historyOrders,
    };
  }, [safeContext, locallyCancelledIds, detailOrders]);

  const seedWelcomeConversation = useCallback(() => {
    if (isDistributor) {
      const firstName = effectiveSafeContext?.distributor?.firstName || 'there';
      let welcomeText = `Hi ${firstName}! 👋 I'm your BlueTap Assistant. I can help with your assigned deliveries, today's schedule, delivery details, contacting customers, or station dispatch.`;

      const initialCards = [];
      const initialActions = [];

      if (effectiveSafeContext?.currentAssignment) {
        const order = effectiveSafeContext.currentAssignment;
        welcomeText += `\n\nYou currently have an assigned delivery (${order.publicOrderId || order.id}) for ${order.requesterName || 'customer'}.`;
        initialCards.push({
          type: 'delivery',
          ...order,
        });
      } else {
        initialActions.push({
          type: 'OPEN_SCHEDULE',
          label: "Today's Schedule",
        });
        initialActions.push({
          type: 'OPEN_REQUESTS',
          label: 'Delivery Requests',
        });
      }

      setMessages([
        {
          id: 'welcome-msg',
          role: 'assistant',
          text: welcomeText,
          cards: initialCards,
          actions: initialActions,
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    // Default Requester Welcome
    const firstName = effectiveSafeContext?.requester?.firstName || 'there';
    let welcomeText = `Hi ${firstName}! 👋 I'm your BlueTap Assistant. I can help track your water requests, check delivery schedules, find nearby water stations, or answer account questions.`;

    const initialCards = [];
    const initialActions = [];

    if (effectiveSafeContext?.hasActiveOrder) {
      const order = effectiveSafeContext.activeOrder;
      welcomeText += `\n\nYou currently have an active water request (${order.publicOrderId}) at ${order.branchName} in progress.`;
      initialCards.push({
        type: 'order',
        ...order,
      });
    } else {
      initialActions.push({
        type: 'START_ORDER',
        label: 'Start an Order',
      });
      initialActions.push({
        type: 'OPEN_REQUESTS',
        label: 'View Past Orders',
      });
    }

    setMessages([
      {
        id: 'welcome-msg',
        role: 'assistant',
        text: welcomeText,
        cards: initialCards,
        actions: initialActions,
        timestamp: Date.now(),
      },
    ]);
  }, [isDistributor, effectiveSafeContext]);

  // Load same-day saved conversation on mount or when userId changes
  useEffect(() => {
    let isMounted = true;
    async function initSession() {
      if (!effectiveUserId || effectiveUserId === 'anonymous') {
        if (!sessionLoaded) {
          seedWelcomeConversation();
          setSessionLoaded(true);
        }
        return;
      }

      try {
        const saved = await loadDailyAssistantChat({ userId: effectiveUserId, role });
        if (!isMounted) return;
        if (Array.isArray(saved) && saved.length > 0) {
          setMessages(saved);
          setSessionLoaded(true);
          return;
        }
      } catch (err) {
        // Fallback to fresh welcome
      }

      if (!isMounted) return;
      seedWelcomeConversation();
      setSessionLoaded(true);
    }

    initSession();
    return () => {
      isMounted = false;
    };
  }, [effectiveUserId, role]);

  // Auto-persist conversation changes for current day
  useEffect(() => {
    if (!sessionLoaded || !effectiveUserId || effectiveUserId === 'anonymous' || messages.length === 0) return;
    const timer = setTimeout(() => {
      saveDailyAssistantChat({ userId: effectiveUserId, role, messages }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [messages, effectiveUserId, role, sessionLoaded]);

  const scrollToBottom = useCallback(() => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
      scrollTimeoutRef.current = null;
    }, 120);
  }, []);

  const handleScroll = useCallback((event) => {
    const { layoutMeasurement, contentOffset, contentSize } = event?.nativeEvent || {};
    if (!layoutMeasurement || !contentOffset || !contentSize) return;
    const paddingToBottom = 60;
    isNearBottomRef.current =
      layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom;
  }, []);

  const handleAnimationTick = useCallback(() => {
    if (!isNearBottomRef.current) return;
    const now = Date.now();
    if (now - lastScrollTickRef.current > 120) {
      lastScrollTickRef.current = now;
      scrollToBottom();
    }
  }, [scrollToBottom]);

  const handleAnimationComplete = useCallback((id) => {
    setAnimatingMessageId((current) => (current === id ? null : current));
    if (isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [scrollToBottom]);

  useEffect(() => () => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
  }, []);

  const handleSendQuery = useCallback(
    async (userInput, forcedIntent = null) => {
      if (!userInput || !userInput.trim() || loading) return;

      // Complete any running animation immediately before dispatching new query
      setAnimatingMessageId(null);

      const userMsg = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: userInput.trim(),
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);
      scrollToBottom();

      try {
        const response = await defaultAssistantEngine.respond({
          userInput: userMsg.text,
          forcedIntent,
          safeContext: effectiveSafeContext,
          role,
          history: messages.slice(-10),
        });

        const newMsgId = `asst-${Date.now()}`;
        const assistantMsg = {
          id: newMsgId,
          role: 'assistant',
          text: response.message,
          cards: response.cards || [],
          actions: response.actions || [],
          intent: response.intent,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMsg]);
        setAnimatingMessageId(newMsgId);
      } catch (err) {
        const errId = `err-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: errId,
            role: 'assistant',
            text: isDistributor
              ? "I couldn't process your delivery inquiry right now. Please try asking again."
              : "I couldn't process your request right now. Please try asking again.",
            cards: [],
            actions: [],
            timestamp: Date.now(),
          },
        ]);
        setAnimatingMessageId(errId);
      } finally {
        setLoading(false);
        scrollToBottom();
      }
    },
    [loading, effectiveSafeContext, role, isDistributor, messages, scrollToBottom]
  );

  const handleQuickAction = useCallback(
    (actionOrChip) => {
      if (!actionOrChip || loading) return;
      if (typeof actionOrChip === 'object') {
        const prompt = actionOrChip.prompt || actionOrChip.query || actionOrChip.label || '';
        const forcedIntent = actionOrChip.intent || null;
        handleSendQuery(prompt, forcedIntent);
      } else {
        handleSendQuery(String(actionOrChip), null);
      }
    },
    [handleSendQuery, loading]
  );

  const handleAction = useCallback(
    async (action) => {
      if (!action || !action.type) return;

      if (['VIEW_ORDER', 'VIEW_REQUEST', 'VIEW_DELIVERY'].includes(action.type)) {
        if (action.orderId && openRequestDetails(action.orderId)) return;
        Alert.alert('Details unavailable', 'This order is not available in your current authorized order list.');
        return;
      }

      if (action.type === 'CANCEL_ORDER') {
        const orderId = action.orderId;
        const target =
          (detailOrders || []).find((ord) => ord.id === orderId) ||
          (effectiveSafeContext?.activeOrder?.id === orderId ? effectiveSafeContext.activeOrder : null) ||
          effectiveSafeContext?.activeOrder;

        if (!target) {
          Alert.alert('Order Not Found', 'The requested order could not be located in your current active requests.');
          return;
        }

        const latestOrder = (detailOrders || []).find((ord) => ord.id === target.id) || target;
        const orderRef =
          latestOrder.publicOrderId ||
          latestOrder.requestId ||
          latestOrder.request_id ||
          (latestOrder.id ? `BT-${String(latestOrder.id).slice(-6).toUpperCase()}` : 'Order');

        if (!isCancellableRequesterOrderStatus(latestOrder.status)) {
          Alert.alert(
            'Cancellation Not Available',
            `Your order (${orderRef}) has already been approved by the water station, so direct cancellation is no longer available. If you need assistance, please contact your Branch Manager through BlueTap.`
          );
          return;
        }

        setCancelConfirmationTarget(latestOrder);
        return;
      }

      try {
        await executeAssistantAction(action, { router, chat, role });
      } catch (err) {
        Alert.alert('Action Error', 'Unable to complete this action right now.');
      }
    },
    [router, chat, role, openRequestDetails, detailOrders, effectiveSafeContext]
  );

  const cancellingOrderRef = useRef(false);

  const confirmCancelOrder = useCallback((request) => {
    if (!request) return;
    const latestOrder = (detailOrders || []).find((ord) => ord.id === request.id) || request;
    const orderRef =
      latestOrder.publicOrderId ||
      latestOrder.requestId ||
      latestOrder.request_id ||
      (latestOrder.id ? `BT-${String(latestOrder.id).slice(-6).toUpperCase()}` : 'Order');

    if (!isCancellableRequesterOrderStatus(latestOrder.status)) {
      Alert.alert(
        'Cancellation Not Available',
        `Your order (${orderRef}) has already been approved by the water station, so direct cancellation is no longer available. If you need assistance, please contact your Branch Manager through BlueTap.`
      );
      return;
    }

    closeRequestDetails();
    setCancelConfirmationTarget(latestOrder);
  }, [closeRequestDetails, detailOrders]);

  const handleExecuteCancellation = useCallback(async () => {
    if (!cancelConfirmationTarget || cancellingOrderRef.current) return;
    const target = cancelConfirmationTarget;
    const latestOrder = (detailOrders || []).find((ord) => ord.id === target.id) || target;
    const orderRef =
      latestOrder.publicOrderId ||
      latestOrder.requestId ||
      latestOrder.request_id ||
      (latestOrder.id ? `BT-${String(latestOrder.id).slice(-6).toUpperCase()}` : 'Order');

    if (!isCancellableRequesterOrderStatus(latestOrder.status)) {
      setCancelConfirmationTarget(null);
      Alert.alert(
        'Cancellation Not Available',
        `Your order (${orderRef}) has already been approved by the water station, so direct cancellation is no longer available. If you need assistance, please contact your Branch Manager through BlueTap.`
      );
      return;
    }

    cancellingOrderRef.current = true;
    setCancellingInFlight(true);

    try {
      await cancelRequest(target);

      const currentUid = auth?.currentUser?.uid || effectiveUserId;
      if (currentUid && currentUid !== 'anonymous') {
        await refreshRequesterRequests(currentUid).catch(() => {});
      }

      setLocallyCancelledIds((prev) => new Set([...prev, target.id]));
      setCancelConfirmationTarget(null);

      const rawRemainingOrders = (detailOrders || []).filter(
        (ord) => ord.id !== target.id && ord.requestId !== target.id && !locallyCancelledIds.has(ord.id)
      );
      const remainingActive = rawRemainingOrders.filter((ord) =>
        isActiveRequesterOrderStatus(ord.status)
      );
      const hasOrderingRestriction = Boolean(
        effectiveSafeContext?.restrictions?.hasOrderingRestriction
      );

      let confirmationText = `Order ${orderRef} has been cancelled successfully.`;
      const nextActions = [];

      if (remainingActive.length > 0) {
        const nextActive = remainingActive[0];
        const nextRef =
          nextActive.publicOrderId ||
          nextActive.requestId ||
          nextActive.request_id ||
          (nextActive.id ? `BT-${String(nextActive.id).slice(-6).toUpperCase()}` : 'Order');
        confirmationText += ` You still have an active request (${nextRef}) in progress ("${nextActive.status || 'Pending'}").`;
        nextActions.push({
          type: 'VIEW_ORDER',
          label: 'View Active Order',
          orderId: nextActive.id,
        });
      } else if (!hasOrderingRestriction) {
        confirmationText += ` You currently have no other active requests and can place a new order whenever you're ready.`;
        nextActions.push({
          type: 'START_ORDER',
          label: 'Start an Order',
        });
      }
      nextActions.push({
        type: 'OPEN_REQUESTS',
        label: 'Order History',
      });

      const asstMsgId = `asst-cancel-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: asstMsgId,
          role: 'assistant',
          text: confirmationText,
          cards: [],
          actions: nextActions,
          timestamp: Date.now(),
        },
      ]);
      setAnimatingMessageId(asstMsgId);
    } catch (err) {
      const currentUid = auth?.currentUser?.uid || effectiveUserId;
      if (currentUid && currentUid !== 'anonymous') {
        await refreshRequesterRequests(currentUid).catch(() => {});
      }
      setCancelConfirmationTarget(null);

      const isNotCancellableError =
        err?.message?.includes('ORDER_NOT_CANCELLABLE') ||
        err?.message?.includes('Only pending requests can be canceled') ||
        err?.message?.includes('approved');

      Alert.alert(
        isNotCancellableError ? 'Cancellation Not Available' : 'Cancellation Status Unconfirmed',
        isNotCancellableError
          ? `Your order (${orderRef}) has already been approved by the water station, so direct cancellation is no longer available. If you need assistance, please contact your Branch Manager through BlueTap.`
          : err?.message ||
            'We could not confirm the cancellation with the server. Please check your order status in My Orders.'
      );
    } finally {
      cancellingOrderRef.current = false;
      setCancellingInFlight(false);
    }
  }, [cancelConfirmationTarget, detailOrders, effectiveUserId, locallyCancelledIds, effectiveSafeContext]);

  const handleResetConversation = useCallback(() => {
    Alert.alert(
      'New Conversation',
      'Start a fresh conversation with BlueTap Assistant?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start New',
          style: 'destructive',
          onPress: async () => {
            setAnimatingMessageId(null);
            if (effectiveUserId && effectiveUserId !== 'anonymous') {
              await clearDailyAssistantChat({ userId: effectiveUserId, role }).catch(() => {});
            }
            seedWelcomeConversation();
          },
        },
      ]
    );
  }, [effectiveUserId, role, seedWelcomeConversation]);

  const defaultPlaceholder = useMemo(() => {
    if (propPlaceholder) return propPlaceholder;
    if (isDistributor) {
      return effectiveSafeContext?.currentAssignment
        ? 'Ask about current delivery, schedule, or customer...'
        : 'Ask about delivery schedule or station...';
    }
    return effectiveSafeContext?.hasActiveOrder
      ? 'Ask about your order, delivery, or station...'
      : 'Ask BlueTap Assistant...';
  }, [propPlaceholder, isDistributor, effectiveSafeContext]);

  return (
    <LinearGradient
      colors={isDark ? [colors.background, colors.header] : [colors.primary, colors.primaryLight]}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
      <SafeAreaView edges={['left', 'right']} style={styles.container}>
        <StatusBar style="light" />

        <PageEnterTransition
          axis="y"
          distance={10}
          duration={260}
          scaleFrom={0.99}
          style={styles.phoneWrapper}
          resetKey={role}
        >
          {/* Sub-header Card */}
          <View
            style={[
              styles.subHeader,
              {
                backgroundColor: isDark ? colors.surface : '#FFFFFF',
                borderColor: isDark ? colors.border : '#D7ECFF',
                paddingVertical: isMobile ? 7 : 10,
                marginTop: isMobile ? 6 : 8,
              },
            ]}
          >
            <TouchableOpacity
              onPress={() => replaceOnce(effectiveBackRoute)}
              style={[
                styles.headerBtn,
                { backgroundColor: isDark ? colors.surfaceAlt : '#F0F6FD' },
              ]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close assistant and return to profile"
            >
              <BlueTapIcon name="close" size={18} color={colors.iconSecondary || colors.textPrimary} />
            </TouchableOpacity>

            <View style={styles.headerTitleContainer}>
              <View style={styles.headerTitleRow}>
                <View
                  style={[
                    styles.headerAvatar,
                    { backgroundColor: isDark ? colors.primarySoft : '#EAF6FF' },
                  ]}
                >
                  <BlueTapBrandMark color={colors.iconInteractive || colors.primary} size={14} style={styles.headerAvatarIcon} />
                </View>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
                  {title}
                </Text>
              </View>
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                {effectiveSubtitle}
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleResetConversation}
              style={[
                styles.headerBtn,
                { backgroundColor: isDark ? colors.surfaceAlt : '#F0F6FD' },
              ]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Start a new conversation"
            >
              <BlueTapIcon name="reset" size={18} color={colors.iconSecondary || colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Messages Feed */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardContainer}
          >
            <ScrollView
              ref={scrollViewRef}
              style={styles.messagesScroll}
              contentContainerStyle={styles.messagesContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onScroll={handleScroll}
              scrollEventThrottle={32}
            >
              {messages.map((item) => (
                <AssistantMessageBubble
                  key={item.id}
                  message={item}
                  onAction={handleAction}
                  isAnimating={animatingMessageId === item.id}
                  onAnimationComplete={handleAnimationComplete}
                  onAnimationTick={handleAnimationTick}
                />
              ))}

              {loading && (
                <View style={styles.loadingBubbleRow}>
                  <View
                    style={[
                      styles.loadingAvatar,
                      {
                        backgroundColor: isDark ? colors.primarySoft : '#FFFFFF',
                        borderColor: isDark ? colors.border : '#D7ECFF',
                      },
                    ]}
                  >
                    <BlueTapBrandMark color={colors.iconInteractive || colors.primary} size={16} style={styles.loadingAvatarIcon} />
                  </View>
                  <View
                    style={[
                      styles.loadingBubble,
                      {
                        backgroundColor: isDark ? colors.surfaceAlt : '#FFFFFF',
                        borderColor: isDark ? colors.border : '#D7ECFF',
                      },
                    ]}
                  >
                    <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                      BlueTap Assistant is checking...
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Quick Action Chips Bar */}
            <AssistantQuickActions
              safeContext={effectiveSafeContext}
              onSelectAction={handleQuickAction}
              disabled={loading}
              role={role}
            />

            {/* Composer with bottom inset for floating nav */}
            <View style={[styles.composerWrapper, { paddingBottom: composerBottomPadding }]}>
              <AssistantComposer
                onSend={(text) => handleSendQuery(text, null)}
                loading={loading}
                placeholder={defaultPlaceholder}
              />
            </View>
          </KeyboardAvoidingView>
          <RequestDetailsModal
            visible={requestDetailsVisible}
            request={selectedRequest}
            branches={detailBranches}
            onClose={closeRequestDetails}
            onCancel={
              selectedRequest && isCancellableRequesterOrderStatus(selectedRequest.status)
                ? () => confirmCancelOrder(selectedRequest)
                : undefined
            }
          />
          <Modal
            visible={Boolean(cancelConfirmationTarget)}
            transparent
            animationType="fade"
            onRequestClose={() => {
              if (!cancellingInFlight) setCancelConfirmationTarget(null);
            }}
          >
            <View style={styles.modalOverlay}>
              <View
                style={[
                  styles.confirmDialog,
                  {
                    backgroundColor: isDark ? colors.surface : '#FFFFFF',
                    borderColor: isDark ? colors.border : '#D7ECFF',
                  },
                ]}
                accessibilityRole="alert"
                accessibilityViewIsModal={true}
              >
                <View style={styles.confirmHeader}>
                  <View
                    style={[
                      styles.confirmIconWrap,
                      { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2' },
                    ]}
                  >
                    <BlueTapIcon name="warning" size={22} color={isDark ? '#F87171' : '#DC2626'} />
                  </View>
                  <Text style={[styles.confirmTitle, { color: colors.textPrimary }]}>
                    Cancel Water Request?
                  </Text>
                </View>

                <Text style={[styles.confirmMessage, { color: colors.textSecondary }]}>
                  Are you sure you want to cancel request{' '}
                  <Text style={{ fontWeight: '700', color: colors.textPrimary }}>
                    {cancelConfirmationTarget?.publicOrderId ||
                      cancelConfirmationTarget?.requestId ||
                      cancelConfirmationTarget?.request_id ||
                      (cancelConfirmationTarget?.id
                        ? `BT-${String(cancelConfirmationTarget.id).slice(-6).toUpperCase()}`
                        : 'Order')}
                  </Text>
                  {cancelConfirmationTarget?.branchName || cancelConfirmationTarget?.water_station
                    ? ` from ${cancelConfirmationTarget.branchName || cancelConfirmationTarget.water_station}`
                    : ''}
                  ? This action cannot be undone.
                </Text>

                <View style={styles.confirmActionsRow}>
                  <TouchableOpacity
                    style={[
                      styles.confirmKeepBtn,
                      {
                        backgroundColor: isDark ? colors.surfaceAlt : '#F1F5F9',
                        borderColor: isDark ? colors.border : '#E2E8F0',
                      },
                    ]}
                    onPress={() => setCancelConfirmationTarget(null)}
                    disabled={cancellingInFlight}
                    accessibilityRole="button"
                    accessibilityLabel="Keep Order"
                  >
                    <Text style={[styles.confirmKeepBtnText, { color: colors.textPrimary }]}>
                      Keep Order
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.confirmCancelBtn,
                      { backgroundColor: isDark ? '#DC2626' : '#EF4444' },
                    ]}
                    onPress={handleExecuteCancellation}
                    disabled={cancellingInFlight}
                    accessibilityRole="button"
                    accessibilityLabel="Yes, Cancel"
                  >
                    <Text style={styles.confirmCancelBtnText}>
                      {cancellingInFlight ? 'Cancelling...' : 'Yes, Cancel'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </PageEnterTransition>
      </SafeAreaView>
    </LinearGradient>
  );
}

export default AssistantScreen;

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    width: '100%',
  },
  phoneWrapper: {
    width: '100%',
    maxWidth: USER_PORTAL_LAYOUT.maxWidth,
    minWidth: 0,
    alignSelf: 'center',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    ...createShadow({
      color: '#0D47A1',
      elevation: 4,
      opacity: 0.1,
      radius: 8,
      offset: { width: 0, height: 3 },
    }),
  },
  headerBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnIcon: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarIcon: {
    width: 14,
    height: 14,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  headerSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  keyboardContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  messagesScroll: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  loadingBubbleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 6,
  },
  loadingAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingAvatarIcon: {
    width: 16,
    height: 16,
  },
  loadingBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderTopLeftRadius: 4,
    borderWidth: 1,
  },
  loadingText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  composerWrapper: {
    paddingBottom: 0,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 15, 25, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmDialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    ...createShadow({
      color: '#000000',
      elevation: 8,
      opacity: 0.25,
      radius: 16,
      offset: { width: 0, height: 6 },
    }),
  },
  confirmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  confirmIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  confirmMessage: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 20,
  },
  confirmActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  confirmKeepBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
  },
  confirmKeepBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  confirmCancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
  },
  confirmCancelBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
