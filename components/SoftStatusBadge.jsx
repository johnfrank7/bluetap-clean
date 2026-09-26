import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  normalizeRequesterOrderStatus,
  requesterOrderStatusLabel,
} from '../constants/requesterOrderStatus';
import { useBlueTapTheme } from './BlueTapTheme';

const BLUE = '#2563EB';

const STATUS_META = {
  pending: {
    backgroundColor: '#FFF8E6',
    color: '#F59E0B',
    label: 'Pending',
  },
  'outside radius pending approval': {
    backgroundColor: '#FFF8E6',
    color: '#B7791F',
    label: 'Waiting for branch approval',
  },
  'awaiting distributor assignment': {
    backgroundColor: '#EFF6FF',
    color: BLUE,
    label: 'Waiting for distributor assignment',
  },
  'distributor assigned': {
    backgroundColor: '#ECFDF5',
    color: '#059669',
    label: 'Distributor assigned',
  },
  assigned: {
    backgroundColor: '#ECFDF5',
    color: '#059669',
    label: 'Distributor assigned',
  },
  'branch transfer pending': {
    backgroundColor: '#F3E8FF',
    color: '#7C3AED',
    label: 'Branch transfer in progress',
  },
  approved: {
    backgroundColor: '#ECFDF5',
    color: '#059669',
    label: 'Approved',
  },
  'declined outside service area': {
    backgroundColor: '#FEF2F2',
    color: '#DC2626',
    label: 'Declined: outside service area',
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
  'delivery failed': {
    backgroundColor: '#FEF2F2',
    color: '#EF4444',
    label: 'Delivery Failed',
  },
  'delivery failed rescheduling': {
    backgroundColor: '#FEF2F2',
    color: '#EF4444',
    label: 'Delivery Failed (rescheduling)',
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
  declined: {
    backgroundColor: '#FEF2F2',
    color: '#DC2626',
    label: 'Declined',
  },
};

const DARK_STATUS_META = {
  pending: { backgroundColor: '#38280B', color: '#FBBF24', label: 'Pending' },
  'outside radius pending approval': { backgroundColor: '#38280B', color: '#FBBF24', label: 'Waiting for branch approval' },
  'awaiting distributor assignment': { backgroundColor: '#133554', color: '#60A5FA', label: 'Waiting for distributor assignment' },
  'distributor assigned': { backgroundColor: '#0F392B', color: '#34D399', label: 'Distributor assigned' },
  assigned: { backgroundColor: '#0F392B', color: '#34D399', label: 'Distributor assigned' },
  'branch transfer pending': { backgroundColor: '#2E1A47', color: '#C084FC', label: 'Branch transfer in progress' },
  approved: { backgroundColor: '#0F392B', color: '#34D399', label: 'Approved' },
  'declined outside service area': { backgroundColor: '#3B181A', color: '#F87171', label: 'Declined: outside service area' },
  accepted: { backgroundColor: '#133554', color: '#60A5FA', label: 'Accepted' },
  scheduled: { backgroundColor: '#38280B', color: '#FBBF24', label: 'Scheduled' },
  processing: { backgroundColor: '#38280B', color: '#FBBF24', label: 'Processing' },
  'out for delivery': { backgroundColor: '#2E1A47', color: '#C084FC', label: 'Out for Delivery' },
  'delivery failed': { backgroundColor: '#3B181A', color: '#F87171', label: 'Delivery Failed' },
  'delivery failed rescheduling': { backgroundColor: '#3B181A', color: '#F87171', label: 'Delivery Failed (rescheduling)' },
  delivered: { backgroundColor: '#0F392B', color: '#34D399', label: 'Delivered' },
  cancelled: { backgroundColor: '#3B181A', color: '#F87171', label: 'Cancelled' },
  canceled: { backgroundColor: '#3B181A', color: '#F87171', label: 'Cancelled' },
  rejected: { backgroundColor: '#26333D', color: '#9CA3AF', label: 'Rejected' },
  declined: { backgroundColor: '#3B181A', color: '#F87171', label: 'Declined' },
};

export const normalizeStatus = normalizeRequesterOrderStatus;

export const getSoftStatusMeta = (status) => {
  const statusText = status || 'Pending';
  const normalizedStatus = normalizeStatus(statusText);

  return (
    STATUS_META[normalizedStatus] || {
      backgroundColor: '#EFF6FF',
      color: BLUE,
      label: requesterOrderStatusLabel(statusText),
    }
  );
};

export default function SoftStatusBadge({ status, label, style }) {
  const { isDark } = useBlueTapTheme();
  const normalizedStatus = normalizeStatus(status || 'Pending');
  const meta = (isDark ? DARK_STATUS_META[normalizedStatus] : null) || getSoftStatusMeta(status);

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
