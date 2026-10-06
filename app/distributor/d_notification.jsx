import React, { useMemo } from 'react';
import { ActivityIndicator, Animated, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BLUETAP_COLORS, BLUETAP_LAYOUT } from '../../constants/bluetapTheme';
import { createPortalStyleSheet, useBlueTapTheme } from '../../components/BlueTapTheme';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import NotificationCard from '../../components/NotificationCard';
import NotificationBackButton from '../../components/NotificationBackButton';
import { USER_PORTAL_BOTTOM_CONTENT_INSET, USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import BlueTapHeader from '../../components/BlueTapHeader';
import DistributorPortalBackground from '../../components/DistributorPortalBackground';
import RequestDetailsModal from '../../components/RequestDetailsModal';
import {
  formatDistributorOrderDate,
  normalizeDistributorOrderStatus,
  useAssignedDistributorOrders,
} from '../../services/distributorOrders';
import { formatNotificationTime, getOrderLifecycleTimestamp, parseTimestamp } from '../../services/notificationTimestamp';
import { useRoleNotifications } from '../../components/RoleNotifications';
import { useModerationNotices } from '../../components/ModerationNotices';
import AnimatedPresenceItem from '../../components/AnimatedPresenceItem';
import { useAnimatedPresenceList } from '../../components/useAnimatedPresenceList';
import useNotificationPageMotion, { NOTIFICATION_LIST_MOTION_DURATION_MS } from '../../components/useNotificationPageMotion';
import useSingleFlightNavigation from '../../components/useSingleFlightNavigation';
import { resolveOrderFromList } from '../../services/orderNormalizer';

const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const formatWhen = (order) => {
  const ts = getOrderLifecycleTimestamp(order);
  return formatNotificationTime(ts);
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
  const { colors, isDark } = useBlueTapTheme();
  const router = useRouter();
  const { replaceOnce } = useSingleFlightNavigation();
  const params = useLocalSearchParams();
  const { orders, loading, error, refresh } = useAssignedDistributorOrders();
  const { events, markAllSeen, markSeen } = useRoleNotifications();
  const { openNotice } = useModerationNotices();
  const [selectedOrderId, setSelectedOrderId] = React.useState(null);
  const openedParamRef = React.useRef('');
  const pageMotion = useNotificationPageMotion(() => router.back());
  const notificationEntries = useAnimatedPresenceList(events, (event) => event.id, NOTIFICATION_LIST_MOTION_DURATION_MS);

  React.useEffect(() => { if (events.length) markAllSeen(); }, [events, markAllSeen]);
  React.useEffect(() => {
    const orderId = Array.isArray(params.orderId) ? params.orderId[0] : params.orderId;
    if (!orderId || openedParamRef.current === orderId) return;
    const resolved = resolveOrderFromList(orderId, orders);
    if (!resolved) return;
    openedParamRef.current = String(orderId);
    setSelectedOrderId(String(orderId));
  }, [orders, params.orderId]);
  const selectedOrder = useMemo(
    () => (selectedOrderId ? resolveOrderFromList(orders.find((order) => String(order.id || order.sourceId) === String(selectedOrderId)) || selectedOrderId, orders) : null),
    [orders, selectedOrderId]
  );

  return (
    <DistributorPortalBackground>
    <Animated.View style={[styles.motionRoot, pageMotion.style]}>
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safe}>
      <BlueTapHeader notificationPath="/distributor/d_notification" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>NOTIFICATION</Text>
            <Text style={styles.title}>Notifications</Text>
          </View>
          <NotificationBackButton colors={colors} inverse onPress={pageMotion.goBack} />
        </View>
        <Text style={styles.subtitle}>Updates generated from your assigned BlueTap deliveries.</Text>

        {loading ? (
          <View style={styles.state}>
            <ActivityIndicator color={BLUETAP_COLORS.primary} />
            <Text style={styles.stateText}>Loading delivery updates…</Text>
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
          <BlueTapEmptyState
            variant="notifications"
            title="No Assignment Notifications Yet"
            description="Updates for deliveries assigned to you will appear here."
            actionLabel="View Assigned Requests"
            onAction={() => replaceOnce('/distributor/d_requests')}
          />
        ) : (
          <View style={styles.list}>
            {notificationEntries.map((entry, index) => (
              <AnimatedPresenceItem key={entry.id} phase={entry.phase} delay={Math.min(index * 30, 120)}>
              <NotificationCard
                accessibilityLabel={entry.item.message}
                colors={colors}
                dark={isDark}
                status={entry.item.status}
                time={formatNotificationTime(entry.item.at)}
                message={entry.item.message}
                onPress={() => { markSeen([entry.item.id]); if (entry.item.noticeId) openNotice(entry.item.noticeId); else setSelectedOrderId(entry.item.orderId); }}
              />
              </AnimatedPresenceItem>
            ))}
          </View>
        )}
      </ScrollView>
      <RequestDetailsModal
        visible={selectedOrder !== null}
        request={selectedOrder}
        onClose={() => setSelectedOrderId(null)}
      />
    </SafeAreaView>
    </Animated.View>
    </DistributorPortalBackground>
  );
}

const styles = createPortalStyleSheet({
  motionRoot: { flex: 1, minWidth: 0 },
  safe: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'transparent',
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
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headingCopy: { flex: 1, minWidth: 0 },
  eyebrow: {
    color: BLUETAP_COLORS.white,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    color: BLUETAP_COLORS.white,
    fontSize: 28,
    fontWeight: '900',
    marginTop: 5,
  },
  subtitle: {
    color: BLUETAP_COLORS.white,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 20,
  },
  list: {
    gap: 10,
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
