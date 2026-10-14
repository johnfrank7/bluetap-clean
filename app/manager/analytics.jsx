import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useAdminTheme } from '../../components/AdminTheme';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import ManagerShell from '../../components/ManagerShell';
import { extractBranchRequesters, useManagerRealtimeData } from '../../components/ManagerRealtimeData';
import { getLocalRequests, subscribeLocalRequests } from '../../services/requests';
import { getManagerOrderAnalytics, mergeManagerBranchRequests } from '../../services/managerAnalytics';

const money = (value) => `₱${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ManagerAnalyticsPage() {
  const { colors, resolvedTheme } = useAdminTheme();
  const { width } = useWindowDimensions();
  const isDark = resolvedTheme === 'dark';
  const styles = React.useMemo(() => createStyles(colors, width), [colors, width]);
  const { branch, branchId, requests: realtimeRequests, users, requesters: realtimeRequesters = [], loading, error } = useManagerRealtimeData();
  const [localRequests, setLocalRequests] = React.useState(() => getLocalRequests());

  React.useEffect(() => {
    const refreshLocalRequests = () => setLocalRequests(getLocalRequests());
    refreshLocalRequests();
    return subscribeLocalRequests(refreshLocalRequests);
  }, [branchId]);

  const requests = React.useMemo(
    () => mergeManagerBranchRequests(realtimeRequests, localRequests, branchId),
    [branchId, localRequests, realtimeRequests]
  );
  const metrics = React.useMemo(() => getManagerOrderAnalytics(requests), [requests]);

  const branchRequesters = React.useMemo(() => {
    if (realtimeRequesters && realtimeRequesters.length > 0) return realtimeRequesters;
    return extractBranchRequesters(requests, users);
  }, [realtimeRequesters, requests, users]);

  const requesterCount = branchRequesters.length;
  const distributorCount = users.filter((user) => String(user.role || '').toLowerCase() === 'distributor').length;
  const maxStatus = Math.max(metrics.delivered, metrics.ongoing, metrics.issues, 1);

  return (
    <ManagerShell active="analytics" title="Analytics" subtitle={`Authoritative performance for ${branch?.name || 'your assigned branch'}`}>
      <View style={styles.scope}>
        <Text style={styles.scopeEyebrow}>BRANCH-ONLY SCOPE</Text>
        <Text style={styles.scopeTitle}>{branch?.name || 'Assigned branch'}</Text>
        <Text style={styles.scopeText}>
          Revenue and units use delivered-order price snapshots. No catalog prices, gallons, or generated trend points are used.
        </Text>
      </View>
      {loading && requests.length === 0 ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.secondary}>Loading branch analytics…</Text>
        </View>
      ) : error && requests.length === 0 ? (
        <BlueTapEmptyState compact variant="analytics" title="Analytics unavailable" description={error} themeColors={colors} dark={isDark} />
      ) : (
        <>
          <View style={styles.metrics}>
            <Metric styles={styles} label="Snapshot revenue" value={money(metrics.revenue)} detail={`${metrics.delivered} delivered orders`} tone="primary" />
            <Metric styles={styles} label="Units sold" value={metrics.units.toLocaleString()} detail="Delivered items only" tone="primary" />
            <Metric styles={styles} label="Total orders" value={metrics.total.toLocaleString()} detail="Current branch records" tone="primary" />
            <Metric styles={styles} label="Delivered" value={metrics.delivered.toLocaleString()} detail="Completed fulfillment" tone="success" />
            <Metric styles={styles} label="Ongoing" value={metrics.ongoing.toLocaleString()} detail="Non-terminal orders" tone="warning" />
            <Metric styles={styles} label="Issues & cancelled" value={metrics.issues.toLocaleString()} detail="Failed, declined, or cancelled" danger />
          </View>
          {metrics.total === 0 ? (
            <BlueTapEmptyState compact variant="analytics" title="Insufficient analytics data" description="Real branch metrics will appear after orders are created." themeColors={colors} dark={isDark} />
          ) : (
            <View style={styles.grid}>
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Order status distribution</Text>
                {[
                  ['Delivered', metrics.delivered, colors.success],
                  ['Ongoing', metrics.ongoing, colors.warning],
                  ['Issues & cancelled', metrics.issues, colors.danger],
                ].map(([label, value, color]) => (
                  <View key={label} style={styles.barRow}>
                    <View style={styles.barHeader}>
                      <Text style={styles.barLabel}>{label}</Text>
                      <Text style={styles.barValue}>{value}</Text>
                    </View>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${Math.max(value ? 8 : 0, (value / maxStatus) * 100)}%`, backgroundColor: color }]} />
                    </View>
                  </View>
                ))}
              </View>
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Branch people</Text>
                <View style={styles.peopleRow}>
                  <Metric styles={styles} label="Requesters" value={requesterCount.toLocaleString()} detail="Ordered from this branch" compact />
                  <Metric styles={styles} label="Distributors" value={distributorCount.toLocaleString()} detail="Assigned to branch" compact />
                </View>
              </View>
              <View style={[styles.panel, styles.productPanel]}>
                <Text style={styles.panelTitle}>Delivered product breakdown</Text>
                {metrics.products.length === 0 ? (
                  <Text style={styles.secondary}>No delivered product snapshots are available yet.</Text>
                ) : (
                  metrics.products.map((product) => (
                    <View key={product.name} style={styles.productRow}>
                      <View style={styles.productInfo}>
                        <Text numberOfLines={2} style={styles.productName}>{product.name}</Text>
                        <Text style={styles.productMeta}>Delivered product</Text>
                      </View>
                      <View style={styles.productMetrics}>
                        <Text style={styles.productUnits}>{product.units.toLocaleString()} units sold</Text>
                        <View style={styles.productRevenueGroup}>
                          <Text style={styles.productRevenueLabel}>Revenue</Text>
                          <Text style={styles.productRevenue}>{money(product.revenue)}</Text>
                        </View>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </View>
          )}
        </>
      )}
    </ManagerShell>
  );
}

