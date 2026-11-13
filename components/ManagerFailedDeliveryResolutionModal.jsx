import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import DropdownChevron from './DropdownChevron';
const {
  TIME_SLOT_OPTIONS,
  allowedDayOffsetsForOrder,
  buildScheduleDateForSlot,
  formatManilaDate,
  formatManilaTime,
  getEligibleResolutionTrips,
  getEligibleBranchDistributors,
  isValidRescheduleReason,
  normalizeRescheduleReason,
} = require('../services/managerFailedDeliveryResolution');

function formatDayOptionLabel(dayOffset) {
  const date = buildScheduleDateForSlot(dayOffset, TIME_SLOT_OPTIONS[0]);
  const formatted = formatManilaDate(date);
  if (dayOffset === 0) return `Today (${formatted})`;
  if (dayOffset === 1) return `Tomorrow (${formatted})`;
  return formatted;
}

export default function ManagerFailedDeliveryResolutionModal({
  state,
  flow,
  colors,
  isDark = false,
  onSuccess,
}) {
  const { width, height } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors, width, height, isDark), [colors, width, height, isDark]);
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false);

  if (!state?.visible || !state?.order) return null;

  const order = state.order;
  const isReschedule = state.mode === 'reschedule';
  const currentDistributorUid = String(order.assignedDistributorUid || order.distributor_id || '').trim();
  const currentDistributorName = order.assignedDistributorName || order.distributor_name || 'Assigned Distributor';
  const currentDistributorUniqueId = order.assignedDistributorUniqueId || order.distributorUniqueId || '';
  const allowedOffsets = allowedDayOffsetsForOrder(order);
  const eligibleDistributors = getEligibleBranchDistributors(
    state.distributors,
    state.branchId || order.currentBranchId || order.branchId,
    currentDistributorUid,
    'reassign'
  );
  const selectedDistributor = eligibleDistributors.find((item) => item.uid === state.selectedDistributorUid) || null;
  const selectedSlot = TIME_SLOT_OPTIONS[state.selectedSlotIndex] || TIME_SLOT_OPTIONS[0];
  const scheduledDate = buildScheduleDateForSlot(state.selectedDayOffset, selectedSlot);
  const formattedSchedule = `${formatDayOptionLabel(state.selectedDayOffset)} · ${selectedSlot.label}`;
  const trimmedReason = normalizeRescheduleReason(state.reason);
  const reasonCount = Array.from(trimmedReason).length;
  const tripMode = state.tripMode || 'default';
  const eligibleTrips = getEligibleResolutionTrips(state);
  const selectedTrip = eligibleTrips.find((trip) => trip.tripId === state.selectedTripId);
  const tripReady = tripMode === 'default' || (tripMode === 'trip' && Boolean(selectedTrip));
  const canProceedToConfirm = tripReady && (isReschedule
    ? allowedOffsets.includes(state.selectedDayOffset) && isValidRescheduleReason(state.reason)
    : allowedOffsets.includes(state.selectedDayOffset) && Boolean(selectedDistributor));

  const handleConfirmSubmit = async () => {
    const result = await flow.submit();
    if (result?.ok) {
      setDateDropdownOpen(false);
      onSuccess?.(result);
    }
  };

  return (
    <Modal
      visible={state.visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!state.submitting) {
          setDateDropdownOpen(false);
          flow.close();
        }
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <View accessibilityViewIsModal style={styles.card}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.eyebrow}>FAILED DELIVERY RESOLUTION</Text>
              <Text style={styles.title}>
                {isReschedule ? 'Reschedule Delivery' : 'Reassign Distributor'}
              </Text>
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.subtitle}>
                Order #{order.requestId || order.id} · {order.requesterName || 'Requester'}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close failed delivery resolution modal"
              disabled={state.submitting}
              onPress={() => {
                setDateDropdownOpen(false);
                flow.close();
              }}
              style={[styles.closeButton, state.submitting && styles.disabled]}
            >
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>

          <View accessibilityRole="tablist" style={styles.modeTabs}>
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel="Reschedule Delivery keeping assigned Distributor"
              accessibilityState={{ selected: isReschedule, disabled: state.submitting }}
              disabled={state.submitting}
              onPress={() => {
                setDateDropdownOpen(false);
                flow.setMode('reschedule');
              }}
              style={[styles.modeTab, isReschedule && styles.modeTabActive]}
            >
              <Text style={[styles.modeTabText, isReschedule && styles.modeTabTextActive]}>
                Reschedule Delivery
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel="Reassign Distributor for failed delivery"
              accessibilityState={{ selected: !isReschedule, disabled: state.submitting }}
              disabled={state.submitting}
              onPress={() => {
                setDateDropdownOpen(false);
                flow.setMode('reassign');
              }}
              style={[styles.modeTab, !isReschedule && styles.modeTabActive]}
            >
              <Text style={[styles.modeTabText, !isReschedule && styles.modeTabTextActive]}>
                Reassign Distributor
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent} nestedScrollEnabled>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLine}>
                <Text style={styles.summaryLabel}>Current Distributor: </Text>
                {currentDistributorName}
                {currentDistributorUniqueId ? ` (${currentDistributorUniqueId})` : ''}
              </Text>
              {Boolean(order.failureReason) ? (
                <Text style={styles.failureLine}>
                  Reported issue: {order.failureReason}
                </Text>
              ) : null}
              <Text style={styles.auditNote}>
                Previous failed-delivery attempts and audit evidence are preserved.
              </Text>
            </View>

            {Boolean(state.error) ? (
              <View accessibilityRole="alert" style={styles.errorBanner}>
                <Text style={styles.errorText}>{state.error}</Text>
              </View>
            ) : null}

            {!isReschedule ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>1. Choose Eligible Branch Distributor</Text>
                {eligibleDistributors.length === 0 ? (
                  <View style={styles.emptyNotice}>
                    <Text style={styles.emptyNoticeText}>
                      No other active approved Distributors are currently available in your branch. Use Reschedule Delivery to keep {currentDistributorName}.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.distributorList}>
                    {eligibleDistributors.map((distributor) => {
                      const selected = state.selectedDistributorUid === distributor.uid;
                      return (
                        <TouchableOpacity
                          key={distributor.uid}
                          accessibilityRole="radio"
                          accessibilityLabel={`Reassign to ${distributor.name}`}
                          accessibilityState={{ checked: selected, disabled: state.submitting }}
                          disabled={state.submitting}
                          onPress={() => flow.setDistributorUid(distributor.uid)}
                          style={[styles.distributorOption, selected && styles.distributorOptionSelected]}
                        >
                          <View style={[styles.radioCircle, selected && styles.radioCircleSelected]}>
                            {Boolean(selected) ? <View style={styles.radioDot} /> : null}
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} style={[styles.distributorName, selected && styles.distributorNameSelected]}>
                              {distributor.name}
                              {distributor.uniqueId ? ` (${distributor.uniqueId})` : ''}
                            </Text>
                            <Text style={styles.distributorMeta}>
                              Active · Eligible in your branch · Advances assignment version
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {isReschedule ? '1. Select New Delivery Date & Time' : '2. Select New Delivery Date & Time'}
              </Text>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Delivery Date</Text>
                <View style={styles.dateSelectorWrap}>
                  <TouchableOpacity
                    accessibilityRole="combobox"
                    accessibilityLabel="Select delivery date"
                    accessibilityState={{ expanded: dateDropdownOpen, disabled: state.submitting }}
                    disabled={state.submitting}
                    onPress={() => setDateDropdownOpen((open) => !open)}
                    style={styles.dateSelector}
                  >
                    <Text numberOfLines={1} style={styles.dateSelectorText}>
                      {formatDayOptionLabel(state.selectedDayOffset)}
                    </Text>
                    <DropdownChevron expanded={dateDropdownOpen} size={16} color={colors.iconSecondary || colors.primary} />
                  </TouchableOpacity>

                  {Boolean(dateDropdownOpen) ? (
                    <ScrollView nestedScrollEnabled style={styles.dateOptions}>
                      {allowedOffsets.map((offset) => {
                        const active = state.selectedDayOffset === offset;
                        return (
                          <TouchableOpacity
                            key={offset}
                            disabled={state.submitting}
                            onPress={() => {
                              flow.setDayOffset(offset);
                              setDateDropdownOpen(false);
                            }}
                            style={[styles.dateOption, active && styles.dateOptionActive]}
                          >
                            <Text style={[styles.dateOptionText, active && styles.dateOptionTextActive]}>
                              {formatDayOptionLabel(offset)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  ) : null}

                  <View style={styles.quickDatesRow}>
                    {[0, 1]
                      .filter((offset) => allowedOffsets.includes(offset))
                      .map((offset) => (
                        <TouchableOpacity
                          key={offset}
                          disabled={state.submitting}
                          onPress={() => {
                            flow.setDayOffset(offset);
                            setDateDropdownOpen(false);
                          }}
                          style={[
                            styles.quickDateBtn,
                            state.selectedDayOffset === offset && styles.quickDateBtnActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.quickDateText,
                              state.selectedDayOffset === offset && styles.quickDateTextActive,
                            ]}
                          >
                            {offset === 0 ? 'Today' : 'Tomorrow'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                  </View>
                </View>
              </View>

              <View style={[styles.fieldRow, { marginTop: 10 }]}>
                <Text style={styles.fieldLabel}>Time Slot</Text>
                <View style={styles.slotGroup}>
                  {TIME_SLOT_OPTIONS.map((slot, index) => {
                    const active = state.selectedSlotIndex === index;
                    return (
                      <TouchableOpacity
                        key={slot.label}
                        disabled={state.submitting}
                        onPress={() => flow.setSlotIndex(index)}
                        style={[styles.slotPill, active && styles.slotPillActive]}
                      >
                        <Text style={[styles.slotPillText, active && styles.slotPillTextActive]}>
                          {slot.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            {tripMode !== 'default' ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Select Target Trip</Text>
                {tripMode !== 'trip' ? (
                  <Text style={styles.emptyNoticeText}>Trip availability could not be verified. Please wait or try again.</Text>
                ) : state.tripOptionsStatus === 'loading' ? (
                  <Text style={styles.emptyNoticeText}>Loading eligible trips…</Text>
                ) : state.tripOptionsStatus === 'error' ? (
                  <TouchableOpacity accessibilityRole="button" onPress={() => flow.refreshTripOptions()}><Text style={styles.fieldLabel}>Retry loading trips</Text></TouchableOpacity>
                ) : eligibleTrips.length === 0 ? (
                  <Text style={styles.emptyNoticeText}>No eligible scheduled trip matches this Distributor and delivery time. Choose another time or prepare a trip first.</Text>
                ) : (
                  <View style={styles.distributorList}>
                    {eligibleTrips.map((trip) => {
                      const selected = trip.tripId === state.selectedTripId;
                      return (
                        <TouchableOpacity key={trip.tripId} accessibilityRole="radio" accessibilityLabel={`Select trip ${trip.tripId}`} accessibilityState={{ checked: selected, disabled: state.submitting }} disabled={state.submitting} onPress={() => flow.setTripId(trip.tripId)} style={[styles.distributorOption, selected && styles.distributorOptionSelected]}>
                          <View style={[styles.radioCircle, selected && styles.radioCircleSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[styles.distributorName, selected && styles.distributorNameSelected]}>Trip {trip.tripId}</Text>
                            <Text style={styles.distributorMeta}>{formatManilaDate(new Date(trip.plannedDeparture))} · {formatManilaTime(new Date(trip.plannedDeparture))}–{formatManilaTime(new Date(trip.estimatedReturn))} · {trip.standardContainers}/60 containers</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                {eligibleTrips.length > 0 ? <Text style={styles.auditNote}>Trip capacity and availability are checked again when you confirm.</Text> : null}
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {isReschedule
                  ? '2. Reschedule Reason / Coordination Note (Required)'
                  : '3. Reassignment Note (Optional)'}
              </Text>
              <TextInput
                accessibilityLabel={isReschedule ? 'Reschedule reason or note' : 'Optional reassignment note'}
                editable={!state.submitting}
                value={state.reason}
                onChangeText={(text) => flow.setReason(text)}
                maxLength={240}
                multiline
                placeholder={
                  isReschedule
                    ? 'Explain why this delivery is being rescheduled (e.g., Coordinated new delivery window with requester)...'
                    : 'Optional handoff note for this reassignment...'
                }
                placeholderTextColor={colors.placeholder}
                style={styles.reasonInput}
              />
              <Text style={styles.counterText}>
                {isReschedule
                  ? `3 to 240 characters required (${reasonCount}/240)`
                  : `Optional (${reasonCount}/240)`}
              </Text>
            </View>

            {Boolean(state.confirming) ? (
              <View accessibilityRole="region" accessibilityLabel="Confirm resolution details" style={styles.confirmBox}>
                <Text style={styles.confirmTitle}>Confirm Schedule & Assignment Update</Text>
                <Text style={styles.confirmLine}>
                  • Action: {isReschedule ? 'Reschedule Delivery (same Distributor)' : 'Reassign Distributor & Schedule'}
                </Text>
                <Text style={styles.confirmLine}>
                  • Distributor: {isReschedule ? currentDistributorName : (selectedDistributor?.name || 'Selected Distributor')}
                </Text>
                <Text style={styles.confirmLine}>
                  • New Schedule: {formattedSchedule} ({formatManilaTime(scheduledDate)} Manila time)
                </Text>
                {selectedTrip ? <Text style={styles.confirmLine}>• Target Trip: {selectedTrip.tripId}</Text> : null}
                {Boolean(trimmedReason) ? (
                  <Text style={styles.confirmLine}>• Note: {trimmedReason}</Text>
                ) : null}
                <Text style={styles.confirmWarning}>
                  {isReschedule
                    ? 'The Requester and assigned Distributor will see the updated delivery schedule immediately.'
                    : 'This increments the assignment version, revokes the previous Distributor’s access to this order, and notifies the Requester.'}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footerRow}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={state.confirming ? 'Back to edit schedule' : 'Cancel failed delivery resolution'}
              disabled={state.submitting}
              onPress={() => {
                if (state.confirming) {
                  flow.cancelConfirmation();
                } else {
                  setDateDropdownOpen(false);
                  flow.close();
                }
              }}
              style={[styles.secondaryBtn, state.submitting && styles.disabled]}
            >
              <Text style={styles.secondaryBtnText}>{state.confirming ? 'Back to Edit' : 'Cancel'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={state.confirming
                ? (isReschedule ? 'Confirm Reschedule Delivery' : 'Confirm Reassign Distributor')
                : (isReschedule ? 'Review Reschedule Delivery' : 'Review Reassign Distributor')}
              disabled={state.submitting || (!state.confirming && !canProceedToConfirm)}
              onPress={state.confirming ? handleConfirmSubmit : () => flow.requestConfirmation()}
              style={[styles.primaryBtn, (state.submitting || (!state.confirming && !canProceedToConfirm)) && styles.disabled]}
            >
              {state.confirming && state.submitting ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.onPrimary || '#FFFFFF'} />
                  <Text style={styles.primaryBtnText}>Saving…</Text>
                </View>
              ) : (
                <Text style={styles.primaryBtnText}>
                  {state.confirming
                    ? (isReschedule ? 'Confirm Reschedule' : 'Confirm Reassignment')
                    : (isReschedule ? 'Review Reschedule' : 'Review Reassignment')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (colors, width = 1200, height = 800, isDark = false) => {
  const compact = width < 440;
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay || 'rgba(15, 23, 42, 0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: compact ? 12 : 20,
    },
    card: {
      width: '100%',
      maxWidth: 520,
      maxHeight: Math.min(640, Math.max(360, height - (compact ? 24 : 48))),
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: compact ? 14 : 18,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 10,
      marginBottom: 10,
    },
    eyebrow: {
      color: colors.primary,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.8,
    },
    title: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '800',
      marginTop: 2,
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 2,
    },
    closeButton: {
      minHeight: 38,
      paddingHorizontal: 12,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    modeTabs: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 10,
    },
    modeTab: {
      flex: 1,
      minHeight: 40,
      paddingHorizontal: 10,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modeTabActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    modeTabText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '700',
      textAlign: 'center',
    },
    modeTabTextActive: {
      color: colors.primary,
      fontWeight: '900',
    },
    scrollBody: {
      flexGrow: 0,
      flexShrink: 1,
    },
    scrollContent: {
      gap: 12,
      paddingBottom: 6,
    },
    summaryBox: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 10,
      padding: 10,
      gap: 4,
    },
    summaryLine: {
      color: colors.textPrimary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
    },
    summaryLabel: {
      fontWeight: '800',
    },
    failureLine: {
      color: colors.danger,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '700',
    },
    auditNote: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 16,
    },
    errorBanner: {
      borderWidth: 1,
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
      borderRadius: 9,
      padding: 10,
    },
    errorText: {
      color: colors.danger,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '700',
    },
    section: {
      gap: 6,
    },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    emptyNotice: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 9,
      padding: 10,
    },
    emptyNoticeText: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
    distributorList: {
      gap: 6,
    },
    distributorOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 10,
      borderRadius: 9,
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
      borderColor: colors.border,
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
      fontWeight: '800',
    },
    distributorNameSelected: {
      color: colors.primary,
    },
    distributorMeta: {
      color: colors.textSecondary,
      fontSize: 11,
      marginTop: 1,
    },
    fieldRow: {
      gap: 6,
    },
    fieldLabel: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '700',
    },
    dateSelectorWrap: {
      width: '100%',
      minWidth: 0,
    },
    dateSelector: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      borderWidth: 1,
      borderColor: colors.inputBorder || colors.border,
      backgroundColor: colors.input || colors.surfaceAlt,
      borderRadius: 9,
      paddingHorizontal: 12,
    },
    dateSelectorText: {
      flex: 1,
      minWidth: 0,
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    dateOptions: {
      maxHeight: 160,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: 9,
      marginTop: 4,
    },
    dateOption: {
      minHeight: 38,
      justifyContent: 'center',
      paddingHorizontal: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    dateOptionActive: {
      backgroundColor: colors.primaryAction,
    },
    dateOptionText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '700',
    },
    dateOptionTextActive: {
      color: colors.onPrimary || '#FFFFFF',
    },
    quickDatesRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 6,
    },
    quickDateBtn: {
      minHeight: 32,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quickDateBtnActive: {
      backgroundColor: colors.primaryAction,
    },
    quickDateText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '800',
    },
    quickDateTextActive: {
      color: colors.onPrimary || '#FFFFFF',
    },
    slotGroup: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    slotPill: {
      minHeight: 36,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    slotPillActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryAction,
    },
    slotPillText: {
      color: colors.textPrimary,
      fontSize: 11,
      fontWeight: '700',
    },
    slotPillTextActive: {
      color: colors.onPrimary || '#FFFFFF',
      fontWeight: '800',
    },
    reasonInput: {
      minHeight: 68,
      borderWidth: 1,
      borderColor: colors.inputBorder || colors.border,
      borderRadius: 9,
      backgroundColor: colors.input || colors.surfaceAlt,
      color: colors.textPrimary,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 12,
      textAlignVertical: 'top',
    },
    counterText: {
      color: colors.textSecondary,
      fontSize: 11,
    },
    confirmBox: {
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.12)' : colors.primarySoft,
      borderRadius: 10,
      padding: 12,
      gap: 4,
    },
    confirmTitle: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
      marginBottom: 2,
    },
    confirmLine: {
      color: colors.textPrimary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
    },
    confirmWarning: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 4,
    },
    footerRow: {
      flexDirection: compact ? 'column-reverse' : 'row',
      justifyContent: 'flex-end',
      alignItems: compact ? 'stretch' : 'center',
      gap: 8,
      marginTop: 12,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    secondaryBtn: {
      minHeight: 40,
      maxHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryBtnText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    primaryBtn: {
      minHeight: 40,
      maxHeight: 44,
      paddingHorizontal: 16,
      borderRadius: 9,
      backgroundColor: colors.primaryAction,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryBtnText: {
      color: colors.onPrimary || '#FFFFFF',
      fontSize: 12,
      fontWeight: '900',
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    disabled: {
      opacity: 0.55,
    },
  });
};

