import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import SoftStatusBadge from './SoftStatusBadge';
import { createShadow } from './shadowStyles';
import { createPortalStyleSheet, useBlueTapTheme } from './BlueTapTheme';
import { formatDisplayUniqueId } from '../services/uniqueIds';
const { formatDeliveryFailureReason } = require('../constants/deliveryFailureReasons');
const { branchMapDataForRequest } = require('./locationMapModel');

const BLUE = '#187BCD';
const BLUE_LIGHT = '#E3F2FD';
const CARD_BORDER = '#D7ECFF';
const TEXT_MUTED = '#6F8EA8';
const TEXT_DARK = '#20384D';
const LazyLocationMap = React.lazy(() => import('./LocationMap'));

const formatAmount = (amount) => {
  if (amount === undefined || amount === null || amount === '') {
    return 'Not set';
  }

  if (typeof amount === 'string' && amount.trim()) {
    return amount.trim().startsWith('\u20B1')
      ? amount.trim()
      : `\u20B1${Number(amount || 0).toFixed(2)}`;
  }

  return `\u20B1${Number(amount || 0).toFixed(2)}`;
};

const displayValue = (value) => {
  if (value === undefined || value === null || value === '') return 'Not set';
  return String(value);
};

const normalizeAmount = (value) =>
  value === undefined || value === null || value === '' ? undefined : Number(value);

const normalizeProduct = (item = {}, index) => ({
  id: item.id || item.product_id || `${item.productName || item.product_name || 'product'}-${index}`,
  productName: item.productNameSnapshot || item.productName || item.product_name || 'Product',
  quantity: displayValue(item.quantity),
  unitPrice: normalizeAmount(item.unitPriceAtOrder ?? item.unitPrice ?? item.product_price ?? item.price),
  subtotal: normalizeAmount(item.totalAtOrder ?? item.subtotal ?? item.line_total),
});

