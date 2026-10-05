import React from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import { BLUETAP_LAYOUT } from '../constants/bluetapTheme';
import SoftStatusBadge from './SoftStatusBadge';
import BlueTapIcon from './BlueTapIcon';

const { compactNotificationStatus, notificationLayoutForWidth, notificationSeverity } = require('./notificationPresentation');

export default function NotificationCard({
  accessibilityLabel,
  colors,
  dark = false,
  message,
  metadata,
  onPress,
  status,
  time,
}) {
  const { width } = useWindowDimensions();
  const layout = notificationLayoutForWidth(width);
  const { narrow } = layout;
  const tone = notificationSeverity(status, dark);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || `${message || 'Notification'}${metadata ? ` ${metadata}` : ''}`}
      onPress={onPress}
      style={[
        styles.card,
        narrow && styles.cardNarrow,
        { padding: layout.cardPadding },
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderLeftColor: tone.accent,
          shadowColor: dark ? '#000000' : BLUETAP_LAYOUT.shadow.shadowColor,
        },
      ]}
    >
      <View
        accessibilityRole="image"
        accessibilityLabel={`${tone.label} notification`}
        style={[styles.severityIcon, narrow && styles.severityIconNarrow, { backgroundColor: tone.soft, borderColor: tone.accent }]}
      >
        <BlueTapIcon name={tone.kind} fallback={tone.icon} size={15} color={tone.accent} />
      </View>
      <View style={styles.cardBody}>
        <View style={[styles.cardHeaderRow, narrow && styles.cardHeaderRowNarrow]}>
          <SoftStatusBadge status={status} label={compactNotificationStatus(status)} dark={dark} compact numberOfLines={1} />
          <Text numberOfLines={1} style={[styles.time, narrow && styles.timeNarrow, { color: colors.textSecondary || colors.muted }]}>{time}</Text>
        </View>
        <Text style={[styles.message, { color: colors.textPrimary || colors.text }]}>{message}</Text>
        {!!metadata && <Text numberOfLines={layout.metadataLines} style={[styles.metadata, { color: colors.textSecondary || colors.muted }]}>{metadata}</Text>}
      </View>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.chevron, { color: colors.primary }]}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderLeftWidth: 4,
    borderRadius: BLUETAP_LAYOUT.radius.lg,
    borderWidth: 1,
    elevation: BLUETAP_LAYOUT.shadow.elevation,
    flexDirection: 'row',
    gap: 12,
    maxWidth: '100%',
    minWidth: 0,
    padding: 16,
    shadowOffset: BLUETAP_LAYOUT.shadow.shadowOffset,
    shadowOpacity: BLUETAP_LAYOUT.shadow.shadowOpacity,
    shadowRadius: BLUETAP_LAYOUT.shadow.shadowRadius,
    width: '100%',
  },
  cardNarrow: { alignItems: 'flex-start', gap: 8 },
  severityIcon: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexShrink: 0,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  severityIconNarrow: { height: 24, width: 24, borderRadius: 12, marginTop: 1 },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 6,
    minWidth: 0,
  },
  cardHeaderRowNarrow: { alignItems: 'flex-start', justifyContent: 'flex-start' },
  time: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 'auto',
  },
  timeNarrow: { marginLeft: 0, paddingTop: 2 },
  message: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  metadata: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  chevron: {
    flexShrink: 0,
    fontSize: 24,
    lineHeight: 28,
  },
});
