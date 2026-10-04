import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useBlueTapTheme } from '../BlueTapTheme';
import { createShadow } from '../shadowStyles';
import { ASSISTANT_INTENTS } from '../../services/assistant/assistantIntents';

export function AssistantQuickActions({ safeContext, onSelectAction, disabled, role }) {
  const { colors, isDark } = useBlueTapTheme();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 768;
  const isMobile = width < 600;
  const currentRole = role || safeContext?.role || 'requester';

  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const getQuickActionChips = () => {
    if (currentRole === 'distributor') {
      if (safeContext?.isDeliveryFailed) {
        return [
          {
            id: 'failed_help',
            label: '⚠️ Failed Delivery Help',
            intent: ASSISTANT_INTENTS.FAILED_DELIVERY_HELP,
            prompt: 'What should I do if the customer cannot be reached?',
            query: 'What should I do if the customer cannot be reached?',
          },
          {
            id: 'chat_rules',
            label: '🕒 Chat Availability',
            intent: ASSISTANT_INTENTS.CHAT_AVAILABILITY,
            prompt: 'Why can\'t I message the customer anymore?',
            query: 'Why can\'t I message the customer anymore?',
          },
          ...(safeContext?.currentAssignment?.chatAllowed ? [{
            id: 'contact_requester',
            label: '💬 Contact Requester',
            intent: ASSISTANT_INTENTS.CONTACT_REQUESTER,
            prompt: 'How do I contact the customer?',
            query: 'How do I contact the customer?',
          }] : []),
          {
            id: 'contact_station',
            label: '🏢 Contact Station',
            intent: ASSISTANT_INTENTS.CONTACT_STATION,
            prompt: 'How do I contact the station manager?',
            query: 'How do I contact the station manager?',
          },
          {
            id: 'today_schedule',
            label: '📅 Today\'s Deliveries',
            intent: ASSISTANT_INTENTS.TODAY_SCHEDULE,
            prompt: 'What are my deliveries today?',
            query: 'What are my deliveries today?',
          },
          {
            id: 'details',
            label: '📋 Delivery Details',
            intent: ASSISTANT_INTENTS.DELIVERY_DETAILS,
            prompt: 'Show delivery details',
            query: 'Show delivery details',
          },
        ];
      }

      if (safeContext?.hasActiveAssignment || safeContext?.currentAssignment) {
        return [
          {
            id: 'current_delivery',
            label: '🚚 Current Delivery',
            intent: ASSISTANT_INTENTS.CURRENT_DELIVERY,
            prompt: 'What is my current delivery?',
            query: 'What is my current delivery?',
          },
          {
            id: 'today_schedule',
            label: '📅 Today\'s Deliveries',
            intent: ASSISTANT_INTENTS.TODAY_SCHEDULE,
            prompt: 'What are my deliveries today?',
            query: 'What are my deliveries today?',
          },
          ...(safeContext?.currentAssignment?.chatAllowed ? [{
            id: 'contact_requester',
            label: '💬 Contact Requester',
            intent: ASSISTANT_INTENTS.CONTACT_REQUESTER,
            prompt: 'How do I contact the customer?',
            query: 'How do I contact the customer?',
          }] : []),
          {
            id: 'delivery_details',
            label: '📋 Delivery Details',
            intent: ASSISTANT_INTENTS.DELIVERY_DETAILS,
            prompt: 'Show delivery details',
            query: 'Show delivery details',
          },
          {
            id: 'contact_station',
            label: '🏢 Contact Station',
            intent: ASSISTANT_INTENTS.CONTACT_STATION,
            prompt: 'How do I contact the station manager?',
            query: 'How do I contact the station manager?',
          },
          {
            id: 'failed_help',
            label: '⚠️ Failed Delivery Help',
            intent: ASSISTANT_INTENTS.FAILED_DELIVERY_HELP,
            prompt: 'What should I do if the customer cannot be reached?',
            query: 'What should I do if the customer cannot be reached?',
          },
          {
            id: 'chat_rules',
            label: '🕒 Chat Availability',
            intent: ASSISTANT_INTENTS.CHAT_AVAILABILITY,
            prompt: 'Why can\'t I message the customer anymore?',
            query: 'Why can\'t I message the customer anymore?',
          },
          {
            id: 'notifications',
            label: '🔔 Notifications',
            intent: ASSISTANT_INTENTS.VIEW_NOTIFICATIONS,
            prompt: 'Show my notifications',
            query: 'Show my notifications',
          },
        ];
      }

      return [
        {
          id: 'today_schedule',
          label: '📅 Today\'s Deliveries',
          intent: ASSISTANT_INTENTS.TODAY_SCHEDULE,
          prompt: 'What are my deliveries today?',
          query: 'What are my deliveries today?',
        },
        {
          id: 'next_delivery',
          label: '➡️ Next Delivery',
          intent: ASSISTANT_INTENTS.NEXT_DELIVERY,
          prompt: 'What is my next delivery?',
          query: 'What is my next delivery?',
        },
        {
          id: 'contact_station',
          label: '🏢 Contact Station',
          intent: ASSISTANT_INTENTS.CONTACT_STATION,
          prompt: 'How do I contact the station manager?',
          query: 'How do I contact the station manager?',
        },
        {
          id: 'how_works',
          label: 'ℹ️ How Delivery Works',
          intent: ASSISTANT_INTENTS.HOW_DISTRIBUTOR_WORKS,
          prompt: 'How does distributor delivery work?',
          query: 'How does distributor delivery work?',
        },
        {
          id: 'history',
          label: '📜 Delivery History',
          intent: ASSISTANT_INTENTS.DELIVERY_HISTORY,
          prompt: 'Where can I see my past deliveries?',
          query: 'Where can I see my past deliveries?',
        },
        {
          id: 'notifications',
          label: '🔔 Notifications',
          intent: ASSISTANT_INTENTS.VIEW_NOTIFICATIONS,
          prompt: 'Show my notifications',
          query: 'Show my notifications',
        },
        {
          id: 'chat_rules',
          label: '🕒 Chat Availability',
          intent: ASSISTANT_INTENTS.CHAT_AVAILABILITY,
          prompt: 'Why can\'t I message the customer anymore?',
          query: 'Why can\'t I message the customer anymore?',
        },
      ];
    }
    if (safeContext?.hasActiveOrder) {
      return [
        {
          id: 'track',
          label: '🚚 Track my delivery',
          intent: ASSISTANT_INTENTS.TRACK_ORDER,
          prompt: 'Where is my current order?',
          query: 'Where is my current order?',
        },
        {
          id: 'schedule',
          label: '🕒 Delivery schedule',
          intent: ASSISTANT_INTENTS.DELIVERY_SCHEDULE,
          prompt: 'When is my delivery scheduled?',
          query: 'When is my delivery scheduled?',
        },
        {
          id: 'cancel',
          label: '❌ Can I cancel?',
          intent: ASSISTANT_INTENTS.CANCELLED_ORDER_HELP,
          prompt: 'Can I cancel my current order?',
          query: 'Can I cancel my current order?',
        },
        {
          id: 'contact',
          label: '💬 Contact station',
          intent: ASSISTANT_INTENTS.CONTACT_STATION,
          prompt: 'How do I contact my water station?',
          query: 'How do I contact my water station?',
        },
        {
          id: 'status',
          label: '📋 Order details',
          intent: ASSISTANT_INTENTS.ORDER_STATUS,
          prompt: 'Show my order details',
          query: 'Show my order details',
        },
      ];
    }

    if (safeContext?.hasActiveRestriction) {
      return [
        {
          id: 'restriction',
          label: '⚠️ Account notice',
          intent: safeContext?.restrictions?.chat?.length
            ? ASSISTANT_INTENTS.EXPLAIN_CHAT_RESTRICTION
            : ASSISTANT_INTENTS.EXPLAIN_ORDERING_RESTRICTION,
          prompt: 'Why is my account restricted?',
          query: 'Why is my account restricted?',
        },
        {
          id: 'order_status',
          label: '💧 Can I still order?',
          intent: ASSISTANT_INTENTS.EXPLAIN_ORDERING_RESTRICTION,
          prompt: 'Can I still order water with this restriction?',
          query: 'Can I still order water with this restriction?',
        },
        {
          id: 'contact_station',
          label: '💬 Contact station',
          intent: ASSISTANT_INTENTS.CONTACT_STATION,
          prompt: 'How do I contact my water station?',
          query: 'How do I contact my water station?',
        },
        {
          id: 'appeal',
          label: '🛡️ How to resolve',
          intent: ASSISTANT_INTENTS.EXPLAIN_ORDERING_RESTRICTION,
          prompt: 'How do I resolve this restriction?',
          query: 'How do I resolve this restriction?',
        },
      ];
    }

    return [
      {
        id: 'order',
        label: '💧 How to order water',
        intent: ASSISTANT_INTENTS.HOW_BLUETAP_WORKS,
        prompt: 'How do I order water on BlueTap?',
        query: 'How do I order water on BlueTap?',
      },
      {
        id: 'stations',
        label: '📍 Nearby stations',
        intent: ASSISTANT_INTENTS.FIND_PROVIDER,
        prompt: 'Find nearby water stations',
        query: 'Find nearby water stations',
      },
      {
        id: 'schedule',
        label: '🕒 Delivery hours',
        intent: ASSISTANT_INTENTS.DELIVERY_SCHEDULE,
        prompt: 'What are the delivery hours and schedule?',
        query: 'What are the delivery hours and schedule?',
      },
      {
        id: 'payment',
        label: '💵 Payment options',
        intent: ASSISTANT_INTENTS.PAYMENT_HELP,
        prompt: 'What payment methods are supported?',
        query: 'What payment methods are supported?',
      },
      {
        id: 'containers',
        label: '🪣 Container types',
        intent: ASSISTANT_INTENTS.CONTAINER_HELP,
        prompt: 'What container types and sizes do you deliver?',
        query: 'What container types and sizes do you deliver?',
      },
      {
        id: 'history',
        label: '📜 Past orders',
        intent: ASSISTANT_INTENTS.TRACK_ORDER,
        prompt: 'Where can I see my past orders?',
        query: 'Where can I see my past orders?',
      },
    ];
  };

  const chips = getQuickActionChips();

  const updateScrollState = useCallback(() => {
    if (Platform.OS === 'web') {
      const node = scrollRef.current?.getScrollableNode?.() || scrollRef.current;
      if (node && typeof node.scrollLeft === 'number') {
        const maxScroll = node.scrollWidth - node.clientWidth;
        setCanScrollLeft(node.scrollLeft > 6);
        setCanScrollRight(maxScroll > 6 && node.scrollLeft < maxScroll - 6);
      }
    }
  }, []);

  const handleScroll = useCallback((event) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const scrollX = contentOffset?.x || 0;
    const visibleWidth = layoutMeasurement?.width || 0;
    const totalWidth = contentSize?.width || 0;
    const maxScroll = totalWidth - visibleWidth;
    setCanScrollLeft(scrollX > 6);
    setCanScrollRight(maxScroll > 6 && scrollX < maxScroll - 6);
  }, []);

  const handleContentSizeChange = useCallback(
    (w) => {
      if (Platform.OS === 'web') {
        updateScrollState();
      } else {
        setCanScrollRight(w > width - 32);
      }
    },
    [updateScrollState, width]
  );

  // Web mouse wheel handling: translate vertical wheeling to horizontal scrolling when there is overflow.
  // Boundary check: do not preventDefault if at ends, allowing normal page scrolling.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = scrollRef.current?.getScrollableNode?.() || scrollRef.current;
    if (!node || typeof node.addEventListener !== 'function') return;

    const handleWheel = (e) => {
      // If user is already scrolling horizontally (trackpad or Shift+wheel), let native scroll handle it
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        setTimeout(updateScrollState, 50);
        return;
      }

      const maxScroll = node.scrollWidth - node.clientWidth;
      if (maxScroll <= 4) return; // No overflow

      const delta = e.deltaY;
      if (delta > 0 && node.scrollLeft < maxScroll - 2) {
        e.preventDefault();
        node.scrollLeft += delta;
        updateScrollState();
      } else if (delta < 0 && node.scrollLeft > 2) {
        e.preventDefault();
        node.scrollLeft += delta;
        updateScrollState();
      }
    };

    node.addEventListener('wheel', handleWheel, { passive: false });
    const timer = setTimeout(updateScrollState, 150);
    return () => {
      node.removeEventListener('wheel', handleWheel);
      clearTimeout(timer);
    };
  }, [updateScrollState]);

  const handleScrollBy = useCallback(
    (distance) => {
      if (Platform.OS === 'web') {
        const node = scrollRef.current?.getScrollableNode?.() || scrollRef.current;
        if (node && typeof node.scrollBy === 'function') {
          node.scrollBy({ left: distance, behavior: 'smooth' });
          setTimeout(updateScrollState, 200);
          return;
        }
      }
      const node = scrollRef.current?.getScrollableNode?.() || scrollRef.current;
      const currentX = node?.scrollLeft || 0;
      scrollRef.current?.scrollTo?.({
        x: Math.max(0, currentX + distance),
        animated: true,
      });
    },
    [updateScrollState]
  );

  return (
    <View style={[styles.container, isMobile ? styles.containerMobile : styles.containerDesktop]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        scrollEventThrottle={16}
        style={styles.scroll}
      >
        {chips.map((chip) => (
          <TouchableOpacity
            key={chip.id}
            style={[
              styles.chip,
              {
                backgroundColor: isDark ? colors.surfaceAlt : '#FFFFFF',
                borderColor: isDark ? colors.border : '#D7ECFF',
              },
              disabled && styles.chipDisabled,
            ]}
            onPress={() => onSelectAction && onSelectAction(chip)}
            disabled={disabled}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={chip.label}
          >
            <Text
              style={[
                styles.chipText,
                { color: isDark ? colors.textPrimary : (colors.primaryDark || '#0D47A1') },
              ]}
              numberOfLines={1}
            >
              {chip.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Subtle left edge fade */}
      {canScrollLeft && (
        <LinearGradient
          colors={
            isDark
              ? ['rgba(8, 22, 39, 0.92)', 'rgba(8, 22, 39, 0)']
              : ['rgba(24, 123, 205, 0.92)', 'rgba(24, 123, 205, 0)']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.fadeLeft}
          pointerEvents="none"
        />
      )}

      {/* Subtle right edge fade */}
      {canScrollRight && (
        <LinearGradient
          colors={
            isDark
              ? ['rgba(8, 22, 39, 0)', 'rgba(8, 22, 39, 0.92)']
              : ['rgba(24, 123, 205, 0)', 'rgba(24, 123, 205, 0.92)']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.fadeRight}
          pointerEvents="none"
        />
      )}

      {/* Desktop-only subtle left scroll arrow */}
      {isDesktop && canScrollLeft && (
        <TouchableOpacity
          style={[
            styles.arrowButton,
            styles.arrowLeft,
            {
              backgroundColor: isDark ? colors.surface : '#FFFFFF',
              borderColor: isDark ? colors.border : '#D7ECFF',
            },
          ]}
          onPress={() => handleScrollBy(-180)}
          accessibilityRole="button"
          accessibilityLabel="Scroll quick actions left"
          activeOpacity={0.8}
        >
          <Text style={[styles.arrowText, { color: isDark ? colors.textPrimary : colors.primary }]}>
            ‹
          </Text>
        </TouchableOpacity>
      )}

      {/* Desktop-only subtle right scroll arrow */}
      {isDesktop && canScrollRight && (
        <TouchableOpacity
          style={[
            styles.arrowButton,
            styles.arrowRight,
            {
              backgroundColor: isDark ? colors.surface : '#FFFFFF',
              borderColor: isDark ? colors.border : '#D7ECFF',
            },
          ]}
          onPress={() => handleScrollBy(180)}
          accessibilityRole="button"
          accessibilityLabel="Scroll quick actions right"
          activeOpacity={0.8}
        >
          <Text style={[styles.arrowText, { color: isDark ? colors.textPrimary : colors.primary }]}>
            ›
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default AssistantQuickActions;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: '100%',
    position: 'relative',
    marginTop: 4,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  containerMobile: {
    paddingVertical: 4,
    marginBottom: 4,
  },
  containerDesktop: {
    paddingVertical: 4,
    marginBottom: 6,
  },
  scroll: {
    width: '100%',
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
    ...Platform.select({
      web: {
        scrollBehavior: 'smooth',
      },
    }),
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...createShadow({
      color: '#0D47A1',
      elevation: 2,
      opacity: 0.05,
      radius: 4,
      offset: { width: 0, height: 1 },
    }),
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  fadeLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 28,
    zIndex: 5,
  },
  fadeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 28,
    zIndex: 5,
  },
  arrowButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -13,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    ...createShadow({
      color: '#07131F',
      elevation: 3,
      opacity: 0.15,
      radius: 4,
      offset: { width: 0, height: 2 },
    }),
  },
  arrowLeft: {
    left: 6,
  },
  arrowRight: {
    right: 6,
  },
  arrowText: {
    fontSize: 16,
    fontWeight: 'bold',
    lineHeight: 18,
    textAlign: 'center',
  },
});
