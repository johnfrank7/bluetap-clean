import React, { useState, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AdminShell from '../../components/AdminShell';
import { useAdminTheme } from '../../components/AdminTheme';
import { CardSkeleton, TableSkeleton } from '../../components/AdminSkeleton';
import PortalButton from '../../components/PortalButton';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { getBranches } from '../../services/branchManagement';
import { ADMIN_CACHE_KEYS, useAdminData } from '../../services/adminDataCache';
import { BLUETAP_LAYOUT } from '../../constants/bluetapTheme';

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

const DATE_FILTERS = [
  { id: 'all', label: 'All Time' },
  { id: '7d', label: 'Last 7 Days' },
  { id: '30d', label: 'Last 30 Days' },
  { id: 'month', label: 'This Month' },
];

const formatCurrency = (val) => {
  if (val === undefined || val === null || val === '') return '₱0.00';
  const num = Number(val);
  return isNaN(num) || !Number.isFinite(num) ? 'Unavailable' : `₱${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatNumber = (val) => {
  const num = Number(val);
  return isNaN(num) || !Number.isFinite(num) ? '0' : num.toLocaleString('en-US');
};

const getOrderTimestamp = (order) => {
  if (order.createdAt?.toMillis) return order.createdAt.toMillis();
  if (order.createdAt?.seconds) return order.createdAt.seconds * 1000;
  if (order.createdAt) {
    const t = new Date(order.createdAt).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (order.orderDate) {
    const t = new Date(order.orderDate).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (order.deliveredAt?.toMillis) return order.deliveredAt.toMillis();
  if (order.deliveredAt?.seconds) return order.deliveredAt.seconds * 1000;
  if (order.deliveredAt) {
    const t = new Date(order.deliveredAt).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  return 0;
};

const filterByDateRange = (timeMs, range) => {
  if (range === 'all') return true;
  if (!timeMs) return false;
  const now = Date.now();
  if (range === '7d') {
    return timeMs >= now - 7 * 24 * 60 * 60 * 1000;
  }
  if (range === '30d') {
    return timeMs >= now - 30 * 24 * 60 * 60 * 1000;
  }
  if (range === 'month') {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return timeMs >= d.getTime();
  }
  return true;
};

const extractDeliveredOrderStats = (order) => {
  let unitsSold = 0;
  let revenue = 0;
  const productItems = [];

  if (Array.isArray(order.items) && order.items.length > 0) {
    order.items.forEach((item) => {
      const qty = Number(item.quantity || 0);
      const subtotal = Number(
        item.line_total ??
        item.subtotal ??
        item.totalAtOrder ??
        (Number(item.unitPriceAtOrder ?? item.unitPrice ?? item.product_price ?? item.price ?? 0) * qty)
      );
      const safeQty = Number.isFinite(qty) ? qty : 0;
      const safeSubtotal = Number.isFinite(subtotal) ? subtotal : 0;
      const name = item.productNameSnapshot || item.productName || item.name || 'Standard Product';

      unitsSold += safeQty;
      revenue += safeSubtotal;
      productItems.push({ name, quantity: safeQty, subtotal: safeSubtotal });
    });
  } else {
    const qty = Number(order.quantity || 0);
    const total = Number(order.totalAtOrder ?? order.total_amount ?? order.totalAmount ?? order.total_cost ?? 0);
    const safeQty = Number.isFinite(qty) ? qty : (total > 0 ? 1 : 0);
    const safeTotal = Number.isFinite(total) ? total : 0;
    const name = order.productNameSnapshot || order.product || 'Standard Product';

    unitsSold += safeQty;
    revenue += safeTotal;
    productItems.push({ name, quantity: safeQty, subtotal: safeTotal });
  }

  return { unitsSold, revenue, productItems };
};

export default function AdminAnalyticsPage() {
  const { colors } = useAdminTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [requestsError, setRequestsError] = useState('');

  const [stationFilter, setStationFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');

  const { data: branchesData, loading: loadingBranches } = useAdminData(
    ADMIN_CACHE_KEYS.branches,
    getBranches
  );
  const branches = branchesData || [];

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
            loaded.push({ id: docSnap.id, ...docSnap.data() });
          });
          setRequests(loaded);
          setLoadingRequests(false);
          setRequestsError('');
        },
        (err) => {
          if (!isMounted) return;
          setRequestsError(err.message || 'Unable to subscribe to requests collection.');
          setLoadingRequests(false);
        }
      );
      return () => {
        isMounted = false;
        unsubscribe();
      };
    } catch (err) {
      setRequestsError(err.message || 'Failed to initialize requests listener.');
      setLoadingRequests(false);
      return undefined;
    }
  }, []);

  const branchMap = useMemo(() => {
    const map = new Map();
    branches.forEach((b) => {
      map.set(b.id, b);
      if (b.code) map.set(b.code, b);
    });
    return map;
  }, [branches]);

  const filteredRequests = useMemo(() => {
    return requests.filter((order) => {
      if (stationFilter !== 'all') {
        const orderBranchId = order.currentBranchId || order.branchId || order.branch_id || order.branch;
        if (orderBranchId !== stationFilter) return false;
      }

      const orderTime = getOrderTimestamp(order);
      if (!filterByDateRange(orderTime, dateFilter)) {
        return false;
      }

      return true;
    });
  }, [requests, stationFilter, dateFilter]);

  const metrics = useMemo(() => {
    let totalRevenue = 0;
    let unitsSold = 0;
    let deliveredCount = 0;
    let ongoingCount = 0;
    let issuesCount = 0;

    filteredRequests.forEach((order) => {
      const status = String(order.status || '').toLowerCase().replace(/[\s-]+/g, '_');

      if (status === 'delivered') {
        deliveredCount++;
        const stats = extractDeliveredOrderStats(order);
        totalRevenue += stats.revenue;
        unitsSold += stats.unitsSold;
      } else if (ACTIVE_STATUSES.has(status)) {
        ongoingCount++;
      } else if (ISSUE_STATUSES.has(status)) {
        issuesCount++;
      }
    });

    const totalOrders = filteredRequests.length;
    const fulfillmentRate = totalOrders > 0 ? (deliveredCount / totalOrders) * 100 : 0;

    return {
      totalRevenue,
      unitsSold,
      totalOrders,
      deliveredCount,
      ongoingCount,
      issuesCount,
      fulfillmentRate,
    };
  }, [filteredRequests]);

  const productBreakdown = useMemo(() => {
    const map = new Map();

    filteredRequests.forEach((order) => {
      const status = String(order.status || '').toLowerCase().replace(/[\s-]+/g, '_');
      if (status !== 'delivered') return;

      const { productItems } = extractDeliveredOrderStats(order);
      productItems.forEach((item) => {
        const key = item.name.trim();
        const existing = map.get(key) || { name: key, unitsSold: 0, revenue: 0 };
        existing.unitsSold += item.quantity;
        existing.revenue += item.subtotal;
        map.set(key, existing);
      });
    });

    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filteredRequests]);

  const stationBreakdown = useMemo(() => {
    const stationStats = new Map();

    branches.forEach((b) => {
      stationStats.set(b.id, {
        id: b.id,
        name: b.name || 'Unnamed Branch',
        code: b.code || '',
        status: b.status || 'active',
        totalOrders: 0,
        deliveredOrders: 0,
        revenue: 0,
        unitsSold: 0,
      });
    });

    const unassignedId = '__unassigned__';
    stationStats.set(unassignedId, {
      id: unassignedId,
      name: 'Unassigned / Direct',
      code: 'DIRECT',
      status: 'active',
      totalOrders: 0,
      deliveredOrders: 0,
      revenue: 0,
      unitsSold: 0,
    });

    requests.forEach((order) => {
      const orderTime = getOrderTimestamp(order);
      if (!filterByDateRange(orderTime, dateFilter)) return;

      const branchId = order.currentBranchId || order.branchId || order.branch_id || order.branch;
      const target = stationStats.get(branchId) || stationStats.get(unassignedId);

      target.totalOrders++;

      const status = String(order.status || '').toLowerCase().replace(/[\s-]+/g, '_');
      if (status === 'delivered') {
        target.deliveredOrders++;
        const stats = extractDeliveredOrderStats(order);
        target.revenue += stats.revenue;
        target.unitsSold += stats.unitsSold;
      }
    });

    return Array.from(stationStats.values()).filter(
      (s) => s.id !== unassignedId || s.totalOrders > 0
    );
  }, [branches, requests, dateFilter]);

  const selectedBranchName = useMemo(() => {
    if (stationFilter === 'all') return 'All Stations';
    const found = branchMap.get(stationFilter);
    return found?.name || 'Selected Station';
  }, [stationFilter, branchMap]);

  const selectedDateLabel = useMemo(() => {
    const found = DATE_FILTERS.find((f) => f.id === dateFilter);
    return found?.label || 'All Time';
  }, [dateFilter]);

  const resetFilters = () => {
    setStationFilter('all');
    setDateFilter('all');
  };

  const isLoading = loadingRequests || loadingBranches;

  return (
    <AdminShell
      title="Analytics & Reporting"
      subtitle="Platform-wide order volume, revenue snapshots, and branch operations."
    >
      {/* Hero Banner */}
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>BLUETAP REPORTING ENGINE</Text>
          <Text style={styles.heroTitle}>Platform Operational Performance</Text>
          <Text style={styles.heroBody}>
            Revenue metrics are authoritatively aggregated from delivered order price snapshots.
            Live inventory prices are never substituted into historical sales records.
          </Text>
        </View>
        <View style={styles.heroScopeChip}>
          <Text style={styles.heroScopeLabel}>ACTIVE SCOPE</Text>
          <Text numberOfLines={1} style={styles.heroScopeValue}>{selectedBranchName}</Text>
          <Text style={styles.heroScopeDate}>{selectedDateLabel}</Text>
        </View>
      </View>

      {/* Filter Toolbar */}
      <View style={styles.filterSection}>
        <View style={styles.filterRowHeader}>
          <Text style={styles.filterSectionTitle}>Filter by Station & Timeframe</Text>
          {(stationFilter !== 'all' || dateFilter !== 'all') && (
            <PortalButton
              variant="ghost"
              size="sm"
              onPress={resetFilters}
              accessibilityLabel="Reset all filters"
              style={styles.resetButton}
              textStyle={styles.resetButtonText}
            >
              Reset Filters ↺
            </PortalButton>
          )}
        </View>

        {/* Date Filter Pills */}
        <View style={styles.filterGroup}>
          <Text style={styles.filterGroupLabel}>TIMEFRAME:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsScroll}>
            {DATE_FILTERS.map((f) => {
              const isActive = dateFilter === f.id;
              return (
                <PortalButton
                  key={f.id}
                  variant="pill"
                  size="pill"
                  active={isActive}
                  accessibilityLabel={`Filter by ${f.label}`}
                  accessibilityState={{ selected: isActive }}
                  onPress={() => setDateFilter(f.id)}
                  style={styles.pillSpacing}
                >
                  {f.label}
                </PortalButton>
              );
            })}
          </ScrollView>
        </View>

        {/* Station Filter Pills */}
        <View style={[styles.filterGroup, { marginTop: 10 }]}>
          <Text style={styles.filterGroupLabel}>STATION:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsScroll}>
            <PortalButton
              variant="pill"
              size="pill"
              active={stationFilter === 'all'}
              accessibilityLabel="Filter by all stations"
              accessibilityState={{ selected: stationFilter === 'all' }}
              onPress={() => setStationFilter('all')}
              style={styles.pillSpacing}
            >
              {`All Stations (${branches.length})`}
            </PortalButton>
            {branches.map((b) => {
              const isActive = stationFilter === b.id;
              return (
                <PortalButton
                  key={b.id}
                  variant="pill"
                  size="pill"
                  active={isActive}
                  accessibilityLabel={`Filter by station ${b.name}`}
                  accessibilityState={{ selected: isActive }}
                  onPress={() => setStationFilter(b.id)}
                  style={styles.pillSpacing}
                >
                  {b.name}
                </PortalButton>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {/* Error Notice */}
      {!!requestsError && (
        <View accessibilityRole="alert" style={styles.errorNotice}>
          <Text style={styles.errorNoticeText}>Notice: {requestsError}</Text>
        </View>
      )}

      {/* KPI Stat Cards */}
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Summary Metrics</Text>
        <Text style={styles.sectionMeta}>
          {filteredRequests.length} orders analyzed · {metrics.deliveredCount} delivered
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.statGrid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} style={styles.statSkeleton} />
          ))}
        </View>
      ) : (
        <View style={styles.statGrid}>
          <View style={[styles.statCard, { borderTopColor: colors.success }]}>
            <View style={[styles.statIconWrap, { backgroundColor: colors.successSoft }]}>
              <Text style={[styles.statIconGlyph, { color: colors.success }]}>₱</Text>
            </View>
            <Text style={styles.statLabel}>SNAPSHOT REVENUE</Text>
            <Text style={[styles.statValue, { color: colors.success }]}>
              {formatCurrency(metrics.totalRevenue)}
            </Text>
            <Text style={styles.statDetail}>
              From {formatNumber(metrics.deliveredCount)} delivered orders
            </Text>
          </View>

          <View style={[styles.statCard, { borderTopColor: colors.primary }]}>
            <View style={[styles.statIconWrap, { backgroundColor: colors.primarySoft }]}>
              <Text style={[styles.statIconGlyph, { color: colors.primary }]}>◇</Text>
            </View>
            <Text style={styles.statLabel}>UNITS SOLD</Text>
            <Text style={[styles.statValue, { color: colors.textPrimary }]}>
              {formatNumber(metrics.unitsSold)}
            </Text>
            <Text style={styles.statDetail}>
              Delivered water containers / items
            </Text>
          </View>

          <View style={[styles.statCard, { borderTopColor: colors.textSecondary }]}>
            <View style={[styles.statIconWrap, { backgroundColor: colors.neutral }]}>
              <Text style={[styles.statIconGlyph, { color: colors.textPrimary }]}>▤</Text>
            </View>
            <Text style={styles.statLabel}>TOTAL ORDERS</Text>
            <Text style={[styles.statValue, { color: colors.textPrimary }]}>
              {formatNumber(metrics.totalOrders)}
            </Text>
            <Text style={styles.statDetail}>
              Fulfillment rate: {metrics.fulfillmentRate.toFixed(1)}%
            </Text>
          </View>

          <View style={[styles.statCard, { borderTopColor: colors.success }]}>
            <View style={[styles.statIconWrap, { backgroundColor: colors.successSoft }]}>
              <Text style={[styles.statIconGlyph, { color: colors.success }]}>✓</Text>
            </View>
            <Text style={styles.statLabel}>DELIVERED</Text>
            <Text style={[styles.statValue, { color: colors.textPrimary }]}>
              {formatNumber(metrics.deliveredCount)}
            </Text>
            <Text style={styles.statDetail}>
              Successfully completed orders
            </Text>
          </View>

          <View style={[styles.statCard, { borderTopColor: colors.warning }]}>
            <View style={[styles.statIconWrap, { backgroundColor: colors.warningSoft }]}>
              <Text style={[styles.statIconGlyph, { color: colors.warning }]}>◉</Text>
            </View>
            <Text style={styles.statLabel}>ONGOING DELIVERIES</Text>
            <Text style={[styles.statValue, { color: colors.textPrimary }]}>
              {formatNumber(metrics.ongoingCount)}
            </Text>
            <Text style={styles.statDetail}>
              Assigned, scheduled, or in transit
            </Text>
          </View>

          <View style={[styles.statCard, { borderTopColor: colors.danger }]}>
            <View style={[styles.statIconWrap, { backgroundColor: colors.dangerSoft }]}>
              <Text style={[styles.statIconGlyph, { color: colors.danger }]}>×</Text>
            </View>
            <Text style={styles.statLabel}>ISSUES & CANCELLED</Text>
            <Text style={[styles.statValue, { color: colors.textPrimary }]}>
              {formatNumber(metrics.issuesCount)}
            </Text>
            <Text style={styles.statDetail}>
              Cancelled, failed, or declined
            </Text>
          </View>
        </View>
      )}

      {/* Product Performance Table */}
      <View style={styles.tableCard}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardTitle}>Product Sales Breakdown</Text>
            <Text style={styles.cardSubtitle}>
              Authoritative volume and snapshot revenue per product from delivered orders.
            </Text>
          </View>
          <View style={styles.badgePill}>
            <Text style={styles.badgePillText}>
              {productBreakdown.length} {productBreakdown.length === 1 ? 'Product' : 'Products'}
            </Text>
          </View>
        </View>

        {isLoading ? (
          <TableSkeleton rows={4} />
        ) : productBreakdown.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No delivered products in this period</Text>
            <Text style={styles.emptySubtitle}>
              Products will appear here once orders reach delivered status.
            </Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
            <View style={styles.tableWrapper}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.th, { flex: 2, minWidth: 180 }]}>Product Name</Text>
                <Text style={[styles.th, { flex: 1, minWidth: 100, textAlign: 'right' }]}>Units Sold</Text>
                <Text style={[styles.th, { flex: 1, minWidth: 130, textAlign: 'right' }]}>Snapshot Revenue</Text>
                <Text style={[styles.th, { flex: 1, minWidth: 120, textAlign: 'right' }]}>Avg / Unit</Text>
              </View>

              {productBreakdown.map((prod, idx) => {
                const avg = prod.unitsSold > 0 ? prod.revenue / prod.unitsSold : 0;
                return (
                  <View key={idx} style={[styles.tableDataRow, idx % 2 === 1 && styles.tableDataRowAlt]}>
                    <View style={[styles.tdWrap, { flex: 2, minWidth: 180 }]}>
                      <Text numberOfLines={1} style={styles.productNameText}>{prod.name}</Text>
                    </View>
                    <View style={[styles.tdWrap, { flex: 1, minWidth: 100, alignItems: 'flex-end' }]}>
                      <Text style={styles.unitsSoldText}>{formatNumber(prod.unitsSold)}</Text>
                    </View>
                    <View style={[styles.tdWrap, { flex: 1, minWidth: 130, alignItems: 'flex-end' }]}>
                      <Text style={styles.revenueText}>{formatCurrency(prod.revenue)}</Text>
                    </View>
                    <View style={[styles.tdWrap, { flex: 1, minWidth: 120, alignItems: 'flex-end' }]}>
                      <Text style={styles.avgText}>{formatCurrency(avg)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
      </View>

      {/* Station Operations Breakdown */}
      <View style={styles.tableCard}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardTitle}>Branch Operations & Coverage</Text>
            <Text style={styles.cardSubtitle}>
              Comparative fulfillment metrics and snapshot revenue across BlueTap stations.
            </Text>
          </View>
          <View style={styles.badgePill}>
            <Text style={styles.badgePillText}>
              {stationBreakdown.length} Stations
            </Text>
          </View>
        </View>

        {isLoading ? (
          <TableSkeleton rows={4} />
        ) : stationBreakdown.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No station records found</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
            <View style={styles.tableWrapper}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.th, { flex: 2, minWidth: 170 }]}>Branch / Station</Text>
                <Text style={[styles.th, { flex: 1, minWidth: 80 }]}>Code</Text>
                <Text style={[styles.th, { flex: 1, minWidth: 90 }]}>Status</Text>
                <Text style={[styles.th, { flex: 1, minWidth: 90, textAlign: 'right' }]}>Total Orders</Text>
                <Text style={[styles.th, { flex: 1, minWidth: 90, textAlign: 'right' }]}>Delivered</Text>
                <Text style={[styles.th, { flex: 1, minWidth: 100, textAlign: 'right' }]}>Fulfillment %</Text>
                <Text style={[styles.th, { flex: 1.2, minWidth: 130, textAlign: 'right' }]}>Snapshot Revenue</Text>
              </View>

              {stationBreakdown.map((station, idx) => {
                const rate = station.totalOrders > 0 ? (station.deliveredOrders / station.totalOrders) * 100 : 0;
                const isSelected = stationFilter === station.id;
                return (
                  <TouchableOpacity
                    key={station.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter by branch ${station.name}`}
                    onPress={() => setStationFilter(isSelected ? 'all' : station.id)}
                    style={[
                      styles.tableDataRow,
                      idx % 2 === 1 && styles.tableDataRowAlt,
                      isSelected && styles.tableDataRowSelected,
                    ]}
                  >
                    <View style={[styles.tdWrap, { flex: 2, minWidth: 170 }]}>
                      <Text numberOfLines={1} style={styles.stationNameText}>
                        {station.name} {isSelected && '✓'}
                      </Text>
                    </View>
                    <View style={[styles.tdWrap, { flex: 1, minWidth: 80 }]}>
                      <Text style={styles.stationCodeText}>{station.code || '—'}</Text>
                    </View>
                    <View style={[styles.tdWrap, { flex: 1, minWidth: 90 }]}>
                      <View style={[
                        styles.statusBadge,
                        { backgroundColor: station.status === 'active' ? colors.successSoft : colors.neutral }
                      ]}>
                        <Text style={[
                          styles.statusBadgeText,
                          { color: station.status === 'active' ? colors.success : colors.textSecondary }
                        ]}>
                          {station.status}
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.tdWrap, { flex: 1, minWidth: 90, alignItems: 'flex-end' }]}>
                      <Text style={styles.unitsSoldText}>{formatNumber(station.totalOrders)}</Text>
                    </View>
                    <View style={[styles.tdWrap, { flex: 1, minWidth: 90, alignItems: 'flex-end' }]}>
                      <Text style={styles.unitsSoldText}>{formatNumber(station.deliveredOrders)}</Text>
                    </View>
                    <View style={[styles.tdWrap, { flex: 1, minWidth: 100, alignItems: 'flex-end' }]}>
                      <Text style={[styles.rateText, { color: rate >= 70 ? colors.success : colors.textPrimary }]}>
                        {rate.toFixed(1)}%
                      </Text>
                    </View>
                    <View style={[styles.tdWrap, { flex: 1.2, minWidth: 130, alignItems: 'flex-end' }]}>
                      <Text style={styles.revenueText}>{formatCurrency(station.revenue)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )}
      </View>
    </AdminShell>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    hero: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 20,
      backgroundColor: colors.primary,
      borderRadius: 20,
      padding: 24,
      marginBottom: 20,
      ...BLUETAP_LAYOUT.shadow,
    },
    heroCopy: {
      flex: 1,
      minWidth: 240,
    },
    eyebrow: {
      color: '#CBEAFF',
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1,
    },
    heroTitle: {
      color: '#FFFFFF',
      fontSize: 24,
      fontWeight: '900',
      marginTop: 6,
    },
    heroBody: {
      color: '#E3F2FD',
      fontSize: 13,
      lineHeight: 19,
      marginTop: 7,
      maxWidth: 620,
    },
    heroScopeChip: {
      minWidth: 170,
      backgroundColor: 'rgba(255,255,255,0.16)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.24)',
      borderRadius: 14,
      padding: 14,
    },
    heroScopeLabel: {
      color: '#CBEAFF',
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.8,
    },
    heroScopeValue: {
      color: '#FFFFFF',
      fontWeight: '900',
      fontSize: 15,
      marginTop: 4,
    },
    heroScopeDate: {
      color: '#E0F2FE',
      fontSize: 12,
      fontWeight: '700',
      marginTop: 2,
    },

    filterSection: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 16,
      marginBottom: 20,
      ...BLUETAP_LAYOUT.shadow,
    },
    filterRowHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    filterSectionTitle: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '900',
    },
    resetButton: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 8,
      backgroundColor: colors.primarySoft,
    },
    resetButtonText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '800',
    },
    filterGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    },
    filterGroupLabel: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 0.6,
      minWidth: 80,
    },
    pillsScroll: {
      flexDirection: 'row',
      gap: 8,
      paddingVertical: 2,
    },
    pill: {
      minHeight: 34,
      paddingHorizontal: 13,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      backgroundColor: colors.surfaceAlt,
      justifyContent: 'center',
      alignItems: 'center',
    },
    pillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    pillText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    pillTextActive: {
      color: '#FFFFFF',
    },
    pillSpacing: {
      borderRadius: 999,
      marginRight: 2,
    },

    errorNotice: {
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: 12,
      padding: 12,
      marginBottom: 16,
    },
    errorNoticeText: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: '700',
    },

    sectionHeading: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
      flexWrap: 'wrap',
      gap: 8,
    },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: 17,
      fontWeight: '900',
    },
    sectionMeta: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },

    statGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 14,
      marginBottom: 24,
    },
    statSkeleton: {
      minHeight: 140,
      flexBasis: 180,
      flexGrow: 1,
    },
    statCard: {
      flexGrow: 1,
      flexBasis: 180,
      minHeight: 140,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderTopWidth: 4,
      borderRadius: 14,
      padding: 16,
      ...BLUETAP_LAYOUT.shadow,
    },
    statIconWrap: {
      width: 28,
      height: 28,
      borderRadius: 8,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 8,
    },
    statIconGlyph: {
      fontSize: 14,
      fontWeight: '900',
    },
    statLabel: {
      color: colors.textSecondary,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.5,
    },
    statValue: {
      fontSize: 22,
      fontWeight: '900',
      marginTop: 4,
    },
    statDetail: {
      color: colors.textSecondary,
      fontSize: 11,
      marginTop: 4,
    },

    tableCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 18,
      marginBottom: 20,
      ...BLUETAP_LAYOUT.shadow,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
      marginBottom: 16,
      flexWrap: 'wrap',
    },
    cardTitle: {
      color: colors.textPrimary,
      fontSize: 17,
      fontWeight: '900',
    },
    cardSubtitle: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 3,
    },
    badgePill: {
      backgroundColor: colors.primarySoft,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
    },
    badgePillText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '900',
    },

    emptyContainer: {
      padding: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
    },
    emptyTitle: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '800',
    },
    emptySubtitle: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 4,
    },

    tableWrapper: {
      width: '100%',
    },
    tableHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 8,
      paddingHorizontal: 12,
    },
    th: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    tableDataRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tableDataRowAlt: {
      backgroundColor: colors.surfaceAlt,
    },
    tableDataRowSelected: {
      backgroundColor: colors.primarySoft,
    },
    tdWrap: {
      justifyContent: 'center',
    },
    productNameText: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
    },
    unitsSoldText: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
    revenueText: {
      color: colors.success,
      fontSize: 13,
      fontWeight: '900',
    },
    avgText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    stationNameText: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
    },
    stationCodeText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    statusBadge: {
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
    },
    statusBadgeText: {
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'capitalize',
    },
    rateText: {
      fontSize: 13,
      fontWeight: '800',
    },
  });
