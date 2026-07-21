import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BlueTapHeader from '../../components/BlueTapHeader';
import RequestDetailsModal from '../../components/RequestDetailsModal';

const BLUE = '#187BCD';
const BLUE_LIGHT = '#E3F2FD';
const CARD_BORDER = '#D7ECFF';
const TEXT_MUTED = '#6F8EA8';
const TEXT_DARK = '#20384D';
const STATUS_COLORS = {
  pending: '#FBC02D',
  scheduled: '#2196F3',
  processing: '#FB8C00',
  outForDelivery: '#8E24AA',
  delivered: '#43A047',
  rejected: '#E53935',
  cancelled: '#757575',
};

const DISTRIBUTOR_NAME = 'Distributor';

const DASHBOARD_SUMMARY = [
  {
    label: 'Pending Requests',
    value: '2',
  },
  {
    label: 'Scheduled Today',
    value: '3',
  },
  {
    label: 'Delivered Today',
    value: '1',
  },
];

const CURRENT_REQUEST = {
  requestId: 'BT-01245',
  orderDate: 'Jan 25, 2026',
  customerName: 'Jeanne Ortega',
  contactNumber: '09123456789',
  deliveryAddress: 'Poblacion, Toledo City',
  productsOrdered: 'Purified Mineral Water',
  quantity: '3 Gallons',
  containerType: 'New Container',
  total_cost: 75,
  deliveryDate: 'Jan 25, 2026',
  status: 'Out for Delivery',
};

const STATUS_ACTIONS = {
  pending: 'Accept Request',
  accepted: 'Schedule Delivery',
  scheduled: 'Start Delivery',
  'out for delivery': 'Delivered',
};

const formatDashboardDate = (date) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);

const normalizeStatus = (status) =>
  (status || '').toString().trim().toLowerCase().replace(/[_-]+/g, ' ');

const getStatusActionLabel = (status) =>
  STATUS_ACTIONS[normalizeStatus(status)] || 'Update Request';

const STATUS_STYLES = {
  pending: {
    backgroundColor: STATUS_COLORS.pending,
    color: TEXT_DARK,
    label: '\u25CF Pending',
  },
  accepted: {
    backgroundColor: STATUS_COLORS.scheduled,
    color: '#FFFFFF',
    label: '\u25CF Scheduled',
  },
  scheduled: {
    backgroundColor: STATUS_COLORS.scheduled,
    color: '#FFFFFF',
    label: '\u25CF Scheduled',
  },
  processing: {
    backgroundColor: STATUS_COLORS.processing,
    color: '#FFFFFF',
    label: '\u25CF Processing',
  },
  'out for delivery': {
    backgroundColor: STATUS_COLORS.outForDelivery,
    color: '#FFFFFF',
    label: '\u25CF Out for Delivery',
  },
  delivered: {
    backgroundColor: STATUS_COLORS.delivered,
    color: '#FFFFFF',
    label: '\u25CF Delivered',
  },
  rejected: {
    backgroundColor: STATUS_COLORS.rejected,
    color: '#FFFFFF',
    label: '\u25CF Rejected',
  },
  cancelled: {
    backgroundColor: STATUS_COLORS.cancelled,
    color: '#FFFFFF',
    label: '\u25CF Cancelled',
  },
  canceled: {
    backgroundColor: STATUS_COLORS.cancelled,
    color: '#FFFFFF',
    label: '\u25CF Cancelled',
  },
};

const getStatusStyle = (status) => {
  const normalizedStatus = normalizeStatus(status);

  return (
    STATUS_STYLES[normalizedStatus] || {
      backgroundColor: BLUE_LIGHT,
      color: BLUE,
      label: status || 'Status',
    }
  );
};

const formatAmountDue = (amount) =>
  `\u20B1${Number(amount || 0).toFixed(2)}`;

const getNumericQuantity = (quantity) => {
  const match = String(quantity || '').match(/\d+(\.\d+)?/);
  const parsedQuantity = Number(match?.[0] ?? quantity);

  return Number.isFinite(parsedQuantity) ? parsedQuantity : 0;
};

const getDistributorRequestItems = (request) => {
  if (!request) return [];

  if (Array.isArray(request.items) && request.items.length > 0) {
    return request.items.map((item, index) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.product_price ?? item.unitPrice ?? 0);
      const subtotal = Number(
        item.line_total ?? item.subtotal ?? unitPrice * quantity
      );

      return {
        id: item.product_id || item.id || `${request.requestId}-${index}`,
        productName: item.product_name || item.productName || 'Product',
        quantity: Number.isFinite(quantity) ? quantity : item.quantity,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
        subtotal: Number.isFinite(subtotal) ? subtotal : 0,
      };
    });
  }

  const quantity = getNumericQuantity(request.quantity);
  const totalAmount = Number(request.total_cost || request.totalAmount || 0);
  const unitPrice = quantity > 0 ? totalAmount / quantity : totalAmount;

  return [
    {
      id: request.productId || request.requestId,
      productName: request.productsOrdered || request.productName || 'Product',
      quantity: request.quantity || quantity || 'Not set',
      unitPrice,
      subtotal: totalAmount,
    },
  ];
};

