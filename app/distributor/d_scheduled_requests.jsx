import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BlueTapHeader from '../../components/BlueTapHeader';
import RequestDetailsModal from '../../components/RequestDetailsModal';
import SoftStatusBadge from '../../components/SoftStatusBadge';
import { createShadow } from '../../components/shadowStyles';

const BLUE = '#187BCD';
const BLUE_LIGHT = '#E3F2FD';
const CARD_BORDER = '#D7ECFF';
const TEXT_MUTED = '#6F8EA8';
const TEXT_DARK = '#20384D';

const SCHEDULED_REQUESTS = [
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
    scheduledDateTime: 'Jan 25, 2026, 9:00 AM',
    amountDue: '\u20B175.00',
    status: 'Scheduled',
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
    scheduledDateTime: 'Jan 25, 2026, 10:00 AM',
    amountDue: '\u20B150.00',
    status: 'Scheduled',
  },
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
    requesterUniqueId: request.requesterId || request.requester_unique_id || '',
    customerName: request.requester,
    distributorName: request.distributor || request.distributor_name || '',
    distributorUniqueId:
      request.distributorId || request.distributor_unique_id || '',
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

const ScheduledRequestCard = ({ request, onViewDetails }) => {
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
            Container Type
          </Text>
          <Text style={styles.compactValue} numberOfLines={1}>
            {request.container}
          </Text>
        </View>
      </View>

      <View style={styles.fullWidthInfoBlock}>
        <Text style={styles.compactLabel}>Delivery Address</Text>
        <Text style={styles.compactAddressValue} numberOfLines={2}>
          {request.address}
        </Text>

        <Text style={[styles.compactLabel, styles.compactLabelGap]}>
          Scheduled Delivery Date & Time
        </Text>
        <Text style={styles.compactValue} numberOfLines={1}>
          {request.scheduledDateTime}
        </Text>
      </View>

      <View style={styles.cardActionsRow}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.secondaryActionButton}
          onPress={() => onViewDetails(request)}
        >
          <Text style={styles.secondaryActionText}>View Details</Text>
        </TouchableOpacity>

        <TouchableOpacity activeOpacity={0.85} style={styles.primaryActionButton}>
          <Text style={styles.primaryActionText}>Start Delivery</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default function DistributorScheduledRequests() {
  const router = useRouter();
  const [selectedRequest, setSelectedRequest] = useState(null);
  const selectedDetailsRequest = getDetailsRequestData(selectedRequest);

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <BlueTapHeader notificationPath="/distributor/d_notification" />

      <View style={styles.phoneWrapper}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.pageTitle}>SCHEDULE</Text>
          <Text style={styles.subtitle}>Scheduled Requests</Text>

          <View style={styles.scheduleTabs}>
            <TouchableOpacity
              style={[styles.scheduleTab, styles.scheduleTabActive]}
              activeOpacity={0.85}
              onPress={() => router.replace('/distributor/d_scheduled_requests')}
            >
              <Text style={[styles.scheduleTabText, styles.scheduleTabTextActive]}>
                Scheduled
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.scheduleTab}
              activeOpacity={0.85}
              onPress={() => router.replace('/distributor/d_history')}
            >
              <Text style={styles.scheduleTabText}>History</Text>
            </TouchableOpacity>
          </View>

          {SCHEDULED_REQUESTS.map((request) => (
            <ScheduledRequestCard
              key={request.id}
              request={request}
              onViewDetails={setSelectedRequest}
            />
          ))}
        </ScrollView>
      </View>

      <RequestDetailsModal
        visible={!!selectedRequest}
        onClose={() => setSelectedRequest(null)}
        request={selectedDetailsRequest}
      />
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
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 150,
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
    marginBottom: 14,
  },
  scheduleTabs: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: BLUE,
    borderRadius: 13,
    overflow: 'hidden',
    marginBottom: 16,
  },
  scheduleTab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  scheduleTabActive: {
    backgroundColor: BLUE,
  },
  scheduleTabText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: 'bold',
  },
  scheduleTabTextActive: {
    color: '#FFFFFF',
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
  fullWidthInfoBlock: {
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
});
