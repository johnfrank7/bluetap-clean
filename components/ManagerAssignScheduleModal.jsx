import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAdminTheme } from './AdminTheme';
import { ManagerPill } from './ManagerShell';
import DropdownChevron from './DropdownChevron';
import ManagerTripCapacity from './ManagerTripCapacity';
import { getProfileUniqueId } from '../services/uniqueIds';
import { effectiveDeliveryDays, isAllowedDeliveryDate, manilaScheduleDate } from '../services/productOrderPolicy';
import {
  TIME_SLOT_OPTIONS,
  TRIP_MAX_CONTAINERS,
  analyzeOrderCargo,
  getActiveDistributorOrders,
  getDistributorWorkloadSummary,
  getSlotCapacityInfo,
  groupOrdersIntoTrips,
} from '../services/managerTripCapacity';

const formatAmount = (amount) => `₱${Number(amount || 0).toFixed(2)}`;

const orderProducts = (order) =>
  order?.items?.map((item) => `${item.quantity} × ${item.productNameSnapshot || item.name || 'Item'}`).filter(Boolean).join(', ') ||
  'Order products';

const orderDistance = (order) =>
  order?.distanceKmSnapshot == null ? 'Distance unavailable' : `Approx. ${Number(order.distanceKmSnapshot).toFixed(1)} km`;

function buildScheduleDate(dayOffset, slot) {
  if (!slot || typeof slot.hours !== 'number') return null;
  return manilaScheduleDate(dayOffset, slot.hours, slot.minutes || 0);
}

