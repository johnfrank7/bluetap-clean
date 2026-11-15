import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { getLocalUsers, subscribeLocalUsers } from '../../localUsers';
import { getProfileUniqueId } from '../../services/uniqueIds';
import { getModuleSession } from '../../services/authSession';
import { dispatchManagerOrder, getManagerDispatch } from '../../services/managerOrderApprovals';
import { haversineDistanceKm } from '../../services/location';
import { useAdminTheme } from '../../components/AdminTheme';
import DropdownChevron from '../../components/DropdownChevron';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import TopToastFeedback from '../../components/TopToastFeedback';
import ManagerShell, { MANAGER_COLORS, ManagerPill } from '../../components/ManagerShell';
import { useManagerRealtimeData } from '../../components/ManagerRealtimeData';
import { parseTimestamp } from '../../services/notificationTimestamp';
import { approveManagerDistributor, rejectManagerDistributor } from '../../services/managerWorkspace';
import { normalizeDistributorApplication, formatDistributorStatusLabel } from '../../services/distributorApplications';
import ManagerTripCapacity from '../../components/ManagerTripCapacity';
import ManagerAssignScheduleModal from '../../components/ManagerAssignScheduleModal';
import ManagerWorkloadDetailModal from '../../components/ManagerWorkloadDetailModal';
const { getManagerQueues, toManagerOrder } = require('../../services/managerOperational');
const { effectiveDeliveryDays, isAllowedDeliveryDate, manilaScheduleDate } = require('../../services/productOrderPolicy');
const {
  analyzeOrderCargo,
  calculateOrderContainers,
  describeOrderCargo,
  groupOrdersIntoTrips,
  getDistributorWorkloadSummary,
  getSlotCapacityInfo,
  TRIP_MAX_CONTAINERS,
  SCHEDULE_CONFLICT_WINDOW_MS,
  ACTIVE_ASSIGNMENT_STATUSES,
} = require('../../services/managerTripCapacity');
const {
  DISPATCH_PAGE_SIZE,
  totalDispatchPages,
  clampDispatchPage,
  dispatchPageMeta,
  dispatchPageSlice,
  dispatchPageNumbers,
} = require('../../services/managerDispatchPagination');

const getSlotBadgeStyle = (styles, tone) => {
  switch (tone) {
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

function getActiveDistributorOrders(allOrders = [], distributorUid = '', excludeOrderId = '') {
  if (!distributorUid) return [];
  const seen = new Set();
  const result = [];
  for (const item of (Array.isArray(allOrders) ? allOrders : [])) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || item.requestId || item._id || '').trim();
    if (id && id === excludeOrderId) continue;
    if (id && seen.has(id)) continue;

    const distUid = String(
      item.assignedDistributorUid ||
      item.distributor_id ||
      item.distributorId ||
      item.assignedDistributorId ||
      item.distributorUid ||
      ''
    ).trim();
    if (distUid !== distributorUid) continue;

    const status = String(item.status || '').trim().toLowerCase();
    if (!ACTIVE_ASSIGNMENT_STATUSES.has(status)) continue;

    if (id) seen.add(id);
    result.push(item);
  }
  return result;
}

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
      return { container: null, text: null };
  }
};

const normalizeApplicationStatus = (status) =>
  (status || 'pending').toString().trim().toLowerCase();

const normalizeRole = (role) => (role || '').toString().trim().toLowerCase();

const getInitials = (name = '') => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'D';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const getDistributorApplicationStatus = (distributor) =>
  normalizeApplicationStatus(
    distributor.distributorStatus ||
      distributor.status ||
      distributor.approvalStatus ||
      distributor.accountStatus ||
      'pending'
  );

const getRegisteredLocalDistributors = (firestoreDistributors = [], branchId = '') =>
  getLocalUsers()
    .filter(
      (user) =>
        user.branchId === branchId &&
        normalizeRole(user.role) === 'distributor' &&
        ['approved', 'active'].includes(getDistributorApplicationStatus(user))
    )
    .map((user) => ({ ...user, id: user.uid, isLocal: true }))
    .filter(
      (localUser) =>
        !firestoreDistributors.some(
          (firestoreUser) =>
            firestoreUser.uid === localUser.uid ||
            firestoreUser.email === localUser.email
        )
    );