function Metric({ styles, label, value, detail, danger, compact, tone }) {
  const toneStyle = danger ? styles.metricDanger : styles[`metric${tone?.[0]?.toUpperCase()}${tone?.slice(1)}`];
  return (
    <View style={[styles.metric, compact && styles.metricCompact, toneStyle]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

const createStyles = (colors, width) => {
  const isMobile = width < 640;
  const isTablet = width >= 640 && width < 1024;
  return StyleSheet.create({
    scope: { backgroundColor: colors.primaryAction, borderRadius: 18, padding: 20, marginBottom: 18 },
    scopeEyebrow: { color: '#CBEAFF', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
    scopeTitle: { color: '#FFF', fontSize: 23, fontWeight: '900', marginTop: 5 },
    scopeText: { color: '#E3F2FD', fontSize: 12, lineHeight: 18, marginTop: 5, maxWidth: 720 },
    state: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 10 },
    secondary: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 8 },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 18 },
    metric: {
      flexGrow: 1,
      flexBasis: isMobile ? '100%' : isTablet ? '45%' : '30%',
      minHeight: 126,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 16,
      justifyContent: 'space-between',
    },
    metricCompact: { minHeight: 105, flexBasis: isMobile ? '100%' : '45%', flexGrow: 1 },
    metricPrimary: { borderTopWidth: 4, borderTopColor: colors.primaryAction },
    metricSuccess: { borderTopWidth: 4, borderTopColor: colors.success },
    metricWarning: { borderTopWidth: 4, borderTopColor: colors.warning },
    metricDanger: { borderTopWidth: 4, borderTopColor: colors.danger },
    metricLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
    metricValue: { color: colors.textPrimary, fontSize: 24, fontWeight: '900', marginVertical: 6 },
    metricDetail: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    panel: { flexGrow: 1, flexBasis: isMobile ? '100%' : 340, minWidth: 0, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 18 },
    productPanel: { flexBasis: '100%' },
    panelTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '900', marginBottom: 14 },
    barRow: { marginTop: 12 },
    barHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    barLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
    barValue: { color: colors.textPrimary, fontSize: 12, fontWeight: '900' },
    track: { height: 10, borderRadius: 6, backgroundColor: colors.surfaceAlt, overflow: 'hidden', marginTop: 6 },
    fill: { height: '100%', borderRadius: 6 },
    peopleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    productRow: {
      flexDirection: isMobile ? 'column' : 'row',
      alignItems: isMobile ? 'stretch' : 'center',
      justifyContent: 'space-between',
      gap: isMobile ? 10 : 18,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    productInfo: { flex: 1, minWidth: 0 },
    productName: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', lineHeight: 20 },
    productMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 3 },
    productMetrics: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 18,
      width: isMobile ? '100%' : 'auto',
    },
    productUnits: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
    productRevenueGroup: { alignItems: 'flex-end', minWidth: 104 },
    productRevenueLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
    productRevenue: { color: colors.textPrimary, fontSize: 13, fontWeight: '900', marginTop: 2 },
  });
};
