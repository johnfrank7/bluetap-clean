import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRequesterData } from '../../components/RoleDataProviders';
import { BLUETAP_COLORS, BLUETAP_LAYOUT } from '../../constants/bluetapTheme';
import { createPortalStyleSheet, useBlueTapTheme } from '../../components/BlueTapTheme';
import SoftStatusBadge from '../../components/SoftStatusBadge';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import RequestDetailsModal from '../../components/RequestDetailsModal';
import { USER_PORTAL_BOTTOM_CONTENT_INSET, USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import { normalizeRequesterOrderStatus, requesterOrderStatusLabel } from '../../constants/requesterOrderStatus';
import { refreshRequesterRequests } from '../../services/requests';
import { formatNotificationTime, getOrderLifecycleTimestamp, parseTimestamp } from '../../services/notificationTimestamp';
import { useRoleNotifications } from '../../components/RoleNotifications';
import { useModerationNotices } from '../../components/ModerationNotices';

const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const formatWhen = (order) => {
  const ts = getOrderLifecycleTimestamp(order);
  return formatNotificationTime(ts);
};

const getNotificationTone = (statusRaw) => {
  const s = String(statusRaw || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (['delivered', 'completed'].includes(s)) {
    return { dot: '#10B981', border: 'rgba(16, 185, 129, 0.3)' }; // green
  }
  if (['delivery_failed', 'cancelled', 'canceled', 'declined', 'declined_outside_service_area'].includes(s)) {
    return { dot: '#EF4444', border: 'rgba(239, 68, 68, 0.3)' }; // red
  }
  if (['out_for_delivery', 'scheduled', 'accepted'].includes(s)) {
    return { dot: '#0284C7', border: 'rgba(2, 132, 199, 0.3)' }; // blue/cyan
  }
  return { dot: '#F59E0B', border: 'rgba(245, 158, 11, 0.3)' }; // amber
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
  useBlueTapTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { orders, loading, error: orderError, uid, readiness } = useRequesterData();
  const { events, markAllSeen, markSeen } = useRoleNotifications();
  const { openNotice } = useModerationNotices();
  const [retryError, setRetryError] = useState('');
  const error = orderError || retryError;
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const openedParamRef = useRef('');

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
    if (!orderId || openedParamRef.current === orderId || !orders.some((order) => String(order.id) === String(orderId))) return;
    openedParamRef.current = String(orderId);
    setSelectedOrderId(String(orderId));
  }, [orders, params.orderId]);
  const liveSelectedOrder = selectedOrderId ? orders.find((order) => String(order.id) === String(selectedOrderId)) || null : null;

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.eyebrow}>REQUESTER</Text>
        <Text style={styles.title}>Notifications</Text>
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
            onAction={() => router.push('/requester/requestform')}
          />
        ) : (
          <View style={styles.list}>
            {events.map((event) => {
              const tone = getNotificationTone(event.status);
              return (
                <TouchableOpacity
                  key={event.id}
                  onPress={() => {
                    markSeen([event.id]);
                    if (event.noticeId) { openNotice(event.noticeId); return; }
                    if (event.orderId) {
                      setSelectedOrderId(event.orderId);
                    } else {
                      // Graceful fallback: no order data resolvable
                      router.push('/requester/r_request');
                    }
                  }}
                  style={[styles.card, { borderLeftWidth: 4, borderLeftColor: tone.dot }]}
                >
                  <View style={[styles.dot, { backgroundColor: tone.dot }]} />
                  <View style={styles.cardBody}>
                    <View style={styles.cardHeaderRow}>
                      <SoftStatusBadge status={event.status} />
                      <Text style={styles.time}>{formatNotificationTime(event.at)}</Text>
                    </View>
                    <Text style={styles.message}>{event.message}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
      <RequestDetailsModal
        visible={liveSelectedOrder !== null}
        onClose={() => setSelectedOrderId(null)}
        request={liveSelectedOrder}
      />
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
    gap: 12,
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
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
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
