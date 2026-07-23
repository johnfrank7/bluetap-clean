import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import SoftStatusBadge from './SoftStatusBadge';
import { createShadow } from './shadowStyles';

const BLUE = '#187BCD';
const BLUE_LIGHT = '#E3F2FD';
const CARD_BORDER = '#D7ECFF';
const TEXT_MUTED = '#6F8EA8';
const TEXT_DARK = '#20384D';

const formatAmount = (amount) => {
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

const normalizeProduct = (item = {}, index) => ({
  id: item.id || item.product_id || `${item.productName || item.product_name || 'product'}-${index}`,
  productName: item.productName || item.product_name || 'Product',
  quantity: displayValue(item.quantity),
  unitPrice: Number(item.unitPrice ?? item.product_price ?? item.price ?? 0),
  subtotal: Number(item.subtotal ?? item.line_total ?? 0),
});

export default function RequestDetailsModal({
  visible,
  onClose,
  request,
}) {
  const requesterUniqueId =
    request?.requesterUniqueId || request?.requester_unique_id || '';
  const distributorName =
    request?.distributorName || request?.distributor_name || '';
  const distributorUniqueId =
    request?.distributorUniqueId || request?.distributor_unique_id || '';
  const hasDistributorInfo = !!(distributorName || distributorUniqueId);
  const products = Array.isArray(request?.items)
    ? request.items.map(normalizeProduct)
    : [];
  const topRows = [
    [
      { label: 'Request ID', value: request?.requestId },
      { label: 'Status', status: request?.status },
    ],
    [
      { label: 'Order Date', value: request?.orderDate },
      { label: 'Delivery Date', value: request?.deliveryDate },
    ],
    [
      { label: 'Product', value: request?.product },
      { label: 'Container Type', value: request?.containerType },
    ],
    [
      { label: 'Quantity', value: request?.quantity },
      { label: 'Total Amount', value: formatAmount(request?.totalAmount) },
    ],
    [
      { label: 'Water Station', value: request?.waterStation },
      { label: 'Payment Method', value: request?.paymentMethod },
    ],
  ];
  const customerRows = [
    [
      { label: 'Requester Name', value: request?.requesterName || request?.customerName },
      { label: 'Requester ID', value: requesterUniqueId },
    ],
    ...(hasDistributorInfo
      ? [
          [
            { label: 'Distributor Name', value: distributorName },
            { label: 'Distributor ID', value: distributorUniqueId },
          ],
        ]
      : []),
    [{ label: 'Contact Number', value: request?.contactNumber }],
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.modal}>
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
                    {displayValue(request?.deliveryAddress)}
                  </Text>
                </View>
              </View>
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

              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>Grand Total Amount</Text>
                <Text style={styles.grandTotalValue}>
                  {formatAmount(request?.grandTotalAmount ?? request?.totalAmount)}
                </Text>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 31, 51, 0.46)',
    justifyContent: 'flex-end',
    alignItems: 'center',
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
    fontWeight: 'bold',
    marginBottom: 4,
  },
  summaryValue: {
    color: TEXT_DARK,
    fontSize: 13,
    fontWeight: '700',
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
  grandTotalRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 14,
    backgroundColor: '#F8FCFF',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 12,
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
});
