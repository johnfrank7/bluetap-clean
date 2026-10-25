import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useAdminTheme } from './AdminTheme';
import BlueTapBrandMark from './BlueTapBrandMark';
import SidebarIcon from './SidebarIcon';

const money = (value) => `₱${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function SalesOverviewContent({ sales, compact = false, stacked = false, horizontalMetrics = false }) {
  const { colors } = useAdminTheme();
  const styles = React.useMemo(
    () => createStyles(colors, compact, stacked, horizontalMetrics),
    [colors, compact, stacked, horizontalMetrics]
  );
  const [hoveredSlice, setHoveredSlice] = React.useState(null);
  const pieSize = compact ? 104 : 120;
  const hasOrderMix = Number.isFinite(Number(sales.totalOrders)) && sales.totalOrders != null;
  const totalOrders = hasOrderMix ? Math.max(0, Number(sales.totalOrders)) : 0;
  const deliveredOrders = Math.min(totalOrders, Math.max(0, Number(sales.deliveredOrders) || 0));
  const otherOrders = totalOrders - deliveredOrders;
  const sweep = totalOrders ? (deliveredOrders / totalOrders) * 360 : 0;
  const activeSlice = hoveredSlice === 'other' ? 'other' : 'delivered';
  const activeCount = activeSlice === 'delivered' ? deliveredOrders : otherOrders;
  const activePercent = totalOrders ? Math.round((activeCount / totalOrders) * 100) : 0;

  const onPiePointerMove = (event) => {
    if (Platform.OS !== 'web' || !totalOrders) return;
    const bounds = event.currentTarget?.getBoundingClientRect?.();
    if (!bounds) return;
    const clientX = Number(event.clientX ?? event.nativeEvent?.clientX);
    const clientY = Number(event.clientY ?? event.nativeEvent?.clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    const x = clientX - bounds.left - bounds.width / 2;
    const y = clientY - bounds.top - bounds.height / 2;
    if (Math.hypot(x, y) < (compact ? 34 : 40)) { setHoveredSlice(null); return; }
    const degrees = (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360;
    setHoveredSlice(degrees < sweep ? 'delivered' : 'other');
  };
  const webPieStyle = Platform.OS === 'web' && totalOrders
    ? { backgroundImage: `conic-gradient(${colors.success} 0deg ${sweep}deg, ${colors.primary} ${sweep}deg 360deg)` }
    : null;

  const metrics = [
    {
      key: 'revenue',
      label: 'SNAPSHOT REVENUE',
      value: money(sales.revenue),
      detail: 'Confirmed delivered total',
      isPrimary: true,
      icon: 'CircleDollarSign',
      iconColor: colors.iconSuccess || colors.success,
      iconBg: colors.successSoft,
    },
    {
      key: 'delivered',
      label: 'DELIVERED ORDERS',
      value: sales.deliveredOrders,
      detail: 'Completed branch orders',
      isPrimary: false,
      icon: 'ShieldCheck',
      iconColor: colors.iconPrimary || colors.primary,
      iconBg: colors.primarySoft,
    },
    {
      key: 'units',
      label: 'UNITS SOLD',
      value: sales.units,
      detail: 'Delivered container units',
      isPrimary: false,
      icon: 'Package',
      iconColor: colors.iconPrimary || colors.primary,
      iconBg: colors.surfaceAlt,
    },
  ];

  return (
    <View style={styles.salesBody}>
      <View style={styles.salesChartColumn}>
        <View style={styles.pieFrame} onPointerMove={onPiePointerMove} onPointerLeave={() => setHoveredSlice(null)}>
          <View pointerEvents="none" style={[styles.pieCircle, { backgroundColor: totalOrders ? colors.primary : colors.neutral }, webPieStyle, hoveredSlice && styles.pieHovered]}>
            {Platform.OS !== 'web' && totalOrders > 0 && <>
              <View style={[styles.pieClip, styles.pieClipRight]}>
                {sweep >= 180
                  ? <View style={[styles.pieHalf, { width: '100%', backgroundColor: colors.success }]} />
                  : <View style={[styles.pieRotator, { left: -pieSize / 2, transform: [{ rotate: `${sweep}deg` }] }]}><View style={[styles.pieHalf, { backgroundColor: colors.success }]} /></View>}
              </View>
              {sweep > 180 && <View style={[styles.pieClip, styles.pieClipLeft]}><View style={[styles.pieRotator, { transform: [{ rotate: `${sweep - 180}deg` }] }]}><View style={[styles.pieHalf, { left: pieSize / 2, backgroundColor: colors.success }]} /></View></View>}
            </>}
            <View style={styles.pieHole}><BlueTapBrandMark color={colors.primaryAction} size={compact ? 32 : 38} /></View>
          </View>
        </View>
        <View style={styles.salesChartMeta}>
          <Text style={styles.pieCaption}>
            {!hasOrderMix
              ? 'Order mix unavailable'
              : !totalOrders
                ? 'No orders in this snapshot'
                : hoveredSlice
                  ? `${activeSlice === 'delivered' ? 'Delivered' : 'Other statuses'}: ${activeCount} (${activePercent}%)`
                  : `${totalOrders} orders in this snapshot`}
          </Text>
          {totalOrders > 0 && (
            <View style={styles.pieLegend}>
              <View style={styles.pieLegendItem} onPointerEnter={() => setHoveredSlice('delivered')} onPointerLeave={() => setHoveredSlice(null)}>
                <View style={[styles.pieLegendDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.pieLegendText, hoveredSlice === 'delivered' && styles.pieLegendActive]}>Delivered</Text>
              </View>
              <View style={styles.pieLegendItem} onPointerEnter={() => setHoveredSlice('other')} onPointerLeave={() => setHoveredSlice(null)}>
                <View style={[styles.pieLegendDot, { backgroundColor: colors.primary }]} />
                <Text style={[styles.pieLegendText, hoveredSlice === 'other' && styles.pieLegendActive]}>Other</Text>
              </View>
            </View>
          )}
        </View>
      </View>

      <View style={styles.salesFigures}>
        {metrics.map((item, index) => (
          <View
            key={item.key}
            style={[
              styles.salesFigure,
              index > 0 && (horizontalMetrics && !compact && !stacked ? styles.salesFigureVerticalDivider : styles.salesFigureHorizontalDivider),
            ]}
          >
            <View style={styles.salesFigureHeader}>
              <View style={[styles.salesMetricIconBadge, { backgroundColor: item.iconBg, borderColor: colors.border }]}>
                <SidebarIcon name={item.icon} size={17} tintColor={item.iconColor} />
              </View>
              <View style={styles.salesFigureCopy}>
                <Text style={styles.salesLabel}>{item.label}</Text>
                <Text numberOfLines={1} style={styles.salesDetail}>{item.detail}</Text>
              </View>
            </View>
            <Text style={item.isPrimary ? styles.salesValue : styles.salesMetric}>{item.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const createStyles = (colors, compact, stacked, horizontalMetrics) => {
  const useColumns = Boolean(horizontalMetrics && !compact && !stacked);
  return StyleSheet.create({
    salesBody: {
      flexDirection: stacked ? 'column' : 'row',
      alignItems: 'center',
      gap: compact ? 14 : 22,
      minWidth: 0,
    },
    salesChartColumn: {
      width: stacked ? '100%' : undefined,
      flexDirection: stacked ? 'column' : 'row',
      alignItems: 'center',
      justifyContent: stacked ? 'center' : 'flex-start',
      gap: compact ? 10 : 14,
      paddingRight: stacked ? 0 : (compact ? 14 : 22),
      paddingBottom: stacked ? 12 : 0,
      borderRightWidth: stacked ? 0 : 1,
      borderBottomWidth: stacked ? 1 : 0,
      borderColor: colors.border,
      flexShrink: 0,
    },
    salesChartMeta: {
      alignItems: stacked ? 'center' : 'flex-start',
      justifyContent: 'center',
      maxWidth: stacked ? 240 : 148,
      minWidth: stacked ? 0 : 112,
    },
    pieFrame: {
      width: compact ? 104 : 120,
      height: compact ? 104 : 120,
      borderRadius: 999,
      cursor: 'pointer',
      flexShrink: 0,
    },
    pieCircle: {
      width: '100%',
      height: '100%',
      borderRadius: 999,
      overflow: 'hidden',
      transitionDuration: '160ms',
      transitionProperty: 'transform',
      borderWidth: 1,
      borderColor: colors.border,
    },
    pieHovered: { transform: [{ scale: 1.04 }] },
    pieClip: { position: 'absolute', top: 0, bottom: 0, width: '50%', overflow: 'hidden' },
    pieClipRight: { right: 0 },
    pieClipLeft: { left: 0 },
    pieRotator: { position: 'absolute', top: 0, width: compact ? 104 : 120, height: compact ? 104 : 120 },
    pieHalf: { position: 'absolute', top: 0, left: 0, width: '50%', height: '100%' },
    pieHole: {
      position: 'absolute',
      left: compact ? 18 : 20,
      top: compact ? 18 : 20,
      width: compact ? 68 : 80,
      height: compact ? 68 : 80,
      borderRadius: 999,
      backgroundColor: colors.white,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pieCaption: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: '700',
      textAlign: stacked ? 'center' : 'left',
    },
    pieLegend: {
      flexDirection: 'row',
      justifyContent: stacked ? 'center' : 'flex-start',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 6,
    },
    pieLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, cursor: 'pointer' },
    pieLegendDot: { width: 8, height: 8, borderRadius: 4 },
    pieLegendText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
    pieLegendActive: { color: colors.textPrimary, textDecorationLine: 'underline' },
    salesFigures: {
      flex: stacked ? 0 : 1,
      width: stacked ? '100%' : undefined,
      flexDirection: useColumns ? 'row' : 'column',
      alignItems: 'stretch',
      justifyContent: 'center',
      minWidth: 0,
    },
    salesFigure: {
      flex: useColumns ? 1 : 0,
      minWidth: 0,
      flexDirection: useColumns ? 'column' : 'row',
      alignItems: useColumns ? 'flex-start' : 'center',
      justifyContent: useColumns ? 'space-between' : 'space-between',
      gap: useColumns ? 8 : 12,
      paddingVertical: useColumns ? 6 : (compact ? 8 : 10),
      paddingHorizontal: useColumns ? 16 : 0,
    },
    salesFigureHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minWidth: 0,
      flexShrink: 1,
    },
    salesMetricIconBadge: {
      width: 34,
      height: 34,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    salesFigureVerticalDivider: {
      borderLeftWidth: 1,
      borderLeftColor: colors.border,
    },
    salesFigureHorizontalDivider: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    salesFigureCopy: {
      minWidth: 0,
      flexShrink: 1,
    },
    salesLabel: {
      color: colors.textSecondary,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.5,
    },
    salesDetail: {
      color: colors.textSecondary,
      fontSize: 11,
      marginTop: 2,
    },
    salesValue: {
      color: colors.success,
      fontSize: compact ? 19 : 23,
      fontWeight: '900',
      marginTop: useColumns ? 2 : 0,
    },
    salesMetric: {
      color: colors.textPrimary,
      fontSize: compact ? 18 : 21,
      fontWeight: '900',
      marginTop: useColumns ? 2 : 0,
    },
  });
};
