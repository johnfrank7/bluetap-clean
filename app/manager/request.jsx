import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
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

import {
  decideOutsideRadiusOrder,
  dispatchManagerOrder,
} from '../../services/managerOrderApprovals';
import { subscribeProducts } from '../../services/products';
import { haversineDistanceKm } from '../../services/location';
import { useAdminTheme } from '../../components/AdminTheme';
import AdminIcon from '../../components/AdminIcon';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import SoftStatusBadge from '../../components/SoftStatusBadge';
import TopToastFeedback from '../../components/TopToastFeedback';
import ManagerShell, { MANAGER_COLORS, ManagerPill } from '../../components/ManagerShell';
import { useManagerOngoingRequests } from '../../components/ManagerOngoingRequestsMonitor';
import { useManagerRealtimeData } from '../../components/ManagerRealtimeData';
import { parseTimestamp } from '../../services/notificationTimestamp';
import LocationMap from '../../components/LocationMap';
import { ManagerOrderChatAction } from '../../components/chat/ChatOrderActions';
import AnimatedPresenceItem from '../../components/AnimatedPresenceItem';
import { useAnimatedPresenceList } from '../../components/useAnimatedPresenceList';
const { getManagerQueues, toManagerOrder } = require('../../services/managerOperational');
const {
  TARGET_HIGHLIGHT_DURATION_MS,
  matchesOrderIdentifier,
  resolveManagerOrderTarget,
} = require('../../services/managerOrderTargetNavigation');



