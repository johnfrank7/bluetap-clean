import React from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BLUETAP_COLORS } from '../constants/bluetapTheme';
import { useAdminTheme } from './AdminTheme';
import BlueTapEmptyState from './BlueTapEmptyState';
import { useManagerRealtimeData } from './ManagerRealtimeData';
import RequestDetailsModal from './RequestDetailsModal';
import SidebarIcon from './SidebarIcon';
import { createShadow } from './shadowStyles';
import useCurrentPageRequestDetails from './useCurrentPageRequestDetails';
import useSingleFlightNavigation from './useSingleFlightNavigation';
import { parseTimestamp } from '../services/notificationTimestamp';
import { formatDisplayUniqueId } from '../services/uniqueIds';

const { getOngoingDeliveryProgress, statusOf } = require('../services/managerOperational');
const { formatDeliveryFailureReason } = require('../constants/deliveryFailureReasons');

const defaultContextValue = {
  isOpen: false,
  openPanel: () => {},
  closePanel: () => {},
  togglePanel: () => {},
  ongoingCount: 0,
  ongoingRequests: [],
  loading: false,
  hasError: false,
  retry: () => {},
  viewAllTick: 0,
  triggerViewAllFilter: () => {},
};

const ManagerOngoingRequestsContext = React.createContext(defaultContextValue);

const STATUS_META = {
  distributor_assigned: {
    label: 'Assigned to Distributor',
    tone: 'info',
  },
  assigned: {
    label: 'Assigned to Distributor',
    tone: 'info',
  },
  accepted: {
    label: 'Distributor Accepted',
    tone: 'info',
  },
  scheduled: {
    label: 'Scheduled for Delivery',
    tone: 'primary',
  },
  rescheduled: {
    label: 'Rescheduled Delivery',
    tone: 'primary',
  },
  out_for_delivery: {
    label: 'Out for Delivery',
    tone: 'success',
  },
  delivery_failed: {
    label: 'Delivery Issue Reported',
    tone: 'danger',
  },
  delivered: {
    label: 'Delivered',
    tone: 'success',
  },
};

export function formatOngoingStatusLabel(status) {
  const normalized = statusOf(status);
  if (STATUS_META[normalized]) return STATUS_META[normalized].label;
  if (!normalized) return 'Ongoing';
  return normalized
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function resolveStatusToneColors(status, colors, isDark) {
  const normalized = statusOf(status);
  const tone = STATUS_META[normalized]?.tone || 'info';
  if (tone === 'danger') {
    return {
      bg: isDark ? 'rgba(239, 68, 68, 0.18)' : colors.dangerSoft || '#FEE2E2',
      border: isDark ? 'rgba(248, 113, 113, 0.45)' : '#FCA5A5',
      text: isDark ? '#FCA5A5' : colors.danger || '#B91C1C',
    };
  }
  if (tone === 'success') {
    return {
      bg: isDark ? 'rgba(16, 185, 129, 0.18)' : colors.successSoft || '#DCFCE7',
      border: isDark ? 'rgba(52, 211, 153, 0.45)' : '#86EFAC',
      text: isDark ? '#6EE7B7' : colors.success || '#047857',
    };
  }
  if (tone === 'primary') {
    return {
      bg: isDark ? 'rgba(56, 189, 248, 0.18)' : colors.primarySoft || '#E0F2FE',
      border: isDark ? 'rgba(56, 189, 248, 0.45)' : '#7DD3FC',
      text: isDark ? '#7DD3FC' : colors.primary || '#0369A1',
    };
  }
  return {
    bg: isDark ? 'rgba(59, 130, 246, 0.18)' : '#EFF6FF',
    border: isDark ? 'rgba(96, 165, 250, 0.42)' : '#BFDBFE',
    text: isDark ? '#93C5FD' : '#1D4ED8',
  };
}

function formatDateTimeValue(value, fallback = 'Not available') {
  if (!value) return fallback;
  const parsed = parseTimestamp(value);
  if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
    try {
      return parsed.toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return parsed.toISOString();
    }
  }
  const text = String(value || '').trim();
  return text || fallback;
}

