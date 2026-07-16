import React, { useState } from 'react';
import {
  Image,
  Modal,
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

const BLUE = '#187BCD';
const BLUE_LIGHT = '#E3F2FD';
const CARD_BORDER = '#D7ECFF';
const TEXT_MUTED = '#6F8EA8';
const TEXT_DARK = '#20384D';

const STATUS_BADGES = {
  pending: {
    backgroundColor: '#FFF8E1',
    color: '#F9A825',
    label: '\u25CF Pending',
  },
  scheduled: {
    backgroundColor: '#E3F2FD',
    color: '#1976D2',
    label: '\u25CF Scheduled',
  },
  'out for delivery': {
    backgroundColor: '#F3E5F5',
    color: '#8E24AA',
    label: '\u25CF Out for Delivery',
  },
  delivered: {
    backgroundColor: '#E8F5E9',
    color: '#2E7D32',
    label: '\u25CF Delivered',
  },
  rejected: {
    backgroundColor: '#FFEBEE',
    color: '#C62828',
    label: '\u25CF Rejected',
  },
  cancelled: {
    backgroundColor: '#F5F5F5',
    color: '#616161',
    label: '\u25CF Cancelled',
  },
  canceled: {
    backgroundColor: '#F5F5F5',
    color: '#616161',
    label: '\u25CF Cancelled',
  },
};

const getStatusBadge = (status) =>
  STATUS_BADGES[(status || '').toString().trim().toLowerCase()] ||
  STATUS_BADGES.scheduled;

const SCHEDULED_REQUESTS = [
  {
    id: 'BT-01245',
    quantity: '3 Gallons',
    productName: 'Purified Mineral Water',
    container: 'New Container',
    requester: 'Jeanne Ortega',
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
    contact: '09123456789',
    address: 'Tajao, Pinamungajan',
    scheduledDateTime: 'Jan 25, 2026, 10:00 AM',
    amountDue: '\u20B150.00',
    status: 'Scheduled',
  },
];

const DetailModal = ({ request, onClose }) => (
  <Modal
    visible={!!request}
    transparent
    animationType="fade"
    onRequestClose={onClose}
  >
    <View style={styles.modalBackdrop}>
      <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      <View style={styles.detailsModal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Request Details</Text>
          <TouchableOpacity activeOpacity={0.75} onPress={onClose}>
            <Text style={styles.modalCloseText}>Close</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.modalDivider} />

        {request && (
          <ScrollView
            style={styles.modalDetailsList}
            showsVerticalScrollIndicator={false}
          >
            {[
              ['Request ID', request.id],
              ['Customer Name', request.requester],
              ['Contact Number', request.contact],
              ['Delivery Address', request.address],
              ['Product', request.productName],
              ['Quantity', request.quantity],
              ['Container Type', request.container],
              ['Scheduled Date', request.scheduledDateTime],
              ['Amount Due', request.amountDue || 'Not set'],
              ['Status', request.status || 'Scheduled'],
            ].map(([label, value]) => (
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
);

const ScheduledRequestCard = ({ request, onViewDetails }) => {
  const badge = getStatusBadge(request.status);

  return (
    <View style={styles.requestCard}>
      <View style={styles.requestCardHeader}>
        <Text style={styles.requestId}>Request ID: {request.id}</Text>
        <View style={[styles.statusBadge, { backgroundColor: badge.backgroundColor }]}>
          <Text style={[styles.statusBadgeText, { color: badge.color }]}>
            {badge.label}
          </Text>
        </View>
      </View>

      <View style={styles.compactInfoGrid}>
        <View style={styles.compactInfoColumn}>
          <Text style={styles.compactLabel}>Customer Name</Text>
          <Text style={styles.compactPrimaryValue} numberOfLines={1}>
            {request.requester}
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

        <View style={styles.bottomNav}>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_dashboard')}>
            <Image source={require('../../assets/icons/home.png')} style={styles.navIcon} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_requests')}>
            <Image source={require('../../assets/icons/ballot.png')} style={styles.navIcon} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_scheduled_requests')}>
            <Image source={require('../../assets/icons/calendar-clock.png')} style={styles.navIcon} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_profile')}>
            <Image source={require('../../assets/icons/user.png')} style={styles.navIcon} />
          </TouchableOpacity>
        </View>
      </View>

      <DetailModal request={selectedRequest} onClose={() => setSelectedRequest(null)} />
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
    elevation: 6,
    shadowColor: '#0D47A1',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
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
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexShrink: 0,
  },
  statusBadgeText: {
    fontSize: 11,
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
    borderColor: BLUE,
    backgroundColor: '#FFFFFF',
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: 'bold',
  },
  primaryActionButton: {
    flex: 1,
    minHeight: 44,
    backgroundColor: BLUE,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: BLUE,
    shadowOpacity: 0.22,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
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
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  navIcon: {
    width: 26,
    height: 26,
    tintColor: BLUE,
  },
});
