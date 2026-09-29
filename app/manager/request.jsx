import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  decideOutsideRadiusOrder,
  dispatchManagerOrder,
} from '../../services/managerOrderApprovals';
import { subscribeProducts } from '../../services/products';
import { haversineDistanceKm } from '../../services/location';
import { useAdminTheme } from '../../components/AdminTheme';
import AdminIcon from '../../components/AdminIcon';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import TopToastFeedback from '../../components/TopToastFeedback';
import ManagerShell, { MANAGER_COLORS, ManagerPill } from '../../components/ManagerShell';
import { useManagerRealtimeData } from '../../components/ManagerRealtimeData';
import { parseTimestamp } from '../../services/notificationTimestamp';
const { getManagerQueues, toManagerOrder } = require('../../services/managerOperational');



const formatAmount = (amount) => `₱${Number(amount || 0).toFixed(2)}`;
const approvalLabel = (order = {}) => {
  const reasons = Array.isArray(order.approvalReasons) ? order.approvalReasons : [];
  if (reasons.includes('NON_STANDARD_DELIVERY_DAY')) return 'Delivery Day Review';
  if (reasons.includes('PRODUCT_LIMIT_EXCEEDED')) return 'High Quantity';
  return 'Outside Radius';
};

const EDITABLE_STATUSES = new Set([
  'awaiting_distributor_assignment',
  'distributor_assigned',
  'accepted',
  'scheduled',
]);

const scheduleLabel = (value) => {
  const date = parseTimestamp(value);
  return date ? date.toLocaleString() : '';
};

const orderProducts = (order) =>
  order.items?.map((item) => `${item.quantity} × ${item.productNameSnapshot}`).filter(Boolean).join(', ') || 'Order products';

const orderDistance = (order) =>
  order.distanceKmSnapshot == null ? 'Distance unavailable' : `Approx. ${Number(order.distanceKmSnapshot).toFixed(1)} km`;

function OutsideRadiusApprovalQueue({ orders, loading, styles, colors, isDark, onShowToast }) {
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState('');

  const decide = async (order, action) => {
    if (updatingId) return;
    setUpdatingId(order.id);
    setError('');
    try {
      await decideOutsideRadiusOrder(order.id, action);
      if (action === 'approve') {
        onShowToast?.('Order exception approved.', 'success');
      } else {
        onShowToast?.('Order exception declined.', 'info');
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
          <Text style={styles.cardTitle}>Order Approvals</Text>
          <Text style={styles.helperText}>
            Review delivery requests outside your branch radius or above a product order limit.
          </Text>
        </View>
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
        <BlueTapEmptyState
          compact
          variant="exceptions"
          title="No Delivery Exceptions"
          description="Orders that need branch approval will appear here."
          themeColors={colors}
          dark={isDark}
          style={styles.visualEmpty}
        />
      ) : (
        <ScrollView nestedScrollEnabled style={styles.sectionScroll} contentContainerStyle={styles.sectionContent}>
        {orders.map((order) => {
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
                <ManagerPill tone="cyan">{approvalLabel(order)}</ManagerPill>
              </View>

              <Text style={styles.productsSummary}>{products}</Text>

              <View style={styles.detailsBlock}>
                <Text style={styles.detailLine}>
                  Delivery: {order.address || (order.deliveryLocation ? `${order.deliveryLocation.latitude.toFixed(5)}, ${order.deliveryLocation.longitude.toFixed(5)}` : 'Location provided')}
                </Text>
                {order.outsideServiceArea && <Text style={styles.detailLine}>
                  Approx. {Number(order.distanceKmSnapshot || 0).toFixed(1)} km · Branch radius {order.serviceRadiusKmSnapshot} km
                </Text>}
                {(order.productLimitViolations || []).map((item) => <Text key={item.productId} style={styles.detailLine}>
                  {item.productNameSnapshot}: requested {item.requestedQuantity} · limit {item.configuredLimit}. Order exceeds the configured requester product limit.
                </Text>)}
                {order.approvalReasons?.includes('NON_STANDARD_DELIVERY_DAY') && <Text style={styles.detailLine}>The requested date falls outside the effective product delivery weekdays and requires Manager review.</Text>}
                {!!order.requesterUniqueId && <Text style={styles.detailLine}>Requester UID: {order.requesterUniqueId}</Text>}
                <Text style={styles.amountText}>{formatAmount(order.totalAtOrder)}</Text>
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  disabled={isUpdating}
                  onPress={() => decide(order, 'approve')}
                  style={[styles.approveButton, isUpdating && styles.actionDisabled]}
                >
                  <Text style={styles.approveButtonText}>{isUpdating ? 'Saving…' : 'Approve'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={isUpdating}
                  onPress={() => decide(order, 'decline')}
                  style={[styles.declineButton, isUpdating && styles.actionDisabled]}
                >
                  <Text style={styles.declineButtonText}>Reject</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        </ScrollView>
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
        (order.items || []).map((it) => {
          const found = catalogProducts.find(
            (p) => p.product_name && it.productNameSnapshot && p.product_name.toLowerCase() === it.productNameSnapshot.toLowerCase()
          );
          return {
            productId: it.productId || it.product_id || it.id || found?.id || '',
            productNameSnapshot: it.productNameSnapshot || it.product_name || 'Product',
            quantity: Number(it.quantity) || 1,
            unitPrice: Number(it.quantity) > 0 ? (Number(it.totalAtOrder || 0) / Number(it.quantity)) : 0,
          };
        })
      );
      setNotes(order.notes || order.specialInstructions || '');
      setContainer(order.container || '');
      setEditError('');
    }
  }, [order, catalogProducts]);

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

function BranchTransfersQueue({ data, styles, colors, isDark, onShowToast }) {
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

      <ScrollView nestedScrollEnabled style={styles.sectionScroll} contentContainerStyle={styles.sectionContent}>
      {/* Incoming Transfers */}
      <Text style={[styles.subSectionTitle, { marginTop: 10 }]}>Incoming Transfer Requests ({incoming.length})</Text>
      {incoming.length === 0 ? (
        <BlueTapEmptyState
          compact
          variant="coordination"
          title="No Transfer Requests"
          description="Incoming branch transfer requests will appear here for review."
          themeColors={colors}
          dark={isDark}
          style={styles.inlineVisualEmpty}
        />
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
        <BlueTapEmptyState
          compact
          variant="coordination"
          title="No Transfer Updates"
          description="Accepted or declined outbound transfer decisions will appear here."
          themeColors={colors}
          dark={isDark}
          style={styles.inlineVisualEmpty}
        />
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
              {!!scheduleLabel(event.decidedAt) && <Text style={styles.detailLine}>{scheduleLabel(event.decidedAt)}</Text>}
              {!accepted && !!event.declineReason && (
                <Text style={styles.declineReasonText}>Reason: {event.declineReason}</Text>
              )}
            </View>
          );
        })
      )}
      </ScrollView>
    </View>
  );
}