function formatScheduledDeliverySummary(order) {
  const datePart = String(order?.scheduledDate || '').trim();
  const windowPart = String(order?.scheduledWindow || '').trim();
  if (datePart && windowPart) {
    return `${datePart} · ${windowPart}`;
  }
  if (datePart) {
    return datePart;
  }
  if (order?.scheduledAt) {
    return formatDateTimeValue(order.scheduledAt, 'Not available');
  }
  return 'Not available';
}

function formatProductDetails(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length > 0) {
    const names = items
      .map((item) => {
        const name = item.productNameSnapshot || item.product_name || item.name || 'Water Refill';
        const qty = Number(item.quantity) || 1;
        return items.length === 1 ? name : `${name} (x${qty})`;
      })
      .join(', ');
    const totalQty = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    return {
      productName: names || 'Not available',
      quantityLabel: totalQty > 0 ? `${totalQty}` : 'Not available',
    };
  }
  const fallbackName = String(order?.productSummary || order?.productNameSnapshot || order?.product_name || '').trim();
  const fallbackQty = Number(order?.totalQuantity ?? order?.quantity) || 0;
  return {
    productName: fallbackName || 'Not available',
    quantityLabel: fallbackQty > 0 ? `${fallbackQty}` : 'Not available',
  };
}

export function ManagerOngoingRequestsProvider({ children }) {
  const pathname = usePathname();
  const {
    ongoingRequests = [],
    ongoingCount = 0,
    loading = false,
    error = '',
    errors = {},
    retry,
  } = useManagerRealtimeData();
  const [isOpen, setIsOpen] = React.useState(false);
  const [viewAllTick, setViewAllTick] = React.useState(0);

  const hasError = Boolean(errors?.requests || (error && ongoingRequests.length === 0));

  React.useEffect(() => {
    if (pathname === '/manager/login') {
      setIsOpen(false);
    }
  }, [pathname]);

  const openPanel = React.useCallback(() => setIsOpen(true), []);
  const closePanel = React.useCallback(() => setIsOpen(false), []);
  const togglePanel = React.useCallback(() => setIsOpen((prev) => !prev), []);
  const triggerViewAllFilter = React.useCallback(() => setViewAllTick((prev) => prev + 1), []);

  const contextValue = React.useMemo(
    () => ({
      isOpen,
      openPanel,
      closePanel,
      togglePanel,
      ongoingCount: hasError ? 0 : ongoingCount,
      ongoingRequests,
      loading,
      hasError,
      retry: typeof retry === 'function' ? retry : () => {},
      viewAllTick,
      triggerViewAllFilter,
    }),
    [
      isOpen,
      openPanel,
      closePanel,
      togglePanel,
      hasError,
      ongoingCount,
      ongoingRequests,
      loading,
      retry,
      viewAllTick,
      triggerViewAllFilter,
    ]
  );

  return (
    <ManagerOngoingRequestsContext.Provider value={contextValue}>
      {children}
    </ManagerOngoingRequestsContext.Provider>
  );
}

export function useManagerOngoingRequests() {
  return React.useContext(ManagerOngoingRequestsContext);
}

