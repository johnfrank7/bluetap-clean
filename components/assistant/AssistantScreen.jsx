import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
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

export function AssistantScreen({
  role = 'requester',
  safeContext = {},
  userId: propUserId,
  backRoute,
  title = 'BlueTap Assistant',
  subtitle: propSubtitle,
  placeholder: propPlaceholder,
}) {
  const { colors, isDark } = useBlueTapTheme();
  const router = useRouter();
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
      (insets.bottom || 0) -
      6
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
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const scrollViewRef = useRef(null);

  const seedWelcomeConversation = useCallback(() => {
    if (isDistributor) {
      const firstName = safeContext?.distributor?.firstName || 'there';
      let welcomeText = `Hi ${firstName}! 👋 I'm your BlueTap Assistant. I can help with your assigned deliveries, today's schedule, delivery details, contacting customers, or station dispatch.`;

      const initialCards = [];
      const initialActions = [];

      if (safeContext?.currentAssignment) {
        const order = safeContext.currentAssignment;
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
    const firstName = safeContext?.requester?.firstName || 'there';
    let welcomeText = `Hi ${firstName}! 👋 I'm your BlueTap Assistant. I can help track your water requests, check delivery schedules, find nearby water stations, or answer account questions.`;

    const initialCards = [];
    const initialActions = [];

    if (safeContext?.hasActiveOrder) {
      const order = safeContext.activeOrder;
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
  }, [isDistributor, safeContext]);

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
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 120);
  }, []);

  const handleSendQuery = useCallback(
    async (userInput, forcedIntent = null) => {
      if (!userInput || !userInput.trim() || loading) return;

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
          safeContext,
          role,
          history: messages.slice(-10),
        });

        const assistantMsg = {
          id: `asst-${Date.now()}`,
          role: 'assistant',
          text: response.message,
          cards: response.cards || [],
          actions: response.actions || [],
          intent: response.intent,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            text: isDistributor
              ? "I couldn't process your delivery inquiry right now. Please try asking again."
              : "I couldn't process your request right now. Please try asking again.",
            cards: [],
            actions: [],
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setLoading(false);
        scrollToBottom();
      }
    },
    [loading, safeContext, role, isDistributor, messages, scrollToBottom]
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
      try {
        await executeAssistantAction(action, { router, chat, role });
      } catch (err) {
        Alert.alert('Action Error', 'Unable to complete this action right now.');
      }
    },
    [router, chat, role]
  );

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
      return safeContext?.currentAssignment
        ? 'Ask about current delivery, schedule, or customer...'
        : 'Ask about delivery schedule or station...';
    }
    return safeContext?.hasActiveOrder
      ? 'Ask about your order, delivery, or station...'
      : 'Ask BlueTap Assistant...';
  }, [propPlaceholder, isDistributor, safeContext]);

  return (
    <LinearGradient
      colors={isDark ? [colors.background, colors.header] : [colors.primary, colors.primaryLight]}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
      <SafeAreaView edges={['left', 'right']} style={styles.container}>
        <StatusBar style="light" />

        <View style={styles.phoneWrapper}>
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
              onPress={() => router.replace(effectiveBackRoute)}
              style={[
                styles.headerBtn,
                { backgroundColor: isDark ? colors.surfaceAlt : '#F0F6FD' },
              ]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close assistant and return to profile"
            >
              <Text style={[styles.headerBtnIcon, { color: colors.textPrimary }]}>✕</Text>
            </TouchableOpacity>

            <View style={styles.headerTitleContainer}>
              <View style={styles.headerTitleRow}>
                <View
                  style={[
                    styles.headerAvatar,
                    { backgroundColor: isDark ? colors.primarySoft : '#EAF6FF' },
                  ]}
                >
                  <Image
                    source={require('../../assets/icons/bluetapwhitelogo.png')}
                    style={styles.headerAvatarIcon}
                    tintColor={colors.primary}
                    resizeMode="contain"
                  />
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
              <Text style={[styles.headerBtnIcon, { color: colors.textPrimary }]}>↺</Text>
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
            >
              {messages.map((item) => (
                <AssistantMessageBubble
                  key={item.id}
                  message={item}
                  onAction={handleAction}
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
                    <Image
                      source={require('../../assets/icons/bluetapwhitelogo.png')}
                      style={styles.loadingAvatarIcon}
                      tintColor={colors.primary}
                      resizeMode="contain"
                    />
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
              safeContext={safeContext}
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
        </View>
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
});
