import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  normalizeRequesterOrderStatus,
  requesterOrderStatusLabel,
} from '../constants/requesterOrderStatus';
import { useOptionalAdminTheme } from './AdminTheme';
import { useBlueTapTheme } from './BlueTapTheme';

const BLUE = '#1D4ED8';

const STATUS_META = {
  active: {
    backgroundColor: '#ECFDF5',
    borderColor: '#86EFAC',
    color: '#047857',
    label: 'Active',
    tone: 'success',
  },
  inactive: {
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
    color: '#4B5563',
    label: 'Inactive',
    tone: 'neutral',
  },
  'general inquiry': {
    backgroundColor: '#EDE9FE',
    borderColor: '#C4B5FD',
    color: '#5B21B6',
    label: 'General inquiry',
    tone: 'inquiry',
  },
  pending: {
    backgroundColor: '#FFF8E6',
    borderColor: '#FDE68A',
    color: '#9A5B00',
    label: 'Pending',
    tone: 'warning',
  },
  warning: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FDBA74',
    color: '#B45309',
    label: 'Warning',
    tone: 'warning',
  },
  restricted: {
    backgroundColor: '#FFF1F0',
    borderColor: '#FDBA74',
    color: '#C2410C',
    label: 'Restricted',
    tone: 'danger',
  },
  'outside radius pending approval': {
    backgroundColor: '#FFF8E6',
    borderColor: '#FDE68A',
    color: '#9A5B00',
    label: 'Waiting for branch approval',
    tone: 'warning',
  },
  'manager approval pending': {
    backgroundColor: '#FFF8E6',
    borderColor: '#FDE68A',
    color: '#9A5B00',
    label: 'Waiting for branch approval',
    tone: 'warning',
  },
  'awaiting distributor assignment': {
    backgroundColor: '#FFF8E6',
    borderColor: '#FDE68A',
    color: '#9A5B00',
    label: 'Waiting for distributor assignment',
    tone: 'warning',
  },
  'waiting for distributor assignment': {
    backgroundColor: '#FFF8E6',
    borderColor: '#FDE68A',
    color: '#9A5B00',
    label: 'Waiting for distributor assignment',
    tone: 'warning',
  },
  'distributor assigned': {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    color: BLUE,
    label: 'Distributor assigned',
    tone: 'assigned',
  },
  assigned: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    color: BLUE,
    label: 'Distributor assigned',
    tone: 'assigned',
  },
  'branch transfer pending': {
    backgroundColor: '#F3E8FF',
    borderColor: '#D8B4FE',
    color: '#7C3AED',
    label: 'Branch transfer in progress',
    tone: 'transfer',
  },
  approved: {
    backgroundColor: '#ECFDF5',
    borderColor: '#86EFAC',
    color: '#047857',
    label: 'Approved',
    tone: 'success',
  },
  'declined outside service area': {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    color: '#DC2626',
    label: 'Declined: outside service area',
    tone: 'danger',
  },
  accepted: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    color: BLUE,
    label: 'Accepted',
    tone: 'assigned',
  },
  scheduled: {
    backgroundColor: '#FFF3E6',
    borderColor: '#FDBA74',
    color: '#9A4D00',
    label: 'Scheduled',
    tone: 'scheduled',
  },
  rescheduled: {
    backgroundColor: '#FFF3E6',
    borderColor: '#FDBA74',
    color: '#9A4D00',
    label: 'Rescheduled',
    tone: 'scheduled',
  },
  processing: {
    backgroundColor: '#FFF3E6',
    borderColor: '#FDBA74',
    color: '#9A4D00',
    label: 'Processing',
    tone: 'scheduled',
  },
  'out for delivery': {
    backgroundColor: '#E0F2FE',
    borderColor: '#7DD3FC',
    color: '#0369A1',
    label: 'Out for Delivery',
    tone: 'active_delivery',
  },
  'delivery failed': {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    color: '#B91C1C',
    label: 'Delivery Failed',
    tone: 'danger',
  },
  'delivery failed rescheduling': {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    color: '#B91C1C',
    label: 'Delivery Failed (rescheduling)',
    tone: 'danger',
  },
  delivered: {
    backgroundColor: '#ECFDF5',
    borderColor: '#86EFAC',
    color: '#047857',
    label: 'Delivered',
    tone: 'success',
  },
  completed: {
    backgroundColor: '#ECFDF5',
    borderColor: '#86EFAC',
    color: '#047857',
    label: 'Delivered',
    tone: 'success',
  },
  cancelled: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    color: '#B91C1C',
    label: 'Cancelled',
    tone: 'danger',
  },
  canceled: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    color: '#B91C1C',
    label: 'Cancelled',
    tone: 'danger',
  },
  rejected: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    color: '#B91C1C',
    label: 'Rejected',
    tone: 'danger',
  },
  declined: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    color: '#B91C1C',
    label: 'Declined',
    tone: 'danger',
  },
};

