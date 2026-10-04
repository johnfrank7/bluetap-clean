import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useBlueTapTheme } from '../BlueTapTheme';
import { createShadow } from '../shadowStyles';
import AssistantCardRenderer, { AssistantCardRenderer as NamedRenderer } from './AssistantCards';

const CardRenderer = AssistantCardRenderer || NamedRenderer;

export function AssistantMessageBubble({ message = {}, onAction }) {
  const { colors, isDark } = useBlueTapTheme();
  const isUser = message.role === 'user';

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
        <Image
          source={require('../../assets/icons/bluetapwhitelogo.png')}
          style={styles.avatarIcon}
          tintColor={colors.primary}
          resizeMode="contain"
        />
      </View>

      <View style={styles.assistantContent}>
        <View
          style={[
            styles.assistantBubble,
            {
              backgroundColor: isDark ? colors.surfaceAlt : '#FFFFFF',
              borderColor: isDark ? colors.border : '#D7ECFF',
            },
          ]}
        >
          <Text style={[styles.assistantText, { color: colors.textPrimary }]}>
            {message.text}
          </Text>
        </View>

        {Array.isArray(message.cards) && message.cards.length > 0 && (
          <View style={styles.cardsContainer}>
            {message.cards.map((card, idx) => (
              <CardRenderer key={idx} card={card} onAction={onAction} />
            ))}
          </View>
        )}

        {visibleActions.length > 0 && (
          <View style={styles.actionsContainer}>
            {visibleActions.map((act, idx) => (
              <TouchableOpacity
                key={idx}
                style={[styles.actionButton, { backgroundColor: colors.primary }]}
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
});
