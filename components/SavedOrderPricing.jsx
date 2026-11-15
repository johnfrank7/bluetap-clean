import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import OngoingRequestFieldIcon from './OngoingRequestFieldIcon';
import { formatCurrency } from '../services/orderNormalizer';
const { savedOrderPricing } = require('../services/savedOrderPricing');

export default function SavedOrderPricing({ order, colors }) {
  const pricing = savedOrderPricing(order);
  const isSnapshot = order?.pricingSnapshot?.schemaVersion === 1;

  return (
    <View accessibilityLabel="Saved order pricing" style={[styles.container, { borderColor: colors.border }]}>
      {pricing.items.length ? (
        pricing.items.map((item, index) => (
          <View
            key={`${item.name}-${index}`}
            style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={styles.itemHeader}>
              <View style={styles.itemNameWrap}>
                <OngoingRequestFieldIcon name="Package" size={15} tintColor={colors.iconPrimary || colors.primaryAction} />
                <Text style={[styles.itemName, { color: colors.textPrimary }]} numberOfLines={2}>
                  {item.name}
                </Text>
              </View>
              <View style={[styles.qtyBadge, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
                <Text style={[styles.qtyText, { color: colors.primaryAction || colors.primary }]}>
                  Qty: {item.quantity ?? '—'}
                </Text>
              </View>
            </View>

            {Boolean(item.container) && (
              <View style={styles.metaRow}>
                <OngoingRequestFieldIcon name="Layers" size={13} tintColor={colors.iconSecondary || colors.textSecondary} />
                <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                  {item.container}
                </Text>
              </View>
            )}

            <View style={styles.pricingRow}>
              <Text style={[styles.unitPriceText, { color: colors.textSecondary }]}>
                {item.unitPrice !== null ? `${formatCurrency(item.unitPrice)} each` : 'Price on record'}
              </Text>
              <Text style={[styles.amountText, { color: colors.textPrimary }]}>
                {formatCurrency(item.regularAmount)}
              </Text>
            </View>

            {Boolean(item.promotion) && (
              <View style={[styles.promotionBadge, { backgroundColor: colors.successSoft || '#E8F7EF', borderColor: colors.borderSuccess || '#A3E5B9' }]}>
                <OngoingRequestFieldIcon name="Tag" size={13} tintColor={colors.iconSuccess || '#16A34A'} />
                <Text style={[styles.promotionText, { color: colors.iconSuccess || '#16A34A' }]} numberOfLines={2}>
                  {item.promotion.title} ({item.promotion.quantity} items) · Saved −{formatCurrency(item.promotion.savings)}
                </Text>
              </View>
            )}
          </View>
        ))
      ) : (
        <View style={[styles.emptyBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Product details unavailable</Text>
        </View>
      )}

      {Boolean(pricing.container && !pricing.items.some((i) => i.container)) && (
        <View style={styles.orderContainerRow}>
          <OngoingRequestFieldIcon name="Layers" size={13} tintColor={colors.iconSecondary || colors.textSecondary} />
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>
            Container: {pricing.container}
          </Text>
        </View>
      )}

      <View style={[styles.summaryBox, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Regular product subtotal</Text>
          <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>{formatCurrency(pricing.subtotal)}</Text>
        </View>

        {pricing.savings !== null && pricing.savings > 0 && (
          <View style={styles.summaryRow}>
            <View style={styles.summaryIconLabel}>
              <OngoingRequestFieldIcon name="Tag" size={13} tintColor={colors.iconSuccess || '#16A34A'} />
              <Text style={[styles.summaryLabel, { color: colors.iconSuccess || '#16A34A', fontWeight: '800' }]}>
                Promotional savings
              </Text>
            </View>
            <View style={[styles.savingsChip, { backgroundColor: colors.successSoft || '#E8F7EF', borderColor: colors.borderSuccess || '#A3E5B9' }]}>
              <Text style={[styles.savingsChipText, { color: colors.iconSuccess || '#16A34A' }]}>
                −{formatCurrency(pricing.savings)}
              </Text>
            </View>
          </View>
        )}

        {pricing.discount !== null && pricing.discount > 0 && (
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Discount</Text>
            <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>−{formatCurrency(pricing.discount)}</Text>
          </View>
        )}

        <View style={styles.summaryRow}>
          <View style={styles.summaryIconLabel}>
            <OngoingRequestFieldIcon name="Truck" size={13} tintColor={colors.iconSecondary || colors.textSecondary} />
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Delivery fee</Text>
          </View>
          <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>{formatCurrency(pricing.fee)}</Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.summaryRow}>
          <Text style={[styles.totalLabel, { color: colors.textPrimary }]}>Final payable total</Text>
          <Text style={[styles.totalValue, { color: colors.primaryAction || colors.primary }]}>{formatCurrency(pricing.total)}</Text>
        </View>

        {isSnapshot && (
          <Text style={[styles.snapshotNote, { color: colors.textSecondary }]}>
            Server-verified pricing snapshot
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  itemNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },
  qtyBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  qtyText: {
    fontSize: 11,
    fontWeight: '900',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pricingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  unitPriceText: {
    fontSize: 12,
  },
  amountText: {
    fontSize: 13,
    fontWeight: '800',
  },
  promotionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 4,
  },
  promotionText: {
    fontSize: 11,
    fontWeight: '800',
    flex: 1,
  },
  emptyBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12,
  },
  orderContainerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  summaryBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 7,
    marginTop: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  summaryIconLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryLabel: {
    fontSize: 12,
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  savingsChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  savingsChipText: {
    fontSize: 12,
    fontWeight: '900',
  },
  divider: {
    height: 1,
    marginVertical: 4,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '900',
  },
  totalValue: {
    fontSize: 17,
    fontWeight: '900',
  },
  snapshotNote: {
    fontSize: 10,
    marginTop: 2,
    textAlign: 'right',
  },
});
