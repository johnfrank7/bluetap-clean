import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { auth } from '../../firebase';
import { findLocalUserForAuthRole } from '../../localUsers';
import RequestDetailsModal from '../../components/RequestDetailsModal';
import SoftStatusBadge, { normalizeStatus } from '../../components/SoftStatusBadge';
import { createShadow } from '../../components/shadowStyles';
import {
  cancelRequest,
  subscribeRequesterRequests,
} from '../../services/requests';

const BLUE = '#187BCD';
const BLUE_LIGHT = '#E3F2FD';
const CARD_BORDER = '#D7ECFF';
const TEXT_MUTED = '#6F8EA8';
const TEXT_DARK = '#20384D';

const ACTIVE_TAB = 'active';
const HISTORY_TAB = 'history';
const ACTIVE_STATUSES = new Set([
  'pending',
  'accepted',
  'scheduled',
  'out for delivery',
]);
const HISTORY_STATUSES = new Set(['delivered', 'cancelled', 'canceled']);

const formatPrice = (price) => `\u20B1${Number(price || 0).toFixed(2)}`;

const timestampToDate = (timestamp) => {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp?.toDate === 'function') return timestamp.toDate();
  if (typeof timestamp?.toMillis === 'function') return new Date(timestamp.toMillis());
  if (timestamp.seconds) return new Date(timestamp.seconds * 1000);

  if (typeof timestamp === 'string') {
    const formDateMatch = timestamp.match(
      /^(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})$/
    );

    if (formDateMatch) {
      return new Date(
        Number(formDateMatch[3]),
        Number(formDateMatch[1]) - 1,
        Number(formDateMatch[2])
      );
    }

    const parsedDate = new Date(timestamp);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  return null;
};

