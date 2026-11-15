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
import OngoingRequestFieldIcon from './OngoingRequestFieldIcon';
import RequestDetailsModal from './RequestDetailsModal';
import SidebarIcon from './SidebarIcon';
import { getSoftStatusMeta } from './SoftStatusBadge';
import { createShadow } from './shadowStyles';
import useCurrentPageRequestDetails from './useCurrentPageRequestDetails';
import useSingleFlightNavigation from './useSingleFlightNavigation';
import { parseTimestamp } from '../services/notificationTimestamp';
import { formatDisplayUniqueId } from '../services/uniqueIds';

const {
  getOngoingDeliveryProgress,
  splitOngoingManagerOrders,
  statusOf,
} = require('../services/managerOperational');
const { formatDeliveryFailureReason } = require('../constants/deliveryFailureReasons');
const {
  groupOrdersIntoTrips,
  describeOrderCargo,
  aggregateCargoItems,
} = require('../services/managerTripCapacity');

const defaultContextValue = {
  isOpen: false,
  requestedSegment: 'active',
  openPanel: () => {},
  closePanel: () => {},
  togglePanel: () => {},
  ongoingCount: 0,
  activeDeliveriesCount: 0,
  scheduledCount: 0,
  failedDeliveriesCount: 0,
  tripsCount: 0,
  activeTripsCount: 0,
  scheduledTripsCount: 0,
  overdueTripsCount: 0,
  totalTripOrdersCount: 0,
  trips: [],
  ongoingRequests: [],
  activeDeliveries: [],
  scheduledOrders: [],
  failedDeliveries: [],
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
    tone: 'assigned',
  },
  assigned: {
    label: 'Assigned to Distributor',
    tone: 'assigned',
  },
  accepted: {
    label: 'Distributor Accepted',
    tone: 'assigned',
  },
  scheduled: {
    label: 'Scheduled for Delivery',
    tone: 'scheduled',
  },
  rescheduled: {
    label: 'Rescheduled Delivery',
    tone: 'scheduled',
  },
  out_for_delivery: {
    label: 'Out for Delivery',
    tone: 'active_delivery',
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

export function resolveStatusToneColors(status, colors, isDark) {
  const normalized = statusOf(status);
  if (typeof getSoftStatusMeta === 'function') {
    const sharedMeta = getSoftStatusMeta(normalized || status, { isDark });
    if (sharedMeta && sharedMeta.backgroundColor && sharedMeta.color) {
      return {
        bg: sharedMeta.backgroundColor,
        border: sharedMeta.borderColor || sharedMeta.color,
        text: sharedMeta.color,
      };
    }
  }
  const tone = STATUS_META[normalized]?.tone || 'assigned';
  if (tone === 'danger') {
    return {
      bg: isDark ? '#3B181A' : colors?.dangerSoft || '#FEF2F2',
      border: isDark ? '#DC2626' : '#FCA5A5',
      text: isDark ? '#F87171' : colors?.danger || '#B91C1C',
    };
  }
  if (tone === 'success') {
    return {
      bg: isDark ? '#0F392B' : colors?.successSoft || '#ECFDF5',
      border: isDark ? '#059669' : '#86EFAC',
      text: isDark ? '#34D399' : colors?.success || '#047857',
    };
  }
  if (tone === 'active_delivery') {
    return {
      bg: isDark ? '#0C4A6E' : colors?.primarySoft || '#E0F2FE',
      border: isDark ? '#0284C7' : '#7DD3FC',
      text: isDark ? '#38BDF8' : colors?.primary || '#0369A1',
    };
  }
  if (tone === 'scheduled') {
    return {
      bg: isDark ? '#431407' : '#FFF3E6',
      border: isDark ? '#EA580C' : '#FDBA74',
      text: isDark ? '#FB923C' : '#9A4D00',
    };
  }
  return {
    bg: isDark ? '#133554' : '#EFF6FF',
    border: isDark ? '#2563EB' : '#BFDBFE',
    text: isDark ? '#60A5FA' : '#1D4ED8',
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

export function ManagerOngoingRequestsProvider({ children, initialOpen = false, initialSegment = 'active' }) {
  const pathname = usePathname();
  const {
    ongoingRequests = [],
    ongoingCount = 0,
    loading = false,
    error = '',
    errors = {},
    retry,
  } = useManagerRealtimeData();
  const [isOpen, setIsOpen] = React.useState(initialOpen);
  const [requestedSegment, setRequestedSegment] = React.useState(initialSegment);
  const [viewAllTick, setViewAllTick] = React.useState(0);

  const hasError = Boolean(errors?.requests || (error && ongoingRequests.length === 0));
  const split = React.useMemo(
    () => splitOngoingManagerOrders(ongoingRequests),
    [ongoingRequests]
  );

  const trips = React.useMemo(() => {
    if (!Array.isArray(ongoingRequests) || ongoingRequests.length === 0) return [];
    return groupOrdersIntoTrips(ongoingRequests);
  }, [ongoingRequests]);

  const overdueTripsCount = React.useMemo(() => {
    return trips.filter((t) => t.isOverdue).length;
  }, [trips]);

  const activeTripsCount = React.useMemo(() => {
    return trips.filter(
      (t) =>
        !t.isOverdue &&
        (t.status === 'in_transit' ||
          (Array.isArray(t.orders) && t.orders.some((o) => statusOf(o.status) === 'out_for_delivery')))
    ).length;
  }, [trips]);

  const scheduledTripsCount = React.useMemo(() => {
    return trips.filter(
      (t) =>
        !t.isOverdue &&
        t.status !== 'in_transit' &&
        !(Array.isArray(t.orders) && t.orders.some((o) => statusOf(o.status) === 'out_for_delivery'))
    ).length;
  }, [trips]);

  const totalTripOrdersCount = React.useMemo(() => {
    if (!Array.isArray(trips) || trips.length === 0) return 0;
    const seenOrderIds = new Set();
    for (const trip of trips) {
      if (Array.isArray(trip.orders)) {
        for (const order of trip.orders) {
          const id = String(order?.id || order?.requestId || order?._id || '').trim();
          if (id) {
            seenOrderIds.add(id);
          } else {
            seenOrderIds.add(order);
          }
        }
      }
    }
    return seenOrderIds.size;
  }, [trips]);

  const tripsCount = trips.length;

  React.useEffect(() => {
    if (pathname === '/manager/login') {
      setIsOpen(false);
    }
  }, [pathname]);

  const openPanel = React.useCallback((segment = 'active') => {
    setRequestedSegment(['active', 'scheduled', 'exceptions', 'trips'].includes(segment) ? segment : 'active');
    setIsOpen(true);
  }, []);
  const closePanel = React.useCallback(() => setIsOpen(false), []);
  const togglePanel = React.useCallback(() => setIsOpen((prev) => !prev), []);
  const triggerViewAllFilter = React.useCallback(() => setViewAllTick((prev) => prev + 1), []);

  const contextValue = React.useMemo(
    () => ({
      isOpen,
      openPanel,
      requestedSegment,
      closePanel,
      togglePanel,
      ongoingCount: hasError ? 0 : ongoingCount || split.ongoingCount,
      activeDeliveriesCount: hasError ? 0 : split.activeDeliveriesCount,
      scheduledCount: hasError ? 0 : split.scheduledCount,
      failedDeliveriesCount: hasError ? 0 : split.failedDeliveriesCount,
      tripsCount: hasError ? 0 : tripsCount,
      activeTripsCount: hasError ? 0 : activeTripsCount,
      scheduledTripsCount: hasError ? 0 : scheduledTripsCount,
      overdueTripsCount: hasError ? 0 : overdueTripsCount,
      totalTripOrdersCount: hasError ? 0 : totalTripOrdersCount,
      trips,
      ongoingRequests,
      activeDeliveries: split.activeDeliveries,
      scheduledOrders: split.scheduledOrders,
      failedDeliveries: split.failedDeliveries,
      loading,
      hasError,
      retry: typeof retry === 'function' ? retry : () => {},
      viewAllTick,
      triggerViewAllFilter,
    }),
    [
      isOpen,
      openPanel,
      requestedSegment,
      closePanel,
      togglePanel,
      hasError,
      ongoingCount,
      split,
      trips,
      tripsCount,
      activeTripsCount,
      scheduledTripsCount,
      overdueTripsCount,
      totalTripOrdersCount,
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

export function DeliveryProgressTrack({ order, colors, isDark }) {
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
          const isFirstStep = index === 0;
          const isLastStep = index === progress.steps.length - 1;
          const isDelivered = statusOf(order?.status) === 'delivered' || progress.activeStepIndex === 3;
          const hasReachedThisStep = progress.activeStepIndex >= index || isDelivered;
          const successColor = isDark ? '#10B981' : (typeof BLUETAP_COLORS !== 'undefined' && BLUETAP_COLORS?.success) || '#1F9D61';
          const primaryColor = (typeof BLUETAP_COLORS !== 'undefined' && BLUETAP_COLORS?.primary) || '#187BCD';
          const inactiveLineColor = isDark ? '#1E3A5F' : '#CBD5E1';

          // Leading segment before Assigned (index === 0) starts green from the actual left edge of the track.
          // For subsequent steps, the segment before the dot is green if progress has reached or passed this step.
          const leftSegmentBg = isFirstStep ? successColor : (hasReachedThisStep ? successColor : inactiveLineColor);

          // Trailing segment after the final step (Delivered) is hidden (transparent) so it does not extend beyond the track.
          // For prior steps, the segment after the dot is green if this step has been completed.
          const rightSegmentBg = isLastStep ? 'transparent' : (step.completed ? successColor : inactiveLineColor);

          const dotBg = step.completed
            ? successColor
            : step.current
            ? primaryColor
            : isDark
            ? '#1E3A5F'
            : '#E2E8F0';
          const dotBorderColor = step.completed
            ? isDark
              ? '#34D399'
              : '#16824E'
            : step.current
            ? isDark
              ? '#7DD3FC'
              : '#BAE6FD'
            : isDark
            ? '#334155'
            : '#CBD5E1';
          const labelColor = step.current
            ? colors.textPrimary
            : step.completed
            ? isDark
              ? '#34D399'
              : '#16824E'
            : colors.textMuted || colors.textSecondary;
          const stepStateLabel = step.completed
            ? 'completed'
            : step.current
            ? 'current'
            : 'upcoming';

          return (
            <View
              key={step.key}
              accessibilityLabel={`Step ${index + 1}: ${step.label}, ${stepStateLabel}`}
              style={styles.progressStepItem}
            >
              <View style={styles.progressTrackLineRow}>
                <View
                  style={[
                    styles.progressLineSegment,
                    isFirstStep && styles.progressLineSegmentFirst,
                    {
                      backgroundColor: leftSegmentBg,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.progressDot,
                    {
                      backgroundColor: dotBg,
                      borderColor: dotBorderColor,
                      borderWidth: step.current ? 2.5 : 1.5,
                    },
                  ]}
                >
                  {step.completed ? (
                    <Text allowFontScaling={false} style={styles.progressCheckGlyph}>
                      {'\u2713'}
                    </Text>
                  ) : step.current ? (
                    <View style={styles.progressCurrentInnerDot} />
                  ) : null}
                </View>
                <View
                  style={[
                    styles.progressLineSegment,
                    isLastStep && styles.progressLineHidden,
                    {
                      backgroundColor: rightSegmentBg,
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
  const distributorIconColor = isDark
    ? colors.iconPrimary || '#7DD3FC'
    : colors.primaryDark || BLUETAP_COLORS.primaryDark || '#0B4F8A';
  const detailIconColor = isDark
    ? colors.iconMuted || '#9FB4C8'
    : colors.textSecondary || '#4A6378';

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
          <View style={[styles.statusBadgeDot, { backgroundColor: statusTone.text }]} />
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
            backgroundColor: isDark ? 'rgba(29, 120, 193, 0.16)' : colors.primarySoft || '#F0F9FF',
            borderColor: isDark ? 'rgba(56, 189, 248, 0.32)' : '#BAE6FD',
          },
        ]}
      >
        <View
          style={[
            styles.distributorIconWrap,
            {
              backgroundColor: isDark ? 'rgba(56, 189, 248, 0.18)' : '#D8EEFF',
              borderColor: isDark ? 'rgba(125, 211, 252, 0.38)' : '#93C5FD',
            },
          ]}
        >
          <SidebarIcon
            name="Truck"
            size={16}
            color={distributorIconColor}
            tintColor={distributorIconColor}
          />
        </View>
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
          <View style={styles.detailLabelWrap}>
            <OngoingRequestFieldIcon
              name="Package"
              size={16}
              color={detailIconColor}
              tintColor={detailIconColor}
            />
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Product</Text>
          </View>
          <Text style={[styles.detailValue, { color: colors.textPrimary }]}>{productName}</Text>
        </View>
        <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
          <View style={styles.detailLabelWrap}>
            <OngoingRequestFieldIcon
              name="Layers"
              size={16}
              color={detailIconColor}
              tintColor={detailIconColor}
            />
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
              Quantity & Container
            </Text>
          </View>
          <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
            {quantityLabel} · {containerLabel}
          </Text>
        </View>
        <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
          <View style={styles.detailLabelWrap}>
            <OngoingRequestFieldIcon
              name="CalendarClock"
              size={16}
              color={detailIconColor}
              tintColor={detailIconColor}
            />
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
              Scheduled Delivery
            </Text>
          </View>
          <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
            {scheduleSummary}
          </Text>
        </View>
        <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
          <View style={styles.detailLabelWrap}>
            <OngoingRequestFieldIcon
              name="MapPin"
              size={16}
              color={detailIconColor}
              tintColor={detailIconColor}
            />
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
              Delivery Address
            </Text>
          </View>
          <Text numberOfLines={2} style={[styles.detailValue, { color: colors.textPrimary }]}>
            {addressLabel}
          </Text>
        </View>
        <View style={styles.detailRowLast}>
          <View style={styles.detailLabelWrap}>
            <OngoingRequestFieldIcon
              name="ClockHistory"
              size={16}
              color={detailIconColor}
              tintColor={detailIconColor}
            />
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
              Last Status Update
            </Text>
          </View>
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

export function OngoingTripCard({ trip, colors, isDark, onViewDetails, isTwoColumn = false }) {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const distIconColor = isDark
    ? colors?.iconPrimary || '#7DD3FC'
    : colors?.primaryDark || (typeof BLUETAP_COLORS !== 'undefined' ? BLUETAP_COLORS?.primaryDark : null) || '#0B4F8A';

  const distributorUidLabel = formatDisplayUniqueId(trip.distributorUniqueId, '');

  const isOverdue = Boolean(trip.isOverdue);
  const isOutForDelivery = Array.isArray(trip.orders) && trip.orders.some((o) => statusOf(o.status) === 'out_for_delivery');
  const isTransit = (trip.status === 'in_transit' || isOutForDelivery) && !isOverdue;
  const isFailed = trip.status === 'delivery_failed' || (Array.isArray(trip.orders) && trip.orders.some((o) => statusOf(o.status) === 'delivery_failed'));
  const isCompleted = trip.status === 'completed';

  const statusLabel = trip.isLegacyUnverified
    ? 'Unverified Legacy'
    : isOverdue
    ? (isOutForDelivery || trip.status === 'in_transit' || trip.status === 'overdue_delivery' ? 'Overdue Delivery' : 'Overdue Scheduled')
    : isTransit
    ? 'In Transit'
    : isFailed
    ? 'Delivery Issue'
    : isCompleted
    ? 'Delivered'
    : 'Scheduled';

  const statusTone = isOverdue
    ? {
        bg: isDark ? 'rgba(245, 158, 11, 0.15)' : '#FFFBEB',
        border: isDark ? 'rgba(245, 158, 11, 0.4)' : '#FDE68A',
        text: isDark ? '#FBBF24' : '#B45309',
      }
    : isTransit
    ? {
        bg: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ECFDF5',
        border: isDark ? 'rgba(16, 185, 129, 0.4)' : '#A7F3D0',
        text: isDark ? '#34D399' : '#059669',
      }
    : isFailed
    ? {
        bg: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEF2F2',
        border: isDark ? 'rgba(239, 68, 68, 0.35)' : '#FECACA',
        text: isDark ? '#F87171' : colors.danger || '#DC2626',
      }
    : trip.isLegacyUnverified
    ? {
        bg: isDark ? 'rgba(245, 158, 11, 0.15)' : '#FFFBEB',
        border: isDark ? 'rgba(245, 158, 11, 0.4)' : '#FDE68A',
        text: isDark ? '#FBBF24' : '#B45309',
      }
    : {
        bg: isDark ? 'rgba(56, 189, 248, 0.12)' : '#F0F9FF',
        border: isDark ? 'rgba(56, 189, 248, 0.35)' : '#BAE6FD',
        text: isDark ? '#38BDF8' : '#0369A1',
      };

  const tripDisplayId = trip.isLegacyUnverified
    ? 'Legacy Assignment'
    : `Trip #${trip.tripNumber}`;

  return (
    <View
      style={[
        styles.tripCard,
        isTwoColumn && (isExpanded ? styles.tripCardFullRow : styles.tripCardHalf),
        {
          backgroundColor: colors.surface,
          borderColor: isFailed
            ? (isDark ? 'rgba(239, 68, 68, 0.4)' : '#FCA5A5')
            : colors.border,
        },
      ]}
    >
      <View style={styles.tripCardTopRow}>
        <View style={styles.tripIdCol}>
          <Text style={[styles.tripIdText, { color: colors.primary }]}>
            {tripDisplayId}
          </Text>
          <Text style={[styles.tripFullScheduleText, { color: isOverdue ? (isDark ? '#FBBF24' : '#B45309') : colors.textSecondary }]}>
            {trip.fullScheduleLabel || 'Unscheduled'}
          </Text>
        </View>
        <View style={styles.tripStatusBadgesCol}>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: statusTone.bg,
                borderColor: statusTone.border,
              },
            ]}
          >
            <View style={[styles.statusBadgeDot, { backgroundColor: statusTone.text }]} />
            <Text style={[styles.statusBadgeText, { color: statusTone.text }]}>
              {statusLabel}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.distributorCompactRow}>
        <SidebarIcon
          name="Truck"
          size={13}
          color={distIconColor}
          tintColor={distIconColor}
        />
        <Text numberOfLines={1} style={[styles.distributorCompactText, { color: colors.textPrimary }]}>
          <Text style={[styles.distributorCompactLabel, { color: colors.textSecondary }]}>Distributor: </Text>
          {trip.distributorName}
          {distributorUidLabel ? (
            <Text style={[styles.distributorIdInline, { color: colors.textSecondary }]}>
              {` (${distributorUidLabel})`}
            </Text>
          ) : null}
        </Text>
      </View>

      <View
        style={[
          styles.tripMetricsBar,
          {
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.45)' : colors.surfaceAlt || '#F8FAFC',
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.tripMetricItem}>
          <Text style={[styles.tripMetricVal, { color: colors.textPrimary }]}>
            {trip.orders?.length || 0}
          </Text>
          <Text style={[styles.tripMetricLbl, { color: colors.textSecondary }]}>Orders</Text>
        </View>
        <View style={[styles.tripMetricDivider, { backgroundColor: colors.border }]} />
        <View style={styles.tripMetricItem}>
          <Text style={[styles.tripMetricVal, { color: colors.primary }]}>
            {`${trip.totalContainers}/60`}
          </Text>
          <Text style={[styles.tripMetricLbl, { color: colors.textSecondary }]}>5-Gal Used</Text>
        </View>
        <View style={[styles.tripMetricDivider, { backgroundColor: colors.border }]} />
        <View style={styles.tripMetricItem}>
          <Text
            style={[
              styles.tripMetricVal,
              {
                color:
                  trip.otherCargoCount > 0
                    ? isDark
                      ? '#38BDF8'
                      : colors.primary || '#0284C7'
                    : colors.textSecondary,
              },
            ]}
          >
            {trip.otherCargoCount > 0 ? `+${trip.otherCargoCount}` : '0'}
          </Text>
          <Text style={[styles.tripMetricLbl, { color: colors.textSecondary }]}>Other Cargo</Text>
        </View>
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={
          isExpanded
            ? `Collapse details for ${tripDisplayId}`
            : `Expand details for ${tripDisplayId}`
        }
        activeOpacity={0.8}
        onPress={() => setIsExpanded((prev) => !prev)}
        style={[
          styles.tripExpandButton,
          {
            backgroundColor: isDark ? 'rgba(29, 120, 193, 0.16)' : colors.surfaceAlt || '#F1F5F9',
            borderColor: isDark ? '#38BDF8' : colors.primary,
          },
        ]}
      >
        <Text style={[styles.tripExpandButtonText, { color: isDark ? '#7DD3FC' : colors.primary }]}>
          {isExpanded
            ? '▲ Hide Trip Orders'
            : `▼ View ${trip.orders?.length || 0} Assigned Order${trip.orders?.length === 1 ? '' : 's'}`}
        </Text>
      </TouchableOpacity>

      {isExpanded ? (
        <View style={[styles.tripExpandedSection, { borderTopColor: colors.border }]}>
          {trip.isOverdue ? (
            <View
              style={[
                styles.tripNoticeBox,
                {
                  backgroundColor: isDark ? 'rgba(245, 158, 11, 0.08)' : '#FFFBEB',
                  borderColor: isDark ? 'rgba(245, 158, 11, 0.28)' : '#FDE68A',
                },
              ]}
            >
              <Text style={[styles.tripNoticeTitle, { color: isDark ? '#FBBF24' : '#B45309' }]}>
                ⚠️ Overdue Delivery Trip
              </Text>
              <Text style={[styles.tripNoticeCopy, { color: colors.textSecondary }]}>
                Past scheduled delivery window without recorded completion. Follow-up advised.
              </Text>
            </View>
          ) : trip.isLegacyUnverified ? (
            <View
              style={[
                styles.tripNoticeBox,
                {
                  backgroundColor: isDark ? 'rgba(217, 119, 6, 0.12)' : '#FFFBEB',
                  borderColor: isDark ? 'rgba(251, 191, 36, 0.35)' : '#FDE68A',
                },
              ]}
            >
              <Text style={[styles.tripNoticeTitle, { color: isDark ? '#FBBF24' : '#B45309' }]}>
                ⚠️ Unverified Legacy Assignment
              </Text>
              <Text style={[styles.tripNoticeCopy, { color: colors.textSecondary }]}>
                This delivery lacks an authoritative trip identifier or schedule. Review or reschedule in Manager Dispatch.
              </Text>
            </View>
          ) : null}

          {trip.otherCargoSummary ? (
            <View
              style={[
                styles.otherCargoSummaryBox,
                {
                  backgroundColor: isDark ? 'rgba(147, 51, 234, 0.10)' : '#FAF5FF',
                  borderColor: isDark ? 'rgba(168, 85, 247, 0.25)' : '#E9D5FF',
                },
              ]}
            >
              <Text style={[styles.otherCargoSummaryTitle, { color: isDark ? '#C084FC' : '#7E22CE' }]}>
                📦 Other Cargo Breakdown:
              </Text>
              <Text style={[styles.otherCargoSummaryText, { color: colors.textPrimary }]}>
                {aggregateCargoItems ? aggregateCargoItems(trip.otherCargoSummary.split(', ')) : trip.otherCargoSummary}
              </Text>
            </View>
          ) : null}

          <Text style={[styles.assignedOrdersTitle, { color: colors.textSecondary }]}>
            ASSIGNED DELIVERIES ({trip.orders?.length || 0})
          </Text>

          <View style={styles.ordersListWrap}>
            {trip.orders.map((order) => {
              const orderCargo = describeOrderCargo(order);
              const orderStatusTone = resolveStatusToneColors(order.status, colors, isDark);
              const orderStatusLabel = formatOngoingStatusLabel(order.status);
              const orderRequesterId = formatDisplayUniqueId(order.requesterUniqueId, '');

              return (
                <View
                  key={order.id}
                  style={[
                    styles.tripOrderItemCard,
                    {
                      backgroundColor: isDark ? 'rgba(15, 23, 42, 0.5)' : colors.surface || '#FFFFFF',
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.tripOrderItemTopRow}>
                    <View style={styles.tripOrderIdentityCol}>
                      <Text style={[styles.tripOrderNumber, { color: colors.primary }]}>
                        #{order.requestId || order.id}
                      </Text>
                      <Text style={[styles.tripOrderRequester, { color: colors.textPrimary }]}>
                        {order.requesterName || 'Requester'}
                        {orderRequesterId ? (
                          <Text style={[styles.customerUidInline, { color: colors.textSecondary }]}>
                            {` · ${orderRequesterId}`}
                          </Text>
                        ) : null}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor: orderStatusTone.bg,
                          borderColor: orderStatusTone.border,
                        },
                      ]}
                    >
                      <View style={[styles.statusBadgeDot, { backgroundColor: orderStatusTone.text }]} />
                      <Text style={[styles.statusBadgeText, { color: orderStatusTone.text }]}>
                        {orderStatusLabel}
                      </Text>
                    </View>
                  </View>

                  <Text numberOfLines={1} style={[styles.tripOrderAddress, { color: colors.textSecondary }]}>
                    📍 {order.address || 'Address not available'}
                  </Text>

                  <View
                    style={[
                      styles.tripOrderCargoRow,
                      { backgroundColor: isDark ? 'rgba(30, 41, 59, 0.5)' : '#F8FAFC' },
                    ]}
                  >
                    <Text style={[styles.tripOrderCargoLabel, { color: colors.textPrimary }]}>
                      {orderCargo.summary}
                    </Text>
                  </View>

                  <View style={styles.tripOrderActionsRow}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`View details for order ${order.requestId || order.id}`}
                      activeOpacity={0.8}
                      onPress={() => onViewDetails(order)}
                      style={[
                        styles.tripOrderDetailsBtn,
                        {
                          backgroundColor: isDark ? 'rgba(29, 120, 193, 0.2)' : colors.surfaceAlt || '#F1F5F9',
                          borderColor: isDark ? '#38BDF8' : colors.primary,
                        },
                      ]}
                    >
                      <Text style={[styles.tripOrderDetailsBtnText, { color: isDark ? '#7DD3FC' : colors.primary }]}>
                        View Order Details
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
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
    requestedSegment,
    ongoingRequests,
    activeDeliveries = [],
    scheduledOrders = [],
    failedDeliveries = [],
    trips = [],
    activeDeliveriesCount = 0,
    scheduledCount = 0,
    failedDeliveriesCount = 0,
    tripsCount = 0,
    activeTripsCount = 0,
    scheduledTripsCount = 0,
    overdueTripsCount = 0,
    totalTripOrdersCount = 0,
    loading,
    hasError,
    retry,
    triggerViewAllFilter,
  } = useManagerOngoingRequests();
  const { branch } = useManagerRealtimeData();

  const requestDetails = useCurrentPageRequestDetails(ongoingRequests);
  const slideAnim = React.useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = React.useState(false);
  const [isFullView, setIsFullView] = React.useState(false);
  const [selectedSegment, setSelectedSegment] = React.useState(requestedSegment || 'active');
  const visibleSegmentOrders =
    selectedSegment === 'scheduled'
      ? scheduledOrders
      : selectedSegment === 'exceptions'
      ? failedDeliveries
      : selectedSegment === 'trips'
      ? []
      : activeDeliveries;

  const handleClosePanel = React.useCallback(() => {
    setIsFullView(false);
    closePanel();
  }, [closePanel]);

  const handleOpenDispatch = React.useCallback(() => {
    handleClosePanel();
    navigateOnce('/manager/distributors');
  }, [handleClosePanel, navigateOnce]);

  React.useEffect(() => {
    if (isOpen) setSelectedSegment(requestedSegment);
  }, [isOpen, requestedSegment]);

  React.useEffect(() => {
    if (!isOpen) {
      setIsFullView(false);
    }
  }, [isOpen]);

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
        handleClosePanel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClosePanel, requestDetails.requestDetailsVisible]);

  const handleViewAll = React.useCallback(() => {
    handleClosePanel();
    triggerViewAllFilter();
    navigateOnce('/manager/request?filter=ongoing');
  }, [handleClosePanel, navigateOnce, triggerViewAllFilter]);

  if (!isOpen) return null;

  const standardDrawerWidth = isDesktopDrawer ? Math.min(460, Math.max(340, width - 32)) : width;
  const fullViewDrawerWidth = isDesktopDrawer ? Math.min(1080, Math.max(760, width - 40)) : width;
  const drawerWidth = isFullView ? fullViewDrawerWidth : standardDrawerWidth;

  const standardMobileSheetHeight = Math.max(
    360,
    Math.min(
      Math.floor(height * 0.88),
      Math.max(360, height - Math.max(20, insets.top + 12))
    )
  );
  const fullViewMobileSheetHeight = Math.max(360, height - Math.max(10, insets.top));
  const mobileSheetHeight = isFullView ? fullViewMobileSheetHeight : standardMobileSheetHeight;
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
        onRequestClose={handleClosePanel}
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
            onPress={handleClosePanel}
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
                      accessibilityLabel={`${activeDeliveriesCount} active, ${scheduledCount} scheduled, ${tripsCount} trips`}
                      style={styles.headerSummaryRow}
                    >
                      <Text style={[styles.headerSummaryText, { color: isDark ? '#38BDF8' : colors.primary }]}>
                        {activeDeliveriesCount} active · {scheduledCount} scheduled · {tripsCount} trips
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                  Monitor active water deliveries.
                </Text>
              </View>
              <View style={styles.headerRightActions}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={isFullView ? 'Restore standard drawer view' : 'Expand to full view'}
                  activeOpacity={0.8}
                  onPress={() => setIsFullView((prev) => !prev)}
                  style={[
                    styles.fullViewButton,
                    {
                      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(24, 123, 205, 0.10)',
                      borderColor: isDark ? '#38BDF8' : '#187BCD',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.fullViewButtonText,
                      { color: isDark ? '#38BDF8' : '#187BCD' },
                    ]}
                  >
                    {isFullView ? '⤡ Restore' : '⤢ Full View'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close ongoing requests panel"
                  activeOpacity={0.8}
                  onPress={handleClosePanel}
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
            </View>

            {/* Segmented Control: Active Deliveries | Scheduled */}
            {!hasError && !loading ? (
              <View
                style={[
                  styles.segmentedHeaderWrap,
                  {
                    backgroundColor: colors.surface,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <View
                  accessibilityRole="tablist"
                  style={[
                    styles.segmentedTrack,
                    {
                      backgroundColor: isDark ? '#0A1928' : colors.surfaceAlt || '#EEF3F7',
                      borderColor: colors.border,
                    },
                  ]}
                >
                  {[
                    {
                      key: 'active',
                      label: `Active Deliveries (${activeDeliveriesCount})`,
                      displayLabel: `Active (${activeDeliveriesCount})`,
                      count: activeDeliveriesCount,
                    },
                    {
                      key: 'scheduled',
                      label: `Scheduled (${scheduledCount})`,
                      displayLabel: `Scheduled (${scheduledCount})`,
                      count: scheduledCount,
                    },
                    {
                      key: 'exceptions',
                      label: `Exceptions (${failedDeliveriesCount})`,
                      displayLabel: `Exceptions (${failedDeliveriesCount})`,
                      count: failedDeliveriesCount,
                    },
                    {
                      key: 'trips',
                      label: `Trips (${tripsCount})`,
                      displayLabel: `Trips (${tripsCount})`,
                      count: tripsCount,
                    },
                  ].map((segment) => {
                    const selected = selectedSegment === segment.key;
                    return (
                      <Pressable
                        key={segment.key}
                        accessibilityRole="tab"
                        accessibilityLabel={segment.label}
                        accessibilityState={{ selected }}
                        onPress={() => setSelectedSegment(segment.key)}
                        style={[
                          styles.segmentTab,
                          selected && [
                            styles.segmentTabSelected,
                            {
                              backgroundColor: isDark ? '#163B59' : colors.surface || '#FFFFFF',
                              borderColor: isDark ? '#38BDF8' : colors.primary,
                            },
                          ],
                        ]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.segmentTabText,
                            {
                              color: selected
                                ? isDark
                                  ? '#F5FAFF'
                                  : colors.primary
                                : colors.textSecondary,
                              fontWeight: selected ? '900' : '700',
                            },
                          ]}
                        >
                          {segment.displayLabel}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

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
                ) : selectedSegment === 'trips' ? (
                  trips.length === 0 ? (
                    <View
                      style={[
                        styles.emptyStateWrap,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                    >
                      <BlueTapEmptyState
                        icon="truck"
                        title="No delivery trips"
                        description="Assigned delivery trips will appear here when distributors have active or scheduled routes."
                        compact
                      />
                    </View>
                  ) : (
                    <>
                      <View
                        style={[
                          styles.tripsOverviewBanner,
                          {
                            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.55)' : colors.surfaceAlt || '#F8FAFC',
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <View style={styles.tripsOverviewMainRow}>
                          <View style={styles.tripsKpiGrid}>
                            <View style={styles.tripsKpiInlineItem}>
                              <Text style={[styles.tripsKpiValueCompact, { color: isDark ? '#38BDF8' : colors.primary || '#0284C7' }]}>
                                {activeTripsCount}
                              </Text>
                              <Text style={[styles.tripsKpiLabelCompact, { color: colors.textSecondary }]}>Active Trips</Text>
                            </View>
                            <Text style={[styles.tripsKpiDot, { color: colors.border }]}>·</Text>
                            <View style={styles.tripsKpiInlineItem}>
                              <Text style={[styles.tripsKpiValueCompact, { color: isDark ? '#38BDF8' : '#0284C7' }]}>
                                {scheduledTripsCount}
                              </Text>
                              <Text style={[styles.tripsKpiLabelCompact, { color: colors.textSecondary }]}>Scheduled</Text>
                            </View>
                            {overdueTripsCount > 0 ? (
                              <>
                                <Text style={[styles.tripsKpiDot, { color: colors.border }]}>·</Text>
                                <View style={styles.tripsKpiInlineItem}>
                                  <Text style={[styles.tripsKpiValueCompact, { color: isDark ? '#FBBF24' : '#D97706' }]}>
                                    {overdueTripsCount}
                                  </Text>
                                  <Text style={[styles.tripsKpiLabelCompact, { color: isDark ? '#FBBF24' : '#B45309' }]}>Overdue</Text>
                                </View>
                              </>
                            ) : null}
                            <Text style={[styles.tripsKpiDot, { color: colors.border }]}>·</Text>
                            <View style={styles.tripsKpiInlineItem}>
                              <Text style={[styles.tripsKpiValueCompact, { color: isDark ? '#C084FC' : '#9333EA' }]}>
                                {totalTripOrdersCount}
                              </Text>
                              <Text style={[styles.tripsKpiLabelCompact, { color: colors.textSecondary }]}>Assigned Orders</Text>
                            </View>
                          </View>

                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel="Open Manager Dispatch"
                            activeOpacity={0.8}
                            onPress={handleOpenDispatch}
                            style={[
                              styles.dispatchLinkButton,
                              {
                                backgroundColor: isDark ? 'rgba(29, 120, 193, 0.22)' : colors.surface || '#FFFFFF',
                                borderColor: isDark ? '#38BDF8' : colors.primary,
                              },
                            ]}
                          >
                            <SidebarIcon
                              name="Truck"
                              size={13}
                              color={isDark ? '#7DD3FC' : colors.primary}
                              tintColor={isDark ? '#7DD3FC' : colors.primary}
                            />
                            <Text
                              style={[
                                styles.dispatchLinkText,
                                { color: isDark ? '#7DD3FC' : colors.primary },
                              ]}
                            >
                              Open Manager Dispatch →
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={isFullView && isDesktopDrawer ? styles.tripsGridDesktop : styles.tripsListSingleColumn}>
                        {trips.map((trip) => (
                          <OngoingTripCard
                            key={trip.tripId}
                            trip={trip}
                            colors={colors}
                            isDark={isDark}
                            isTwoColumn={isFullView && isDesktopDrawer}
                            onViewDetails={(selected) => requestDetails.openRequestDetails(selected)}
                          />
                        ))}
                      </View>
                    </>
                  )
                ) : ongoingRequests.length === 0 && selectedSegment === 'active' ? (
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
                ) : visibleSegmentOrders.length === 0 ? (
                  <View
                    style={[
                      styles.emptyStateWrap,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                  >
                    {selectedSegment === 'exceptions' ? (
                      <BlueTapEmptyState
                        icon="truck"
                        title="No delivery exceptions"
                        description="Failed deliveries requiring follow-up will appear here."
                        compact
                      />
                    ) : selectedSegment === 'scheduled' ? (
                      <BlueTapEmptyState
                        icon="schedule"
                        title="No scheduled orders"
                        description="Assigned and scheduled orders awaiting delivery start will appear here."
                        compact
                      />
                    ) : (
                      <BlueTapEmptyState
                        icon="truck"
                        title="No active deliveries"
                        description="No orders are currently out for delivery. Check the Scheduled tab for upcoming assigned deliveries."
                        compact
                      />
                    )}
                  </View>
                ) : (
                  visibleSegmentOrders.map((order) => (
                    <OngoingRequestCard
                      key={order.id}
                      order={order}
                      colors={colors}
                      isDark={isDark}
                      onViewDetails={(selected) => requestDetails.openRequestDetails(selected)}
                    />
                  ))
                )}

                {/* Preserve Manager visibility for delivery_failed exceptions without presenting them as normal active deliveries */}
                {!loading && !hasError && selectedSegment !== 'exceptions' && selectedSegment !== 'trips' && failedDeliveries.length > 0 ? (
                  <View style={styles.failedSectionWrap}>
                    <View
                      style={[
                        styles.failedSectionHeader,
                        {
                          backgroundColor: isDark ? '#3B181A' : '#FEF2F2',
                          borderColor: isDark ? '#DC2626' : '#FCA5A5',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.failedSectionTitle,
                          { color: isDark ? '#F87171' : '#B91C1C' },
                        ]}
                      >
                        Delivery Exceptions · Needs Rescheduling ({failedDeliveries.length})
                      </Text>
                      <Text style={[styles.failedSectionSubtitle, { color: colors.textSecondary }]}>
                        These assigned orders reported a delivery issue and are not currently out for delivery.
                      </Text>
                    </View>
                    {failedDeliveries.map((order) => (
                      <OngoingRequestCard
                        key={order.id}
                        order={order}
                        colors={colors}
                        isDark={isDark}
                        onViewDetails={(selected) => requestDetails.openRequestDetails(selected)}
                      />
                    ))}
                  </View>
                ) : null}
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
  headerBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  headerSummaryRow: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  headerSummaryText: {
    fontSize: 11,
    fontWeight: '800',
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
  scheduledCountPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  scheduledCountPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  failedCountPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  failedCountPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  tripsCountPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  tripsCountPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  failedSectionWrap: {
    gap: 12,
    marginTop: 4,
  },
  failedSectionHeader: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  failedSectionTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  failedSectionSubtitle: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  segmentedHeaderWrap: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: 1,
    flexShrink: 0,
  },
  segmentedTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
    gap: 4,
  },
  segmentTab: {
    flex: 1,
    minHeight: 38,
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentTabSelected: {
    borderWidth: 1,
  },
  segmentTabText: {
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  fullViewButton: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullViewButtonText: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  statusBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
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
  distributorIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
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
  detailLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 0,
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
    marginBottom: 6,
  },
  progressLineSegment: {
    flex: 1,
    height: 3,
  },
  progressLineSegmentFirst: {
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
  },
  progressLineHidden: {
    backgroundColor: 'transparent',
  },
  progressDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  progressCheckGlyph: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  progressCurrentInnerDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FFFFFF',
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
  tripsOverviewBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  tripsOverviewMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  tripsKpiGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  tripsKpiInlineItem: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  tripsKpiValueCompact: {
    fontSize: 13,
    fontWeight: '900',
  },
  tripsKpiLabelCompact: {
    fontSize: 11,
    fontWeight: '700',
  },
  tripsKpiDot: {
    fontSize: 11,
    fontWeight: '900',
  },
  tripsKpiCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tripsKpiValue: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  tripsKpiLabel: {
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  dispatchLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  dispatchLinkText: {
    fontSize: 11,
    fontWeight: '800',
  },
  tripsGridDesktop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'flex-start',
    width: '100%',
  },
  tripsListSingleColumn: {
    flexDirection: 'column',
    gap: 12,
    width: '100%',
  },
  tripCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  tripCardHalf: {
    width: Platform.OS === 'web' ? 'calc(50% - 8px)' : '48%',
    maxWidth: Platform.OS === 'web' ? 'calc(50% - 8px)' : '48%',
    flexGrow: 0,
    flexShrink: 0,
  },
  tripCardFullRow: {
    width: '100%',
    maxWidth: '100%',
    flexBasis: '100%',
    flexGrow: 1,
  },
  tripCardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  tripIdCol: {
    flex: 1,
    minWidth: 120,
  },
  tripIdText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.1,
  },
  tripFullScheduleText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  tripStatusBadgesCol: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    justifyContent: 'flex-end',
  },
  loadVerificationPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  loadVerificationPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  distributorCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 1,
  },
  distributorCompactText: {
    fontSize: 11.5,
    fontWeight: '700',
    flex: 1,
  },
  distributorCompactLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  tripMetricsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  tripMetricItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripMetricVal: {
    fontSize: 12,
    fontWeight: '900',
  },
  tripMetricLbl: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
  },
  tripMetricDivider: {
    width: 1,
    height: 18,
  },
  tripNoticeBox: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 2,
  },
  tripNoticeTitle: {
    fontSize: 10.5,
    fontWeight: '900',
  },
  tripNoticeCopy: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
  },
  tripExpandButton: {
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripExpandButtonText: {
    fontSize: 11,
    fontWeight: '800',
  },
  tripExpandedSection: {
    borderTopWidth: 1,
    paddingTop: 8,
    gap: 8,
  },
  otherCargoSummaryBox: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 3,
  },
  otherCargoSummaryTitle: {
    fontSize: 11,
    fontWeight: '800',
  },
  otherCargoSummaryText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  assignedOrdersTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  ordersListWrap: {
    gap: 10,
  },
  tripOrderItemCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  tripOrderItemTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  tripOrderIdentityCol: {
    flex: 1,
    minWidth: 120,
  },
  tripOrderNumber: {
    fontSize: 11,
    fontWeight: '900',
  },
  tripOrderRequester: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 1,
  },
  tripOrderAddress: {
    fontSize: 11,
    fontWeight: '600',
  },
  tripOrderCargoRow: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  tripOrderCargoLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  tripOrderActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 2,
  },
  tripOrderDetailsBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripOrderDetailsBtnText: {
    fontSize: 11,
    fontWeight: '800',
  },
});
