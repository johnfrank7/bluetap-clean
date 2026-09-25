import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BlueTapHeader from '../../components/BlueTapHeader';
import RequestDetailsModal from '../../components/RequestDetailsModal';
import SoftStatusBadge from '../../components/SoftStatusBadge';
import { createShadow } from '../../components/shadowStyles';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import PortalSwipeContainer, { DISTRIBUTOR_TABS } from '../../components/PortalSwipeContainer';
import { createPortalStyleSheet, useBlueTapTheme } from '../../components/BlueTapTheme';
import { USER_PORTAL_BOTTOM_CONTENT_INSET, USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import { BLUETAP_COLORS } from '../../constants/bluetapTheme';
import {
  normalizeDistributorOrderStatus,
  toDistributorScreenOrder,
  useAssignedDistributorOrders,
} from '../../services/distributorOrders';
import { formatDisplayUniqueId } from '../../services/uniqueIds';

const BLUE = BLUETAP_COLORS.primary;
const BLUE_LIGHT = BLUETAP_COLORS.primarySoft;
const CARD_BORDER = BLUETAP_COLORS.border;
const TEXT_MUTED = BLUETAP_COLORS.textSecondary;
const TEXT_DARK = BLUETAP_COLORS.textPrimary;

const HISTORY_STATUSES = new Set(['delivered', 'cancelled', 'canceled', 'declined']);

const getAmountNumber = (amount) =>
  Number(String(amount || '').replace(/[^\d.]/g, '')) || 0;

const getQuantityNumber = (quantity) => {
  const match = String(quantity || '').match(/\d+(\.\d+)?/);
  return Number(match?.[0] || 0);
};

const getDetailsRequestData = (request) => {
  if (!request) return null;

  const totalAmount = getAmountNumber(request.amountPaid);
  const quantity = getQuantityNumber(request.quantity);
  const unitPrice = quantity > 0 ? totalAmount / quantity : totalAmount;

  return {
    requestId: request.id,
    status: request.status || 'Delivered',
    orderDate: request.scheduledDateTime,
    deliveryDate: request.deliveredDateTime,
    product: request.productName,
    containerType: request.container,
    quantity: request.quantity,
    totalAmount,
    waterStation: 'Not set',
    paymentMethod: 'Not set',
    requesterName: request.requester,
    requesterUniqueId: formatDisplayUniqueId(
      request.requesterId ||
        request.requester_unique_id ||
        request.requesterUniqueId,
      'Not assigned'
    ),
    customerName: request.requester,
    distributorName: request.distributor || request.distributor_name || '',
    distributorUniqueId: formatDisplayUniqueId(
      request.distributorId ||
        request.distributor_unique_id ||
        request.distributorUniqueId,
      ''
    ),
    contactNumber: request.contact,
    deliveryAddress: request.address,
    items: [
      {
        id: request.id,
        productName: request.productName,
        quantity: request.quantity,
        unitPrice,
        subtotal: totalAmount,
      },
    ],
    grandTotalAmount: totalAmount,
  };
};

const HistoryRequestCard = ({ request, onViewDetails }) => {
  return (
    <View style={styles.requestCard}>
      <View style={styles.requestCardHeader}>
        <Text style={styles.requestId}>Request ID: {request.id}</Text>
        <SoftStatusBadge status={request.status} />
      </View>

      <View style={styles.compactInfoGrid}>
        <View style={styles.compactInfoColumn}>
          <Text style={styles.compactLabel}>Customer Name</Text>
          <Text style={styles.compactPrimaryValue} numberOfLines={1}>
            {request.requester}
          </Text>

          <Text style={[styles.compactLabel, styles.compactLabelGap]}>
            Requester ID
          </Text>
          <Text style={styles.compactValue} numberOfLines={1}>
            {formatDisplayUniqueId(
              request.requesterId ||
                request.requester_unique_id ||
                request.requesterUniqueId,
              'Not assigned'
            )}
          </Text>

          <Text style={[styles.compactLabel, styles.compactLabelGap]}>
            Contact Number
          </Text>
          <Text style={styles.compactValue} numberOfLines={1}>
            {request.contact}
          </Text>
        </View>

        <View style={styles.compactInfoColumn}>
          <Text style={styles.compactLabel}>Product Ordered</Text>
          <Text style={styles.compactPrimaryValue} numberOfLines={1}>
            {request.productName}
          </Text>

          <Text style={[styles.compactLabel, styles.compactLabelGap]}>
            Distributor ID
          </Text>
          <Text style={styles.compactValue} numberOfLines={1}>
            {formatDisplayUniqueId(
              request.distributorId ||
                request.distributor_unique_id ||
                request.distributorUniqueId,
              'Not assigned'
            )}
          </Text>

          <Text style={[styles.compactLabel, styles.compactLabelGap]}>
            Container Type
          </Text>
          <Text style={styles.compactValue} numberOfLines={1}>
            {request.container}
          </Text>
        </View>
      </View>

      <View style={styles.fullWidthInfoBlock}>
        <Text style={styles.compactLabel}>Delivery Address</Text>
        <Text style={styles.compactAddressValue} numberOfLines={2}>
          {request.address}
        </Text>

        <Text style={[styles.compactLabel, styles.compactLabelGap]}>
          Delivered Date & Time
        </Text>
        <Text style={styles.compactValue} numberOfLines={1}>
          {request.deliveredDateTime}
        </Text>
      </View>

      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.fullWidthActionButton}
        onPress={() => onViewDetails(request)}
      >
        <Text style={styles.secondaryActionText}>View Details</Text>
      </TouchableOpacity>
    </View>
  );
};

