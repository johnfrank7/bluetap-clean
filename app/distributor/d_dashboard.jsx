import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BlueTapHeader from '../../components/BlueTapHeader';
import DistributorPortalBackground from '../../components/DistributorPortalBackground';
import RequestDetailsModal from '../../components/RequestDetailsModal';
import SoftStatusBadge from '../../components/SoftStatusBadge';
import { createShadow } from '../../components/shadowStyles';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import DistributorProfileBanner from '../../components/DistributorProfileBanner';
import PortalSwipeContainer, { DISTRIBUTOR_TABS } from '../../components/PortalSwipeContainer';
import { createPortalStyleSheet, useBlueTapTheme } from '../../components/BlueTapTheme';
import { USER_PORTAL_BOTTOM_CONTENT_INSET, USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import { BLUETAP_COLORS } from '../../constants/bluetapTheme';
import {
  normalizeDistributorOrderStatus,
  toDistributorScreenOrder,
  useAssignedDistributorOrders,
} from '../../services/distributorOrders';
import { useDistributorProfile } from '../../services/distributorProfile';
import { useLiveGreeting } from '../../services/liveTime';
import { formatDisplayUniqueId, getProfileUniqueId } from '../../services/uniqueIds';

const BLUE = BLUETAP_COLORS.primary;
const BLUE_LIGHT = BLUETAP_COLORS.primarySoft;
const CARD_BORDER = BLUETAP_COLORS.border;
const TEXT_MUTED = BLUETAP_COLORS.textSecondary;
const TEXT_DARK = BLUETAP_COLORS.textPrimary;

const STATUS_ACTIONS = {
  'distributor assigned': 'Review Assignment',
  pending: 'Review Assignment',
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

const formatAmountDue = (amount) =>
  `₱${Number(amount || 0).toFixed(2)}`;

const occursToday = (value) => {
  if (!value) return false;
  try {
    const date = value instanceof Date
      ? value
      : value?.toDate?.() || (value?.seconds ? new Date(value.seconds * 1000) : new Date(value));
    const today = new Date();
    return Boolean(
      date &&
      typeof date.getTime === 'function' &&
      !Number.isNaN(date.getTime()) &&
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  } catch {
    return false;
  }
};

const getNumericQuantity = (quantity) => {
  const match = String(quantity || '').match(/\d+(\.\d+)?/);
  const parsedQuantity = Number(match?.[0] ?? quantity);

  return Number.isFinite(parsedQuantity) ? parsedQuantity : 0;
};

const getDistributorRequestItems = (request) => {
  if (!request) return [];

  if (Array.isArray(request.items) && request.items.length > 0) {
    return request.items.filter(Boolean).map((item, index) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.product_price ?? item.unitPrice ?? 0);
      const subtotal = Number(
        item.line_total ?? item.subtotal ?? unitPrice * quantity
      );

      return {
        id: String(item.product_id || item.id || `${request.requestId}-${index}`),
        productName: String(item.product_name || item.productName || item.productNameSnapshot || 'Product'),
        quantity: Number.isFinite(quantity) ? quantity : item.quantity,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
        subtotal: Number.isFinite(subtotal) ? subtotal : 0,
      };
    });
  }

  const quantity = getNumericQuantity(request.quantity);
  const totalAmount = Number(request.total_cost || request.totalAmount || request.totalAtOrder || 0);
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

class DistributorErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('DistributorDashboard caught render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: BLUETAP_COLORS.background, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <BlueTapEmptyState
            title="Dashboard Temporarily Unavailable"
            description="A temporary error occurred while rendering your dashboard. Please try reloading."
            actionLabel="Reload Dashboard"
            onAction={() => this.setState({ hasError: false, error: null })}
          />
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

function DistributorDashboardContent() {
  useBlueTapTheme();
  const router = useRouter();
  const liveGreeting = useLiveGreeting();
  const [detailsVisible, setDetailsVisible] = useState(false);
  const { orders, loading, error, refresh } = useAssignedDistributorOrders();
  const { isComplete, loading: profileLoading, profile: distributorProfile } = useDistributorProfile();
  const todayText = formatDashboardDate(new Date());
  const screenOrders = useMemo(() => (Array.isArray(orders) ? orders : []).filter(Boolean).map(toDistributorScreenOrder), [orders]);
  const activeRequest = screenOrders.find((order) => order && !['delivered', 'cancelled', 'canceled', 'declined'].includes(normalizeDistributorOrderStatus(order.status)));
  const activeRequesterUniqueId = useMemo(() => {
    return formatDisplayUniqueId(
      activeRequest?.requesterUniqueId ||
      activeRequest?.requester_unique_id ||
      activeRequest?.requesterId,
      'Not assigned'
    );
  }, [activeRequest?.requesterUniqueId, activeRequest?.requester_unique_id, activeRequest?.requesterId]);

  const activeDistributorUniqueId = useMemo(() => {
    return formatDisplayUniqueId(
      activeRequest?.distributorUniqueId ||
      activeRequest?.distributor_unique_id ||
      getProfileUniqueId(distributorProfile),
      'Not assigned'
    );
  }, [activeRequest?.distributorUniqueId, activeRequest?.distributor_unique_id, distributorProfile]);

  const dashboardSummary = useMemo(() => [
    {
      label: 'Pending Requests',
      value: String(screenOrders.filter((order) => ['distributor assigned', 'pending'].includes(normalizeDistributorOrderStatus(order.status))).length),
      route: '/distributor/d_requests',
    },
    {
      label: 'Scheduled Today',
      value: String(screenOrders.filter((order) => ['accepted', 'scheduled', 'out for delivery'].includes(normalizeDistributorOrderStatus(order.status)) && occursToday(order.rawScheduledAt || order.scheduledDateTime || order.scheduledAt)).length),
      route: '/distributor/d_scheduled_requests',
    },
    {
      label: 'Delivered Today',
      value: String(screenOrders.filter((order) => normalizeDistributorOrderStatus(order.status) === 'delivered' && occursToday(order.rawDeliveredAt || order.deliveredDateTime || order.deliveredAt)).length),
      route: '/distributor/d_history',
    },
  ], [screenOrders]);
  const primaryActionLabel = activeRequest
    ? getStatusActionLabel(activeRequest.status)
    : '';
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
        requesterName: activeRequest.customerName || activeRequest.requester_name || 'Not set',
        requesterUniqueId: activeRequesterUniqueId,
        customerName: activeRequest.customerName || activeRequest.requester_name || 'Not set',
        distributorName:
          activeRequest.distributorName || activeRequest.distributor_name || '',
        distributorUniqueId: activeDistributorUniqueId,
        contactNumber: activeRequest.contactNumber || activeRequest.contact_number || 'Not set',
        deliveryAddress:
          activeRequest.deliveryAddress || activeRequest.address || 'Not set',
        items: getDistributorRequestItems(activeRequest),
        grandTotalAmount: getDistributorTotalAmount(activeRequest),
      }
    : null;

  const handleCurrentRequestAction = () => {
    if (!isComplete) {
      router.push('/distributor/d_profile');
      return;
    }
    if (!activeRequest) return;

    if (['pending', 'distributor assigned'].includes(normalizeStatus(activeRequest.status))) {
      router.replace('/distributor/d_requests');
      return;
    }

    router.replace('/distributor/d_scheduled_requests');
  };

  return (
    <DistributorPortalBackground>
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <BlueTapHeader
        notificationPath="/distributor/d_notification"
      />

      <PortalSwipeContainer tabs={DISTRIBUTOR_TABS} currentRoute="/distributor/d_dashboard">
        <View style={styles.phoneWrapper}>
          <DistributorProfileBanner isComplete={isComplete} loading={profileLoading} />
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.welcomeSection}>
              <Text style={styles.welcomeText}>WELCOME!</Text>
              <Text style={styles.greetingText}>
                {liveGreeting}, Distributor
              </Text>
              <Text style={styles.dateText}>{todayText}</Text>
            </View>

            <View style={styles.summaryRow}>
              {dashboardSummary.map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={styles.summaryCard}
                  activeOpacity={0.75}
                  onPress={() => item.route && router.replace(item.route)}
                >
                  <Text style={styles.summaryValue}>{item.value}</Text>
                  <Text style={styles.summaryLabel}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.currentRequestSection}>
              <Text style={styles.sectionTitle}>Current Request</Text>

              {loading ? (
                <View style={styles.emptyRequestCard}><ActivityIndicator color={BLUE} /><Text style={styles.emptyRequestText}>Loading assigned deliveries...</Text></View>
              ) : error ? (
                <View style={styles.emptyRequestCard}><Text style={styles.emptyRequestTitle}>Unable to load deliveries.</Text><Text style={styles.emptyRequestText}>{error}</Text><TouchableOpacity onPress={refresh} style={styles.viewDetailsButton}><Text style={styles.viewDetailsText}>Try Again</Text></TouchableOpacity></View>
              ) : activeRequest ? (
                <View style={styles.currentRequestCard}>
                  <View style={styles.requestCardHeader}>
                    <View style={styles.requestTitleBlock}>
                      <Text style={styles.requestId}>
                        Request ID: {activeRequest.requestId}
                      </Text>
                    </View>
                    <SoftStatusBadge status={activeRequest.status} />
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
                        <Text style={[styles.infoGridLabel, styles.infoGridLabelGap]}>
                          Requester ID
                        </Text>
                        <Text style={styles.infoGridValue} numberOfLines={1}>
                          {activeRequesterUniqueId}
                        </Text>
                      </View>

                      <View style={styles.infoGridColumn}>
                        <Text style={styles.infoGridLabel}>Amount Due</Text>
                        <Text style={styles.infoGridValue} numberOfLines={1}>
                          {formatAmountDue(activeRequest.total_cost)}
                        </Text>
                        <Text style={[styles.infoGridLabel, styles.infoGridLabelGap]}>
                          Distributor ID
                        </Text>
                        <Text style={styles.infoGridValue} numberOfLines={1}>
                          {activeDistributorUniqueId}
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
                <BlueTapEmptyState
                  title="No Active Delivery"
                  description="New branch assignments will appear here once assigned by your branch manager."
                  compact
                />
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
        </View>
      </PortalSwipeContainer>

      <RequestDetailsModal
        visible={detailsVisible}
        onClose={() => setDetailsVisible(false)}
        request={detailsRequestData}
      />
    </SafeAreaView>
    </DistributorPortalBackground>
  );
}

export default function DistributorDashboard() {
  return (
    <DistributorErrorBoundary>
      <DistributorDashboardContent />
    </DistributorErrorBoundary>
  );
}

const styles = createPortalStyleSheet({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  phoneWrapper: {
    width: '100%',
    maxWidth: USER_PORTAL_LAYOUT.maxWidth,
    minWidth: 0,
    alignSelf: 'center',
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: USER_PORTAL_LAYOUT.gutter,
    paddingTop: 18,
    paddingBottom: USER_PORTAL_BOTTOM_CONTENT_INSET,
  },
  welcomeSection: {
    marginTop: 12,
  },
  welcomeText: {
    color: BLUETAP_COLORS.white,
    fontSize: 26,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  greetingText: {
    color: BLUETAP_COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  dateText: {
    color: BLUETAP_COLORS.white,
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
    backgroundColor: BLUETAP_COLORS.surface,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 12,
    justifyContent: 'space-between',
    ...createShadow({
      color: '#0D47A1',
      elevation: 2,
      opacity: 0.05,
      radius: 4,
      offset: { width: 0, height: 2 },
    }),
  },
  summaryValue: {
    color: BLUE,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  summaryLabel: {
    color: TEXT_MUTED,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  currentRequestSection: {
    marginTop: 24,
  },
  sectionTitle: {
    color: BLUETAP_COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  currentRequestCard: {
    backgroundColor: BLUETAP_COLORS.surface,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: USER_PORTAL_LAYOUT.cardRadius,
    padding: 16,
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
  infoGridLabelGap: {
    marginTop: 8,
  },
  infoGridPrimaryValue: {
    color: TEXT_DARK,
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
    backgroundColor: BLUETAP_COLORS.surface,
    borderWidth: 1.5,
    borderColor: BLUE,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewDetailsText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: '600',
  },
  primaryActionButton: {
    flex: 1,
    height: 44,
    backgroundColor: BLUE,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...createShadow({
      color: BLUE,
      elevation: 4,
      opacity: 0.18,
      radius: 10,
      offset: { width: 0, height: 4 },
    }),
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  emptyRequestCard: {
    backgroundColor: BLUETAP_COLORS.surface,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: USER_PORTAL_LAYOUT.cardRadius,
    padding: 16,
    ...createShadow({
      color: '#0D47A1',
      elevation: 4,
      opacity: 0.08,
      radius: 8,
      offset: { width: 0, height: 4 },
    }),
  },
  emptyRequestTitle: {
    color: TEXT_DARK,
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
    backgroundColor: BLUETAP_COLORS.surface,
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
    maxWidth: USER_PORTAL_LAYOUT.maxWidth,
    backgroundColor: BLUETAP_COLORS.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: USER_PORTAL_LAYOUT.gutter,
    paddingTop: 18,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: TEXT_DARK,
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
});
