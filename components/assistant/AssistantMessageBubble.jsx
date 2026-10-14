import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useBlueTapTheme } from '../BlueTapTheme';
import BlueTapBrandMark from '../BlueTapBrandMark';
import { createShadow } from '../shadowStyles';
import AssistantCardRenderer, { AssistantCardRenderer as NamedRenderer } from './AssistantCards';
import useAssistantTypewriterDefault, { useAssistantTypewriter as namedTypewriter } from './useAssistantTypewriter';

const CardRenderer = AssistantCardRenderer || NamedRenderer;
const defaultHookFallback = () => ({
  displayedText: '',
  isTyping: false,
  cursorVisible: false,
  completeImmediately: () => {},
});
const useTypewriter = useAssistantTypewriterDefault || namedTypewriter || defaultHookFallback;

export function AssistantMessageBubble({
  message = {},
  onAction,
  isAnimating = false,
  onAnimationComplete,
  onAnimationTick,
}) {
  const { colors, isDark } = useBlueTapTheme();
  const isUser = message.role === 'user';

  const {
    displayedText,
    isTyping,
    cursorVisible,
    completeImmediately,
  } = useTypewriter({
    text: message.text,
    isAnimating: isAnimating && !isUser,
    onComplete: () => onAnimationComplete && onAnimationComplete(message.id),
    onTick: onAnimationTick,
  });

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <View
          style={[
            styles.userBubble,
            { backgroundColor: isDark ? colors.primary : (colors.primaryDark || '#0D47A1') },
          ]}
        >
          <Text style={styles.userText}>{message.text}</Text>
        </View>
      </View>
    );
  }

  // De-duplicate actions: if an OrderCard is present, its internal View Details and Contact Station
  // buttons handle those actions, so we suppress duplicate buttons in actionsContainer.
  // De-duplicate actions: if an OrderCard or DeliveryCard is present, their internal
  // action buttons handle those actions, so we suppress duplicate buttons in actionsContainer.
  const hasOrderCard = Array.isArray(message.cards) && message.cards.some((c) => c.type === 'order');
  const hasDeliveryCard = Array.isArray(message.cards) && message.cards.some((c) => c.type === 'delivery');
  const visibleActions = (message.actions || []).filter((act) => {
    if (hasOrderCard && (act.type === 'VIEW_ORDER' || act.type === 'CONTACT_STATION')) {
      return false;
    }
    if (hasDeliveryCard && (act.type === 'VIEW_DELIVERY' || act.type === 'CONTACT_REQUESTER')) {
      return false;
    }
    return true;
  });

  return (
    <View style={styles.assistantRow}>
      <View
        style={[
          styles.avatar,
          {
            backgroundColor: isDark ? colors.primarySoft : '#FFFFFF',
            borderColor: isDark ? colors.border : '#D7ECFF',
          },
        ]}
      >
        <BlueTapBrandMark color={colors.iconInteractive || colors.primary} size={18} style={styles.avatarIcon} />
      </View>

      <View style={styles.assistantContent}>
        <TouchableOpacity
          activeOpacity={isTyping ? 0.92 : 1}
          onPress={isTyping ? completeImmediately : undefined}
          disabled={!isTyping}
          accessibilityRole={isTyping ? 'button' : undefined}
          accessibilityLabel={isTyping ? 'Tap to reveal full response' : undefined}
          style={[
            styles.assistantBubble,
            {
              backgroundColor: isDark ? colors.surfaceAlt : '#FFFFFF',
              borderColor: isDark ? colors.border : '#D7ECFF',
            },
          ]}
        >
          <View accessible accessibilityLabel={message.text}>
            <Text
              accessibilityElementsHidden={isTyping}
              importantForAccessibility={isTyping ? 'no' : 'auto'}
              style={[styles.assistantText, { color: colors.textPrimary }]}
            >
              {displayedText}
              {isTyping && (
                <Text
                  style={[
                    styles.cursor,
                    { color: colors.primaryLight || colors.primary || '#187BCD' },
                    !cursorVisible && styles.cursorHidden,
                  ]}
                >
                  |
                </Text>
              )}
            </Text>
          </View>
        </TouchableOpacity>

        {!isTyping && Array.isArray(message.cards) && message.cards.length > 0 && (
          <View style={styles.cardsContainer}>
            {message.cards.map((card, idx) => (
              <CardRenderer key={idx} card={card} onAction={onAction} />
            ))}
          </View>
        )}

        {!isTyping && visibleActions.length > 0 && (
          <View style={styles.actionsContainer}>
            {visibleActions.map((act, idx) => (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.actionButton,
                  act.type === 'CANCEL_ORDER'
                    ? { backgroundColor: isDark ? '#DC2626' : '#EF4444' }
                    : { backgroundColor: colors.primary },
                ]}
                onPress={() => onAction && onAction(act)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={act.label}
              >
                <Text style={styles.actionButtonText}>{act.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

export default AssistantMessageBubble;

const styles = StyleSheet.create({
  userRow: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    marginVertical: 5,
  },
  userBubble: {
    alignSelf: 'flex-end',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    ...createShadow({
      color: '#07131F',
      elevation: 2,
      opacity: 0.08,
      radius: 4,
      offset: { width: 0, height: 2 },
    }),
  },
  userText: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    maxWidth: '96%',
    marginVertical: 5,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 2,
    flexShrink: 0,
    ...createShadow({
      color: '#0D47A1',
      elevation: 2,
      opacity: 0.06,
      radius: 4,
      offset: { width: 0, height: 1 },
    }),
  },
  avatarIcon: {
    width: 16,
    height: 16,
  },
  assistantContent: {
    flex: 1,
    alignItems: 'flex-start',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 18,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    ...createShadow({
      color: '#0D47A1',
      elevation: 2,
      opacity: 0.06,
      radius: 6,
      offset: { width: 0, height: 2 },
    }),
  },
  assistantText: {
    fontSize: 14,
    lineHeight: 20,
  },
  cardsContainer: {
    marginTop: 4,
    width: '100%',
  },
  actionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  cursor: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '300',
    marginLeft: 2,
    opacity: 1,
  },
  cursorHidden: {
    opacity: 0,
  },
});
