import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRequesterData } from '../../components/RoleDataProviders';
import { BLUETAP_COLORS, BLUETAP_LAYOUT } from '../../constants/bluetapTheme';
import { createPortalStyleSheet, useBlueTapTheme } from '../../components/BlueTapTheme';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import NotificationCard from '../../components/NotificationCard';
import NotificationBackButton from '../../components/NotificationBackButton';
import RequestDetailsModal from '../../components/RequestDetailsModal';
import { USER_PORTAL_BOTTOM_CONTENT_INSET, USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import { normalizeRequesterOrderStatus, requesterOrderStatusLabel } from '../../constants/requesterOrderStatus';
import { refreshRequesterRequests } from '../../services/requests';
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
  const id = order.request_id || order.requestId || order.id;
  const provider = order.branchNameSnapshot || order.water_station || 'your provider';
  const status = normalizeRequesterOrderStatus(order.status);
  if (order.transferState === 'accepted') return `Order ${id} was transferred to ${provider} and is awaiting distributor assignment.`;
  if (status === 'outside radius pending approval') return `Order ${id} is waiting for branch approval.`;
  if (status === 'awaiting distributor assignment') return `Order ${id} was approved and is waiting for distributor assignment.`;
  if (status === 'distributor assigned') return `A distributor has been assigned to your order ${id}.`;
  if (status === 'branch transfer pending') return `Order ${id} has a branch transfer in progress.`;
  if (status === 'declined outside service area') return `Order ${id} was declined because the delivery location is outside the branch’s service area.`;
  return status === 'pending'
    ? `Order ${id} was sent to ${provider} and is awaiting review.`
    : `Order ${id}: ${requesterOrderStatusLabel(order.status)}. Provider: ${provider}.`;
};

export default function RequesterNotification() {
  const { colors, isDark } = useBlueTapTheme();
  const router = useRouter();
  const { navigateOnce } = useSingleFlightNavigation();
  const params = useLocalSearchParams();
  const { orders, branches, loading, error: orderError, uid, readiness } = useRequesterData();
  const { events, markAllSeen, markSeen } = useRoleNotifications();
  const { openNotice } = useModerationNotices();
  const [retryError, setRetryError] = useState('');
  const error = orderError || retryError;
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const openedParamRef = useRef('');
  const pageMotion = useNotificationPageMotion(() => router.back());
  const notificationEntries = useAnimatedPresenceList(events, (event) => event.id, NOTIFICATION_LIST_MOTION_DURATION_MS);

  const retry = async () => {
    if (!uid || readiness !== 'READY') return;
    setRetryError('');
    try {
      await refreshRequesterRequests(uid);
    } catch (nextError) {
      setRetryError(nextError.message || 'Orders are temporarily unavailable.');
    }
  };

  useEffect(() => { if (events.length) markAllSeen(); }, [events, markAllSeen]);
  useEffect(() => {
    const orderId = Array.isArray(params.orderId) ? params.orderId[0] : params.orderId;
    if (!orderId || openedParamRef.current === orderId) return;
    const resolved = resolveOrderFromList(orderId, orders);
    if (!resolved) return;
    openedParamRef.current = String(orderId);
    setSelectedOrderId(String(orderId));
  }, [orders, params.orderId]);
  const liveSelectedOrder = React.useMemo(
    () => (selectedOrderId ? resolveOrderFromList(orders.find((order) => String(order.id) === String(selectedOrderId)) || selectedOrderId, orders) : null),
    [orders, selectedOrderId]
  );

  return (
    <LinearGradient
      colors={isDark ? [colors.background, colors.header] : [colors.primary, colors.primaryLight]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
    >
      <Animated.View style={[styles.motionRoot, pageMotion.style]}>
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>REQUESTER</Text>
            <Text style={styles.title}>Notifications</Text>
          </View>
          <NotificationBackButton colors={colors} inverse onPress={pageMotion.goBack} />
        </View>
        <Text style={styles.subtitle}>Updates generated from your real BlueTap orders.</Text>

        {loading ? (
          <View style={styles.state}>
            <ActivityIndicator color={BLUETAP_COLORS.primary} />
            <Text style={styles.stateText}>Loading updates…</Text>
          </View>
        ) : error ? (
          <View style={styles.state}>
            <Text style={styles.error}>Notifications unavailable</Text>
            <Text style={styles.stateText}>{error}</Text>
            <TouchableOpacity onPress={retry} style={styles.button}>
              <Text style={styles.buttonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : events.length === 0 ? (
          <BlueTapEmptyState
            title="No Notifications Yet"
            description="Order status updates will appear here."
            actionLabel="Place an Order"
            onAction={() => navigateOnce('/requester/requestform')}
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
                onPress={() => {
                  markSeen([entry.item.id]);
                  if (entry.item.noticeId) { openNotice(entry.item.noticeId); return; }
                  if (entry.item.orderId) {
                    setSelectedOrderId(entry.item.orderId);
                  } else {
                    // Graceful fallback: no order data resolvable
                    navigateOnce('/requester/r_request');
                  }
                }}
              />
              </AnimatedPresenceItem>
            ))}
          </View>
        )}
        </ScrollView>
        <RequestDetailsModal
          visible={liveSelectedOrder !== null}
          onClose={() => setSelectedOrderId(null)}
          request={liveSelectedOrder}
          branches={branches}
        />
      </SafeAreaView>
      </Animated.View>
    </LinearGradient>
  );
}

const styles = createPortalStyleSheet({
  gradient: {
    flex: 1,
  },
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
    gap: 12,
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
