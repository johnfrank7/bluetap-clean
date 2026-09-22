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
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';

import { db } from '../../firebase';
import { getLocalUsers, subscribeLocalUsers } from '../../localUsers';
import { getProfileUniqueId } from '../../services/uniqueIds';
import { getModuleSession } from '../../services/authSession';
import { decideOutsideRadiusOrder, dispatchManagerOrder, getManagerDispatch, getOutsideRadiusOrders } from '../../services/managerOrderApprovals';
import { haversineDistanceKm } from '../../services/location';
import { useAdminTheme } from '../../components/AdminTheme';
import ManagerShell, {
  MANAGER_COLORS,
  ManagerPill,
} from '../../components/ManagerShell';

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

const getPendingLocalDistributors = (firestoreDistributors = [], branchId = '') =>
  getLocalUsers()
    .filter(
      (user) =>
        user.branchId === branchId &&
        normalizeRole(user.role) === 'distributor' &&
        getDistributorApplicationStatus(user) === 'pending'
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
  'Unnamed user';

const getBarangay = (user = {}) =>
  (user.barangay || user.address || 'Not set').toString().trim() || 'Not set';

const formatAmount = (amount) => `₱${Number(amount || 0).toFixed(2)}`;

function OutsideRadiusApprovalQueue({ styles }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try { setOrders(await getOutsideRadiusOrders()); }
    catch (loadFailure) { setError(loadFailure.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const decide = async (order, action) => {
    if (updatingId) return;
    setUpdatingId(order.id); setError('');
    try {
      await decideOutsideRadiusOrder(order.id, action);
      setOrders((current) => current.filter((item) => item.id !== order.id));
    } catch (updateFailure) { setError(updateFailure.message); }
    finally { setUpdatingId(''); }
  };
  return <View style={styles.approvalCard}>
    <View style={styles.approvalHeader}><View><Text style={styles.approvalEyebrow}>DELIVERY EXCEPTIONS</Text><Text style={styles.approvalTitle}>Outside-radius approvals</Text><Text style={styles.approvalHelper}>Only requests for your assigned branch appear here.</Text></View><TouchableOpacity onPress={load} disabled={loading} style={styles.refreshButton}><Text style={styles.refreshText}>{loading ? 'Loading…' : 'Refresh'}</Text></TouchableOpacity></View>
    {!!error && <View accessibilityRole="alert" style={styles.approvalError}><Text style={styles.approvalErrorText}>{error}</Text></View>}
    {loading ? <View style={styles.approvalEmpty}><ActivityIndicator color={styles.primaryColor || MANAGER_COLORS.blue} /></View> : orders.length === 0 ? <View style={styles.approvalEmpty}><Text style={styles.emptyText}>No outside-radius requests are waiting for approval.</Text></View> : orders.map((order) => {
      const isUpdating = updatingId === order.id;
      const products = order.items?.map((item) => `${item.quantity} × ${item.productNameSnapshot}`).filter(Boolean).join(', ') || 'Order products';
      return <View key={order.id} style={styles.approvalOrder}><View style={styles.approvalOrderHeader}><View style={styles.approvalOrderMain}><Text style={styles.approvalRequester}>{order.requesterName || 'Requester'}</Text><Text style={styles.approvalRequestId}>{order.requestId || order.id}</Text></View><ManagerPill tone="cyan">Approval needed</ManagerPill></View><Text style={styles.approvalProducts}>{products}</Text><View style={styles.approvalDetails}><Text style={styles.approvalDetail}>Delivery: {order.address || (order.deliveryLocation ? `${order.deliveryLocation.latitude.toFixed(5)}, ${order.deliveryLocation.longitude.toFixed(5)}` : 'Location provided')}</Text><Text style={styles.approvalDetail}>Approx. {Number(order.distanceKmSnapshot || 0).toFixed(1)} km · Branch radius {order.serviceRadiusKmSnapshot} km</Text><Text style={styles.approvalAmount}>{formatAmount(order.totalAtOrder)}</Text></View><View style={styles.approvalActions}><TouchableOpacity disabled={isUpdating} onPress={() => decide(order, 'approve')} style={[styles.approveDeliveryButton, isUpdating && styles.actionDisabled]}><Text style={styles.approveDeliveryText}>{isUpdating ? 'Saving…' : 'Approve delivery'}</Text></TouchableOpacity><TouchableOpacity disabled={isUpdating} onPress={() => decide(order, 'decline')} style={[styles.declineDeliveryButton, isUpdating && styles.actionDisabled]}><Text style={styles.declineDeliveryText}>Decline</Text></TouchableOpacity><TouchableOpacity disabled style={styles.messagePlaceholder}><Text style={styles.messagePlaceholderText}>Message requester (coming soon)</Text></TouchableOpacity></View></View>;
    })}
  </View>;
}

const orderProducts = (order) => order.items?.map((item) => `${item.quantity} × ${item.productNameSnapshot}`).filter(Boolean).join(', ') || 'Order products';
const orderDistance = (order) => order.distanceKmSnapshot == null ? 'Distance unavailable' : `Approx. ${Number(order.distanceKmSnapshot).toFixed(1)} km`;
const targetBranchesFor = (order, branches) => [...(branches || [])].map((branch) => {
  const distanceKm = order.deliveryLocation ? haversineDistanceKm(order.deliveryLocation, branch) : null;
  const radius = Number(branch.serviceRadiusKm || 5);
  return { ...branch, distanceKm, withinCoverage: distanceKm !== null && distanceKm <= radius };
}).sort((left, right) => (left.distanceKm ?? Infinity) - (right.distanceKm ?? Infinity));

function DispatchQueue({ styles, placeholderColor }) {
  const [data, setData] = useState({ orders: [], incomingTransfers: [], sourceDecisionEvents: [], distributors: [], branches: [] });
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [updatingId, setUpdatingId] = useState('');
  const [assigningOrderId, setAssigningOrderId] = useState(''); const [transferringOrderId, setTransferringOrderId] = useState('');
  const [transferReason, setTransferReason] = useState(''); const [decliningOrderId, setDecliningOrderId] = useState(''); const [declineReason, setDeclineReason] = useState('');
  const load = async () => { setLoading(true); setError(''); try { setData(await getManagerDispatch()); } catch (loadFailure) { setError(loadFailure.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const act = async (orderId, action, payload = {}) => {
    if (updatingId) return;
    setUpdatingId(orderId); setError('');
    try { await dispatchManagerOrder(orderId, action, payload); setAssigningOrderId(''); setTransferringOrderId(''); setDecliningOrderId(''); setTransferReason(''); setDeclineReason(''); await load(); }
    catch (actionFailure) { setError(actionFailure.message); }
    finally { setUpdatingId(''); }
  };
  return <View style={styles.dispatchCard}>
    <View style={styles.approvalHeader}><View><Text style={styles.approvalEyebrow}>DISPATCH</Text><Text style={styles.approvalTitle}>Distributor assignments</Text><Text style={styles.approvalHelper}>Dispatch controls belong only to the Manager of the current owning branch.</Text></View><TouchableOpacity onPress={load} disabled={loading} style={styles.refreshButton}><Text style={styles.refreshText}>{loading ? 'Loading…' : 'Refresh'}</Text></TouchableOpacity></View>
    {!!error && <View accessibilityRole="alert" style={styles.approvalError}><Text style={styles.approvalErrorText}>{error}</Text></View>}
    {loading ? <View style={styles.approvalEmpty}><ActivityIndicator color={MANAGER_COLORS.blue} /></View> : <>
      {data.orders.length === 0 ? <View style={styles.approvalEmpty}><Text style={styles.emptyText}>No current orders are waiting for dispatch.</Text></View> : data.orders.map((order) => {
        const isUpdating = updatingId === order.id; const assigned = !!order.assignedDistributorUid; const transferPending = order.status === 'branch_transfer_pending';
        return <View key={order.id} style={styles.dispatchOrder}><View style={styles.approvalOrderHeader}><View style={styles.approvalOrderMain}><Text style={styles.approvalRequester}>{order.requesterName || 'Requester'}</Text><Text style={styles.approvalRequestId}>{order.requestId || order.id} · {order.currentBranchName || 'Current branch'}</Text></View><ManagerPill tone={transferPending ? 'cyan' : assigned ? 'green' : 'blue'}>{transferPending ? 'Transfer in progress' : assigned ? 'Distributor assigned' : 'Awaiting assignment'}</ManagerPill></View><Text style={styles.approvalProducts}>{orderProducts(order)}</Text><View style={styles.approvalDetails}><Text style={styles.approvalDetail}>Delivery: {order.address || 'Address provided with the order'}</Text><Text style={styles.approvalDetail}>{orderDistance(order)} · Branch radius {order.serviceRadiusKmSnapshot ?? '—'} km</Text><Text style={styles.approvalDetail}>Coverage: {order.outsideServiceArea ? 'Outside normal area (approved)' : 'Within normal area'}</Text>{assigned && <Text style={styles.assignedDistributor}>Assigned Distributor: {order.assignedDistributorName || 'Assigned'}</Text>}<Text style={styles.approvalAmount}>{formatAmount(order.totalAtOrder)}</Text></View>
          {!transferPending && <View style={styles.dispatchActions}><TouchableOpacity disabled={isUpdating} onPress={() => { setAssigningOrderId(assigningOrderId === order.id ? '' : order.id); setTransferringOrderId(''); }} style={[styles.approveDeliveryButton, isUpdating && styles.actionDisabled]}><Text style={styles.approveDeliveryText}>{assigned ? 'Reassign Distributor' : 'Assign Distributor'}</Text></TouchableOpacity><TouchableOpacity disabled={isUpdating} onPress={() => { setTransferringOrderId(transferringOrderId === order.id ? '' : order.id); setAssigningOrderId(''); }} style={styles.transferButton}><Text style={styles.transferButtonText}>Transfer Branch</Text></TouchableOpacity><TouchableOpacity disabled style={styles.messagePlaceholder}><Text style={styles.messagePlaceholderText}>Contact branch manager (coming soon)</Text></TouchableOpacity></View>}
          {assigningOrderId === order.id && <View style={styles.dispatchPicker}><Text style={styles.dispatchPickerLabel}>{assigned ? 'Available Distributor' : 'Assign Distributor'}</Text>{data.distributors.length === 0 ? <Text style={styles.dispatchPickerEmpty}>No eligible, unassigned Distributor is currently available for this branch.</Text> : data.distributors.map((distributor) => <TouchableOpacity key={distributor.uid} disabled={isUpdating} onPress={() => act(order.id, assigned ? 'reassign-distributor' : 'assign-distributor', { distributorUid: distributor.uid })} style={styles.dispatchOption}><Text style={styles.dispatchOptionText}>{distributor.name}</Text><Text style={styles.dispatchOptionHint}>Available · this branch</Text></TouchableOpacity>)}</View>}
          {transferringOrderId === order.id && <View style={styles.dispatchPicker}><Text style={styles.dispatchPickerLabel}>Transfer coordination note</Text><TextInput value={transferReason} onChangeText={setTransferReason} placeholder="Why should this branch take the order?" placeholderTextColor={placeholderColor} multiline style={styles.transferNoteInput} />{targetBranchesFor(order, data.branches).map((branch) => <TouchableOpacity key={branch.id} disabled={isUpdating} onPress={() => act(order.id, 'request-transfer', { targetBranchId: branch.id, transferReason })} style={styles.transferTarget}><View style={styles.transferTargetMain}><Text style={styles.dispatchOptionText}>{branch.name}</Text><Text style={styles.dispatchOptionHint}>{branch.distanceKm == null ? 'Distance unavailable' : `Approx. ${branch.distanceKm.toFixed(1)} km`} · {branch.serviceRadiusKm} km radius</Text></View><Text style={[styles.coverageText, branch.withinCoverage ? styles.coverageInside : styles.coverageOutside]}>{branch.withinCoverage ? 'Inside coverage' : 'Outside coverage'}</Text></TouchableOpacity>)}</View>}
        </View>;
      })}
      <View style={styles.incomingHeading}><Text style={styles.approvalTitle}>Incoming branch transfers</Text><Text style={styles.approvalHelper}>Only this branch can review these pending transfers.</Text></View>
      {data.incomingTransfers.length === 0 ? <Text style={styles.emptyText}>No incoming transfer requests.</Text> : data.incomingTransfers.map((order) => { const isUpdating = updatingId === order.id; return <View key={order.id} style={styles.incomingTransfer}><Text style={styles.approvalRequester}>Incoming transfer from {order.transferFromBranchName || 'another branch'}</Text><Text style={styles.approvalRequestId}>{order.requestId || order.id} · {order.requesterName || 'Requester'}</Text><Text style={styles.approvalProducts}>{orderProducts(order)}</Text><Text style={styles.approvalDetail}>{orderDistance(order)} · Requested note: {order.transferReason || 'No note'}</Text><View style={styles.dispatchActions}><TouchableOpacity disabled={isUpdating} onPress={() => act(order.id, 'accept-transfer')} style={[styles.approveDeliveryButton, isUpdating && styles.actionDisabled]}><Text style={styles.approveDeliveryText}>{isUpdating ? 'Saving…' : 'Accept transfer'}</Text></TouchableOpacity><TouchableOpacity disabled={isUpdating} onPress={() => setDecliningOrderId(decliningOrderId === order.id ? '' : order.id)} style={styles.declineDeliveryButton}><Text style={styles.declineDeliveryText}>Decline</Text></TouchableOpacity></View>{decliningOrderId === order.id && <View style={styles.declinePanel}><TextInput value={declineReason} onChangeText={setDeclineReason} placeholder="Optional decline note" placeholderTextColor={placeholderColor} multiline style={styles.transferNoteInput} /><TouchableOpacity disabled={isUpdating} onPress={() => act(order.id, 'decline-transfer', { transferDeclineReason: declineReason })} style={styles.declineConfirmButton}><Text style={styles.declineConfirmText}>Confirm decline</Text></TouchableOpacity></View>}</View>; })}
      <View style={styles.incomingHeading}><Text style={styles.approvalTitle}>Transfer decisions</Text><Text style={styles.approvalHelper}>Decisions from other branches for transfers your branch initiated.</Text></View>
      {data.sourceDecisionEvents.length === 0 ? <Text style={styles.emptyText}>No transfer decisions yet.</Text> : data.sourceDecisionEvents.map((event) => { const accepted = event.decision === 'accepted'; const targetName = event.targetBranchName || 'The target branch'; const requestId = event.requestId || 'your order'; return <View key={event.id} style={styles.incomingTransfer}><ManagerPill tone={accepted ? 'green' : 'cyan'}>{accepted ? 'Accepted' : 'Declined'}</ManagerPill><Text style={styles.approvalDetail}>{targetName} {accepted ? 'accepted' : 'declined'} the transfer of Order #{requestId}.</Text>{!accepted && !!event.declineReason && <Text style={styles.dispatchPickerEmpty}>Reason: {event.declineReason}</Text>}</View>; })}
    </>}
  </View>;
}

export default function ManagerRequestPage() {
  const { colors } = useAdminTheme(); const styles = createStyles(colors);
  const branchId = getModuleSession('manager')?.branchId || '';
  const [pendingDistributors, setPendingDistributors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let firestorePending = [];

    const refreshPendingDistributors = (nextFirestorePending = firestorePending) => {
      firestorePending = nextFirestorePending;
      setPendingDistributors([
        ...firestorePending,
        ...getPendingLocalDistributors(firestorePending, branchId),
      ]);
      setLoading(false);
    };

    refreshPendingDistributors();
    const unsubscribeLocalUsers = subscribeLocalUsers(() => refreshPendingDistributors());

    const pendingQuery = query(
      collection(db, 'users'),
      where('role', '==', 'distributor'),
      where('branchId', '==', branchId)
    );

    const unsubscribe = onSnapshot(
      pendingQuery,
      (snapshot) => {
        const firestoreDistributors = snapshot.docs
          .map((item) => ({
            id: item.id,
            uid: item.id,
            ...item.data(),
          }))
          .filter((item) => getDistributorApplicationStatus(item) === 'pending');

        refreshPendingDistributors(firestoreDistributors);
        setLoadError('');
      },
      (error) => {
        console.log('Pending distributors error:', error.message);
        setLoadError(error.message);
        refreshPendingDistributors();
      }
    );

    return () => {
      unsubscribe();
      unsubscribeLocalUsers();
    };
  }, [branchId]);

  const filteredDistributors = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) return pendingDistributors;

    return pendingDistributors.filter((distributor) =>
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
  }, [pendingDistributors, search]);

  return (
    <ManagerShell
      active="requests"
      title="Requests"
      subtitle="Branch delivery exceptions and dispatch coordination"
      searchValue={search}
      onSearchChange={setSearch}
    >
      <OutsideRadiusApprovalQueue styles={styles} />
      <DispatchQueue styles={styles} placeholderColor={colors.placeholder} />
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>
            Pending Distributor applications ({pendingDistributors.length})
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableScroll}>
        <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeadRow]}>
          <Text style={[styles.th, styles.nameCol]}>NAME</Text>
          <Text style={[styles.th, styles.idCol]}>UNIQUE ID</Text>
          <Text style={[styles.th, styles.contactCol]}>CONTACT</Text>
          <Text style={[styles.th, styles.emailCol]}>EMAIL</Text>
          <Text style={[styles.th, styles.barangayCol]}>BARANGAY</Text>
          <Text style={[styles.th, styles.roleCol]}>ROLE</Text>
          <Text style={[styles.th, styles.actionsCol]}>ACTIONS</Text>
        </View>

        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        ) : filteredDistributors.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No pending distributors.</Text>
            {!!loadError && <Text style={styles.errorText}>Firestore: {loadError}</Text>}
          </View>
        ) : (
          filteredDistributors.map((distributor) => {
            const distributorId = distributor.uid || distributor.id;

            return (
              <View key={distributorId || distributor.email} style={styles.tableRow}>
                <Text style={[styles.tdName, styles.nameCol]} numberOfLines={1}>
                  {getFullName(distributor)}
                </Text>
                <Text style={[styles.td, styles.idCol]} numberOfLines={1}>
                  {getProfileUniqueId(distributor) || 'Pending'}
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
                <View style={[styles.roleCell, styles.roleCol]}>
                  <ManagerPill tone="cyan">Distributor</ManagerPill>
                </View>
                <View style={[styles.actionButtons, styles.actionsCol]}><Text style={styles.noActionText}>Managed by Admin</Text></View>
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

const createStyles = (colors) => StyleSheet.create({
  dispatchCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 20,
    marginBottom: 18,
  },
  dispatchOrder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 15,
    marginTop: 14,
  },
  dispatchActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 13,
  },
  transferButton: {
    minHeight: 39,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transferButtonText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  dispatchPicker: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    gap: 8,
  },
  dispatchPickerLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: '900' },
  dispatchPickerEmpty: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  dispatchOption: {
    minHeight: 44,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  dispatchOptionText: { color: colors.textPrimary, fontSize: 12, fontWeight: '900' },
  dispatchOptionHint: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  transferNoteInput: {
    minHeight: 58,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 8,
    backgroundColor: colors.input,
    color: colors.textPrimary,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    outlineStyle: 'none',
  },
  transferTarget: {
    minHeight: 54,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  transferTargetMain: { flex: 1, minWidth: 0 },
  coverageText: { fontSize: 10, fontWeight: '900', textAlign: 'right' },
  coverageInside: { color: colors.success },
  coverageOutside: { color: colors.warning },
  assignedDistributor: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  incomingHeading: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 18,
    paddingTop: 17,
  },
  incomingTransfer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 13,
    paddingTop: 13,
  },
  declinePanel: {
    marginTop: 10,
    gap: 8,
  },
  declineConfirmButton: {
    alignSelf: 'flex-start',
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineConfirmText: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  approvalCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 20,
    marginBottom: 18,
  },
  approvalHeader: {
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
    letterSpacing: .8,
  },
  approvalTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '900',
    marginTop: 3,
  },
  approvalHelper: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  refreshButton: {
    minHeight: 36,
    paddingHorizontal: 11,
    borderRadius: 9,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  approvalError: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    padding: 11,
    marginBottom: 12,
  },
  approvalErrorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  approvalEmpty: {
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalOrder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 15,
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
    fontSize: 14,
    fontWeight: '900',
  },
  approvalRequestId: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 3,
  },
  approvalProducts: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
  },
  approvalDetails: {
    gap: 4,
    marginTop: 8,
  },
  approvalDetail: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  approvalAmount: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },
  approvalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 13,
  },
  approveDeliveryButton: {
    minHeight: 39,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveDeliveryText: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  declineDeliveryButton: {
    minHeight: 39,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineDeliveryText: { color: colors.danger, fontSize: 12, fontWeight: '900' },
  messagePlaceholder: {
    minHeight: 39,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: colors.neutral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messagePlaceholderText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },
  tableScroll: { flexGrow: 1 },
  table: { minWidth: 980, flexGrow: 1 },
  cardHeader: {
    marginBottom: 18,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: 'bold',
  },
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
  nameCol: {
    flex: 1.35,
  },
  idCol: {
    flex: 1,
  },
  contactCol: {
    flex: 1,
  },
  emailCol: {
    flex: 1.65,
  },
  barangayCol: {
    flex: 1,
  },
  roleCol: {
    flex: 0.9,
  },
  actionsCol: {
    flex: 1.15,
    textAlign: 'right',
  },
  roleCell: {
    alignItems: 'flex-start',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  acceptButton: {
    borderRadius: 999,
    backgroundColor: '#E3F8EF',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  acceptButtonText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: 'bold',
  },
  rejectButton: {
    borderRadius: 999,
    backgroundColor: '#FFE9E9',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  rejectButtonText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: 'bold',
  },
  actionDisabled: {
    opacity: 0.6,
  },
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
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(6, 36, 71, 0.46)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '90%',
    maxWidth: 430,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 22,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalMessage: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 14,
  },
  reasonInput: {
    minHeight: 104,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  reasonInputError: {
    borderColor: colors.danger,
    backgroundColor: '#FFF7F7',
  },
  reasonErrorText: {
    color: colors.danger,
    fontSize: 12,
    marginTop: 7,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  modalCancelButton: {
    minWidth: 92,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  modalCancelText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: 'bold',
  },
  modalRejectButton: {
    minWidth: 122,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#FFE9E9',
  },
  modalRejectText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: 'bold',
  },
  noActionText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
});
