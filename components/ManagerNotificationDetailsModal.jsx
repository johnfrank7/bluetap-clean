import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAdminTheme } from './AdminTheme';
import SoftStatusBadge from './SoftStatusBadge';
import { formatNotificationTime, parseTimestamp } from '../services/notificationTimestamp';
const { getManagerNotificationDetail } = require('../services/managerNotifications');

const display = (value) => value === undefined || value === null || value === '' ? 'Not available' : String(value);
const money = (value) => value === undefined || value === null || value === ''
  ? 'Not available'
  : `₱${Number(value || 0).toFixed(2)}`;

export default function ManagerNotificationDetailsModal({ event, visible, onClose }) {
  const { colors, resolvedTheme } = useAdminTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const detail = React.useMemo(() => getManagerNotificationDetail(event), [event]);
  const scheduledAt = parseTimestamp(detail.scheduledAt);
  const rows = [
    ['Order ID', display(detail.requestId)],
    ['Requester', display(detail.requesterName)],
    ['Requester UID', display(detail.requesterUniqueId)],
    ['Branch', display(detail.branchName)],
    ['Delivery address', display(detail.deliveryAddress)],
    ['Distributor', display(detail.distributorName)],
    ['Distributor UID', display(detail.distributorUniqueId)],
    ['Schedule', scheduledAt ? scheduledAt.toLocaleString() : 'Not scheduled'],
    ['Delivery fee', money(detail.deliveryFee)],
    ['Total', money(detail.total)],
    ['Event time', formatNotificationTime(detail.at)],
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <View style={styles.modal} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>MANAGER NOTIFICATION</Text>
              <Text style={styles.title}>Order Update Details</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to notifications" onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>‹ Back</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.eventCard}>
              <SoftStatusBadge status={detail.status} dark={resolvedTheme === 'dark'} />
              <Text style={styles.message}>{detail.message}</Text>
            </View>

            <View style={styles.grid}>
              {rows.map(([label, value]) => (
                <View key={label} style={styles.row}>
                  <Text style={styles.label}>{label}</Text>
                  <Text style={styles.value}>{value}</Text>
                </View>
              ))}
            </View>

            <View style={styles.products}>
              <Text style={styles.sectionTitle}>Products</Text>
              {detail.items.length === 0 ? (
                <Text style={styles.emptyText}>Product details are not available for this update.</Text>
              ) : detail.items.map((item, index) => (
                <View key={item.id || `${item.name}-${index}`} style={styles.productRow}>
                  <Text style={styles.productName}>{item.name}</Text>
                  <Text style={styles.productQuantity}>× {item.quantity}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors) => StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: {
    width: '100%', maxWidth: 620, maxHeight: '90%', minWidth: 0,
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: 18, overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', marginTop: 3 },
  closeButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 10 },
  closeText: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  scroll: { minWidth: 0 },
  content: { padding: 18, gap: 14 },
  eventCard: { backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 14, gap: 10 },
  message: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', lineHeight: 21 },
  grid: { borderColor: colors.border, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
    paddingHorizontal: 14, paddingVertical: 11, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 0.42, color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  value: { flex: 0.58, minWidth: 0, color: colors.textPrimary, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  products: { backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 14 },
  sectionTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginBottom: 8 },
  productRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  productName: { flex: 1, minWidth: 0, color: colors.textPrimary, fontSize: 13 },
  productQuantity: { color: colors.textSecondary, fontSize: 13, fontWeight: '800' },
  emptyText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
});
