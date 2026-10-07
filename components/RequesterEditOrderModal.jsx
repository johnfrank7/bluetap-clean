import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { createPortalStyleSheet, useBlueTapTheme } from './BlueTapTheme';
import { createShadow } from './shadowStyles';
import { updateRequest } from '../services/requests';
import useUnsavedChangesGuard from './useUnsavedChangesGuard';

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
  const { width, height } = useWindowDimensions();
  const [items, setItems] = useState([]);
  const [container, setContainer] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const initialSnapshotRef = React.useRef(null);

  useEffect(() => {
    if (!request || !visible) return;

    setError('');
    const initContainer = request.container || '';
    const initNotes = request.notes || request.specialInstructions || '';
    setContainer(initContainer);
    setNotes(initNotes);

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

    const mappedItems = rawItems.map((item, idx) => ({
      id: item.product_id || item.productId || `item-${idx}`,
      productId: item.product_id || item.productId || '',
      name: item.product_name || item.productName || item.productNameSnapshot || 'Water',
      unitPrice: Number(item.product_price ?? item.price ?? item.unitPriceAtOrder ?? item.unitPrice ?? 0),
      quantity: Math.max(1, Number(item.quantity || 1)),
    }));

    setItems(mappedItems);
    initialSnapshotRef.current = {
      container: initContainer.trim(),
      notes: initNotes.trim(),
      items: mappedItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    };
  }, [request, visible]);

  const isDirty = React.useMemo(() => {
    if (!visible || !request || !initialSnapshotRef.current) return false;
    const snap = initialSnapshotRef.current;
    if (container.trim() !== snap.container) return true;
    if (notes.trim() !== snap.notes) return true;
    if (items.length !== snap.items.length) return true;
    return items.some((item, idx) => {
      const orig = snap.items[idx];
      return !orig || item.productId !== orig.productId || item.quantity !== orig.quantity;
    });
  }, [visible, request, container, notes, items]);

  const { confirmLeave, UnsavedModal } = useUnsavedChangesGuard({
    isDirty,
    isSubmitting: saving,
    onDiscard: onClose,
  });

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

  const isNarrowScreen = width < 360;
  const modalMaxHeight = Math.min(Math.max(320, height - (width < 440 ? 24 : 48)), 720);

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={saving ? undefined : () => confirmLeave(onClose)}
        statusBarTranslucent
      >
        <View style={styles.rootOverlay}>
          {/* Backdrop: dim only, separate from modal surface */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close modal backdrop"
            style={[
              styles.backdrop,
              { backgroundColor: isDark ? 'rgba(2, 10, 18, 0.72)' : 'rgba(8, 31, 51, 0.55)' },
            ]}
            onPress={saving ? undefined : () => confirmLeave(onClose)}
          />

          {/* Modal Surface: solid, fully opaque, theme-aware */}
          <View
            accessibilityViewIsModal
            style={[
              styles.modalCard,
              {
                backgroundColor: isDark ? colors.surface : '#FFFFFF',
                borderColor: colors.border,
                maxHeight: modalMaxHeight,
              },
            ]}
          >
            {/* Header: fixed/stable solid surface */}
            <View
              style={[
                styles.header,
                {
                  backgroundColor: isDark ? colors.surface : '#FFFFFF',
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <View style={styles.headerTitleWrap}>
                <Text style={[styles.title, { color: colors.primary }]}>
                  Edit Pending Order
                </Text>
                <Text style={[styles.subTitle, { color: colors.textSecondary }]}>
                  Order #{request.request_id || request.requestId || request.id}
                </Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => confirmLeave(onClose)}
                disabled={saving}
                style={styles.closeBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.closeText, { color: colors.textSecondary }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Scrollable Body: solid surface */}
            <ScrollView
              style={[styles.scrollArea, { backgroundColor: isDark ? colors.surface : '#FFFFFF' }]}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {/* Ordered Products Section */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.primary }]}>
                  Ordered Products
                </Text>
                {items.map((item, idx) => (
                  <View
                    key={item.id}
                    style={[
                      styles.itemCard,
                      {
                        backgroundColor: isDark ? colors.surfaceAlt : '#F8FAFC',
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.itemInfo}>
                      <Text
                        style={[styles.itemName, { color: colors.textPrimary }]}
                        numberOfLines={2}
                      >
                        {item.name}
                      </Text>
                      <Text style={[styles.itemPrice, { color: colors.textSecondary }]}>
                        {formatPrice(item.unitPrice)} each
                      </Text>
                    </View>

                    <View style={styles.qtyControlRow}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Decrease quantity of ${item.name}`}
                        onPress={() => updateQuantity(idx, -1)}
                        style={[
                          styles.qtyBtn,
                          {
                            borderColor: colors.border,
                            backgroundColor: isDark ? colors.surface : '#FFFFFF',
                          },
                        ]}
                        disabled={saving || item.quantity <= 1}
                      >
                        <Text
                          style={[
                            styles.qtyBtnText,
                            {
                              color:
                                item.quantity <= 1
                                  ? (isDark ? colors.disabled : '#94A3B8')
                                  : colors.primary,
                            },
                          ]}
                        >
                          −
                        </Text>
                      </TouchableOpacity>
                      <Text style={[styles.qtyText, { color: colors.textPrimary }]}>
                        {item.quantity}
                      </Text>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Increase quantity of ${item.name}`}
                        onPress={() => updateQuantity(idx, 1)}
                        style={[
                          styles.qtyBtn,
                          {
                            borderColor: colors.border,
                            backgroundColor: isDark ? colors.surface : '#FFFFFF',
                          },
                        ]}
                        disabled={saving || item.quantity >= 100}
                      >
                        <Text
                          style={[
                            styles.qtyBtnText,
                            {
                              color:
                                item.quantity >= 100
                                  ? (isDark ? colors.disabled : '#94A3B8')
                                  : colors.primary,
                            },
                          ]}
                        >
                          +
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>

              {/* Container Type */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.primary }]}>
                  Container Type
                </Text>
                <TextInput
                  value={container}
                  onChangeText={setContainer}
                  placeholder="e.g. Slim 5-gal, Round Dispenser"
                  placeholderTextColor={isDark ? colors.muted : '#94A3B8'}
                  style={[
                    styles.input,
                    {
                      backgroundColor: isDark ? colors.input : '#F8FAFC',
                      borderColor: colors.border,
                      color: colors.textPrimary,
                    },
                  ]}
                  editable={!saving}
                />
              </View>

              {/* Delivery Notes / Instructions */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.primary }]}>
                  Delivery Notes / Instructions
                </Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Gate code, landmarks, special requests..."
                  placeholderTextColor={isDark ? colors.muted : '#94A3B8'}
                  multiline
                  numberOfLines={3}
                  style={[
                    styles.input,
                    styles.multilineInput,
                    {
                      backgroundColor: isDark ? colors.input : '#F8FAFC',
                      borderColor: colors.border,
                      color: colors.textPrimary,
                    },
                  ]}
                  editable={!saving}
                />
              </View>

              {/* Price Summary */}
              <View
                style={[
                  styles.priceSummaryBox,
                  {
                    backgroundColor: isDark ? colors.surfaceAlt : '#F0F8FF',
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                    Subtotal
                  </Text>
                  <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>
                    {formatPrice(calculatedSubtotal)}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                    Delivery Fee
                  </Text>
                  <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>
                    {formatPrice(deliveryFee)}
                  </Text>
                </View>
                <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
                <View style={styles.summaryRow}>
                  <Text style={[styles.totalLabel, { color: colors.textPrimary }]}>
                    Estimated Total
                  </Text>
                  <Text style={[styles.totalValue, { color: colors.primary }]}>
                    {formatPrice(calculatedTotal)}
                  </Text>
                </View>
              </View>

              {/* Error Message */}
              {!!error && (
                <View
                  style={[
                    styles.errorBox,
                    {
                      backgroundColor: isDark ? colors.dangerSoft : '#FEE2E2',
                      borderColor: colors.danger,
                    },
                  ]}
                >
                  <Text style={[styles.errorText, { color: isDark ? '#FCA5A5' : '#DC2626' }]}>
                    {error}
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* Footer Actions: fixed/stable solid surface */}
            <View
              style={[
                styles.footer,
                isNarrowScreen && styles.footerStacked,
                {
                  backgroundColor: isDark ? colors.surface : '#FFFFFF',
                  borderTopColor: colors.border,
                },
              ]}
            >
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Cancel editing order"
                onPress={() => confirmLeave(onClose)}
                disabled={saving}
                style={[
                  styles.cancelBtn,
                  isNarrowScreen && styles.btnFullWidth,
                  {
                    borderColor: colors.border,
                    backgroundColor: isDark ? colors.surfaceAlt : '#F8FAFC',
                  },
                ]}
              >
                <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Save order changes"
                onPress={handleSave}
                disabled={saving}
                style={[
                  styles.saveBtn,
                  isNarrowScreen && styles.btnFullWidth,
                  { backgroundColor: colors.primaryAction },
                  saving && styles.btnDisabled,
                ]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.saveBtnText, { color: colors.onPrimary }]}>
                    Save Changes
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <UnsavedModal />
    </>
  );
}

const styles = createPortalStyleSheet({
  rootOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 24,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  modalCard: {
    position: 'relative',
    zIndex: 2,
    width: '100%',
    maxWidth: 440,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    ...createShadow({
      color: '#07131F',
      elevation: 20,
      opacity: 0.22,
      radius: 20,
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
    borderBottomWidth: 1,
    backgroundColor: '#FFFFFF',
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
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
    minHeight: 36,
    minWidth: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 18,
    fontWeight: '600',
  },
  scrollArea: {
    flexGrow: 0,
    flexShrink: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    gap: 12,
  },
  itemInfo: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  itemPrice: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 3,
  },
  qtyControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 8,
  },
  qtyBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  qtyBtnText: {
    fontSize: 18,
    fontWeight: 'bold',
    lineHeight: 20,
  },
  qtyText: {
    fontSize: 15,
    fontWeight: 'bold',
    minWidth: 26,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 13,
  },
  multilineInput: {
    minHeight: 64,
    maxHeight: 96,
    textAlignVertical: 'top',
    paddingTop: 10,
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
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
  },
  errorText: {
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
    backgroundColor: '#FFFFFF',
  },
  footerStacked: {
    flexDirection: 'column-reverse',
    gap: 10,
  },
  cancelBtn: {
    minHeight: 44,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    minHeight: 44,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  btnFullWidth: {
    width: '100%',
    minWidth: '100%',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
