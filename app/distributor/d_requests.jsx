import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BlueTapHeader from '../../components/BlueTapHeader';
import SoftStatusBadge from '../../components/SoftStatusBadge';
import { createShadow } from '../../components/shadowStyles';

const BLUE = '#187BCD';
const BLUE_LIGHT = '#E3F2FD';
const TEXT_MUTED = '#6F8EA8';
const TEXT_DARK = '#20384D';
const DAY_MS = 24 * 60 * 60 * 1000;
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

const TIME_SLOTS = [
  '08:00',
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
];

const SCHEDULE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'custom', label: 'Custom Date & Time' },
];

const PENDING_REQUESTS = [
  {
    id: 'BT-01245',
    quantity: '3 Gallons',
    productName: 'Purified Mineral Water',
    container: 'New Container',
    requester: 'Jeanne Ortega',
    requesterId: 'REQ-000001',
    distributor: 'Distributor',
    distributorId: 'DIS-000001',
    contact: '09123456789',
    address: 'Poblacion, Toledo City',
    deliveryDate: 'Jan 25, 2026',
  },
  {
    id: 'BT-01212',
    quantity: '2 Gallons',
    productName: 'Purified Mineral Water',
    container: 'Exchange Container',
    requester: 'Franz Caliguid',
    requesterId: 'REQ-000002',
    distributor: 'Distributor',
    distributorId: 'DIS-000001',
    contact: '09123456789',
    address: 'Tajao, Pinamungajan',
    deliveryDate: 'Jan 25, 2026',
  },
];

const getStartOfDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date, days) =>
  new Date(getStartOfDay(date).getTime() + days * DAY_MS);

const getDateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

const getTimeParts = (timeValue) => {
  const [hours, minutes] = timeValue.split(':').map(Number);
  return { hours, minutes };
};

const combineDateAndTime = (date, timeValue) => {
  const { hours, minutes } = getTimeParts(timeValue);
  const nextDate = new Date(date);
  nextDate.setHours(hours, minutes, 0, 0);
  return nextDate;
};

const isSameDay = (left, right) => getDateKey(left) === getDateKey(right);

const isPastDate = (date) => getStartOfDay(date) < getStartOfDay(new Date());

const isPastTimeSlot = (date, timeValue) => {
  if (!timeValue) return true;
  if (!isSameDay(date, new Date())) return false;
  return combineDateAndTime(date, timeValue) <= new Date();
};

const getNextAvailableTimeSlot = (date) =>
  TIME_SLOTS.find((timeValue) => !isPastTimeSlot(date, timeValue)) || '';

const formatDateLabel = (date) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);

const formatWeekday = (date) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
  }).format(date);