const DARK_STATUS_META = {
  active: { backgroundColor: '#0F392B', borderColor: '#059669', color: '#34D399', label: 'Active', tone: 'success' },
  inactive: { backgroundColor: '#26333D', borderColor: '#475569', color: '#CBD5E1', label: 'Inactive', tone: 'neutral' },
  'general inquiry': { backgroundColor: '#2E1A47', borderColor: '#7C3AED', color: '#D8B4FE', label: 'General inquiry', tone: 'inquiry' },
  pending: { backgroundColor: '#38280B', borderColor: '#D97706', color: '#FBBF24', label: 'Pending', tone: 'warning' },
  warning: { backgroundColor: '#38280B', borderColor: '#D97706', color: '#FBBF24', label: 'Warning', tone: 'warning' },
  restricted: { backgroundColor: '#451A03', borderColor: '#EA580C', color: '#FB923C', label: 'Restricted', tone: 'danger' },
  'outside radius pending approval': { backgroundColor: '#38280B', borderColor: '#D97706', color: '#FBBF24', label: 'Waiting for branch approval', tone: 'warning' },
  'manager approval pending': { backgroundColor: '#38280B', borderColor: '#D97706', color: '#FBBF24', label: 'Waiting for branch approval', tone: 'warning' },
  'awaiting distributor assignment': { backgroundColor: '#38280B', borderColor: '#D97706', color: '#FBBF24', label: 'Waiting for distributor assignment', tone: 'warning' },
  'waiting for distributor assignment': { backgroundColor: '#38280B', borderColor: '#D97706', color: '#FBBF24', label: 'Waiting for distributor assignment', tone: 'warning' },
  'distributor assigned': { backgroundColor: '#133554', borderColor: '#2563EB', color: '#60A5FA', label: 'Distributor assigned', tone: 'assigned' },
  assigned: { backgroundColor: '#133554', borderColor: '#2563EB', color: '#60A5FA', label: 'Distributor assigned', tone: 'assigned' },
  'branch transfer pending': { backgroundColor: '#2E1A47', borderColor: '#8B5CF6', color: '#C084FC', label: 'Branch transfer in progress', tone: 'transfer' },
  approved: { backgroundColor: '#0F392B', borderColor: '#059669', color: '#34D399', label: 'Approved', tone: 'success' },
  'declined outside service area': { backgroundColor: '#3B181A', borderColor: '#DC2626', color: '#F87171', label: 'Declined: outside service area', tone: 'danger' },
  accepted: { backgroundColor: '#133554', borderColor: '#2563EB', color: '#60A5FA', label: 'Accepted', tone: 'assigned' },
  scheduled: { backgroundColor: '#431407', borderColor: '#EA580C', color: '#FB923C', label: 'Scheduled', tone: 'scheduled' },
  rescheduled: { backgroundColor: '#431407', borderColor: '#EA580C', color: '#FB923C', label: 'Rescheduled', tone: 'scheduled' },
  processing: { backgroundColor: '#431407', borderColor: '#EA580C', color: '#FB923C', label: 'Processing', tone: 'scheduled' },
  'out for delivery': { backgroundColor: '#0C4A6E', borderColor: '#0284C7', color: '#38BDF8', label: 'Out for Delivery', tone: 'active_delivery' },
  'delivery failed': { backgroundColor: '#3B181A', borderColor: '#DC2626', color: '#F87171', label: 'Delivery Failed', tone: 'danger' },
  'delivery failed rescheduling': { backgroundColor: '#3B181A', borderColor: '#DC2626', color: '#F87171', label: 'Delivery Failed (rescheduling)', tone: 'danger' },
  delivered: { backgroundColor: '#0F392B', borderColor: '#059669', color: '#34D399', label: 'Delivered', tone: 'success' },
  completed: { backgroundColor: '#0F392B', borderColor: '#059669', color: '#34D399', label: 'Delivered', tone: 'success' },
  cancelled: { backgroundColor: '#3B181A', borderColor: '#DC2626', color: '#F87171', label: 'Cancelled', tone: 'danger' },
  canceled: { backgroundColor: '#3B181A', borderColor: '#DC2626', color: '#F87171', label: 'Cancelled', tone: 'danger' },
  rejected: { backgroundColor: '#3B181A', borderColor: '#DC2626', color: '#F87171', label: 'Rejected', tone: 'danger' },
  declined: { backgroundColor: '#3B181A', borderColor: '#DC2626', color: '#F87171', label: 'Declined', tone: 'danger' },
};

export const normalizeStatus = normalizeRequesterOrderStatus;

export const getSoftStatusMeta = (status, options = {}) => {
  const isDark = typeof options === 'boolean' ? options : Boolean(options?.isDark);
  const statusText = status || 'Pending';
  const normalizedStatus = normalizeStatus(statusText);
  const palette = isDark ? DARK_STATUS_META : STATUS_META;

  return (
    palette[normalizedStatus] ||
    STATUS_META[normalizedStatus] || {
      backgroundColor: isDark ? '#133554' : '#EFF6FF',
      borderColor: isDark ? '#2563EB' : '#BFDBFE',
      color: isDark ? '#60A5FA' : BLUE,
      label: requesterOrderStatusLabel(statusText),
      tone: 'assigned',
    }
  );
};

export default function SoftStatusBadge({ status, label, style, textStyle, dark, compact = false, numberOfLines }) {
  const adminTheme = useOptionalAdminTheme();
  const { isDark: portalIsDark } = useBlueTapTheme();
  const isDark = dark === undefined ? (adminTheme ? adminTheme.resolvedTheme === 'dark' : portalIsDark) : dark;
  const meta = getSoftStatusMeta(status, { isDark });

  return (
    <View style={[styles.badge, compact && styles.compactBadge, { backgroundColor: meta.backgroundColor }, style]}>
      <View style={[styles.dot, compact && styles.compactDot, { backgroundColor: meta.color }]} />
      <Text numberOfLines={numberOfLines} ellipsizeMode="tail" style={[styles.text, compact && styles.compactText, { color: meta.color }, textStyle]}>
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
  compactBadge: {
    minHeight: 20,
    paddingHorizontal: 7,
    paddingVertical: 2,
    flexShrink: 1,
    overflow: 'hidden',
  },
  compactDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 5,
    flexShrink: 0,
  },
  compactText: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 13,
  },
});
