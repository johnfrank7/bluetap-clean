import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { BLUETAP_LAYOUT } from '../constants/bluetapTheme';
import SoftStatusBadge from './SoftStatusBadge';

const { notificationSeverity } = require('./notificationPresentation');

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
  const tone = notificationSeverity(status, dark);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || `${message || 'Notification'}${metadata ? ` ${metadata}` : ''}`}
      onPress={onPress}
      style={[
        styles.card,
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
        style={[styles.severityIcon, { backgroundColor: tone.soft, borderColor: tone.accent }]}
      >
        <Text style={[styles.severityIconText, { color: tone.accent }]}>{tone.icon}</Text>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardHeaderRow}>
          <SoftStatusBadge status={status} dark={dark} />
          <Text numberOfLines={1} style={[styles.time, { color: colors.textSecondary || colors.muted }]}>{time}</Text>
        </View>
        <Text style={[styles.message, { color: colors.textPrimary || colors.text }]}>{message}</Text>
        {!!metadata && <Text style={[styles.metadata, { color: colors.textSecondary || colors.muted }]}>{metadata}</Text>}
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
  severityIcon: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexShrink: 0,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  severityIconText: {
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
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
  time: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 'auto',
  },
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
