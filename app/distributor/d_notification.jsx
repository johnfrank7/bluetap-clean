import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { BLUETAP_COLORS, BLUETAP_LAYOUT } from '../../constants/bluetapTheme';
import { createPortalStyleSheet, useBlueTapTheme } from '../../components/BlueTapTheme';
import { USER_PORTAL_BOTTOM_CONTENT_INSET, USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import {
  formatDistributorOrderDate,
  normalizeDistributorOrderStatus,
  useAssignedDistributorOrders,
} from '../../services/distributorOrders';

const asDate = (value) =>
  value instanceof Date
    ? value
    : value?.toDate?.() || (value?.seconds ? new Date(value.seconds * 1000) : value ? new Date(value) : null);

const formatWhen = (value) => {
  const date = asDate(value);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Time unavailable';
};

const messageFor = (order) => {
  const requestId = order.requestId || order.id || 'your order';
  const customer = order.requesterName || order.requester || 'the customer';
  const status = normalizeDistributorOrderStatus(order.status);
  const history = Array.isArray(order.assignmentHistory) ? order.assignmentHistory : [];
  const latestAssignment = history[history.length - 1] || null;

  if (latestAssignment?.event === 'DISTRIBUTOR_REASSIGNED') {
    return `Delivery #${requestId} has been reassigned to you.`;
  }
  if (status === 'delivery failed' || status === 'delivery_failed') {
    return `Delivery #${requestId} failed: ${order.failureReason || 'Delivery issue reported'}. Needs reschedule.`;
  }
  if (status === 'delivered') {
    return `Delivery #${requestId} has been delivered to ${customer}.`;
  }
  if (status === 'out for delivery' || status === 'out_for_delivery') {
    return `Delivery #${requestId} is out for delivery to ${customer}.`;
  }
  if (status === 'accepted') {
    return `You accepted delivery #${requestId} for ${customer}.`;
  }
  if (status === 'scheduled') {
    const timeLabel = formatDistributorOrderDate(order.scheduledAt || order.expectedDeliveryDate);
    return `Delivery #${requestId} is scheduled for ${timeLabel}.`;
  }
  return `Delivery #${requestId} has been assigned to you.`;
};

export default function DistributorNotification() {
  useBlueTapTheme();
  const router = useRouter();
  const { orders, loading, error, refresh } = useAssignedDistributorOrders();

  const events = useMemo(
    () =>
      orders.map((order) => ({
        ...order,
        message: messageFor(order),
        when: order.updated_at || order.updatedAt || order.created_at || order.createdAt,
      })),
    [orders]
  );

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>\u2039 Back</Text>
        </TouchableOpacity>

        <Text style={styles.eyebrow}>NOTIFICATION</Text>
        <Text style={styles.title}>Notifications</Text>
        <Text style={styles.subtitle}>Updates generated from your assigned BlueTap deliveries.</Text>

        {loading ? (
          <View style={styles.state}>
            <ActivityIndicator color={BLUETAP_COLORS.primary} />
            <Text style={styles.stateText}>Loading delivery updates\u2026</Text>
          </View>
        ) : error ? (
          <View style={styles.state}>
            <Text style={styles.error}>Notifications unavailable</Text>
            <Text style={styles.stateText}>{error}</Text>
            <TouchableOpacity onPress={refresh} style={styles.button}>
              <Text style={styles.buttonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : events.length === 0 ? (
          <View style={styles.state}>
            <Text style={styles.emptyTitle}>No assignment notifications yet</Text>
            <Text style={styles.stateText}>Updates for deliveries assigned to you will appear here.</Text>
            <TouchableOpacity onPress={() => router.replace('/distributor/d_requests')} style={styles.button}>
              <Text style={styles.buttonText}>View Assigned Requests</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.list}>
            {events.map((event) => {
              const isPending = ['pending', 'distributor assigned', 'distributor_assigned'].includes(
                normalizeDistributorOrderStatus(event.status)
              );
              const destination = isPending ? '/distributor/d_requests' : '/distributor/d_scheduled_requests';
              return (
                <TouchableOpacity
                  key={event.id}
                  onPress={() => router.push(destination)}
                  style={styles.card}
                >
                  <View style={styles.dot} />
                  <View style={styles.cardBody}>
                    <Text style={styles.message}>{event.message}</Text>
                    <Text style={styles.time}>{formatWhen(event.when)}</Text>
                  </View>
                  <Text style={styles.chevron}>\u203A</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = createPortalStyleSheet({
  safe: {
    flex: 1,
    minWidth: 0,
    backgroundColor: BLUETAP_COLORS.background,
  },
  content: {
    width: '100%',
    maxWidth: USER_PORTAL_LAYOUT.maxWidth,
    minWidth: 0,
    alignSelf: 'center',
    paddingHorizontal: USER_PORTAL_LAYOUT.gutter,
    paddingTop: 20,
    paddingBottom: USER_PORTAL_BOTTOM_CONTENT_INSET,
  },
  back: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    marginBottom: 10,
  },
  backText: {
    color: BLUETAP_COLORS.primary,
    fontWeight: '900',
  },
  eyebrow: {
    color: BLUETAP_COLORS.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    color: BLUETAP_COLORS.textPrimary,
    fontSize: 28,
    fontWeight: '900',
    marginTop: 5,
  },
  subtitle: {
    color: BLUETAP_COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 20,
  },
  list: {
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: BLUETAP_COLORS.surface,
    borderWidth: 1,
    borderColor: BLUETAP_COLORS.border,
    borderRadius: BLUETAP_LAYOUT.radius.lg,
    padding: 16,
    ...BLUETAP_LAYOUT.shadow,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: BLUETAP_COLORS.primary,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  message: {
    color: BLUETAP_COLORS.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  time: {
    color: BLUETAP_COLORS.muted,
    fontSize: 11,
    marginTop: 6,
  },
  chevron: {
    color: BLUETAP_COLORS.primary,
    fontSize: 24,
  },
  state: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BLUETAP_COLORS.surface,
    borderWidth: 1,
    borderColor: BLUETAP_COLORS.border,
    borderRadius: BLUETAP_LAYOUT.radius.lg,
    padding: 24,
  },
  stateText: {
    color: BLUETAP_COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 8,
  },
  emptyTitle: {
    color: BLUETAP_COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
  error: {
    color: BLUETAP_COLORS.danger,
    fontSize: 16,
    fontWeight: '900',
  },
  button: {
    backgroundColor: BLUETAP_COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 16,
  },
  buttonText: {
    color: '#FFF',
    fontWeight: '900',
  },
});
