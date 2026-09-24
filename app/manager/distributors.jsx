import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../../firebase';
import { getLocalUsers, subscribeLocalUsers } from '../../localUsers';
import { getProfileUniqueId } from '../../services/uniqueIds';
import { getModuleSession } from '../../services/authSession';
import { dispatchManagerOrder, getManagerDispatch } from '../../services/managerOrderApprovals';
import { haversineDistanceKm } from '../../services/location';
import { useAdminTheme } from '../../components/AdminTheme';
import ManagerShell, { MANAGER_COLORS, ManagerPill } from '../../components/ManagerShell';

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

const formatAmount = (amount) => `\u20B1${Number(amount || 0).toFixed(2)}`;

const getJoinedLabel = (user = {}) => {
  const value = user.createdAt || user.created_at || user.joinedAt || user.joined;
  if (!value) return 'Not set';
  let date = null;
  if (typeof value?.toDate === 'function') date = value.toDate();
  else if (typeof value?.toMillis === 'function') date = new Date(value.toMillis());
  else if (value.seconds) date = new Date(value.seconds * 1000);
  else date = new Date(value);

  if (!date || Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date);
};

const orderProducts = (order) =>
  order.items?.map((item) => `${item.quantity} \u00D7 ${item.productNameSnapshot}`).filter(Boolean).join(', ') || 'Order products';

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
  const target = new Date();
  target.setDate(target.getDate() + dayOffset);
  target.setHours(slot.hours, slot.minutes, 0, 0);
  return target;
}