const formatTimeLabel = (timeValue) => {
  const { hours, minutes } = getTimeParts(timeValue);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`;
};

const PendingRequestCard = memo(function PendingRequestCard({
  index,
  isProcessing,
  onAccept,
  onViewDetails,
  request,
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = fadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 0],
  });

  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 240,
      delay: index * 70,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [fadeAnim, index, request.id]);

  return (
    <Animated.View
      style={[
        styles.requestCard,
        {
          opacity: fadeAnim,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.requestCardHeader}>
        <Text style={styles.requestId}>Request ID: {request.id}</Text>
        <Animated.View style={{ opacity: fadeAnim }}>
          <SoftStatusBadge status="Pending" />
        </Animated.View>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.compactInfoGrid}>
          <View style={styles.compactInfoColumn}>
            <Text style={styles.compactLabel}>Customer Name</Text>
            <Text style={styles.compactPrimaryValue} numberOfLines={1}>
              {request.requester}
            </Text>

            <Text style={[styles.compactLabel, styles.compactLabelGap]}>
              Requester ID
            </Text>
            <Text style={styles.compactValue} numberOfLines={1}>
              {request.requesterId || request.requester_unique_id || 'Not set'}
            </Text>

            <Text style={[styles.compactLabel, styles.compactLabelGap]}>
              Contact Number
            </Text>
            <Text style={styles.compactValue} numberOfLines={1}>
              {request.contact}
            </Text>
          </View>

          <View style={styles.compactInfoColumn}>
            <Text style={styles.compactLabel}>Product Ordered</Text>
            <Text style={styles.compactPrimaryValue} numberOfLines={1}>
              {request.productName}
            </Text>

            <Text style={[styles.compactLabel, styles.compactLabelGap]}>
              Distributor ID
            </Text>
            <Text style={styles.compactValue} numberOfLines={1}>
              {request.distributorId || request.distributor_unique_id || 'Not set'}
            </Text>

            <Text style={[styles.compactLabel, styles.compactLabelGap]}>
              Quantity
            </Text>
            <Text style={styles.compactValue} numberOfLines={1}>
              {request.quantity}
            </Text>
          </View>
        </View>

        <View style={styles.compactAddressBlock}>
          <Text style={styles.compactLabel}>Delivery Address</Text>
          <Text style={styles.compactAddressValue} numberOfLines={2}>
            {request.address}
          </Text>
        </View>
      </View>

      <View style={styles.cardActionsRow}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.secondaryActionButton}
          onPress={() => onViewDetails(request)}
        >
          <Text style={styles.secondaryActionText}>View Details</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.82}
          style={[
            styles.primaryActionButton,
            isProcessing && styles.actionButtonDisabled,
          ]}
          onPress={() => onAccept(request)}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.primaryActionText}>Accept Request</Text>
          )}
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
});

const ScheduleOption = memo(function ScheduleOption({
  disabled,
  isSelected,
  label,
  onPress,
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.84}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.scheduleOption,
        isSelected && styles.scheduleOptionSelected,
        disabled && styles.optionDisabled,
      ]}
    >
      <View
        style={[
          styles.radioOuter,
          isSelected && styles.radioOuterSelected,
        ]}
      >
        {isSelected && <View style={styles.radioInner} />}
      </View>
      <Text
        style={[
          styles.scheduleOptionText,
          isSelected && styles.scheduleOptionTextSelected,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
});

export default function DistributorRequests() {
  const router = useRouter();
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const toastAnim = useRef(new Animated.Value(0)).current;
  const successTimer = useRef(null);
  const submitTimer = useRef(null);
  const [detailsRequest, setDetailsRequest] = useState(null);
  const [scheduleSheetVisible, setScheduleSheetVisible] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [selectedSchedule, setSelectedSchedule] = useState('today');
  const [customDate, setCustomDate] = useState(() => getStartOfDay(new Date()));
  const [customTime, setCustomTime] = useState(() =>
    getNextAvailableTimeSlot(new Date())
  );
  const [scheduleError, setScheduleError] = useState('');
  const [processingRequestId, setProcessingRequestId] = useState('');
  const [scheduledRequests, setScheduledRequests] = useState({});
  const [successVisible, setSuccessVisible] = useState(false);

  const pendingRequests = useMemo(
    () =>
      PENDING_REQUESTS.filter((request) => !scheduledRequests[request.id]),
    [scheduledRequests]
  );

  const customDateOptions = useMemo(() => {
    const today = getStartOfDay(new Date());
    return Array.from({ length: 7 }, (_, index) => addDays(today, index));
  }, [scheduleSheetVisible]);

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [420, 0],
  });

  const backdropOpacity = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  useEffect(() => {
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current);
      if (submitTimer.current) clearTimeout(submitTimer.current);
    };
  }, []);

  useEffect(() => {
    if (selectedSchedule !== 'custom') return;

    if (isPastDate(customDate)) {
      setCustomDate(getStartOfDay(new Date()));
      return;
    }

    if (isPastTimeSlot(customDate, customTime)) {
      setCustomTime(getNextAvailableTimeSlot(customDate));
    }
  }, [customDate, customTime, selectedSchedule]);

  const showSuccessFeedback = useCallback(() => {
    if (successTimer.current) clearTimeout(successTimer.current);

    setSuccessVisible(true);
    Animated.timing(toastAnim, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();

    successTimer.current = setTimeout(() => {
      Animated.timing(toastAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start(({ finished }) => {
        if (finished) setSuccessVisible(false);
      });
    }, 2200);
  }, [toastAnim]);

  const closeScheduleSheet = useCallback(
    (force = false) => {
      if (processingRequestId && !force) return;

      Animated.timing(sheetAnim, {
        toValue: 0,
        duration: 210,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start(({ finished }) => {
        if (finished) {
          setScheduleSheetVisible(false);
          setSelectedRequest(null);
          setScheduleError('');
        }
      });
    },
    [processingRequestId, sheetAnim]
  );

  const openScheduleSheet = useCallback(
    (request) => {
      if (processingRequestId) return;

      const today = getStartOfDay(new Date());
      setSelectedRequest(request);
      setSelectedSchedule('today');
      setCustomDate(today);
      setCustomTime(getNextAvailableTimeSlot(today));
      setScheduleError('');
      setScheduleSheetVisible(true);
      sheetAnim.setValue(0);

      requestAnimationFrame(() => {
        Animated.timing(sheetAnim, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: USE_NATIVE_DRIVER,
        }).start();
      });
    },
    [processingRequestId, sheetAnim]
  );

  const getResolvedSchedule = useCallback(() => {
    const now = new Date();

    if (selectedSchedule === 'today') {
      const nextTime = getNextAvailableTimeSlot(now);
      return {
        status: 'Scheduled',
        option: 'Today',
        scheduledAt: nextTime
          ? combineDateAndTime(getStartOfDay(now), nextTime).toISOString()
          : now.toISOString(),
      };
    }

    if (selectedSchedule === 'tomorrow') {
      const tomorrow = addDays(now, 1);
      return {
        status: 'Scheduled',
        option: 'Tomorrow',
        scheduledAt: combineDateAndTime(tomorrow, TIME_SLOTS[0]).toISOString(),
      };
    }

    if (isPastDate(customDate)) {
      setScheduleError('Choose today or a future date.');
      return null;
    }

    if (!customTime || isPastTimeSlot(customDate, customTime)) {
      setScheduleError('Choose a future time.');
      return null;
    }

    return {
      status: 'Scheduled',
      option: 'Custom Date & Time',
      scheduledAt: combineDateAndTime(customDate, customTime).toISOString(),
    };
  }, [customDate, customTime, selectedSchedule]);

  const confirmSchedule = useCallback(async () => {
    if (!selectedRequest || processingRequestId) return;

    const resolvedSchedule = getResolvedSchedule();
    if (!resolvedSchedule) return;

    setScheduleError('');
    setProcessingRequestId(selectedRequest.id);

    await new Promise((resolve) => {
      submitTimer.current = setTimeout(resolve, 520);
    });

    setScheduledRequests((currentRequests) => ({
      ...currentRequests,
      [selectedRequest.id]: resolvedSchedule,
    }));
    setProcessingRequestId('');
    closeScheduleSheet(true);
    showSuccessFeedback();
  }, [
    closeScheduleSheet,
    getResolvedSchedule,
    processingRequestId,
    selectedRequest,
    showSuccessFeedback,
  ]);

  const renderRequest = useCallback(
    ({ item, index }) => (
      <PendingRequestCard
        request={item}
        index={index}
        isProcessing={processingRequestId === item.id}
        onViewDetails={setDetailsRequest}
        onAccept={openScheduleSheet}
      />
    ),
    [openScheduleSheet, processingRequestId]
  );

  const renderDateOption = useCallback(
    ({ item }) => {
      const dateKey = getDateKey(item);
      const isSelected = getDateKey(customDate) === dateKey;
      const disabled = isPastDate(item) || !!processingRequestId;

      return (
        <TouchableOpacity
          activeOpacity={0.82}
          disabled={disabled}
          onPress={() => {
            const nextTime = getNextAvailableTimeSlot(item);
            setCustomDate(item);
            setCustomTime(nextTime);
            setScheduleError('');
          }}
          style={[
            styles.datePickerItem,
            isSelected && styles.datePickerItemSelected,
            disabled && styles.optionDisabled,
          ]}
        >
          <Text
            style={[
              styles.datePickerWeekday,
              isSelected && styles.datePickerTextSelected,
            ]}
          >
            {formatWeekday(item)}
          </Text>
          <Text
            style={[
              styles.datePickerDate,
              isSelected && styles.datePickerTextSelected,
            ]}
          >
            {formatDateLabel(item)}
          </Text>
        </TouchableOpacity>
      );
    },
    [customDate, processingRequestId]
  );

  const keyExtractor = useCallback((item) => item.id, []);
  const dateKeyExtractor = useCallback((item) => getDateKey(item), []);

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <BlueTapHeader notificationPath="/distributor/d_notification" />

      <View style={styles.phoneWrapper}>
        <FlatList
          data={pendingRequests}
          keyExtractor={keyExtractor}
          renderItem={renderRequest}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.pageHeader}>
              <Text style={styles.pageTitle}>REQUESTS</Text>
              <Text style={styles.subtitle}>Pending Requests</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No pending requests.</Text>
              <Text style={styles.emptyText}>
                New customer requests will appear here when they are ready to
                schedule.
              </Text>
            </View>
          }
          extraData={processingRequestId}
        />

        <View style={styles.bottomNav}>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_dashboard')}>
            <Image source={require('../../assets/icons/home.png')} style={styles.navIcon} tintColor={BLUE} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_requests')}>
            <Image source={require('../../assets/icons/ballot.png')} style={styles.navIconActive} tintColor={BLUE} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_scheduled_requests')}>
            <Image source={require('../../assets/icons/calendar-clock.png')} style={styles.navIcon} tintColor={BLUE} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_profile')}>
            <Image source={require('../../assets/icons/user.png')} style={styles.navIcon} tintColor={BLUE} />
          </TouchableOpacity>
        </View>
      </View>

      {successVisible && (
        <Animated.View
          style={[
            styles.successToast,
            {
              opacity: toastAnim,
              transform: [
                {
                  translateY: toastAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [16, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.successToastText}>
            {'\u2713'} Request Scheduled Successfully
          </Text>
        </Animated.View>
      )}

      <Modal
        visible={!!detailsRequest}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailsRequest(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setDetailsRequest(null)}
          />
          <View style={styles.detailsModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Request Details</Text>
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => setDetailsRequest(null)}
              >
                <Text style={styles.modalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalDivider} />

            {detailsRequest && (
              <ScrollView
                style={styles.modalDetailsList}
                showsVerticalScrollIndicator={false}
              >
                {[
                  ['Request ID', detailsRequest.id],
                  ['Customer Name', detailsRequest.requester],
                  ['Requester ID', detailsRequest.requesterId || detailsRequest.requester_unique_id || 'Not set'],
                  ['Distributor Name', detailsRequest.distributor || detailsRequest.distributor_name || 'Not set'],
                  ['Distributor ID', detailsRequest.distributorId || detailsRequest.distributor_unique_id || 'Not set'],
                  ['Contact Number', detailsRequest.contact],
                  ['Delivery Address', detailsRequest.address],
                  ['Product', detailsRequest.productName],
                  ['Quantity', detailsRequest.quantity],
                  ['Container Type', detailsRequest.container],
                  ['Requested Delivery Date', detailsRequest.deliveryDate],
                  [
                    'Product Price',
                    detailsRequest.productPrice ??
                      detailsRequest.product_price ??
                      'Not set',
                  ],
                  [
                    'Delivery Fee',
                    detailsRequest.deliveryFee ??
                      detailsRequest.delivery_fee ??
                      'Not set',
                  ],
                  [
                    'Total Amount to Pay',
                    detailsRequest.totalAmount ??
                      detailsRequest.total_amount ??
                      detailsRequest.total_cost ??
                      'Not set',
                  ],
                  detailsRequest.customerNotes || detailsRequest.customer_notes
                    ? [
                        'Customer Notes',
                        detailsRequest.customerNotes ??
                          detailsRequest.customer_notes,
                      ]
                    : null,
                  ['Current Status', detailsRequest.status || 'Pending'],
                ]
                  .filter(Boolean)
                  .map(([label, value]) => (
                    <View key={label} style={styles.modalDetailRow}>
                      <Text style={styles.modalDetailLabel}>{label}</Text>
                      <Text style={styles.modalDetailValue}>{value}</Text>
                    </View>
                  ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={scheduleSheetVisible}
        transparent
        animationType="none"
        onRequestClose={() => closeScheduleSheet()}
      >
        <View style={styles.sheetRoot}>
          <Animated.View
            style={[
              styles.sheetBackdrop,
              {
                opacity: backdropOpacity,
              },
            ]}
          >
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={() => closeScheduleSheet()}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.bottomSheet,
              {
                transform: [{ translateY: sheetTranslateY }],
              },
            ]}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Choose Delivery Schedule</Text>
            <Text style={styles.sheetDescription}>
              Select the delivery schedule before confirming.
            </Text>

            <View style={styles.scheduleOptions}>
              {SCHEDULE_OPTIONS.map((option) => (
                <ScheduleOption
                  key={option.value}
                  label={option.label}
                  isSelected={selectedSchedule === option.value}
                  disabled={!!processingRequestId}
                  onPress={() => {
                    setSelectedSchedule(option.value);
                    setScheduleError('');
                  }}
                />
              ))}
            </View>

            {selectedSchedule === 'custom' && (
              <View style={styles.customPickerPanel}>
                <Text style={styles.pickerLabel}>Date Picker</Text>
                <FlatList
                  horizontal
                  data={customDateOptions}
                  keyExtractor={dateKeyExtractor}
                  renderItem={renderDateOption}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.datePickerList}
                />

                <Text style={[styles.pickerLabel, styles.timePickerLabel]}>
                  Time Picker
                </Text>
                <View style={styles.timePickerGrid}>
                  {TIME_SLOTS.map((timeValue) => {
                    const isSelected = customTime === timeValue;
                    const disabled =
                      isPastTimeSlot(customDate, timeValue) ||
                      !!processingRequestId;

                    return (
                      <TouchableOpacity
                        key={timeValue}
                        activeOpacity={0.82}
                        disabled={disabled}
                        onPress={() => {
                          setCustomTime(timeValue);
                          setScheduleError('');
                        }}
                        style={[
                          styles.timePickerItem,
                          isSelected && styles.timePickerItemSelected,
                          disabled && styles.timePickerItemDisabled,
                        ]}
                      >
                        <Text
                          style={[
                            styles.timePickerText,
                            isSelected && styles.timePickerTextSelected,
                            disabled && styles.timePickerTextDisabled,
                          ]}
                        >
                          {formatTimeLabel(timeValue)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {!!scheduleError && (
              <Text style={styles.scheduleError}>{scheduleError}</Text>
            )}

            <View style={styles.sheetActions}>
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={!!processingRequestId}
                style={[
                  styles.sheetCancelButton,
                  !!processingRequestId && styles.actionButtonDisabled,
                ]}
                onPress={() => closeScheduleSheet()}
              >
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.85}
                disabled={!!processingRequestId}
                style={[
                  styles.sheetConfirmButton,
                  !!processingRequestId && styles.actionButtonDisabled,
                ]}
                onPress={confirmSchedule}
              >
                {processingRequestId ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.sheetConfirmText}>Confirm</Text>
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4FAFF',
  },
  phoneWrapper: {
    width: '100%',
    maxWidth: 375,
    alignSelf: 'center',
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 150,
  },
  pageHeader: {
    marginBottom: 14,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: BLUE,
    letterSpacing: 0,
  },
  subtitle: {
    fontSize: 14,
    color: BLUE,
    fontWeight: '600',
    marginTop: 4,
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#D7ECFF',
    ...createShadow({
      color: '#0D47A1',
      elevation: 6,
      opacity: 0.12,
      radius: 10,
      offset: { width: 0, height: 5 },
    }),
  },
  requestCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BLUE_LIGHT,
  },
  requestId: {
    flex: 1,
    color: BLUE,
    fontSize: 15,
    fontWeight: 'bold',
  },
  cardBody: {
    paddingTop: 12,
  },
  compactInfoGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  compactInfoColumn: {
    flex: 1,
    minWidth: 0,
  },
  compactLabel: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  compactLabelGap: {
    marginTop: 10,
  },
  compactPrimaryValue: {
    color: BLUE,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: 'bold',
  },
  compactValue: {
    color: TEXT_DARK,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  compactAddressBlock: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BLUE_LIGHT,
  },
  compactAddressValue: {
    color: TEXT_DARK,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  secondaryActionButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1.5,
    borderColor: '#2563EB',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  primaryActionButton: {
    flex: 1,
    minHeight: 44,
    backgroundColor: BLUE,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...createShadow({
      color: BLUE,
      elevation: 4,
      opacity: 0.18,
      radius: 10,
      offset: { width: 0, height: 4 },
    }),
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  actionButtonDisabled: {
    opacity: 0.65,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#D7ECFF',
    ...createShadow({
      color: '#0D47A1',
      elevation: 4,
      opacity: 0.08,
      radius: 8,
      offset: { width: 0, height: 4 },
    }),
  },
  emptyTitle: {
    color: BLUE,
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptyText: {
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 5,
  },
  bottomNav: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 22,
    zIndex: 2,
    ...createShadow({
      color: '#000',
      elevation: 8,
      opacity: 0.12,
      radius: 6,
      offset: { width: 0, height: 3 },
    }),
  },
  navIcon: {
    width: 26,
    height: 26,
  },
  navIconActive: {
    width: 26,
    height: 26,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 31, 51, 0.46)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  detailsModal: {
    width: '100%',
    maxWidth: 375,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 30,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: BLUE,
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalCloseText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: 'bold',
  },
  modalDivider: {
    height: 1,
    backgroundColor: BLUE_LIGHT,
    marginTop: 12,
    marginBottom: 12,
  },
  modalDetailsList: {
    maxHeight: 520,
  },
  modalDetailRow: {
    marginBottom: 11,
  },
  modalDetailLabel: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  modalDetailValue: {
    color: TEXT_DARK,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 31, 51, 0.48)',
  },
  bottomSheet: {
    width: '100%',
    maxWidth: 375,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D1E7F8',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    color: BLUE,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  sheetDescription: {
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 5,
    marginBottom: 14,
  },
  scheduleOptions: {
    gap: 9,
  },
  scheduleOption: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#C8E6FA',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
  },
  scheduleOptionSelected: {
    backgroundColor: '#EAF6FF',
    borderColor: BLUE,
  },
  scheduleOptionText: {
    color: TEXT_DARK,
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 10,
  },
  scheduleOptionTextSelected: {
    color: BLUE,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#8ABEE8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: BLUE,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BLUE,
  },
  customPickerPanel: {
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: '#F7FBFF',
    borderWidth: 1,
    borderColor: '#D7ECFF',
    padding: 12,
  },
  pickerLabel: {
    color: BLUE,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  datePickerList: {
    gap: 8,
    paddingRight: 4,
  },
  datePickerItem: {
    minWidth: 72,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#C8E6FA',
    backgroundColor: '#FFFFFF',
    paddingVertical: 9,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  datePickerItemSelected: {
    backgroundColor: BLUE,
    borderColor: BLUE,
  },
  datePickerWeekday: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: 'bold',
  },
  datePickerDate: {
    color: TEXT_DARK,
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: 2,
  },
  datePickerTextSelected: {
    color: '#FFFFFF',
  },
  timePickerLabel: {
    marginTop: 13,
  },
  timePickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timePickerItem: {
    minWidth: 72,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C8E6FA',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timePickerItemSelected: {
    backgroundColor: BLUE,
    borderColor: BLUE,
  },
  timePickerItemDisabled: {
    backgroundColor: '#EEF3F7',
    borderColor: '#D9E4EC',
  },
  timePickerText: {
    color: TEXT_DARK,
    fontSize: 12,
    fontWeight: 'bold',
  },
  timePickerTextSelected: {
    color: '#FFFFFF',
  },
  timePickerTextDisabled: {
    color: '#9EADB8',
  },
  optionDisabled: {
    opacity: 0.55,
  },
  scheduleError: {
    color: '#C62828',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
    textAlign: 'center',
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  sheetCancelButton: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  sheetCancelText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  sheetConfirmButton: {
    flex: 1,
    height: 46,
    borderRadius: 16,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
    ...createShadow({
      color: BLUE,
      elevation: 4,
      opacity: 0.18,
      radius: 10,
      offset: { width: 0, height: 4 },
    }),
  },
  sheetConfirmText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  successToast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 92,
    alignSelf: 'center',
    maxWidth: 335,
    backgroundColor: '#1B8F4C',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    zIndex: 10,
    ...createShadow({
      color: '#000',
      elevation: 8,
      opacity: 0.14,
      radius: 8,
      offset: { width: 0, height: 4 },
    }),
    pointerEvents: 'none',
  },
  successToastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});