function ReceivedRequestsQueue({ orders, loading, styles, colors, isDark, onShowToast }) {
  const [updatingId, setUpdatingId] = useState('');
  const [rejectingId, setRejectingId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const decide = async (order, action) => {
    if (updatingId) return;
    if (action === 'reject-order' && !reason.trim()) {
      setError('Add a reason for rejecting this order.');
      return;
    }
    setUpdatingId(order.id);
    setError('');
    try {
      await dispatchManagerOrder(order.id, action, action === 'reject-order' ? { rejectionReason: reason.trim() } : {});
      setRejectingId('');
      setReason('');
      onShowToast?.(action === 'accept-order' ? 'Order accepted for dispatch.' : 'Order rejected.', action === 'accept-order' ? 'success' : 'info');
    } catch (failure) {
      setError(failure.message || 'Unable to review order.');
      onShowToast?.(failure.message || 'Unable to review order.', 'error');
    } finally {
      setUpdatingId('');
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>UPCOMING / NORMAL ORDERS</Text>
          <Text style={styles.cardTitle}>Upcoming & Active Branch Orders ({orders.length})</Text>
          <Text style={styles.helperText}>Accept a branch order for dispatch or reject it with a reason.</Text>
        </View>
      </View>
      {!!error && <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorBannerText}>{error}</Text></View>}
      {loading ? <View style={styles.emptyContainer}><ActivityIndicator color={colors.primary} /></View> : orders.length === 0 ? (
        <BlueTapEmptyState
          compact
          variant="orders"
          title="No Orders Awaiting Review"
          description="New branch orders will appear here when they need your review."
          themeColors={colors}
          dark={isDark}
          style={styles.visualEmpty}
        />
      ) : (
        <ScrollView nestedScrollEnabled style={styles.sectionScroll} contentContainerStyle={styles.sectionContent}>
          {orders.map((order) => <View key={order.id} style={styles.orderItem}>
            <View style={styles.orderHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.requesterName}>{order.requesterName || 'Requester'}</Text>
                <Text style={styles.orderIdText}>#{order.requestId || order.id}</Text>
              </View>
              <ManagerPill tone="blue">Pending review</ManagerPill>
            </View>
            <Text style={styles.productsSummary}>{orderProducts(order)}</Text>
            <Text style={styles.detailLine}>Delivery: {order.address || 'Address provided'}</Text>
            <Text style={styles.detailLine}>Distance: {orderDistance(order)}</Text>
            <Text style={styles.amountText}>{formatAmount(order.totalAtOrder)}</Text>
            <View style={styles.actionRow}>
              <TouchableOpacity disabled={!!updatingId} onPress={() => decide(order, 'accept-order')} style={[styles.approveButton, !!updatingId && styles.actionDisabled]}>
                <Text style={styles.approveButtonText}>{updatingId === order.id ? 'Saving?' : 'Accept'}</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={!!updatingId} onPress={() => { setRejectingId(rejectingId === order.id ? '' : order.id); setReason(''); setError(''); }} style={styles.declineButton}>
                <Text style={styles.declineButtonText}>Reject</Text>
              </TouchableOpacity>
            </View>
            {rejectingId === order.id && <View style={styles.declineBox}>
              <TextInput value={reason} onChangeText={setReason} maxLength={240} multiline placeholder="Reason shown to the requester" placeholderTextColor={colors.placeholder} style={styles.inputField} />
              <TouchableOpacity disabled={!!updatingId} onPress={() => decide(order, 'reject-order')} style={styles.confirmDeclineBtn}>
                <Text style={styles.confirmDeclineText}>Confirm Rejection</Text>
              </TouchableOpacity>
            </View>}
          </View>)}
        </ScrollView>
      )}
    </View>
  );
}

function BranchOrdersOverview({ data, loading, styles, colors, isDark, onOpenOrder }) {
  const [filter, setFilter] = useState('');

  const orders = useMemo(() => {
    const all = (data.orders || []).filter((order) => EDITABLE_STATUSES.has(order.status));
    if (!filter.trim()) return all;
    const term = filter.trim().toLowerCase();
    return all.filter(
      (o) =>
        (o.requesterName && o.requesterName.toLowerCase().includes(term)) ||
        (o.requestId && o.requestId.toLowerCase().includes(term)) ||
        (o.address && o.address.toLowerCase().includes(term))
    );
  }, [data.orders, filter]);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View>
          <Text style={styles.eyebrow}>BRANCH MANAGEMENT</Text>
          <Text style={styles.cardTitle}>Branch Orders & Situational Edits</Text>
          <Text style={styles.helperText}>
            Review active branch orders and make eligible pre-delivery adjustments.
          </Text>
        </View>
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

      {loading ? <View style={styles.emptyContainer}><ActivityIndicator color={colors.primary} /></View> : orders.length === 0 ? (
        <BlueTapEmptyState
          compact
          variant="management"
          title="No Active Branch Orders"
          description="Orders eligible for review or pre-delivery adjustment will appear here."
          themeColors={colors}
          dark={isDark}
          style={styles.visualEmpty}
        />
      ) : (
        <ScrollView nestedScrollEnabled style={styles.sectionScroll} contentContainerStyle={styles.sectionContent}>
        {orders.map((order) => {
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
                <TouchableOpacity onPress={() => onOpenOrder(order)} style={styles.editOrderBtn}>
                  <Text style={styles.editOrderBtnText}>
                    {isEditable ? 'Edit Order Details' : 'View Order Details'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        </ScrollView>
      )}
    </View>
  );
}

export default function ManagerRequestPage() {
  const { colors, resolvedTheme } = useAdminTheme();
  const { width } = useWindowDimensions();
  const styles = createStyles(colors, width);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'success' });
  const [selectedOrderSnapshot, setSelectedOrder] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const realtime = useManagerRealtimeData();
  const dispatchData = useMemo(() => {
    const queues = getManagerQueues(realtime.requests, realtime.incomingTransfers, realtime.branchId);
    const mapOrder = (order) => toManagerOrder(order.id, order, realtime.branch?.name || '');
    return {
      orders: queues.editable.map(mapOrder),
      review: queues.review.map(mapOrder),
      exceptions: queues.exceptions.map(mapOrder),
      incomingTransfers: queues.incomingTransfers.map(mapOrder),
      sourceDecisionEvents: realtime.sourceDecisionEvents.map((event) => ({
        ...event,
        requestId: event.requestIdSnapshot || event.requestId,
        targetBranchName: event.targetBranchNameSnapshot || event.targetBranchName,
      })),
    };
  }, [realtime]);
  const selectedOrder = useMemo(() => {
    if (!selectedOrderSnapshot) return null;
    const live = realtime.requests.find((order) => String(order.id || order.requestId) === String(selectedOrderSnapshot.id || selectedOrderSnapshot.requestId));
    return live ? toManagerOrder(live.id, live, realtime.branch?.name || '') : selectedOrderSnapshot;
  }, [realtime.branch?.name, realtime.requests, selectedOrderSnapshot]);

  const showToast = (message, type = 'success') => {
    setToast({ visible: true, message, type });
  };

  const handleOpenOrder = (order) => {
    setSelectedOrder(order);
    setModalVisible(true);
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
      {/* 1. Received Requests */}
      <ReceivedRequestsQueue
        orders={dispatchData.review}
        loading={realtime.loading}
        styles={styles}
        colors={colors}
        isDark={resolvedTheme === 'dark'}
        onShowToast={showToast}
      />

      {/* 2. Outside Radius Approvals */}
      <OutsideRadiusApprovalQueue orders={dispatchData.exceptions} loading={realtime.loading} styles={styles} colors={colors} isDark={resolvedTheme === 'dark'} onShowToast={showToast} />

      {/* 3. Branch Orders Overview & Situational Order Edit */}
      <BranchOrdersOverview data={dispatchData} loading={realtime.loading} styles={styles} colors={colors} isDark={resolvedTheme === 'dark'} onOpenOrder={handleOpenOrder} />

      {/* 4. Branch Transfers Queue */}
      <BranchTransfersQueue data={dispatchData} styles={styles} colors={colors} isDark={resolvedTheme === 'dark'} onShowToast={showToast} />

      {/* Shared Order Details, Items Edit, and Distributor Assignment Modal */}
      <EditOrderModal
        visible={modalVisible}
        order={selectedOrder}
        onClose={() => setModalVisible(false)}
        onSaveSuccess={() => {}}
        colors={colors}
        styles={styles}
      />
    </ManagerShell>
  );
}

const createStyles = (colors, width = 1200) =>
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
    visualEmpty: {
      width: '100%',
      minHeight: 150,
      marginVertical: 0,
    },
    inlineVisualEmpty: {
      width: '100%',
      minHeight: 130,
      marginVertical: 4,
    },
    sectionScroll: { maxHeight: 440 },
    sectionContent: { paddingBottom: 4 },
    orderItem: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
      padding: 14,
      marginBottom: 10,
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
      justifyContent: width >= 800 ? 'flex-end' : 'flex-start',
      gap: 8,
      marginTop: 10,
    },
    approveButton: {
      minHeight: 36,
      paddingHorizontal: 14,
      borderRadius: 8,
      backgroundColor: colors.successAction,
      alignItems: 'center',
      justifyContent: 'center',
    },
    approveButtonText: {
      color: colors.onSuccess,
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
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
      padding: 14,
      marginBottom: 10,
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
      backgroundColor: colors.dangerAction,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmDeclineText: {
      color: colors.onDanger,
      fontSize: 12,
      fontWeight: '800',
    },
    decisionItem: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
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
      backgroundColor: colors.primaryAction,
      alignItems: 'center',
      justifyContent: 'center',
    },
    saveBtnText: {
      color: colors.onPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    scheduleCurrentSub: {
      color: colors.textSecondary,
      fontSize: 12,
      marginBottom: 8,
    },
    distributorList: {
      gap: 6,
      marginTop: 4,
      maxHeight: 180,
    },
    distributorOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    distributorOptionSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    radioCircle: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: colors.textSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioCircleSelected: {
      borderColor: colors.primary,
    },
    radioDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.primary,
    },
    distributorName: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
    distributorNameSelected: {
      color: colors.primary,
    },
    distributorSub: {
      color: colors.textSecondary,
      fontSize: 11,
      marginTop: 1,
    },
    panelEmptyText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontStyle: 'italic',
      marginVertical: 4,
    },
    pillGroup: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 4,
      marginBottom: 8,
    },
    schedulePill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    schedulePillActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    schedulePillText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    schedulePillTextActive: {
      color: colors.primary,
      fontWeight: '800',
    },
    scheduleErrorText: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 4,
      marginBottom: 6,
    },
    confirmAssignmentButton: {
      minHeight: 38,
      paddingHorizontal: 16,
      borderRadius: 8,
      backgroundColor: colors.primaryAction,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
    },
    confirmAssignmentText: {
      color: colors.onPrimary,
      fontSize: 13,
      fontWeight: '800',
    },
  });