export default function DistributorHistory() {
  useBlueTapTheme();
  const router = useRouter();
  const [selectedRequest, setSelectedRequest] = useState(null);
  const { orders, loading, error, refresh } = useAssignedDistributorOrders();
  const historyRequests = useMemo(() => orders
    .map(toDistributorScreenOrder)
    .filter((request) => HISTORY_STATUSES.has(normalizeDistributorOrderStatus(request.status))), [orders]);
  const selectedDetailsRequest = getDetailsRequestData(selectedRequest);

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <BlueTapHeader notificationPath="/distributor/d_notification" />

      <PortalSwipeContainer tabs={DISTRIBUTOR_TABS} currentRoute="/distributor/d_history">
        <View style={styles.phoneWrapper}>
          <View style={styles.fixedHeaderArea}>
            <Text style={styles.pageTitle}>SCHEDULE</Text>
            <Text style={styles.subtitle}>Request History</Text>

          <View style={styles.scheduleTabs}>
            <TouchableOpacity
              style={styles.scheduleTab}
              activeOpacity={0.85}
              onPress={() => router.replace('/distributor/d_scheduled_requests')}
            >
              <Text style={styles.scheduleTabText}>Scheduled</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.scheduleTab, styles.scheduleTabActive]}
              activeOpacity={0.85}
              onPress={() => router.replace('/distributor/d_history')}
            >
              <Text style={[styles.scheduleTabText, styles.scheduleTabTextActive]}>
                History
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >

          {loading ? <View style={styles.emptyCard}><ActivityIndicator color={BLUE} /><Text style={styles.emptyText}>Loading assigned history...</Text></View>
            : error ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>History unavailable.</Text><Text style={styles.emptyText}>{error}</Text><TouchableOpacity onPress={refresh} style={styles.fullWidthActionButton}><Text style={styles.secondaryActionText}>Try Again</Text></TouchableOpacity></View>
              : historyRequests.length === 0 ? (
                <BlueTapEmptyState
                  title="No Delivery History"
                  description="Completed assigned deliveries will appear here."
                />
              )
                : historyRequests.map((request) => (
            <HistoryRequestCard
              key={request.sourceId}
              request={request}
              onViewDetails={setSelectedRequest}
            />
          ))}
        </ScrollView>
      </View>
    </PortalSwipeContainer>

      <RequestDetailsModal
        visible={!!selectedRequest}
        onClose={() => setSelectedRequest(null)}
        request={selectedDetailsRequest}
      />
    </SafeAreaView>
  );
}

const styles = createPortalStyleSheet({
  container: {
    flex: 1,
    backgroundColor: BLUETAP_COLORS.background,
  },
  phoneWrapper: {
    width: '100%',
    maxWidth: USER_PORTAL_LAYOUT.maxWidth,
    minWidth: 0,
    alignSelf: 'center',
    flex: 1,
  },
  fixedHeaderArea: {
    paddingHorizontal: USER_PORTAL_LAYOUT.gutter,
    paddingTop: 16,
    paddingBottom: 4,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: USER_PORTAL_LAYOUT.gutter,
    paddingTop: 4,
    paddingBottom: USER_PORTAL_BOTTOM_CONTENT_INSET,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: BLUE,
    letterSpacing: 0,
  },
  subtitle: {
    fontSize: 14,
    color: BLUE,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 14,
  },
  scheduleTabs: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: BLUE,
    borderRadius: 13,
    overflow: 'hidden',
    marginBottom: 16,
  },
  scheduleTab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BLUETAP_COLORS.surface,
  },
  scheduleTabActive: {
    backgroundColor: BLUE,
  },
  scheduleTabText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: 'bold',
  },
  scheduleTabTextActive: {
    color: '#FFFFFF',
  },
  requestCard: {
    backgroundColor: BLUETAP_COLORS.surface,
    borderRadius: USER_PORTAL_LAYOUT.cardRadius,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    ...createShadow({
      color: '#0D47A1',
      elevation: 6,
      opacity: 0.12,
      radius: 10,
      offset: { width: 0, height: 5 },
    }),
  },
  requestCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BLUE_LIGHT,
  },
  requestId: {
    flex: 1,
    color: BLUE,
    fontSize: 15,
    fontWeight: 'bold',
  },
  compactInfoGrid: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 12,
  },
  compactInfoColumn: {
    flex: 1,
    minWidth: 0,
  },
  compactLabel: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  compactLabelGap: {
    marginTop: 10,
  },
  compactPrimaryValue: {
    color: BLUE,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: 'bold',
  },
  compactValue: {
    color: TEXT_DARK,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  fullWidthInfoBlock: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BLUE_LIGHT,
  },
  compactAddressValue: {
    color: TEXT_DARK,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  fullWidthActionButton: {
    minHeight: 44,
    borderWidth: 1.5,
    borderColor: '#2563EB',
    backgroundColor: BLUETAP_COLORS.surface,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  secondaryActionText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: BLUETAP_COLORS.surface,
    borderColor: CARD_BORDER,
    borderRadius: USER_PORTAL_LAYOUT.cardRadius,
    borderWidth: 1,
    marginTop: 2,
    padding: 24,
  },
  emptyTitle: { color: TEXT_DARK, fontSize: 16, fontWeight: 'bold' },
  emptyText: { color: TEXT_MUTED, fontSize: 13, lineHeight: 19, marginTop: 7, textAlign: 'center' },
});