function DistributorDispatchQueue({ styles, colors }) {
  const [data, setData] = useState({ orders: [], incomingTransfers: [], sourceDecisionEvents: [], distributors: [], branches: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const [assigningOrderId, setAssigningOrderId] = useState('');
  const [transferringOrderId, setTransferringOrderId] = useState('');
  const [transferReason, setTransferReason] = useState('');

  // Atomic Assignment & Schedule Picker state
  const [selectedDistributorUid, setSelectedDistributorUid] = useState('');
  const [selectedDayOffset, setSelectedDayOffset] = useState(0); // 0 = today, 1 = tomorrow, 2 = in 2 days
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [scheduleError, setScheduleError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getManagerDispatch());
    } catch (loadFailure) {
      setError(loadFailure.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openAssignmentPanel = (order) => {
    setAssigningOrderId(order.id);
    setTransferringOrderId('');
    setSelectedDistributorUid(order.assignedDistributorUid || (data.distributors[0]?.uid || ''));
    setSelectedDayOffset(0);
    setSelectedSlotIndex(0);
    setScheduleError('');
  };

  const submitAssignment = async (order, isReassign) => {
    if (!selectedDistributorUid) {
      setScheduleError('Please select a distributor.');
      return;
    }
    const slot = TIME_SLOT_OPTIONS[selectedSlotIndex] || TIME_SLOT_OPTIONS[0];
    const scheduledAt = buildScheduleDate(selectedDayOffset, slot);

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
      await load();
    } catch (actError) {
      setScheduleError(actError.message || 'Failed to assign distributor.');
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
      await load();
    } catch (actionFailure) {
      setError(actionFailure.message);
    } finally {
      setUpdatingId('');
    }
  };

  const dispatchableOrders = data.orders.filter(
    (order) =>
      order.status !== 'branch_transfer_pending' &&
      ['awaiting_distributor_assignment', 'distributor_assigned', 'accepted', 'scheduled', 'delivery_failed'].includes(order.status)
  );

  return (
    <View style={styles.dispatchCard}>
      <View style={styles.cardHeaderRow}>
        <View>
          <Text style={styles.approvalEyebrow}>DISPATCH QUEUE</Text>
          <Text style={styles.cardTitle}>Distributor Dispatch & Scheduling</Text>
          <Text style={styles.approvalHelper}>
            Assign available distributors and set atomic delivery schedules for active branch orders.
          </Text>
        </View>
        <TouchableOpacity onPress={load} disabled={loading} style={styles.refreshButton}>
          <Text style={styles.refreshText}>{loading ? 'Loading\u2026' : 'Refresh'}</Text>
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
        <View style={styles.approvalEmpty}>
          <Text style={styles.emptyText}>No orders are currently waiting for distributor assignment.</Text>
        </View>
      ) : (
        dispatchableOrders.map((order) => {
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
                    #{order.requestId || order.id} \u00B7 {order.currentBranchName || 'Current branch'}
                  </Text>
                </View>
                <ManagerPill tone={assigned ? 'green' : 'blue'}>
                  {assigned ? (order.status === 'delivery_failed' ? 'Delivery Failed' : 'Assigned') : 'Awaiting Assignment'}
                </ManagerPill>
              </View>

              <Text style={styles.approvalProducts}>{orderProducts(order)}</Text>

              <View style={styles.approvalDetails}>
                <Text style={styles.approvalDetail}>Delivery: {order.address || 'Address provided with order'}</Text>
                <Text style={styles.approvalDetail}>
                  {orderDistance(order)} \u00B7 Radius {order.serviceRadiusKmSnapshot ?? '\u2014'} km
                </Text>
                {assigned && (
                  <Text style={styles.assignedDistributorText}>
                    Assigned: {order.assignedDistributorName || 'Distributor assigned'}
                    {order.scheduledAt ? ` \u00B7 Scheduled: ${new Date(order.scheduledAt).toLocaleString()}` : ''}
                  </Text>
                )}
                {order.status === 'delivery_failed' && !!order.failureReason && (
                  <Text style={styles.failureReasonText}>Failure Note: {order.failureReason}</Text>
                )}
                <Text style={styles.approvalAmount}>{formatAmount(order.totalAtOrder)}</Text>
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
                  {data.distributors.length === 0 ? (
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
                              <Text style={styles.distributorSub}>Eligible \u00B7 This Branch</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  <Text style={[styles.panelTitle, { marginTop: 14 }]}>2. Set Delivery Schedule</Text>
                  <View style={styles.scheduleRow}>
                    <Text style={styles.scheduleSubTitle}>Date:</Text>
                    <View style={styles.pillGroup}>
                      {['Today', 'Tomorrow', 'In 2 Days'].map((label, index) => (
                        <TouchableOpacity
                          key={label}
                          onPress={() => setSelectedDayOffset(index)}
                          style={[styles.schedulePill, selectedDayOffset === index && styles.schedulePillActive]}
                        >
                          <Text style={[styles.schedulePillText, selectedDayOffset === index && styles.schedulePillTextActive]}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      ))}
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
                      {isUpdating ? 'Saving\u2026' : 'Confirm Assignment & Schedule'}
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
                          {branch.distanceKm == null ? 'Distance unavailable' : `Approx. ${branch.distanceKm.toFixed(1)} km`} \u00B7 {branch.serviceRadiusKm} km radius
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
        })
      )}
    </View>
  );
}

export default function ManagerDistributorsPage() {
  const { colors } = useAdminTheme();
  const styles = createStyles(colors);
  const branchId = getModuleSession('manager')?.branchId || '';
  const [registeredDistributors, setRegisteredDistributors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let firestoreRegistered = [];

    const refreshRegisteredDistributors = (nextFirestoreRegistered = firestoreRegistered) => {
      firestoreRegistered = nextFirestoreRegistered;
      setRegisteredDistributors([
        ...firestoreRegistered,
        ...getRegisteredLocalDistributors(firestoreRegistered, branchId),
      ]);
      setLoading(false);
    };

    refreshRegisteredDistributors();
    const unsubscribeLocalUsers = subscribeLocalUsers(() => refreshRegisteredDistributors());

    const registeredQuery = query(
      collection(db, 'users'),
      where('role', '==', 'distributor'),
      where('branchId', '==', branchId)
    );

    const unsubscribe = onSnapshot(
      registeredQuery,
      (snapshot) => {
        const firestoreDistributors = snapshot.docs
          .map((item) => ({
            id: item.id,
            uid: item.id,
            ...item.data(),
          }))
          .filter((item) => ['approved', 'active'].includes(getDistributorApplicationStatus(item)));

        refreshRegisteredDistributors(firestoreDistributors);
        setLoadError('');
      },
      (error) => {
        console.log('Registered distributors error:', error.message);
        setLoadError(error.message);
        refreshRegisteredDistributors();
      }
    );

    return () => {
      unsubscribe();
      unsubscribeLocalUsers();
    };
  }, [branchId]);

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
      {/* Dispatch & Scheduling Queue */}
      <DistributorDispatchQueue styles={styles} colors={colors} />

      {/* Registered Distributors Roster */}
      <View style={styles.card}>
        <View style={styles.cardHeaderWithSearch}>
          <Text style={styles.cardTitle}>Registered distributors ({registeredDistributors.length})</Text>
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

        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableScroll}>
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
                <Text style={styles.emptyText}>No registered distributors found.</Text>
                {!!loadError && <Text style={styles.errorText}>Firestore: {loadError}</Text>}
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

const createStyles = (colors) =>
  StyleSheet.create({
    dispatchCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 20,
      marginBottom: 20,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 14,
    },
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
      minHeight: 36,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
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
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 16,
      marginTop: 14,
    },
    approvalOrderHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
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
      gap: 8,
      marginTop: 12,
    },
    assignButton: {
      minHeight: 38,
      paddingHorizontal: 14,
      borderRadius: 8,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    assignButtonText: {
      color: '#FFFFFF',
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
    },
    transferButtonText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    assignmentPanel: {
      marginTop: 14,
      padding: 16,
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
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
    },
    scheduleSubTitle: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      minWidth: 70,
    },
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
      backgroundColor: colors.primary,
    },
    schedulePillText: {
      color: colors.textPrimary,
      fontSize: 11,
      fontWeight: '700',
    },
    schedulePillTextActive: {
      color: '#FFFFFF',
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
      backgroundColor: colors.success,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
    },
    confirmAssignmentText: {
      color: '#FFFFFF',
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
      flexDirection: 'row',
      alignItems: 'center',
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
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 20,
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
    },
    searchContainer: {
      width: 220,
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
    errorText: {
      color: colors.danger,
      fontSize: 12,
      marginTop: 8,
    },
  });