const getDistributorProductSummary = (request) => {
  const items = getDistributorRequestItems(request);

  if (items.length === 0) {
    return request?.productsOrdered || request?.productName || 'Not set';
  }

  return items.length > 1
    ? `${items[0].productName} +${items.length - 1} more`
    : items[0].productName;
};

const getDistributorTotalAmount = (request) => {
  const totalAmount = Number(request?.total_cost || request?.totalAmount || 0);

  if (Number.isFinite(totalAmount) && totalAmount > 0) {
    return totalAmount;
  }

  return getDistributorRequestItems(request).reduce(
    (sum, item) => sum + Number(item.subtotal || 0),
    0
  );
};

export default function DistributorDashboard() {
  const router = useRouter();
  const [detailsVisible, setDetailsVisible] = useState(false);
  const todayText = formatDashboardDate(new Date());
  const activeRequest = CURRENT_REQUEST;
  const primaryActionLabel = activeRequest
    ? getStatusActionLabel(activeRequest.status)
    : '';
  const activeStatusStyle = activeRequest
    ? getStatusStyle(activeRequest.status)
    : null;
  const detailsRequestData = activeRequest
    ? {
        requestId: activeRequest.requestId,
        status: activeRequest.status,
        orderDate: activeRequest.orderDate || 'Not set',
        deliveryDate: activeRequest.deliveryDate || 'Not set',
        product: getDistributorProductSummary(activeRequest),
        containerType: activeRequest.containerType || activeRequest.container || 'Not set',
        quantity: activeRequest.quantity || 'Not set',
        totalAmount: getDistributorTotalAmount(activeRequest),
        waterStation: activeRequest.waterStation || activeRequest.water_station || 'Not set',
        paymentMethod:
          activeRequest.paymentMethod ||
          activeRequest.payment_method ||
          'Not set',
        customerName: activeRequest.customerName || activeRequest.requester_name || 'Not set',
        contactNumber: activeRequest.contactNumber || activeRequest.contact_number || 'Not set',
        deliveryAddress:
          activeRequest.deliveryAddress || activeRequest.address || 'Not set',
        items: getDistributorRequestItems(activeRequest),
        grandTotalAmount: getDistributorTotalAmount(activeRequest),
      }
    : null;

  const handleCurrentRequestAction = () => {
    if (!activeRequest) return;

    if (normalizeStatus(activeRequest.status) === 'pending') {
      router.replace('/distributor/d_requests');
      return;
    }

    router.replace('/distributor/d_scheduled_requests');
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <BlueTapHeader
        notificationPath="/distributor/d_notification"
      />

      <View style={styles.phoneWrapper}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.welcomeSection}>
            <Text style={styles.welcomeText}>WELCOME!</Text>
            <Text style={styles.greetingText}>
              Good Morning, {DISTRIBUTOR_NAME}
            </Text>
            <Text style={styles.dateText}>{todayText}</Text>
          </View>

          <View style={styles.summaryRow}>
            {DASHBOARD_SUMMARY.map((item) => (
              <View key={item.label} style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{item.value}</Text>
                <Text style={styles.summaryLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.currentRequestSection}>
            <Text style={styles.sectionTitle}>Current Request</Text>

            {activeRequest ? (
              <View style={styles.currentRequestCard}>
                <View style={styles.requestCardHeader}>
                  <View style={styles.requestTitleBlock}>
                    <Text style={styles.requestId}>
                      Request ID: {activeRequest.requestId}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusPill,
                      { backgroundColor: activeStatusStyle.backgroundColor },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        { color: activeStatusStyle.color },
                      ]}
                    >
                      {activeStatusStyle.label}
                    </Text>
                  </View>
                </View>

                <View style={styles.compactRequestBody}>
                  <View style={[styles.infoGridRow, styles.infoGridRowDivider]}>
                    <View style={styles.infoGridColumn}>
                      <Text style={styles.infoGridLabel}>Customer Name</Text>
                      <Text
                        style={styles.infoGridPrimaryValue}
                        numberOfLines={1}
                      >
                        {activeRequest.customerName}
                      </Text>
                    </View>

                    <View style={styles.infoGridColumn}>
                      <Text style={styles.infoGridLabel}>Amount Due</Text>
                      <Text style={styles.infoGridValue} numberOfLines={1}>
                        {formatAmountDue(activeRequest.total_cost)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.infoGridRow}>
                    <View style={styles.infoGridColumn}>
                      <Text style={styles.infoGridLabel}>Address</Text>
                      <Text style={styles.infoGridValue} numberOfLines={2}>
                        {activeRequest.deliveryAddress}
                      </Text>
                    </View>

                    <View style={styles.infoGridColumn}>
                      <Text style={styles.infoGridLabel}>Product Ordered</Text>
                      <Text
                        style={styles.infoGridPrimaryValue}
                        numberOfLines={2}
                      >
                        {activeRequest.productsOrdered}
                      </Text>
                      <Text style={styles.infoGridSubValue} numberOfLines={1}>
                        {activeRequest.quantity} | {activeRequest.containerType}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.cardActionsRow}>
                  <TouchableOpacity
                    style={styles.viewDetailsButton}
                    activeOpacity={0.75}
                    onPress={() => setDetailsVisible(true)}
                  >
                    <Text style={styles.viewDetailsText}>View Details</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.primaryActionButton}
                    activeOpacity={0.85}
                    onPress={handleCurrentRequestAction}
                  >
                    <Text style={styles.primaryActionText}>
                      {primaryActionLabel}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.emptyRequestCard}>
                <Text style={styles.emptyRequestTitle}>No active delivery.</Text>
                <Text style={styles.emptyRequestText}>
                  Go to the Requests page to accept a new order.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.quickActionsSection}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.quickActionsRow}>
              <TouchableOpacity
                style={styles.quickActionButton}
                activeOpacity={0.85}
                onPress={() => router.replace('/distributor/d_requests')}
              >
                <Text style={styles.quickActionText}>
                  View Pending Requests
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickActionButton, styles.quickActionSecondary]}
                activeOpacity={0.85}
                onPress={() => router.replace('/distributor/d_scheduled_requests')}
              >
                <Text
                  style={[
                    styles.quickActionText,
                    styles.quickActionSecondaryText,
                  ]}
                >
                  View Delivery Schedule
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>

        {/* Bottom navigation bar */}
        <View style={styles.bottomNav}>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_dashboard')}>
            <Image
              source={require('../../assets/icons/home.png')}
              style={styles.navIcon}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_requests')}>
            <Image
              source={require('../../assets/icons/ballot.png')}
              style={styles.navIcon}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_scheduled_requests')}>
            <Image
              source={require('../../assets/icons/calendar-clock.png')}
              style={styles.navIcon}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_profile')}>
            <Image
              source={require('../../assets/icons/user.png')}
              style={styles.navIcon}
            />
          </TouchableOpacity>
        </View>
      </View>

      <RequestDetailsModal
        visible={detailsVisible}
        onClose={() => setDetailsVisible(false)}
        request={detailsRequestData}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4FAFF',
  },
  phoneWrapper: {
    width: '100%',
    maxWidth: 375,
    alignSelf: 'center',
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 160,
  },
  welcomeSection: {
    marginTop: 12,
  },
  welcomeText: {
    color: BLUE,
    fontSize: 26,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  greetingText: {
    color: BLUE,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  dateText: {
    color: TEXT_MUTED,
    fontSize: 13,
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
  },
  summaryCard: {
    flex: 1,
    minHeight: 86,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  summaryValue: {
    color: BLUE,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  summaryLabel: {
    color: BLUE,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  currentRequestSection: {
    marginTop: 24,
  },
  sectionTitle: {
    color: BLUE,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  currentRequestCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 20,
    padding: 16,
    elevation: 6,
    shadowColor: '#0D47A1',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  requestCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: BLUE_LIGHT,
  },
  requestTitleBlock: {
    flex: 1,
  },
  requestId: {
    color: BLUE,
    fontSize: 15,
    fontWeight: 'bold',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexShrink: 0,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  compactRequestBody: {
    paddingTop: 2,
  },
  infoGridRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
  },
  infoGridRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: BLUE_LIGHT,
  },
  infoGridColumn: {
    flex: 1,
  },
  infoGridLabel: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  infoGridPrimaryValue: {
    color: BLUE,
    fontSize: 14,
    fontWeight: 'bold',
    lineHeight: 18,
  },
  infoGridValue: {
    color: TEXT_DARK,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  infoGridSubValue: {
    color: TEXT_DARK,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
    marginTop: 2,
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  viewDetailsButton: {
    flex: 1,
    height: 44,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: BLUE,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewDetailsText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: 'bold',
  },
  primaryActionButton: {
    flex: 1,
    height: 44,
    backgroundColor: BLUE,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: BLUE,
    shadowOpacity: 0.22,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  emptyRequestCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 20,
    padding: 16,
    elevation: 4,
    shadowColor: '#0D47A1',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  emptyRequestTitle: {
    color: BLUE,
    fontSize: 15,
    fontWeight: 'bold',
  },
  emptyRequestText: {
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  quickActionsSection: {
    marginTop: 24,
  },
  quickActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  quickActionButton: {
    flex: 1,
    minHeight: 50,
    backgroundColor: BLUE,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  quickActionSecondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: BLUE,
  },
  quickActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  quickActionSecondaryText: {
    color: BLUE,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 31, 51, 0.46)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  detailsModal: {
    width: '100%',
    maxWidth: 375,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: BLUE,
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalCloseText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: 'bold',
  },
  modalDivider: {
    height: 1,
    backgroundColor: BLUE_LIGHT,
    marginTop: 12,
    marginBottom: 12,
  },
  modalDetailRow: {
    marginBottom: 11,
  },
  modalDetailLabel: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  modalDetailValue: {
    color: TEXT_DARK,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  bottomNav: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 22,
    zIndex: 2,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  navIcon: {
    width: 26,
    height: 26,
    tintColor: BLUE,
  },
});
