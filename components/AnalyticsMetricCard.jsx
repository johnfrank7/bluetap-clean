import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { BLUETAP_LAYOUT } from '../constants/bluetapTheme';
import SidebarIcon from './SidebarIcon';

export default function AnalyticsMetricCard({
  accent,
  colors,
  detail,
  icon,
  iconBackground,
  label,
  compact = false,
  style,
  valueColor,
  value,
}) {
  const [active, setActive] = React.useState(false);
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}. ${detail}`}
      focusable
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={[styles.card, compact && styles.compactCard, style, { borderTopColor: accent }, active && [styles.activeCard, { borderColor: accent }]]}
    >
      <View style={styles.labelRow}>
        <View style={[styles.iconWrap, { backgroundColor: iconBackground }]}>
          <SidebarIcon name={icon} size={17} color={accent} />
        </View>
        <Text numberOfLines={2} style={styles.label}>{label}</Text>
      </View>
      <Text style={[styles.value, { color: valueColor || colors.textPrimary }]}>{value}</Text>
      <Text numberOfLines={2} style={styles.detail}>{detail}</Text>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  card: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 150,
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 4,
    borderRadius: 14,
    ...BLUETAP_LAYOUT.shadow,
    ...Platform.select({
      web: {
        cursor: 'default',
        transitionDuration: '160ms',
        transitionProperty: 'transform, box-shadow, border-color',
      },
      default: {},
    }),
  },
  compactCard: { minHeight: 105, padding: 12 },
  activeCard: {
    transform: [{ translateY: -2 }],
    borderColor: colors.border,
    shadowOpacity: 0.13,
    shadowRadius: 18,
    elevation: 4,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  iconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  value: { fontSize: 22, fontWeight: '900', marginTop: 8 },
  detail: { color: colors.textSecondary, fontSize: 11, marginTop: 4, lineHeight: 16 },
});
