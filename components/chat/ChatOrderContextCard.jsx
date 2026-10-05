import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import SoftStatusBadge from '../SoftStatusBadge';

const clean = (value) => String(value || '').trim();

export default function ChatOrderContextCard({ order, colors, role, onViewDetails, generalInquiry = false }) {
  if (!order) return generalInquiry ? (
    <View style={[styles.generalCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
      <Text style={[styles.generalTitle, { color: colors.textPrimary }]}>General inquiry</Text>
      <Text style={[styles.detail, { color: colors.textSecondary }]}>No order is linked to this station conversation.</Text>
    </View>
  ) : null;
  const items = Array.isArray(order.items) ? order.items : [];
  const productSummary = items.slice(0, 2).map((item) => clean(item.productNameSnapshot || item.productName || item.name)).filter(Boolean).join(', ');
  const reference = clean(order.requestId || order.request_id || order.publicOrderReference || order.id);
  const branch = clean(order.currentBranchName || order.currentBranchNameSnapshot || order.branchNameSnapshot || order.branchDisplayName || order.water_station);
  const total = Number(order.totalAtOrder ?? order.totalSnapshot ?? order.total_cost ?? order.totalAmount);
  const requesterName = clean(order.requesterName || order.requesterNameSnapshot || order.customerName);
  const status = clean(order.status || order.finalStatus);
  const canViewDetails = typeof onViewDetails === 'function';
  const Card = canViewDetails ? Pressable : View;
  return (
    <Card
      accessibilityRole={canViewDetails ? 'button' : undefined}
      accessibilityLabel={canViewDetails && reference ? `Open Order ${reference} details` : undefined}
      onPress={canViewDetails ? () => onViewDetails(order) : undefined}
      style={canViewDetails
        ? ({ pressed }) => [styles.card, { backgroundColor: colors.primarySoft, borderColor: colors.border }, pressed && styles.pressed]
        : [styles.card, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}
    >
      <View style={styles.topRow}>
        <Text style={[styles.reference, { color: colors.textPrimary }]} numberOfLines={1}>{reference ? `Order ${reference}` : 'Order context'}</Text>
        {!!status && <SoftStatusBadge status={status} style={styles.statusBadge} />}
      </View>
      {role === 'manager' && !!requesterName && <Text style={[styles.requesterName, { color: colors.textPrimary }]} numberOfLines={1}>{requesterName}</Text>}
      {!!productSummary && <Text style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={2}>{productSummary}</Text>}
      <Text style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={2}>
        {[branch, Number.isFinite(total) ? `\u20B1${total.toFixed(2)}` : ''].filter(Boolean).join(' - ')}
      </Text>
      {canViewDetails && <Text style={[styles.openLabel, { color: colors.primary }]}>View details</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, marginTop: 10, padding: 11, borderWidth: 1, borderRadius: 14 },
  generalCard: { marginHorizontal: 12, marginTop: 10, padding: 11, borderWidth: 1, borderRadius: 14 },
  generalTitle: { fontSize: 13, fontWeight: '900' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reference: { flex: 1, fontSize: 13, fontWeight: '900' },
  statusBadge: { minHeight: 24, paddingHorizontal: 9, paddingVertical: 4 },
  requesterName: { fontSize: 12, fontWeight: '800', marginTop: 4 },
  detail: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  openLabel: { fontSize: 11, fontWeight: '900', marginTop: 6 },
  pressed: { opacity: 0.82 },
});