export function ManagerOngoingRequestsButton({ onInteractChange }) {
  const { openPanel, ongoingCount, hasError } = useManagerOngoingRequests();
  const showBadge = !hasError && ongoingCount > 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        showBadge
          ? `Open ongoing requests monitor, ${ongoingCount} active`
          : 'Open ongoing requests monitor'
      }
      dataSet={{ bluetapCta: 'true' }}
      onHoverIn={() => onInteractChange?.(true)}
      onHoverOut={() => onInteractChange?.(false)}
      onPressIn={() => onInteractChange?.(true)}
      onPressOut={() => onInteractChange?.(false)}
      onPress={openPanel}
      style={({ hovered, pressed }) => [
        styles.floatingButton,
        hovered && styles.floatingButtonHovered,
        pressed && styles.floatingButtonPressed,
      ]}
    >
      <SidebarIcon name="ClipboardList" size={24} tintColor="#FFFFFF" />
      {showBadge ? (
        <View style={styles.floatingBadge}>
          <Text style={styles.floatingBadgeText}>
            {ongoingCount > 99 ? '99+' : ongoingCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function DeliveryProgressTrack({ order, colors, isDark }) {
  const progress = React.useMemo(() => getOngoingDeliveryProgress(order), [order]);
  const failureReason = formatDeliveryFailureReason(order, '');

  if (progress.isException) {
    return (
      <View
        style={[
          styles.exceptionBox,
          {
            backgroundColor: isDark ? 'rgba(239, 68, 68, 0.14)' : colors.dangerSoft || '#FEF2F2',
            borderColor: isDark ? 'rgba(248, 113, 113, 0.4)' : '#FECACA',
          },
        ]}
      >
        <Text
          style={[
            styles.exceptionTitle,
            { color: isDark ? '#FCA5A5' : colors.danger || '#B91C1C' },
          ]}
        >
          Delivery Issue Reported
        </Text>
        <Text style={[styles.exceptionCopy, { color: colors.textSecondary }]}>
          {failureReason
            ? `Distributor note: ${failureReason}`
            : 'This delivery reported an exception and awaits Manager review or reassignment in the Dispatch Queue.'}
        </Text>
      </View>
    );
  }

  if (!progress.linearSupported) {
    return null;
  }

  return (
    <View
      style={[
        styles.progressContainer,
        {
          backgroundColor: isDark ? 'rgba(15, 23, 42, 0.45)' : colors.surfaceAlt || '#F8FAFC',
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.progressHeaderRow}>
        <Text style={[styles.progressHeaderLabel, { color: colors.textSecondary }]}>
          Delivery Progress
        </Text>
        <Text style={[styles.progressStepSummary, { color: colors.primary }]}>
          Step {progress.activeStepIndex + 1} of {progress.steps.length}
        </Text>
      </View>
      <View style={styles.progressStepsRow}>
        {progress.steps.map((step, index) => {
          const isReached = step.completed || step.current;
          const dotBg = step.completed
            ? BLUETAP_COLORS.success || '#10B981'
            : step.current
            ? BLUETAP_COLORS.primary
            : isDark
            ? '#1E3A5F'
            : '#CBD5E1';
          const labelColor = step.current
            ? colors.textPrimary
            : step.completed
            ? colors.textSecondary
            : colors.textMuted || colors.textSecondary;

          return (
            <View key={step.key} style={styles.progressStepItem}>
              <View style={styles.progressTrackLineRow}>
                <View
                  style={[
                    styles.progressLineSegment,
                    index === 0 && styles.progressLineHidden,
                    {
                      backgroundColor: isReached
                        ? BLUETAP_COLORS.primary
                        : isDark
                        ? '#1E3A5F'
                        : '#E2E8F0',
                    },
                  ]}
                />
                <View
                  style={[
                    styles.progressDot,
                    { backgroundColor: dotBg },
                    step.current && {
                      borderWidth: 2,
                      borderColor: isDark ? '#7DD3FC' : '#BAE6FD',
                    },
                  ]}
                />
                <View
                  style={[
                    styles.progressLineSegment,
                    index === progress.steps.length - 1 && styles.progressLineHidden,
                    {
                      backgroundColor: step.completed
                        ? BLUETAP_COLORS.primary
                        : isDark
                        ? '#1E3A5F'
                        : '#E2E8F0',
                    },
                  ]}
                />
              </View>
              <Text
                numberOfLines={2}
                style={[
                  styles.progressStepLabel,
                  {
                    color: labelColor,
                    fontWeight: step.current ? '800' : step.completed ? '700' : '600',
                  },
                ]}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function OngoingRequestCard({ order, colors, isDark, onViewDetails }) {
  const statusTone = resolveStatusToneColors(order.status, colors, isDark);
  const statusLabel = formatOngoingStatusLabel(order.status);
  const { productName, quantityLabel } = formatProductDetails(order);
  const distributorIdLabel = formatDisplayUniqueId(
    order.assignedDistributorUniqueId || order.distributorUniqueId || order.assignedDistributorUid,
    'Not available'
  );
  const requesterIdLabel = formatDisplayUniqueId(order.requesterUniqueId, '');
  const scheduleSummary = formatScheduledDeliverySummary(order);
  const lastUpdateLabel = formatDateTimeValue(order.lastStatusUpdateAt, 'Not available');
  const containerLabel = String(order.container || '').trim() || 'Not available';
  const addressLabel = String(order.address || '').trim() || 'Not available';

  return (
    <View
      style={[
        styles.requestCard,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      {/* Top Row: Request ID + Customer & Status Pill */}
      <View style={styles.cardTopRow}>
        <View style={styles.cardIdentityCol}>
          <Text style={[styles.requestIdText, { color: colors.primary }]}>
            #{order.requestId || order.id}
          </Text>
          <Text style={[styles.customerNameText, { color: colors.textPrimary }]}>
            {order.requesterName || 'Requester'}
            {requesterIdLabel ? (
              <Text style={[styles.customerUidInline, { color: colors.textSecondary }]}>
                {` · ${requesterIdLabel}`}
              </Text>
            ) : null}
          </Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: statusTone.bg,
              borderColor: statusTone.border,
            },
          ]}
        >
          <Text style={[styles.statusBadgeText, { color: statusTone.text }]}>
            {statusLabel}
          </Text>
        </View>
      </View>

      {/* Assigned Distributor Banner */}
      <View
        style={[
          styles.distributorStrip,
          {
            backgroundColor: isDark ? 'rgba(29, 120, 193, 0.14)' : colors.primarySoft || '#F0F9FF',
            borderColor: isDark ? 'rgba(56, 189, 248, 0.28)' : '#BAE6FD',
          },
        ]}
      >
        <SidebarIcon
          name="Truck"
          size={16}
          tintColor={isDark ? '#7DD3FC' : BLUETAP_COLORS.primary}
        />
        <View style={styles.distributorStripCopy}>
          <Text style={[styles.distributorStripLabel, { color: colors.textSecondary }]}>
            Assigned Distributor
          </Text>
          <Text style={[styles.distributorStripValue, { color: colors.textPrimary }]}>
            {order.assignedDistributorName || 'Assigned Distributor'}
            {distributorIdLabel && distributorIdLabel !== 'Not available' ? (
              <Text style={[styles.distributorIdInline, { color: colors.textSecondary }]}>
                {` (${distributorIdLabel})`}
              </Text>
            ) : null}
          </Text>
        </View>
      </View>

      {/* Delivery Details Grid */}
      <View style={[styles.detailsGrid, { borderColor: colors.border }]}>
        <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Product</Text>
          <Text style={[styles.detailValue, { color: colors.textPrimary }]}>{productName}</Text>
        </View>
        <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
            Quantity & Container
          </Text>
          <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
            {quantityLabel} · {containerLabel}
          </Text>
        </View>
        <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
            Scheduled Delivery
          </Text>
          <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
            {scheduleSummary}
          </Text>
        </View>
        <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
            Delivery Address
          </Text>
          <Text numberOfLines={2} style={[styles.detailValue, { color: colors.textPrimary }]}>
            {addressLabel}
          </Text>
        </View>
        <View style={styles.detailRowLast}>
          <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
            Last Status Update
          </Text>
          <Text style={[styles.detailValue, { color: colors.textSecondary }]}>
            {lastUpdateLabel}
          </Text>
        </View>
      </View>

      {/* Delivery Progress Indicator */}
      <DeliveryProgressTrack order={order} colors={colors} isDark={isDark} />

      {/* Read-Only Card Action */}
      <View style={styles.cardFooterRow}>
        <Text style={[styles.readOnlyHint, { color: colors.textSecondary }]}>
          Read-only delivery monitor
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`View details for request ${order.requestId || order.id}`}
          onPress={() => onViewDetails(order)}
          style={[
            styles.viewDetailsButton,
            {
              backgroundColor: isDark ? 'rgba(29, 120, 193, 0.2)' : colors.surfaceAlt || '#F1F5F9',
              borderColor: isDark ? '#38BDF8' : colors.primary,
            },
          ]}
        >
          <Text
            style={[
              styles.viewDetailsButtonText,
              { color: isDark ? '#7DD3FC' : colors.primary },
            ]}
          >
            View Details
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function ManagerOngoingRequestsPanel() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors, resolvedTheme } = useAdminTheme();
  const isDark = resolvedTheme === 'dark';
  const isDesktopDrawer = width >= 720;
  const compactFooter = width < 420;
  const { navigateOnce } = useSingleFlightNavigation();

  const {
    isOpen,
    closePanel,
    ongoingRequests,
    ongoingCount,
    loading,
    hasError,
    retry,
    triggerViewAllFilter,
  } = useManagerOngoingRequests();
  const { branch } = useManagerRealtimeData();

  const requestDetails = useCurrentPageRequestDetails(ongoingRequests);
  const slideAnim = React.useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    AccessibilityInfo?.isReduceMotionEnabled?.()
      .then((enabled) => {
        if (mounted) setReduceMotion(Boolean(enabled));
      })
      .catch(() => {});
    const sub = AccessibilityInfo?.addEventListener?.('reduceMotionChanged', (enabled) => {
      setReduceMotion(Boolean(enabled));
    });
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  React.useEffect(() => {
    if (!isOpen) {
      slideAnim.setValue(0);
      return;
    }
    if (reduceMotion) {
      slideAnim.setValue(1);
      return;
    }
    slideAnim.setValue(0);
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [isOpen, reduceMotion, slideAnim]);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || !isOpen || typeof window === 'undefined') return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !requestDetails.requestDetailsVisible) {
        closePanel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closePanel, requestDetails.requestDetailsVisible]);

  const handleViewAll = React.useCallback(() => {
    closePanel();
    triggerViewAllFilter();
    navigateOnce('/manager/request?filter=ongoing');
  }, [closePanel, navigateOnce, triggerViewAllFilter]);

  if (!isOpen) return null;

  const drawerWidth = isDesktopDrawer ? Math.min(460, Math.max(340, width - 32)) : width;
  const mobileSheetHeight = Math.max(
    360,
    Math.min(
      Math.floor(height * 0.88),
      Math.max(360, height - Math.max(20, insets.top + 12))
    )
  );
  const animatedPanelStyle = isDesktopDrawer
    ? {
        opacity: slideAnim,
        transform: [
          {
            translateX: slideAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [28, 0],
            }),
          },
        ],
      }
    : {
        opacity: slideAnim,
        transform: [
          {
            translateY: slideAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [24, 0],
            }),
          },
        ],
      };

  return (
    <>
      <Modal
        visible={isOpen}
        transparent
        animationType="none"
        onRequestClose={closePanel}
      >
        <View
          style={[
            styles.overlay,
            isDesktopDrawer ? styles.overlayDesktop : styles.overlayMobile,
            { backgroundColor: colors.overlay || 'rgba(8, 24, 39, 0.52)' },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close ongoing requests backdrop"
            onPress={closePanel}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View
            style={[
              styles.panel,
              isDesktopDrawer
                ? [
                    styles.panelDesktop,
                    {
                      width: drawerWidth,
                      height: height || '100%',
                      maxHeight: height || '100%',
                      backgroundColor: colors.background || colors.surface,
                      borderLeftColor: colors.border,
                    },
                  ]
                : [
                    styles.panelMobile,
                    {
                      height: mobileSheetHeight,
                      maxHeight: mobileSheetHeight,
                      backgroundColor: colors.background || colors.surface,
                      borderColor: colors.border,
                    },
                  ],
              animatedPanelStyle,
            ]}
          >
            {/* 1. Fixed Header */}
            <View
              style={[
                styles.header,
                {
                  backgroundColor: colors.surface,
                  borderBottomColor: colors.border,
                  paddingTop: isDesktopDrawer ? Math.max(18, insets.top + 12) : 18,
                },
              ]}
            >
              <View style={styles.headerTitleCol}>
                <View style={styles.headerTitleRow}>
                  <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
                    Ongoing Requests
                  </Text>
                  {!hasError && !loading ? (
                    <View
                      style={[
                        styles.activeCountPill,
                        {
                          backgroundColor: isDark
                            ? 'rgba(56, 189, 248, 0.18)'
                            : colors.primarySoft || '#E0F2FE',
                          borderColor: isDark ? 'rgba(56, 189, 248, 0.4)' : '#BAE6FD',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.activeCountPillText,
                          { color: isDark ? '#7DD3FC' : colors.primary },
                        ]}
                      >
                        {ongoingCount} active
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                  Monitor active water deliveries.
                </Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close ongoing requests panel"
                activeOpacity={0.8}
                onPress={closePanel}
                style={[
                  styles.closeIconButton,
                  {
                    backgroundColor: isDark ? '#163B59' : '#E2EEF8',
                    borderColor: isDark ? '#38BDF8' : '#7FB8E6',
                  },
                ]}
              >
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.closeIconGlyph,
                    { color: isDark ? '#F5FAFF' : '#0B4F8A' },
                  ]}
                >
                  ✕
                </Text>
              </TouchableOpacity>
            </View>

            {/* 2. Scrollable Body */}
            <View style={styles.bodyViewport}>
              <ScrollView
                style={styles.bodyScroll}
                contentContainerStyle={styles.bodyScrollContent}
                showsVerticalScrollIndicator
              >
                {loading && ongoingRequests.length === 0 ? (
                  <View
                    style={[
                      styles.stateCard,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                  >
                    <ActivityIndicator size="small" color={BLUETAP_COLORS.primary} />
                    <Text style={[styles.stateTitle, { color: colors.textPrimary }]}>
                      Loading ongoing deliveries...
                    </Text>
                    <Text style={[styles.stateDescription, { color: colors.textSecondary }]}>
                      Synchronizing assigned branch requests in real time.
                    </Text>
                  </View>
                ) : hasError ? (
                  <View
                    style={[
                      styles.stateCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: isDark ? 'rgba(248, 113, 113, 0.45)' : '#FCA5A5',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.stateTitle,
                        { color: isDark ? '#FCA5A5' : colors.danger || '#B91C1C' },
                      ]}
                    >
                      Unable to load ongoing requests
                    </Text>
                    <Text style={[styles.stateDescription, { color: colors.textSecondary }]}>
                      Branch delivery records could not be retrieved right now. Please try again.
                    </Text>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Retry loading ongoing requests"
                      dataSet={{ bluetapCta: 'true' }}
                      onPress={retry}
                      style={[
                        styles.retryButton,
                        {
                          backgroundColor: isDark ? '#1D78C1' : BLUETAP_COLORS.primary,
                          borderColor: isDark ? '#38BDF8' : BLUETAP_COLORS.primaryDark,
                        },
                      ]}
                    >
                      <Text style={styles.retryButtonText}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : ongoingRequests.length === 0 ? (
                  <View
                    style={[
                      styles.emptyStateWrap,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                  >
                    <BlueTapEmptyState
                      icon="truck"
                      title="No ongoing requests"
                      description="Assigned deliveries will appear here once they are in progress."
                      compact
                    />
                  </View>
                ) : (
                  ongoingRequests.map((order) => (
                    <OngoingRequestCard
                      key={order.id}
                      order={order}
                      colors={colors}
                      isDark={isDark}
                      onViewDetails={(selected) => requestDetails.openRequestDetails(selected)}
                    />
                  ))
                )}
              </ScrollView>
            </View>

            {/* 3. Fixed Footer Actions */}
            <View
              style={[
                styles.footer,
                compactFooter && styles.footerCompact,
                {
                  backgroundColor: colors.surface,
                  borderTopColor: colors.border,
                  paddingBottom: Math.max(16, insets.bottom + 12),
                },
              ]}
            >
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close monitor"
                activeOpacity={0.85}
                onPress={closePanel}
                style={[
                  styles.footerSecondaryButton,
                  compactFooter && styles.footerButtonFull,
                  {
                    backgroundColor: isDark ? '#112A40' : colors.surfaceAlt || '#EEF3F7',
                    borderColor: isDark ? '#285173' : '#CBD5E1',
                  },
                ]}
              >
                <Text style={[styles.footerSecondaryButtonText, { color: colors.textPrimary }]}>
                  Close
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="View all ongoing requests"
                activeOpacity={0.88}
                dataSet={{ bluetapCta: 'true' }}
                onPress={handleViewAll}
                style={[
                  styles.footerPrimaryButton,
                  compactFooter && styles.footerButtonFull,
                  {
                    backgroundColor: isDark ? '#1D78C1' : BLUETAP_COLORS.primary,
                    borderColor: isDark ? '#38BDF8' : BLUETAP_COLORS.primaryDark,
                  },
                ]}
              >
                <Text style={styles.footerPrimaryButtonText}>View All Requests</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>

      <RequestDetailsModal
        visible={requestDetails.requestDetailsVisible}
        request={requestDetails.selectedRequest}
        branches={branch ? [branch] : []}
        onClose={requestDetails.closeRequestDetails}
      />
    </>
  );
}

const styles = StyleSheet.create({
  floatingButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: BLUETAP_COLORS.primary,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    ...createShadow({
      color: '#081827',
      elevation: 6,
      offset: { width: 0, height: 4 },
      opacity: 0.2,
      radius: 12,
    }),
  },
  floatingButtonHovered: {
    transform: [{ scale: 1.03 }],
  },
  floatingButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  floatingBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    backgroundColor: BLUETAP_COLORS.danger,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  overlay: {
    flex: 1,
  },
  overlayDesktop: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  overlayMobile: {
    justifyContent: 'flex-end',
  },
  panel: {
    flexDirection: 'column',
    overflow: 'hidden',
    ...createShadow({
      color: '#04101C',
      elevation: 16,
      offset: { width: 0, height: 8 },
      opacity: 0.28,
      radius: 24,
    }),
  },
  panelDesktop: {
    height: '100%',
    borderLeftWidth: 1,
  },
  panelMobile: {
    width: '100%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    flexShrink: 0,
    zIndex: 2,
  },
  headerTitleCol: {
    flex: 1,
    minWidth: 0,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    fontWeight: '600',
  },
  activeCountPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  activeCountPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  closeIconButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  closeIconGlyph: {
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 20,
    textAlign: 'center',
  },
  bodyViewport: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    overflow: 'hidden',
  },
  bodyScroll: {
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
  bodyScrollContent: {
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 32,
    gap: 16,
    flexGrow: 1,
  },
  stateCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  stateTitle: {
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 4,
  },
  stateDescription: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 10,
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  emptyStateWrap: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  requestCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
    gap: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  cardIdentityCol: {
    flex: 1,
    minWidth: 160,
  },
  requestIdText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  customerNameText: {
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
    flexShrink: 1,
  },
  customerUidInline: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  distributorStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
  },
  distributorStripCopy: {
    flex: 1,
    minWidth: 0,
  },
  distributorStripLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  distributorStripValue: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 1,
    flexShrink: 1,
  },
  distributorIdInline: {
    fontSize: 12,
    fontWeight: '700',
  },
  detailsGrid: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailRowLast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 0,
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '800',
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
  },
  progressContainer: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressHeaderLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  progressStepSummary: {
    fontSize: 11,
    fontWeight: '800',
  },
  progressStepsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  progressStepItem: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
  },
  progressTrackLineRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 5,
  },
  progressLineSegment: {
    flex: 1,
    height: 2,
  },
  progressLineHidden: {
    backgroundColor: 'transparent',
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  progressStepLabel: {
    fontSize: 10,
    lineHeight: 13,
    textAlign: 'center',
    paddingHorizontal: 2,
  },
  exceptionBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  exceptionTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  exceptionCopy: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  readOnlyHint: {
    fontSize: 11,
    fontWeight: '600',
  },
  viewDetailsButton: {
    minHeight: 38,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewDetailsButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    borderTopWidth: 1,
    flexShrink: 0,
    zIndex: 2,
    ...createShadow({
      color: '#04101C',
      elevation: 6,
      offset: { width: 0, height: -3 },
      opacity: 0.08,
      radius: 10,
    }),
  },
  footerCompact: {
    flexDirection: 'column-reverse',
    alignItems: 'stretch',
    gap: 10,
  },
  footerButtonFull: {
    width: '100%',
    flex: 0,
  },
  footerSecondaryButton: {
    minHeight: 46,
    minWidth: 108,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerSecondaryButtonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  footerPrimaryButton: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerPrimaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
});
