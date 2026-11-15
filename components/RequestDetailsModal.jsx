import React from 'react';
import {
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import SoftStatusBadge from './SoftStatusBadge';
import SavedOrderPricing from './SavedOrderPricing';
import OngoingRequestFieldIcon from './OngoingRequestFieldIcon';
import { createShadow } from './shadowStyles';
import { createPortalStyleSheet, useBlueTapTheme } from './BlueTapTheme';
import { formatDisplayUniqueId } from '../services/uniqueIds';
import { normalizeRequestDetails } from '../services/orderNormalizer';
const { formatDeliveryFailureReason } = require('../constants/deliveryFailureReasons');
const { branchMapDataForRequest } = require('./locationMapModel');
const { analyzeOrderCargo } = require('../services/managerTripCapacity');

const BLUE = '#187BCD';
const BLUE_LIGHT = '#E3F2FD';
const CARD_BORDER = '#D7ECFF';
const TEXT_MUTED = '#6F8EA8';
const TEXT_DARK = '#20384D';
const LazyLocationMap = React.lazy(() => import('./LocationMap'));

const displayValue = (value) => {
  if (value === undefined || value === null || value === '') return 'Not set';
  return String(value);
};

export default function RequestDetailsModal({
  visible,
  onClose,
  onDismiss,
  request,
  branches = [],
  onCancel,
  onEdit,
  hasDeliveryReports = false,
  reportsLoading = false,
  reportsError = '',
  onRetryDeliveryReports,
  onViewDeliveryReports,
}) {
  const { colors, isDark } = useBlueTapTheme();
  const reportActionColor = isDark ? colors.primaryLight : colors.primaryAction;
  const { height, width } = useWindowDimensions();
  const compact = width < 600;
  const modalMaxHeight = Math.max(1, height - (compact ? 24 : 40));
  const normalized = React.useMemo(() => normalizeRequestDetails(request), [request]);
  const activeRequest = normalized || request;
  const requestReference = activeRequest?.requestId || activeRequest?.request_id || activeRequest?.id;
  const waterStation = activeRequest?.waterStation || activeRequest?.currentBranchName || activeRequest?.currentBranchNameSnapshot || activeRequest?.branchNameSnapshot || activeRequest?.water_station;
  const deliveryAddress = activeRequest?.deliveryAddress || activeRequest?.addressSnapshot || activeRequest?.address || activeRequest?.deliveryLocation?.address;
  const branchMapData = branchMapDataForRequest(request, branches);
  const failureReason = formatDeliveryFailureReason(request, '');
  const requesterUniqueId = formatDisplayUniqueId(
    activeRequest?.requesterUniqueId || activeRequest?.requester_unique_id || activeRequest?.requesterId,
    'Not assigned'
  );
  const distributorName = activeRequest?.distributorNameSnapshot ||
    activeRequest?.distributorName || activeRequest?.distributor_name || '';
  const distributorUniqueId = formatDisplayUniqueId(
    activeRequest?.distributorPublicUidSnapshot || activeRequest?.distributorUniqueId || activeRequest?.distributor_unique_id,
    'Not assigned'
  );
  const topRows = [
    [
      { label: 'Request ID', value: requestReference, icon: 'Receipt' },
      { label: 'Status', status: activeRequest?.status || request?.status, icon: 'Layers' },
    ],
    [
      { label: 'Order Date', value: activeRequest?.orderDate, icon: 'CalendarClock' },
      { label: 'Delivery Date', value: activeRequest?.deliveryDate, icon: 'ClockHistory' },
    ],
    [
      { label: 'Water Station', value: waterStation, icon: 'Building2' },
      { label: 'Payment Method', value: activeRequest?.paymentMethod || 'Cash on Delivery', icon: 'Wallet' },
    ],
    ...(Boolean(activeRequest?.tripNumber || activeRequest?.tripId) ? [
      [
        {
          label: 'Trip Allocation',
          value: (() => {
            const cargo = analyzeOrderCargo(activeRequest);
            return `Trip #${activeRequest?.tripNumber || 1}${cargo.badgeLabel ? ` · ${cargo.badgeLabel}` : ''}`;
          })(),
          icon: 'Truck',
        },
        { label: 'Trip Status', value: activeRequest?.tripStatus ? activeRequest.tripStatus.replace(/_/g, ' ').toUpperCase() : 'APPROVED', icon: 'Layers' },
      ],
    ] : []),
  ];
  const customerRows = [
    [
      { label: 'Requester Name', value: activeRequest?.requesterName || activeRequest?.customerName, icon: 'User' },
      { label: 'Requester ID', value: requesterUniqueId, icon: 'ShieldCheck' },
    ],
    [
      { label: 'Distributor Name', value: distributorName || 'Not assigned', icon: 'Truck' },
      { label: 'Distributor ID', value: distributorUniqueId, icon: 'ShieldCheck' },
    ],
    [{ label: 'Contact Number', value: activeRequest?.contactNumber, icon: 'Phone' }],
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <View style={[styles.backdrop, compact ? styles.compactBackdrop : styles.desktopBackdrop, { backgroundColor: colors.overlay }]}>
        <View accessibilityViewIsModal style={[styles.modal, compact ? styles.compactModal : styles.desktopModal, { maxHeight: modalMaxHeight }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Request Details</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close request details" activeOpacity={0.75} onPress={onClose} style={styles.closeButton}>
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
                    compact && styles.compactGridRow,
                    rowIndex > 0 && styles.summaryRowDivider,
                  ]}
                >
                  {row.map((item, itemIndex) => (
                    <View
                      key={item.label}
                      style={[
                        styles.summaryCell,
                        compact && styles.compactGridCell,
                        compact && itemIndex > 0 && styles.compactGridCellDivider,
                      ]}
                    >
                      <View style={styles.labelWithIcon}>
                        {!!item.icon && (
                          <OngoingRequestFieldIcon
                            name={item.icon}
                            size={13}
                            tintColor={colors.iconSecondary || TEXT_MUTED}
                          />
                        )}
                        <Text style={styles.summaryLabel}>{item.label}</Text>
                      </View>
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
              <View style={styles.sectionTitleRow}>
                <OngoingRequestFieldIcon name="User" size={15} tintColor={BLUE} />
                <Text style={styles.sectionTitle}>Customer Information</Text>
              </View>
              <View style={styles.customerGrid}>
                {customerRows.map((row, rowIndex) => (
                  <View
                    key={`customer-row-${rowIndex}`}
                    style={[
                      styles.customerRow,
                      compact && styles.compactGridRow,
                      rowIndex > 0 && styles.customerRowDivider,
                    ]}
                  >
                    {row.map((item, itemIndex) => (
                      <View
                        key={item.label}
                        style={[
                          styles.customerCell,
                          compact && styles.compactGridCell,
                          compact && itemIndex > 0 && styles.compactGridCellDivider,
                        ]}
                      >
                        <View style={styles.labelWithIcon}>
                          {!!item.icon && (
                            <OngoingRequestFieldIcon
                              name={item.icon}
                              size={13}
                              tintColor={colors.iconSecondary || TEXT_MUTED}
                            />
                          )}
                          <Text style={styles.summaryLabel}>{item.label}</Text>
                        </View>
                        <Text style={styles.summaryValue} numberOfLines={2}>
                          {displayValue(item.value)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}

                <View style={[styles.customerCell, styles.addressCell]}>
                  <View style={styles.labelWithIcon}>
                    <OngoingRequestFieldIcon
                      name="MapPin"
                      size={13}
                      tintColor={colors.iconSecondary || TEXT_MUTED}
                    />
                    <Text style={styles.summaryLabel}>Delivery Address</Text>
                  </View>
                  <Text style={styles.summaryValue}>
                    {displayValue(deliveryAddress)}
                  </Text>
                </View>
              </View>
            </View>

            {!!failureReason && (
              <View style={styles.section}>
                <View style={styles.sectionTitleRow}>
                  <OngoingRequestFieldIcon name="ShieldAlert" size={15} tintColor="#DC2626" />
                  <Text style={[styles.sectionTitle, { color: '#DC2626' }]}>Delivery Attempt</Text>
                </View>
                <View style={styles.failureCard}>
                  <Text style={styles.summaryLabel}>Failure reason</Text>
                  <Text style={styles.failureValue}>{failureReason}</Text>
                </View>
              </View>
            )}

            {typeof onViewDeliveryReports === 'function' && (reportsLoading || !!reportsError || hasDeliveryReports) && (
              <View style={styles.section}>
                {reportsLoading ? (
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Checking delivery reports…</Text>
                ) : reportsError ? (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry checking delivery reports"
                    onPress={onRetryDeliveryReports} style={[styles.reportsAction, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                    <Text style={[styles.reportsActionText, { color: reportActionColor }]}>Retry checking delivery reports</Text>
                  </TouchableOpacity>
                ) : hasDeliveryReports ? (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="View delivery reports"
                    onPress={onViewDeliveryReports} style={[styles.reportsAction, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
                    <Text style={[styles.reportsActionText, { color: reportActionColor }]}>View delivery reports</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}

            <View style={styles.section}>
              <View style={styles.sectionTitleRow}>
                <OngoingRequestFieldIcon name="MapPin" size={15} tintColor={BLUE} />
                <Text style={styles.sectionTitle}>Delivery Location Map</Text>
              </View>
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
              <View style={styles.sectionTitleRow}>
                <OngoingRequestFieldIcon name="Package" size={15} tintColor={BLUE} />
                <Text style={styles.sectionTitle}>Ordered Products</Text>
              </View>

              <SavedOrderPricing order={request} colors={colors} />

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
  compactBackdrop: {
    paddingTop: 12,
  },
  modal: {
    width: '100%',
    maxWidth: 430,
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
  compactModal: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  desktopModal: {
    maxWidth: 640,
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
  closeButton: {
    minHeight: 36,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
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
  compactGridRow: {
    flexDirection: 'column',
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
  compactGridCell: {
    flex: 0,
    width: '100%',
  },
  compactGridCellDivider: {
    borderTopWidth: 1,
    borderTopColor: BLUE_LIGHT,
  },
  labelWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  summaryLabel: {
    color: TEXT_MUTED,
    fontSize: 10,
    fontWeight: '600',
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
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 9,
  },
  sectionTitle: {
    color: BLUE,
    fontSize: 14,
    fontWeight: 'bold',
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
  compactProductRow: {
    alignItems: 'stretch',
    flexDirection: 'column',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  compactProductName: {
    flex: 0,
    width: '100%',
    fontSize: 13,
    lineHeight: 18,
  },
  compactProductMeta: {
    flexDirection: 'row',
    gap: 8,
  },
  compactProductField: {
    flex: 1,
    minWidth: 0,
  },
  productMobileLabel: {
    color: TEXT_MUTED,
    fontSize: 9,
    fontWeight: '700',
    marginBottom: 3,
  },
  compactProductValue: {
    color: TEXT_DARK,
    fontSize: 11,
    fontWeight: '800',
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
  totalLabelWrap: {
    flex: 1,
    minWidth: 0,
  },
  feeDetailSubtext: {
    color: TEXT_MUTED,
    fontSize: 10,
    marginTop: 2,
  },
  discountValue: {
    color: '#16A34A',
    fontWeight: '800',
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
  reportsAction: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportsActionText: { fontSize: 13, fontWeight: '800' },
});
