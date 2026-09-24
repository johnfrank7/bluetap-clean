import React, { useEffect, useMemo, useState } from 'react';
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

import {
  decideOutsideRadiusOrder,
  dispatchManagerOrder,
  getManagerDispatch,
  getOutsideRadiusOrders,
} from '../../services/managerOrderApprovals';
import { subscribeProducts } from '../../services/products';
import { haversineDistanceKm } from '../../services/location';
import { useAdminTheme } from '../../components/AdminTheme';
import AdminIcon from '../../components/AdminIcon';
import TopToastFeedback from '../../components/TopToastFeedback';
import ManagerShell, { MANAGER_COLORS, ManagerPill } from '../../components/ManagerShell';



const formatAmount = (amount) => `₱${Number(amount || 0).toFixed(2)}`;

const EDITABLE_STATUSES = new Set([
  'awaiting_distributor_assignment',
  'distributor_assigned',
  'accepted',
  'scheduled',
]);

const orderProducts = (order) =>
  order.items?.map((item) => `${item.quantity} × ${item.productNameSnapshot}`).filter(Boolean).join(', ') || 'Order products';

const orderDistance = (order) =>
  order.distanceKmSnapshot == null ? 'Distance unavailable' : `Approx. ${Number(order.distanceKmSnapshot).toFixed(1)} km`;