export default function RequestDetailsModal({
  visible,
  onClose,
  request,
  branches = [],
  onCancel,
  onEdit,
}) {
  const { colors } = useBlueTapTheme();
  const { width } = useWindowDimensions();
  const compact = width < 600;
  const requestReference = request?.requestId || request?.request_id || request?.id;
  const waterStation = request?.waterStation || request?.currentBranchName || request?.currentBranchNameSnapshot || request?.branchNameSnapshot || request?.water_station;
  const deliveryAddress = request?.deliveryAddress || request?.addressSnapshot || request?.address || request?.deliveryLocation?.address;
  const branchMapData = branchMapDataForRequest(request, branches);
  const failureReason = formatDeliveryFailureReason(request, '');
  const requesterUniqueId = formatDisplayUniqueId(
    request?.requesterUniqueId || request?.requester_unique_id || request?.requesterId,
    'Not assigned'
  );
  const distributorName = request?.distributorNameSnapshot ||
    request?.distributorName || request?.distributor_name || '';
  const distributorUniqueId = formatDisplayUniqueId(
    request?.distributorPublicUidSnapshot || request?.distributorUniqueId || request?.distributor_unique_id,
    'Not assigned'
  );
  const products = Array.isArray(request?.items)
    ? request.items.map(normalizeProduct)
    : [];
  const topRows = [
    [
      { label: 'Request ID', value: requestReference },
      { label: 'Status', status: request?.status },
    ],
    [
      { label: 'Order Date', value: request?.orderDate },
      { label: 'Delivery Date', value: request?.deliveryDate },
    ],
    [
      { label: 'Water Station', value: waterStation },
      { label: 'Payment Method', value: 'Cash on Delivery' },
    ],
  ];
  const customerRows = [
    [
      { label: 'Requester Name', value: request?.requesterName || request?.customerName },
      { label: 'Requester ID', value: requesterUniqueId },
    ],
    [
      { label: 'Distributor Name', value: distributorName || 'Not assigned' },
      { label: 'Distributor ID', value: distributorUniqueId },
    ],
    [{ label: 'Contact Number', value: request?.contactNumber }],
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, !compact && styles.desktopBackdrop, { backgroundColor: colors.overlay }]}>
        <View style={[styles.modal, !compact && styles.desktopModal]}>
          <View style={styles.header}>
            <Text style={styles.title}>Request Details</Text>
            <TouchableOpacity activeOpacity={0.75} onPress={onClose}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.summaryGrid}>
              {topRows.map((row, rowIndex) => (
                <View
                  key={`summary-row-${rowIndex}`}
                  style={[
                    styles.summaryRow,
                    rowIndex > 0 && styles.summaryRowDivider,
                  ]}
                >
                  {row.map((item) => (
                    <View key={item.label} style={styles.summaryCell}>
                      <Text style={styles.summaryLabel}>{item.label}</Text>
                      {item.status ? (
                        <SoftStatusBadge status={item.status} />
                      ) : (
                        <Text style={styles.summaryValue} numberOfLines={2}>
                          {displayValue(item.value)}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              ))}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Customer Information</Text>
              <View style={styles.customerGrid}>
                {customerRows.map((row, rowIndex) => (
                  <View
                    key={`customer-row-${rowIndex}`}
                    style={[
                      styles.customerRow,
                      rowIndex > 0 && styles.customerRowDivider,
                    ]}
                  >
                    {row.map((item) => (
                      <View key={item.label} style={styles.customerCell}>
                        <Text style={styles.summaryLabel}>{item.label}</Text>
                        <Text style={styles.summaryValue} numberOfLines={2}>
                          {displayValue(item.value)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}

                <View style={[styles.customerCell, styles.addressCell]}>
                  <Text style={styles.summaryLabel}>Delivery Address</Text>
                  <Text style={styles.summaryValue}>
                    {displayValue(deliveryAddress)}
                  </Text>
                </View>
              </View>
            </View>

            {!!failureReason && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Delivery Attempt</Text>
                <View style={styles.failureCard}>
                  <Text style={styles.summaryLabel}>Failure reason</Text>
                  <Text style={styles.failureValue}>{failureReason}</Text>
                </View>
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Delivery Location Map</Text>
              {Number.isFinite(request?.deliveryLocation?.latitude) && Number.isFinite(request?.deliveryLocation?.longitude) ? (
                <View style={styles.mapContainer}>
                  <React.Suspense fallback={<View style={styles.mapLoading}><Text style={styles.mapLoadingText}>Loading delivery map…</Text></View>}>
                    <LazyLocationMap
                      location={request.deliveryLocation}
                      branches={branchMapData ? [branchMapData] : []}
                      selectedBranchId={branchMapData?.id}
                      readOnly={true}
                      height={170}
                      themed={true}
                    />
                  </React.Suspense>
                </View>
              ) : (
                <View style={styles.locationUnavailable}><Text style={styles.locationUnavailableText}>Location unavailable</Text></View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Ordered Products</Text>

              <View style={styles.productsTable}>
                <View style={styles.productHeaderRow}>
                  <Text style={[styles.productHeaderText, styles.productNameColumn]}>
                    Product
                  </Text>
                  <Text style={styles.productHeaderText}>Quantity</Text>
                  <Text style={styles.productHeaderText}>Unit Price</Text>
                  <Text style={styles.productHeaderText}>Subtotal</Text>
                </View>

                {products.length === 0 ? (
                  <Text style={styles.emptyText}>No product details available.</Text>
                ) : (
                  products.map((item, index) => (
                    <View
                      key={item.id || `${item.productName}-${index}`}
                      style={[
                        styles.productRow,
                        index > 0 && styles.productRowDivider,
                      ]}
                    >
                      <Text
                        style={[styles.productValue, styles.productNameColumn]}
                        numberOfLines={2}
                      >
                        {item.productName}
                      </Text>
                      <Text style={styles.productValue} numberOfLines={1}>
                        {item.quantity}
                      </Text>
                      <Text style={styles.productValue} numberOfLines={1}>
                        {formatAmount(item.unitPrice)}
                      </Text>
                      <Text style={styles.productValue} numberOfLines={1}>
                        {formatAmount(item.subtotal)}
                      </Text>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.totalsCard}>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Subtotal</Text>
                  <Text style={styles.totalValue}>{formatAmount(request?.subtotalAtOrder ?? request?.subtotal ?? products.reduce((sum, item) => sum + Number(item.subtotal || 0), 0))}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Delivery Fee</Text>
                  <Text style={styles.totalValue}>{formatAmount(request?.deliveryFeeAtOrder ?? request?.deliveryFee ?? 0)}</Text>
                </View>
                <View style={[styles.totalRow, styles.grandTotalRow]}>
                  <Text style={styles.grandTotalLabel}>Grand Total</Text>
                  <Text style={styles.grandTotalValue}>{formatAmount(request?.grandTotalAmount ?? request?.totalAmount)}</Text>
                </View>
              </View>

              {typeof onEdit === 'function' && (
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.modalEditButton}
                  onPress={onEdit}
                >
                  <Text style={styles.modalEditText}>Edit Order</Text>
                </TouchableOpacity>
              )}

              {typeof onCancel === 'function' && (
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.modalCancelButton}
                  onPress={onCancel}
                >
                  <Text style={styles.modalCancelText}>Cancel Request</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = createPortalStyleSheet({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 31, 51, 0.46)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  desktopBackdrop: {
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    width: '100%',
    maxWidth: 430,
    maxHeight: '90%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
    ...createShadow({
      color: '#0D47A1',
      elevation: 10,
      opacity: 0.18,
      radius: 14,
      offset: { width: 0, height: 6 },
    }),
  },
  desktopModal: {
    maxWidth: 720,
    borderRadius: 22,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    flex: 1,
    color: BLUE,
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeText: {
    color: BLUE,
    fontSize: 12,
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: BLUE_LIGHT,
    marginTop: 12,
    marginBottom: 12,
  },
  scroll: {
    width: '100%',
  },
  scrollContent: {
    paddingBottom: 4,
  },
  summaryGrid: {
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  summaryRow: {
    flexDirection: 'row',
  },
  summaryRowDivider: {
    borderTopWidth: 1,
    borderTopColor: BLUE_LIGHT,
  },
  summaryCell: {
    flex: 1,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  summaryLabel: {
    color: TEXT_MUTED,
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 4,
  },
  summaryValue: {
    color: TEXT_DARK,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 17,
  },
  section: {
    marginTop: 14,
  },
  sectionTitle: {
    color: BLUE,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 9,
  },
  customerGrid: {
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  customerRow: {
    flexDirection: 'row',
  },
  customerRowDivider: {
    borderTopWidth: 1,
    borderTopColor: BLUE_LIGHT,
  },
  customerCell: {
    flex: 1,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  addressCell: {
    borderTopWidth: 1,
    borderTopColor: BLUE_LIGHT,
  },
  productsTable: {
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  productHeaderRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F4FAFF',
    paddingHorizontal: 10,
  },
  productHeaderText: {
    flex: 1,
    color: TEXT_MUTED,
    fontSize: 9,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  productNameColumn: {
    flex: 1.35,
    textAlign: 'left',
  },
  productRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  productRowDivider: {
    borderTopWidth: 1,
    borderTopColor: BLUE_LIGHT,
  },
  productValue: {
    flex: 1,
    color: TEXT_DARK,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15,
    textAlign: 'center',
  },
  emptyText: {
    color: TEXT_MUTED,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  totalsCard: {
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 14,
    backgroundColor: '#F8FCFF',
    paddingHorizontal: 12,
    marginTop: 12,
  },
  totalRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
  },
  grandTotalRow: {
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
  },
  totalLabel: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: '700',
  },
  totalValue: {
    color: TEXT_DARK,
    fontSize: 12,
    fontWeight: '800',
  },
  grandTotalLabel: {
    flex: 1,
    color: TEXT_DARK,
    fontSize: 13,
    fontWeight: 'bold',
  },
  grandTotalValue: {
    color: BLUE,
    fontSize: 15,
    fontWeight: 'bold',
  },
  modalCancelButton: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  modalCancelText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '700',
  },
  modalEditButton: {
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#7DD3FC',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  modalEditText: {
    color: '#0284C7',
    fontSize: 14,
    fontWeight: '700',
  },
  mapContainer: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  mapLoading: {
    height: 170,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7FBFF',
  },
  mapLoadingText: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
  locationUnavailable: {
    minHeight: 110,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    backgroundColor: '#F7FBFF',
  },
  locationUnavailableText: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: '700',
  },
  failureCard: {
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#FEF2F2',
  },
  failureValue: {
    color: TEXT_DARK,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
  },
});