const formatDateValue = (value, fallback = 'Date not set') => {
  const date = timestampToDate(value);

  if (!date) return value ? String(value) : fallback;

  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  } catch (error) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month} - ${day} - ${date.getFullYear()}`;
  }
};

const isPendingRequest = (request) =>
  normalizeStatus(request?.status || 'Pending') === 'pending';

const getRequestId = (request) => request.request_id || request.id || 'Not set';

const normalizeRequestItem = (item = {}, fallback = {}) => {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.product_price ?? item.price ?? 0);
  const subtotal = Number(
    item.line_total ?? item.subtotal ?? unitPrice * quantity
  );

  return {
    id: item.product_id || fallback.id || fallback.product_id || '',
    productName:
      item.product_name || item.productName || fallback.product_name || 'Product',
    quantity: Number.isFinite(quantity) ? quantity : item.quantity,
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
    subtotal: Number.isFinite(subtotal) ? subtotal : 0,
  };
};

const getRequestItems = (request) => {
  if (!request) return [];

  if (Array.isArray(request.items) && request.items.length > 0) {
    return request.items.map((item, index) =>
      normalizeRequestItem(item, {
        id: `${getRequestId(request)}-${index}`,
        product_name: request.product_name,
      })
    );
  }

  if (!request.product_name) return [];

  const quantity = Number(request.quantity || 0);
  const unitPrice = Number(request.product_price || 0);
  const totalCost = Number(request.total_cost || 0);

  return [
    normalizeRequestItem(
      {
        product_id: request.product_id,
        product_name: request.product_name,
        product_price: unitPrice || (quantity > 0 ? totalCost / quantity : 0),
        quantity,
        line_total: totalCost,
      },
      request
    ),
  ];
};

const getProductSummary = (request) => {
  const items = getRequestItems(request);

  if (items.length === 0) return request.product_name || 'Not set';

  return items.length > 1
    ? `${items[0].productName} +${items.length - 1} more`
    : items[0].productName;
};

const getQuantityText = (request) => {
  const quantity = Number(request.quantity);

  if (Number.isFinite(quantity) && quantity > 0) {
    return String(quantity);
  }

  const totalQuantity = getRequestItems(request).reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );

  return totalQuantity > 0 ? String(totalQuantity) : 'Not set';
};

const getTotalAmount = (request) => {
  const totalAmount = Number(request?.total_cost || 0);

  if (Number.isFinite(totalAmount) && totalAmount > 0) {
    return totalAmount;
  }

  return getRequestItems(request).reduce(
    (sum, item) => sum + Number(item.subtotal || 0),
    0
  );
};

const getDetailsRequestData = (request) =>
  request
    ? {
        requestId: getRequestId(request),
        status: request.status || 'Pending',
        orderDate: formatDateValue(request.created_at, 'Order date not set'),
        deliveryDate: formatDateValue(
          request.delivery_date,
          'Delivery date not set'
        ),
        product: getProductSummary(request),
        containerType: request.container || 'Not set',
        quantity: getQuantityText(request),
        totalAmount: getTotalAmount(request),
        waterStation: request.water_station || 'Not set',
        paymentMethod:
          request.payment_method || request.paymentMethod || 'Not set',
        requesterName: request.requester_name || 'Not set',
        requesterUniqueId:
          request.requester_unique_id ||
          findLocalUserForAuthRole(auth.currentUser, 'requester')?.unique_id ||
          '',
        customerName: request.requester_name || 'Not set',
        distributorName: request.distributor_name || '',
        distributorUniqueId: request.distributor_unique_id || '',
        contactNumber: request.contact_number || 'Not set',
        deliveryAddress: request.address || 'Not set',
        items: getRequestItems(request),
        grandTotalAmount: getTotalAmount(request),
      }
    : null;

const RequestCard = ({
  request,
  isHistory,
  isCancelling,
  onCancel,
  onViewDetails,
}) => {
  const canCancel = !isHistory && isPendingRequest(request);

  return (
    <View style={styles.requestCard}>
      <View style={styles.requestCardHeader}>
        <Text style={styles.requestId} numberOfLines={1}>
          Request ID: {getRequestId(request)}
        </Text>

        <SoftStatusBadge status={request.status} />
      </View>

      <View style={styles.compactInfoGrid}>
        <View style={styles.compactInfoColumn}>
          <Text style={styles.compactLabel}>Product Ordered</Text>
          <Text style={styles.compactPrimaryValue} numberOfLines={2}>
            {getProductSummary(request)}
          </Text>
        </View>

        <View style={styles.compactInfoColumn}>
          <Text style={styles.compactLabel}>Container Type</Text>
          <Text style={styles.compactValue} numberOfLines={2}>
            {request.container || 'Not set'}
          </Text>
        </View>
      </View>

      <View style={[styles.compactInfoGrid, styles.infoGridDivider]}>
        <View style={styles.compactInfoColumn}>
          <Text style={styles.compactLabel}>Order Date</Text>
          <Text style={styles.compactValue} numberOfLines={1}>
            {formatDateValue(request.created_at, 'Order date not set')}
          </Text>
        </View>

        <View style={styles.compactInfoColumn}>
          <Text style={styles.compactLabel}>Total Amount</Text>
          <Text style={styles.compactValue} numberOfLines={1}>
            {formatPrice(getTotalAmount(request))}
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

        {canCancel && (
          <TouchableOpacity
            activeOpacity={0.85}
            style={[
              styles.cancelActionButton,
              isCancelling && styles.actionButtonDisabled,
            ]}
            onPress={() => onCancel(request)}
            disabled={isCancelling}
          >
            <Text style={styles.cancelActionText}>
              {isCancelling ? 'Cancelling...' : 'Cancel Request'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

export default function RequesterRequests() {
  const router = useRouter();
  const [requests, setRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [activeTab, setActiveTab] = useState(ACTIVE_TAB);
  const [cancellingRequestId, setCancellingRequestId] = useState('');
  const isActiveOrdersTab = activeTab === ACTIVE_TAB;

  useEffect(() => {
    const requesterId =
      findLocalUserForAuthRole(auth.currentUser, 'requester')?.uid || '';

    if (!requesterId) return undefined;

    return subscribeRequesterRequests(requesterId, setRequests);
  }, []);

  const displayedRequests = useMemo(
    () =>
      requests.filter((request) => {
        const normalizedStatus = normalizeStatus(request.status || 'Pending');

        return isActiveOrdersTab
          ? ACTIVE_STATUSES.has(normalizedStatus)
          : HISTORY_STATUSES.has(normalizedStatus);
      }),
    [isActiveOrdersTab, requests]
  );
  const selectedDetailsRequest = getDetailsRequestData(selectedRequest);

  const cancelPendingRequest = async (request) => {
    if (cancellingRequestId) return;

    try {
      setCancellingRequestId(request.id);
      const cancelledRequest = await cancelRequest(request);
      setRequests((currentRequests) =>
        currentRequests.map((currentRequest) =>
          currentRequest.id === request.id
            ? { ...currentRequest, ...cancelledRequest, status: 'Cancelled' }
            : currentRequest
        )
      );
    } catch (error) {
      if (error.savedLocal) {
        setRequests((currentRequests) =>
          currentRequests.map((currentRequest) =>
            currentRequest.id === request.id
              ? { ...currentRequest, ...error.localRequest, status: 'Cancelled' }
              : currentRequest
          )
        );
        return;
      }

      Alert.alert('Cancel failed', error.message);
    } finally {
      setCancellingRequestId('');
    }
  };

  const confirmCancelRequest = (request) => {
    Alert.alert(
      'Cancel Request',
      'Are you sure you want to cancel this pending request?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: () => cancelPendingRequest(request),
        },
      ]
    );
  };

  return (
    <LinearGradient
      colors={['#187BCD', '#42A5F5']}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
        <StatusBar style="light" />

        <View style={styles.phoneWrapper}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
          <Text style={styles.pageTitle}>MY ORDERS</Text>
          <Text style={styles.subtitle}>View and manage your water orders.</Text>

          <View style={styles.orderTabs}>
            <TouchableOpacity
              style={[
                styles.orderTab,
                activeTab === ACTIVE_TAB && styles.orderTabActive,
              ]}
              activeOpacity={0.85}
              onPress={() => setActiveTab(ACTIVE_TAB)}
            >
              <Text
                style={[
                  styles.orderTabText,
                  activeTab === ACTIVE_TAB && styles.orderTabTextActive,
                ]}
              >
                Active Orders
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.orderTab,
                activeTab === HISTORY_TAB && styles.orderTabActive,
              ]}
              activeOpacity={0.85}
              onPress={() => setActiveTab(HISTORY_TAB)}
            >
              <Text
                style={[
                  styles.orderTabText,
                  activeTab === HISTORY_TAB && styles.orderTabTextActive,
                ]}
              >
                History
              </Text>
            </TouchableOpacity>
          </View>

          {isActiveOrdersTab && (
            <TouchableOpacity
              style={styles.addRequestButton}
              activeOpacity={0.85}
              onPress={() => router.replace('/requester/requestform')}
            >
              <Text style={styles.addRequestText}>Add Request</Text>
            </TouchableOpacity>
          )}

          {displayedRequests.length === 0 ? (
            <View style={styles.emptyRequestCard}>
              <Text style={styles.emptyRequestTitle}>
                {isActiveOrdersTab
                  ? 'No active orders.'
                  : 'No order history yet.'}
              </Text>
              <Text style={styles.emptyRequestText}>
                {isActiveOrdersTab
                  ? 'Pending and ongoing water orders will appear here.'
                  : 'Delivered and cancelled orders will appear here.'}
              </Text>
            </View>
          ) : (
            displayedRequests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                isHistory={!isActiveOrdersTab}
                isCancelling={cancellingRequestId === request.id}
                onCancel={confirmCancelRequest}
                onViewDetails={setSelectedRequest}
              />
            ))
          )}
          </ScrollView>

          <RequestDetailsModal
            visible={!!selectedRequest}
            onClose={() => setSelectedRequest(null)}
            request={selectedDetailsRequest}
          />
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    width: '100%',
  },
  phoneWrapper: {
    width: '100%',
    maxWidth: 375,
    alignSelf: 'center',
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 150,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 0,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 14,
  },
  orderTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 16,
    padding: 4,
    overflow: 'hidden',
    marginBottom: 12,
    ...createShadow({
      color: '#0D47A1',
      elevation: 2,
      opacity: 0.08,
      radius: 6,
      offset: { width: 0, height: 3 },
    }),
  },
  orderTab: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderTabActive: {
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  orderTabText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: 'bold',
  },
  orderTabTextActive: {
    color: BLUE,
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
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
  compactInfoGrid: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 12,
  },
  infoGridDivider: {
    borderTopWidth: 1,
    borderTopColor: BLUE_LIGHT,
    marginTop: 12,
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
  cancelActionButton: {
    flex: 1,
    minHeight: 44,
    backgroundColor: '#EF4444',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...createShadow({
      color: '#EF4444',
      elevation: 4,
      opacity: 0.18,
      radius: 10,
      offset: { width: 0, height: 4 },
    }),
  },
  cancelActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  actionButtonDisabled: {
    opacity: 0.7,
  },
  emptyRequestCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 20,
    padding: 16,
    ...createShadow({
      color: '#0D47A1',
      elevation: 4,
      opacity: 0.08,
      radius: 8,
      offset: { width: 0, height: 4 },
    }),
  },
  emptyRequestTitle: {
    color: BLUE,
    fontSize: 15,
    fontWeight: 'bold',
  },
  emptyRequestText: {
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  addRequestButton: {
    minHeight: 48,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    marginTop: 2,
    marginBottom: 16,
    ...createShadow({
      color: '#0D47A1',
      elevation: 2,
      opacity: 0.08,
      radius: 8,
      offset: { width: 0, height: 3 },
    }),
  },
  addRequestText: {
    color: BLUE,
    fontSize: 15,
    fontWeight: 'bold',
  },
});