function OutsideRadiusApprovalQueue({ styles, colors, onOrderApproved, onShowToast }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setOrders(await getOutsideRadiusOrders());
    } catch (loadFailure) {
      setError(loadFailure.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const decide = async (order, action) => {
    if (updatingId) return;
    setUpdatingId(order.id);
    setError('');
    try {
      await decideOutsideRadiusOrder(order.id, action);
      setOrders((current) => current.filter((item) => item.id !== order.id));
      if (action === 'approve') {
        onOrderApproved?.();
        onShowToast?.('Outside-radius order approved.', 'success');
      } else {
        onShowToast?.('Outside-radius order declined.', 'info');
      }
    } catch (updateFailure) {
      setError(updateFailure.message);
      onShowToast?.(updateFailure.message || 'Unable to update order.', 'error');
    } finally {
      setUpdatingId('');
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View>
          <Text style={styles.eyebrow}>DELIVERY EXCEPTIONS</Text>
          <Text style={styles.cardTitle}>Outside-Radius Approvals</Text>
          <Text style={styles.helperText}>
            Review delivery requests originating outside your branch's standard service radius.
          </Text>
        </View>
        <TouchableOpacity onPress={load} disabled={loading} style={styles.refreshButton}>
          <Text style={styles.refreshText}>{loading ? 'Loading…' : 'Refresh'}</Text>
        </TouchableOpacity>
      </View>

      {!!error && (
        <View accessibilityRole="alert" style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No outside-radius requests are waiting for approval.</Text>
        </View>
      ) : (
        orders.map((order) => {
          const isUpdating = updatingId === order.id;
          const products =
            order.items?.map((item) => `${item.quantity} × ${item.productNameSnapshot}`).filter(Boolean).join(', ') ||
            'Order products';

          return (
            <View key={order.id} style={styles.orderItem}>
              <View style={styles.orderHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.requesterName}>{order.requesterName || 'Requester'}</Text>
                  <Text style={styles.orderIdText}>#{order.requestId || order.id}</Text>
                </View>
                <ManagerPill tone="cyan">Approval Needed</ManagerPill>
              </View>

              <Text style={styles.productsSummary}>{products}</Text>

              <View style={styles.detailsBlock}>
                <Text style={styles.detailLine}>
                  Delivery: {order.address || (order.deliveryLocation ? `${order.deliveryLocation.latitude.toFixed(5)}, ${order.deliveryLocation.longitude.toFixed(5)}` : 'Location provided')}
                </Text>
                <Text style={styles.detailLine}>
                  Approx. {Number(order.distanceKmSnapshot || 0).toFixed(1)} km · Branch radius {order.serviceRadiusKmSnapshot} km
                </Text>
                <Text style={styles.amountText}>{formatAmount(order.totalAtOrder)}</Text>
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  disabled={isUpdating}
                  onPress={() => decide(order, 'approve')}
                  style={[styles.approveButton, isUpdating && styles.actionDisabled]}
                >
                  <Text style={styles.approveButtonText}>{isUpdating ? 'Saving…' : 'Approve Delivery'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={isUpdating}
                  onPress={() => decide(order, 'decline')}
                  style={[styles.declineButton, isUpdating && styles.actionDisabled]}
                >
                  <Text style={styles.declineButtonText}>Decline</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

function EditOrderModal({ visible, order, onClose, onSaveSuccess, colors, styles }) {
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState('');
  const [container, setContainer] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const isEditable = order && EDITABLE_STATUSES.has(order.status);

  useEffect(() => {
    const unsubscribe = subscribeProducts((prods) => {
      setCatalogProducts(prods || []);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (order) {
      setItems(
        (order.items || []).map((it) => ({
          productId: it.productId || it.product_id || it.id || '',
          productNameSnapshot: it.productNameSnapshot || it.product_name || 'Product',
          quantity: Number(it.quantity) || 1,
          unitPrice: Number(it.quantity) > 0 ? (Number(it.totalAtOrder || 0) / Number(it.quantity)) : 0,
        }))
      );
      setNotes(order.notes || order.specialInstructions || '');
      setContainer(order.container || '');
      setEditError('');
    }
  }, [order]);

  const updateQuantity = (index, delta) => {
    setItems((curr) =>
      curr.map((item, idx) => {
        if (idx !== index) return item;
        const newQty = Math.max(1, Math.min(100, item.quantity + delta));
        return { ...item, quantity: newQty };
      })
    );
  };

  const removeItem = (index) => {
    if (items.length <= 1) {
      setEditError('An order must have at least one product.');
      return;
    }
    setEditError('');
    setItems((curr) => curr.filter((_, idx) => idx !== index));
  };

  const addCatalogProduct = (product) => {
    setEditError('');
    setItems((curr) => {
      const existingIdx = curr.findIndex((it) => it.productId === product.id);
      if (existingIdx >= 0) {
        return curr.map((it, idx) => (idx === existingIdx ? { ...it, quantity: it.quantity + 1 } : it));
      }
      return [
        ...curr,
        {
          productId: product.id,
          productNameSnapshot: product.product_name,
          quantity: 1,
          unitPrice: Number(product.price) || 0,
        },
      ];
    });
  };

  const handleSave = async () => {
    if (!order || !isEditable) return;
    if (items.length === 0) {
      setEditError('Provide at least one order item.');
      return;
    }
    setSaving(true);
    setEditError('');
    try {
      await dispatchManagerOrder(order.id, 'edit-order', {
        items: items.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
        })),
        notes,
        container,
      });
      onSaveSuccess?.();
      onClose();
    } catch (err) {
      setEditError(err.message || 'Failed to update order.');
    } finally {
      setSaving(false);
    }
  };

  if (!order) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View accessibilityViewIsModal style={styles.editModalCard}>
          <View style={styles.modalHeaderRow}>
            <View>
              <Text style={styles.modalTitle}>Order Details & Situational Edit</Text>
              <Text style={styles.modalSub}>
                Order #{order.requestId || order.id} · {order.requesterName}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
              <Text style={styles.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            {!isEditable && (
              <View style={styles.lockedNotice}>
                <Text style={styles.lockedNoticeText}>
                  Order is {order.status?.replace(/_/g, ' ')}. Orders can only be edited before delivery begins.
                </Text>
              </View>
            )}

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>Ordered Items</Text>
              {items.map((item, index) => (
                <View key={`${item.productId}-${index}`} style={styles.itemEditRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemEditName}>{item.productNameSnapshot}</Text>
                    {item.unitPrice > 0 && (
                      <Text style={styles.itemEditPrice}>₱{item.unitPrice.toFixed(2)} each</Text>
                    )}
                  </View>

                  {isEditable ? (
                    <View style={styles.qtyControlRow}>
                      <TouchableOpacity onPress={() => updateQuantity(index, -1)} style={styles.qtyBtn}>
                        <Text style={styles.qtyBtnText}>-</Text>
                      </TouchableOpacity>
                      <Text style={styles.qtyText}>{item.quantity}</Text>
                      <TouchableOpacity onPress={() => updateQuantity(index, 1)} style={styles.qtyBtn}>
                        <Text style={styles.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                      {items.length > 1 && (
                        <TouchableOpacity onPress={() => removeItem(index)} style={styles.removeBtn}>
                          <Text style={styles.removeBtnText}>×</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : (
                    <Text style={styles.qtyText}>Qty: {item.quantity}</Text>
                  )}
                </View>
              ))}

              {isEditable && catalogProducts.length > 0 && (
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.subLabel}>Add product from branch catalog:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                    {catalogProducts.map((prod) => (
                      <TouchableOpacity
                        key={prod.id}
                        onPress={() => addCatalogProduct(prod)}
                        style={styles.addCatalogPill}
                      >
                        <Text style={styles.addCatalogPillText}>+ {prod.product_name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>Container & Packaging</Text>
              {isEditable ? (
                <TextInput
                  value={container}
                  onChangeText={setContainer}
                  placeholder="e.g. Slim 5-gallon container, Round dispenser"
                  placeholderTextColor={colors.placeholder}
                  style={styles.inputField}
                />
              ) : (
                <Text style={styles.readOnlyField}>{container || 'Standard container'}</Text>
              )}
            </View>

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>Special Instructions / Notes</Text>
              {isEditable ? (
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Delivery gate notes, timing instructions..."
                  placeholderTextColor={colors.placeholder}
                  multiline
                  style={[styles.inputField, { minHeight: 60 }]}
                />
              ) : (
                <Text style={styles.readOnlyField}>{notes || 'No special instructions'}</Text>
              )}
            </View>

            {!!editError && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{editError}</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.modalFooterRow}>
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Close</Text>
            </TouchableOpacity>

            {isEditable && (
              <TouchableOpacity
                disabled={saving}
                onPress={handleSave}
                style={[styles.saveBtn, saving && styles.actionDisabled]}
              >
                <Text style={styles.saveBtnText}>{saving ? 'Recalculating & Saving…' : 'Save Order Changes'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function BranchTransfersQueue({ data, styles, onRefresh, colors, onShowToast }) {
  const [updatingId, setUpdatingId] = useState('');
  const [decliningOrderId, setDecliningOrderId] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [error, setError] = useState('');

  const act = async (orderId, action, payload = {}) => {
    if (updatingId) return;
    setUpdatingId(orderId);
    setError('');
    try {
      await dispatchManagerOrder(orderId, action, payload);
      setDecliningOrderId('');
      setDeclineReason('');
      onRefresh?.();
      const isAccept = action === 'accept-transfer';
      onShowToast?.(
        isAccept ? 'Transfer request accepted.' : 'Transfer request declined.',
        isAccept ? 'success' : 'info'
      );
    } catch (err) {
      setError(err.message);
      onShowToast?.(err.message || 'Failed to update transfer.', 'error');
    } finally {
      setUpdatingId('');
    }
  };

  const incoming = data.incomingTransfers || [];
  const decisions = data.sourceDecisionEvents || [];

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View>
          <Text style={styles.eyebrow}>COORDINATION</Text>
          <Text style={styles.cardTitle}>Branch Transfer Reviews & Outcomes</Text>
          <Text style={styles.helperText}>
            Review inbound order transfer requests and review decisions for outbound transfers.
          </Text>
        </View>
      </View>

      {!!error && (
        <View accessibilityRole="alert" style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      {/* Incoming Transfers */}
      <Text style={[styles.subSectionTitle, { marginTop: 10 }]}>Incoming Transfer Requests ({incoming.length})</Text>
      {incoming.length === 0 ? (
        <Text style={styles.emptyInlineText}>No incoming transfer requests awaiting review.</Text>
      ) : (
        incoming.map((order) => {
          const isUpdating = updatingId === order.id;
          const isDeclining = decliningOrderId === order.id;

          return (
            <View key={order.id} style={styles.transferItem}>
              <Text style={styles.requesterName}>
                Transfer from {order.transferFromBranchName || 'another branch'}
              </Text>
              <Text style={styles.orderIdText}>
                #{order.requestId || order.id} · {order.requesterName || 'Requester'}
              </Text>
              <Text style={styles.productsSummary}>{orderProducts(order)}</Text>
              <Text style={styles.detailLine}>
                {orderDistance(order)} · Note: {order.transferReason || 'No note provided'}
              </Text>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  disabled={isUpdating}
                  onPress={() => act(order.id, 'accept-transfer')}
                  style={[styles.approveButton, isUpdating && styles.actionDisabled]}
                >
                  <Text style={styles.approveButtonText}>{isUpdating ? 'Saving…' : 'Accept Transfer'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={isUpdating}
                  onPress={() => setDecliningOrderId(isDeclining ? '' : order.id)}
                  style={styles.declineButton}
                >
                  <Text style={styles.declineButtonText}>Decline</Text>
                </TouchableOpacity>
              </View>

              {isDeclining && (
                <View style={styles.declineBox}>
                  <TextInput
                    value={declineReason}
                    onChangeText={setDeclineReason}
                    placeholder="Optional decline explanation"
                    placeholderTextColor={colors.placeholder}
                    multiline
                    style={styles.inputField}
                  />
                  <TouchableOpacity
                    disabled={isUpdating}
                    onPress={() => act(order.id, 'decline-transfer', { transferDeclineReason: declineReason })}
                    style={styles.confirmDeclineBtn}
                  >
                    <Text style={styles.confirmDeclineText}>Confirm Decline</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })
      )}

      {/* Decision Events */}
      <Text style={[styles.subSectionTitle, { marginTop: 18 }]}>Transfer decisions ({decisions.length})</Text>
      {decisions.length === 0 ? (
        <Text style={styles.emptyInlineText}>No transfer decision events recorded yet.</Text>
      ) : (
        decisions.map((event) => {
          const accepted = event.decision === 'accepted';
          return (
            <View key={event.id} style={styles.decisionItem}>
              <ManagerPill tone={accepted ? 'green' : 'red'}>{accepted ? 'Accepted' : 'Declined'}</ManagerPill>
              <Text style={styles.decisionText}>
                {event.targetBranchName || 'Target branch'} {accepted ? 'accepted' : 'declined'} the transfer of Order #
                {event.requestId || 'order'}.
              </Text>
              {!accepted && !!event.declineReason && (
                <Text style={styles.declineReasonText}>Reason: {event.declineReason}</Text>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

function BranchOrdersOverview({ data, styles, onRefresh, colors, onShowToast }) {
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [filter, setFilter] = useState('');

  const orders = useMemo(() => {
    const all = data.orders || [];
    if (!filter.trim()) return all;
    const term = filter.trim().toLowerCase();
    return all.filter(
      (o) =>
        (o.requesterName && o.requesterName.toLowerCase().includes(term)) ||
        (o.requestId && o.requestId.toLowerCase().includes(term)) ||
        (o.address && o.address.toLowerCase().includes(term))
    );
  }, [data.orders, filter]);

  const openOrder = (order) => {
    setSelectedOrder(order);
    setModalVisible(true);
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View>
          <Text style={styles.eyebrow}>BRANCH MANAGEMENT</Text>
          <Text style={styles.cardTitle}>Branch Orders & Situational Edits</Text>
          <Text style={styles.helperText}>
            View full order details and make pre-delivery adjustments to items, quantities, and instructions.
          </Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshButton}>
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchBarWrap}>
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter orders by requester, ID, address..."
          placeholderTextColor={colors.placeholder}
          style={styles.searchInput}
        />
      </View>

      {orders.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No branch orders found.</Text>
        </View>
      ) : (
        orders.map((order) => {
          const isEditable = EDITABLE_STATUSES.has(order.status);
          return (
            <View key={order.id} style={styles.orderItem}>
              <View style={styles.orderHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.requesterName}>{order.requesterName || 'Requester'}</Text>
                  <Text style={styles.orderIdText}>#{order.requestId || order.id}</Text>
                </View>
                <ManagerPill tone={isEditable ? 'blue' : 'green'}>{order.status?.replace(/_/g, ' ')}</ManagerPill>
              </View>

              <Text style={styles.productsSummary}>{orderProducts(order)}</Text>
              <Text style={styles.detailLine}>Delivery: {order.address || 'Address provided'}</Text>
              <Text style={styles.amountText}>{formatAmount(order.totalAtOrder)}</Text>

              <View style={styles.actionRow}>
                <TouchableOpacity onPress={() => openOrder(order)} style={styles.editOrderBtn}>
                  <Text style={styles.editOrderBtnText}>
                    {isEditable ? 'Edit Order Details' : 'View Order Details'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}

      <EditOrderModal
        visible={modalVisible}
        order={selectedOrder}
        onClose={() => setModalVisible(false)}
        onSaveSuccess={() => {
          onRefresh?.();
          onShowToast?.('Order details updated successfully.', 'success');
        }}
        colors={colors}
        styles={styles}
      />
    </View>
  );
}

export default function ManagerRequestPage() {
  const { colors } = useAdminTheme();
  const styles = createStyles(colors);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'success' });

  const [dispatchData, setDispatchData] = useState({
    orders: [],
    incomingTransfers: [],
    sourceDecisionEvents: [],
  });

  const loadDispatch = async () => {
    try {
      const res = await getManagerDispatch();
      setDispatchData(res);
    } catch (e) {
      console.log('Dispatch error:', e.message);
    }
  };

  useEffect(() => {
    loadDispatch();
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ visible: true, message, type });
  };

  return (
    <ManagerShell
      active="requests"
      title="Requests & Exceptions"
      subtitle="Delivery approvals, branch transfers, and order adjustments"
    >
      <TopToastFeedback
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast((t) => ({ ...t, visible: false }))}
      />
      {/* 1. Outside Radius Approvals */}
      <OutsideRadiusApprovalQueue styles={styles} colors={colors} onOrderApproved={loadDispatch} onShowToast={showToast} />

      {/* 2. Branch Transfers Queue */}
      <BranchTransfersQueue data={dispatchData} styles={styles} onRefresh={loadDispatch} colors={colors} onShowToast={showToast} />

      {/* 3. Branch Orders Overview & Situational Order Edit */}
      <BranchOrdersOverview data={dispatchData} styles={styles} onRefresh={loadDispatch} colors={colors} onShowToast={showToast} />
    </ManagerShell>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 20,
      marginBottom: 20,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 14,
    },
    eyebrow: {
      color: colors.primary,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.8,
    },
    cardTitle: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: 'bold',
      marginTop: 2,
    },
    helperText: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 4,
    },
    subSectionTitle: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
      marginBottom: 8,
    },
    refreshButton: {
      minHeight: 36,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    refreshText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '800',
    },
    errorBanner: {
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: 8,
      padding: 10,
      marginBottom: 12,
    },
    errorBannerText: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '700',
    },
    emptyContainer: {
      minHeight: 80,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    emptyInlineText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontStyle: 'italic',
      marginBottom: 10,
    },
    orderItem: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 14,
      marginTop: 12,
    },
    orderHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
    },
    requesterName: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '800',
    },
    orderIdText: {
      color: colors.textSecondary,
      fontSize: 11,
      marginTop: 2,
    },
    productsSummary: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
      marginTop: 6,
    },
    detailsBlock: {
      gap: 3,
      marginTop: 6,
    },
    detailLine: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
    amountText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '900',
      marginTop: 2,
    },
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10,
    },
    approveButton: {
      minHeight: 36,
      paddingHorizontal: 14,
      borderRadius: 8,
      backgroundColor: colors.success,
      alignItems: 'center',
      justifyContent: 'center',
    },
    approveButtonText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '800',
    },
    declineButton: {
      minHeight: 36,
      paddingHorizontal: 14,
      borderRadius: 8,
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: colors.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    declineButtonText: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '800',
    },
    editOrderBtn: {
      minHeight: 36,
      paddingHorizontal: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    editOrderBtnText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '800',
    },
    actionDisabled: {
      opacity: 0.6,
    },
    transferItem: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 12,
      marginTop: 10,
    },
    declineBox: {
      marginTop: 8,
      gap: 6,
    },
    confirmDeclineBtn: {
      alignSelf: 'flex-start',
      minHeight: 36,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: colors.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmDeclineText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '800',
    },
    decisionItem: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 10,
      marginTop: 8,
    },
    decisionText: {
      color: colors.textPrimary,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 4,
    },
    declineReasonText: {
      color: colors.danger,
      fontSize: 11,
      marginTop: 2,
    },
    searchBarWrap: {
      marginBottom: 12,
    },
    searchBarWrapCompact: {
      width: 200,
    },
    searchInput: {
      height: 38,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: 10,
      color: colors.textPrimary,
      fontSize: 12,
      outlineStyle: 'none',
    },
    tableScroll: { flexGrow: 1 },
    table: { minWidth: 980, flexGrow: 1 },
    tableRow: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tableHeadRow: { minHeight: 38 },
    th: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: 'bold',
    },
    td: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    tdName: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: 'bold',
    },
    tdLink: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '600',
    },
    nameCol: { flex: 1.35 },
    idCol: { flex: 1 },
    contactCol: { flex: 1 },
    emailCol: { flex: 1.65 },
    barangayCol: { flex: 1 },
    roleCol: { flex: 0.9 },
    actionsCol: { flex: 1.15, textAlign: 'right' },
    roleCell: { alignItems: 'flex-start' },
    actionButtons: { flexDirection: 'row', justifyContent: 'flex-end' },
    noActionText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    errorText: {
      color: colors.danger,
      fontSize: 12,
      marginTop: 8,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: colors.overlay || 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    editModalCard: {
      width: '100%',
      maxWidth: 520,
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 20,
    },
    modalHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 14,
    },
    modalTitle: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '800',
    },
    modalSub: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    modalCloseBtn: {
      padding: 4,
    },
    modalCloseText: {
      color: colors.textSecondary,
      fontSize: 22,
      fontWeight: 'bold',
    },
    lockedNotice: {
      backgroundColor: colors.neutral,
      padding: 10,
      borderRadius: 8,
      marginBottom: 12,
    },
    lockedNoticeText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    modalSection: {
      marginBottom: 14,
    },
    modalSectionTitle: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
      marginBottom: 6,
    },
    itemEditRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    itemEditName: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
    itemEditPrice: {
      color: colors.textSecondary,
      fontSize: 11,
      marginTop: 2,
    },
    qtyControlRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    qtyBtn: {
      width: 28,
      height: 28,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    qtyBtnText: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '800',
    },
    qtyText: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
      minWidth: 20,
      textAlign: 'center',
    },
    removeBtn: {
      width: 26,
      height: 26,
      borderRadius: 6,
      backgroundColor: colors.dangerSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 4,
    },
    removeBtnText: {
      color: colors.danger,
      fontSize: 14,
      fontWeight: 'bold',
    },
    subLabel: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '600',
    },
    addCatalogPill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
      marginRight: 6,
    },
    addCatalogPillText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '700',
    },
    inputField: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.surfaceAlt,
      color: colors.textPrimary,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 12,
      outlineStyle: 'none',
    },
    readOnlyField: {
      color: colors.textSecondary,
      fontSize: 13,
      fontStyle: 'italic',
    },
    modalFooterRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 12,
    },
    cancelBtn: {
      minHeight: 38,
      paddingHorizontal: 16,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelBtnText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '700',
    },
    saveBtn: {
      minHeight: 38,
      paddingHorizontal: 16,
      borderRadius: 8,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    saveBtnText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '800',
    },
  });
