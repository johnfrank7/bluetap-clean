import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import TopToastFeedback from '../../components/TopToastFeedback';
import ManagerShell, { MANAGER_COLORS, ManagerPill } from '../../components/ManagerShell';
import { useManagerRealtimeData } from '../../components/ManagerRealtimeData';
import { parseTimestamp } from '../../services/notificationTimestamp';
import { approveManagerDistributor } from '../../services/managerWorkspace';
const { getManagerQueues, toManagerOrder } = require('../../services/managerOperational');
const { effectiveDeliveryDays, isAllowedDeliveryDate, manilaScheduleDate } = require('../../services/productOrderPolicy');

const normalizeApplicationStatus = (status) =>
  (status || 'pending').toString().trim().toLowerCase();

const normalizeRole = (role) => (role || '').toString().trim().toLowerCase();

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
  return manilaScheduleDate(dayOffset, slot.hours, slot.minutes);
}
const allowedDayOffsets = (order) => {
  const days = Array.isArray(order.effectiveDeliveryDaysSnapshot) ? order.effectiveDeliveryDaysSnapshot : effectiveDeliveryDays(order.items || []);
  return Array.from({ length: 14 }, (_, index) => index).filter((offset) => isAllowedDeliveryDate(buildScheduleDate(offset, TIME_SLOT_OPTIONS[0]), days));
};

