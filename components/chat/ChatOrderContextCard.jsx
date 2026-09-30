import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const clean = (value) => String(value || '').trim();

export default function ChatOrderContextCard({ order, colors }) {
  if (!order) return null;
  const items = Array.isArray(order.items) ? order.items : [];
  const productSummary = items.slice(0, 2).map((item) => clean(item.productNameSnapshot || item.productName || item.name)).filter(Boolean).join(', ');
  const reference = clean(order.requestId || order.request_id || order.publicOrderReference || order.id);
  const branch = clean(order.currentBranchName || order.currentBranchNameSnapshot || order.branchNameSnapshot || order.branchDisplayName || order.water_station);
  const total = Number(order.totalAtOrder ?? order.totalSnapshot ?? order.total_cost ?? order.totalAmount);
  return (
    <View style={[styles.card, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
      <View style={styles.topRow}>
        <Text style={[styles.reference, { color: colors.textPrimary }]} numberOfLines={1}>{reference ? `Order ${reference}` : 'Order context'}</Text>
        {!!clean(order.status || order.finalStatus) && <Text style={[styles.status, { color: colors.primary }]}>{clean(order.status || order.finalStatus).replace(/_/g, ' ')}</Text>}
      </View>
      {!!productSummary && <Text style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={2}>{productSummary}</Text>}
      <Text style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={2}>
        {[branch, Number.isFinite(total) ? `₱${total.toFixed(2)}` : ''].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, marginTop: 10, padding: 11, borderWidth: 1, borderRadius: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reference: { flex: 1, fontSize: 13, fontWeight: '900' },
  status: { fontSize: 10, fontWeight: '900', textTransform: 'capitalize' },
  detail: { fontSize: 11, lineHeight: 16, marginTop: 3 },
});
