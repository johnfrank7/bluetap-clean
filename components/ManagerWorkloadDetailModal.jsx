import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  Platform,
} from 'react-native';

import {
  getActiveDistributorOrders,
  getDistributorWorkloadSummary,
  describeOrderCargo,
} from '../services/managerTripCapacity';
import RequestDetailsModal from './RequestDetailsModal';
import DropdownChevron from './DropdownChevron';
import { getProfileUniqueId } from '../services/uniqueIds';

const METRIC_TABS = [
  { id: 'orders', label: 'Active Orders' },
  { id: 'trips', label: 'Active Trips' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'overdue', label: 'Overdue' },
];

function getCargoSummary(order) {
  const result = describeOrderCargo(order);
  return (result && typeof result === 'object' ? result.summary : result) || '0 items';
}

function getFullName(user = {}) {
  if (!user) return 'Distributor';
  const combined = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return combined || user.name || user.fullName || 'Distributor';
}

function formatOverdueDuration(timeMs) {
  if (!timeMs) return 'Overdue';
  const now = Date.now();
  const diffMs = now - timeMs;
  if (diffMs <= 0) return 'Just passed';
  const diffMins = Math.floor(diffMs / (60 * 1000));
  if (diffMins < 60) return `${diffMins} min${diffMins === 1 ? '' : 's'} overdue`;
  const diffHours = Math.floor(diffMins / 60);
  const remMins = diffMins % 60;
  if (diffHours < 24) {
    return `${diffHours} hr${diffHours === 1 ? '' : 's'}${remMins > 0 ? ` ${remMins}m` : ''} overdue`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} overdue`;
}

function getStatusPill(status = '') {
  const s = String(status || '').trim().toLowerCase();
  switch (s) {
    case 'out_for_delivery':
      return { label: 'In Transit', tone: 'green' };
    case 'scheduled':
      return { label: 'Scheduled', tone: 'blue' };
    case 'assigned':
      return { label: 'Assigned', tone: 'cyan' };
    case 'overdue_delivery':
      return { label: 'Overdue', tone: 'amber' };
    case 'delivery_failed':
      return { label: 'Failed', tone: 'red' };
    case 'completed':
    case 'delivered':
      return { label: 'Delivered', tone: 'gray' };
    default:
      return { label: s.replace(/_/g, ' ') || 'Active', tone: 'blue' };
  }
}

export default function ManagerWorkloadDetailModal({
  visible = false,
  onClose,
  distributor = null,
  initialMetric = 'orders',
  allOrders = [],
  branches = [],
  colors = {},
  isDark = false,
}) {
  const { width } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState(initialMetric || 'orders');
  const [expandedTripIds, setExpandedTripIds] = useState(new Set());
  const [selectedOrderForDetails, setSelectedOrderForDetails] = useState(null);

  useEffect(() => {
    if (visible && initialMetric) {
      setActiveTab(initialMetric);
    }
  }, [visible, initialMetric]);

  const safeDistributor = distributor || {};
  const distUid = String(safeDistributor.uid || safeDistributor.id || '').trim();
  const distName = getFullName(safeDistributor);
  const distDisplayUid = getProfileUniqueId(safeDistributor) || safeDistributor.displayUid || distUid || '—';

  const activeOrders = useMemo(
    () => getActiveDistributorOrders(allOrders, distUid),
    [allOrders, distUid]
  );

  const workload = useMemo(
    () => getDistributorWorkloadSummary({ activeOrders, distributorUid: distUid }),
    [activeOrders, distUid]
  );

  const scheduledTrips = useMemo(
    () => (Array.isArray(workload.activeTrips) ? workload.activeTrips.filter((t) => t.isScheduled) : []),
    [workload.activeTrips]
  );

  const overdueTrips = useMemo(
    () => (Array.isArray(workload.activeTrips) ? workload.activeTrips.filter((t) => t.isOverdue) : []),
    [workload.activeTrips]
  );

  const toggleTripExpand = (tripId) => {
    setExpandedTripIds((prev) => {
      const next = new Set(prev);
      if (next.has(tripId)) {
        next.delete(tripId);
      } else {
        next.add(tripId);
      }
      return next;
    });
  };

  const styles = useMemo(
    () => createStyles(colors, width, isDark),
    [colors, width, isDark]
  );

  if (!visible || !distributor) {
    return null;
  }

  const getTabCount = (tabId) => {
    switch (tabId) {
      case 'orders':
        return workload.totalActiveOrders;
      case 'trips':
        return workload.activeTripsCount;
      case 'scheduled':
        return scheduledTrips.length;
      case 'overdue':
        return overdueTrips.length;
      default:
        return 0;
    }
  };

  return (
    <>
      <Modal
        animationType="fade"
        transparent
        visible={visible}
        onRequestClose={onClose}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            {/* Sticky Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <View style={styles.headerEyebrowRow}>
                  <Text style={styles.modalEyebrow}>DISTRIBUTOR WORKLOAD</Text>
                  <View style={styles.headerIdBadge}>
                    <Text style={styles.headerIdBadgeText}>ID: {distDisplayUid}</Text>
                  </View>
                </View>
                <Text style={styles.modalTitle} numberOfLines={1}>{distName}</Text>
                <Text style={styles.modalSub}>
                  {workload.totalActiveOrders === 0
                    ? 'No active orders · Available for assignment'
                    : `${workload.totalActiveOrders} active order${workload.totalActiveOrders === 1 ? '' : 's'} · ${workload.activeTripsCount} active trip${workload.activeTripsCount === 1 ? '' : 's'}`}
                </Text>
              </View>

              <TouchableOpacity
                accessibilityLabel="Close workload details"
                accessibilityRole="button"
                onPress={onClose}
                style={styles.closeBtn}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Filter Tabs */}
            <View style={styles.tabsContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabsScrollContent}
              >
                {METRIC_TABS.map((tab) => {
                  const isSelected = activeTab === tab.id;
                  const count = getTabCount(tab.id);
                  const isOverdueTab = tab.id === 'overdue';
                  const hasOverdueCount = isOverdueTab && count > 0;

                  return (
                    <TouchableOpacity
                      key={tab.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${tab.label}, ${count} records`}
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => setActiveTab(tab.id)}
                      style={[
                        styles.tabBtn,
                        isSelected && styles.tabBtnSelected,
                        hasOverdueCount && styles.tabBtnOverdueAlert,
                      ]}
                    >
                      <Text
                        style={[
                          styles.tabBtnText,
                          isSelected && styles.tabBtnTextSelected,
                          hasOverdueCount && styles.tabBtnTextOverdue,
                        ]}
                      >
                        {tab.label}
                      </Text>
                      <View
                        style={[
                          styles.tabBadge,
                          isSelected && styles.tabBadgeSelected,
                          hasOverdueCount && styles.tabBadgeOverdue,
                        ]}
                      >
                        <Text
                          style={[
                            styles.tabBadgeText,
                            isSelected && styles.tabBadgeTextSelected,
                            hasOverdueCount && styles.tabBadgeTextOverdue,
                          ]}
                        >
                          {count}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Scrollable Content */}
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
            >
              {/* TAB 1: ACTIVE ORDERS */}
              {activeTab === 'orders' && (
                <View style={styles.sectionWrap}>
                  {activeOrders.length === 0 ? (
                    <View style={styles.emptyCard}>
                      <Text style={styles.emptyTitle}>No Active Orders</Text>
                      <Text style={styles.emptySub}>
                        {`${distName} currently has no active orders assigned.`}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.itemsList}>
                      {activeOrders.map((order) => {
                        const orderRef = order.requestId || order.request_id || order.id || 'ORDER';
                        const requester = order.requesterName || order.requester_name || 'Requester';
                        const statusPill = getStatusPill(order.status);
                        const cargoDesc = getCargoSummary(order);
                        const tripNumber = order.tripNumber || (order.trip && order.trip.tripNumber);
                        const scheduleLabel = order.scheduledDateLabel || order.scheduleLabel || (order.scheduledAt ? new Date(order.scheduledAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'Unscheduled');

                        return (
                          <View key={order.id || orderRef} style={styles.orderCard}>
                            <View style={styles.orderCardHeader}>
                              <View style={styles.orderCardHeaderLeft}>
                                <Text style={styles.orderRefText}>#{orderRef}</Text>
                                <View style={[styles.pillBadge, getPillToneStyle(styles, statusPill.tone)]}>
                                  <Text style={[styles.pillBadgeText, getPillTextStyle(styles, statusPill.tone)]}>
                                    {statusPill.label}
                                  </Text>
                                </View>
                                {Boolean(tripNumber) && (
                                  <View style={styles.tripBadge}>
                                    <Text style={styles.tripBadgeText}>Trip #{tripNumber}</Text>
                                  </View>
                                )}
                              </View>
                              <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={`View details for order #${orderRef}`}
                                onPress={() => setSelectedOrderForDetails(order)}
                                style={styles.viewOrderBtn}
                              >
                                <Text style={styles.viewOrderBtnText}>View Details</Text>
                              </TouchableOpacity>
                            </View>

                            <View style={styles.orderCardBody}>
                              <Text style={styles.orderRequesterText}>{requester}</Text>
                              <Text style={styles.orderCargoText}>📦 {cargoDesc}</Text>
                              {Boolean(order.address || order.deliveryAddress) && (
                                <Text style={styles.orderAddressText} numberOfLines={2}>
                                  📍 {order.address || order.deliveryAddress}
                                </Text>
                              )}
                              <View style={styles.orderMetaFooter}>
                                <Text style={styles.orderScheduleMeta}>
                                  📅 Schedule: {scheduleLabel}
                                </Text>
                                {order.totalAtOrder ? (
                                  <Text style={styles.orderPriceMeta}>
                                    ₱{Number(order.totalAtOrder).toFixed(2)}
                                  </Text>
                                ) : null}
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}

              {/* TAB 2: ACTIVE TRIPS */}
              {activeTab === 'trips' && (
                <View style={styles.sectionWrap}>
                  {workload.activeTrips.length === 0 ? (
                    <View style={styles.emptyCard}>
                      <Text style={styles.emptyTitle}>No Active Trips</Text>
                      <Text style={styles.emptySub}>
                        {`${distName} currently has no active delivery trips scheduled.`}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.itemsList}>
                      {workload.activeTrips.map((trip) => {
                        const isExpanded = expandedTripIds.has(trip.tripId);
                        const tripCapacityPercent = Math.min(
                          100,
                          Math.round((trip.totalContainers / 60) * 100)
                        );
                        const statusPill = getStatusPill(trip.status);

                        return (
                          <View key={trip.tripId} style={styles.tripCard}>
                            <View style={styles.tripCardHeader}>
                              <View style={styles.tripCardHeaderLeft}>
                                <Text style={styles.tripNumberText}>{`Trip #${trip.tripNumber}`}</Text>
                                <View style={[styles.pillBadge, getPillToneStyle(styles, statusPill.tone)]}>
                                  <Text style={[styles.pillBadgeText, getPillTextStyle(styles, statusPill.tone)]}>
                                    {trip.isOverdue ? 'Overdue' : statusPill.label}
                                  </Text>
                                </View>
                              </View>
                              <Text style={styles.tripScheduleBadge}>
                                {`📅 ${trip.fullScheduleLabel || trip.timeLabel || 'Unscheduled'}`}
                              </Text>
                            </View>

                            {/* Trip Capacity Meter */}
                            <View style={styles.tripCapacityWrap}>
                              <View style={styles.tripCapacityTopRow}>
                                <Text style={styles.tripCapacityLabel}>
                                  {`Standard 5-Gallon Load: ${trip.totalContainers}/60`}
                                </Text>
                                <Text style={styles.tripCapacityPercent}>
                                  {`${tripCapacityPercent}% capacity`}
                                </Text>
                              </View>
                              <View style={styles.tripCapacityTrack}>
                                <View
                                  style={[
                                    styles.tripCapacityFill,
                                    {
                                      width: `${tripCapacityPercent}%`,
                                      backgroundColor:
                                        trip.totalContainers > 60
                                          ? colors.danger
                                          : trip.totalContainers >= 50
                                          ? (isDark ? '#FBBF24' : '#D97706')
                                          : (isDark ? '#38BDF8' : colors.primary),
                                    },
                                  ]}
                                />
                              </View>
                              {trip.otherCargoCount > 0 && (
                                <Text style={styles.tripOtherCargoText}>
                                  + {trip.otherCargoCount} other cargo item{trip.otherCargoCount === 1 ? '' : 's'} ({trip.otherCargoSummary})
                                </Text>
                              )}
                            </View>

                            {/* Expandable Orders List */}
                            <TouchableOpacity
                              accessibilityRole="button"
                              accessibilityLabel={
                                isExpanded
                                  ? `Hide ${trip.orders.length} orders in Trip ${trip.tripNumber}`
                                  : `Show ${trip.orders.length} orders in Trip ${trip.tripNumber}`
                              }
                              onPress={() => toggleTripExpand(trip.tripId)}
                              style={styles.tripOrdersToggle}
                            >
                              <Text style={styles.tripOrdersToggleText}>
                                {isExpanded
                                  ? `Hide Assigned Orders (${trip.orders.length})`
                                  : `View Assigned Orders (${trip.orders.length})`}
                              </Text>
                              <DropdownChevron
                                expanded={isExpanded}
                                size={14}
                                color={colors.primary}
                              />
                            </TouchableOpacity>

                            {isExpanded && (
                              <View style={styles.tripOrdersSubList}>
                                {trip.orders.map((ord) => {
                                  const ordRef = ord.requestId || ord.request_id || ord.id || 'ORDER';
                                  const ordRequester = ord.requesterName || ord.requester_name || 'Requester';
                                  const ordCargo = getCargoSummary(ord);

                                  return (
                                    <View key={ord.id || ordRef} style={styles.tripOrderRow}>
                                      <View style={styles.tripOrderInfo}>
                                        <Text style={styles.tripOrderRef}>#{ordRef} · {ordRequester}</Text>
                                        <Text style={styles.tripOrderCargo}>{ordCargo}</Text>
                                        {Boolean(ord.address) && (
                                          <Text style={styles.tripOrderAddress} numberOfLines={1}>
                                            📍 {ord.address}
                                          </Text>
                                        )}
                                      </View>
                                      <TouchableOpacity
                                        accessibilityRole="button"
                                        accessibilityLabel={`View details for order #${ordRef}`}
                                        onPress={() => setSelectedOrderForDetails(ord)}
                                        style={styles.subViewBtn}
                                      >
                                        <Text style={styles.subViewBtnText}>Details</Text>
                                      </TouchableOpacity>
                                    </View>
                                  );
                                })}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}

              {/* TAB 3: SCHEDULED */}
              {activeTab === 'scheduled' && (
                <View style={styles.sectionWrap}>
                  {scheduledTrips.length === 0 ? (
                    <View style={styles.emptyCard}>
                      <Text style={styles.emptyTitle}>No Scheduled Trips</Text>
                      <Text style={styles.emptySub}>
                        {`${distName} currently has no trips with a confirmed delivery schedule.`}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.itemsList}>
                      {scheduledTrips.map((trip) => {
                        const isExpanded = expandedTripIds.has(trip.tripId);
                        const statusPill = getStatusPill(trip.status);

                        return (
                          <View key={trip.tripId} style={styles.tripCard}>
                            <View style={styles.tripCardHeader}>
                              <View style={styles.tripCardHeaderLeft}>
                                <Text style={styles.tripNumberText}>{`Trip #${trip.tripNumber}`}</Text>
                                <View style={[styles.pillBadge, getPillToneStyle(styles, statusPill.tone)]}>
                                  <Text style={[styles.pillBadgeText, getPillTextStyle(styles, statusPill.tone)]}>
                                    {trip.isOverdue ? 'Overdue' : statusPill.label}
                                  </Text>
                                </View>
                              </View>
                              <Text style={styles.tripScheduleBadge}>
                                📅 {trip.fullScheduleLabel || trip.timeLabel}
                              </Text>
                            </View>

                            <View style={styles.scheduledStatsRow}>
                              <Text style={styles.scheduledStatText}>
                                {trip.orders.length} order{trip.orders.length === 1 ? '' : 's'} assigned · {trip.totalContainers}/60 5-gal loaded
                              </Text>
                            </View>

                            {/* Expandable Orders List */}
                            <TouchableOpacity
                              accessibilityRole="button"
                              accessibilityLabel={
                                isExpanded
                                  ? `Hide ${trip.orders.length} orders in Trip ${trip.tripNumber}`
                                  : `Show ${trip.orders.length} orders in Trip ${trip.tripNumber}`
                              }
                              onPress={() => toggleTripExpand(trip.tripId)}
                              style={styles.tripOrdersToggle}
                            >
                              <Text style={styles.tripOrdersToggleText}>
                                {isExpanded
                                  ? `Hide Assigned Orders (${trip.orders.length})`
                                  : `View Assigned Orders (${trip.orders.length})`}
                              </Text>
                              <DropdownChevron
                                expanded={isExpanded}
                                size={14}
                                color={colors.primary}
                              />
                            </TouchableOpacity>

                            {isExpanded && (
                              <View style={styles.tripOrdersSubList}>
                                {trip.orders.map((ord) => {
                                  const ordRef = ord.requestId || ord.request_id || ord.id || 'ORDER';
                                  const ordRequester = ord.requesterName || ord.requester_name || 'Requester';

                                  return (
                                    <View key={ord.id || ordRef} style={styles.tripOrderRow}>
                                      <View style={styles.tripOrderInfo}>
                                        <Text style={styles.tripOrderRef}>#{ordRef} · {ordRequester}</Text>
                                        <Text style={styles.tripOrderCargo}>{getCargoSummary(ord)}</Text>
                                      </View>
                                      <TouchableOpacity
                                        accessibilityRole="button"
                                        accessibilityLabel={`View details for order #${ordRef}`}
                                        onPress={() => setSelectedOrderForDetails(ord)}
                                        style={styles.subViewBtn}
                                      >
                                        <Text style={styles.subViewBtnText}>Details</Text>
                                      </TouchableOpacity>
                                    </View>
                                  );
                                })}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}

              {/* TAB 4: OVERDUE */}
              {activeTab === 'overdue' && (
                <View style={styles.sectionWrap}>
                  {overdueTrips.length === 0 ? (
                    <View style={styles.successEmptyCard}>
                      <Text style={styles.successEmptyIcon}>✓</Text>
                      <Text style={styles.successEmptyTitle}>No Overdue Deliveries</Text>
                      <Text style={styles.successEmptySub}>
                        {`All delivery trips for ${distName} are running on schedule.`}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.itemsList}>
                      <View style={styles.overdueAlertBanner}>
                        <Text style={styles.overdueAlertBannerText}>
                          {`⚠️ ${overdueTrips.length} active delivery trip${overdueTrips.length === 1 ? ' is' : 's are'} overdue. Delivery time has elapsed. Review delivery progress with the distributor.`}
                        </Text>
                      </View>

                      {overdueTrips.map((trip) => {
                        const overdueElapsed = formatOverdueDuration(trip.time);

                        return (
                          <View key={trip.tripId} style={styles.overdueTripCard}>
                            <View style={styles.tripCardHeader}>
                              <View style={styles.tripCardHeaderLeft}>
                                <Text style={styles.tripNumberText}>{`Trip #${trip.tripNumber}`}</Text>
                                <View style={[styles.pillBadge, styles.pillBadgeAmber]}>
                                  <Text style={[styles.pillBadgeText, styles.pillBadgeAmberText]}>
                                    ⚠️ {overdueElapsed}
                                  </Text>
                                </View>
                              </View>
                              <Text style={styles.overdueScheduleBadge}>
                                Scheduled: {trip.fullScheduleLabel || trip.timeLabel}
                              </Text>
                            </View>

                            <View style={styles.overdueTripMeta}>
                              <Text style={styles.overdueTripMetaText}>
                                {trip.orders.length} order{trip.orders.length === 1 ? '' : 's'} · {trip.totalContainers}/60 5-gal loaded
                              </Text>
                            </View>

                            <View style={styles.tripOrdersSubList}>
                              {trip.orders.map((ord) => {
                                const ordRef = ord.requestId || ord.request_id || ord.id || 'ORDER';
                                const ordRequester = ord.requesterName || ord.requester_name || 'Requester';

                                return (
                                  <View key={ord.id || ordRef} style={styles.tripOrderRow}>
                                    <View style={styles.tripOrderInfo}>
                                      <Text style={styles.tripOrderRef}>#{ordRef} · {ordRequester}</Text>
                                      <Text style={styles.tripOrderCargo}>{getCargoSummary(ord)}</Text>
                                      {Boolean(ord.address) && (
                                        <Text style={styles.tripOrderAddress} numberOfLines={1}>
                                          📍 {ord.address}
                                        </Text>
                                      )}
                                    </View>
                                    <TouchableOpacity
                                      accessibilityRole="button"
                                      accessibilityLabel={`View details for order #${ordRef}`}
                                      onPress={() => setSelectedOrderForDetails(ord)}
                                      style={styles.subViewBtn}
                                    >
                                      <Text style={styles.subViewBtnText}>Details</Text>
                                    </TouchableOpacity>
                                  </View>
                                );
                              })}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}
            </ScrollView>

            {/* Sticky Footer */}
            <View style={styles.modalFooter}>
              <View style={styles.modalFooterCopy}>
                <Text style={styles.modalFooterText} numberOfLines={1}>
                  Showing {activeTab === 'orders' ? activeOrders.length : activeTab === 'trips' ? workload.activeTrips.length : activeTab === 'scheduled' ? scheduledTrips.length : overdueTrips.length} {activeTab === 'orders' ? 'active orders' : activeTab === 'trips' ? 'trips' : activeTab === 'scheduled' ? 'scheduled trips' : 'overdue trips'}
                </Text>
              </View>

              <TouchableOpacity
                accessibilityLabel="Close workload details"
                accessibilityRole="button"
                onPress={onClose}
                style={styles.footerCloseBtn}
              >
                <Text style={styles.footerCloseBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Nested RequestDetailsModal for inspecting any order */}
      {selectedOrderForDetails && (
        <RequestDetailsModal
          visible={Boolean(selectedOrderForDetails)}
          request={selectedOrderForDetails}
          branches={branches}
          onClose={() => setSelectedOrderForDetails(null)}
        />
      )}
    </>
  );
}

function getPillToneStyle(styles, tone) {
  switch (tone) {
    case 'green':
      return styles.pillBadgeGreen;
    case 'blue':
      return styles.pillBadgeBlue;
    case 'cyan':
      return styles.pillBadgeCyan;
    case 'amber':
      return styles.pillBadgeAmber;
    case 'red':
      return styles.pillBadgeRed;
    default:
      return styles.pillBadgeGray;
  }
}

function getPillTextStyle(styles, tone) {
  switch (tone) {
    case 'green':
      return styles.pillBadgeGreenText;
    case 'blue':
      return styles.pillBadgeBlueText;
    case 'cyan':
      return styles.pillBadgeCyanText;
    case 'amber':
      return styles.pillBadgeAmberText;
    case 'red':
      return styles.pillBadgeRedText;
    default:
      return styles.pillBadgeGrayText;
  }
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
      maxWidth: 780,
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
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: isCompact ? 16 : 22,
      paddingTop: 18,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
      gap: 12,
    },
    modalHeaderCopy: {
      flex: 1,
      minWidth: 0,
    },
    headerEyebrowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 3,
    },
    modalEyebrow: {
      fontSize: 10,
      fontWeight: '800',
      color: isDark ? '#38BDF8' : colors.primary,
      letterSpacing: 0.8,
    },
    headerIdBadge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#F1F5F9',
    },
    headerIdBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    modalTitle: {
      fontSize: isCompact ? 17 : 20,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    modalSub: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    closeBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#F1F5F9',
      borderWidth: 1,
      borderColor: colors.border,
    },
    closeBtnText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    tabsContainer: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: isDark ? 'rgba(15, 23, 42, 0.5)' : '#F8FAFC',
    },
    tabsScrollContent: {
      flexDirection: 'row',
      paddingHorizontal: isCompact ? 12 : 20,
      paddingVertical: 10,
      gap: 8,
    },
    tabBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    tabBtnSelected: {
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(24, 123, 205, 0.10)',
    },
    tabBtnOverdueAlert: {
      borderColor: isDark ? '#FBBF24' : '#D97706',
    },
    tabBtnText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    tabBtnTextSelected: {
      color: isDark ? '#38BDF8' : colors.primary,
    },
    tabBtnTextOverdue: {
      color: isDark ? '#FBBF24' : '#D97706',
    },
    tabBadge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 10,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : '#E2E8F0',
    },
    tabBadgeSelected: {
      backgroundColor: isDark ? '#38BDF8' : colors.primary,
    },
    tabBadgeOverdue: {
      backgroundColor: isDark ? '#FBBF24' : '#D97706',
    },
    tabBadgeText: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.textSecondary,
    },
    tabBadgeTextSelected: {
      color: '#FFFFFF',
    },
    tabBadgeTextOverdue: {
      color: '#FFFFFF',
    },
    modalScroll: {
      flex: 1,
    },
    modalScrollContent: {
      padding: isCompact ? 14 : 22,
    },
    sectionWrap: {
      gap: 12,
    },
    emptyCard: {
      padding: 24,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(15, 23, 42, 0.4)' : '#F8FAFC',
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.textPrimary,
      marginBottom: 4,
    },
    emptySub: {
      fontSize: 12,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    successEmptyCard: {
      padding: 24,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.12)' : '#ECFDF5',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(16, 185, 129, 0.3)' : '#A7F3D0',
      alignItems: 'center',
      justifyContent: 'center',
    },
    successEmptyIcon: {
      fontSize: 24,
      fontWeight: '900',
      color: isDark ? '#34D399' : '#059669',
      marginBottom: 6,
    },
    successEmptyTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: isDark ? '#34D399' : '#065F46',
      marginBottom: 4,
    },
    successEmptySub: {
      fontSize: 12,
      color: isDark ? '#A7F3D0' : '#047857',
      textAlign: 'center',
    },
    overdueAlertBanner: {
      padding: 12,
      borderRadius: 10,
      backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#FFFBEB',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(245, 158, 11, 0.4)' : '#FDE68A',
    },
    overdueAlertBannerText: {
      fontSize: 12,
      fontWeight: '700',
      color: isDark ? '#FBBF24' : '#B45309',
      lineHeight: 18,
    },
    itemsList: {
      gap: 12,
    },
    orderCard: {
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: isDark ? 'rgba(30, 41, 59, 0.6)' : '#FFFFFF',
      gap: 8,
    },
    orderCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    orderCardHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    },
    orderRefText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    tripBadge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#F1F5F9',
      borderWidth: 1,
      borderColor: colors.border,
    },
    tripBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    viewOrderBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#E0F2FE',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(56, 189, 248, 0.3)' : '#BAE6FD',
    },
    viewOrderBtnText: {
      fontSize: 11,
      fontWeight: '800',
      color: isDark ? '#38BDF8' : colors.primary,
    },
    orderCardBody: {
      gap: 4,
    },
    orderRequesterText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    orderCargoText: {
      fontSize: 12,
      fontWeight: '600',
      color: isDark ? '#94A3B8' : '#334155',
    },
    orderAddressText: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    orderMetaFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 4,
      paddingTop: 6,
      borderTopWidth: 1,
      borderTopColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#F1F5F9',
    },
    orderScheduleMeta: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    orderPriceMeta: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    tripCard: {
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: isDark ? 'rgba(30, 41, 59, 0.6)' : '#FFFFFF',
      gap: 10,
    },
    overdueTripCard: {
      padding: 14,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: isDark ? '#FBBF24' : '#FDE68A',
      backgroundColor: isDark ? 'rgba(245, 158, 11, 0.08)' : '#FFFDF5',
      gap: 10,
    },
    tripCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      flexWrap: 'wrap',
    },
    tripCardHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    },
    tripNumberText: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    tripScheduleBadge: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    overdueScheduleBadge: {
      fontSize: 11,
      fontWeight: '700',
      color: isDark ? '#FBBF24' : '#B45309',
    },
    tripCapacityWrap: {
      gap: 5,
    },
    tripCapacityTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    tripCapacityLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    tripCapacityPercent: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    tripCapacityTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : '#E2E8F0',
      overflow: 'hidden',
    },
    tripCapacityFill: {
      height: '100%',
      borderRadius: 3,
    },
    tripOtherCargoText: {
      fontSize: 11,
      color: isDark ? '#C084FC' : '#7E22CE',
      fontWeight: '600',
    },
    tripOrdersToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 7,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : '#F8FAFC',
      borderWidth: 1,
      borderColor: colors.border,
    },
    tripOrdersToggleText: {
      fontSize: 11,
      fontWeight: '700',
      color: isDark ? '#38BDF8' : colors.primary,
    },
    tripOrdersSubList: {
      gap: 8,
      marginTop: 2,
    },
    tripOrderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 10,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(15, 23, 42, 0.5)' : '#F8FAFC',
      borderWidth: 1,
      borderColor: colors.border,
      gap: 8,
    },
    tripOrderInfo: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    tripOrderRef: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    tripOrderCargo: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    tripOrderAddress: {
      fontSize: 10,
      color: colors.textSecondary,
    },
    subViewBtn: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#FFFFFF',
      borderWidth: 1,
      borderColor: colors.border,
    },
    subViewBtnText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    scheduledStatsRow: {
      paddingVertical: 2,
    },
    scheduledStatText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    overdueTripMeta: {
      paddingVertical: 2,
    },
    overdueTripMetaText: {
      fontSize: 12,
      fontWeight: '700',
      color: isDark ? '#FBBF24' : '#B45309',
    },
    pillBadge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
    },
    pillBadgeText: {
      fontSize: 11,
      fontWeight: '800',
    },
    pillBadgeGreen: { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.18)' : '#D1FAE5' },
    pillBadgeGreenText: { color: isDark ? '#34D399' : '#047857' },
    pillBadgeBlue: { backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#E0F2FE' },
    pillBadgeBlueText: { color: isDark ? '#38BDF8' : '#0284C7' },
    pillBadgeCyan: { backgroundColor: isDark ? 'rgba(6, 182, 212, 0.15)' : '#CFFAFE' },
    pillBadgeCyanText: { color: isDark ? '#22D3EE' : '#0891B2' },
    pillBadgeAmber: { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#FEF3C7' },
    pillBadgeAmberText: { color: isDark ? '#FBBF24' : '#D97706' },
    pillBadgeRed: { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2' },
    pillBadgeRedText: { color: colors.danger },
    pillBadgeGray: { backgroundColor: isDark ? 'rgba(148, 163, 184, 0.15)' : '#F1F5F9' },
    pillBadgeGrayText: { color: colors.textSecondary },
    modalFooter: {
      flexDirection: 'row',
      alignItems: 'center',
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
    modalFooterText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    footerCloseBtn: {
      paddingHorizontal: 22,
      paddingVertical: 10,
      minHeight: 44,
      minWidth: 100,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: isDark ? '#475569' : '#94A3B8',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#F1F5F9',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: isDark ? 0.2 : 0.06,
      shadowRadius: 2,
      elevation: 1,
    },
    footerCloseBtnText: {
      fontSize: 13,
      fontWeight: '800',
      color: isDark ? '#F8FAFC' : '#0F172A',
    },
  });
};
