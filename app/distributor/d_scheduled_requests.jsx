import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BlueTapHeader from '../../components/BlueTapHeader';
import RequestDetailsModal from '../../components/RequestDetailsModal';
import SoftStatusBadge from '../../components/SoftStatusBadge';
import { createShadow } from '../../components/shadowStyles';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import DistributorProfileBanner from '../../components/DistributorProfileBanner';
import PortalSwipeContainer, { DISTRIBUTOR_TABS } from '../../components/PortalSwipeContainer';
import { createPortalStyleSheet, useBlueTapTheme } from '../../components/BlueTapTheme';
import TopToastFeedback from '../../components/TopToastFeedback';
import { USER_PORTAL_BOTTOM_CONTENT_INSET, USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import { BLUETAP_COLORS } from '../../constants/bluetapTheme';
import {
  failAssignedDelivery,
  normalizeDistributorOrderStatus,
  rescheduleAssignedDelivery,
  toDistributorScreenOrder,
  updateAssignedDistributorOrder,
  useAssignedDistributorOrders,
} from '../../services/distributorOrders';
import { useDistributorProfile } from '../../services/distributorProfile';
import { formatDisplayUniqueId } from '../../services/uniqueIds';

const BLUE = BLUETAP_COLORS.primary;
const BLUE_LIGHT = BLUETAP_COLORS.primarySoft;
const CARD_BORDER = BLUETAP_COLORS.border;
const TEXT_MUTED = BLUETAP_COLORS.textSecondary;
const TEXT_DARK = BLUETAP_COLORS.textPrimary;

const UPCOMING_STATUSES = new Set([
  'accepted',
  'scheduled',
  'out for delivery',
  'out_for_delivery',
  'delivery failed',
  'delivery_failed',
]);

const TIME_SLOTS = [
  { label: '09:00 AM', hours: 9, minutes: 0 },
  { label: '11:00 AM', hours: 11, minutes: 0 },
  { label: '01:00 PM', hours: 13, minutes: 0 },
  { label: '03:00 PM', hours: 15, minutes: 0 },
  { label: '05:00 PM', hours: 17, minutes: 0 },
];

const getAmountNumber = (amount) =>
  Number(String(amount || '').replace(/[^\d.]/g, '')) || 0;

const getQuantityNumber = (quantity) => {
  const match = String(quantity || '').match(/\d+(\.\d+)?/);
  return Number(match?.[0] || 0);
};

const getDetailsRequestData = (request) => {
  if (!request) return null;

  const totalAmount = getAmountNumber(request.amountDue);
  const quantity = getQuantityNumber(request.quantity);
  const unitPrice = quantity > 0 ? totalAmount / quantity : totalAmount;

  return {
    requestId: request.id,
    status: request.status || 'Scheduled',
    orderDate: 'Not set',
    deliveryDate: request.scheduledDateTime,
    product: request.productName,
    containerType: request.container,
    quantity: request.quantity,
    totalAmount,
    waterStation: 'Not set',
    paymentMethod: 'Not set',
    requesterName: request.requester,
    requesterUniqueId: formatDisplayUniqueId(request.requesterId || request.requester_unique_id || request.requesterUniqueId, 'Not assigned'),
    customerName: request.requester,
    distributorName: request.distributor || request.distributor_name || '',
    distributorUniqueId: formatDisplayUniqueId(request.distributorId || request.distributor_unique_id || request.distributorUniqueId, ''),
    contactNumber: request.contact,
    deliveryAddress: request.address,
    items: [
      {
        id: request.id,
        productName: request.productName,
        quantity: request.quantity,
        unitPrice,
        subtotal: totalAmount,
      },
    ],
    grandTotalAmount: totalAmount,
  };
};

const ScheduledRequestCard = ({
  request,
  onAdvance,
  onOpenFailModal,
  onOpenRescheduleModal,
  onViewDetails,
  processing,
}) => {
  const statusNorm = normalizeDistributorOrderStatus(request.status);
  const isOutForDelivery = statusNorm === 'out for delivery';
  const isDeliveryFailed = statusNorm === 'delivery failed';
  const isScheduledOrAccepted = statusNorm === 'accepted' || statusNorm === 'scheduled';

  return (
    <View style={styles.requestCard}>
      <View style={styles.requestCardHeader}>
        <Text style={styles.requestId}>Request ID: {request.id}</Text>
        <SoftStatusBadge status={request.status} />
      </View>

      <View style={styles.compactInfoGrid}>
        <View style={styles.compactInfoColumn}>
          <Text style={styles.compactLabel}>Customer Name</Text>
          <Text style={styles.compactPrimaryValue} numberOfLines={1}>
            {request.requester}
          </Text>

          <Text style={[styles.compactLabel, styles.compactLabelGap]}>Requester ID</Text>
          <Text style={styles.compactValue} numberOfLines={1}>
            {formatDisplayUniqueId(request.requesterId || request.requester_unique_id || request.requesterUniqueId, 'Not assigned')}
          </Text>

          <Text style={[styles.compactLabel, styles.compactLabelGap]}>Contact Number</Text>
          <Text style={styles.compactValue} numberOfLines={1}>
            {request.contact}
          </Text>
        </View>

        <View style={styles.compactInfoColumn}>
          <Text style={styles.compactLabel}>Product Ordered</Text>
          <Text style={styles.compactPrimaryValue} numberOfLines={1}>
            {request.productName}
          </Text>

          <Text style={[styles.compactLabel, styles.compactLabelGap]}>Container Type</Text>
          <Text style={styles.compactValue} numberOfLines={1}>
            {request.container || 'Standard'}
          </Text>

          <Text style={[styles.compactLabel, styles.compactLabelGap]}>Quantity</Text>
          <Text style={styles.compactValue} numberOfLines={1}>
            {request.quantity}
          </Text>
        </View>
      </View>

      <View style={styles.fullWidthInfoBlock}>
        <Text style={styles.compactLabel}>Delivery Address</Text>
        <Text style={styles.compactAddressValue} numberOfLines={2}>
          {request.address}
        </Text>

        <Text style={[styles.compactLabel, styles.compactLabelGap]}>Scheduled Delivery Date & Time</Text>
        <Text style={styles.compactValue} numberOfLines={1}>
          {request.scheduledDateTime || 'Not set'}
        </Text>

        {isDeliveryFailed && (
          <View style={styles.failureNoticeCard}>
            <Text style={styles.failureNoticeTitle}>Delivery Attempt Failed</Text>
            <Text style={styles.failureNoticeBody}>{request.failureReason || 'Issue reported during delivery attempt.'}</Text>
          </View>
        )}
      </View>

      <View style={styles.cardActionsRow}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.secondaryActionButton}
          onPress={() => onViewDetails(request)}
        >
          <Text style={styles.secondaryActionText}>View Details</Text>
        </TouchableOpacity>

        {/* Status-specific action buttons */}
        {isScheduledOrAccepted && (
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={processing}
            onPress={() => onAdvance(request, 'start-delivery')}
            style={[styles.primaryActionButton, processing && styles.actionButtonDisabled]}
          >
            {processing ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.primaryActionText}>Start Delivery</Text>}
          </TouchableOpacity>
        )}

        {isOutForDelivery && (
          <>
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={processing}
              onPress={() => onOpenFailModal(request)}
              style={styles.failActionButton}
            >
              <Text style={styles.failActionText}>Delivery Failed</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              disabled={processing}
              onPress={() => onAdvance(request, 'mark-delivered')}
              style={[styles.primaryActionButton, processing && styles.actionButtonDisabled]}
            >
              {processing ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.primaryActionText}>Mark Delivered</Text>}
            </TouchableOpacity>
          </>
        )}

        {isDeliveryFailed && (
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={processing}
            onPress={() => onOpenRescheduleModal(request)}
            style={styles.rescheduleActionButton}
          >
            <Text style={styles.rescheduleActionText}>Reschedule Delivery</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

export default function DistributorScheduledRequests() {
  useBlueTapTheme();
  const router = useRouter();
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [processingRequestId, setProcessingRequestId] = useState('');
  const [actionError, setActionError] = useState('');

  // Failure Modal State
  const [failingRequest, setFailingRequest] = useState(null);
  const [failureReason, setFailureReason] = useState('');
  const [failError, setFailError] = useState('');

  // Reschedule Modal State
  const [reschedulingRequest, setReschedulingRequest] = useState(null);
  const [selectedDayOffset, setSelectedDayOffset] = useState(1); // default tomorrow
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [rescheduleError, setRescheduleError] = useState('');
  const [toast, setToast] = useState({ visible: false, message: '', type: 'success' });

  const { isComplete, loading: profileLoading } = useDistributorProfile();
  const { orders, loading, error, refresh } = useAssignedDistributorOrders();
  const scheduledRequests = useMemo(
    () =>
      orders
        .map(toDistributorScreenOrder)
        .filter((request) => UPCOMING_STATUSES.has(normalizeDistributorOrderStatus(request.status))),
    [orders]
  );
  const selectedDetailsRequest = getDetailsRequestData(selectedRequest);

  const advanceDelivery = async (request, action) => {
    if (!isComplete) {
      Alert.alert(
        'Profile Incomplete',
        'Please complete your distributor profile before updating deliveries.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Complete Profile', onPress: () => router.push('/distributor/d_profile') },
        ]
      );
      return;
    }
    if (processingRequestId) return;
    setActionError('');
    setProcessingRequestId(request.sourceId);
    try {
      await updateAssignedDistributorOrder(request.sourceId, action);
      await refresh();
      const isDelivered = action === 'mark-delivered';
      setToast({ visible: true, message: isDelivered ? 'Delivery completed successfully!' : 'Delivery started.', type: isDelivered ? 'success' : 'info' });
    } catch (updateError) {
      setActionError(updateError.message || 'The delivery could not be updated.');
      setToast({ visible: true, message: updateError.message || 'The delivery could not be updated.', type: 'error' });
    } finally {
      setProcessingRequestId('');
    }
  };

  const submitFailure = async () => {
    if (!failingRequest) return;
    if (!isComplete) {
      Alert.alert('Profile Incomplete', 'Please complete your distributor profile before updating deliveries.');
      return;
    }
    if (!failureReason.trim()) {
      setFailError('Please explain why the delivery failed (e.g., customer unreachable, address closed).');
      return;
    }
    setProcessingRequestId(failingRequest.sourceId);
    setFailError('');
    try {
      await failAssignedDelivery(failingRequest.sourceId, failureReason.trim());
      await refresh();
      setFailingRequest(null);
      setFailureReason('');
      setToast({ visible: true, message: 'Delivery marked as failed.', type: 'warning' });
    } catch (err) {
      setFailError(err.message || 'Failed to report delivery failure.');
      setToast({ visible: true, message: err.message || 'Failed to report delivery failure.', type: 'error' });
    } finally {
      setProcessingRequestId('');
    }
  };

  const submitReschedule = async () => {
    if (!reschedulingRequest) return;
    if (!isComplete) {
      Alert.alert('Profile Incomplete', 'Please complete your distributor profile before updating deliveries.');
      return;
    }
    const slot = TIME_SLOTS[selectedSlotIndex] || TIME_SLOTS[0];
    const target = new Date();
    target.setDate(target.getDate() + selectedDayOffset);
    target.setHours(slot.hours, slot.minutes, 0, 0);

    if (target.getTime() < Date.now() + 5 * 60 * 1000) {
      setRescheduleError('Please choose a time slot in the future.');
      return;
    }

    setProcessingRequestId(reschedulingRequest.sourceId);
    setRescheduleError('');
    try {
      await rescheduleAssignedDelivery(reschedulingRequest.sourceId, target.toISOString());
      await refresh();
      setReschedulingRequest(null);
      setToast({ visible: true, message: 'Delivery rescheduled successfully.', type: 'success' });
    } catch (err) {
      setRescheduleError(err.message || 'Failed to reschedule delivery.');
      setToast({ visible: true, message: err.message || 'Failed to reschedule delivery.', type: 'error' });
    } finally {
      setProcessingRequestId('');
    }
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <TopToastFeedback
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast((t) => ({ ...t, visible: false }))}
      />
      <BlueTapHeader notificationPath="/distributor/d_notification" />

      <PortalSwipeContainer tabs={DISTRIBUTOR_TABS} currentRoute="/distributor/d_scheduled_requests">
        <View style={styles.phoneWrapper}>
          <DistributorProfileBanner isComplete={isComplete} loading={profileLoading} />

          <View style={styles.fixedHeaderArea}>
            <Text style={styles.pageTitle}>SCHEDULE</Text>
            <Text style={styles.subtitle}>Scheduled Requests</Text>

            <View style={styles.scheduleTabs}>
              <TouchableOpacity
                style={[styles.scheduleTab, styles.scheduleTabActive]}
                activeOpacity={0.85}
                onPress={() => router.replace('/distributor/d_scheduled_requests')}
              >
                <Text style={[styles.scheduleTabText, styles.scheduleTabTextActive]}>Scheduled</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.scheduleTab}
                activeOpacity={0.85}
                onPress={() => router.replace('/distributor/d_history')}
              >
                <Text style={styles.scheduleTabText}>History</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {!!actionError && (
              <View style={styles.actionErrorCard}>
                <Text style={styles.actionErrorText}>{actionError}</Text>
              </View>
            )}

            {loading ? (
              <View style={styles.emptyCard}>
                <ActivityIndicator color={BLUE} />
                <Text style={styles.emptyText}>Loading assigned schedule...</Text>
              </View>
            ) : error ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Schedule unavailable.</Text>
                <Text style={styles.emptyText}>{error}</Text>
                <TouchableOpacity onPress={refresh} style={styles.secondaryActionButton}>
                  <Text style={styles.secondaryActionText}>Try Again</Text>
                </TouchableOpacity>
              </View>
            ) : scheduledRequests.length === 0 ? (
              <BlueTapEmptyState
                title="No Scheduled Deliveries"
                description="Accepted and upcoming assigned deliveries will appear here."
              />
            ) : (
              scheduledRequests.map((request) => (
                <ScheduledRequestCard
                  key={request.sourceId}
                  request={request}
                  processing={processingRequestId === request.sourceId}
                  onAdvance={advanceDelivery}
                  onOpenFailModal={(req) => {
                    if (!isComplete) {
                      Alert.alert(
                        'Profile Incomplete',
                        'Please complete your distributor profile before updating deliveries.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Complete Profile', onPress: () => router.push('/distributor/d_profile') },
                        ]
                      );
                      return;
                    }
                    setFailingRequest(req);
                    setFailureReason('');
                    setFailError('');
                  }}
                  onOpenRescheduleModal={(req) => {
                    if (!isComplete) {
                      Alert.alert(
                        'Profile Incomplete',
                        'Please complete your distributor profile before updating deliveries.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Complete Profile', onPress: () => router.push('/distributor/d_profile') },
                        ]
                      );
                      return;
                    }
                    setReschedulingRequest(req);
                    setSelectedDayOffset(1);
                    setSelectedSlotIndex(0);
                    setRescheduleError('');
                  }}
                  onViewDetails={setSelectedRequest}
                />
              ))
            )}
          </ScrollView>
        </View>
      </PortalSwipeContainer>

      <RequestDetailsModal
        visible={!!selectedRequest}
        onClose={() => setSelectedRequest(null)}
        request={selectedDetailsRequest}
      />

      {/* Delivery Failed Modal */}
      <Modal
        visible={!!failingRequest}
        transparent
        animationType="fade"
        onRequestClose={() => setFailingRequest(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Report Failed Delivery</Text>
            <Text style={styles.dialogBody}>
              Order #{failingRequest?.id}. Please state the reason the delivery could not be completed.
            </Text>
            <TextInput
              value={failureReason}
              onChangeText={setFailureReason}
              placeholder="e.g. Customer not at home, wrong address, gate locked..."
              placeholderTextColor="#95A6B8"
              multiline
              style={styles.dialogInput}
            />
            {!!failError && <Text style={styles.dialogError}>{failError}</Text>}
            <View style={styles.dialogActions}>
              <TouchableOpacity
                disabled={!!processingRequestId}
                onPress={() => setFailingRequest(null)}
                style={styles.dialogCancelBtn}
              >
                <Text style={styles.dialogCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={!!processingRequestId}
                onPress={submitFailure}
                style={styles.dialogDangerBtn}
              >
                {processingRequestId ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.dialogDangerText}>Report Failed</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reschedule Delivery Modal */}
      <Modal
        visible={!!reschedulingRequest}
        transparent
        animationType="fade"
        onRequestClose={() => setReschedulingRequest(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Reschedule Failed Delivery</Text>
            <Text style={styles.dialogBody}>
              Order #{reschedulingRequest?.id}. Select a new delivery slot to re-attempt this order.
            </Text>

            <Text style={styles.pickerSectionLabel}>Select Date:</Text>
            <View style={styles.pickerPillRow}>
              {['Tomorrow', 'In 2 Days', 'In 3 Days'].map((label, idx) => (
                <TouchableOpacity
                  key={label}
                  onPress={() => setSelectedDayOffset(idx + 1)}
                  style={[styles.pickerPill, selectedDayOffset === idx + 1 && styles.pickerPillActive]}
                >
                  <Text style={[styles.pickerPillText, selectedDayOffset === idx + 1 && styles.pickerPillTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.pickerSectionLabel, { marginTop: 10 }]}>Select Time Slot:</Text>
            <View style={styles.pickerPillRow}>
              {TIME_SLOTS.map((slot, idx) => (
                <TouchableOpacity
                  key={slot.label}
                  onPress={() => setSelectedSlotIndex(idx)}
                  style={[styles.pickerPill, selectedSlotIndex === idx && styles.pickerPillActive]}
                >
                  <Text style={[styles.pickerPillText, selectedSlotIndex === idx && styles.pickerPillTextActive]}>
                    {slot.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {!!rescheduleError && <Text style={styles.dialogError}>{rescheduleError}</Text>}

            <View style={styles.dialogActions}>
              <TouchableOpacity
                disabled={!!processingRequestId}
                onPress={() => setReschedulingRequest(null)}
                style={styles.dialogCancelBtn}
              >
                <Text style={styles.dialogCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={!!processingRequestId}
                onPress={submitReschedule}
                style={styles.dialogSuccessBtn}
              >
                {processingRequestId ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.dialogSuccessText}>Save Schedule</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = createPortalStyleSheet({
  container: {
    flex: 1,
    backgroundColor: BLUETAP_COLORS.background,
  },
  phoneWrapper: {
    width: '100%',
    maxWidth: USER_PORTAL_LAYOUT.maxWidth,
    minWidth: 0,
    alignSelf: 'center',
    flex: 1,
  },
  fixedHeaderArea: {
    backgroundColor: BLUETAP_COLORS.background,
    zIndex: 10,
    paddingHorizontal: USER_PORTAL_LAYOUT.gutter,
    paddingTop: 16,
    paddingBottom: 4,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: USER_PORTAL_LAYOUT.gutter,
    paddingTop: 4,
    paddingBottom: USER_PORTAL_BOTTOM_CONTENT_INSET,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: TEXT_DARK,
    letterSpacing: 0,
  },
  subtitle: {
    fontSize: 14,
    color: TEXT_MUTED,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 14,
  },
  scheduleTabs: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: BLUETAP_COLORS.surfaceAlt,
    borderRadius: 13,
    overflow: 'hidden',
    marginBottom: 16,
  },
  scheduleTab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  scheduleTabActive: {
    backgroundColor: BLUE,
  },
  scheduleTabText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: TEXT_MUTED,
  },
  scheduleTabTextActive: {
    color: '#FFFFFF',
  },
  requestCard: {
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    backgroundColor: BLUETAP_COLORS.surface,
    ...createShadow({
      color: '#0D47A1',
      offset: { width: 0, height: 3 },
      opacity: 0.08,
      radius: 8,
    }),
  },
  requestCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  requestId: {
    fontSize: 13,
    fontWeight: 'bold',
    color: BLUE,
  },
  compactInfoGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  compactInfoColumn: {
    flex: 1,
  },
  compactLabel: {
    fontSize: 11,
    color: TEXT_MUTED,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  compactLabelGap: {
    marginTop: 8,
  },
  compactPrimaryValue: {
    fontSize: 14,
    color: TEXT_DARK,
    fontWeight: 'bold',
    marginTop: 2,
  },
  compactValue: {
    fontSize: 13,
    color: TEXT_DARK,
    fontWeight: '500',
    marginTop: 2,
  },
  compactAddressValue: {
    fontSize: 13,
    color: TEXT_DARK,
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 18,
  },
  fullWidthInfoBlock: {
    marginTop: 2,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
  },
  failureNoticeCard: {
    backgroundColor: BLUETAP_COLORS.dangerSoft,
    borderWidth: 1,
    borderColor: BLUETAP_COLORS.danger,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  failureNoticeTitle: {
    color: BLUETAP_COLORS.danger,
    fontSize: 12,
    fontWeight: '800',
  },
  failureNoticeBody: {
    color: BLUETAP_COLORS.textPrimary,
    fontSize: 12,
    marginTop: 2,
  },
  cardActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
    justifyContent: 'flex-end',
  },
  secondaryActionButton: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BLUE,
    backgroundColor: BLUETAP_COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: BLUE,
    fontSize: 12,
    fontWeight: 'bold',
  },
  primaryActionButton: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  failActionButton: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BLUETAP_COLORS.danger,
    backgroundColor: BLUETAP_COLORS.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failActionText: {
    color: BLUETAP_COLORS.danger,
    fontSize: 12,
    fontWeight: 'bold',
  },
  rescheduleActionButton: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: BLUETAP_COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rescheduleActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  emptyCard: {
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BLUETAP_COLORS.surface,
  },
  emptyTitle: {
    color: TEXT_DARK,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  emptyText: {
    color: TEXT_MUTED,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  actionErrorCard: {
    backgroundColor: BLUETAP_COLORS.dangerSoft,
    borderWidth: 1,
    borderColor: BLUETAP_COLORS.danger,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  actionErrorText: {
    color: BLUETAP_COLORS.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: BLUETAP_COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BLUETAP_COLORS.border,
    padding: 20,
  },
  dialogTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: BLUETAP_COLORS.textPrimary,
  },
  dialogBody: {
    fontSize: 13,
    color: BLUETAP_COLORS.textSecondary,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 12,
  },
  dialogInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: BLUETAP_COLORS.border,
    borderRadius: 8,
    backgroundColor: BLUETAP_COLORS.background,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: BLUETAP_COLORS.textPrimary,
    fontSize: 13,
    outlineStyle: 'none',
  },
  dialogError: {
    color: BLUETAP_COLORS.danger,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  dialogCancelBtn: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BLUETAP_COLORS.border,
    backgroundColor: BLUETAP_COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogCancelText: {
    color: BLUETAP_COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  dialogDangerBtn: {
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: BLUETAP_COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogDangerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  dialogSuccessBtn: {
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: BLUETAP_COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogSuccessText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  pickerSectionLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: BLUETAP_COLORS.textPrimary,
    marginBottom: 6,
  },
  pickerPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pickerPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BLUETAP_COLORS.border,
    backgroundColor: BLUETAP_COLORS.background,
  },
  pickerPillActive: {
    borderColor: BLUE,
    backgroundColor: BLUE,
  },
  pickerPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: BLUETAP_COLORS.textPrimary,
  },
  pickerPillTextActive: {
    color: '#FFFFFF',
  },
});