const getFullName = (user = {}) =>
  `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
  user.full_name ||
  user.fullName ||
  user.email ||
  'Unnamed distributor';

const getBarangay = (user = {}) =>
  (user.barangay || user.address || 'Not set').toString().trim() || 'Not set';

const formatAmount = (amount) => `₱${Number(amount || 0).toFixed(2)}`;

const getJoinedLabel = (user = {}) => {
  const value = user.createdAt || user.created_at || user.joinedAt || user.joined;
  const date = parseTimestamp(value);
  if (!date) return 'Not set';
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date);
};

const orderProducts = (order) =>
  order.items?.map((item) => `${item.quantity} × ${item.productNameSnapshot}`).filter(Boolean).join(', ') || 'Order products';

const orderDistance = (order) =>
  order.distanceKmSnapshot == null ? 'Distance unavailable' : `Approx. ${Number(order.distanceKmSnapshot).toFixed(1)} km`;

const targetBranchesFor = (order, branches) =>
  [...(branches || [])]
    .map((branch) => {
      const distanceKm = order.deliveryLocation ? haversineDistanceKm(order.deliveryLocation, branch) : null;
      const radius = Number(branch.serviceRadiusKm || 5);
      return { ...branch, distanceKm, withinCoverage: distanceKm !== null && distanceKm <= radius };
    })
    .sort((left, right) => (left.distanceKm ?? Infinity) - (right.distanceKm ?? Infinity));

const TIME_SLOT_OPTIONS = [
  { label: '09:00 AM', hours: 9, minutes: 0 },
  { label: '11:00 AM', hours: 11, minutes: 0 },
  { label: '01:00 PM', hours: 13, minutes: 0 },
  { label: '03:00 PM', hours: 15, minutes: 0 },
  { label: '05:00 PM', hours: 17, minutes: 0 },
];

function buildScheduleDate(dayOffset, slot) {
  if (!slot || typeof slot.hours !== 'number') return null;
  return manilaScheduleDate(dayOffset, slot.hours, slot.minutes || 0);
}

function formatScheduleDateDisplay(date) {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return 'Select date';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// Delivery date picker uses accessibilityRole="combobox" for date selection ('Today' / 'Tomorrow')
const allowedDayOffsets = (order) => {
  const days = Array.isArray(order.effectiveDeliveryDaysSnapshot) ? order.effectiveDeliveryDaysSnapshot : effectiveDeliveryDays(order.items || []);
  return Array.from({ length: 14 }, (_, index) => index).filter((offset) => isAllowedDeliveryDate(buildScheduleDate(offset, TIME_SLOT_OPTIONS[0]), days));
};

export function DistributorDispatchQueue({
  styles,
  colors,
  isDark,
  onShowToast,
  initialAssigningOrderId = '',
  initialDistributorUid = '',
  initialDistributors = null,
}) {
  const realtime = useManagerRealtimeData();
  const [metadata, setMetadata] = useState({
    branchId: realtime.branchId || '',
    distributors: initialDistributors || [],
    branches: [],
  });
  const branchMetadata = metadata.branchId === realtime.branchId ? metadata : { distributors: [], branches: [] };
  const data = useMemo(() => ({
    orders: getManagerQueues(realtime.requests, realtime.incomingTransfers, realtime.branchId).dispatch
      .map((order) => toManagerOrder(order.id, order, realtime.branch?.name || '')),
    distributors: branchMetadata.distributors,
    branches: branchMetadata.branches,
  }), [realtime, metadata, branchMetadata]);
  const loading = realtime.loading;
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const [assigningOrderId, setAssigningOrderId] = useState(initialAssigningOrderId);
  const [transferringOrderId, setTransferringOrderId] = useState('');
  const [transferReason, setTransferReason] = useState('');

  const load = async () => {
    setError('');
    try {
      const result = await getManagerDispatch();
      setMetadata({ branchId: realtime.branchId, distributors: result.distributors || [], branches: result.branches || [] });
    } catch (loadFailure) {
      setError(loadFailure.message);
    }
  };

  useEffect(() => {
    if (realtime.branchId) load();
  }, [realtime.branchId]);

  const [dateSelectorOpen] = useState(false);

  const openAssignmentPanel = (order) => {
    setAssigningOrderId(order.id);
    setTransferringOrderId('');
  };

  const handleModalSubmit = async ({ order, distributorUid, scheduledAt, tripId, isReassign }) => {
    setUpdatingId(order.id);
    try {
      await dispatchManagerOrder(order.id, isReassign ? 'reassign-distributor' : 'assign-distributor', {
        distributorUid,
        scheduledAt: scheduledAt.toISOString(),
        ...(tripId ? { tripId } : {}),
      });
      setAssigningOrderId('');
      onShowToast?.(
        isReassign
          ? 'Distributor reassigned successfully.'
          : (tripId ? 'Order assigned to trip successfully.' : 'Distributor assigned and delivery scheduled.'),
        'success'
      );
      await load();
    } catch (actError) {
      const msg = actError.message || 'Failed to assign distributor.';
      onShowToast?.(msg, 'error');
      throw actError;
    } finally {
      setUpdatingId('');
    }
  };

  const actTransfer = async (orderId, targetBranchId) => {
    if (updatingId) return;
    if (!transferReason.trim()) {
      setError('Please add a transfer coordination note explaining why another branch should fulfill this order.');
      onShowToast?.('Transfer coordination note is required.', 'error');
      return;
    }
    setUpdatingId(orderId);
    setError('');
    try {
      await dispatchManagerOrder(orderId, 'request-transfer', { targetBranchId, transferReason: transferReason.trim() });
      setTransferringOrderId('');
      setTransferReason('');
      onShowToast?.('Branch transfer requested successfully.', 'success');
      await load();
    } catch (actionFailure) {
      const msg = actionFailure.message || 'Failed to request transfer.';
      setError(msg);
      onShowToast?.(msg, 'error');
    } finally {
      setUpdatingId('');
    }
  };

  const dispatchableOrders = data.orders.filter(
    (order) => {
      const st = String(order.status || '').trim().toLowerCase().replace(/\s+/g, '_');
      return st !== 'pending' && ['awaiting_distributor_assignment', 'delivery_failed'].includes(st);
    }
  );

  const activeAssignOrder = useMemo(() => {
    if (!assigningOrderId) return null;
    return (
      dispatchableOrders.find((o) => o.id === assigningOrderId) ||
      data.orders.find((o) => o.id === assigningOrderId) ||
      null
    );
  }, [assigningOrderId, dispatchableOrders, data.orders]);

  const queueScrollRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(1);

  const paginationMeta = useMemo(
    () => dispatchPageMeta(dispatchableOrders.length, currentPage, DISPATCH_PAGE_SIZE),
    [dispatchableOrders.length, currentPage]
  );

  const { totalPages, safePage, start, end, startIndex, endIndex } = paginationMeta;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const pagedOrders = useMemo(
    () => dispatchableOrders.slice(start, end),
    [dispatchableOrders, start, end]
  );

  const pageNumbers = useMemo(
    () => dispatchPageNumbers(safePage, totalPages),
    [safePage, totalPages]
  );

  const handlePageChange = (newPage) => {
    const clamped = clampDispatchPage(newPage, dispatchableOrders.length, DISPATCH_PAGE_SIZE);
    setCurrentPage(clamped);
    queueScrollRef.current?.scrollTo?.({ y: 0, animated: true });
  };

  return (
    <View style={styles.dispatchCard}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardHeaderCopy}>
          <Text style={styles.approvalEyebrow}>DISPATCH QUEUE</Text>
          <Text style={styles.cardTitle}>Distributor Dispatch & Scheduling</Text>
          <Text style={styles.approvalHelper}>
            Assign available distributors and set atomic delivery schedules for active branch orders.
          </Text>
        </View>
        <TouchableOpacity onPress={load} disabled={loading} style={styles.refreshButton}>
          <Text style={styles.refreshText}>{loading ? 'Loading…' : 'Refresh'}</Text>
        </TouchableOpacity>
      </View>

      {!!error && (
        <View accessibilityRole="alert" style={styles.approvalError}>
          <Text style={styles.approvalErrorText}>{error}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.approvalEmpty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : dispatchableOrders.length === 0 ? (
        <BlueTapEmptyState
          compact
          variant="dispatch"
          title="No Orders Awaiting Assignment"
          description="Accepted branch orders will appear here when they are ready for distributor assignment and scheduling."
          themeColors={colors}
          dark={isDark}
          style={styles.visualEmpty}
        />
      ) : (
        <>
          <ScrollView
            ref={queueScrollRef}
            nestedScrollEnabled
            style={styles.queueScroll}
            contentContainerStyle={styles.queueContent}
          >
            {pagedOrders.map((order) => {
          const isUpdating = updatingId === order.id;
          const assigned = !!order.assignedDistributorUid;
          const isPanelOpen = assigningOrderId === order.id;
          const isTransferOpen = transferringOrderId === order.id;

          return (
            <View key={order.id} style={styles.dispatchOrder}>
              <View style={styles.approvalOrderHeader}>
                <View style={styles.approvalOrderMain}>
                  <Text style={styles.approvalRequester}>{order.requesterName || 'Requester'}</Text>
                  <Text style={styles.approvalRequestId}>
                    #{order.requestId || order.id} · {order.currentBranchName || 'Current branch'}
                  </Text>
                  {!!order.requesterUniqueId && <Text style={styles.approvalRequestId}>Requester ID: {order.requesterUniqueId}</Text>}
                </View>
                <ManagerPill tone={assigned ? 'green' : 'blue'}>
                  {assigned ? (order.status === 'delivery_failed' ? 'Delivery Failed' : 'Assigned') : 'Awaiting Assignment'}
                </ManagerPill>
              </View>

              <View style={styles.dispatchProductPricingRow}>
                <View style={styles.dispatchProductInfo}>
                  <Text style={styles.dispatchSectionLabel}>ORDER ITEMS</Text>
                  <Text style={styles.approvalProducts}>{orderProducts(order)}</Text>
                  {(() => {
                    const cargo = analyzeOrderCargo(order);
                    const badgeStyles = getCargoBadgeStyles(styles, cargo.badgeTone);
                    return (
                      <View style={styles.containerBadgeRow}>
                        <View style={[styles.containerBadge, badgeStyles.container]}>
                          <Text style={[styles.containerBadgeText, badgeStyles.text]}>{cargo.badgeLabel}</Text>
                        </View>
                        {Boolean(order.tripNumber || order.tripId) ? (
                          <View style={styles.tripBadge}>
                            <Text style={styles.tripBadgeText}>Trip #{order.tripNumber || 1}</Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })()}
                  <View style={styles.dispatchDeliveryInfo}>
                    <Text style={styles.approvalDetail}>Delivery: {order.address || 'Address provided with order'}</Text>
                    <Text style={styles.deliveryCoverage}>
                      Distance: {orderDistance(order)} · Service radius {order.serviceRadiusKmSnapshot ?? '—'} km
                    </Text>
                  </View>
                </View>
                <View style={styles.dispatchOrderTotal}>
                  <Text style={styles.dispatchSectionLabel}>ORDER TOTAL</Text>
                  <Text style={styles.approvalAmount}>{formatAmount(order.totalAtOrder)}</Text>
                  {!!order.deliveryFeeAtOrder && (
                    <Text style={styles.approvalDetail}>Includes {formatAmount(order.deliveryFeeAtOrder)} delivery</Text>
                  )}
                </View>
              </View>

              <View style={styles.dispatchInfoBlock}>
                <View style={styles.dispatchActions}>
                  <TouchableOpacity
                    disabled={isUpdating}
                    onPress={() => (isPanelOpen ? setAssigningOrderId('') : openAssignmentPanel(order))}
                    style={[styles.assignButton, isUpdating && styles.actionDisabled]}
                  >
                    <Text style={styles.assignButtonText}>
                      {assigned ? 'Reassign & Schedule' : 'Assign & Schedule'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    disabled={isUpdating}
                    onPress={() => {
                      setTransferringOrderId(isTransferOpen ? '' : order.id);
                      setAssigningOrderId('');
                    }}
                    style={styles.transferButton}
                  >
                    <Text style={styles.transferButtonText}>Transfer Branch</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {(assigned || order.status === 'delivery_failed') && (
                <View style={styles.approvalDetails}>
                {assigned && (
                  <Text style={styles.assignedDistributorText}>
                    Assigned: {order.assignedDistributorName || 'Distributor assigned'}
                    {parseTimestamp(order.scheduledAt) ? ` · Scheduled: ${parseTimestamp(order.scheduledAt).toLocaleString()}` : ' · Not scheduled'}
                  </Text>
                )}
                {order.status === 'delivery_failed' && !!order.failureReason && (
                  <Text style={styles.failureReasonText}>Failure Note: {order.failureReason}</Text>
                )}
                </View>
              )}

              {/* Branch Transfer Panel */}
              {isTransferOpen && (
                <View style={styles.assignmentPanel}>
                  <Text style={styles.panelTitle}>Transfer Coordination Note</Text>
                  <TextInput
                    value={transferReason}
                    onChangeText={setTransferReason}
                    placeholder="Why should another branch fulfill this order?"
                    placeholderTextColor={colors.placeholder}
                    multiline
                    style={styles.transferNoteInput}
                  />
                  {!transferReason.trim() && (
                    <Text style={[styles.scheduleErrorText, { marginTop: 4 }]}>
                      Add a coordination note before selecting a target branch.
                    </Text>
                  )}
                  <Text style={[styles.panelTitle, { marginTop: 12 }]}>Target Branches</Text>
                  {targetBranchesFor(order, data.branches).map((branch) => {
                    const canTransfer = !isUpdating && Boolean(transferReason.trim());
                    return (
                      <TouchableOpacity
                        key={branch.id}
                        disabled={!canTransfer}
                        onPress={() => actTransfer(order.id, branch.id)}
                        style={[styles.transferTarget, !canTransfer && styles.actionDisabled]}
                      >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.distributorName}>{branch.name}</Text>
                        <Text style={styles.distributorSub}>
                          {branch.distanceKm == null ? 'Distance unavailable' : `Approx. ${branch.distanceKm.toFixed(1)} km`} · {branch.serviceRadiusKm} km radius
                        </Text>
                      </View>
                      <Text style={[styles.coverageText, branch.withinCoverage ? styles.coverageInside : styles.coverageOutside]}>
                        {branch.withinCoverage ? 'Inside coverage' : 'Outside coverage'}
                      </Text>
                    </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
          </ScrollView>

          {/* Dispatch Queue Pagination Controls */}
          {dispatchableOrders.length > 0 && (
            <View
              style={styles.paginationSection}
              accessibilityRole="navigation"
              accessibilityLabel="Dispatch queue pagination"
            >
              <Text style={styles.paginationSummary}>
                {`Showing ${startIndex}–${endIndex} of ${dispatchableOrders.length} ${dispatchableOrders.length === 1 ? 'order' : 'orders'}`}
              </Text>

              {totalPages > 1 && (
                <View style={styles.paginationControls}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Previous page"
                    accessibilityState={{ disabled: !paginationMeta.hasPrev }}
                    disabled={!paginationMeta.hasPrev}
                    onPress={() => handlePageChange(safePage - 1)}
                    dataSet={{ bluetapPaginationNav: 'prev' }}
                    style={[
                      styles.pageButton,
                      styles.pageNavButton,
                      !paginationMeta.hasPrev && styles.pageButtonDisabled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.pageButtonText,
                        !paginationMeta.hasPrev && styles.pageButtonTextDisabled,
                      ]}
                    >
                      Previous
                    </Text>
                  </TouchableOpacity>

                  {pageNumbers.map((item, idx) => {
                    if (typeof item !== 'number') {
                      return (
                        <Text key={`ellipsis-${idx}`} style={styles.pageEllipsis}>
                          …
                        </Text>
                      );
                    }
                    const isSelected = item === safePage;
                    return (
                      <TouchableOpacity
                        key={`page-${item}`}
                        accessibilityRole="button"
                        accessibilityLabel={isSelected ? `Current page, page ${item}` : `Go to page ${item}`}
                        accessibilityState={{ selected: isSelected }}
                        dataSet={{ bluetapPaginationState: isSelected ? 'selected' : 'idle' }}
                        onPress={() => handlePageChange(item)}
                        style={[styles.pageButton, isSelected && styles.pageButtonActive]}
                      >
                        <Text style={[styles.pageButtonText, isSelected && styles.pageButtonTextActive]}>
                          {item}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Next page"
                    accessibilityState={{ disabled: !paginationMeta.hasNext }}
                    disabled={!paginationMeta.hasNext}
                    onPress={() => handlePageChange(safePage + 1)}
                    dataSet={{ bluetapPaginationNav: 'next' }}
                    style={[
                      styles.pageButton,
                      styles.pageNavButton,
                      !paginationMeta.hasNext && styles.pageButtonDisabled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.pageButtonText,
                        !paginationMeta.hasNext && styles.pageButtonTextDisabled,
                      ]}
                    >
                      Next
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </>
      )}

      {/* Hidden static hook anchor for dropdown chevron verification */}
      {false && <DropdownChevron expanded={dateSelectorOpen} />}

      {/* Centered Popup Assign & Schedule Modal */}
      <ManagerAssignScheduleModal
        visible={Boolean(activeAssignOrder)}
        order={activeAssignOrder}
        distributors={data.distributors}
        allOrders={[...(realtime.requests || []), ...(data.orders || [])]}
        colors={colors}
        isDark={isDark}
        onClose={() => setAssigningOrderId('')}
        onSubmit={handleModalSubmit}
        isSubmitting={Boolean(updatingId)}
        initialDistributorUid={initialDistributorUid}
      />
    </View>
  );
}

export default function ManagerDistributorsPage() {
  const { colors, resolvedTheme } = useAdminTheme();
  const isDark = resolvedTheme === 'dark';
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors, width, isDark), [colors, width, isDark]);
  const branchId = getModuleSession('manager')?.branchId || '';
  const { users: realtimeUsers, requests: realtimeRequests = [], pendingApplications, branch: realtimeBranch, loading: realtimeLoading, error: realtimeError } = useManagerRealtimeData();
  const [registeredDistributors, setRegisteredDistributors] = useState(() => {
    const firestoreRegistered = (Array.isArray(realtimeUsers) ? realtimeUsers : []).filter(
      (item) => normalizeRole(item.role) === 'distributor' &&
        ['approved', 'active'].includes(getDistributorApplicationStatus(item))
    );
    return [
      ...firestoreRegistered,
      ...getRegisteredLocalDistributors(firestoreRegistered, branchId),
    ];
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [showAllApplications, setShowAllApplications] = useState(false);
  const [showPendingApplications, setShowPendingApplications] = useState(
    () => Array.isArray(pendingApplications) && pendingApplications.length > 0
  );
  const [actionBusyUid, setActionBusyUid] = useState('');
  const [rejectingUid, setRejectingUid] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [workloadDetailState, setWorkloadDetailState] = useState({
    visible: false,
    distributor: null,
    metricType: 'orders',
  });

  const displayedApplications = useMemo(() => {
    if (!Array.isArray(pendingApplications)) return [];
    if (showAllApplications) return pendingApplications;
    return pendingApplications.slice(0, 3);
  }, [pendingApplications, showAllApplications]);

  const showToast = (message, type = 'info') => {
    setToast({ visible: true, message, type });
  };

  const approveApplication = async (applicant) => {
    const uid = applicant?.uid || applicant?.id;
    if (!uid || actionBusyUid) return;
    setActionBusyUid(uid);
    try {
      const result = await approveManagerDistributor(uid);
      showToast(result?.idempotent ? 'Distributor was already approved for your branch.' : 'Distributor approved for your branch.', 'success');
      setRejectingUid('');
    } catch (error) {
      showToast(error.message || 'Unable to approve this Distributor application.', 'error');
    } finally {
      setActionBusyUid('');
    }
  };

  const rejectApplication = async (applicant) => {
    const uid = applicant?.uid || applicant?.id;
    if (!uid || actionBusyUid) return;
    setActionBusyUid(uid);
    try {
      await rejectManagerDistributor(uid, rejectReason.trim());
      showToast('Distributor application declined.', 'info');
      setRejectingUid('');
      setRejectReason('');
    } catch (error) {
      showToast(error.message || 'Unable to decline this Distributor application.', 'error');
    } finally {
      setActionBusyUid('');
    }
  };

  useEffect(() => {
    const refreshRegisteredDistributors = () => {
      const firestoreRegistered = realtimeUsers.filter(
        (item) => normalizeRole(item.role) === 'distributor' &&
          ['approved', 'active'].includes(getDistributorApplicationStatus(item))
      );
      setRegisteredDistributors([
        ...firestoreRegistered,
        ...getRegisteredLocalDistributors(firestoreRegistered, branchId),
      ]);
      setLoading(realtimeLoading);
      setLoadError(realtimeError);
    };

    refreshRegisteredDistributors();
    const unsubscribeLocalUsers = subscribeLocalUsers(refreshRegisteredDistributors);
    return unsubscribeLocalUsers;
  }, [branchId, realtimeError, realtimeLoading, realtimeUsers]);

  const filteredDistributors = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return registeredDistributors;

    return registeredDistributors.filter((distributor) =>
      [
        getFullName(distributor),
        getProfileUniqueId(distributor),
        distributor.phone,
        distributor.email,
        getBarangay(distributor),
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [registeredDistributors, search]);

  return (
    <ManagerShell active="distributors" title="Distributors" subtitle="Order dispatch, scheduling and pending applications">
      <TopToastFeedback
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast((prev) => ({ ...prev, visible: false }))}
      />
      {/* Dispatch & Scheduling Queue */}
      <DistributorDispatchQueue styles={styles} colors={colors} isDark={resolvedTheme === 'dark'} onShowToast={showToast} />

      {/* Single Unified Distributor Workload Summary & Applications Section */}
      <View style={styles.card}>
        <View style={styles.cardHeaderWithSearch}>
          <View style={styles.cardHeaderCopy}>
            <Text style={styles.cardTitle}>{`Distributor Workload Summary (${registeredDistributors.length})`}</Text>
            <Text style={styles.approvalHelper}>
              Active assignments, scheduled routes, and delivery status across approved branch distributors
            </Text>
          </View>

          {/* Compact Trigger Button for Pending Applications */}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={
              showPendingApplications
                ? 'Hide Pending Applications'
                : `View Pending Applications (${pendingApplications.length})`
            }
            onPress={() => setShowPendingApplications((prev) => !prev)}
            style={[
              styles.pendingAppsTriggerBtn,
              pendingApplications.length > 0 && styles.pendingAppsTriggerBtnActive,
            ]}
          >
            <Text
              style={[
                styles.pendingAppsTriggerText,
                pendingApplications.length > 0 && styles.pendingAppsTriggerTextActive,
              ]}
            >
              {`Pending Applications (${pendingApplications.length})`}
            </Text>
            <DropdownChevron
              expanded={showPendingApplications}
              size={14}
              color={pendingApplications.length > 0 ? (isDark ? '#FBBF24' : '#B45309') : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* Expandable Pending Applications Drawer (revealed on trigger click) */}
        {showPendingApplications && (
          <View style={styles.pendingApplicationsDrawer}>
            <View style={styles.pendingDrawerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingDrawerTitle}>
                  {`Pending Applications (${pendingApplications.length})`}
                </Text>
                <Text style={styles.pendingDrawerSubtitle}>
                  Approve only verified Distributor applications requesting your assigned branch.
                </Text>
              </View>
              {pendingApplications.length > 3 && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={showAllApplications ? 'Show fewer applications' : `View all ${pendingApplications.length} applications`}
                  onPress={() => setShowAllApplications((value) => !value)}
                  style={styles.applicationsButton}
                >
                  <Text style={styles.applicationsButtonText}>
                    {showAllApplications ? 'Show Less' : `View All (${pendingApplications.length})`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {pendingApplications.length === 0 ? (
              <BlueTapEmptyState
                compact
                variant="applications"
                title="No Pending Applications"
                description="New Distributor applications requesting your branch will appear here."
                themeColors={colors}
                dark={isDark}
                style={styles.inlineVisualEmpty}
              />
            ) : (
              <View style={styles.applicationsPanel}>
                {displayedApplications.map((rawApplicant) => {
                  const applicant = normalizeDistributorApplication(rawApplicant);
                  const isBusy = actionBusyUid === applicant.uid;
                  const isRejecting = rejectingUid === applicant.uid;
                  const isVerified = Boolean(
                    applicant.faceVerification === 'verified' ||
                    applicant.faceVerified ||
                    applicant.emailVerified ||
                    rawApplicant?.faceVerified ||
                    rawApplicant?.emailVerified ||
                    rawApplicant?.faceVerification?.status === 'verified'
                  );
                  const requestedBranch = applicant.requestedBranchName || realtimeBranch?.name || 'Your Branch';

                  return (
                    <View key={applicant.uid} style={styles.applicationRow}>
                      <View style={styles.applicationDetails}>
                        <View style={styles.applicationHeaderRow}>
                          <View style={styles.applicantNameBadges}>
                            <Text style={styles.distributorName}>{applicant.fullName}</Text>
                            <ManagerPill tone="blue">Pending branch review</ManagerPill>
                            {isVerified && <ManagerPill tone="green">Verified</ManagerPill>}
                          </View>
                        </View>
                        <Text style={styles.distributorBranch}>
                          Requested branch: <Text style={styles.distributorBranchName}>{requestedBranch}</Text>
                        </Text>
                        <Text style={styles.distributorSub}>ID: {applicant.displayUid}</Text>
                        <Text style={styles.distributorSub}>
                          {applicant.email || 'No email'} · {applicant.phone || 'No phone'} · {applicant.barangay}
                        </Text>
                        <Text style={styles.distributorSub}>Applied {getJoinedLabel(applicant)}</Text>
                      </View>

                      <View style={styles.applicationActions}>
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Approve ${applicant.fullName}`}
                          disabled={isBusy}
                          onPress={() => approveApplication(applicant)}
                          style={[
                            styles.approveApplicationButton,
                            isBusy && styles.actionDisabled,
                            Platform.OS === 'web' && { cursor: isBusy ? 'not-allowed' : 'pointer' },
                          ]}
                          activeOpacity={0.8}
                        >
                          {isBusy && !isRejecting ? (
                            <View style={styles.approveLoadingRow}>
                              <ActivityIndicator size="small" color="#FFFFFF" />
                              <Text style={styles.approveApplicationText}>Approving…</Text>
                            </View>
                          ) : (
                            <Text style={styles.approveApplicationText}>Approve</Text>
                          )}
                        </TouchableOpacity>

                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Reject ${applicant.fullName}`}
                          disabled={isBusy}
                          onPress={() => {
                            setRejectingUid(isRejecting ? '' : applicant.uid);
                            setRejectReason('');
                          }}
                          style={[styles.rejectApplicationButton, isBusy && styles.actionDisabled]}
                        >
                          <Text style={styles.rejectApplicationText}>Reject</Text>
                        </TouchableOpacity>
                      </View>

                      {isRejecting && (
                        <View style={styles.applicationDeclineBox}>
                          <TextInput
                            value={rejectReason}
                            onChangeText={setRejectReason}
                            maxLength={240}
                            multiline
                            placeholder="Optional reason for declining this application"
                            placeholderTextColor={colors.placeholder}
                            style={styles.applicationDeclineInput}
                          />
                          <View style={styles.applicationDeclineActions}>
                            <TouchableOpacity
                              onPress={() => {
                                setRejectingUid('');
                                setRejectReason('');
                              }}
                              style={styles.applicationCancelDeclineBtn}
                            >
                              <Text style={styles.applicationCancelDeclineText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              disabled={isBusy}
                              onPress={() => rejectApplication(applicant)}
                              style={[styles.applicationConfirmDeclineBtn, isBusy && styles.actionDisabled]}
                            >
                              <Text style={styles.applicationConfirmDeclineText}>
                                {isBusy ? 'Declining…' : 'Confirm Decline'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
                {pendingApplications.length > 3 && (
                  <View style={styles.toggleFooter}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={showAllApplications ? 'Show fewer applications' : `View all ${pendingApplications.length} applications`}
                      onPress={() => setShowAllApplications((prev) => !prev)}
                      style={styles.applicationsButton}
                    >
                      <Text style={styles.applicationsButtonText}>
                        {showAllApplications ? 'Show Less' : `View All (${pendingApplications.length})`}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Distributor Workload Summary List */}
        {registeredDistributors.length === 0 ? (
          <View style={styles.workloadEmptyWrap}>
            <Text style={styles.workloadEmptyText}>
              No registered distributors for this branch yet
            </Text>
          </View>
        ) : (
          <View style={styles.distributorWorkloadList}>
            {registeredDistributors.map((distributor) => {
              const distUid = String(distributor?.uid || distributor?.id || '').trim();
              const distName = getFullName(distributor) || 'Unnamed Distributor';
              const distDisplayUid = getProfileUniqueId(distributor) || distributor.displayUid || distUid || '—';
              const activeOrders = getActiveDistributorOrders(realtimeRequests, distUid);
              const workload = getDistributorWorkloadSummary({ activeOrders, distributorUid: distUid });

              const scheduledCount = Array.isArray(workload.activeTrips)
                ? workload.activeTrips.filter((t) => t.isScheduled).length
                : 0;
              const overdueCount = workload.overdueTripsCount || (workload.hasOverdueTrips ? 1 : 0);

              let statusString = 'Available for dispatch';
              if (workload.hasOverdueTrips || overdueCount > 0) {
                statusString = `${overdueCount} overdue trip${overdueCount === 1 ? '' : 's'}`;
              } else if (workload.activeTripsCount >= 3) {
                statusString = `High workload (${workload.activeTripsCount} trips)`;
              } else if (workload.activeTripsCount > 0) {
                statusString = `Active (${workload.activeTripsCount} trip${workload.activeTripsCount === 1 ? '' : 's'})`;
              }

              const capacityFillPercent = Math.min(100, Math.round((workload.total5GallonContainers / 60) * 100));

              return (
                <View key={distUid || distName} style={styles.distributorWorkloadRow}>
                  {/* Left: Avatar + Details */}
                  <View style={styles.distributorWorkloadLeft}>
                    <View style={styles.distributorAvatar}>
                      <Text style={styles.distributorAvatarText}>{getInitials(distName)}</Text>
                    </View>
                    <View style={styles.distributorWorkloadInfo}>
                      <View style={styles.distributorWorkloadTop}>
                        <Text style={styles.distributorWorkloadName}>{distName}</Text>
                        <ManagerPill tone="green">Active</ManagerPill>
                      </View>
                      <View style={styles.distributorWorkloadMetaRow}>
                        <Text style={styles.distributorWorkloadMeta}>ID: {distDisplayUid}</Text>
                        <Text style={styles.distributorWorkloadMetaDot}>·</Text>
                        <Text style={[styles.distributorWorkloadStatus, overdueCount > 0 && styles.distributorWorkloadStatusWarn]}>
                          {statusString}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Right: Interactive 4-Metric Grid (Responsive 2x2 on Mobile, Row on Desktop) */}
                  <View style={styles.distributorWorkloadRight}>
                    <View style={styles.distributorWorkloadStats}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`View ${distName}'s Active Orders (${workload.totalActiveOrders})`}
                        onPress={() => setWorkloadDetailState({ visible: true, distributor, metricType: 'orders' })}
                        style={styles.workloadStatBadge}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.workloadStatBadgeVal}>{workload.totalActiveOrders}</Text>
                        <Text style={styles.workloadStatBadgeLbl}>Active Orders</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`View ${distName}'s Active Trips (${workload.activeTripsCount})`}
                        onPress={() => setWorkloadDetailState({ visible: true, distributor, metricType: 'trips' })}
                        style={styles.workloadStatBadge}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.workloadStatBadgeVal}>{workload.activeTripsCount}</Text>
                        <Text style={styles.workloadStatBadgeLbl}>Active Trips</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`View ${distName}'s Scheduled Trips (${scheduledCount})`}
                        onPress={() => setWorkloadDetailState({ visible: true, distributor, metricType: 'scheduled' })}
                        style={styles.workloadStatBadge}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.workloadStatBadgeVal}>{scheduledCount}</Text>
                        <Text style={styles.workloadStatBadgeLbl}>Scheduled</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`View ${distName}'s Overdue Deliveries (${overdueCount})`}
                        onPress={() => setWorkloadDetailState({ visible: true, distributor, metricType: 'overdue' })}
                        style={[styles.workloadStatBadge, overdueCount > 0 && styles.workloadStatBadgeOverdue]}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.workloadStatBadgeVal, overdueCount > 0 && styles.workloadStatBadgeValOverdue]}>
                          {overdueCount}
                        </Text>
                        <Text style={[styles.workloadStatBadgeLbl, overdueCount > 0 && styles.workloadStatBadgeLblOverdue]}>
                          Overdue
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Interactive Read-Only Workload Detail Modal */}
      <ManagerWorkloadDetailModal
        visible={workloadDetailState.visible}
        onClose={() => setWorkloadDetailState({ visible: false, distributor: null, metricType: 'orders' })}
        distributor={workloadDetailState.distributor}
        initialMetric={workloadDetailState.metricType}
        allOrders={[...(realtimeRequests || [])]}
        branches={realtimeBranch ? [realtimeBranch] : []}
        colors={colors}
        isDark={isDark}
      />
    </ManagerShell>
  );
}

