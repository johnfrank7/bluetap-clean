import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const BLUE = '#2563EB';

const STATUS_META = {
  pending: {
    backgroundColor: '#FFF8E6',
    color: '#F59E0B',
    label: 'Pending',
  },
  accepted: {
    backgroundColor: '#EFF6FF',
    color: BLUE,
    label: 'Accepted',
  },
  scheduled: {
    backgroundColor: '#FFF3E6',
    color: '#FB923C',
    label: 'Scheduled',
  },
  processing: {
    backgroundColor: '#FFF3E6',
    color: '#FB923C',
    label: 'Processing',
  },
  'out for delivery': {
    backgroundColor: '#F3E8FF',
    color: '#7C3AED',
    label: 'Out for Delivery',
  },
  delivered: {
    backgroundColor: '#ECFDF5',
    color: '#059669',
    label: 'Delivered',
  },
  cancelled: {
    backgroundColor: '#FEF2F2',
    color: '#EF4444',
    label: 'Cancelled',
  },
  canceled: {
    backgroundColor: '#FEF2F2',
    color: '#EF4444',
    label: 'Cancelled',
  },
  rejected: {
    backgroundColor: '#F3F4F6',
    color: '#6B7280',
    label: 'Rejected',
  },
};

export const normalizeStatus = (status) =>
  (status || '')
    .toString()
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

export const getSoftStatusMeta = (status) => {
  const statusText = status || 'Pending';
  const normalizedStatus = normalizeStatus(statusText);

  return (
    STATUS_META[normalizedStatus] || {
      backgroundColor: '#EFF6FF',
      color: BLUE,
      label: statusText,
    }
  );
};

export default function SoftStatusBadge({ status, label, style }) {
  const meta = getSoftStatusMeta(status);

  return (
    <View style={[styles.badge, { backgroundColor: meta.backgroundColor }, style]}>
      <View style={[styles.dot, { backgroundColor: meta.color }]} />
      <Text style={[styles.text, { color: meta.color }]}>
        {label || meta.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexShrink: 0,
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 7,
  },
  text: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
  },
});