const formatAmount = (amount) => `₱${Number(amount || 0).toFixed(2)}`;
const approvalLabel = (order = {}) => {
  const reasons = Array.isArray(order.approvalReasons) ? order.approvalReasons : [];
  if (reasons.includes('NON_STANDARD_DELIVERY_DAY')) return 'Delivery Day Review';
  if (reasons.includes('PRODUCT_LIMIT_EXCEEDED')) return 'High Quantity';
  return 'Outside Radius';
};
const approvalReasonLabel = (order = {}) => {
  const status = String(order.status || '').toLowerCase();
  if (status === 'branch_transfer_pending') return `Branch transfer from ${order.transferFromBranchName || 'another branch'}`;
  if (status === 'pending' && order.outsideServiceArea !== true) return 'New branch order review';
  if (['outside_radius_pending_approval', 'manager_approval_pending'].includes(status)) return approvalLabel(order);
  return 'Operational order review';
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

function ManagerActionButton({ children, disabled = false, onPress, style, hitSlop }) {
  const baseStyle = StyleSheet.flatten(style);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={hitSlop || { top: 4, bottom: 4, left: 4, right: 4 }}
      style={({ focused, hovered, pressed }) => [
        baseStyle,
        hovered && !disabled && { opacity: 0.9 },
        pressed && !disabled && { opacity: 0.8 },
        focused && {
          borderWidth: 2,
          borderColor: baseStyle?.borderColor || baseStyle?.backgroundColor || '#187BCD',
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

function PaginationBar({
  currentPage = 1,
  totalItems = 0,
  pageSize = 3,
  onPageChange,
  styles,
  itemLabel = 'orders',
}) {
  if (totalItems <= pageSize) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safePage - 1) * pageSize + 1;
  const endIndex = Math.min(safePage * pageSize, totalItems);

  const pages = [];
  if (totalPages <= 5) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    let start = Math.max(2, safePage - 1);
    let end = Math.min(totalPages - 1, safePage + 1);
    if (safePage <= 2) end = 3;
    if (safePage >= totalPages - 1) start = totalPages - 2;
    if (start > 2) pages.push('ellipsis-start');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push('ellipsis-end');
    pages.push(totalPages);
  }

  return (
    <View style={styles.paginationContainer} accessibilityRole="navigation" accessibilityLabel={`Pagination for ${itemLabel}`}>
      <Text style={styles.paginationRangeText}>
        Showing {startIndex}–{endIndex} of {totalItems}
      </Text>
      <View style={styles.paginationNavRow}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Previous page"
          disabled={safePage <= 1}
          onPress={() => onPageChange(safePage - 1)}
          style={[styles.paginationBtn, safePage <= 1 && styles.paginationBtnDisabled]}
        >
          <Text style={[styles.paginationBtnText, safePage <= 1 && styles.paginationBtnTextDisabled]}>‹ Prev</Text>
        </TouchableOpacity>

        {pages.map((p, idx) => {
          if (typeof p === 'string') {
            return (
              <Text key={`ellipsis-${idx}`} style={styles.paginationEllipsis}>
                …
              </Text>
            );
          }
          const isSelected = p === safePage;
          return (
            <TouchableOpacity
              key={`page-${p}`}
              accessibilityRole="button"
              accessibilityLabel={`Page ${p}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onPageChange(p)}
              style={[styles.paginationNumberBtn, isSelected && styles.paginationNumberBtnActive]}
            >
              <Text style={[styles.paginationNumberText, isSelected && styles.paginationNumberTextActive]}>
                {p}
              </Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Next page"
          disabled={safePage >= totalPages}
          onPress={() => onPageChange(safePage + 1)}
          style={[styles.paginationBtn, safePage >= totalPages && styles.paginationBtnDisabled]}
        >
          <Text style={[styles.paginationBtnText, safePage >= totalPages && styles.paginationBtnTextDisabled]}>Next ›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function OutsideRadiusApprovalQueue({
  orders,
  loading,
  styles,
  colors,
  isDark,
  onShowToast,
  onOpenOrder,
  targetOrderId = '',
  targetHighlighted = false,
  onSectionLayout,
  onTargetCardLayout,
  sectionScrollRef,
  style,
}) {
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const PAGE_SIZE = 3;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [orders.length, totalPages, currentPage]);

  useEffect(() => {
    if (targetOrderId) {
      const targetIdx = orders.findIndex((order) => matchesOrderIdentifier(order, targetOrderId));
      if (targetIdx !== -1) {
        const targetPage = Math.floor(targetIdx / PAGE_SIZE) + 1;
        if (targetPage !== currentPage) {
          setCurrentPage(targetPage);
        }
      }
    }
  }, [targetOrderId, orders]);

  const pagedOrders = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return orders.slice(start, start + PAGE_SIZE);
  }, [orders, currentPage]);

  const presentedOrders = useAnimatedPresenceList(pagedOrders, (order) => order.id);

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
    <View style={[styles.card, style]} onLayout={(event) => onSectionLayout?.('exceptions', event.nativeEvent.layout.y)}>
      <View style={styles.cardHeaderRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eyebrow}>DELIVERY EXCEPTIONS</Text>
          <Text style={styles.cardTitle}>Order Approvals</Text>
          <Text style={styles.helperText}>
            Review delivery requests outside your branch radius or above a product order limit.
          </Text>
        </View>
        <ManagerPill tone="warning">{orders.length} pending</ManagerPill>
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
      ) : presentedOrders.length === 0 ? (
        <BlueTapEmptyState
          compact
          variant="exceptions"
          title="No approvals pending"
          description="Requests requiring your review will appear here."
          themeColors={colors}
          dark={isDark}
          style={styles.visualEmpty}
        />
      ) : (
        <ScrollView ref={sectionScrollRef} nestedScrollEnabled style={styles.sectionScroll} contentContainerStyle={styles.sectionContent}>
        {presentedOrders.map((entry) => {
          const order = entry.item;
          const isUpdating = updatingId === order.id;
          const isTargetOrder = Boolean(targetOrderId) && matchesOrderIdentifier(order, targetOrderId);
          const isTargetHighlighted = Boolean(isTargetOrder && targetHighlighted);
          const products =
            order.items?.map((item) => `${item.quantity} × ${item.productNameSnapshot}`).filter(Boolean).join(', ') ||
            'Order products';

          return (
            <AnimatedPresenceItem key={entry.id} phase={entry.phase}>
            <View
              onLayout={(event) => {
                if (isTargetOrder) onTargetCardLayout?.('exceptions', event.nativeEvent.layout.y);
              }}
              style={[styles.orderItem, isTargetHighlighted && styles.orderItemTargetHighlighted]}
            >
              <View style={styles.orderHeaderRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={styles.requesterName}>{order.requesterName || 'Requester'}</Text>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={styles.orderIdText}>#{order.requestId || order.id}</Text>
                </View>
                <View style={styles.orderHeaderAside}>
                  {Boolean(isTargetHighlighted) ? (
                    <View style={styles.targetOrderBadge}>
                      <Text style={styles.targetOrderBadgeText}>Target Order</Text>
                    </View>
                  ) : null}
                  <ManagerPill tone="warning">
                    {approvalLabel(order)}
                  </ManagerPill>
                </View>
              </View>

              <View style={styles.productPricingRow}>
                <View style={styles.requestProductInfo}>
                  <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.productsSummary, styles.productsSummaryInline]}>{products}</Text>
                  <View style={styles.requestDeliveryInfo}>
                    <Text numberOfLines={2} ellipsizeMode="tail" style={styles.detailLine}>
                      Delivery: {order.address || (order.deliveryLocation ? `${order.deliveryLocation.latitude.toFixed(5)}, ${order.deliveryLocation.longitude.toFixed(5)}` : 'Location provided')}
                    </Text>
                    {order.distanceKmSnapshot != null && <Text numberOfLines={1} ellipsizeMode="tail" style={styles.detailLine}>
                      Distance: Approx. {Number(order.distanceKmSnapshot).toFixed(1)} km{order.serviceRadiusKmSnapshot != null ? ` · Branch radius ${order.serviceRadiusKmSnapshot} km` : ''}
                    </Text>}
                  </View>
                </View>
                <View style={styles.orderTotalSummary}>
                  <Text style={styles.totalLabel}>ORDER TOTAL</Text>
                  <Text style={styles.amountText}>{formatAmount(order.totalAtOrder)}</Text>
                  {Boolean(order.deliveryFeeAtOrder) ? (
                    <Text style={styles.deliveryFeeText}>Includes {formatAmount(order.deliveryFeeAtOrder)} delivery</Text>
                  ) : null}
                </View>
              </View>

              {Boolean(order.productLimitViolations?.length > 0 || order.approvalReasons?.includes('NON_STANDARD_DELIVERY_DAY') || order.requesterUniqueId) ? (
                <View style={styles.detailsBlock}>
                  {(order.productLimitViolations || []).map((item) => (
                    <Text key={item.productId} numberOfLines={2} ellipsizeMode="tail" style={styles.detailLine}>
                      {item.productNameSnapshot}: requested {item.requestedQuantity} · limit {item.configuredLimit}. Order exceeds the configured requester product limit.
                    </Text>
                  ))}
                  {Boolean(order.approvalReasons?.includes('NON_STANDARD_DELIVERY_DAY')) ? (
                    <Text numberOfLines={2} ellipsizeMode="tail" style={styles.detailLine}>The requested date falls outside the effective product delivery weekdays and requires Manager review.</Text>
                  ) : null}
                  {Boolean(order.requesterUniqueId) ? (
                    <Text numberOfLines={1} ellipsizeMode="tail" style={styles.detailLine}>Requester UID: {order.requesterUniqueId}</Text>
                  ) : null}
                </View>
              ) : null}

              <View style={[styles.actionRow, styles.requestActionRow]}>
                <View style={styles.actionSecondaryGroup}>
                  <View style={styles.chatActionWrap}><ManagerOrderChatAction order={order} disabled={entry.actionsDisabled} style={styles.managerChatButton} /></View>
                  <ManagerActionButton disabled={entry.actionsDisabled} onPress={() => onOpenOrder(order)} style={[styles.actionButton, styles.viewDetailsBtn, entry.actionsDisabled && styles.actionDisabled]}>
                    <Text style={styles.viewDetailsBtnText}>View Details</Text>
                  </ManagerActionButton>
                </View>
                <View style={styles.actionDecisionGroup}>
                  <ManagerActionButton
                    disabled={isUpdating || entry.actionsDisabled}
                    onPress={() => decide(order, 'approve')}
                    style={[styles.actionButton, styles.approveButton, (isUpdating || entry.actionsDisabled) && styles.actionDisabled]}
                  >
                    <Text style={styles.approveButtonText}>{isUpdating ? 'Saving…' : 'Approve'}</Text>
                  </ManagerActionButton>

                  <ManagerActionButton
                    disabled={isUpdating || entry.actionsDisabled}
                    onPress={() => decide(order, 'decline')}
                    style={[styles.actionButton, styles.declineButton, (isUpdating || entry.actionsDisabled) && styles.actionDisabled]}
                  >
                    <Text style={styles.declineButtonText}>Reject</Text>
                  </ManagerActionButton>
                </View>
              </View>
            </View>
            </AnimatedPresenceItem>
          );
        })}
        </ScrollView>
      )}
      <PaginationBar
        currentPage={currentPage}
        totalItems={orders.length}
        pageSize={PAGE_SIZE}
        onPageChange={setCurrentPage}
        styles={styles}
        itemLabel="exceptions"
      />
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
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>Request Information</Text>
              <View style={styles.detailGrid}>
                {[
                  ['Public order ID', order.requestId || order.id],
                  ['Requester', order.requesterName || 'Requester'],
                  ['Requester public ID', order.requesterUniqueId || 'Not available'],
                  ['Assigned distributor', order.assignedDistributorName || 'Not assigned'],
                  ['Distributor public ID', order.assignedDistributorUniqueId || order.distributorUniqueId || 'Not available'],
                  ['Container type', order.container || 'Not set'],
                  ['Total', formatAmount(order.totalAtOrder)],
                  ['Requested branch', order.initialBranchName || order.initialBranchNameSnapshot || order.transferFromBranchName || order.currentBranchName || 'Not available'],
                  ['Current branch', order.currentBranchName || order.branchNameSnapshot || 'Not available'],
                  ['Delivery address', order.address || 'Not available'],
                  ['Distance / radius', order.distanceKmSnapshot == null ? 'Not available' : `${Number(order.distanceKmSnapshot).toFixed(1)} km / ${Number(order.serviceRadiusKmSnapshot || 0).toFixed(1)} km`],
                  ['Schedule', (order.scheduledDate ? `${order.scheduledDate}${order.scheduledWindow ? ` · ${order.scheduledWindow}` : ''}` : scheduleLabel(order.scheduledAt || order.expectedDeliveryDate)) || 'Not scheduled'],
                  ['Current status', String(order.status || '').replace(/_/g, ' ') || 'Not available'],
                  ['Approval reason', approvalReasonLabel(order)],
                ].map(([label, value]) => (
                  <View key={label} style={styles.detailGridRow}>
                    <Text style={styles.detailGridLabel}>{label}</Text>
                    <Text style={styles.detailGridValue}>{value}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>Delivery Location Map</Text>
              {Number.isFinite(order.deliveryLocation?.latitude) && Number.isFinite(order.deliveryLocation?.longitude) ? (
                <LocationMap
                  location={order.deliveryLocation}
                  branches={Number.isFinite(order.branchLocation?.latitude) && Number.isFinite(order.branchLocation?.longitude) ? [{ id: order.branchId || 'station', name: order.currentBranchName || 'Water Station', location: order.branchLocation }] : []}
                  selectedBranchId={order.branchId || 'station'}
                  readOnly
                  themed
                  themeColors={colors}
                  height={190}
                />
              ) : <View style={styles.locationUnavailable}><Text style={styles.locationUnavailableText}>Location unavailable</Text></View>}
            </View>

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

              {isEditable && catalogProducts.length > 0 ? (
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
              ) : null}
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

            {Boolean(editError) ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{editError}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.modalFooterRow}>
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Close</Text>
            </TouchableOpacity>

            {Boolean(isEditable) ? (
              <TouchableOpacity
                disabled={saving}
                onPress={handleSave}
                style={[styles.saveBtn, saving && styles.actionDisabled]}
              >
                <Text style={styles.saveBtnText}>{saving ? 'Recalculating & Saving…' : 'Save Order Changes'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function BranchTransfersQueue({
  data,
  styles,
  colors,
  isDark,
  onShowToast,
  onOpenOrder,
  targetOrderId = '',
  targetHighlighted = false,
  revealDecisions = false,
  onSectionLayout,
  onTargetCardLayout,
  sectionScrollRef,
}) {
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
  const [showTransferDecisions, setShowTransferDecisions] = useState(false);

  useEffect(() => {
    if (revealDecisions) {
      setShowTransferDecisions(true);
    }
  }, [revealDecisions, targetOrderId]);

  return (
    <View style={styles.card} onLayout={(event) => onSectionLayout?.('transfers', event.nativeEvent.layout.y)}>
      <View style={styles.cardHeaderRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eyebrow}>COORDINATION</Text>
          <Text style={styles.cardTitle}>Branch Transfer Reviews & Outcomes</Text>
          <Text style={styles.helperText}>
            Review inbound order transfer requests and review decisions for outbound transfers.
          </Text>
        </View>
        <ManagerPill>{incoming.length} incoming</ManagerPill>
      </View>

      {!!error && (
        <View accessibilityRole="alert" style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      <ScrollView ref={sectionScrollRef} nestedScrollEnabled style={styles.sectionScroll} contentContainerStyle={styles.sectionContent}>
      {/* Incoming Transfers */}
      <Text style={[styles.subSectionTitle, { marginTop: 10 }]}>Incoming Transfer Requests ({incoming.length})</Text>
      {incoming.length === 0 ? (
        <BlueTapEmptyState
          compact
          variant="coordination"
          title="No transfer requests"
          description="Incoming branch transfers will appear here."
          themeColors={colors}
          dark={isDark}
          style={styles.inlineVisualEmpty}
        />
      ) : (
        incoming.map((order) => {
          const isUpdating = updatingId === order.id;
          const isDeclining = decliningOrderId === order.id;
          const isTargetOrder = Boolean(targetOrderId) && matchesOrderIdentifier(order, targetOrderId);
          const isTargetHighlighted = Boolean(isTargetOrder && targetHighlighted);

          return (
            <View
              key={order.id}
              onLayout={(event) => {
                if (isTargetOrder) onTargetCardLayout?.('transfers', event.nativeEvent.layout.y);
              }}
              style={[styles.transferItem, isTargetHighlighted && styles.orderItemTargetHighlighted]}
            >
              <View style={styles.orderHeaderRow}>
                <View style={styles.orderHeaderMain}>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={styles.requesterName}>Transfer from {order.transferFromBranchName || 'another branch'}</Text>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={styles.orderIdText}>#{order.requestId || order.id} · {order.requesterName || 'Requester'}</Text>
                </View>
                <View style={styles.orderHeaderAside}>
                  {Boolean(isTargetHighlighted) ? (
                    <View style={styles.targetOrderBadge}>
                      <Text style={styles.targetOrderBadgeText}>Target Order</Text>
                    </View>
                  ) : null}
                  <ManagerPill tone="cyan">{order.status?.replace(/_/g, ' ') || 'Transfer review'}</ManagerPill>
                </View>
              </View>

              <View style={styles.productPricingRow}>
                <View style={styles.requestProductInfo}>
                  <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.productsSummary, styles.productsSummaryInline]}>{orderProducts(order)}</Text>
                  <View style={styles.requestDeliveryInfo}>
                    {Boolean(order.address) ? <Text numberOfLines={2} ellipsizeMode="tail" style={styles.detailLine}>Delivery: {order.address}</Text> : null}
                    <Text numberOfLines={1} ellipsizeMode="tail" style={styles.detailLine}>Distance: {orderDistance(order)}</Text>
                    {Boolean(order.transferToBranchName) ? <Text numberOfLines={1} ellipsizeMode="tail" style={styles.detailLine}>Destination: {order.transferToBranchName}</Text> : null}
                    <Text numberOfLines={2} ellipsizeMode="tail" style={styles.detailLine}>Transfer note: {order.transferReason || 'No note provided'}</Text>
                  </View>
                </View>
                <View style={styles.orderTotalSummary}>
                  <Text style={styles.totalLabel}>ORDER TOTAL</Text>
                  <Text style={styles.amountText}>{formatAmount(order.totalAtOrder)}</Text>
                  {Boolean(order.deliveryFeeAtOrder) ? <Text style={styles.deliveryFeeText}>Includes {formatAmount(order.deliveryFeeAtOrder)} delivery</Text> : null}
                </View>
              </View>

              <View style={[styles.actionRow, styles.requestActionRow]}>
                <View style={styles.actionSecondaryGroup}>
                  <ManagerActionButton onPress={() => onOpenOrder(order)} style={[styles.actionButton, styles.viewDetailsBtn]}>
                    <Text style={styles.viewDetailsBtnText}>View Details</Text>
                  </ManagerActionButton>
                </View>
                <View style={styles.actionDecisionGroup}>
                  <ManagerActionButton
                    disabled={isUpdating}
                    onPress={() => act(order.id, 'accept-transfer')}
                    style={[styles.actionButton, styles.approveButton, isUpdating && styles.actionDisabled]}
                  >
                    <Text style={styles.approveButtonText}>{isUpdating ? 'Saving…' : 'Accept Transfer'}</Text>
                  </ManagerActionButton>

                  <ManagerActionButton
                    disabled={isUpdating}
                    onPress={() => setDecliningOrderId(isDeclining ? '' : order.id)}
                    style={[styles.actionButton, styles.declineButton]}
                  >
                    <Text style={styles.declineButtonText}>Decline</Text>
                  </ManagerActionButton>
                </View>
              </View>

              {Boolean(isDeclining) ? (
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
              ) : null}
            </View>
          );
        })
      )}

      {/* Decision Events */}
      <View style={[styles.decisionsHeader, { marginTop: 18 }]}>
        <Text style={[styles.subSectionTitle, styles.decisionsHeaderTitle]}>Recent Transfer decisions</Text>
        <ManagerPill>{decisions.length}</ManagerPill>
        {decisions.length > 0 ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${showTransferDecisions ? 'Hide' : 'Show'} recent transfer decisions`}
            accessibilityState={{ expanded: showTransferDecisions }}
            onPress={() => setShowTransferDecisions((visible) => !visible)}
            style={styles.decisionsToggle}
          >
            <Text style={styles.decisionsToggleText}>{showTransferDecisions ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {decisions.length === 0 ? (
        <BlueTapEmptyState
          compact
          variant="coordination"
          title="No transfer updates yet"
          description="Accepted or declined transfer decisions will appear here."
          themeColors={colors}
          dark={isDark}
          style={styles.inlineVisualEmpty}
        />
      ) : showTransferDecisions ? (
        decisions.map((event) => {
          const accepted = event.decision === 'accepted';
          const isTargetDecision = Boolean(targetOrderId) && matchesOrderIdentifier(event, targetOrderId);
          const isTargetHighlighted = Boolean(isTargetDecision && targetHighlighted);
          return (
            <View
              key={event.id}
              onLayout={(layoutEvent) => {
                if (isTargetDecision) onTargetCardLayout?.('transfers', layoutEvent.nativeEvent.layout.y);
              }}
              style={[styles.decisionItem, isTargetHighlighted && styles.orderItemTargetHighlighted]}
            >
              <View style={styles.orderHeaderRow}>
                <View style={styles.orderHeaderMain}>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={styles.requesterName}>Transfer outcome · {event.targetBranchName || 'Target branch'}</Text>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={styles.orderIdText}>Order #{event.requestId || 'order'}</Text>
                </View>
                <View style={styles.orderHeaderAside}>
                  {Boolean(isTargetHighlighted) ? (
                    <View style={styles.targetOrderBadge}>
                      <Text style={styles.targetOrderBadgeText}>Target Order</Text>
                    </View>
                  ) : null}
                  <ManagerPill tone={accepted ? 'green' : 'red'}>{accepted ? 'Accepted' : 'Declined'}</ManagerPill>
                </View>
              </View>
              <Text numberOfLines={2} ellipsizeMode="tail" style={styles.decisionText}>
                {event.targetBranchName || 'Target branch'} {accepted ? 'accepted' : 'declined'} the transfer.
              </Text>
              {Boolean(scheduleLabel(event.decidedAt)) ? <Text numberOfLines={1} ellipsizeMode="tail" style={styles.detailLine}>{scheduleLabel(event.decidedAt)}</Text> : null}
              {!accepted && event.declineReason ? (
                <Text numberOfLines={2} ellipsizeMode="tail" style={styles.declineReasonText}>Reason: {event.declineReason}</Text>
              ) : null}
            </View>
          );
        })
      ) : null}
      </ScrollView>
    </View>
  );
}

function ReceivedRequestsQueue({
  orders,
  loading,
  styles,
  colors,
  isDark,
  onShowToast,
  onOpenOrder,
  targetOrderId = '',
  targetHighlighted = false,
  onSectionLayout,
  onTargetCardLayout,
  sectionScrollRef,
  style,
}) {
  const [updatingId, setUpdatingId] = useState('');
  const [rejectingId, setRejectingId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const PAGE_SIZE = 3;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [orders.length, totalPages, currentPage]);

  useEffect(() => {
    if (targetOrderId) {
      const targetIdx = orders.findIndex((order) => matchesOrderIdentifier(order, targetOrderId));
      if (targetIdx !== -1) {
        const targetPage = Math.floor(targetIdx / PAGE_SIZE) + 1;
        if (targetPage !== currentPage) {
          setCurrentPage(targetPage);
        }
      }
    }
  }, [targetOrderId, orders]);

  const pagedOrders = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return orders.slice(start, start + PAGE_SIZE);
  }, [orders, currentPage]);

  const presentedOrders = useAnimatedPresenceList(pagedOrders, (order) => order.id);

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
    <View style={[styles.card, style]} onLayout={(event) => onSectionLayout?.('review', event.nativeEvent.layout.y)}>
      <View style={styles.cardHeaderRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eyebrow}>UPCOMING / NORMAL ORDERS</Text>
          <Text style={styles.cardTitle}>Upcoming & Active Branch Orders ({orders.length})</Text>
          <Text style={styles.helperText}>Accept a branch order for dispatch or reject it with a reason.</Text>
        </View>
        <ManagerPill tone="warning">{orders.length} pending</ManagerPill>
      </View>
      {Boolean(error) ? <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorBannerText}>{error}</Text></View> : null}
      {loading ? <View style={styles.emptyContainer}><ActivityIndicator color={colors.primary} /></View> : presentedOrders.length === 0 ? (
        <BlueTapEmptyState
          compact
          variant="orders"
          title="All caught up!"
          description="No branch orders are waiting for review."
          themeColors={colors}
          dark={isDark}
          style={styles.visualEmpty}
        />
      ) : (
        <ScrollView ref={sectionScrollRef} nestedScrollEnabled style={styles.sectionScroll} contentContainerStyle={styles.sectionContent}>
          {presentedOrders.map((entry) => {
            const order = entry.item;
            const isTargetOrder = Boolean(targetOrderId) && matchesOrderIdentifier(order, targetOrderId);
            const isTargetHighlighted = Boolean(isTargetOrder && targetHighlighted);
            return <AnimatedPresenceItem key={entry.id} phase={entry.phase}><View
              onLayout={(event) => {
                if (isTargetOrder) onTargetCardLayout?.('review', event.nativeEvent.layout.y);
              }}
              style={[styles.orderItem, isTargetHighlighted && styles.orderItemTargetHighlighted]}
            >
            <View style={styles.orderHeaderRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={styles.requesterName}>{order.requesterName || 'Requester'}</Text>
                <Text numberOfLines={1} ellipsizeMode="tail" style={styles.orderIdText}>#{order.requestId || order.id}</Text>
              </View>
              <View style={styles.orderHeaderAside}>
                {Boolean(isTargetHighlighted) ? (
                  <View style={styles.targetOrderBadge}>
                    <Text style={styles.targetOrderBadgeText}>Target Order</Text>
                  </View>
                ) : null}
                <SoftStatusBadge status={order.orderStatusSnapshot || order.status || 'pending'} />
              </View>
            </View>
            <View style={styles.productPricingRow}>
              <View style={styles.requestProductInfo}>
                <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.productsSummary, styles.productsSummaryInline]}>{orderProducts(order)}</Text>
                <View style={styles.requestDeliveryInfo}>
                  <Text numberOfLines={2} ellipsizeMode="tail" style={styles.detailLine}>Delivery: {order.address || 'Address provided'}</Text>
                  {order.distanceKmSnapshot != null ? <Text numberOfLines={1} ellipsizeMode="tail" style={styles.detailLine}>Distance: {orderDistance(order)}</Text> : null}
                </View>
              </View>
              <View style={styles.orderTotalSummary}>
                <Text style={styles.totalLabel}>ORDER TOTAL</Text>
                <Text style={styles.amountText}>{formatAmount(order.totalAtOrder)}</Text>
                {Boolean(order.deliveryFeeAtOrder) ? (
                  <Text style={styles.deliveryFeeText}>Includes {formatAmount(order.deliveryFeeAtOrder)} delivery</Text>
                ) : null}
              </View>
            </View>
            <View style={[styles.actionRow, styles.requestActionRow]}>
              <View style={styles.actionSecondaryGroup}>
                <View style={styles.chatActionWrap}>
                  <ManagerOrderChatAction order={order} disabled={entry.actionsDisabled} style={styles.managerChatButton} />
                </View>
                <ManagerActionButton disabled={entry.actionsDisabled} onPress={() => onOpenOrder(order)} style={[styles.actionButton, styles.viewDetailsBtn, entry.actionsDisabled && styles.actionDisabled]}>
                  <Text style={styles.viewDetailsBtnText}>View Details</Text>
                </ManagerActionButton>
              </View>
              <View style={styles.actionDecisionGroup}>
                <ManagerActionButton disabled={!!updatingId || entry.actionsDisabled} onPress={() => decide(order, 'accept-order')} style={[styles.actionButton, styles.approveButton, (!!updatingId || entry.actionsDisabled) && styles.actionDisabled]}>
                  <Text style={styles.approveButtonText}>{updatingId === order.id ? 'Saving…' : 'Accept'}</Text>
                </ManagerActionButton>
                <ManagerActionButton disabled={!!updatingId || entry.actionsDisabled} onPress={() => { setRejectingId(rejectingId === order.id ? '' : order.id); setReason(''); setError(''); }} style={[styles.actionButton, styles.declineButton, entry.actionsDisabled && styles.actionDisabled]}>
                  <Text style={styles.declineButtonText}>Reject</Text>
                </ManagerActionButton>
              </View>
            </View>
            {Boolean(rejectingId === entry.id && !entry.actionsDisabled) ? (
              <View style={styles.declineBox}>
                <TextInput value={reason} onChangeText={setReason} maxLength={240} multiline placeholder="Reason shown to the requester" placeholderTextColor={colors.placeholder} style={styles.inputField} />
                <TouchableOpacity disabled={!!updatingId} onPress={() => decide(entry.item, 'reject-order')} style={styles.confirmDeclineBtn}>
                  <Text style={styles.confirmDeclineText}>Confirm Rejection</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View></AnimatedPresenceItem>;
          })}
        </ScrollView>
      )}
      <PaginationBar
        currentPage={currentPage}
        totalItems={orders.length}
        pageSize={PAGE_SIZE}
        onPageChange={setCurrentPage}
        styles={styles}
        itemLabel="normal orders"
      />
    </View>
  );
}

const normalizeOrdersTab = (value) => {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'pending' || key === 'ongoing' || key === 'completed' || key === 'all') {
    return key;
  }
  return 'all';
};

function BranchOrdersOverview({
  data,
  loading,
  styles,
  colors,
  isDark,
  onOpenOrder,
  initialFilter = '',
  viewAllTick = 0,
  targetOrderId = '',
  targetOrdersTab = null,
  targetHighlighted = false,
  onSectionLayout,
  onTargetCardLayout,
  sectionScrollRef,
  style,
}) {
  const [filter, setFilter] = useState('');
  const [statusTab, setStatusTab] = useState(() => normalizeOrdersTab(initialFilter));
  const PAGE_SIZE = 5;
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (initialFilter) {
      setStatusTab(normalizeOrdersTab(initialFilter));
      setCurrentPage(1);
    }
  }, [initialFilter]);

  useEffect(() => {
    if (viewAllTick > 0) {
      setStatusTab('ongoing');
      setCurrentPage(1);
    }
  }, [viewAllTick]);

  useEffect(() => {
    if (targetOrdersTab) {
      setStatusTab(normalizeOrdersTab(targetOrdersTab));
      setFilter('');
      setCurrentPage(1);
    }
  }, [targetOrdersTab, targetOrderId]);

  const activeMergedOrders = useMemo(() => {
    const map = new Map();
    (data.ongoing || []).forEach((order) => {
      if (order?.id) map.set(order.id, order);
    });
    (data.orders || []).forEach((order) => {
      if (order?.id && !map.has(order.id)) map.set(order.id, order);
    });
    return Array.from(map.values());
  }, [data.ongoing, data.orders]);

  const tabCounts = useMemo(
    () => ({
      all: activeMergedOrders.length,
      pending: (data.pendingOrders || []).length,
      ongoing: (data.ongoing || []).length,
      completed: (data.completed || []).length,
    }),
    [activeMergedOrders.length, data.completed, data.ongoing, data.pendingOrders]
  );

  const orders = useMemo(() => {
    let baseList = activeMergedOrders;
    if (statusTab === 'pending') {
      baseList = data.pendingOrders || [];
    } else if (statusTab === 'ongoing') {
      baseList = data.ongoing || [];
    } else if (statusTab === 'completed') {
      baseList = data.completed || [];
    }
    if (!filter.trim()) return baseList;
    const term = filter.trim().toLowerCase();
    return baseList.filter(
      (o) =>
        (o.requesterName && o.requesterName.toLowerCase().includes(term)) ||
        (o.requestId && o.requestId.toLowerCase().includes(term)) ||
        (o.address && o.address.toLowerCase().includes(term)) ||
        (o.assignedDistributorName && o.assignedDistributorName.toLowerCase().includes(term)) ||
        (o.assignedDistributorUniqueId && o.assignedDistributorUniqueId.toLowerCase().includes(term))
    );
  }, [activeMergedOrders, data.completed, data.ongoing, data.pendingOrders, filter, statusTab]);

  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [orders.length, totalPages, currentPage]);

  useEffect(() => {
    if (targetOrderId) {
      const targetIdx = orders.findIndex((order) => matchesOrderIdentifier(order, targetOrderId));
      if (targetIdx !== -1) {
        const targetPage = Math.floor(targetIdx / PAGE_SIZE) + 1;
        if (targetPage !== currentPage) {
          setCurrentPage(targetPage);
        }
      }
    }
  }, [targetOrderId, orders]);

  const pagedOrders = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return orders.slice(start, start + PAGE_SIZE);
  }, [orders, currentPage]);

  const presentedOrders = useAnimatedPresenceList(pagedOrders, (order) => order.id);

  const statusTabs = [
    { key: 'all', label: `All Active (${tabCounts.all})` },
    { key: 'pending', label: `Pending (${tabCounts.pending})` },
    { key: 'ongoing', label: `Ongoing (${tabCounts.ongoing})` },
    { key: 'completed', label: `Completed (${tabCounts.completed})` },
  ];

  const emptyTitle =
    statusTab === 'ongoing'
      ? 'No ongoing requests'
      : statusTab === 'pending'
      ? 'No pending branch orders'
      : statusTab === 'completed'
      ? 'No completed branch orders'
      : 'No active branch orders';

  const emptyDescription =
    statusTab === 'ongoing'
      ? 'Assigned deliveries will appear here once they are in progress.'
      : statusTab === 'pending'
      ? 'Requests awaiting review or distributor assignment will appear here.'
      : statusTab === 'completed'
      ? 'Delivered, cancelled, and declined branch orders will appear here.'
      : 'Orders eligible for review or adjustment will appear here.';

  return (
    <View style={[styles.card, style]} onLayout={(event) => onSectionLayout?.('branchOrders', event.nativeEvent.layout.y)}>
      <View style={styles.cardHeaderRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eyebrow}>BRANCH MANAGEMENT</Text>
          <Text style={styles.cardTitle}>Branch Orders & Situational Edits</Text>
          <Text style={styles.helperText}>
            Review active branch orders, monitor ongoing deliveries, and make eligible pre-delivery adjustments.
          </Text>
        </View>
        <ManagerPill tone={statusTab === 'pending' ? 'warning' : statusTab === 'completed' ? 'success' : 'info'}>
          {statusTab === 'ongoing'
            ? `${orders.length} ongoing`
            : statusTab === 'pending'
            ? `${orders.length} pending`
            : statusTab === 'completed'
            ? `${orders.length} completed`
            : `${orders.length} active`}
        </ManagerPill>
      </View>

      <View style={styles.branchOrdersToolbar}>
        <View style={styles.branchOrdersPillGroup} accessibilityRole="tablist">
          {statusTabs.map((tab) => {
            const selected = statusTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilitySelected={selected}
                aria-selected={selected}
                accessibilityLabel={`Filter branch orders by ${tab.key}`}
                onPress={() => {
                  setStatusTab(tab.key);
                  setCurrentPage(1);
                }}
                style={[
                  styles.schedulePill,
                  selected && {
                    backgroundColor: colors.primaryAction,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.schedulePillText,
                    selected && {
                      color: '#FFFFFF',
                      fontWeight: '800',
                    },
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.branchOrdersSearchWrap}>
          <TextInput
            value={filter}
            onChangeText={(text) => {
              setFilter(text);
              setCurrentPage(1);
            }}
            placeholder="Filter orders by requester, ID, distributor, address..."
            placeholderTextColor={colors.placeholder}
            style={styles.searchInput}
          />
        </View>
      </View>

      {loading ? <View style={styles.emptyContainer}><ActivityIndicator color={colors.primary} /></View> : presentedOrders.length === 0 ? (
        <BlueTapEmptyState
          compact
          variant="management"
          title={emptyTitle}
          description={emptyDescription}
          themeColors={colors}
          dark={isDark}
          style={styles.visualEmpty}
        />
      ) : (
        <ScrollView ref={sectionScrollRef} nestedScrollEnabled style={styles.sectionScroll} contentContainerStyle={styles.sectionContent}>
        {presentedOrders.map((entry) => {
          const order = entry.item;
          const isEditable = EDITABLE_STATUSES.has(order.status);
          const isTargetOrder = Boolean(targetOrderId) && matchesOrderIdentifier(order, targetOrderId);
          const isTargetHighlighted = Boolean(isTargetOrder && targetHighlighted);
          const scheduleSummary = order.scheduledDate
            ? `${order.scheduledDate}${order.scheduledWindow ? ` · ${order.scheduledWindow}` : ''}`
            : scheduleLabel(order.scheduledAt);
          return (
            <AnimatedPresenceItem key={entry.id} phase={entry.phase}>
            <View
              onLayout={(event) => {
                if (isTargetOrder) onTargetCardLayout?.('branchOrders', event.nativeEvent.layout.y);
              }}
              style={[styles.orderItem, isTargetHighlighted && styles.orderItemTargetHighlighted]}
            >
              <View style={styles.orderHeaderRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={styles.requesterName}>{order.requesterName || 'Requester'}</Text>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={styles.orderIdText}>#{order.requestId || order.id}</Text>
                </View>
                <View style={styles.orderHeaderAside}>
                  {Boolean(isTargetHighlighted) ? (
                    <View style={styles.targetOrderBadge}>
                      <Text style={styles.targetOrderBadgeText}>Target Order</Text>
                    </View>
                  ) : null}
                  <SoftStatusBadge status={order.status} dark={isDark} compact />
                </View>
              </View>

              <View style={styles.productPricingRow}>
                <View style={styles.requestProductInfo}>
                  <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.productsSummary, styles.productsSummaryInline]}>{orderProducts(order)}</Text>
                  <View style={styles.requestDeliveryInfo}>
                    {Boolean(order.assignedDistributorName || order.assignedDistributorUid) ? (
                      <Text numberOfLines={1} ellipsizeMode="tail" style={styles.detailLine}>
                        Distributor: {order.assignedDistributorName || 'Assigned Distributor'}
                        {order.assignedDistributorUniqueId ? ` (${order.assignedDistributorUniqueId})` : ''}
                      </Text>
                    ) : null}
                    {Boolean(scheduleSummary) ? (
                      <Text numberOfLines={1} ellipsizeMode="tail" style={styles.detailLine}>Schedule: {scheduleSummary}</Text>
                    ) : null}
                    <Text numberOfLines={2} ellipsizeMode="tail" style={styles.detailLine}>Delivery: {order.address || 'Address provided'}</Text>
                    {order.distanceKmSnapshot != null ? <Text numberOfLines={1} ellipsizeMode="tail" style={styles.detailLine}>Distance: {orderDistance(order)}</Text> : null}
                  </View>
                </View>
                <View style={styles.orderTotalSummary}>
                  <Text style={styles.totalLabel}>ORDER TOTAL</Text>
                  <Text style={styles.amountText}>{formatAmount(order.totalAtOrder)}</Text>
                  {Boolean(order.deliveryFeeAtOrder) ? (
                    <Text style={styles.deliveryFeeText}>Includes {formatAmount(order.deliveryFeeAtOrder)} delivery</Text>
                  ) : null}
                </View>
              </View>
              <View style={[styles.actionRow, styles.requestActionRow, styles.overviewActionRow]}>
                <View style={styles.overviewActionGroup}>
                  <View style={styles.chatActionWrap}>
                    <ManagerOrderChatAction order={order} disabled={entry.actionsDisabled} style={styles.managerChatButton} />
                  </View>
                  <ManagerActionButton
                    disabled={entry.actionsDisabled}
                    onPress={() => onOpenOrder(order)}
                    style={[
                      styles.actionButton,
                      styles.overviewActionButton,
                      isEditable ? styles.editOrderBtn : styles.viewDetailsBtn,
                      entry.actionsDisabled && styles.actionDisabled,
                    ]}
                  >
                    <Text style={isEditable ? styles.editOrderBtnText : styles.viewDetailsBtnText}>
                      {isEditable ? 'Edit Order Details' : 'View Order Details'}
                    </Text>
                  </ManagerActionButton>
                </View>
              </View>
            </View>
            </AnimatedPresenceItem>
          );
        })}
        </ScrollView>
      )}
      <PaginationBar
        currentPage={currentPage}
        totalItems={orders.length}
        pageSize={PAGE_SIZE}
        onPageChange={setCurrentPage}
        styles={styles}
        itemLabel="branch orders"
      />
    </View>
  );
}

export default function ManagerRequestPage() {
  const params = useLocalSearchParams();
  const requestedFilter = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const requestedOrderId = Array.isArray(params.orderId) ? params.orderId[0] : params.orderId;
  const { colors, resolvedTheme } = useAdminTheme();
  const isDark = resolvedTheme === 'dark';
  const { width } = useWindowDimensions();
  const isTwoColumn = width >= 1100;
  const styles = useMemo(
    () => createStyles(colors, width, isDark, isTwoColumn),
    [colors, width, isDark, isTwoColumn]
  );
  const [toast, setToast] = useState({ visible: false, message: '', type: 'success' });
  const [selectedOrderSnapshot, setSelectedOrder] = useState(null);
  const [activeTargetId, setActiveTargetId] = useState('');
  const [targetHighlighted, setTargetHighlighted] = useState(false);
  const [dismissedUnavailableRef, setDismissedUnavailableRef] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const openedParamRef = useRef('');
  const scrolledTargetRef = useRef('');
  const contentScrollRef = useRef(null);
  const sectionOffsetsRef = useRef({});
  const rowOffsetsRef = useRef({});
  const localSectionOffsetsRef = useRef({});
  const sectionScrollRefs = useRef({});
  const itemOffsetsRef = useRef({});
  const targetHighlightTimerRef = useRef(null);
  const { viewAllTick = 0 } = useManagerOngoingRequests();
  const realtime = useManagerRealtimeData();
  const dispatchData = useMemo(() => {
    const queues = getManagerQueues(realtime.requests, realtime.incomingTransfers, realtime.branchId);
    const branchLocation = Number.isFinite(Number(realtime.branch?.latitude)) && Number.isFinite(Number(realtime.branch?.longitude))
      ? { latitude: Number(realtime.branch.latitude), longitude: Number(realtime.branch.longitude) }
      : null;
    const mapOrder = (order) => ({ ...toManagerOrder(order.id, order, realtime.branch?.name || '', realtime.users), branchLocation });
    return {
      orders: queues.editable.map(mapOrder),
      ongoing: queues.ongoing.map(mapOrder),
      pendingOrders: queues.pendingOrders.map(mapOrder),
      completed: queues.completed.map(mapOrder),
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
    const branchLocation = Number.isFinite(Number(realtime.branch?.latitude)) && Number.isFinite(Number(realtime.branch?.longitude))
      ? { latitude: Number(realtime.branch.latitude), longitude: Number(realtime.branch.longitude) }
      : null;
    return live ? { ...toManagerOrder(live.id, live, realtime.branch?.name || '', realtime.users), branchLocation } : selectedOrderSnapshot;
  }, [realtime.branch?.latitude, realtime.branch?.longitude, realtime.branch?.name, realtime.requests, realtime.users, selectedOrderSnapshot]);

  const authorizedSource = useMemo(
    () =>
      [...realtime.requests, ...realtime.incomingTransfers].find((order) => {
        const matchesId = matchesOrderIdentifier(order, requestedOrderId);
        const branchId = String(order.currentBranchId || order.branchId || '');
        const incomingBranchId = String(order.transferToBranchId || '');
        return matchesId && (branchId === String(realtime.branchId) || incomingBranchId === String(realtime.branchId));
      }) || null,
    [realtime.branchId, realtime.incomingTransfers, realtime.requests, requestedOrderId]
  );

  const targetResolution = useMemo(
    () =>
      resolveManagerOrderTarget(requestedOrderId, {
        requests: realtime.requests,
        incomingTransfers: realtime.incomingTransfers,
        sourceDecisionEvents: realtime.sourceDecisionEvents,
        branchId: realtime.branchId,
        loading: realtime.loading,
      }),
    [
      requestedOrderId,
      realtime.branchId,
      realtime.incomingTransfers,
      realtime.loading,
      realtime.requests,
      realtime.sourceDecisionEvents,
    ]
  );

  const showToast = (message, type = 'success') => {
    setToast({ visible: true, message, type });
  };

  const handleOpenOrder = (order) => {
    setTargetHighlighted(false);
    setSelectedOrder(order);
    setModalVisible(true);
  };

  const attemptScrollToTarget = useCallback(() => {
    if (!targetResolution.canonicalOrderId || !targetResolution.section) return;
    const scrollKey = `${targetResolution.targetRef}:${targetResolution.section}:${targetResolution.ordersTab || ''}`;
    if (scrolledTargetRef.current === scrollKey) return;
    const sectionY = sectionOffsetsRef.current[targetResolution.section];
    const itemEntry = itemOffsetsRef.current[targetResolution.canonicalOrderId];
    if (typeof sectionY === 'number') {
      const targetY = typeof itemEntry?.y === 'number' ? Math.max(0, sectionY + itemEntry.y - 16) : Math.max(0, sectionY - 12);
      contentScrollRef.current?.scrollTo?.({ y: targetY, animated: true });
    }
    if (itemEntry && typeof itemEntry.y === 'number') {
      const innerScroll = sectionScrollRefs.current[targetResolution.section];
      innerScroll?.scrollTo?.({ y: Math.max(0, itemEntry.y - 8), animated: true });
      if (typeof sectionY === 'number') {
        scrolledTargetRef.current = scrollKey;
      }
    }
  }, [targetResolution.canonicalOrderId, targetResolution.ordersTab, targetResolution.section, targetResolution.targetRef]);

  const handleRowLayout = useCallback(
    (rowKey, y) => {
      rowOffsetsRef.current[rowKey] = y;
      ['review', 'exceptions'].forEach((sec) => {
        if (typeof localSectionOffsetsRef.current[sec] === 'number') {
          sectionOffsetsRef.current[sec] = y + localSectionOffsetsRef.current[sec];
        }
      });
      attemptScrollToTarget();
    },
    [attemptScrollToTarget]
  );

  const handleSectionLayout = useCallback(
    (sectionKey, y) => {
      localSectionOffsetsRef.current[sectionKey] = y;
      if (sectionKey === 'review' || sectionKey === 'exceptions') {
        const rowY = rowOffsetsRef.current.primaryOrders || 0;
        sectionOffsetsRef.current[sectionKey] = rowY + y;
      } else {
        sectionOffsetsRef.current[sectionKey] = y;
      }
      attemptScrollToTarget();
    },
    [attemptScrollToTarget]
  );

  const handleTargetCardLayout = useCallback(
    (sectionKey, y) => {
      if (targetResolution.canonicalOrderId) {
        itemOffsetsRef.current[targetResolution.canonicalOrderId] = { section: sectionKey, y };
      }
      attemptScrollToTarget();
    },
    [attemptScrollToTarget, targetResolution.canonicalOrderId]
  );

  useEffect(() => () => {
    if (targetHighlightTimerRef.current) clearTimeout(targetHighlightTimerRef.current);
  }, []);

  useEffect(() => {
    const normalizedParam = String(requestedOrderId || '').trim();
    if (!normalizedParam) {
      openedParamRef.current = '';
      scrolledTargetRef.current = '';
      setActiveTargetId('');
      setTargetHighlighted(false);
      if (targetHighlightTimerRef.current) clearTimeout(targetHighlightTimerRef.current);
      return;
    }

    if (
      (targetResolution.status === 'resolved' || targetResolution.status === 'resolved_decision') &&
      (Boolean(authorizedSource) || Boolean(targetResolution.decisionEvent)) &&
      openedParamRef.current !== normalizedParam
    ) {
      openedParamRef.current = normalizedParam;
      scrolledTargetRef.current = '';
      setActiveTargetId(targetResolution.canonicalOrderId);
      setTargetHighlighted(true);
      const displayRef =
        targetResolution.order?.requestId ||
        targetResolution.decisionEvent?.requestId ||
        targetResolution.canonicalOrderId;
      setToast({
        visible: true,
        message: `Focused Order #${displayRef} in ${targetResolution.sectionTitle}.`,
        type: 'info',
      });
      setTimeout(() => attemptScrollToTarget(), 60);
      if (targetHighlightTimerRef.current) clearTimeout(targetHighlightTimerRef.current);
      targetHighlightTimerRef.current = setTimeout(() => setTargetHighlighted(false), TARGET_HIGHLIGHT_DURATION_MS);
    } else if (targetResolution.status === 'unavailable' && openedParamRef.current !== `missing:${normalizedParam}`) {
      openedParamRef.current = `missing:${normalizedParam}`;
      setActiveTargetId('');
      setTargetHighlighted(false);
      setToast({
        visible: true,
        message: targetResolution.fallbackMessage,
        type: 'error',
      });
      setTimeout(() => contentScrollRef.current?.scrollTo?.({ y: 0, animated: true }), 60);
    }
  }, [attemptScrollToTarget, authorizedSource, requestedOrderId, targetResolution]);

  const effectiveTargetId = activeTargetId || targetResolution.canonicalOrderId;

  return (
    <ManagerShell
      active="requests"
      title="Requests & Exceptions"
      subtitle="Delivery approvals, branch transfers, and order adjustments"
      contentScrollRef={contentScrollRef}
    >
      <TopToastFeedback
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast((t) => ({ ...t, visible: false }))}
      />
      {Boolean(targetResolution.status === 'unavailable' && dismissedUnavailableRef !== targetResolution.targetRef) ? (
        <View style={styles.notificationTargetCard}>
          <View style={styles.notificationTargetHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.notificationTargetEyebrow}>TARGET ORDER UNAVAILABLE</Text>
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.notificationTargetTitle}>
                Order #{targetResolution.targetRef}
              </Text>
              <Text style={styles.notificationTargetText} numberOfLines={2} ellipsizeMode="tail">
                {targetResolution.fallbackMessage}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Dismiss target order notice"
              onPress={() => setDismissedUnavailableRef(targetResolution.targetRef)}
              style={styles.notificationTargetButton}
            >
              <Text style={styles.notificationTargetButtonText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {/* Primary Approvals Row: Upcoming / Normal Orders & Delivery Exceptions Side-by-Side */}
      <View
        style={styles.ordersRow}
        onLayout={(event) => handleRowLayout('primaryOrders', event.nativeEvent.layout.y)}
      >
        <ReceivedRequestsQueue
          orders={dispatchData.review}
          loading={realtime.loading}
          styles={styles}
          colors={colors}
          isDark={isDark}
          onShowToast={showToast}
          onOpenOrder={handleOpenOrder}
          targetOrderId={effectiveTargetId}
          targetHighlighted={targetHighlighted}
          onSectionLayout={handleSectionLayout}
          onTargetCardLayout={handleTargetCardLayout}
          sectionScrollRef={(node) => {
            sectionScrollRefs.current.review = node;
          }}
          style={styles.ordersColumnCard}
        />

        <OutsideRadiusApprovalQueue
          orders={dispatchData.exceptions}
          loading={realtime.loading}
          styles={styles}
          colors={colors}
          isDark={isDark}
          onShowToast={showToast}
          onOpenOrder={handleOpenOrder}
          targetOrderId={effectiveTargetId}
          targetHighlighted={targetHighlighted}
          onSectionLayout={handleSectionLayout}
          onTargetCardLayout={handleTargetCardLayout}
          sectionScrollRef={(node) => {
            sectionScrollRefs.current.exceptions = node;
          }}
          style={styles.ordersColumnCard}
        />
      </View>

      {/* 3. Branch Orders Overview & Situational Order Edit */}
      <BranchOrdersOverview
        data={dispatchData}
        loading={realtime.loading}
        styles={styles}
        colors={colors}
        isDark={isDark}
        onOpenOrder={handleOpenOrder}
        initialFilter={requestedFilter}
        viewAllTick={viewAllTick}
        targetOrderId={effectiveTargetId}
        targetOrdersTab={targetResolution.section === 'branchOrders' ? targetResolution.ordersTab : null}
        targetHighlighted={targetHighlighted}
        onSectionLayout={handleSectionLayout}
        onTargetCardLayout={handleTargetCardLayout}
        sectionScrollRef={(node) => {
          sectionScrollRefs.current.branchOrders = node;
        }}
      />

      {/* 4. Branch Transfers Queue */}
      <BranchTransfersQueue
        data={dispatchData}
        styles={styles}
        colors={colors}
        isDark={isDark}
        onShowToast={showToast}
        onOpenOrder={handleOpenOrder}
        targetOrderId={effectiveTargetId}
        targetHighlighted={targetHighlighted}
        revealDecisions={Boolean(targetResolution.section === 'transfers' && targetResolution.revealDecisions)}
        onSectionLayout={handleSectionLayout}
        onTargetCardLayout={handleTargetCardLayout}
        sectionScrollRef={(node) => {
          sectionScrollRefs.current.transfers = node;
        }}
      />

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

const createStyles = (
  colors,
  width = 1200,
  isDark = false,
  isTwoColumn = (width >= 1100)
) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: width < 430 ? 14 : 18,
      marginBottom: 20,
      shadowColor: '#000000',
      shadowOpacity: isDark ? 0.25 : 0.03,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    ordersRow: {
      flexDirection: isTwoColumn ? 'row' : 'column',
      alignItems: 'stretch',
      gap: isTwoColumn ? 16 : 20,
      marginBottom: 20,
      width: '100%',
    },
    ordersColumnCard: {
      flexGrow: isTwoColumn ? 1 : 0,
      flexShrink: isTwoColumn ? 1 : 0,
      flexBasis: isTwoColumn ? 0 : 'auto',
      minWidth: 0,
      width: '100%',
      alignSelf: 'stretch',
      marginBottom: 0,
    },
    cardHeaderRow: {
      flexDirection: width < 377 ? 'column' : 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 14,
      width: '100%',
      minWidth: 0,
    },
    orderHeaderAside: {
      flexDirection: width < 377 ? 'row' : 'column',
      alignItems: width < 377 ? 'center' : 'flex-end',
      justifyContent: 'space-between',
      alignSelf: width < 377 ? 'stretch' : 'auto',
      gap: 6,
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
      flexShrink: 1,
      minWidth: 0,
    },
    subSectionTitle: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
      marginBottom: 8,
    },
    decisionsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    decisionsToggle: {
      minHeight: 40,
      minWidth: 56,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 'auto',
      backgroundColor: colors.surfaceAlt,
    },
    decisionsToggleText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
    decisionsHeaderTitle: {
      flex: 1,
      minWidth: 0,
      marginBottom: 0,
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
      minHeight: 96,
      marginVertical: 4,
    },
    inlineVisualEmpty: {
      width: '100%',
      minHeight: 96,
      marginVertical: 4,
    },
    sectionScroll: {
      width: '100%',
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: 'auto',
    },
    sectionContent: {
      paddingBottom: 4,
      flexGrow: 1,
      flexShrink: 0,
    },
    orderItem: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
      shadowColor: '#000000',
      shadowOpacity: isDark ? 0.15 : 0.02,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    orderItemTargetHighlighted: {
      borderWidth: 2,
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.14)' : colors.primarySoft,
      shadowColor: colors.primary,
      shadowOpacity: isDark ? 0.32 : 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    targetOrderBadge: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.22)' : colors.surface,
      alignSelf: 'flex-start',
    },
    targetOrderBadgeText: {
      color: colors.primary,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.4,
    },
    orderHeaderRow: {
      flexDirection: width < 377 ? 'column' : 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
      width: '100%',
      minWidth: 0,
    },
    orderHeaderMain: {
      flex: 1,
      minWidth: 0,
    },
    requesterName: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '800',
      flexShrink: 1,
      minWidth: 0,
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
      marginTop: 8,
      flexShrink: 1,
      minWidth: 0,
    },
    productPricingRow: {
      flexDirection: width < 550 ? 'column' : 'row',
      alignItems: width < 550 ? 'stretch' : 'flex-start',
      justifyContent: 'space-between',
      gap: 8,
      marginTop: 8,
      width: '100%',
      minWidth: 0,
    },
    productsSummaryInline: {
      flex: 1,
      marginTop: 0,
    },
    requestProductInfo: {
      flex: 1,
      minWidth: 0,
    },
    requestDeliveryInfo: {
      gap: 3,
      marginTop: 4,
      minWidth: 0,
    },
    orderTotalSummary: {
      minWidth: width < 550 ? 0 : 120,
      flexShrink: 0,
      alignItems: width < 550 ? 'flex-start' : 'flex-end',
    },
    totalLabel: {
      color: colors.textSecondary,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.6,
    },
    deliveryFeeText: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 15,
      marginTop: 2,
      textAlign: width < 550 ? 'left' : 'right',
    },
    detailsBlock: {
      gap: 4,
      marginTop: 4,
      width: '100%',
      minWidth: 0,
      backgroundColor: isDark ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.08)',
      borderLeftWidth: 3,
      borderLeftColor: colors.warning,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    detailLine: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      flexShrink: 1,
      minWidth: 0,
    },
    detailFieldLabel: {
      color: colors.textSecondary,
      fontWeight: '700',
    },
    detailFieldValue: {
      color: colors.textPrimary,
      fontWeight: '500',
    },
    amountText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '900',
      marginTop: 2,
    },
    actionRow: {
      flexDirection: width < 440 ? 'column' : 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 8,
    },
    actionSecondaryGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      flexShrink: 1,
      flexGrow: width < 440 ? 1 : 0,
      minWidth: 0,
      width: width < 440 ? '100%' : 'auto',
    },
    actionDecisionGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      flexShrink: 1,
      flexGrow: width < 440 ? 1 : 0,
      minWidth: 0,
      justifyContent: width < 440 ? 'stretch' : 'flex-end',
      width: width < 440 ? '100%' : 'auto',
    },
    requestActionRow: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      marginTop: 8,
      paddingTop: 10,
    },
    chatActionWrap: {
      width: 44,
      minWidth: 44,
      maxWidth: 44,
      minHeight: 44,
      maxHeight: 48,
      height: 44,
      flexShrink: 0,
      flexGrow: 0,
      flexBasis: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    managerChatButton: {
      width: 38,
      minWidth: 38,
      maxWidth: 38,
      minHeight: 38,
      maxHeight: 40,
      height: 38,
      flexShrink: 0,
      flexGrow: 0,
      flexBasis: 38,
      borderRadius: 10,
      paddingHorizontal: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionButton: {
      flexGrow: width < 440 ? 1 : 0,
      flexShrink: 1,
      flexBasis: 'auto',
      minWidth: width < 440 ? 0 : 70,
      minHeight: 38,
      maxHeight: 40,
      height: 38,
      paddingHorizontal: 10,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewDetailsBtn: {
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    viewDetailsBtnText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
    approveButton: {
      backgroundColor: colors.successAction,
    },
    approveButtonText: {
      color: colors.onSuccess,
      fontSize: 12,
      fontWeight: '800',
    },
    declineButton: {
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: colors.danger,
    },
    declineButtonText: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '800',
    },
    editOrderBtn: {
      borderWidth: 1,
      borderColor: colors.primaryAction,
      backgroundColor: colors.primaryAction,
    },
    editOrderBtnText: {
      color: colors.onPrimary || '#FFFFFF',
      fontSize: 12,
      fontWeight: '800',
    },
    overviewActionRow: {
      justifyContent: width < 440 ? 'stretch' : 'flex-end',
    },
    overviewActionGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      flexShrink: 1,
      flexGrow: width < 440 ? 1 : 0,
      width: width < 440 ? '100%' : 'auto',
      justifyContent: width < 440 ? 'space-between' : 'flex-end',
    },
    overviewActionButton: {
      flexGrow: width < 440 ? 1 : 0,
      flexShrink: 1,
      flexBasis: 'auto',
      minWidth: width < 440 ? 0 : 130,
      paddingHorizontal: 12,
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
      shadowColor: '#000000',
      shadowOpacity: isDark ? 0.15 : 0.02,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    declineBox: {
      marginTop: 8,
      gap: 6,
    },
    confirmDeclineBtn: {
      alignSelf: 'flex-start',
      minHeight: 44,
      paddingHorizontal: 14,
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
      padding: 14,
      marginBottom: 10,
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
    branchOrdersToolbar: {
      flexDirection: width < 768 ? 'column' : 'row',
      alignItems: width < 768 ? 'stretch' : 'center',
      justifyContent: 'space-between',
      gap: 10,
      marginTop: 4,
      marginBottom: 12,
      width: '100%',
    },
    branchOrdersPillGroup: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 6,
      flexGrow: width < 768 ? 0 : 1,
      flexShrink: 1,
      flexBasis: width < 768 ? 'auto' : 0,
      minWidth: 0,
    },
    branchOrdersSearchWrap: {
      width: width < 768 ? '100%' : 300,
      maxWidth: width < 768 ? '100%' : 340,
      minWidth: width < 768 ? 0 : 220,
      flexShrink: 0,
    },
    searchBarWrap: {
      marginBottom: 12,
    },
    searchBarWrapCompact: {
      width: 200,
    },
    searchInput: {
      height: 44,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: 12,
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
      maxHeight: '92%',
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
    detailGrid: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      overflow: 'hidden',
    },
    detailGridRow: {
      flexDirection: width < 520 ? 'column' : 'row',
      justifyContent: 'space-between',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    detailGridLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
    detailGridValue: { flexShrink: 1, color: colors.textPrimary, fontSize: 12, fontWeight: '800', textAlign: width < 520 ? 'left' : 'right' },
    locationUnavailable: {
      minHeight: 120,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
    },
    locationUnavailableText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
    itemEditRow: {
      flexDirection: width < 430 ? 'column' : 'row',
      alignItems: width < 430 ? 'flex-start' : 'center',
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
      flexDirection: width < 430 ? 'column' : 'row',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 12,
    },
    notificationTargetCard: {
      width: '100%',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderLeftWidth: 4,
      borderLeftColor: colors.warning,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: width < 430 ? 12 : 16,
      marginBottom: 16,
    },
    notificationTargetHighlighted: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    notificationTargetHeader: {
      flexDirection: width < 430 ? 'column' : 'row',
      alignItems: width < 430 ? 'flex-start' : 'center',
      justifyContent: 'space-between',
      gap: 10,
      minWidth: 0,
    },
    notificationTargetEyebrow: { color: colors.warning, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
    notificationTargetTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 2 },
    notificationTargetText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
    notificationTargetButton: {
      alignSelf: width < 430 ? 'stretch' : 'center',
      minHeight: 36,
      height: 36,
      paddingHorizontal: 14,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    notificationTargetButtonText: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
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
    paginationContainer: {
      flexDirection: width < 480 ? 'column' : 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingTop: 10,
      marginTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      width: '100%',
    },
    paginationRangeText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    paginationNavRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    paginationBtn: {
      minHeight: 32,
      height: 32,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    paginationBtnDisabled: {
      opacity: 0.45,
    },
    paginationBtnText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '700',
    },
    paginationBtnTextDisabled: {
      color: colors.textSecondary,
    },
    paginationNumberBtn: {
      minWidth: 32,
      height: 32,
      paddingHorizontal: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    paginationNumberBtnActive: {
      borderColor: colors.primaryAction,
      backgroundColor: colors.primaryAction,
    },
    paginationNumberText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '700',
    },
    paginationNumberTextActive: {
      color: colors.onPrimary || '#FFFFFF',
    },
    paginationEllipsis: {
      color: colors.textSecondary,
      fontSize: 12,
      paddingHorizontal: 2,
    },
  });