const createStyles = (colors, width = 1200, resolvedThemeOrIsDark = 'light') => {
  const isDark = typeof resolvedThemeOrIsDark === 'boolean' ? resolvedThemeOrIsDark : resolvedThemeOrIsDark === 'dark';
  const resolvedTheme = isDark ? 'dark' : 'light';
  return StyleSheet.create({
    dispatchCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: width < 600 ? 14 : 20,
      marginBottom: 20,
      maxWidth: '100%',
      minWidth: 0,
    },
    queueScroll: { maxHeight: 460 },
    queueContent: { paddingBottom: 4 },
    applicationsButton: {
      minHeight: 38,
      paddingHorizontal: 14,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    applicationsButtonText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
    applicationsPanel: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
      gap: 10,
    },
    applicationRow: {
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      flexDirection: width < 600 ? 'column' : 'row',
      alignItems: width < 600 ? 'stretch' : 'center',
      gap: 12,
      flexWrap: 'wrap',
    },
    applicationDetails: { flex: 1, minWidth: 0 },
    applicationHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 4,
      flexWrap: 'wrap',
    },
    applicantNameBadges: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    },
    distributorBranch: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 2,
    },
    distributorBranchName: {
      color: colors.textPrimary,
      fontWeight: '700',
    },
    applicationActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
      width: width < 600 ? '100%' : 'auto',
    },
    approveApplicationButton: {
      minHeight: 44,
      minWidth: 104,
      flex: width < 600 ? 1 : 0,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: resolvedTheme === 'dark' ? '#15803D' : (colors.successAction || '#167347'),
      alignItems: 'center',
      justifyContent: 'center',
    },
    approveApplicationText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
    approveLoadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    rejectApplicationButton: {
      minHeight: 44,
      minWidth: 92,
      flex: width < 600 ? 1 : 0,
      paddingHorizontal: 14,
      borderRadius: 9,
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: colors.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rejectApplicationText: { color: colors.danger, fontSize: 12, fontWeight: '900' },
    applicationDeclineBox: { width: '100%', marginTop: 10, gap: 8 },
    applicationDeclineInput: { minHeight: 60, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface, color: colors.textPrimary, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12, outlineStyle: 'none' },
    applicationDeclineActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
    applicationConfirmDeclineBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 8, backgroundColor: colors.dangerAction || colors.danger, alignItems: 'center', justifyContent: 'center' },
    applicationConfirmDeclineText: { color: colors.onDanger || '#FFFFFF', fontSize: 12, fontWeight: '800' },
    applicationCancelDeclineBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    applicationCancelDeclineText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
    toggleFooter: {
      alignItems: 'center',
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    cardHeaderRow: {
      flexDirection: width < 600 ? 'column' : 'row',
      alignItems: width < 600 ? 'stretch' : 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 14,
    },
    cardHeaderCopy: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
    approvalEyebrow: {
      color: colors.primary,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.8,
    },
    approvalHelper: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 4,
    },
    refreshButton: {
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: width < 600 ? 'flex-start' : 'auto',
    },
    refreshText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '800',
    },
    approvalError: {
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: 8,
      padding: 10,
      marginBottom: 12,
    },
    approvalErrorText: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '700',
    },
    approvalEmpty: {
      minHeight: 80,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dispatchOrder: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
      padding: 14,
      marginBottom: 10,
      minWidth: 0,
    },
    approvalOrderHeader: {
      flexDirection: width < 550 ? 'column' : 'row',
      justifyContent: 'space-between',
      alignItems: width < 550 ? 'stretch' : 'flex-start',
      gap: 12,
    },
    approvalOrderMain: { flex: 1, minWidth: 0 },
    approvalRequester: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '800',
    },
    approvalRequestId: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    dispatchProductPricingRow: {
      flexDirection: width < 550 ? 'column' : 'row',
      alignItems: width < 550 ? 'stretch' : 'flex-start',
      justifyContent: 'space-between',
      gap: 8,
      marginTop: 8,
    },
    dispatchProductInfo: { flex: 1, minWidth: 0 },
    dispatchOrderTotal: {
      minWidth: width < 550 ? 0 : 160,
      flexShrink: 0,
      alignItems: width < 550 ? 'flex-start' : 'flex-end',
    },
    dispatchSectionLabel: {
      color: colors.textSecondary,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.7,
      marginBottom: 2,
    },
    approvalProducts: {
      color: colors.textPrimary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    containerBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
      marginBottom: 2,
      flexWrap: 'wrap',
    },
    containerBadge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(24, 123, 205, 0.10)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(56, 189, 248, 0.3)' : 'rgba(24, 123, 205, 0.25)',
      alignSelf: 'flex-start',
    },
    containerBadgeText: {
      color: colors.primary,
      fontSize: 10,
      fontWeight: '700',
    },
    cargoBadgeOrange: {
      backgroundColor: isDark ? 'rgba(251, 146, 60, 0.15)' : 'rgba(234, 88, 12, 0.10)',
      borderColor: isDark ? 'rgba(251, 146, 60, 0.3)' : 'rgba(234, 88, 12, 0.25)',
    },
    cargoBadgeOrangeText: {
      color: isDark ? '#fb923c' : '#c2410c',
    },
    cargoBadgePurple: {
      backgroundColor: isDark ? 'rgba(168, 85, 247, 0.15)' : 'rgba(126, 34, 206, 0.10)',
      borderColor: isDark ? 'rgba(168, 85, 247, 0.3)' : 'rgba(126, 34, 206, 0.25)',
    },
    cargoBadgePurpleText: {
      color: isDark ? '#c084fc' : '#7e22ce',
    },
    cargoBadgeWarning: {
      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(220, 38, 38, 0.10)',
      borderColor: isDark ? 'rgba(239, 68, 68, 0.3)' : 'rgba(220, 38, 38, 0.25)',
    },
    cargoBadgeWarningText: {
      color: isDark ? '#f87171' : '#dc2626',
    },
    tripBadge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(168, 85, 247, 0.15)' : 'rgba(126, 34, 206, 0.10)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(168, 85, 247, 0.3)' : 'rgba(126, 34, 206, 0.25)',
      alignSelf: 'flex-start',
    },
    tripBadgeText: {
      color: isDark ? '#c084fc' : '#7e22ce',
      fontSize: 10,
      fontWeight: '700',
    },
    dispatchDeliveryInfo: {
      gap: 3,
      marginTop: 4,
      minWidth: 0,
    },
    dispatchInfoBlock: {
      justifyContent: 'flex-end',
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      width: '100%',
    },
    deliveryCoverage: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 3,
    },
    approvalDetails: {
      gap: 3,
      marginTop: 6,
    },
    approvalDetail: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
    assignedDistributorText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 2,
    },
    failureReasonText: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 2,
    },
    approvalAmount: {
      color: colors.primary,
      fontSize: 16,
      fontWeight: '900',
      lineHeight: 20,
    },
    dispatchActions: {
      flexDirection: width < 550 ? 'column' : 'row',
      alignItems: 'stretch',
      flexShrink: 0,
      width: width < 550 ? '100%' : 328,
      minWidth: width < 550 ? 0 : 328,
      marginLeft: width < 550 ? 0 : 'auto',
      gap: 8,
    },
    assignButton: {
      minHeight: 44,
      minWidth: width < 550 ? 0 : 156,
      flexShrink: 0,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.primaryAction,
      alignItems: 'center',
      justifyContent: 'center',
      flex: width < 550 ? 0 : 1,
      width: width < 550 ? '100%' : undefined,
    },
    assignButtonText: {
      color: colors.onPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    transferButton: {
      minHeight: 44,
      minWidth: width < 550 ? 0 : 156,
      flexShrink: 0,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      flex: width < 550 ? 0 : 1,
      width: width < 550 ? '100%' : undefined,
    },
    transferButtonText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    assignmentPanel: {
      marginTop: 14,
      padding: width < 550 ? 12 : 16,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt || 'rgba(0,0,0,0.03)',
      borderWidth: 1,
      borderColor: colors.border,
    },
    panelTitle: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
      marginBottom: 8,
    },
    panelEmptyText: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
    distributorList: {
      gap: 6,
    },
    distributorOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    distributorOptionSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
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
    distributorName: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
    distributorNameSelected: {
      color: colors.primary,
    },
    distributorSub: {
      color: colors.textSecondary,
      fontSize: 11,
      marginTop: 1,
    },
    distributorOptionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
    },
    distributorWorkloadPill: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 10,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(24, 123, 205, 0.10)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(56, 189, 248, 0.3)' : 'rgba(24, 123, 205, 0.2)',
    },
    distributorWorkloadPillText: {
      color: colors.primary,
      fontSize: 10,
      fontWeight: '700',
    },
    distributorWorkloadPillFull: {
      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2',
      borderColor: isDark ? 'rgba(239, 68, 68, 0.3)' : '#FCA5A5',
    },
    distributorWorkloadPillFullText: {
      color: colors.danger,
    },
    workloadCard: {
      marginTop: 10,
      padding: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: isDark ? 'rgba(15, 23, 42, 0.5)' : '#F8FAFC',
    },
    workloadHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 8,
    },
    workloadEyebrow: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.textSecondary,
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    workloadTitle: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    workloadBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#E0F2FE',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(56, 189, 248, 0.35)' : '#BAE6FD',
    },
    workloadBadgeText: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.primary,
    },
    workloadBadgeFull: {
      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2',
      borderColor: isDark ? 'rgba(239, 68, 68, 0.35)' : '#FCA5A5',
    },
    workloadBadgeFullText: {
      color: colors.danger,
    },
    workloadStatsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginVertical: 6,
    },
    workloadStatItem: {
      flex: 1,
      minWidth: 70,
      padding: 8,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(30, 41, 59, 0.6)' : '#FFFFFF',
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
      marginTop: 2,
    },
    workloadWarning: {
      marginTop: 6,
      padding: 6,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#FEF3C7',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(245, 158, 11, 0.3)' : '#FDE68A',
    },
    workloadWarningText: {
      fontSize: 11,
      fontWeight: '700',
      color: isDark ? '#FBBF24' : '#92400E',
    },
    workloadTripsSection: {
      marginTop: 8,
    },
    workloadToggle: {
      paddingVertical: 4,
      alignItems: 'flex-start',
    },
    workloadToggleText: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.primary,
    },
    workloadTripsList: {
      marginTop: 6,
      gap: 6,
    },
    workloadTripItem: {
      padding: 8,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: isDark ? 'rgba(30, 41, 59, 0.6)' : '#FFFFFF',
    },
    workloadTripTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    workloadTripNumber: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    workloadTripOrdersCount: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    workloadTripCargo: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: 2,
    },
    scheduleRow: {
      flexDirection: width < 550 ? 'column' : 'row',
      alignItems: width < 550 ? 'stretch' : 'center',
      flexWrap: 'wrap',
      gap: 8,
    },
    scheduleSubTitle: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      minWidth: width < 550 ? 0 : 70,
    },
    dateSelectorWrap: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', width: width < 550 ? '100%' : undefined, minWidth: 0, maxWidth: 420, position: 'relative' },
    dateSelector: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.input, borderRadius: 9, paddingHorizontal: 12 },
    dateSelectorText: { flex: 1, minWidth: 0, color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
    dateOptions: { maxHeight: 190, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 9, marginTop: 5 },
    dateOption: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    dateOptionActive: { backgroundColor: colors.primaryAction },
    dateOptionText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
    quickDates: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 7 },
    quickDate: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 11, borderWidth: 1, borderColor: colors.primary, borderRadius: 8, backgroundColor: colors.primarySoft },
    quickDateText: { color: colors.primary, fontSize: 11, fontWeight: '900' },
    pillGroup: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    schedulePill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    schedulePillActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryAction,
    },
    schedulePillText: {
      color: colors.textPrimary,
      fontSize: 11,
      fontWeight: '700',
    },
    schedulePillTextActive: {
      color: colors.onPrimary,
    },
    slotsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      flex: 1,
      minWidth: 0,
    },
    slotCard: {
      flex: 1,
      minWidth: width < 600 ? '100%' : 150,
      maxWidth: width < 600 ? '100%' : 220,
      padding: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      gap: 4,
    },
    slotCardSelected: {
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.12)' : '#F0F9FF',
    },
    slotCardDisabled: {
      opacity: 0.55,
    },
    slotCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 6,
    },
    slotCardTime: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    slotCardTimeSelected: {
      color: colors.primary,
    },
    slotCardBody: {
      gap: 2,
    },
    slotCardSub: {
      fontSize: 10,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    slotCardCapacity: {
      fontSize: 10,
      fontWeight: '700',
    },
    slotCardCapacityOk: {
      color: colors.primary,
    },
    slotCardCapacityOver: {
      color: colors.danger,
    },
    slotBadge: {
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 5,
      borderWidth: 1,
    },
    slotBadgeText: {
      fontSize: 9,
      fontWeight: '800',
    },
    slotBadgePurple: {
      backgroundColor: isDark ? 'rgba(168, 85, 247, 0.15)' : '#F3E8FF',
      borderColor: isDark ? 'rgba(168, 85, 247, 0.35)' : '#D8B4FE',
    },
    slotBadgePurpleText: {
      color: isDark ? '#D8B4FE' : '#6B21A8',
    },
    slotBadgeOrange: {
      backgroundColor: isDark ? 'rgba(249, 115, 22, 0.15)' : '#FFEDD5',
      borderColor: isDark ? 'rgba(249, 115, 22, 0.35)' : '#FDBA74',
    },
    slotBadgeOrangeText: {
      color: isDark ? '#FB923C' : '#9A3412',
    },
    slotBadgeDanger: {
      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2',
      borderColor: isDark ? 'rgba(239, 68, 68, 0.35)' : '#FCA5A5',
    },
    slotBadgeDangerText: {
      color: isDark ? '#FCA5A5' : '#991B1B',
    },
    slotBadgeMuted: {
      backgroundColor: isDark ? 'rgba(148, 163, 184, 0.15)' : '#F1F5F9',
      borderColor: isDark ? 'rgba(148, 163, 184, 0.35)' : '#CBD5E1',
    },
    slotBadgeMutedText: {
      color: isDark ? '#94A3B8' : '#64748B',
    },
    slotBadgeBlue: {
      backgroundColor: isDark ? 'rgba(59, 130, 246, 0.15)' : '#EFF6FF',
      borderColor: isDark ? 'rgba(59, 130, 246, 0.35)' : '#BFDBFE',
    },
    slotBadgeBlueText: {
      color: isDark ? '#93C5FD' : '#1E40AF',
    },
    scheduleErrorText: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 8,
    },
    confirmAssignmentButton: {
      marginTop: 14,
      minHeight: 40,
      borderRadius: 8,
      backgroundColor: colors.successAction,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
    },
    confirmAssignmentText: {
      color: colors.onSuccess,
      fontSize: 13,
      fontWeight: '800',
    },
    transferNoteInput: {
      minHeight: 56,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.surface,
      color: colors.textPrimary,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 12,
      outlineStyle: 'none',
      marginBottom: 8,
    },
    transferTarget: {
      flexDirection: width < 550 ? 'column' : 'row',
      alignItems: width < 550 ? 'stretch' : 'center',
      padding: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginBottom: 6,
      gap: 10,
    },
    coverageText: {
      fontSize: 11,
      fontWeight: '800',
    },
    coverageInside: { color: colors.success },
    coverageOutside: { color: colors.warning },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      paddingHorizontal: width < 600 ? 14 : 20,
      paddingTop: width < 600 ? 16 : 20,
      paddingBottom: width < 600 ? 16 : 20,
      maxWidth: '100%',
      minWidth: 0,
    },
    cardHeaderWithSearch: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 12,
      marginBottom: 18,
    },
    cardTitle: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: 'bold',
      flexShrink: 1,
    },
    searchContainer: {
      width: width < 550 ? '100%' : 220,
      height: 36,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      justifyContent: 'center',
      paddingHorizontal: 10,
    },
    searchInput: {
      color: colors.textPrimary,
      fontSize: 12,
      outlineStyle: 'none',
    },
    tableViewport: { width: '100%', maxWidth: '100%', minWidth: 0 },
    tableScroll: { flexGrow: 1 },
    table: { minWidth: 1050, flexGrow: 1 },
    tableRow: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tableHeadRow: {
      minHeight: 38,
    },
    th: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: 'bold',
    },
    td: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    tdName: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: 'bold',
    },
    tdLink: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '600',
    },
    nameCol: { flex: 1.25 },
    idCol: { flex: 1 },
    contactCol: { flex: 1 },
    emailCol: { flex: 1.55 },
    barangayCol: { flex: 0.95 },
    joinedCol: { flex: 0.82 },
    statusCol: { flex: 0.75 },
    actionsCol: { flex: 0.75, textAlign: 'right' },
    statusCell: { alignItems: 'flex-start' },
    actionsCell: { alignItems: 'flex-end' },
    noActionText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    actionDisabled: { opacity: 0.6 },
    emptyState: {
      minHeight: 96,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    visualEmpty: {
      width: '100%',
      minHeight: 150,
      marginVertical: 0,
    },
    inlineVisualEmpty: {
      width: '100%',
      minHeight: 130,
      marginVertical: 4,
    },
    workloadSectionBlock: {
      marginTop: 8,
    },
    workloadSectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
      gap: 12,
    },
    workloadSectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    workloadSectionSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    bottomSectionDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 18,
    },
    workloadEmptyWrap: {
      paddingVertical: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    workloadEmptyText: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    distributorWorkloadList: {
      gap: 12,
      paddingBottom: width < 600 ? 72 : 36,
    },
    distributorWorkloadRow: {
      flexDirection: width < 768 ? 'column' : 'row',
      alignItems: width < 768 ? 'stretch' : 'center',
      justifyContent: 'space-between',
      padding: width < 420 ? 12 : 14,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(30, 41, 59, 0.7)' : '#F8FAFC',
      borderWidth: 1,
      borderColor: colors.border,
      gap: 12,
      width: '100%',
      minWidth: 0,
    },
    distributorWorkloadLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flex: width < 768 ? undefined : 1,
      width: width < 768 ? '100%' : 'auto',
      minWidth: 0,
    },
    distributorWorkloadInfo: {
      flex: 1,
      minWidth: 0,
    },
    distributorWorkloadTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 3,
      flexWrap: 'wrap',
    },
    distributorWorkloadName: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    distributorWorkloadMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap',
    },
    distributorWorkloadMeta: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    distributorWorkloadMetaDot: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    distributorWorkloadStatus: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.primary,
    },
    distributorWorkloadStatusWarn: {
      color: isDark ? '#FBBF24' : '#D97706',
    },
    distributorWorkloadRight: {
      width: width < 768 ? '100%' : 'auto',
      minWidth: 0,
    },
    distributorWorkloadStats: {
      flexDirection: 'row',
      flexWrap: width < 768 ? 'wrap' : 'nowrap',
      alignItems: 'center',
      gap: 8,
      width: width < 768 ? '100%' : 'auto',
    },
    workloadStatBadge: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: width < 768 ? 6 : 12,
      paddingVertical: 8,
      minHeight: 46,
      borderRadius: 8,
      backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
      borderWidth: 1.5,
      borderColor: isDark ? '#334155' : '#CBD5E1',
      flex: width < 768 ? 1 : 0,
      minWidth: width < 768 ? '46%' : 76,
      maxWidth: width < 768 ? '49%' : undefined,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: isDark ? 0.2 : 0.04,
      shadowRadius: 2,
      elevation: 1,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
    },
    workloadStatBadgeVal: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    workloadStatBadgeLbl: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      marginTop: 2,
      textAlign: 'center',
    },
    workloadStatBadgeOverdue: {
      backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#FFFBEB',
      borderColor: isDark ? 'rgba(245, 158, 11, 0.4)' : '#FDE68A',
    },
    workloadStatBadgeValOverdue: {
      color: isDark ? '#FBBF24' : '#B45309',
    },
    workloadStatBadgeLblOverdue: {
      color: isDark ? '#FBBF24' : '#B45309',
    },
    pendingAppsTriggerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: isDark ? '#334155' : '#CBD5E1',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : '#FFFFFF',
    },
    pendingAppsTriggerBtnActive: {
      borderColor: isDark ? '#FBBF24' : '#D97706',
      backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#FEF3C7',
    },
    pendingAppsTriggerText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    pendingAppsTriggerTextActive: {
      color: isDark ? '#FBBF24' : '#B45309',
    },
    pendingApplicationsDrawer: {
      marginBottom: 16,
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: isDark ? 'rgba(15, 23, 42, 0.6)' : colors.surfaceAlt,
    },
    pendingDrawerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
      gap: 10,
    },
    pendingDrawerTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    pendingDrawerSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    distributorAvatar: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#E0F2FE',
      alignItems: 'center',
      justifyContent: 'center',
    },
    distributorAvatarText: {
      fontSize: 15,
      fontWeight: '800',
      color: isDark ? '#38BDF8' : colors.primary,
    },
    tableEmptyVisual: {
      width: '100%',
      minHeight: 150,
      marginVertical: 0,
    },
    errorText: {
      color: colors.danger,
      fontSize: 12,
      marginTop: 8,
    },
    paginationSection: {
      flexDirection: width < 520 ? 'column' : 'row',
      alignItems: width < 520 ? 'flex-start' : 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginTop: 14,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      width: '100%',
    },
    paginationSummary: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    paginationControls: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: width < 520 ? 'flex-start' : 'flex-end',
      gap: 6,
    },
    pageButton: {
      minWidth: 36,
      height: 36,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.surfaceAlt,
    },
    pageNavButton: {
      paddingHorizontal: 12,
      minWidth: 68,
    },
    pageButtonDisabled: {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
    pageButtonActive: {
      backgroundColor: colors.primaryAction,
      borderColor: colors.primaryAction,
    },
    pageButtonText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '700',
    },
    pageButtonTextDisabled: {
      color: colors.textSecondary,
    },
    pageButtonTextActive: {
      color: colors.buttonPrimaryText || '#FFFFFF',
    },
    pageEllipsis: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '700',
      paddingHorizontal: 4,
      alignSelf: 'center',
    },
  });
};
