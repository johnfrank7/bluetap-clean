import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BlueTapHeader from '../../components/BlueTapHeader';
import DistributorPortalBackground from '../../components/DistributorPortalBackground';
import RequestDetailsModal from '../../components/RequestDetailsModal';
import SoftStatusBadge from '../../components/SoftStatusBadge';
import { createShadow } from '../../components/shadowStyles';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import BlueTapIcon from '../../components/BlueTapIcon';
import LocalTimeCard from '../../components/LocalTimeCard';
import DistributorProfileBanner from '../../components/DistributorProfileBanner';
import TopToastFeedback from '../../components/TopToastFeedback';
import DeliveryActionDialog from '../../components/DeliveryActionDialog';
import PortalSwipeContainer, { DISTRIBUTOR_TABS, PortalSwipeIgnore } from '../../components/PortalSwipeContainer';
import { createPortalStyleSheet, useBlueTapTheme } from '../../components/BlueTapTheme';
import { useReducedMotionPreference } from '../../components/BlueTapThemeTransition';
import useSingleFlightNavigation from '../../components/useSingleFlightNavigation';
import { DistributorOrderChatAction } from '../../components/chat/ChatOrderActions';
import { ModerationNoticeBanner } from '../../components/ModerationNotices';
import AnimatedPresenceItem from '../../components/AnimatedPresenceItem';
import { useAnimatedPresenceList } from '../../components/useAnimatedPresenceList';
import { USER_PORTAL_BOTTOM_CONTENT_INSET, USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import { BLUETAP_COLORS } from '../../constants/bluetapTheme';
import {
  toDistributorScreenOrder,
  completeAssignedDelivery,
  failAssignedDelivery,
  useAssignedDistributorOrders,
} from '../../services/distributorOrders';
import { useDistributorProfile } from '../../services/distributorProfile';
import { useLiveGreeting } from '../../services/liveTime';
import { formatDisplayUniqueId, getProfileUniqueId } from '../../services/uniqueIds';
const { getCurrentDistributorRequests, getDistributorDashboardCounts } = require('../../services/distributorDashboardMetrics');
const { getCarouselIndexFromOffset, isCurrentCarouselOffset, resolveCarouselStepIndex, resolveDragTargetIndex } = require('../../services/carouselSnap');

const BLUE = BLUETAP_COLORS.primary;
const BLUE_LIGHT = BLUETAP_COLORS.primarySoft;
const CARD_BORDER = BLUETAP_COLORS.border;
const TEXT_MUTED = BLUETAP_COLORS.textSecondary;
const TEXT_DARK = BLUETAP_COLORS.textPrimary;

const STATUS_ACTIONS = {
  'distributor assigned': 'Review Assignment',
  pending: 'Review Assignment',
  accepted: 'Start Delivery',
  scheduled: 'Start Delivery',
  'out for delivery': 'Delivered',
};


const normalizeStatus = (status) =>
  (status || '').toString().trim().toLowerCase().replace(/[_-]+/g, ' ');

const getStatusActionLabel = (status) =>
  STATUS_ACTIONS[normalizeStatus(status)] || 'Update Request';

const getCarouselEventOffset = (event, fallback = 0) => {
  const offset = Number(event?.nativeEvent?.contentOffset?.x);
  return Number.isFinite(offset) ? offset : Number(fallback || 0);
};

const formatAmountDue = (amount) =>
  `₱${Number(amount || 0).toFixed(2)}`;

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

function CurrentRequestCard({ actionsDisabled = false, colors, request, distributorProfile, onDetails, onAction, onFailure, processing }) {
  const requesterUid = formatDisplayUniqueId(request.requesterUniqueId || request.requester_unique_id || request.requesterId, 'Not assigned');
  const distributorUid = formatDisplayUniqueId(request.distributorUniqueId || request.distributor_unique_id || getProfileUniqueId(distributorProfile), 'Not assigned');
  const actionLabel = getStatusActionLabel(request.status);
  const hasAction = ['distributor assigned', 'pending', 'accepted', 'scheduled', 'out for delivery'].includes(normalizeStatus(request.status));
  const isDeliveryCompletion = actionLabel === 'Delivered';
  return <View style={styles.currentRequestCard}>
    <View style={styles.requestCardHeader}><View style={styles.requestTitleBlock}><Text style={styles.requestId}>Request ID: {request.requestId}</Text></View><SoftStatusBadge status={request.status} /></View>
    <View style={styles.compactRequestBody}>
      <View style={[styles.infoGridRow, styles.infoGridRowDivider]}><View style={styles.infoGridColumn}><Text style={styles.infoGridLabel}>Customer Name</Text><Text style={styles.infoGridPrimaryValue} numberOfLines={1}>{request.customerName}</Text><Text style={[styles.infoGridLabel, styles.infoGridLabelGap]}>Requester ID</Text><Text style={styles.infoGridValue} numberOfLines={1}>{requesterUid}</Text></View><View style={styles.infoGridColumn}><Text style={styles.infoGridLabel}>Amount Due</Text><Text style={styles.infoGridValue} numberOfLines={1}>{formatAmountDue(request.total_cost)}</Text><Text style={[styles.infoGridLabel, styles.infoGridLabelGap]}>Distributor ID</Text><Text style={styles.infoGridValue} numberOfLines={1}>{distributorUid}</Text></View></View>
      <View style={styles.infoGridRow}><View style={styles.infoGridColumn}><Text style={styles.infoGridLabel}>Address</Text><Text style={styles.infoGridValue} numberOfLines={2}>{request.deliveryAddress}</Text><Text style={[styles.infoGridLabel, styles.infoGridLabelGap]}>Scheduled delivery</Text><Text style={styles.infoGridValue} numberOfLines={1}>{request.scheduledDateTime || request.deliveryDate || 'Not set'}</Text></View><View style={styles.infoGridColumn}><Text style={styles.infoGridLabel}>Product Ordered</Text><Text style={styles.infoGridPrimaryValue} numberOfLines={2}>{request.productsOrdered}</Text><Text style={styles.infoGridSubValue} numberOfLines={1}>{request.quantity} | {request.containerType}</Text></View></View>
    </View>
    <View style={styles.cardActionsGrid}>
      <Pressable disabled={actionsDisabled} onPress={onDetails} style={({ hovered, pressed }) => [styles.viewDetailsButton, styles.actionGridItem, hovered && { backgroundColor: colors.primarySoft }, pressed && styles.actionButtonPressed, actionsDisabled && styles.actionButtonDisabled]}><Text style={styles.viewDetailsText}>View Details</Text></Pressable>
      {hasAction && <Pressable disabled={actionsDisabled} onPress={onAction} style={({ hovered, pressed }) => [styles.primaryActionButton, styles.actionGridItem, isDeliveryCompletion && { backgroundColor: colors.successAction }, hovered && styles.actionButtonHovered, pressed && styles.actionButtonPressed, actionsDisabled && styles.actionButtonDisabled]}><Text style={[styles.primaryActionText, isDeliveryCompletion && { color: colors.onSuccess }]}>{actionLabel}</Text></Pressable>}
      <DistributorOrderChatAction order={request} disabled={actionsDisabled} style={styles.actionGridItem} />
      <Pressable disabled={processing || actionsDisabled} accessibilityRole="button" onPress={onFailure} style={({ hovered, pressed }) => [styles.viewDetailsButton, styles.failureActionButton, styles.actionGridItem, hovered && { backgroundColor: colors.dangerSoft }, pressed && styles.actionButtonPressed, (processing || actionsDisabled) && styles.actionButtonDisabled]}><Text style={styles.failureActionText}>Delivery Failed</Text></Pressable>
    </View>
  </View>;
}

function CurrentRequestSlide({ active, children, width }) {
  const reduceMotion = useReducedMotionPreference();
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: reduceMotion ? 0 : 190,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [active, progress, reduceMotion]);
  return (
    <Animated.View pointerEvents={active ? 'auto' : 'none'} style={[styles.currentRequestSlide, { width, zIndex: active ? 2 : 1, opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }), transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] }]}>
      {children}
    </Animated.View>
  );
}

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
  const { colors } = useBlueTapTheme();
  const { width } = useWindowDimensions();
  const { navigateOnce, replaceOnce } = useSingleFlightNavigation();
  const liveGreeting = useLiveGreeting();
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [deliveryAction, setDeliveryAction] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [activeRequestIndex, setActiveRequestIndex] = useState(0);
  const currentRequestsRef = useRef(null);
  const carouselDragStartXRef = useRef(0);
  const carouselLastOffsetXRef = useRef(0);
  const carouselInteractionRef = useRef(0);
  const carouselDraggingRef = useRef(false);
  const carouselTouchActiveRef = useRef(false);
  const carouselSettleTimerRef = useRef(null);
  const { orders, loading, error, refresh } = useAssignedDistributorOrders();
  const { isComplete, loading: profileLoading, profile: distributorProfile } = useDistributorProfile();
  const screenOrders = useMemo(() => (Array.isArray(orders) ? orders : []).filter(Boolean).map(toDistributorScreenOrder), [orders]);
  const authoritativeActiveRequests = useMemo(() => getCurrentDistributorRequests(screenOrders), [screenOrders]);
  const activeRequestEntries = useAnimatedPresenceList(authoritativeActiveRequests, (request) => request.sourceId || request.requestId);
  useEffect(() => { setActiveRequestIndex((index) => Math.max(0, Math.min(index, activeRequestEntries.length - 1))); }, [activeRequestEntries.length]);
  useEffect(() => () => {
    if (carouselSettleTimerRef.current) clearTimeout(carouselSettleTimerRef.current);
  }, []);
  const activeRequestEntry = activeRequestEntries[activeRequestIndex] || null;
  const activeRequest = activeRequestEntry?.item || null;
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
  const dashboardCounts = useMemo(() => getDistributorDashboardCounts(screenOrders), [screenOrders]);
  const currentRequestViewportWidth = Math.max(1, Math.min(width, USER_PORTAL_LAYOUT.maxWidth) - (USER_PORTAL_LAYOUT.gutter * 2));
  const currentRequestPeek = activeRequestEntries.length > 1 ? Math.min(24, Math.max(16, currentRequestViewportWidth * 0.075)) : 0;
  const currentRequestCardWidth = Math.max(1, currentRequestViewportWidth - currentRequestPeek - (currentRequestPeek > 0 ? 12 : 0));
  const currentRequestSnap = currentRequestCardWidth + 12;
  const stackMetrics = width < 360;
  const showCarouselArrows = width >= 600 && activeRequestEntries.length > 1;
  const clearCarouselSettleTimer = () => {
    if (!carouselSettleTimerRef.current) return;
    clearTimeout(carouselSettleTimerRef.current);
    carouselSettleTimerRef.current = null;
  };
  const commitCarouselIndex = (index, { animated = false, interaction = carouselInteractionRef.current, snap = true } = {}) => {
    if (interaction !== carouselInteractionRef.current) return false;
    const nextIndex = Math.max(0, Math.min(activeRequestEntries.length - 1, index));
    setActiveRequestIndex(nextIndex);
    if (snap) {
      carouselLastOffsetXRef.current = nextIndex * currentRequestSnap;
      currentRequestsRef.current?.scrollTo?.({ x: carouselLastOffsetXRef.current, animated });
    }
    return true;
  };
  const scheduleCarouselOffsetCommit = (interaction = carouselInteractionRef.current) => {
    clearCarouselSettleTimer();
    carouselSettleTimerRef.current = setTimeout(() => {
      if (
        interaction !== carouselInteractionRef.current ||
        carouselDraggingRef.current ||
        carouselTouchActiveRef.current
      ) return;
      commitCarouselIndex(getCarouselIndexFromOffset(
        carouselLastOffsetXRef.current,
        currentRequestSnap,
        activeRequestEntries.length
      ), { interaction });
    }, 120);
  };
  const moveCarousel = (direction) => {
    clearCarouselSettleTimer();
    const interaction = carouselInteractionRef.current + 1;
    carouselInteractionRef.current = interaction;
    commitCarouselIndex(resolveCarouselStepIndex({
      count: activeRequestEntries.length,
      direction,
      index: activeRequestIndex,
    }), { animated: true, interaction });
  };
  const handleCarouselScroll = (event) => {
    carouselLastOffsetXRef.current = getCarouselEventOffset(event, carouselLastOffsetXRef.current);
    scheduleCarouselOffsetCommit();
  };
  const beginCarouselInteraction = (offsetX = carouselLastOffsetXRef.current) => {
    clearCarouselSettleTimer();
    if (!carouselDraggingRef.current) carouselInteractionRef.current += 1;
    carouselDraggingRef.current = true;
    carouselDragStartXRef.current = Number(offsetX || 0);
    carouselLastOffsetXRef.current = Number(offsetX || 0);
  };
  const commitCarouselSwipe = ({ offsetX, velocityX = 0 }) => {
    const interaction = carouselInteractionRef.current;
    carouselDraggingRef.current = false;
    carouselTouchActiveRef.current = false;
    const releaseOffset = Number(offsetX);
    carouselLastOffsetXRef.current = Number.isFinite(releaseOffset)
      ? releaseOffset
      : carouselLastOffsetXRef.current;
    const nextIndex = resolveDragTargetIndex({
      cardWidth: currentRequestCardWidth,
      count: activeRequestEntries.length,
      endOffset: carouselLastOffsetXRef.current,
      snapInterval: currentRequestSnap,
      startOffset: carouselDragStartXRef.current,
      velocityX,
    });
    commitCarouselIndex(nextIndex, { animated: true, interaction });
  };
  const handleCarouselDragStart = (event) => {
    beginCarouselInteraction(getCarouselEventOffset(event, carouselLastOffsetXRef.current));
  };
  const handleCarouselDragEnd = (event) => {
    commitCarouselSwipe({
      offsetX: event.nativeEvent.contentOffset?.x,
      velocityX: event.nativeEvent.velocity?.x,
    });
  };
  const handleCarouselTouchStart = () => {
    carouselTouchActiveRef.current = true;
    beginCarouselInteraction();
  };
  const handleCarouselTouchEnd = () => {
    if (!carouselTouchActiveRef.current) return;
    commitCarouselSwipe({ offsetX: carouselLastOffsetXRef.current });
  };
  const handleCarouselMomentumEnd = (event) => {
    carouselDraggingRef.current = false;
    carouselTouchActiveRef.current = false;
    const eventOffset = getCarouselEventOffset(event, carouselLastOffsetXRef.current);
    if (!isCurrentCarouselOffset({ eventOffset, lastOffset: carouselLastOffsetXRef.current })) return;
    clearCarouselSettleTimer();
    carouselLastOffsetXRef.current = eventOffset;
    const settledIndex = getCarouselIndexFromOffset(
      eventOffset,
      currentRequestSnap,
      activeRequestEntries.length
    );
    commitCarouselIndex(settledIndex, { interaction: carouselInteractionRef.current });
  };

  const dashboardSummary = useMemo(() => [
    {
      label: 'Pending Requests',
      value: String(dashboardCounts.pending),
      route: '/distributor/d_requests',
      accent: colors.warning,
      tint: colors.warningSoft,
    },
    {
      label: 'Scheduled Today',
      value: String(dashboardCounts.scheduledToday),
      route: '/distributor/d_scheduled_requests',
      accent: colors.primary,
      tint: colors.primarySoft,
    },
    {
      label: 'Delivered Today',
      value: String(dashboardCounts.deliveredToday),
      route: '/distributor/d_history',
      accent: colors.success,
      tint: colors.successSoft,
    },
  ], [colors, dashboardCounts]);
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
        deliveryLocation: activeRequest.deliveryLocation,
        branchLocation: activeRequest.branchLocation,
        branchId: activeRequest.branchId,
        items: getDistributorRequestItems(activeRequest),
        grandTotalAmount: getDistributorTotalAmount(activeRequest),
      }
    : null;

  const handleCurrentRequestAction = (request = activeRequest) => {
    if (!isComplete) {
      navigateOnce('/distributor/d_profile');
      return;
    }
    if (!request) return;
    if (normalizeStatus(request.status) === 'out for delivery') {
      setDeliveryAction({ id: request.sourceId, reference: request.requestId, type: 'delivered' });
      return;
    }

    if (['pending', 'distributor assigned'].includes(normalizeStatus(request.status))) {
      replaceOnce('/distributor/d_requests');
      return;
    }

    replaceOnce('/distributor/d_scheduled_requests');
  };

  const submitDeliveryAction = async (failure = {}) => {
    if (!deliveryAction || processing) return;
    setProcessing(true);
    try {
      if (deliveryAction.type === 'failed') await failAssignedDelivery(deliveryAction.id, failure);
      else await completeAssignedDelivery(deliveryAction.id);
      setDeliveryAction(null);
      setToast({ visible: true, type: 'success', message: 'Delivery status updated.' });
    } catch (error) { setToast({ visible: true, type: 'error', message: error.message || 'Delivery could not be updated.' }); }
    finally { setProcessing(false); }
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
            <View style={styles.welcomeRow}>
              <View style={styles.welcomeSection}>
                <Text style={styles.welcomeText}>WELCOME!</Text>
                <Text style={styles.greetingText}>
                  {liveGreeting}, Distributor
                </Text>
              </View>
              <LocalTimeCard compact={width < 430} onBrand />
            </View>
            <ModerationNoticeBanner />

            <View style={styles.summarySection}>
              <Text style={[styles.summaryHeading, { color: colors.primary }]}>Delivery overview</Text>
              <View style={[styles.summaryRow, stackMetrics && styles.summaryRowStacked]}>
                {dashboardSummary.map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={[styles.summaryCard, stackMetrics && styles.summaryCardStacked, { backgroundColor: colors.surface, borderColor: item.accent }]}
                  activeOpacity={0.75}
                  onPress={() => item.route && replaceOnce(item.route)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.label}: ${item.value}`}
                >
                  <View style={[styles.summaryMetricHeader, { backgroundColor: item.tint, borderBottomColor: item.accent }]}>
                    <Text style={[styles.summaryLabel, { color: item.accent }]}>{item.label}</Text>
                  </View>
                  <View style={styles.summaryMetricBody}>
                    <Text style={[styles.summaryValue, { color: item.accent }]}>{item.value}</Text>
                  </View>
                </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.currentRequestSection}>
              <View style={styles.currentRequestHeader}>
                <View style={styles.currentRequestTitleGroup}>
                  <Text style={[styles.sectionTitle, styles.sectionTitleInline]}>{activeRequestEntries.length === 1 ? 'Delivery Request' : 'Delivery Requests'}</Text>
                  <View style={styles.requestCountBadge}><Text style={styles.requestCountText}>{activeRequestEntries.length}</Text></View>
                </View>
                {showCarouselArrows && <View style={styles.carouselArrows}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Previous current request" disabled={activeRequestIndex === 0} onPress={() => moveCarousel(-1)} style={({ hovered, pressed }) => [styles.carouselArrow, { backgroundColor: colors.surface, borderColor: colors.primary }, hovered && styles.carouselArrowHovered, pressed && styles.carouselArrowPressed, activeRequestIndex === 0 && styles.carouselArrowDisabled]}><BlueTapIcon name="chevron-left" size={24} color={colors.iconInteractive || colors.primary} /></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Next current request" disabled={activeRequestIndex === activeRequestEntries.length - 1} onPress={() => moveCarousel(1)} style={({ hovered, pressed }) => [styles.carouselArrow, { backgroundColor: colors.surface, borderColor: colors.primary }, hovered && styles.carouselArrowHovered, pressed && styles.carouselArrowPressed, activeRequestIndex === activeRequestEntries.length - 1 && styles.carouselArrowDisabled]}><BlueTapIcon name="chevron-right" size={24} color={colors.iconInteractive || colors.primary} /></Pressable>
                </View>}
              </View>

              {loading ? (
                <View style={styles.emptyRequestCard}><ActivityIndicator color={BLUE} /><Text style={styles.emptyRequestText}>Loading assigned deliveries...</Text></View>
              ) : error && screenOrders.length === 0 ? (
                <View style={styles.emptyRequestCard}><Text style={styles.emptyRequestTitle}>Unable to load deliveries.</Text><Text style={styles.emptyRequestText}>{error}</Text><TouchableOpacity onPress={refresh} style={styles.viewDetailsButton}><Text style={styles.viewDetailsText}>Try Again</Text></TouchableOpacity></View>
              ) : activeRequest ? (
                <PortalSwipeIgnore>
                  <ScrollView ref={currentRequestsRef} horizontal showsHorizontalScrollIndicator={false} snapToInterval={currentRequestSnap} disableIntervalMomentum decelerationRate="fast" scrollEventThrottle={16} contentContainerStyle={[styles.currentRequestsCarousel, { paddingRight: currentRequestPeek }]} onScroll={handleCarouselScroll} onScrollBeginDrag={handleCarouselDragStart} onScrollEndDrag={handleCarouselDragEnd} onMomentumScrollEnd={handleCarouselMomentumEnd} onTouchStart={handleCarouselTouchStart} onTouchEnd={handleCarouselTouchEnd} onTouchCancel={handleCarouselTouchEnd}>
                    {activeRequestEntries.map((entry, index) => <CurrentRequestSlide key={entry.id} width={currentRequestCardWidth} active={index === activeRequestIndex}><AnimatedPresenceItem phase={entry.phase}><CurrentRequestCard colors={colors} request={entry.item} actionsDisabled={entry.actionsDisabled} distributorProfile={distributorProfile} processing={processing} onFailure={() => setDeliveryAction({ id: entry.item.sourceId, reference: entry.item.requestId, type: 'failed' })} onDetails={() => { commitCarouselIndex(index, { snap: false }); setDetailsVisible(true); }} onAction={() => { commitCarouselIndex(index, { snap: false }); handleCurrentRequestAction(entry.item); }} /></AnimatedPresenceItem></CurrentRequestSlide>)}
                  </ScrollView>
                  {activeRequestEntries.length > 1 && <View style={styles.carouselIndicators}><Text style={styles.carouselPosition}>{activeRequestIndex + 1}/{activeRequestEntries.length}</Text>{activeRequestEntries.map((entry, index) => <View key={`${entry.id}-${index}`} style={[styles.carouselIndicator, index === activeRequestIndex && styles.carouselIndicatorActive]} />)}</View>}
                </PortalSwipeIgnore>
              ) : (
                <BlueTapEmptyState
                  variant="delivery"
                  title="No Active Delivery"
                  description="Accept assignments in Requests, then use Start Delivery in Schedule when ready."
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
                  onPress={() => replaceOnce('/distributor/d_requests')}
                >
                  <Text style={styles.quickActionText}>
                    View Pending Requests
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.quickActionButton, styles.quickActionSecondary]}
                  activeOpacity={0.85}
                  onPress={() => replaceOnce('/distributor/d_scheduled_requests')}
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
      <DeliveryActionDialog
        visible={Boolean(deliveryAction)}
        action={deliveryAction?.type}
        orderReference={deliveryAction?.reference || activeRequest?.requestId}
        busy={processing}
        onCancel={() => !processing && setDeliveryAction(null)}
        onConfirm={submitDeliveryAction}
      />
      <TopToastFeedback {...toast} onDismiss={() => setToast((value) => ({ ...value, visible: false }))} />
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
  welcomeRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  welcomeSection: {
    marginTop: 12,
    flex: 1,
    minWidth: 0,
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
  summarySection: {
    marginTop: 20,
    padding: 14,
    borderRadius: USER_PORTAL_LAYOUT.cardRadius,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: BLUETAP_COLORS.surface,
    ...createShadow({ color: '#0D47A1', elevation: 4, opacity: 0.08, radius: 8, offset: { width: 0, height: 4 } }),
  },
  summaryHeading: { color: TEXT_DARK, fontSize: 13, fontWeight: '900', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.7 },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  summaryRowStacked: { flexWrap: 'wrap' },
  summaryCard: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 86,
    backgroundColor: BLUETAP_COLORS.surface,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    padding: 0,
    overflow: 'hidden',
    ...createShadow({
      color: '#0D47A1',
      elevation: 2,
      opacity: 0.05,
      radius: 4,
      offset: { width: 0, height: 2 },
    }),
  },
  summaryCardStacked: { flexBasis: '100%', minHeight: 76 },
  summaryMetricHeader: { minHeight: 40, paddingHorizontal: 7, paddingVertical: 7, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1 },
  summaryMetricBody: { flex: 1, minHeight: 54, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  summaryValue: {
    color: BLUE,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  summaryLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
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
  sectionTitleInline: { flex: 1, marginBottom: 0 },
  currentRequestHeader: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  currentRequestTitleGroup: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  requestCountBadge: { minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: BLUETAP_COLORS.surface, borderWidth: 1, borderColor: CARD_BORDER },
  requestCountText: { color: BLUE, fontSize: 12, fontWeight: '900' },
  carouselArrows: { flexDirection: 'row', gap: 8 },
  carouselArrow: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  carouselArrowHovered: { transform: [{ translateY: -1 }, { scale: 1.03 }] },
  carouselArrowPressed: { transform: [{ scale: 0.97 }] },
  carouselArrowDisabled: { opacity: 0.42 },
  currentRequestCard: {
    minHeight: 352,
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
  currentRequestsCarousel: {
    gap: 12,
    paddingRight: 0,
  },
  currentRequestSlide: {
    maxWidth: '100%',
  },
  carouselIndicators: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  carouselPosition: { color: BLUETAP_COLORS.white, fontSize: 11, fontWeight: '900', marginRight: 2 },
  carouselIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BLUETAP_COLORS.border,
  },
  carouselIndicatorActive: {
    width: 18,
    backgroundColor: BLUE,
  },
  requestCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 12,
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
    paddingTop: 0,
  },
  infoGridRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 9,
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
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  cardActionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 5, paddingTop: 14, borderTopWidth: 1, borderTopColor: BLUE_LIGHT },
  actionGridItem: { flexGrow: 0, flexBasis: '48%', width: '48%', minHeight: 48, height: 48 },
  actionButtonDisabled: { opacity: 0.55 },
  actionButtonHovered: { opacity: 0.94, transform: [{ translateY: -1 }] },
  actionButtonPressed: { opacity: 0.84, transform: [{ scale: 0.985 }] },
  viewDetailsButton: {
    flexGrow: 1,
    flexBasis: 118,
    minWidth: 0,
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
  secondaryActionItem: {
    flexGrow: 1,
    flexBasis: 118,
    minWidth: 0,
  },
  failureActionButton: {
    borderColor: BLUETAP_COLORS.danger,
  },
  failureActionText: {
    color: BLUETAP_COLORS.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  primaryActionButton: {
    flexGrow: 1,
    flexBasis: 118,
    minWidth: 0,
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
