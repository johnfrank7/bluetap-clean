import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { createPortalStyleSheet, useBlueTapTheme } from './BlueTapTheme';
import { createShadow } from './shadowStyles';
import { updateRequest } from '../services/requests';

const formatPrice = (val) => `₱${Number(val || 0).toFixed(2)}`;

export default function RequesterEditOrderModal({
  visible,
  onClose,
  request: requestProp,
  order: orderProp,
  onSaved,
  onShowToast,
}) {
  const request = requestProp || orderProp;
  const { colors, isDark } = useBlueTapTheme();
  const [items, setItems] = useState([]);
  const [container, setContainer] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!request || !visible) return;

    setError('');
    setContainer(request.container || '');
    setNotes(request.notes || request.specialInstructions || '');

    const rawItems = Array.isArray(request.items) && request.items.length > 0
      ? request.items
      : [
          {
            product_id: request.product_id || request.productId || '',
            productId: request.product_id || request.productId || '',
            product_name: request.product_name || request.productName || 'Water',
            productName: request.product_name || request.productName || 'Water',
            product_price: Number(request.product_price ?? request.price ?? request.unitPriceAtOrder ?? 0),
            unitPrice: Number(request.product_price ?? request.price ?? request.unitPriceAtOrder ?? 0),
            quantity: Number(request.quantity || 1),
          },
        ];

    setItems(
      rawItems.map((item, idx) => ({
        id: item.product_id || item.productId || `item-${idx}`,
        productId: item.product_id || item.productId || '',
        name: item.product_name || item.productName || item.productNameSnapshot || 'Water',
        unitPrice: Number(item.product_price ?? item.price ?? item.unitPriceAtOrder ?? item.unitPrice ?? 0),
        quantity: Math.max(1, Number(item.quantity || 1)),
      }))
    );
  }, [request, visible]);

  if (!visible || !request) return null;

  const updateQuantity = (index, delta) => {
    setItems((current) =>
      current.map((item, i) => {
        if (i !== index) return item;
        const nextQty = Math.max(1, Math.min(100, item.quantity + delta));
        return { ...item, quantity: nextQty };
      })
    );
  };

  const calculatedSubtotal = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );
  const deliveryFee = Number(
    request.deliveryFeeAtOrder ?? request.deliveryFee ?? 0
  );
  const calculatedTotal = calculatedSubtotal + deliveryFee;

  const handleSave = async () => {
    if (saving) return;

    if (items.length === 0) {
      setError('Please have at least one product in your order.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        items: items.map((item) => ({
          productId: item.productId || item.id,
          quantity: item.quantity,
        })),
        container: container.trim(),
        notes: notes.trim(),
      };

      const updated = await updateRequest(request, payload);
      onShowToast?.('Order updated successfully.', 'success');
      onSaved?.(updated);
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to update order. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={saving ? undefined : onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.primary }]}>Edit Pending Order</Text>
              <Text style={[styles.subTitle, { color: colors.textSecondary }]}>
                Order #{request.request_id || request.requestId || request.id}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              disabled={saving}
              style={styles.closeBtn}
            >
              <Text style={[styles.closeText, { color: colors.textSecondary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
            {/* Items Section */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.primary }]}>Ordered Products</Text>
              {items.map((item, idx) => (
                <View
                  key={item.id}
                  style={[
                    styles.itemRow,
                    { borderColor: colors.border },
                    idx > 0 && styles.itemRowBorder,
                  ]}
                >
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={[styles.itemName, { color: colors.textPrimary }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.itemPrice, { color: colors.textSecondary }]}>
                      {formatPrice(item.unitPrice)} each
                    </Text>
                  </View>

                  <View style={styles.qtyControlRow}>
                    <TouchableOpacity
                      onPress={() => updateQuantity(idx, -1)}
                      style={[styles.qtyBtn, { borderColor: colors.border }]}
                      disabled={saving || item.quantity <= 1}
                    >
                      <Text style={[styles.qtyBtnText, { color: colors.primary }]}>-</Text>
                    </TouchableOpacity>
                    <Text style={[styles.qtyText, { color: colors.textPrimary }]}>
                      {item.quantity}
                    </Text>
                    <TouchableOpacity
                      onPress={() => updateQuantity(idx, 1)}
                      style={[styles.qtyBtn, { borderColor: colors.border }]}
                      disabled={saving || item.quantity >= 100}
                    >
                      <Text style={[styles.qtyBtnText, { color: colors.primary }]}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>

            {/* Container */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.primary }]}>Container Type</Text>
              <TextInput
                value={container}
                onChangeText={setContainer}
                placeholder="e.g. Slim 5-gal, Round Dispenser"
                placeholderTextColor={colors.placeholder}
                style={[
                  styles.input,
                  {
                    backgroundColor: isDark ? colors.backgroundSecondary : '#F8FAFC',
                    borderColor: colors.border,
                    color: colors.textPrimary,
                  },
                ]}
                editable={!saving}
              />
            </View>

            {/* Special Instructions */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.primary }]}>Delivery Notes / Instructions</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Gate code, landmarks, special requests..."
                placeholderTextColor={colors.placeholder}
                multiline
                numberOfLines={3}
                style={[
                  styles.input,
                  styles.multilineInput,
                  {
                    backgroundColor: isDark ? colors.backgroundSecondary : '#F8FAFC',
                    borderColor: colors.border,
                    color: colors.textPrimary,
                  },
                ]}
                editable={!saving}
              />
            </View>

            {/* Price Summary */}
            <View style={[styles.priceSummaryBox, { backgroundColor: isDark ? colors.backgroundSecondary : '#F0F8FF', borderColor: colors.border }]}>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Subtotal</Text>
                <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>{formatPrice(calculatedSubtotal)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Delivery Fee</Text>
                <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>{formatPrice(deliveryFee)}</Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
              <View style={styles.summaryRow}>
                <Text style={[styles.totalLabel, { color: colors.textPrimary }]}>Estimated Total</Text>
                <Text style={[styles.totalValue, { color: colors.primary }]}>{formatPrice(calculatedTotal)}</Text>
              </View>
            </View>

            {/* Error Message */}
            {!!error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </ScrollView>

          {/* Footer Actions */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              onPress={onClose}
              disabled={saving}
              style={[styles.cancelBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={[styles.saveBtn, { backgroundColor: colors.primary }, saving && styles.btnDisabled]}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Save Changes</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = createPortalStyleSheet({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 31, 51, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    ...createShadow({
      color: '#0D47A1',
      elevation: 12,
      opacity: 0.2,
      radius: 16,
      offset: { width: 0, height: 8 },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  subTitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  closeText: {
    fontSize: 18,
    fontWeight: '600',
  },
  scrollArea: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  itemRowBorder: {
    borderTopWidth: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
  },
  itemPrice: {
    fontSize: 12,
    marginTop: 2,
  },
  qtyControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  qtyBtnText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  qtyText: {
    fontSize: 15,
    fontWeight: 'bold',
    minWidth: 24,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  multilineInput: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  priceSummaryBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 3,
  },
  summaryLabel: {
    fontSize: 13,
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  summaryDivider: {
    height: 1,
    marginVertical: 8,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  totalValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  errorText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 110,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
