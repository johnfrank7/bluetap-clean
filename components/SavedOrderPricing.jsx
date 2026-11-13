import React from 'react';
import { Text, View } from 'react-native';
import { formatCurrency } from '../services/orderNormalizer';
const { savedOrderPricing } = require('../services/savedOrderPricing');

export default function SavedOrderPricing({ order, colors }) {
  const pricing = savedOrderPricing(order);
  const text = { color: colors.textPrimary, flexShrink: 1 };
  const muted = { color: colors.textSecondary, flexShrink: 1 };
  const row = { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 3 };
  return <View accessibilityLabel="Saved order pricing" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 12, gap: 7 }}>
    {pricing.items.length ? pricing.items.map((item, index) => <View key={`${item.name}-${index}`} style={{ gap: 3, paddingBottom: 6 }}>
      <Text style={[text, { fontWeight: '700' }]}>{item.name} · Qty: {item.quantity ?? 'Unavailable'}</Text>
      {Boolean(item.container) && <Text style={muted}>Container: {item.container}</Text>}
      <Text style={muted}>Original unit price: {formatCurrency(item.unitPrice)}</Text>
      <Text style={muted}>Saved item amount: {formatCurrency(item.regularAmount)}</Text>
      {Boolean(item.promotion) && <Text style={muted}>{item.promotion.title} · {item.promotion.quantity} items · Save {formatCurrency(item.promotion.savings)}</Text>}
    </View>) : <Text style={muted}>Product details unavailable</Text>}
    {Boolean(pricing.container) && <Text style={muted}>Order container: {pricing.container}</Text>}
    <View style={row}><Text style={muted}>Regular product subtotal</Text><Text style={text}>{formatCurrency(pricing.subtotal)}</Text></View>
    {pricing.savings !== null && <View style={row}><Text style={muted}>Promotional savings</Text><Text style={text}>−{formatCurrency(pricing.savings)}</Text></View>}
    {pricing.discount !== null && <View style={row}><Text style={muted}>Discount</Text><Text style={text}>−{formatCurrency(pricing.discount)}</Text></View>}
    <View style={row}><Text style={muted}>Delivery fee</Text><Text style={text}>{formatCurrency(pricing.fee)}</Text></View>
    <View style={row}><Text style={[text, { fontWeight: '700' }]}>Final payable total</Text><Text style={[text, { fontWeight: '700' }]}>{formatCurrency(pricing.total)}</Text></View>
  </View>;
}