function DistributorDispatchQueue({ styles, colors, isDark, onShowToast }) {
  const realtime = useManagerRealtimeData();
  const [metadata, setMetadata] = useState({ branchId: '', distributors: [], branches: [] });
  const branchMetadata = metadata.branchId === realtime.branchId ? metadata : { distributors: [], branches: [] };
  const data = useMemo(() => ({
    orders: getManagerQueues(realtime.requests, realtime.incomingTransfers, realtime.branchId).dispatch
      .map((order) => toManagerOrder(order.id, order, realtime.branch?.name || '')),
    distributors: branchMetadata.distributors,
    branches: branchMetadata.branches,
  }), [realtime, metadata]);
  const loading = realtime.loading;
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const [assigningOrderId, setAssigningOrderId] = useState('');
  const [transferringOrderId, setTransferringOrderId] = useState('');
  const [transferReason, setTransferReason] = useState('');

  // Atomic Assignment & Schedule Picker state
  const [selectedDistributorUid, setSelectedDistributorUid] = useState('');
  const [selectedDayOffset, setSelectedDayOffset] = useState(0); // 0 = today, 1 = tomorrow, 2 = in 2 days
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [dateSelectorOpen, setDateSelectorOpen] = useState(false);
  const [scheduleError, setScheduleError] = useState('');

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

  const openAssignmentPanel = (order) => {
    setAssigningOrderId(order.id);
    setTransferringOrderId('');
    setSelectedDistributorUid(order.assignedDistributorUid || (data.distributors[0]?.uid || ''));
    setSelectedDayOffset(allowedDayOffsets(order)[0] ?? 0);
    setSelectedSlotIndex(0);
    setDateSelectorOpen(false);
    setScheduleError('');
  };

  const submitAssignment = async (order, isReassign) => {
    if (!selectedDistributorUid) {
      setScheduleError('Please select a distributor.');
      return;
    }
    const slot = TIME_SLOT_OPTIONS[selectedSlotIndex] || TIME_SLOT_OPTIONS[0];
    const scheduledAt = buildScheduleDate(selectedDayOffset, slot);
    if (!allowedDayOffsets(order).includes(selectedDayOffset)) {
      setScheduleError('These products have no common delivery day in this schedule. Ask Admin to update the product schedules.');
      return;
    }

    // Validate that schedule is at least 5 minutes in the future
    if (scheduledAt.getTime() < Date.now() - 5 * 60 * 1000) {
      setScheduleError('Please select a current or future delivery time slot.');
      return;
    }

    setUpdatingId(order.id);
    setScheduleError('');
    try {
      await dispatchManagerOrder(order.id, isReassign ? 'reassign-distributor' : 'assign-distributor', {
        distributorUid: selectedDistributorUid,
        scheduledAt: scheduledAt.toISOString(),
      });
      setAssigningOrderId('');
      onShowToast?.(isReassign ? 'Distributor reassigned successfully.' : 'Distributor assigned and delivery scheduled.', 'success');
      await load();
    } catch (actError) {
      const msg = actError.message || 'Failed to assign distributor.';
      setScheduleError(msg);
      onShowToast?.(msg, 'error');
    } finally {
      setUpdatingId('');
    }
  };

  const actTransfer = async (orderId, targetBranchId) => {
    if (updatingId) return;
    setUpdatingId(orderId);
    setError('');
    try {
      await dispatchManagerOrder(orderId, 'request-transfer', { targetBranchId, transferReason });
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
        <ScrollView nestedScrollEnabled style={styles.queueScroll} contentContainerStyle={styles.queueContent}>
        {dispatchableOrders.map((order) => {
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

              <Text style={styles.approvalProducts}>{orderProducts(order)}</Text>

              <View style={styles.approvalDetails}>
                <Text style={styles.approvalDetail}>Delivery: {order.address || 'Address provided with order'}</Text>
                <Text style={styles.approvalDetail}>
                  {orderDistance(order)} · Radius {order.serviceRadiusKmSnapshot ?? '—'} km
                </Text>
                {assigned && (
                  <Text style={styles.assignedDistributorText}>
                    Assigned: {order.assignedDistributorName || 'Distributor assigned'}
                    {parseTimestamp(order.scheduledAt) ? ` · Scheduled: ${parseTimestamp(order.scheduledAt).toLocaleString()}` : ' · Not scheduled'}
                  </Text>
                )}
                {order.status === 'delivery_failed' && !!order.failureReason && (
                  <Text style={styles.failureReasonText}>Failure Note: {order.failureReason}</Text>
                )}
                <Text style={styles.approvalAmount}>{formatAmount(order.totalAtOrder)}</Text>
                {!!order.deliveryFeeAtOrder && <Text style={styles.approvalDetail}>Delivery fee: {formatAmount(order.deliveryFeeAtOrder)}</Text>}
              </View>

              <View style={styles.dispatchActions}>
                <TouchableOpacity
                  disabled={isUpdating}
                  onPress={() => (isPanelOpen ? setAssigningOrderId('') : openAssignmentPanel(order))}
                  style={[styles.assignButton, isUpdating && styles.actionDisabled]}
                >
                  <Text style={styles.assignButtonText}>
                    {isPanelOpen ? 'Close Assignment' : assigned ? 'Reassign & Schedule' : 'Assign & Schedule'}
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

              {/* Atomic Assignment + Schedule Picker */}
              {isPanelOpen && (
                <View style={styles.assignmentPanel}>
                  <Text style={styles.panelTitle}>1. Select Available Distributor</Text>
                  {metadata.branchId !== realtime.branchId ? <ActivityIndicator color={colors.primary} /> : data.distributors.length === 0 ? (
                    <Text style={styles.panelEmptyText}>No eligible distributors currently found for this branch.</Text>
                  ) : (
                    <View style={styles.distributorList}>
                      {data.distributors.map((distributor) => {
                        const isSelected = selectedDistributorUid === distributor.uid;
                        return (
                          <TouchableOpacity
                            key={distributor.uid}
                            onPress={() => setSelectedDistributorUid(distributor.uid)}
                            style={[styles.distributorOption, isSelected && styles.distributorOptionSelected]}
                          >
                            <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                              {isSelected && <View style={styles.radioDot} />}
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.distributorName, isSelected && styles.distributorNameSelected]}>
                                {distributor.name}
                              </Text>
                              <Text style={styles.distributorSub}>Eligible · This Branch</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  <Text style={[styles.panelTitle, { marginTop: 14 }]}>2. Set Delivery Schedule</Text>
                  <View style={styles.scheduleRow}>
                    <Text style={styles.scheduleSubTitle}>Delivery Date</Text>
                    <View style={styles.dateSelectorWrap}>
                      <TouchableOpacity accessibilityRole="combobox" accessibilityState={{ expanded: dateSelectorOpen }} onPress={() => setDateSelectorOpen((open) => !open)} style={styles.dateSelector}>
                        <Text style={styles.dateSelectorText}>{selectedDayOffset === 0 ? 'Today' : selectedDayOffset === 1 ? 'Tomorrow' : buildScheduleDate(selectedDayOffset, TIME_SLOT_OPTIONS[0]).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</Text>
                        <Text style={styles.dateSelectorChevron}>{dateSelectorOpen ? '▲' : '▼'}</Text>
                      </TouchableOpacity>
                      {dateSelectorOpen && <ScrollView nestedScrollEnabled style={styles.dateOptions}>
                      {allowedDayOffsets(order).map((index) => {
                        const label = index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : buildScheduleDate(index, TIME_SLOT_OPTIONS[0]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        return (
                        <TouchableOpacity
                          key={label}
                          onPress={() => { setSelectedDayOffset(index); setDateSelectorOpen(false); }}
                          style={[styles.dateOption, selectedDayOffset === index && styles.dateOptionActive]}
                        >
                          <Text style={[styles.dateOptionText, selectedDayOffset === index && styles.schedulePillTextActive]}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                        );
                      })}
                      {!allowedDayOffsets(order).length && <Text style={styles.scheduleErrorText}>The products in this order have no common delivery day. Ask Admin to update the product schedules.</Text>}
                      </ScrollView>}
                      <View style={styles.quickDates}>{[0, 1].filter((offset) => allowedDayOffsets(order).includes(offset)).map((offset) => <TouchableOpacity key={offset} onPress={() => setSelectedDayOffset(offset)} style={styles.quickDate}><Text style={styles.quickDateText}>{offset === 0 ? 'Today' : 'Tomorrow'}</Text></TouchableOpacity>)}</View>
                    </View>
                  </View>

                  <View style={[styles.scheduleRow, { marginTop: 8 }]}>
                    <Text style={styles.scheduleSubTitle}>Time Slot:</Text>
                    <View style={styles.pillGroup}>
                      {TIME_SLOT_OPTIONS.map((slot, index) => (
                        <TouchableOpacity
                          key={slot.label}
                          onPress={() => setSelectedSlotIndex(index)}
                          style={[styles.schedulePill, selectedSlotIndex === index && styles.schedulePillActive]}
                        >
                          <Text style={[styles.schedulePillText, selectedSlotIndex === index && styles.schedulePillTextActive]}>
                            {slot.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {!!scheduleError && (
                    <Text style={styles.scheduleErrorText}>{scheduleError}</Text>
                  )}

                  <TouchableOpacity
                    disabled={isUpdating || !selectedDistributorUid}
                    onPress={() => submitAssignment(order, assigned)}
                    style={[styles.confirmAssignmentButton, (isUpdating || !selectedDistributorUid) && styles.actionDisabled]}
                  >
                    <Text style={styles.confirmAssignmentText}>
                      {isUpdating ? 'Saving…' : 'Confirm Assignment & Schedule'}
                    </Text>
                  </TouchableOpacity>
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
                  <Text style={[styles.panelTitle, { marginTop: 12 }]}>Target Branches</Text>
                  {targetBranchesFor(order, data.branches).map((branch) => (
                    <TouchableOpacity
                      key={branch.id}
                      disabled={isUpdating}
                      onPress={() => actTransfer(order.id, branch.id)}
                      style={styles.transferTarget}
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
                  ))}
                </View>
              )}
            </View>
          );
        })}
        </ScrollView>
      )}
    </View>
  );
}

export default function ManagerDistributorsPage() {
  const { colors, resolvedTheme } = useAdminTheme();
  const { width } = useWindowDimensions();
  const styles = createStyles(colors, width);
  const branchId = getModuleSession('manager')?.branchId || '';
  const { users: realtimeUsers, pendingApplications, loading: realtimeLoading, error: realtimeError } = useManagerRealtimeData();
  const [registeredDistributors, setRegisteredDistributors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [applicationsVisible, setApplicationsVisible] = useState(false);
  const [approvingUid, setApprovingUid] = useState('');
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const showToast = (message, type = 'info') => {
    setToast({ visible: true, message, type });
  };

  const approveApplication = async (applicant) => {
    const uid = applicant?.uid || applicant?.id;
    if (!uid || approvingUid) return;
    setApprovingUid(uid);
    try {
      const result = await approveManagerDistributor(uid);
      showToast(result?.idempotent ? 'Distributor was already approved for your branch.' : 'Distributor approved for your branch.', 'success');
    } catch (error) {
      showToast(error.message || 'Unable to approve this Distributor application.', 'error');
    } finally {
      setApprovingUid('');
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
    <ManagerShell active="distributors" title="Distributors" subtitle="Order dispatch, assignment and registered roster">
      <TopToastFeedback
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast((prev) => ({ ...prev, visible: false }))}
      />
      {/* Dispatch & Scheduling Queue */}
      <DistributorDispatchQueue styles={styles} colors={colors} isDark={resolvedTheme === 'dark'} onShowToast={showToast} />

      {/* Registered Distributors Roster */}
      <View style={styles.card}>
        <View style={styles.cardHeaderWithSearch}>
          <Text style={styles.cardTitle}>Registered distributors ({registeredDistributors.length})</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Pending applications: ${pendingApplications.length}`} onPress={() => setApplicationsVisible((value) => !value)} style={styles.applicationsButton}>
            <Text style={styles.applicationsButtonText}>Pending applications ({pendingApplications.length})</Text>
          </TouchableOpacity>
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search distributors..."
              placeholderTextColor={colors.placeholder}
              value={search}
              onChangeText={setSearch}
            />
          </View>
        </View>

        {applicationsVisible && <View style={styles.applicationsPanel}>
          <Text style={styles.approvalHelper}>Approve only verified Distributor applications requesting your assigned branch.</Text>
          {pendingApplications.length === 0 ? (
            <BlueTapEmptyState
              compact
              variant="applications"
              title="No Pending Applications"
              description="Distributor applications requesting this branch will appear here."
              themeColors={colors}
              dark={resolvedTheme === 'dark'}
              style={styles.inlineVisualEmpty}
            />
          ) : pendingApplications.map((applicant) =>
            <View key={applicant.uid || applicant.id} style={styles.applicationRow}>
              <View style={styles.applicationDetails}>
              <Text style={styles.distributorName}>{getFullName(applicant)}</Text>
              <Text style={styles.distributorSub}>{getProfileUniqueId(applicant) || applicant.email || 'ID pending'}</Text>
              <Text style={styles.distributorSub}>{applicant.email || applicant.phone || 'Contact not set'} · {getBarangay(applicant)}</Text>
              <Text style={styles.distributorSub}>Applied {getJoinedLabel(applicant)} · Pending branch review</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Approve ${getFullName(applicant)}`}
                disabled={Boolean(approvingUid)}
                onPress={() => approveApplication(applicant)}
                style={[styles.approveApplicationButton, Boolean(approvingUid) && styles.actionDisabled]}
              >
                {approvingUid === (applicant.uid || applicant.id)
                  ? <ActivityIndicator size="small" color={colors.onPrimary || '#FFFFFF'} />
                  : <Text style={styles.approveApplicationText}>Approve</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>}

        <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableViewport} contentContainerStyle={styles.tableScroll}>
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeadRow]}>
              <Text style={[styles.th, styles.nameCol]}>NAME</Text>
              <Text style={[styles.th, styles.idCol]}>UNIQUE ID</Text>
              <Text style={[styles.th, styles.contactCol]}>CONTACT</Text>
              <Text style={[styles.th, styles.emailCol]}>EMAIL</Text>
              <Text style={[styles.th, styles.barangayCol]}>BARANGAY</Text>
              <Text style={[styles.th, styles.joinedCol]}>JOINED</Text>
              <Text style={[styles.th, styles.statusCol]}>STATUS</Text>
              <Text style={[styles.th, styles.actionsCol]}>ACTIONS</Text>
            </View>

            {loading ? (
              <View style={styles.emptyState}>
                <ActivityIndicator color={colors.primary} size="small" />
              </View>
            ) : filteredDistributors.length === 0 ? (
              <View style={styles.emptyState}>
                <BlueTapEmptyState
                  compact
                  variant="people"
                  title={registeredDistributors.length === 0 ? 'No Registered Distributors' : 'No Matching Distributors'}
                  description={registeredDistributors.length === 0
                    ? 'Approved distributors assigned to this branch will appear here.'
                    : 'Try a different name, UID, or contact search.'}
                  themeColors={colors}
                  dark={resolvedTheme === 'dark'}
                  style={styles.tableEmptyVisual}
                />
                {!!loadError && <Text style={styles.errorText}>Distributor records could not be loaded.</Text>}
              </View>
            ) : (
              filteredDistributors.map((distributor) => {
                const fullName = getFullName(distributor);
                const distributorId = distributor.uid || distributor.id;

                return (
                  <View key={distributorId || distributor.email} style={styles.tableRow}>
                    <Text style={[styles.tdName, styles.nameCol]} numberOfLines={1}>
                      {fullName}
                    </Text>
                    <Text style={[styles.td, styles.idCol]} numberOfLines={1}>
                      {getProfileUniqueId(distributor) || 'Not set'}
                    </Text>
                    <Text style={[styles.td, styles.contactCol]} numberOfLines={1}>
                      {distributor.phone || 'Not set'}
                    </Text>
                    <Text style={[styles.tdLink, styles.emailCol]} numberOfLines={1}>
                      {distributor.email || 'Not set'}
                    </Text>
                    <Text style={[styles.td, styles.barangayCol]} numberOfLines={1}>
                      {getBarangay(distributor)}
                    </Text>
                    <Text style={[styles.td, styles.joinedCol]} numberOfLines={1}>
                      {getJoinedLabel(distributor)}
                    </Text>
                    <View style={[styles.statusCell, styles.statusCol]}>
                      <ManagerPill tone="green">Active</ManagerPill>
                    </View>
                    <View style={[styles.actionsCell, styles.actionsCol]}>
                      <Text style={styles.noActionText}>Branch Assigned</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      </View>
    </ManagerShell>
  );
}

const createStyles = (colors, width = 1200) =>
  StyleSheet.create({
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
    applicationsButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft, justifyContent: 'center' },
    applicationsButtonText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
    applicationsPanel: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, marginBottom: 12, gap: 8 },
    applicationRow: { paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: width < 550 ? 'column' : 'row', alignItems: width < 550 ? 'stretch' : 'center', gap: 12 },
    applicationDetails: { flex: 1, minWidth: 0 },
    approveApplicationButton: { minHeight: 44, minWidth: 92, width: width < 550 ? '100%' : undefined, paddingHorizontal: 14, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    approveApplicationText: { color: colors.onPrimary || '#FFFFFF', fontSize: 12, fontWeight: '900' },
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
    approvalProducts: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
      marginTop: 8,
    },
    approvalDetails: {
      gap: 3,
      marginTop: 8,
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
      fontSize: 15,
      fontWeight: '900',
      marginTop: 4,
    },
    dispatchActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: width >= 800 ? 'flex-end' : 'flex-start',
      gap: 8,
      marginTop: 12,
    },
    assignButton: {
      minHeight: 38,
      paddingHorizontal: 14,
      borderRadius: 8,
      backgroundColor: colors.primaryAction,
      alignItems: 'center',
      justifyContent: 'center',
      width: width < 550 ? '100%' : undefined,
    },
    assignButtonText: {
      color: colors.onPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    transferButton: {
      minHeight: 38,
      paddingHorizontal: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
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
    dateSelectorChevron: { color: colors.primary, fontSize: 11, fontWeight: '900' },
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
  });