function formatScheduleDateDisplay(date) {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return 'Select date';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

const allowedDayOffsets = (order) => {
  if (!order) return [0, 1];
  const days = Array.isArray(order.effectiveDeliveryDaysSnapshot)
    ? order.effectiveDeliveryDaysSnapshot
    : effectiveDeliveryDays(order.items || []);
  return Array.from({ length: 14 }, (_, index) => index).filter((offset) =>
    isAllowedDeliveryDate(buildScheduleDate(offset, TIME_SLOT_OPTIONS[0]), days)
  );
};

const getCargoBadgeStyles = (styles, tone) => {
  switch (tone) {
    case 'orange':
      return { container: styles.cargoBadgeOrange, text: styles.cargoBadgeOrangeText };
    case 'purple':
      return { container: styles.cargoBadgePurple, text: styles.cargoBadgePurpleText };
    case 'warning':
      return { container: styles.cargoBadgeWarning, text: styles.cargoBadgeWarningText };
    case 'blue':
    default:
      return { container: styles.cargoBadgeBlue, text: styles.cargoBadgeBlueText };
  }
};

const getSlotBadgeStyle = (styles, tone) => {
  switch (tone) {
    case 'green':
      return styles.slotBadgeGreen;
    case 'purple':
      return styles.slotBadgePurple;
    case 'warning':
    case 'orange':
      return styles.slotBadgeOrange;
    case 'danger':
      return styles.slotBadgeDanger;
    case 'muted':
      return styles.slotBadgeMuted;
    case 'blue':
    default:
      return styles.slotBadgeBlue;
  }
};

const getSlotBadgeTextStyle = (styles, tone) => {
  switch (tone) {
    case 'green':
      return styles.slotBadgeGreenText;
    case 'purple':
      return styles.slotBadgePurpleText;
    case 'warning':
    case 'orange':
      return styles.slotBadgeOrangeText;
    case 'danger':
      return styles.slotBadgeDangerText;
    case 'muted':
      return styles.slotBadgeMutedText;
    case 'blue':
    default:
      return styles.slotBadgeBlueText;
  }
};

export default function ManagerAssignScheduleModal({
  visible = false,
  order = null,
  distributors = [],
  allOrders = [],
  colors: propColors,
  isDark: propIsDark,
  onClose,
  onSubmit,
  isSubmitting = false,
  initialDistributorUid = '',
  initialDayOffset = null,
  initialSlotIndex = null,
}) {
  const theme = useAdminTheme();
  const colors = propColors || theme.colors;
  const isDark = typeof propIsDark === 'boolean' ? propIsDark : theme.resolvedTheme === 'dark';
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors, width, isDark), [colors, width, isDark]);

  const [selectedDistributorUid, setSelectedDistributorUid] = useState(
    initialDistributorUid || order?.assignedDistributorUid || (distributors[0]?.uid || '')
  );
  const [selectedDayOffset, setSelectedDayOffset] = useState(() => {
    if (initialDayOffset !== null && initialDayOffset !== undefined) return initialDayOffset;
    const offsets = allowedDayOffsets(order);
    return offsets[0] ?? 0;
  });
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(() => {
    if (initialSlotIndex !== null && initialSlotIndex !== undefined) return initialSlotIndex;
    return 0;
  });
  const [dateSelectorOpen, setDateSelectorOpen] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [expandedWorkloadTrips, setExpandedWorkloadTrips] = useState(false);

  // Initialize and reset selections whenever a different order is targeted
  useEffect(() => {
    if (!visible || !order) return;

    setSelectedDistributorUid(
      initialDistributorUid || order.assignedDistributorUid || (distributors[0]?.uid || '')
    );
    setExpandedWorkloadTrips(false);
    setDateSelectorOpen(false);
    setScheduleError('');

    const offsets = allowedDayOffsets(order);
    const initialDay = initialDayOffset !== null ? initialDayOffset : (offsets[0] ?? 0);
    setSelectedDayOffset(initialDay);

    if (initialSlotIndex !== null) {
      setSelectedSlotIndex(initialSlotIndex);
    } else {
      let initialSlot = 0;
      const nowThreshold = Date.now() - 5 * 60 * 1000;
      const futureSlotIdx = TIME_SLOT_OPTIONS.findIndex((slot) => {
        const slotDate = buildScheduleDate(initialDay, slot);
        return slotDate && slotDate.getTime() >= nowThreshold;
      });

      if (futureSlotIdx >= 0) {
        initialSlot = futureSlotIdx;
      } else if (initialDay === 0 && offsets.length > 1) {
        setSelectedDayOffset(offsets[1]);
        initialSlot = 0;
      }
      setSelectedSlotIndex(initialSlot);
    }
  }, [visible, order?.id, initialDistributorUid, initialDayOffset, initialSlotIndex]);

  // Support ESC key to close modal
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, isSubmitting, onClose]);

  // Prevent background body scrolling while modal is open on web
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [visible]);

  if (!visible || !order) return null;

  const currentOrderCargo = analyzeOrderCargo(order);
  const currentOrderContainers = currentOrderCargo.standard5GallonCount;
  const cargoBadge = getCargoBadgeStyles(styles, currentOrderCargo.badgeTone);

  const selectedDistOrders = getActiveDistributorOrders(
    allOrders,
    selectedDistributorUid,
    order.id
  );
  const distWorkload = getDistributorWorkloadSummary({
    activeOrders: selectedDistOrders,
    distributorUid: selectedDistributorUid,
  });

  const distTrips = groupOrdersIntoTrips(selectedDistOrders, selectedDistributorUid);
  const currentSlot = TIME_SLOT_OPTIONS[selectedSlotIndex] || TIME_SLOT_OPTIONS[0];
  const currentScheduledAt = buildScheduleDate(selectedDayOffset, currentSlot);
  const targetTime = currentScheduledAt && !Number.isNaN(currentScheduledAt.getTime()) ? currentScheduledAt.getTime() : 0;

  const selectedSlotInfo = getSlotCapacityInfo({
    trips: distTrips,
    slotTime: targetTime,
    currentOrder: order,
  });

  const canSubmit = !isSubmitting &&
    Boolean(selectedDistributorUid) &&
    selectedSlotInfo.isEligible &&
    !selectedSlotInfo.isOverCapacity &&
    !selectedSlotInfo.hasTurnaroundConflict &&
    !selectedSlotInfo.hasUnknownCargo &&
    !selectedSlotInfo.isPastTime &&
    !currentOrderCargo.hasUnknownCargo;

  const submitButtonBg = !canSubmit
    ? (isDark ? 'rgba(148, 163, 184, 0.16)' : '#E2E8F0')
    : selectedSlotInfo.isExistingTrip
    ? (isDark ? '#059669' : '#15803D')
    : (isDark ? '#0284C7' : '#0B67AD');

  const submitButtonBorderColor = !canSubmit
    ? (isDark ? 'rgba(148, 163, 184, 0.28)' : '#CBD5E1')
    : selectedSlotInfo.isExistingTrip
    ? (isDark ? '#34D399' : '#166534')
    : (isDark ? '#38BDF8' : '#084B7D');

  const submitButtonTextColor = !canSubmit
    ? (isDark ? '#94A3B8' : '#64748B')
    : '#FFFFFF';

  const selectedDistributor = (distributors || []).find((d) => d.uid === selectedDistributorUid);
  const distributorName = selectedDistributor?.name ||
    selectedDistributor?.fullName ||
    order.assignedDistributorName ||
    selectedSlotInfo.trip?.distributorName ||
    '';

  const dayLabel = selectedDayOffset === 0
    ? 'Today'
    : selectedDayOffset === 1
    ? 'Tomorrow'
    : formatScheduleDateDisplay(buildScheduleDate(selectedDayOffset, TIME_SLOT_OPTIONS[0]));
  const scheduledDateLabel = `${dayLabel} · ${currentSlot.label}`;

  const handleClose = () => {
    if (isSubmitting) return;
    setDateSelectorOpen(false);
    onClose?.();
  };

  const handleFormSubmit = async () => {
    if (isSubmitting) return;
    if (!selectedDistributorUid) {
      setScheduleError('Please select a distributor.');
      return;
    }
    const slot = TIME_SLOT_OPTIONS[selectedSlotIndex] || TIME_SLOT_OPTIONS[0];
    const scheduledAt = buildScheduleDate(selectedDayOffset, slot);
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      setScheduleError('Please select a valid delivery schedule.');
      return;
    }
    if (!allowedDayOffsets(order).includes(selectedDayOffset)) {
      setScheduleError('These products have no common delivery day in this schedule. Ask Admin to update the product schedules.');
      return;
    }
    if (scheduledAt.getTime() < Date.now() - 5 * 60 * 1000) {
      setScheduleError('Please select a current or future delivery time slot.');
      return;
    }
    setScheduleError('');
    try {
      await onSubmit?.({
        order,
        distributorUid: selectedDistributorUid,
        scheduledAt,
        tripId: selectedSlotInfo.tripId || '',
        isReassign: Boolean(order.assignedDistributorUid),
      });
    } catch (err) {
      setScheduleError(err?.message || 'Failed to assign distributor.');
    }
  };

  const isAssigned = Boolean(order.assignedDistributorUid);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.modalCard} accessibilityViewIsModal>
          {/* Sticky Header */}
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderCopy}>
              <Text style={styles.modalEyebrow}>DISPATCH & SCHEDULING</Text>
              <Text style={styles.modalTitle}>Assign & Schedule Delivery</Text>
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {`Order #${order.requestId || order.id} · ${order.requesterName || 'Requester'} · ${order.currentBranchName || 'Current branch'}`}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close assignment modal"
              disabled={isSubmitting}
              onPress={handleClose}
              style={[styles.closeButton, isSubmitting && styles.actionDisabled]}
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Scrollable Content Area */}
          <ScrollView
            nestedScrollEnabled
            style={styles.modalScroll}
            contentContainerStyle={styles.modalContent}
            showsVerticalScrollIndicator
          >
            {/* Compact Order Summary */}
            <View style={styles.orderSummaryCard}>
              <View style={styles.orderSummaryTop}>
                <View style={styles.orderSummaryMeta}>
                  <Text style={styles.orderSummaryLabel}>CANDIDATE ORDER</Text>
                  <Text style={styles.orderSummaryProducts}>{orderProducts(order)}</Text>
                </View>
                <View style={styles.orderSummaryPricing}>
                  <Text style={styles.orderSummaryTotal}>{formatAmount(order.totalAtOrder)}</Text>
                  <ManagerPill tone={isAssigned ? 'green' : 'blue'}>
                    {isAssigned ? (order.status === 'delivery_failed' ? 'Delivery Failed' : 'Assigned') : 'Awaiting Assignment'}
                  </ManagerPill>
                </View>
              </View>

              <View style={styles.orderSummaryBottom}>
                <View style={[styles.containerBadge, cargoBadge.container]}>
                  <Text style={[styles.containerBadgeText, cargoBadge.text]}>{currentOrderCargo.badgeLabel}</Text>
                </View>
                <Text style={styles.orderSummaryAddress} numberOfLines={1}>
                  📍 {order.address || 'Address provided with order'} ({orderDistance(order)})
                </Text>
              </View>
            </View>

            {/* Step 1 — Select Available Distributor */}
            <View style={styles.stepSection}>
              <Text style={styles.stepTitle}>1. Select Available Distributor</Text>
              {distributors.length === 0 ? (
                <Text style={styles.emptyNote}>No eligible distributors currently found for this branch.</Text>
              ) : (
                <View style={styles.distributorList}>
                  {distributors.map((distributor) => {
                    const isSelected = selectedDistributorUid === distributor.uid;
                    const dOrders = getActiveDistributorOrders(allOrders, distributor.uid, order.id);
                    const dSummary = getDistributorWorkloadSummary({
                      activeOrders: dOrders,
                      distributorUid: distributor.uid,
                    });
                    const dUniqueId = getProfileUniqueId(distributor) || distributor.displayUid || distributor.uid || '—';

                    return (
                      <TouchableOpacity
                        key={distributor.uid}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => setSelectedDistributorUid(distributor.uid)}
                        style={[styles.distributorOption, isSelected && styles.distributorOptionSelected]}
                      >
                        <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                          {isSelected && <View style={styles.radioDot} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.distributorOptionHeader}>
                            <Text style={[styles.distributorName, isSelected && styles.distributorNameSelected]}>
                              {distributor.name || distributor.fullName || 'Distributor'}
                            </Text>
                            <View style={styles.distributorWorkloadPill}>
                              <Text style={styles.distributorWorkloadPillText}>
                                {dSummary.totalActiveOrders === 0
                                  ? 'Available · 0 active'
                                  : `${dSummary.totalActiveOrders} order${dSummary.totalActiveOrders === 1 ? '' : 's'} · ${dSummary.activeTripsCount} active trip${dSummary.activeTripsCount === 1 ? '' : 's'}`}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.distributorSub}>ID: {dUniqueId} · Eligible · This Branch</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Workload Summary Card for Selected Distributor */}
              {Boolean(selectedDistributorUid) && (
                <View style={styles.workloadCard}>
                  <View style={styles.workloadHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.workloadEyebrow}>DISTRIBUTOR WORKLOAD SUMMARY</Text>
                      <Text style={styles.workloadTitle}>{distributorName || 'Selected Distributor'}</Text>
                    </View>
                    <View style={styles.workloadBadge}>
                      <Text style={styles.workloadBadgeText}>
                        {distWorkload.activeTripsCount === 1 ? '1 Active Trip' : `${distWorkload.activeTripsCount} Active Trips`}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.workloadStatsGrid}>
                    <View style={styles.workloadStatItem}>
                      <Text style={styles.workloadStatValue}>{distWorkload.totalActiveOrders}</Text>
                      <Text style={styles.workloadStatLabel}>Active Orders</Text>
                    </View>
                    <View style={styles.workloadStatItem}>
                      <Text style={styles.workloadStatValue}>{distWorkload.activeTripsCount}</Text>
                      <Text style={styles.workloadStatLabel}>Active Trips</Text>
                    </View>
                    <View style={styles.workloadStatItem}>
                      <Text style={styles.workloadStatValue}>{distWorkload.total5GallonContainers}</Text>
                      <Text style={styles.workloadStatLabel}>5-Gal Loaded</Text>
                    </View>
                    <View style={styles.workloadStatItem}>
                      <Text style={styles.workloadStatValue}>{distWorkload.totalOtherCargoCount}</Text>
                      <Text style={styles.workloadStatLabel}>Other Cargo</Text>
                    </View>
                  </View>

                  {distWorkload.hasUnscheduledOrders && (
                    <View style={styles.workloadWarning}>
                      <Text style={styles.workloadWarningText}>
                        ⚠️ {distWorkload.unscheduledOrdersCount} assigned order(s) pending delivery schedule.
                      </Text>
                    </View>
                  )}

                  {distWorkload.hasOverdueTrips && (
                    <View style={styles.workloadWarning}>
                      <Text style={styles.workloadWarningText}>
                        ⚠️ {distWorkload.overdueTripsCount} active delivery trip(s) are overdue. Review trip status before assigning new orders.
                      </Text>
                    </View>
                  )}

                  {distWorkload.hasUnknownCargo && (
                    <View style={styles.workloadWarning}>
                      <Text style={styles.workloadWarningText}>
                        ⚠️ Unknown or unclassified cargo detected in distributor workload. Review product catalog before dispatch.
                      </Text>
                    </View>
                  )}

                  {distWorkload.activeTripsCount > 0 && (
                    <View style={styles.workloadTripsSection}>
                      <TouchableOpacity
                        onPress={() => setExpandedWorkloadTrips((prev) => !prev)}
                        style={styles.workloadToggle}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: expandedWorkloadTrips }}
                      >
                        <Text style={styles.workloadToggleText}>
                          {expandedWorkloadTrips
                            ? `Hide Active Trips (${distWorkload.activeTripsCount})`
                            : `View Active Trips (${distWorkload.activeTripsCount})`}
                        </Text>
                      </TouchableOpacity>

                      {expandedWorkloadTrips && (
                        <View style={styles.workloadTripsList}>
                          {distWorkload.activeTrips.map((trip) => (
                            <View key={trip.tripId} style={styles.workloadTripItem}>
                              <View style={styles.workloadTripTop}>
                                <Text style={styles.workloadTripNumber}>
                                  Trip #{trip.tripNumber} · {trip.isScheduled ? (trip.fullScheduleLabel || trip.timeLabel) : 'Unscheduled'}
                                  {trip.isOverdue ? ' · ⚠️ Overdue' : ''}
                                </Text>
                                <Text style={styles.workloadTripOrdersCount}>
                                  {trip.orders.length} order{trip.orders.length === 1 ? '' : 's'}
                                </Text>
                              </View>
                              <Text style={styles.workloadTripCargo}>
                                {trip.totalContainers}/60 5-gal
                                {trip.otherCargoCount > 0 ? ` + ${trip.otherCargoCount} other (${trip.otherCargoSummary})` : ''}
                                {trip.hasUnknownCargo ? ' · ⚠️ Needs Review' : ''}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Step 2 — Set Delivery Schedule */}
            <View style={styles.stepSection}>
              <Text style={styles.stepTitle}>2. Set Delivery Schedule</Text>
              <View style={styles.scheduleRow}>
                <Text style={styles.scheduleSubTitle}>Delivery Date:</Text>
                <View style={styles.dateSelectorWrap}>
                  <TouchableOpacity
                    accessibilityRole="combobox"
                    accessibilityState={{ expanded: dateSelectorOpen }}
                    onPress={() => setDateSelectorOpen((open) => !open)}
                    style={styles.dateSelector}
                  >
                    <Text style={styles.dateSelectorText}>{dayLabel}</Text>
                    <DropdownChevron expanded={dateSelectorOpen} size={16} color={colors.iconSecondary || colors.primary} />
                  </TouchableOpacity>

                  {dateSelectorOpen && (
                    <ScrollView nestedScrollEnabled style={styles.dateOptions}>
                      {allowedDayOffsets(order).map((index) => {
                        const label = index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : formatScheduleDateDisplay(buildScheduleDate(index, TIME_SLOT_OPTIONS[0]));
                        return (
                          <TouchableOpacity
                            key={label}
                            onPress={() => {
                              setSelectedDayOffset(index);
                              setDateSelectorOpen(false);
                            }}
                            style={[styles.dateOption, selectedDayOffset === index && styles.dateOptionActive]}
                          >
                            <Text style={[styles.dateOptionText, selectedDayOffset === index && styles.dateOptionTextActive]}>
                              {label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                      {!allowedDayOffsets(order).length && (
                        <Text style={styles.scheduleErrorText}>
                          The products in this order have no common delivery day. Ask Admin to update the product schedules.
                        </Text>
                      )}
                    </ScrollView>
                  )}

                  <View style={styles.quickDates}>
                    {[0, 1].filter((offset) => allowedDayOffsets(order).includes(offset)).map((offset) => (
                      <TouchableOpacity
                        key={offset}
                        onPress={() => {
                          setSelectedDayOffset(offset);
                          setDateSelectorOpen(false);
                        }}
                        style={[styles.quickDate, selectedDayOffset === offset && styles.quickDateActive]}
                      >
                        <Text style={[styles.quickDateText, selectedDayOffset === offset && styles.quickDateTextActive]}>
                          {offset === 0 ? 'Today' : 'Tomorrow'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              {/* Time Slot Selection Grid */}
              <View style={[styles.scheduleRow, { marginTop: 12 }]}>
                <Text style={styles.scheduleSubTitle}>Time Slot:</Text>
                <View style={styles.slotsGrid}>
                  {TIME_SLOT_OPTIONS.map((slot, index) => {
                    const slotDate = buildScheduleDate(selectedDayOffset, slot);
                    const slotTime = slotDate && !Number.isNaN(slotDate.getTime()) ? slotDate.getTime() : 0;
                    const slotInfo = getSlotCapacityInfo({
                      trips: distTrips,
                      slotTime,
                      currentOrder: order,
                    });
                    const isSelected = selectedSlotIndex === index;
                    const isExisting = slotInfo.isExistingTrip;
                    const isPassed = slotInfo.isPastTime;
                    const isConflict = slotInfo.hasTurnaroundConflict;
                    const isOver = slotInfo.isOverCapacity;
                    const isEligibleCoLoad = isExisting && slotInfo.isEligible;
                    const isEligibleNew = !isExisting && !isPassed && !isConflict && !isOver;

                    let slotTone = 'blue';
                    let statusLabel = 'Available';
                    if (isPassed) {
                      slotTone = 'muted';
                      statusLabel = 'Passed';
                    } else if (isConflict) {
                      slotTone = 'danger';
                      statusLabel = 'Conflict';
                    } else if (isExisting) {
                      if (isOver) {
                        slotTone = 'danger';
                        statusLabel = `Trip #${slotInfo.tripNumber} · Full`;
                      } else {
                        slotTone = 'green';
                        statusLabel = `Co-Load · Trip #${slotInfo.tripNumber}`;
                      }
                    } else {
                      slotTone = 'blue';
                      statusLabel = 'Available';
                    }

                    return (
                      <TouchableOpacity
                        key={slot.label}
                        accessibilityRole="button"
                        accessibilityLabel={`Delivery slot ${slot.label}`}
                        onPress={() => setSelectedSlotIndex(index)}
                        style={[
                          styles.slotCard,
                          isSelected && styles.slotCardSelected,
                          isPassed && styles.slotCardDisabled,
                        ]}
                      >
                        <View style={styles.slotCardHeader}>
                          <Text style={[styles.slotCardTime, isSelected && styles.slotCardTimeSelected]}>
                            {slot.label}
                          </Text>
                          <View style={[styles.slotBadge, getSlotBadgeStyle(styles, slotTone)]}>
                            <Text style={[styles.slotBadgeText, getSlotBadgeTextStyle(styles, slotTone)]}>
                              {statusLabel}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.slotCardBody}>
                          {isExisting ? (
                            <>
                              <Text style={styles.slotCardSub} numberOfLines={1}>
                                {slotInfo.assignedOrdersCount} order{slotInfo.assignedOrdersCount === 1 ? '' : 's'} · {slotInfo.usedContainers}/60 5-gal{slotInfo.hasOtherCargo ? ` · ${slotInfo.otherCargoCount} other` : ''}
                              </Text>
                              <Text
                                style={[
                                  styles.slotCardCapacity,
                                  isOver ? styles.slotCardCapacityOver : styles.slotCardCapacityOk,
                                ]}
                                numberOfLines={1}
                              >
                                {isEligibleCoLoad
                                  ? `✓ Co-load eligible (${slotInfo.remainingAfter} left)`
                                  : isOver
                                  ? `✕ Exceeds capacity by ${slotInfo.projectedContainers - slotInfo.maxCapacity}`
                                  : slotInfo.hasUnknownCargo
                                  ? '⚠️ Needs Review'
                                  : slotInfo.statusLabel}
                              </Text>
                            </>
                          ) : (
                            <>
                              <Text style={styles.slotCardSub} numberOfLines={1}>
                                {isPassed
                                  ? 'Slot passed for today'
                                  : isConflict
                                  ? `Overlaps with Trip #${slotInfo.conflictTrip?.tripNumber || ''}`
                                  : '0 orders · 0/60 5-gal'}
                              </Text>
                              <Text
                                style={[
                                  styles.slotCardCapacity,
                                  (isPassed || isConflict) ? styles.slotCardCapacityOver : styles.slotCardCapacityOk,
                                ]}
                                numberOfLines={1}
                              >
                                {isPassed
                                  ? 'Unavailable'
                                  : isConflict
                                  ? '✕ Turnaround conflict'
                                  : `✓ Available for new trip`}
                              </Text>
                            </>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* Step 3 — Trip Summary & Co-Loading Preview */}
            <View style={styles.stepSection}>
              <Text style={styles.stepTitle}>3. Trip Summary & Capacity</Text>
              <ManagerTripCapacity
                currentContainers={selectedSlotInfo.usedContainers}
                orderContainers={currentOrderContainers}
                orderCargo={currentOrderCargo}
                existingTripCargo={selectedSlotInfo.trip}
                hasOtherCargo={selectedSlotInfo.hasOtherCargo || currentOrderCargo.hasOtherCargo}
                otherCargoCount={selectedSlotInfo.otherCargoCount}
                otherCargoSummary={selectedSlotInfo.otherCargoSummary}
                isPhysicalLoadVerified={!selectedSlotInfo.hasUnknownCargo && !currentOrderCargo.hasUnknownCargo}
                maxCapacity={TRIP_MAX_CONTAINERS}
                colors={colors}
                isDark={isDark}
                conflict={selectedSlotInfo.hasTurnaroundConflict}
                conflictMessage={
                  selectedSlotInfo.conflictTrip
                    ? `Distributor already has Trip #${selectedSlotInfo.conflictTrip.tripNumber} scheduled that overlaps with this delivery window.`
                    : ''
                }
                isExistingTrip={selectedSlotInfo.isExistingTrip}
                tripNumber={selectedSlotInfo.tripNumber}
                slotLabel={currentSlot.label}
                assignedOrders={selectedSlotInfo.assignedOrders}
                explanation={selectedSlotInfo.explanation}
                distributorName={distributorName}
                scheduledDateLabel={scheduledDateLabel}
              />
            </View>

            {/* Schedule / Validation Error Alert */}
            {Boolean(scheduleError) && (
              <View accessibilityRole="alert" style={styles.modalAlert}>
                <Text style={styles.modalAlertText}>{scheduleError}</Text>
              </View>
            )}
          </ScrollView>

          {/* Sticky Footer */}
          <View style={styles.modalFooter}>
            <View style={styles.modalFooterCopy}>
              {canSubmit ? (
                <Text style={styles.modalFooterSuccess} numberOfLines={1}>
                  {selectedSlotInfo.isExistingTrip
                    ? `✓ Co-load Trip #${selectedSlotInfo.tripNumber} (${selectedSlotInfo.remainingAfter} left after add)`
                    : `✓ Ready to assign to ${distributorName || 'distributor'} · ${currentSlot.label}`}
                </Text>
              ) : !isSubmitting ? (
                <Text style={styles.modalFooterHint} numberOfLines={1}>
                  {!selectedDistributorUid
                    ? '⚠️ Select an eligible distributor'
                    : selectedSlotInfo.isPastTime
                    ? '⚠️ Selected time slot has already passed'
                    : selectedSlotInfo.hasTurnaroundConflict
                    ? '⚠️ Schedule turnaround conflict with another trip'
                    : selectedSlotInfo.isOverCapacity
                    ? '⚠️ 5-gallon container limit exceeded (max 60)'
                    : currentOrderCargo.hasUnknownCargo
                    ? '⚠️ Candidate cargo needs review'
                    : '⚠️ Select a valid future delivery slot'}
                </Text>
              ) : null}
            </View>

            <View style={styles.modalFooterActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Cancel assignment"
                nativeID="bluetap-modal-cancel-action"
                id="bluetap-modal-cancel-action"
                dataSet={{ bluetapModalCancel: 'true' }}
                disabled={isSubmitting}
                onPress={handleClose}
                style={[
                  styles.modalCancelBtn,
                  isSubmitting && styles.actionDisabled,
                  {
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#F1F5F9',
                    borderColor: isDark ? '#475569' : '#94A3B8',
                  },
                ]}
              >
                <View
                  nativeID="bluetap-modal-cancel-action-inner"
                  id="bluetap-modal-cancel-action-inner"
                  style={[
                    styles.modalCancelBtnInner,
                    {
                      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#F1F5F9',
                    },
                  ]}
                >
                  <Text style={[styles.modalCancelBtnText, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>Cancel</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={
                  selectedSlotInfo.isExistingTrip
                    ? `Co-Load and Approve Trip ${selectedSlotInfo.tripNumber}`
                    : `Approve and Assign to Trip ${selectedSlotInfo.tripNumber}`
                }
                nativeID={selectedSlotInfo.isExistingTrip ? 'bluetap-modal-coload-action' : 'bluetap-modal-assign-action'}
                id={selectedSlotInfo.isExistingTrip ? 'bluetap-modal-coload-action' : 'bluetap-modal-assign-action'}
                dataSet={{
                  bluetapColoadBtn: selectedSlotInfo.isExistingTrip ? 'true' : undefined,
                  bluetapAssignBtn: !selectedSlotInfo.isExistingTrip ? 'true' : undefined,
                }}
                disabled={!canSubmit}
                onPress={handleFormSubmit}
                style={[
                  styles.modalSubmitBtn,
                  selectedSlotInfo.isExistingTrip && styles.modalSubmitBtnCoLoad,
                  !canSubmit && styles.modalSubmitBtnDisabled,
                  {
                    backgroundColor: submitButtonBg,
                    borderColor: submitButtonBorderColor,
                  },
                ]}
              >
                <View
                  nativeID={selectedSlotInfo.isExistingTrip ? 'bluetap-modal-coload-action-inner' : 'bluetap-modal-assign-action-inner'}
                  id={selectedSlotInfo.isExistingTrip ? 'bluetap-modal-coload-action-inner' : 'bluetap-modal-assign-action-inner'}
                  style={[
                    styles.modalSubmitBtnInner,
                    {
                      backgroundColor: submitButtonBg,
                    },
                  ]}
                >
                  {isSubmitting ? (
                    <View style={styles.submitLoadingRow}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={[styles.modalSubmitBtnText, { color: submitButtonTextColor }]}>Saving…</Text>
                    </View>
                  ) : (
                    <Text
                      style={[
                        styles.modalSubmitBtnText,
                        !canSubmit && styles.modalSubmitBtnTextDisabled,
                        { color: submitButtonTextColor },
                      ]}
                    >
                      {currentOrderCargo.hasUnknownCargo || (selectedSlotInfo.isExistingTrip && selectedSlotInfo.hasUnknownCargo)
                        ? (selectedSlotInfo.isExistingTrip ? 'Co-Load Disabled (Unknown Cargo)' : 'Assignment Disabled (Unknown Cargo)')
                        : selectedSlotInfo.isExistingTrip
                        ? `Co-Load & Approve Trip #${selectedSlotInfo.tripNumber}`
                        : `Approve & Assign to Trip #${selectedSlotInfo.tripNumber}`}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors, width = 1200, isDark = false) => {
  const isCompact = width < 680;
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(15, 23, 42, 0.65)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: isCompact ? 8 : 20,
    },
    modalCard: {
      width: '100%',
      maxWidth: 900,
      height: isCompact ? '96%' : '88%',
      maxHeight: isCompact ? '96%' : '88%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1.5,
      borderRadius: 18,
      overflow: 'hidden',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: isDark ? 0.45 : 0.2,
      shadowRadius: 28,
      elevation: 12,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: isCompact ? 16 : 22,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    modalHeaderCopy: {
      flex: 1,
      minWidth: 0,
      marginRight: 12,
    },
    modalEyebrow: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
      color: colors.primary,
      textTransform: 'uppercase',
      marginBottom: 2,
    },
    modalTitle: {
      fontSize: isCompact ? 17 : 20,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    modalSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    closeButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#F1F5F9',
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    modalScroll: {
      flex: 1,
    },
    modalContent: {
      padding: isCompact ? 14 : 22,
      gap: 18,
    },
    orderSummaryCard: {
      padding: 14,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(30, 41, 59, 0.6)' : '#F8FAFC',
      borderWidth: 1,
      borderColor: colors.border,
      gap: 10,
    },
    orderSummaryTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    orderSummaryMeta: {
      flex: 1,
      minWidth: 0,
    },
    orderSummaryLabel: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.primary,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginBottom: 3,
    },
    orderSummaryProducts: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    orderSummaryPricing: {
      alignItems: 'flex-end',
      gap: 4,
    },
    orderSummaryTotal: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    orderSummaryBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
    },
    orderSummaryAddress: {
      fontSize: 12,
      color: colors.textSecondary,
      flex: 1,
      minWidth: 180,
    },
    stepSection: {
      gap: 10,
    },
    stepTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    emptyNote: {
      fontSize: 13,
      color: colors.textSecondary,
      fontStyle: 'italic',
      paddingVertical: 8,
    },
    distributorList: {
      gap: 8,
    },
    distributorOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    distributorOptionSelected: {
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.08)' : '#F0F9FF',
    },
    radioCircle: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioCircleSelected: {
      borderColor: colors.primary,
    },
    radioDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.primary,
    },
    distributorOptionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      flexWrap: 'wrap',
    },
    distributorName: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    distributorNameSelected: {
      color: colors.primary,
    },
    distributorWorkloadPill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#E2E8F0',
    },
    distributorWorkloadPillText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    distributorSub: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    workloadCard: {
      padding: 14,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(30, 41, 59, 0.5)' : '#F8FAFC',
      borderWidth: 1,
      borderColor: colors.border,
      gap: 10,
      marginTop: 4,
    },
    workloadHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    workloadEyebrow: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.primary,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    workloadTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
      marginTop: 1,
    },
    workloadBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#E0F2FE',
    },
    workloadBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.primary,
    },
    workloadStatsGrid: {
      flexDirection: 'row',
      gap: 8,
      flexWrap: 'wrap',
    },
    workloadStatItem: {
      flex: 1,
      minWidth: 70,
      padding: 8,
      borderRadius: 8,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    workloadStatValue: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    workloadStatLabel: {
      fontSize: 10,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      marginTop: 2,
    },
    workloadWarning: {
      padding: 8,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(245, 158, 11, 0.12)' : '#FFFBEB',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(245, 158, 11, 0.3)' : '#FDE68A',
    },
    workloadWarningText: {
      fontSize: 11,
      fontWeight: '600',
      color: isDark ? '#FBBF24' : '#B45309',
    },
    workloadTripsSection: {
      marginTop: 2,
    },
    workloadToggle: {
      alignSelf: 'flex-start',
      paddingVertical: 4,
    },
    workloadToggleText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.primary,
    },
    workloadTripsList: {
      gap: 6,
      marginTop: 6,
    },
    workloadTripItem: {
      padding: 8,
      borderRadius: 6,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    workloadTripTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    workloadTripNumber: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    workloadTripOrdersCount: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    workloadTripCargo: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    scheduleRow: {
      gap: 6,
    },
    scheduleSubTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
    },
    dateSelectorWrap: {
      gap: 8,
    },
    dateSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    dateSelectorText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    dateOptions: {
      maxHeight: 180,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: 4,
    },
    dateOption: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 6,
    },
    dateOptionActive: {
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#E0F2FE',
    },
    dateOptionText: {
      fontSize: 13,
      color: colors.textPrimary,
    },
    dateOptionTextActive: {
      fontWeight: '700',
      color: colors.primary,
    },
    quickDates: {
      flexDirection: 'row',
      gap: 6,
    },
    quickDate: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    quickDateActive: {
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#E0F2FE',
    },
    quickDateText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    quickDateTextActive: {
      color: colors.primary,
      fontWeight: '700',
    },
    slotsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    slotCard: {
      flexBasis: isCompact ? '100%' : '48%',
      flexGrow: 1,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: isDark ? '#334155' : '#E2E8F0',
      backgroundColor: colors.surface,
      gap: 6,
    },
    slotCardSelected: {
      borderWidth: 2,
      borderColor: isDark ? '#38BDF8' : '#0284C7',
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.10)' : '#EFF6FF',
    },
    slotCardDisabled: {
      opacity: 0.55,
    },
    slotCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    slotCardTime: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    slotCardTimeSelected: {
      color: isDark ? '#38BDF8' : '#0284C7',
    },
    slotBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    slotBadgeText: {
      fontSize: 11,
      fontWeight: '700',
    },
    slotBadgeBlue: { backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#E0F2FE' },
    slotBadgeBlueText: { color: isDark ? '#38BDF8' : '#0284C7' },
    slotBadgeGreen: { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.18)' : '#D1FAE5' },
    slotBadgeGreenText: { color: isDark ? '#34D399' : '#047857' },
    slotBadgePurple: { backgroundColor: isDark ? 'rgba(168, 85, 247, 0.15)' : '#F3E8FF' },
    slotBadgePurpleText: { color: isDark ? '#C084FC' : '#7E22CE' },
    slotBadgeOrange: { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#FEF3C7' },
    slotBadgeOrangeText: { color: isDark ? '#FBBF24' : '#D97706' },
    slotBadgeDanger: { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2' },
    slotBadgeDangerText: { color: colors.danger },
    slotBadgeMuted: { backgroundColor: isDark ? 'rgba(148, 163, 184, 0.15)' : '#F1F5F9' },
    slotBadgeMutedText: { color: colors.textSecondary },
    slotCardBody: {
      gap: 3,
    },
    slotCardSub: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    slotCardCapacity: {
      fontSize: 12,
      fontWeight: '700',
    },
    slotCardCapacityOk: {
      color: isDark ? '#34D399' : '#15803D',
    },
    slotCardCapacityOver: {
      color: colors.danger,
    },
    containerBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      alignSelf: 'flex-start',
    },
    containerBadgeText: {
      fontSize: 11,
      fontWeight: '700',
    },
    cargoBadgeBlue: { backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#E0F2FE' },
    cargoBadgeBlueText: { color: colors.primary },
    cargoBadgePurple: { backgroundColor: isDark ? 'rgba(168, 85, 247, 0.15)' : '#F3E8FF' },
    cargoBadgePurpleText: { color: isDark ? '#C084FC' : '#7E22CE' },
    cargoBadgeOrange: { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#FEF3C7' },
    cargoBadgeOrangeText: { color: isDark ? '#FBBF24' : '#D97706' },
    cargoBadgeWarning: { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2' },
    cargoBadgeWarningText: { color: colors.danger },
    modalAlert: {
      padding: 12,
      borderRadius: 10,
      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(239, 68, 68, 0.4)' : '#FCA5A5',
    },
    modalAlertText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.danger,
    },
    unknownCargoAlert: {
      padding: 10,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(245, 158, 11, 0.12)' : '#FFFBEB',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(245, 158, 11, 0.3)' : '#FDE68A',
    },
    unknownCargoAlertText: {
      fontSize: 12,
      fontWeight: '600',
      color: isDark ? '#FBBF24' : '#B45309',
      textAlign: 'center',
    },
    modalFooter: {
      flexDirection: isCompact ? 'column' : 'row',
      alignItems: isCompact ? 'stretch' : 'center',
      justifyContent: 'space-between',
      paddingHorizontal: isCompact ? 16 : 22,
      paddingVertical: 14,
      borderTopWidth: 1.5,
      borderTopColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#CBD5E1',
      backgroundColor: isDark ? '#0F172A' : '#F8FAFC',
      gap: 12,
    },
    modalFooterCopy: {
      flex: 1,
      minWidth: 0,
    },
    modalFooterHint: {
      fontSize: 12,
      fontWeight: '700',
      color: isDark ? '#FBBF24' : '#B45309',
    },
    modalFooterSuccess: {
      fontSize: 12,
      fontWeight: '700',
      color: isDark ? '#34D399' : '#15803D',
    },
    modalFooterActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: isCompact ? 'stretch' : 'flex-end',
      gap: 12,
    },
    modalCancelBtn: {
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: isDark ? '#475569' : '#94A3B8',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#F1F5F9',
      minWidth: 90,
      overflow: 'hidden',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: isDark ? 0.2 : 0.06,
      shadowRadius: 2,
      elevation: 1,
    },
    modalCancelBtnInner: {
      width: '100%',
      minHeight: 44,
      paddingHorizontal: 20,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalCancelBtnText: {
      fontSize: 13,
      fontWeight: '800',
      color: isDark ? '#F8FAFC' : '#0F172A',
    },
    modalSubmitBtn: {
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: isDark ? '#38BDF8' : '#084B7D',
      backgroundColor: isDark ? '#0284C7' : '#0B67AD',
      minWidth: 170,
      overflow: 'hidden',
      shadowColor: '#0B67AD',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 3,
    },
    modalSubmitBtnCoLoad: {
      borderColor: isDark ? '#34D399' : '#166534',
      backgroundColor: isDark ? '#059669' : '#15803D',
      shadowColor: '#15803D',
    },
    modalSubmitBtnDisabled: {
      backgroundColor: isDark ? 'rgba(148, 163, 184, 0.16)' : '#E2E8F0',
      borderWidth: 1.5,
      borderColor: isDark ? 'rgba(148, 163, 184, 0.28)' : '#CBD5E1',
      shadowOpacity: 0,
      elevation: 0,
      cursor: 'not-allowed',
    },
    modalSubmitBtnInner: {
      width: '100%',
      minHeight: 44,
      paddingHorizontal: 22,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
    },
    modalSubmitBtnInnerCoLoad: {
      backgroundColor: isDark ? '#059669' : '#15803D',
    },
    modalSubmitBtnInnerDisabled: {
      backgroundColor: isDark ? 'rgba(148, 163, 184, 0.16)' : '#E2E8F0',
    },
    modalSubmitBtnText: {
      fontSize: 13,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    modalSubmitBtnTextDisabled: {
      color: isDark ? '#94A3B8' : '#64748B',
    },
    submitLoadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    scheduleErrorText: {
      fontSize: 12,
      color: colors.danger,
      marginTop: 4,
    },
    actionDisabled: {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  });
};
