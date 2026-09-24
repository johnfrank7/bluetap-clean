import React, { useState, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AdminShell from '../../components/AdminShell';
import { useAdminTheme } from '../../components/AdminTheme';
import { TableSkeleton } from '../../components/AdminSkeleton';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { getBranches } from '../../services/branchManagement';
import { ADMIN_CACHE_KEYS, useAdminData } from '../../services/adminDataCache';
import { requesterOrderStatusLabel } from '../../constants/requesterOrderStatus';

const ACTIONABLE_STATUSES = new Set([
  'pending',
  'outside_radius_pending_approval',
  'branch_transfer_pending',
]);

const ACTIVE_STATUSES = new Set([
  'awaiting_distributor_assignment',
  'distributor_assigned',
  'assigned',
  'accepted',
  'scheduled',
  'out_for_delivery',
]);

const ISSUE_STATUSES = new Set([
  'delivery_failed',
  'cancelled',
  'canceled',
  'declined',
  'rejected',
  'declined outside service area',
]);

const formatAmount = (val) => {
  if (val === undefined || val === null || val === '') return '\u20B10.00';
  const num = Number(val);
  return isNaN(num) ? String(val) : `\u20B1${num.toFixed(2)}`;
};

const formatDate = (val) => {
  if (!val) return 'Date unavailable';
  if (val?.toDate) return val.toDate().toLocaleString();
  if (val?.toMillis) return new Date(val.toMillis()).toLocaleString();
  const d = new Date(val);
  return isNaN(d.getTime()) ? String(val) : d.toLocaleString();
};

export default function AdminRequestsPage() {
  const { colors } = useAdminTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const branchState = useAdminData(ADMIN_CACHE_KEYS.branches, getBranches);
  const branches = branchState.data || [];

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim().toLowerCase());
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    let isMounted = true;
    try {
      const q = collection(db, 'requests');
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          if (!isMounted) return;
          const loaded = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() || {};
            loaded.push({
              id: docSnap.id,
              ...data,
            });
          });

          loaded.sort((a, b) => {
            const timeA =
              a.createdAt?.toMillis?.() ||
              (a.createdAt ? new Date(a.createdAt).getTime() : 0) ||
              (a.orderDate ? new Date(a.orderDate).getTime() : 0);
            const timeB =
              b.createdAt?.toMillis?.() ||
              (b.createdAt ? new Date(b.createdAt).getTime() : 0) ||
              (b.orderDate ? new Date(b.orderDate).getTime() : 0);
            return timeB - timeA;
          });

          setRequests(loaded);
          setLoading(false);
          setLoadError('');
        },
        (err) => {
          if (!isMounted) return;
          setLoadError(err.message || 'Unable to subscribe to requests.');
          setLoading(false);
        }
      );

      return () => {
        isMounted = false;
        unsubscribe();
      };
    } catch (err) {
      setLoadError(err.message || 'Failed to initialize requests listener.');
      setLoading(false);
      return undefined;
    }
  }, []);

  const counts = useMemo(() => {
    let actionable = 0;
    let active = 0;
    let delivered = 0;
    let issues = 0;

    for (const r of requests) {
      const s = (r.status || '').toLowerCase();
      if (ACTIONABLE_STATUSES.has(s)) actionable++;
      else if (ACTIVE_STATUSES.has(s)) active++;
      else if (s === 'delivered') delivered++;
      else if (ISSUE_STATUSES.has(s)) issues++;
    }

    return {
      total: requests.length,
      actionable,
      active,
      delivered,
      issues,
    };
  }, [requests]);

  const filteredOrders = useMemo(() => {
    return requests.filter((r) => {
      const status = (r.status || '').toLowerCase();

      if (statusFilter === 'actionable' && !ACTIONABLE_STATUSES.has(status)) return false;
      if (statusFilter === 'active' && !ACTIVE_STATUSES.has(status)) return false;
      if (statusFilter === 'delivered' && status !== 'delivered') return false;
      if (statusFilter === 'issues' && !ISSUE_STATUSES.has(status)) return false;

      if (branchFilter !== 'all') {
        const orderBranchId = r.currentBranchId || r.branchId;
        if (orderBranchId !== branchFilter) return false;
      }

      if (debouncedQuery) {
        const customerName = (r.requesterNameSnapshot || r.requesterName || r.customerName || '').toLowerCase();
        const requestId = (r.requestId || r.id || '').toLowerCase();
        const phone = (r.deliveryPhoneSnapshot || r.contactNumber || '').toLowerCase();
        const address = (r.deliveryAddressSnapshot || r.address || r.deliveryAddress || '').toLowerCase();
        const branchName = (r.branchNameSnapshot || r.branchName || '').toLowerCase();
        const distributor = (r.distributorNameSnapshot || r.distributorName || '').toLowerCase();

        const match =
          customerName.includes(debouncedQuery) ||
          requestId.includes(debouncedQuery) ||
          phone.includes(debouncedQuery) ||
          address.includes(debouncedQuery) ||
          branchName.includes(debouncedQuery) ||
          distributor.includes(debouncedQuery);

        if (!match) return false;
      }

      return true;
    });
  }, [requests, statusFilter, branchFilter, debouncedQuery]);

  const getStatusTone = (status) => {
    const s = (status || '').toLowerCase();
    if (ACTIONABLE_STATUSES.has(s)) {
      return { bg: colors.warningSoft, text: colors.warning, border: colors.warning };
    }
    if (s === 'delivered') {
      return { bg: colors.successSoft, text: colors.success, border: colors.success };
    }
    if (ISSUE_STATUSES.has(s)) {
      return { bg: colors.dangerSoft, text: colors.danger, border: colors.danger };
    }
    return { bg: colors.primarySoft, text: colors.primary, border: colors.primary };
  };

  return (
    <AdminShell
      title="Request Oversight"
      subtitle="Platform-wide read-only view of customer orders and dispatch status across all branches."
    >
      {/* Metrics Summary Row */}
      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{counts.total}</Text>
          <Text style={styles.metricLabel}>Total Orders</Text>
        </View>
        <View style={[styles.metricCard, counts.actionable > 0 && { borderColor: colors.warning }]}>
          <Text style={[styles.metricValue, counts.actionable > 0 && { color: colors.warning }]}>
            {counts.actionable}
          </Text>
          <Text style={styles.metricLabel}>Pending Review</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={[styles.metricValue, { color: colors.primary }]}>{counts.active}</Text>
          <Text style={styles.metricLabel}>In Progress</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={[styles.metricValue, { color: colors.success }]}>{counts.delivered}</Text>
          <Text style={styles.metricLabel}>Delivered</Text>
        </View>
      </View>

      {/* Main Filter & List Container */}
      <View style={styles.card}>
        {/* Status Tabs */}
        <View style={styles.tabsRow}>
          {[
            { id: 'all', label: 'All Orders', count: counts.total },
            { id: 'actionable', label: 'Pending Review', count: counts.actionable },
            { id: 'active', label: 'In Progress', count: counts.active },
            { id: 'delivered', label: 'Delivered', count: counts.delivered },
            { id: 'issues', label: 'Issues & Cancelled', count: counts.issues },
          ].map((tab) => (
            <TouchableOpacity
              key={tab.id}
              accessibilityRole="button"
              accessibilityLabel={`${tab.label} (${tab.count})`}
              onPress={() => setStatusFilter(tab.id)}
              style={[styles.tab, statusFilter === tab.id && styles.tabActive]}
            >
              <Text style={[styles.tabText, statusFilter === tab.id && styles.tabTextActive]}>
                {tab.label} ({tab.count})
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Filters Row: Branch Picker + Search Bar */}
        <View style={styles.filtersRow}>
          <View style={styles.branchSelectWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.branchScroll}>
              <TouchableOpacity
                onPress={() => setBranchFilter('all')}
                style={[
                  styles.branchChip,
                  branchFilter === 'all' && { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
              >
                <Text
                  style={[
                    styles.branchChipText,
                    branchFilter === 'all' && { color: '#FFFFFF', fontWeight: '800' },
                  ]}
                >
                  All Branches
                </Text>
              </TouchableOpacity>
              {branches.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  onPress={() => setBranchFilter(b.id)}
                  style={[
                    styles.branchChip,
                    branchFilter === b.id && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.branchChipText,
                      branchFilter === b.id && { color: '#FFFFFF', fontWeight: '800' },
                    ]}
                  >
                    {b.name || b.code || b.id}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by order ID, customer name, phone, or address..."
            placeholderTextColor={colors.placeholder}
            style={styles.searchInput}
          />
        </View>

        {/* Status Count & Info */}
        <View style={styles.listHeaderRow}>
          <Text style={styles.resultsCount}>
            Showing {filteredOrders.length} order{filteredOrders.length === 1 ? '' : 's'}
          </Text>
          <Text style={styles.readOnlyNote}>Oversight mode: Read-Only</Text>
        </View>

        {/* Error Box */}
        {!!loadError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        )}

        {/* Loading Skeleton */}
        {loading && requests.length === 0 ? (
          <TableSkeleton rows={5} />
        ) : filteredOrders.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No customer orders match the selected filters.</Text>
          </View>
        ) : (
          /* Orders List */
          <View style={styles.ordersList}>
            {filteredOrders.map((order) => {
              const tone = getStatusTone(order.status);
              const itemsList = Array.isArray(order.items) && order.items.length > 0
                ? order.items.map((i) => `${i.quantity} \u00D7 ${i.productNameSnapshot || i.productName || 'Item'}`).join(', ')
                : order.productNameSnapshot || 'Water Order';
              const branchDisplay = order.branchNameSnapshot || order.branchName || order.currentBranchId || 'Unassigned';
              const requesterDisplay = order.requesterNameSnapshot || order.requesterName || order.customerName || 'Customer';
              const orderId = order.requestId || order.id;

              return (
                <View key={order.id} style={styles.orderCard}>
                  <View style={styles.orderHeaderRow}>
                    <View style={styles.orderIdGroup}>
                      <Text style={styles.orderIdText}>#{orderId}</Text>
                      <Text style={styles.orderDateText}>{formatDate(order.createdAt || order.orderDate)}</Text>
                    </View>

                    <View style={[styles.statusPill, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                      <Text style={[styles.statusPillText, { color: tone.text }]}>
                        {requesterOrderStatusLabel(order.status)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.orderBodyGrid}>
                    <View style={styles.gridColumn}>
                      <Text style={styles.fieldLabel}>Requester</Text>
                      <Text style={styles.fieldValuePrimary}>{requesterDisplay}</Text>
                      <Text style={styles.fieldValueSecondary}>
                        {order.deliveryPhoneSnapshot || order.contactNumber || 'No phone'}
                      </Text>
                    </View>

                    <View style={styles.gridColumn}>
                      <Text style={styles.fieldLabel}>Fulfillment Branch</Text>
                      <Text style={styles.fieldValuePrimary}>{branchDisplay}</Text>
                      {order.initialBranchId && order.initialBranchId !== order.currentBranchId && (
                        <Text style={styles.fieldValueSecondary}>Transferred order</Text>
                      )}
                    </View>

                    <View style={styles.gridColumn}>
                      <Text style={styles.fieldLabel}>Order Summary</Text>
                      <Text numberOfLines={2} style={styles.fieldValuePrimary}>{itemsList}</Text>
                      <Text style={styles.fieldPrice}>
                        {formatAmount(order.totalAtOrder || order.totalAmount)}
                      </Text>
                    </View>

                    <View style={styles.gridColumn}>
                      <Text style={styles.fieldLabel}>Dispatch & Schedule</Text>
                      <Text style={styles.fieldValuePrimary}>
                        {order.distributorNameSnapshot || order.distributorName || 'Not assigned'}
                      </Text>
                      <Text style={styles.fieldValueSecondary}>
                        {order.scheduledAt
                          ? `Scheduled: ${formatDate(order.scheduledAt)}`
                          : order.deliveryDate || 'No schedule set'}
                      </Text>
                    </View>
                  </View>

                  {/* Delivery Location Preview */}
                  <View style={styles.locationRow}>
                    <Text numberOfLines={1} style={styles.locationText}>
                      Delivery: {order.deliveryAddressSnapshot || order.address || order.deliveryAddress || 'Address on file'}
                    </Text>

                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`View details for order ${orderId}`}
                      onPress={() => setSelectedOrder(order)}
                      style={styles.detailsBtn}
                    >
                      <Text style={styles.detailsBtnText}>View Details</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Read-Only Order Details Modal */}
      <Modal
        visible={!!selectedOrder}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedOrder(null)}
      >
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  Order #{selectedOrder?.requestId || selectedOrder?.id}
                </Text>
                <Text style={styles.modalSub}>
                  Placed on {formatDate(selectedOrder?.createdAt || selectedOrder?.orderDate)}
                </Text>
              </View>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close details modal"
                onPress={() => setSelectedOrder(null)}
                style={styles.closeBtn}
              >
                <Text style={styles.closeBtnText}>\u00D7</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Status Banner */}
              {selectedOrder && (
                <View
                  style={[
                    styles.modalStatusBanner,
                    {
                      backgroundColor: getStatusTone(selectedOrder.status).bg,
                      borderColor: getStatusTone(selectedOrder.status).border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.modalStatusBannerText,
                      { color: getStatusTone(selectedOrder.status).text },
                    ]}
                  >
                    Current Status: {requesterOrderStatusLabel(selectedOrder.status)}
                  </Text>
                </View>
              )}

              {/* Requester & Delivery Info Section */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>Customer & Delivery</Text>
                <View style={styles.modalGrid}>
                  <View style={styles.modalGridItem}>
                    <Text style={styles.modalLabel}>Customer Name</Text>
                    <Text style={styles.modalValue}>
                      {selectedOrder?.requesterNameSnapshot || selectedOrder?.requesterName || selectedOrder?.customerName || 'Customer'}
                    </Text>
                  </View>
                  <View style={styles.modalGridItem}>
                    <Text style={styles.modalLabel}>Contact Phone</Text>
                    <Text style={styles.modalValue}>
                      {selectedOrder?.deliveryPhoneSnapshot || selectedOrder?.contactNumber || 'Not provided'}
                    </Text>
                  </View>
                  <View style={styles.modalGridItemFull}>
                    <Text style={styles.modalLabel}>Delivery Address</Text>
                    <Text style={styles.modalValue}>
                      {selectedOrder?.deliveryAddressSnapshot || selectedOrder?.address || selectedOrder?.deliveryAddress || 'Address on file'}
                    </Text>
                  </View>
                  {selectedOrder?.deliveryLocationSnapshot && (
                    <View style={styles.modalGridItemFull}>
                      <Text style={styles.modalLabel}>GPS Coordinates Snapshot</Text>
                      <Text style={styles.modalValueSecondary}>
                        Lat: {selectedOrder.deliveryLocationSnapshot.latitude}, Lng: {selectedOrder.deliveryLocationSnapshot.longitude}
                        {selectedOrder.deliveryLocationSnapshot.accuracy
                          ? ` (\u00B1${Number(selectedOrder.deliveryLocationSnapshot.accuracy).toFixed(0)}m accuracy)`
                          : ''}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Branch & Distributor Section */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>Branch & Logistics</Text>
                <View style={styles.modalGrid}>
                  <View style={styles.modalGridItem}>
                    <Text style={styles.modalLabel}>Fulfillment Branch</Text>
                    <Text style={styles.modalValue}>
                      {selectedOrder?.branchNameSnapshot || selectedOrder?.branchName || selectedOrder?.currentBranchId || 'Unassigned'}
                    </Text>
                  </View>
                  <View style={styles.modalGridItem}>
                    <Text style={styles.modalLabel}>Initial Requested Branch</Text>
                    <Text style={styles.modalValue}>
                      {selectedOrder?.initialBranchNameSnapshot || selectedOrder?.initialBranchId || 'Same as fulfillment'}
                    </Text>
                  </View>
                  <View style={styles.modalGridItem}>
                    <Text style={styles.modalLabel}>Assigned Distributor</Text>
                    <Text style={styles.modalValue}>
                      {selectedOrder?.distributorNameSnapshot || selectedOrder?.distributorName || 'Not assigned'}
                    </Text>
                  </View>
                  <View style={styles.modalGridItem}>
                    <Text style={styles.modalLabel}>Scheduled Delivery</Text>
                    <Text style={styles.modalValue}>
                      {selectedOrder?.scheduledAt
                        ? formatDate(selectedOrder.scheduledAt)
                        : selectedOrder?.deliveryDate || 'Pending schedule'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Ordered Items Table */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>Ordered Items & Charges</Text>
                {Array.isArray(selectedOrder?.items) && selectedOrder.items.length > 0 ? (
                  selectedOrder.items.map((item, idx) => (
                    <View key={idx} style={styles.itemRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemName}>
                          {item.productNameSnapshot || item.productName || 'Product'}
                        </Text>
                        <Text style={styles.itemSub}>
                          {formatAmount(item.unitPrice)} \u00D7 {item.quantity}
                        </Text>
                      </View>
                      <Text style={styles.itemTotal}>
                        {formatAmount(item.subtotal || (item.unitPrice * item.quantity))}
                      </Text>
                    </View>
                  ))
                ) : (
                  <View style={styles.itemRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName}>
                        {selectedOrder?.productNameSnapshot || selectedOrder?.product || 'Standard Product'}
                      </Text>
                      <Text style={styles.itemSub}>Qty: {selectedOrder?.quantity || 1}</Text>
                    </View>
                    <Text style={styles.itemTotal}>
                      {formatAmount(selectedOrder?.totalAtOrder || selectedOrder?.totalAmount)}
                    </Text>
                  </View>
                )}

                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Total Authoritative Amount</Text>
                  <Text style={styles.totalValue}>
                    {formatAmount(selectedOrder?.totalAtOrder || selectedOrder?.totalAmount)}
                  </Text>
                </View>
              </View>

              {/* Container & Notes */}
              {(selectedOrder?.containerType || selectedOrder?.notes) && (
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Instructions & Packaging</Text>
                  {selectedOrder?.containerType && (
                    <View style={{ marginBottom: 6 }}>
                      <Text style={styles.modalLabel}>Container / Packaging</Text>
                      <Text style={styles.modalValue}>{selectedOrder.containerType}</Text>
                    </View>
                  )}
                  {selectedOrder?.notes && (
                    <View>
                      <Text style={styles.modalLabel}>Special Notes</Text>
                      <Text style={styles.modalValueSecondary}>{selectedOrder.notes}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Failure Reason Banner if failed */}
              {selectedOrder?.status === 'delivery_failed' && selectedOrder?.failureReason && (
                <View style={styles.failureBanner}>
                  <Text style={styles.failureTitle}>Delivery Failure Reason</Text>
                  <Text style={styles.failureReason}>{selectedOrder.failureReason}</Text>
                </View>
              )}

              {/* Audit / Edit History Section */}
              {Array.isArray(selectedOrder?.editHistory) && selectedOrder.editHistory.length > 0 && (
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>
                    Situational Edit History ({selectedOrder.editHistory.length})
                  </Text>
                  {selectedOrder.editHistory.map((edit, idx) => (
                    <View key={idx} style={styles.editHistoryItem}>
                      <Text style={styles.editHistoryMeta}>
                        {formatDate(edit.timestamp)} \u00B7 Edited by Manager ({edit.editedBy || 'Manager'})
                      </Text>
                      {edit.previousTotal !== undefined && edit.newTotal !== undefined && (
                        <Text style={styles.editHistoryDetail}>
                          Total adjusted: {formatAmount(edit.previousTotal)} \u2192 {formatAmount(edit.newTotal)}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* Read-Only Notice Box */}
              <View style={styles.noticeBox}>
                <Text style={styles.noticeText}>
                  Administrator Oversight (Read-Only) — Operational dispatch, assignment, and situational edits are strictly scoped to Branch Managers.
                </Text>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close modal"
                onPress={() => setSelectedOrder(null)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </AdminShell>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    metricsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginBottom: 20,
    },
    metricCard: {
      flex: 1,
      minWidth: 160,
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    metricValue: {
      fontSize: 26,
      fontWeight: '900',
      color: colors.textPrimary,
    },
    metricLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      marginTop: 4,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 20,
    },
    tabsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 16,
    },
    tab: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.surfaceAlt,
    },
    tabActive: {
      backgroundColor: colors.primary,
    },
    tabText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    tabTextActive: {
      color: '#FFFFFF',
    },
    filtersRow: {
      gap: 12,
      marginBottom: 16,
    },
    branchSelectWrap: {
      minHeight: 36,
    },
    branchScroll: {
      flexDirection: 'row',
    },
    branchChip: {
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      backgroundColor: colors.surfaceAlt,
      marginRight: 8,
    },
    branchChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    searchInput: {
      borderWidth: 1,
      borderColor: colors.inputBorder,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: colors.textPrimary,
      backgroundColor: colors.input,
      fontSize: 13,
      outlineStyle: 'none',
    },
    listHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    resultsCount: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    readOnlyNote: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.primary,
    },
    errorBox: {
      backgroundColor: colors.dangerSoft,
      borderColor: colors.danger,
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
      marginBottom: 14,
    },
    errorText: {
      color: colors.danger,
      fontWeight: '700',
      fontSize: 13,
    },
    emptyContainer: {
      padding: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 14,
      textAlign: 'center',
    },
    ordersList: {
      gap: 12,
    },
    orderCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
      padding: 16,
    },
    orderHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 12,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    orderIdGroup: {
      gap: 2,
    },
    orderIdText: {
      fontSize: 16,
      fontWeight: '900',
      color: colors.textPrimary,
    },
    orderDateText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    statusPill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 8,
      borderWidth: 1,
    },
    statusPillText: {
      fontSize: 12,
      fontWeight: '800',
    },
    orderBodyGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 16,
      marginBottom: 12,
    },
    gridColumn: {
      flex: 1,
      minWidth: 140,
      gap: 2,
    },
    fieldLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    fieldValuePrimary: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    fieldValueSecondary: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    fieldPrice: {
      fontSize: 14,
      fontWeight: '900',
      color: colors.primary,
      marginTop: 2,
    },
    locationRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 10,
      gap: 12,
    },
    locationText: {
      flex: 1,
      fontSize: 12,
      color: colors.textSecondary,
    },
    detailsBtn: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    detailsBtnText: {
      color: colors.primary,
      fontWeight: '800',
      fontSize: 12,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 18,
    },
    modalCard: {
      width: '100%',
      maxWidth: 580,
      maxHeight: '90%',
      borderRadius: 18,
      borderWidth: 1,
      padding: 22,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 14,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    modalTitle: {
      fontSize: 19,
      fontWeight: '900',
      color: colors.textPrimary,
    },
    modalSub: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    closeBtn: {
      padding: 4,
      borderRadius: 6,
    },
    closeBtnText: {
      fontSize: 22,
      lineHeight: 22,
      color: colors.textSecondary,
      fontWeight: '700',
    },
    modalBody: {
      maxHeight: 460,
    },
    modalStatusBanner: {
      padding: 10,
      borderRadius: 8,
      borderWidth: 1,
      marginBottom: 14,
      alignItems: 'center',
    },
    modalStatusBannerText: {
      fontSize: 13,
      fontWeight: '800',
    },
    modalSection: {
      marginBottom: 18,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    modalSectionTitle: {
      fontSize: 14,
      fontWeight: '900',
      color: colors.textPrimary,
      marginBottom: 10,
    },
    modalGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    modalGridItem: {
      flex: 1,
      minWidth: 180,
    },
    modalGridItemFull: {
      width: '100%',
    },
    modalLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    modalValue: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
      marginTop: 2,
    },
    modalValueSecondary: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    itemRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    itemName: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    itemSub: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    itemTotal: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    totalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 10,
      marginTop: 6,
    },
    totalLabel: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    totalValue: {
      fontSize: 16,
      fontWeight: '900',
      color: colors.primary,
    },
    failureBanner: {
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: 10,
      padding: 12,
      marginBottom: 14,
    },
    failureTitle: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.danger,
    },
    failureReason: {
      fontSize: 13,
      color: colors.danger,
      marginTop: 4,
      fontWeight: '600',
    },
    editHistoryItem: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 8,
      padding: 8,
      marginBottom: 6,
    },
    editHistoryMeta: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    editHistoryDetail: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textPrimary,
      marginTop: 2,
    },
    noticeBox: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      marginTop: 6,
    },
    noticeText: {
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
      fontStyle: 'italic',
      textAlign: 'center',
    },
    modalFooter: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 14,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    modalCloseButton: {
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 8,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    modalCloseButtonText: {
      fontWeight: '800',
      color: colors.textPrimary,
      fontSize: 13,
    },
  });

