import React, { useMemo } from 'react';
import { ActivityIndicator, View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BlueTapHeader from '../../components/BlueTapHeader';
import { createPortalStyleSheet, useBlueTapTheme } from '../../components/BlueTapTheme';
import { USER_PORTAL_BOTTOM_CONTENT_INSET, USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import { normalizeDistributorOrderStatus, useAssignedDistributorOrders } from '../../services/distributorOrders';

const notificationMessage = (order) => {
  const requestId = order.requestId || order.id || 'your order';
  const history = Array.isArray(order.assignmentHistory) ? order.assignmentHistory : [];
  const latestAssignment = history[history.length - 1] || null;
  if (latestAssignment?.event === 'DISTRIBUTOR_REASSIGNED') return `Request #${requestId} has been reassigned to you.`;
  if (normalizeDistributorOrderStatus(order.status) === 'delivered') return `Request #${requestId} has been delivered to ${order.requesterName || 'the requester'}.`;
  return `Request #${requestId} has been assigned to you.`;
};

export default function DistributorNotification() {
  useBlueTapTheme();
  const router = useRouter();
  const { orders, loading, error, refresh } = useAssignedDistributorOrders();
  const notifications = useMemo(() => orders.map((order) => ({ id: order.id, message: notificationMessage(order) })), [orders]);

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <BlueTapHeader
        notificationPath="/distributor/d_notification"
        rightContent={
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backIcon}>{'\u2190'}</Text>
          </TouchableOpacity>
        }
      />

      <View style={styles.phoneWrapper}>
        {/* Main content - light blue border card */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={styles.cardTitle}>NOTIFICATION</Text>
            <View style={styles.titleDivider} />
            <View style={styles.cardBody}>
              {loading ? <View style={styles.state}><ActivityIndicator color="#187BCD" /><Text style={styles.messageText}>Loading assignment updates...</Text></View>
                : error ? <View style={styles.state}><Text style={styles.messageText}>Notifications are unavailable.</Text><Text style={styles.errorText}>{error}</Text><TouchableOpacity onPress={refresh}><Text style={styles.retryText}>Try Again</Text></TouchableOpacity></View>
                  : notifications.length === 0 ? <View style={styles.state}><Text style={styles.messageText}>No assignment notifications yet.</Text><Text style={styles.emptyText}>Updates for deliveries assigned to you will appear here.</Text></View>
                    : notifications.map((notification, index) => <View key={notification.id}><Text style={styles.messageText}>{notification.message}</Text>{index < notifications.length - 1 && <View style={styles.divider} />}</View>)}
            </View>
          </View>

        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = createPortalStyleSheet({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  phoneWrapper: {
    flex: 1,
    width: '100%',
    maxWidth: USER_PORTAL_LAYOUT.maxWidth,
    minWidth: 0,
    alignSelf: 'center',
  },
  backIcon: {
    fontSize: 24,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  scrollContent: {
    paddingHorizontal: USER_PORTAL_LAYOUT.gutter,
    paddingTop: 20,
    paddingBottom: USER_PORTAL_BOTTOM_CONTENT_INSET,
  },
  card: {
    borderWidth: 2,
    borderColor: '#90CAF9',
    borderRadius: 8,
    overflow: 'hidden',
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#187BCD',
    letterSpacing: 1,
    textAlign: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  titleDivider: {
    height: 1,
    backgroundColor: '#90CAF9',
  },
  cardBody: {
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  messageText: {
    fontSize: 14,
    color: '#187BCD',
    lineHeight: 20,
  },
  boldId: {
    fontWeight: 'bold',
    color: '#1565C0',
  },
  divider: {
    height: 1,
    backgroundColor: '#90CAF9',
    marginTop: 14,
  },
  state: { alignItems: 'center', paddingVertical: 4 },
  errorText: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: 'center' },
  emptyText: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: 'center' },
  retryText: { color: '#187BCD', fontSize: 13, fontWeight: 'bold', marginTop: 10 },
});
